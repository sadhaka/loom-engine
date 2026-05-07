// Loom Engine - Phase 9.1 perf microbenchmark.
//
// Synthetic CPU-cost measurement of the per-frame engine loop. Runs
// the same systems the /arpg-loom/ plaza uses (transform + sprite +
// animation + particle simulation + sprite render + particle render)
// against a counted entity set, with a no-op FakeDevice that records
// draw calls but does not paint.
//
// We cannot drive a real iPhone SE or Pixel 3a from this Node bench;
// what this bench DOES measure is the JS-side cost of the hot loop
// in milliseconds, separated from the device's drawImage cost. The
// real-device read-out is the JS budget per frame BEFORE GPU /
// rasterizer / compositor cost. If the JS is over 16.7ms here, no
// amount of GPU optimization will hit 60fps. If the JS is well
// under 16.7ms, the residual cost on a real device is up to the
// canvas backend.
//
// Run from the engine repo:
//   npx tsx tools/perf-bench.ts
//
// Optional env vars:
//   BENCH_FRAMES=1800     (default 1800 = 30s @ 60fps)
//   BENCH_WARMUP=120      (default 120 = 2s at 60fps)
//   BENCH_SCENARIOS=small,medium,large,xlarge  (default all)

import { performance } from 'node:perf_hooks';

import {
  World,
  POOL_TRANSFORM,
  POOL_SPRITE,
  TransformPool,
  SpritePool,
  SpriteRenderSystem,
  SYSTEM_PHASE_ANIMATION,
  SYSTEM_PHASE_INPUT,
  SYSTEM_PHASE_RENDER,
  createTimeResource,
  createCamera,
  RESOURCE_TIME,
  RESOURCE_CAMERA,
  RESOURCE_DEVICE,
  COLOR_KNOT_INT,
  InputManager,
  RESOURCE_INPUT_MANAGER,
  RESOURCE_INPUT,
  InputSystem,
  type System,
  type IGraphicsDevice,
  type CameraView,
  type AtlasDescriptor,
  type AtlasHandle,
  type ColorRGBA,
  type EntityId,
} from '../src/index.js';
import { AnimationSystem, POOL_ANIMATION } from '../src/systems/animation-system.js';
import { AnimationStatePool } from '../src/animation/animation-state-pool.js';
import type { SpriteSheetManifest } from '../src/asset/sprite-sheet-loader.js';

// ----- Headless graphics device. Records draw counts only. -----

class HeadlessDevice implements IGraphicsDevice {
  readonly canvas: HTMLCanvasElement = {} as HTMLCanvasElement;
  readonly viewportWidth: number = 640;
  readonly viewportHeight: number = 400;
  private drawCallCount: number = 0;
  private cameraSet: boolean = false;

  beginFrame(): void { this.drawCallCount = 0; }
  endFrame(): void {}
  setCamera(_c: Readonly<CameraView>): void { this.cameraSet = true; }
  registerAtlas(_d: AtlasDescriptor): AtlasHandle { return 0; }
  releaseAtlas(_h: AtlasHandle): void {}
  drawSprite(
    _x: number, _y: number, _z: number,
    _atlas: AtlasHandle, _frame: number,
    _tint?: Readonly<ColorRGBA>,
  ): void { this.drawCallCount++; }
  drawTile(_x: number, _y: number, _a: AtlasHandle, _f: number): void { this.drawCallCount++; }
  drawText(): void { this.drawCallCount++; }
  drawParticle(): void { this.drawCallCount++; }
  getDrawCallCount(): number { return this.drawCallCount; }
}

// ----- Scenario builder. Creates N entities walking around the plaza. -----

interface BenchScenario {
  name: string;
  entityCount: number;
  tintedFraction: number;  // 0..1 - fraction of sprites with a tint set
  movePerTick: number;     // world units the entity drifts per tick
}

function buildManifest(): SpriteSheetManifest {
  // 8-frame walk cycle, per-frame 100ms duration, looping.
  const frames = [];
  for (let i = 0; i < 8; i++) {
    frames.push({ x: i * 16, y: 0, w: 16, h: 32, name: 'walk_' + i, duration_ms: 100 });
  }
  return {
    name: 'bench-knight',
    image: 'walk.png',
    frames,
    anchor: { x: 8, y: 32 },
    fps: 8,
    clips: [
      { name: 'walk', frames: [0, 1, 2, 3, 4, 5, 6, 7], loop: true },
    ],
  };
}

function buildScenario(
  scen: BenchScenario,
): { world: World; device: HeadlessDevice; entities: EntityId[]; input: InputManager } {
  const world = new World();
  const device = new HeadlessDevice();
  const camera = createCamera(640, 400);
  const time = createTimeResource();
  const input = new InputManager();

  world.resources.set(RESOURCE_TIME, time);
  world.resources.set(RESOURCE_CAMERA, camera);
  world.resources.set(RESOURCE_DEVICE, device);
  world.resources.set(RESOURCE_INPUT_MANAGER, input);
  world.resources.set(RESOURCE_INPUT, input.snapshot());

  const transforms = new TransformPool();
  const sprites = new SpritePool();
  const animations = new AnimationStatePool();
  world.registerPool(POOL_TRANSFORM, transforms);
  world.registerPool(POOL_SPRITE, sprites);
  world.registerPool(POOL_ANIMATION, animations);

  // Wire InputSystem so per-frame snapshot/beginFrame allocations
  // appear in the heap delta. Plaza-walk parity.
  world.addSystem(new InputSystem(), SYSTEM_PHASE_INPUT);
  world.addSystem(new AnimationSystem(), SYSTEM_PHASE_ANIMATION);
  world.addSystem(new SpriteRenderSystem(), SYSTEM_PHASE_RENDER);

  const manifest = buildManifest();
  const tintedCount = Math.round(scen.entityCount * scen.tintedFraction);
  const entities: EntityId[] = [];
  for (let i = 0; i < scen.entityCount; i++) {
    const e = world.createEntity();
    entities.push(e);
    // Distribute roughly uniformly across a 32x16 plaza area so
    // depth-sort sees varied (x+y) keys, not a single value.
    const x = (i % 32);
    const y = Math.floor(i / 32);
    transforms.attach(e, x, y, 0);
    if (i < tintedCount) {
      sprites.attach(e, 0, 0, COLOR_KNOT_INT);
    } else {
      sprites.attach(e, 0, 0);
    }
    animations.play(e, manifest, 'walk');
  }
  return { world, device, entities, input };
}

// ----- Stats helpers -----

interface FrameStats {
  frames: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  fpsMean: number;
  fpsP95: number;
  slowFrames: number;        // count of frames > 16.7ms
  slowFraction: number;      // 0..1
  longTaskMs: number;        // total ms spent in frames > 50ms
  budget16Pct: number;       // mean / 16.7 * 100
}

function summarize(samples: number[]): FrameStats {
  const sorted = samples.slice().sort((a, b) => a - b);
  const n = sorted.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i] ?? 0;
  const meanMs = sum / Math.max(1, n);
  const pick = (q: number) => sorted[Math.min(n - 1, Math.floor(n * q))] ?? 0;
  const p50 = pick(0.5);
  const p95 = pick(0.95);
  const p99 = pick(0.99);
  const maxMs = sorted[n - 1] ?? 0;
  let slowFrames = 0;
  let longTaskMs = 0;
  for (let i = 0; i < n; i++) {
    const v = sorted[i] ?? 0;
    if (v > 16.7) slowFrames++;
    if (v > 50) longTaskMs += v;
  }
  return {
    frames: n,
    meanMs,
    p50Ms: p50,
    p95Ms: p95,
    p99Ms: p99,
    maxMs,
    fpsMean: 1000 / Math.max(0.001, meanMs),
    fpsP95: 1000 / Math.max(0.001, p95),
    slowFrames,
    slowFraction: slowFrames / Math.max(1, n),
    longTaskMs,
    budget16Pct: (meanMs / 16.7) * 100,
  };
}

// ----- One run of one scenario -----

interface RunResult {
  scenario: BenchScenario;
  stats: FrameStats;
  drawCallsPerFrame: number;
  heapUsedDeltaKb: number | null;
  // Peak mid-run heap above the post-warmup baseline. This is the
  // metric alloc-churn fixes actually move - residual heap after a
  // final GC is identical either way; what changes is how high heap
  // climbs between collections, which on mobile maps to GC pause
  // frequency.
  peakHeapAboveBaselineKb: number | null;
}

function runScenario(scen: BenchScenario, frames: number, warmup: number): RunResult {
  const { world, device, input } = buildScenario(scen);
  const dt = 1 / 60;

  // Force GC if --expose-gc was passed; record a baseline heap.
  let heapBefore: number | null = null;
  let heapAfter: number | null = null;
  if (typeof (globalThis as { gc?: () => void }).gc === 'function') {
    (globalThis as { gc?: () => void }).gc!();
    heapBefore = process.memoryUsage().heapUsed;
  }

  // Plaza-walk simulation: hold KeyD continuously, swap direction
  // every 90 frames to exercise pressed/released accumulator paths.
  input.injectKeyDown('KeyD');

  // Warmup so JIT settles.
  for (let i = 0; i < warmup; i++) {
    device.beginFrame();
    world.update(dt);
    device.endFrame();
  }

  // Re-baseline heap AFTER warmup so JIT compilation + first-time
  // allocations don't dominate the per-tick rate. peakHeap tracks
  // the highest heap-used value sampled mid-run; that's the metric
  // alloc-churn fixes move (residual after a final gc is identical).
  let peakHeapKb: number | null = null;
  let warmupBaselineHeap: number | null = null;
  if (typeof (globalThis as { gc?: () => void }).gc === 'function') {
    warmupBaselineHeap = process.memoryUsage().heapUsed;
    peakHeapKb = 0;
  }

  const samples: number[] = new Array(frames);
  let heldKey: 'KeyD' | 'KeyA' | 'KeyW' | 'KeyS' = 'KeyD';
  for (let i = 0; i < frames; i++) {
    if (i > 0 && i % 90 === 0) {
      input.injectKeyUp(heldKey);
      heldKey = (['KeyD', 'KeyS', 'KeyA', 'KeyW'] as const)[((i / 90) | 0) % 4]!;
      input.injectKeyDown(heldKey);
    }
    const t0 = performance.now();
    device.beginFrame();
    world.update(dt);
    device.endFrame();
    samples[i] = performance.now() - t0;
    // Sample heap every 60 frames; sampling per-frame is too costly.
    if (warmupBaselineHeap != null && peakHeapKb != null && i % 60 === 0) {
      const cur = process.memoryUsage().heapUsed;
      const aboveKb = (cur - warmupBaselineHeap) / 1024;
      if (aboveKb > peakHeapKb) peakHeapKb = aboveKb;
    }
  }

  if (typeof (globalThis as { gc?: () => void }).gc === 'function') {
    // Force a final GC so heapAfter reflects only allocations the
    // collector failed to reclaim, not transient garbage waiting on
    // the next collection cycle.
    (globalThis as { gc?: () => void }).gc!();
    heapAfter = process.memoryUsage().heapUsed;
  }
  const heapUsedDeltaKb = heapBefore != null && heapAfter != null
    ? Math.round((heapAfter - heapBefore) / 1024)
    : null;

  return {
    scenario: scen,
    stats: summarize(samples),
    drawCallsPerFrame: device.getDrawCallCount(),
    heapUsedDeltaKb,
    peakHeapAboveBaselineKb: peakHeapKb != null ? Math.round(peakHeapKb) : null,
  };
}

// ----- Allocation-churn microbench -----
//
// Isolates SpriteRenderSystem's per-frame cost on tinted sprites,
// which under the v1 implementation allocates a fresh tint object
// each call. We run the system 5000 times against 100 fully-tinted
// sprites and report the mean per-tick cost + the heapUsed delta.

function runTintAllocChurn(): {
  ticks: number;
  meanMsPerTick: number;
  heapUsedDeltaKb: number | null;
} {
  const world = new World();
  const device = new HeadlessDevice();
  const camera = createCamera(640, 400);
  const time = createTimeResource();
  world.resources.set(RESOURCE_TIME, time);
  world.resources.set(RESOURCE_CAMERA, camera);
  world.resources.set(RESOURCE_DEVICE, device);

  const transforms = new TransformPool();
  const sprites = new SpritePool();
  world.registerPool(POOL_TRANSFORM, transforms);
  world.registerPool(POOL_SPRITE, sprites);

  const renderSys = new SpriteRenderSystem();
  world.addSystem(renderSys, SYSTEM_PHASE_RENDER);

  const N = 100;
  for (let i = 0; i < N; i++) {
    const e = world.createEntity();
    transforms.attach(e, i % 16, Math.floor(i / 16), 0);
    sprites.attach(e, 0, 0, COLOR_KNOT_INT);
  }

  let heapBefore: number | null = null;
  let heapAfter: number | null = null;
  if (typeof (globalThis as { gc?: () => void }).gc === 'function') {
    (globalThis as { gc?: () => void }).gc!();
    heapBefore = process.memoryUsage().heapUsed;
  }

  // Warmup
  for (let i = 0; i < 200; i++) {
    device.beginFrame();
    world.update(1 / 60);
    device.endFrame();
  }

  const ticks = 5000;
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) {
    device.beginFrame();
    world.update(1 / 60);
    device.endFrame();
  }
  const elapsed = performance.now() - t0;

  if (typeof (globalThis as { gc?: () => void }).gc === 'function') {
    // Force a final GC so heapAfter reflects only allocations the
    // collector failed to reclaim, not transient garbage waiting on
    // the next collection cycle.
    (globalThis as { gc?: () => void }).gc!();
    heapAfter = process.memoryUsage().heapUsed;
  }
  const heapUsedDeltaKb = heapBefore != null && heapAfter != null
    ? Math.round((heapAfter - heapBefore) / 1024)
    : null;

  return {
    ticks,
    meanMsPerTick: elapsed / ticks,
    heapUsedDeltaKb,
  };
}

// ----- Main -----

const SCENARIOS: BenchScenario[] = [
  // Small: typical mobile, idle plaza.
  { name: 'small',  entityCount: 30,  tintedFraction: 0.5, movePerTick: 0.05 },
  // Medium: plaza with NPCs + a few mobs.
  { name: 'medium', entityCount: 100, tintedFraction: 0.5, movePerTick: 0.05 },
  // Large: stress test before zone change.
  { name: 'large',  entityCount: 250, tintedFraction: 0.5, movePerTick: 0.05 },
  // XLarge: well past expected plaza density - shows whether scaling
  // cliffs hide in the tail of the curve.
  { name: 'xlarge', entityCount: 500, tintedFraction: 0.5, movePerTick: 0.05 },
];

function main(): void {
  const frames = parseInt(process.env['BENCH_FRAMES'] ?? '1800', 10);
  const warmup = parseInt(process.env['BENCH_WARMUP'] ?? '120', 10);
  const filter = (process.env['BENCH_SCENARIOS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const scenarios = filter.length > 0
    ? SCENARIOS.filter((s) => filter.includes(s.name))
    : SCENARIOS;

  console.log('# Loom Engine perf bench');
  console.log('frames=' + frames + ' warmup=' + warmup + ' scenarios=' + scenarios.map((s) => s.name).join(','));
  console.log('node=' + process.version);
  console.log('');

  const results: RunResult[] = [];
  for (const scen of scenarios) {
    const r = runScenario(scen, frames, warmup);
    results.push(r);
    const s = r.stats;
    console.log('## scenario: ' + scen.name + ' (entities=' + scen.entityCount + ', tintedFrac=' + scen.tintedFraction + ')');
    console.log('  frames=' + s.frames);
    console.log('  mean=' + s.meanMs.toFixed(3) + 'ms  p50=' + s.p50Ms.toFixed(3) + 'ms  p95=' + s.p95Ms.toFixed(3) + 'ms  p99=' + s.p99Ms.toFixed(3) + 'ms  max=' + s.maxMs.toFixed(3) + 'ms');
    console.log('  fps_mean=' + s.fpsMean.toFixed(1) + '  fps_p95=' + s.fpsP95.toFixed(1));
    console.log('  slowFrames=' + s.slowFrames + ' (' + (s.slowFraction * 100).toFixed(2) + '%)  longTaskMs=' + s.longTaskMs.toFixed(1));
    console.log('  budget16=' + s.budget16Pct.toFixed(1) + '%  drawCalls=' + r.drawCallsPerFrame);
    if (r.heapUsedDeltaKb != null) {
      console.log('  heapDelta=' + r.heapUsedDeltaKb + ' KiB (frames=' + frames + ', ' + (r.heapUsedDeltaKb / frames).toFixed(2) + ' KiB/frame)');
    }
    if (r.peakHeapAboveBaselineKb != null) {
      console.log('  peakHeapAboveBaseline=' + r.peakHeapAboveBaselineKb + ' KiB (mid-run high-water mark)');
    }
    console.log('');
  }

  console.log('## tint-alloc-churn microbench');
  const tac = runTintAllocChurn();
  console.log('  ticks=' + tac.ticks);
  console.log('  meanMsPerTick=' + tac.meanMsPerTick.toFixed(4) + 'ms');
  if (tac.heapUsedDeltaKb != null) {
    console.log('  heapDelta=' + tac.heapUsedDeltaKb + ' KiB (' + (tac.heapUsedDeltaKb / tac.ticks * 1024).toFixed(1) + ' B/tick)');
  } else {
    console.log('  heapDelta=N/A (run with --expose-gc for heap delta)');
  }
  console.log('');
}

main();
