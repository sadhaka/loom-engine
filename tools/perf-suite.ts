// Loom Engine - Phase 14.3 perf suite.
//
// Standardized scenarios shared by the Node entry (perf-bench.ts) and
// the browser entry (perf-bench-browser.ts). Each scenario returns a
// normalized ScenarioResult so perf-report.ts can serialize the same
// shape regardless of where the bench was run.
//
// Scenarios:
//   1. Sprite count scaling      (100 / 1k / 5k / 10k / 50k entities)
//   2. Animation count scaling   (1k / 5k / 10k / 50k entities)
//   3. Particle stress           (sweep particle budget for fps cliff)
//   4. SSE event drain           (events/sec the bridge handles)
//   5. ECS pool iteration cost   (TransformPool sweep at 1k / 10k / 100k)
//   6. Asset load latency        (cold vs warm spritesheet load)
//   7. Memory under sustained    (peak heap above baseline after 60s)
//
// Plus the legacy tint-alloc-churn microbench from Phase 9.1.
//
// Heap metrics are Node-only (require process.memoryUsage and an
// --expose-gc launch). In the browser the heap fields are null;
// the report includes the runtime tag so a reader can tell which
// numbers are reliable.
//
// What this measures vs. what it doesn't:
//   - JS-side cost of the engine's hot loop, separated from the
//     device's draw/blit cost via the no-op HeadlessDevice.
//   - Real-device fps caps, GPU-bound costs, and rasterizer cost are
//     OUT OF SCOPE. Those are measured by running on the device with
//     a real Canvas2DDevice or (post-Track A) WebGL2Device. See
//     docs/PERF-BENCH-METHODOLOGY.md.

// Bench imports the BUILT engine (../dist/index.js) so the same file
// works in Node (via tsx) and the browser (via tsc-compiled output).
// Run `npm run build` once before invoking the bench so dist/ exists;
// the npm run bench script does this for you.
import {
  World,
  POOL_TRANSFORM,
  POOL_SPRITE,
  TransformPool,
  SpritePool,
  SpriteRenderSystem,
  SYSTEM_PHASE_ANIMATION,
  SYSTEM_PHASE_INPUT,
  SYSTEM_PHASE_LOGIC,
  SYSTEM_PHASE_PHYSICS,
  SYSTEM_PHASE_RENDER,
  createTimeResource,
  createCamera,
  createVeilBudgetResource,
  RESOURCE_TIME,
  RESOURCE_CAMERA,
  RESOURCE_DEVICE,
  RESOURCE_VEIL_BUDGET,
  COLOR_KNOT_INT,
  InputManager,
  RESOURCE_INPUT_MANAGER,
  RESOURCE_INPUT,
  InputSystem,
  ParticlePool,
  ParticleEmitterPool,
  ParticleSimulationSystem,
  ParticleEmitterSystem,
  ParticleRenderSystem,
  POOL_PARTICLE,
  POOL_EMITTER,
  MockDirectorBridge,
  DirectorSystem,
  RESOURCE_DIRECTOR_BRIDGE,
  RESOURCE_KNOT_CONTEXT,
  RESOURCE_DIRECTOR_LOG,
  KnotContextResource,
  createDirectorEventLog,
  loadSpriteSheet,
  AnimationSystem,
  POOL_ANIMATION,
  AnimationStatePool,
  type EmitterConfig,
  type DirectorEvent,
  type IGraphicsDevice,
  type CameraView,
  type AtlasDescriptor,
  type AtlasHandle,
  type ColorRGBA,
  type EntityId,
  type SpriteSheetManifest,
} from '../dist/index.js';

// ----- Cross-environment helpers -----
//
// The bench compiles under both the engine's main tsconfig (no node
// types) and tsx (Node runtime). We avoid bare `process` references
// so the browser-bench compile under tools/tsconfig.bench.json
// succeeds without pulling in @types/node.

interface NodeLike {
  versions?: { node?: string };
  memoryUsage?: () => { heapUsed: number };
}

function getNodeProcess(): NodeLike | null {
  const p = (globalThis as { process?: NodeLike }).process;
  return p ?? null;
}

export function isNodeRuntime(): boolean {
  const p = getNodeProcess();
  return !!(p && p.versions && typeof p.versions.node === 'string');
}

export function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export interface HeapHelper {
  // True when both --expose-gc was passed AND we are on Node. Browser
  // bench always reports false; consumers should null out heap fields
  // when this is false.
  available: boolean;
  forceGc(): void;
  heapUsedBytes(): number;
}

export function makeHeapHelper(): HeapHelper {
  const p = getNodeProcess();
  const gc = (globalThis as { gc?: () => void }).gc;
  if (
    p
    && typeof gc === 'function'
    && typeof p.memoryUsage === 'function'
  ) {
    return {
      available: true,
      forceGc() { gc(); },
      heapUsedBytes() { return p.memoryUsage!().heapUsed; },
    };
  }
  return {
    available: false,
    forceGc() {},
    heapUsedBytes() { return 0; },
  };
}

// ----- Headless graphics device. Records draw counts only. -----

export class HeadlessDevice implements IGraphicsDevice {
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

// ----- Frame stats -----

export interface FrameStats {
  frames: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  fpsMean: number;
  fpsP95: number;
  slowFrames: number;
  slowFraction: number;
  longTaskMs: number;
  budget16Pct: number;
}

export function summarize(samples: number[]): FrameStats {
  const sorted = samples.slice().sort(function (a, b) { return a - b; });
  const n = sorted.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i] ?? 0;
  const meanMs = sum / Math.max(1, n);
  function pick(q: number): number {
    return sorted[Math.min(n - 1, Math.floor(n * q))] ?? 0;
  }
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

// ----- Normalized scenario result -----

export interface ScenarioResult {
  scenarioId: string;        // 'sprite-scaling', 'animation-scaling', etc.
  variant: string;           // 'entities=1000', 'particles=4000', etc.
  config: Record<string, number | string | boolean>;
  stats?: FrameStats;
  drawCallsPerFrame?: number;
  heapDeltaKb?: number | null;
  peakHeapAboveBaselineKb?: number | null;
  customMetrics?: Record<string, number>;
  // Optional human-readable note appended to the markdown row.
  note?: string;
}

// ----- Shared scenario building blocks -----

function buildAnimationManifest(): SpriteSheetManifest {
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

interface SpriteWorld {
  world: World;
  device: HeadlessDevice;
  entities: EntityId[];
  input: InputManager;
}

function buildSpriteWorld(opts: {
  entityCount: number;
  tintedFraction: number;
  withAnimation: boolean;
  withRender: boolean;
}): SpriteWorld {
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

  world.addSystem(new InputSystem(), SYSTEM_PHASE_INPUT);
  if (opts.withAnimation) {
    world.addSystem(new AnimationSystem(), SYSTEM_PHASE_ANIMATION);
  }
  if (opts.withRender) {
    world.addSystem(new SpriteRenderSystem(), SYSTEM_PHASE_RENDER);
  }

  const manifest = buildAnimationManifest();
  const tintedCount = Math.round(opts.entityCount * opts.tintedFraction);
  const entities: EntityId[] = [];
  for (let i = 0; i < opts.entityCount; i++) {
    const e = world.createEntity();
    entities.push(e);
    // Distribute across a 32-wide grid so depth-sort sees varied keys.
    const x = (i % 32);
    const y = Math.floor(i / 32);
    transforms.attach(e, x, y, 0);
    if (i < tintedCount) {
      sprites.attach(e, 0, 0, COLOR_KNOT_INT);
    } else {
      sprites.attach(e, 0, 0);
    }
    if (opts.withAnimation) {
      animations.play(e, manifest, 'walk');
    }
  }
  return { world, device, entities, input };
}

// runFrameLoop drives a built world for the requested frames, sampling
// per-frame elapsed ms and tracking a peak-heap-above-baseline so heap
// pressure across the run shows up in the report. dt is fixed at 1/60.
function runFrameLoop(opts: {
  world: World;
  device: HeadlessDevice;
  input?: InputManager;
  frames: number;
  warmup: number;
  heap: HeapHelper;
}): { samples: number[]; peakHeapAboveBaselineKb: number | null; heapDeltaKb: number | null } {
  const dt = 1 / 60;

  let heapBefore: number | null = null;
  let heapAfter: number | null = null;
  if (opts.heap.available) {
    opts.heap.forceGc();
    heapBefore = opts.heap.heapUsedBytes();
  }

  if (opts.input) {
    opts.input.injectKeyDown('KeyD');
  }

  for (let i = 0; i < opts.warmup; i++) {
    opts.device.beginFrame();
    opts.world.update(dt);
    opts.device.endFrame();
  }

  let peakHeapKb: number | null = null;
  let warmupBaselineHeap: number | null = null;
  if (opts.heap.available) {
    warmupBaselineHeap = opts.heap.heapUsedBytes();
    peakHeapKb = 0;
  }

  const samples: number[] = new Array(opts.frames);
  let heldKey: 'KeyD' | 'KeyA' | 'KeyW' | 'KeyS' = 'KeyD';
  for (let i = 0; i < opts.frames; i++) {
    if (opts.input && i > 0 && i % 90 === 0) {
      opts.input.injectKeyUp(heldKey);
      const cycle = (['KeyD', 'KeyS', 'KeyA', 'KeyW'] as const)[((i / 90) | 0) % 4];
      heldKey = cycle ?? 'KeyD';
      opts.input.injectKeyDown(heldKey);
    }
    const t0 = nowMs();
    opts.device.beginFrame();
    opts.world.update(dt);
    opts.device.endFrame();
    samples[i] = nowMs() - t0;
    if (warmupBaselineHeap != null && peakHeapKb != null && i % 60 === 0) {
      const cur = opts.heap.heapUsedBytes();
      const aboveKb = (cur - warmupBaselineHeap) / 1024;
      if (aboveKb > peakHeapKb) peakHeapKb = aboveKb;
    }
  }

  if (opts.heap.available) {
    opts.heap.forceGc();
    heapAfter = opts.heap.heapUsedBytes();
  }
  const heapDeltaKb = heapBefore != null && heapAfter != null
    ? Math.round((heapAfter - heapBefore) / 1024)
    : null;

  return {
    samples,
    peakHeapAboveBaselineKb: peakHeapKb != null ? Math.round(peakHeapKb) : null,
    heapDeltaKb,
  };
}

// ----- Scenario 1: Sprite count scaling -----

export const SPRITE_SCALING_DEFAULT_COUNTS = [100, 1000, 5000, 10000, 50000];

export function runSpriteScaling(opts: {
  entityCount: number;
  frames: number;
  warmup: number;
  heap: HeapHelper;
  tintedFraction?: number;
}): ScenarioResult {
  const tintedFraction = opts.tintedFraction ?? 0.5;
  const built = buildSpriteWorld({
    entityCount: opts.entityCount,
    tintedFraction,
    withAnimation: true,
    withRender: true,
  });
  const loop = runFrameLoop({
    world: built.world,
    device: built.device,
    input: built.input,
    frames: opts.frames,
    warmup: opts.warmup,
    heap: opts.heap,
  });
  return {
    scenarioId: 'sprite-scaling',
    variant: 'entities=' + opts.entityCount,
    config: {
      entityCount: opts.entityCount,
      tintedFraction,
      frames: opts.frames,
      warmup: opts.warmup,
    },
    stats: summarize(loop.samples),
    drawCallsPerFrame: built.device.getDrawCallCount(),
    heapDeltaKb: loop.heapDeltaKb,
    peakHeapAboveBaselineKb: loop.peakHeapAboveBaselineKb,
  };
}

// ----- Scenario 2: Animation count scaling -----
//
// Same world build, but render system stripped so the per-tick cost
// is dominated by AnimationSystem alone. The point: separate "what
// does the animation pool cost" from "what does drawSprite cost".

export const ANIMATION_SCALING_DEFAULT_COUNTS = [1000, 5000, 10000, 50000];

export function runAnimationScaling(opts: {
  entityCount: number;
  frames: number;
  warmup: number;
  heap: HeapHelper;
}): ScenarioResult {
  const built = buildSpriteWorld({
    entityCount: opts.entityCount,
    tintedFraction: 0,        // tinted unused without render
    withAnimation: true,
    withRender: false,
  });
  const loop = runFrameLoop({
    world: built.world,
    device: built.device,
    input: built.input,
    frames: opts.frames,
    warmup: opts.warmup,
    heap: opts.heap,
  });
  return {
    scenarioId: 'animation-scaling',
    variant: 'entities=' + opts.entityCount,
    config: {
      entityCount: opts.entityCount,
      frames: opts.frames,
      warmup: opts.warmup,
    },
    stats: summarize(loop.samples),
    heapDeltaKb: loop.heapDeltaKb,
    peakHeapAboveBaselineKb: loop.peakHeapAboveBaselineKb,
  };
}

// ----- Scenario 3: Particle stress -----
//
// One emitter entity continuously spawning at `rate` particles/sec.
// We measure the per-frame cost of (emitter -> simulation -> render).
// Sweep `rate` to find the cliff. Pool's hard cap is set by the
// VeilBudget; we set particleBudget == max so the cap never clamps
// the test.

export const PARTICLE_STRESS_DEFAULT_BUDGETS = [500, 1000, 2000, 4000, 8000];

export function runParticleStress(opts: {
  particleBudget: number;
  frames: number;
  warmup: number;
  heap: HeapHelper;
}): ScenarioResult {
  const world = new World();
  const device = new HeadlessDevice();
  const camera = createCamera(640, 400);
  const time = createTimeResource();
  const veilBudget = createVeilBudgetResource();
  veilBudget.particleBudget = opts.particleBudget;
  world.resources.set(RESOURCE_TIME, time);
  world.resources.set(RESOURCE_CAMERA, camera);
  world.resources.set(RESOURCE_DEVICE, device);
  world.resources.set(RESOURCE_VEIL_BUDGET, veilBudget);

  const transforms = new TransformPool();
  const emitters = new ParticleEmitterPool();
  const particles = new ParticlePool(opts.particleBudget, opts.particleBudget);
  world.registerPool(POOL_TRANSFORM, transforms);
  world.registerPool(POOL_EMITTER, emitters);
  world.registerPool(POOL_PARTICLE, particles);

  world.addSystem(new ParticleEmitterSystem(), SYSTEM_PHASE_LOGIC);
  world.addSystem(new ParticleSimulationSystem(), SYSTEM_PHASE_PHYSICS);
  world.addSystem(new ParticleRenderSystem(), SYSTEM_PHASE_RENDER);

  // One emitter that fires fast enough to keep the pool saturated.
  // particleLife=1.0s and rate=particleBudget gives steady-state ~budget.
  const emitter = world.createEntity();
  transforms.attach(emitter, 0, 0, 0);
  const cfg: EmitterConfig = {
    rate: opts.particleBudget,
    particleLife: 1.0,
    speedMin: 0.5,
    speedMax: 2.0,
    dirX: 0, dirY: 1, dirZ: 0,
    coneRadians: Math.PI / 2,
    ax: 0, ay: -0.5, az: 0,
    startSize: 4, endSize: 1,
    startColor: { r: 1, g: 0.6, b: 0.2, a: 1 },
    endColor: { r: 1, g: 0.2, b: 0.0, a: 0 },
    additive: true,
  };
  emitters.attach(emitter, cfg);

  const loop = runFrameLoop({
    world, device, frames: opts.frames, warmup: opts.warmup, heap: opts.heap,
  });

  const liveCount = particles.getLiveCount();
  return {
    scenarioId: 'particle-stress',
    variant: 'budget=' + opts.particleBudget,
    config: {
      particleBudget: opts.particleBudget,
      frames: opts.frames,
      warmup: opts.warmup,
    },
    stats: summarize(loop.samples),
    drawCallsPerFrame: device.getDrawCallCount(),
    heapDeltaKb: loop.heapDeltaKb,
    peakHeapAboveBaselineKb: loop.peakHeapAboveBaselineKb,
    customMetrics: {
      liveParticlesAtEnd: liveCount,
      poolHighWaterMark: particles.getHighWaterMark(),
    },
  };
}

// ----- Scenario 4: SSE event drain -----
//
// MockDirectorBridge enqueues N events per frame; DirectorSystem
// drains them. Sweep N to find the events/sec the system handles
// before frame budget burns. Each event is a synthesized
// ve.budget.update (cheap) - this isolates per-event drain cost
// from any encounter spawn / palette fade work.

export const SSE_DRAIN_DEFAULT_RATES = [10, 50, 100, 500, 1000];

function makeBudgetEvent(id: number): DirectorEvent {
  const tier = (id % 3 === 0 ? 'green' : id % 3 === 1 ? 'amber' : 'red') as 'green' | 'amber' | 'red';
  const tierPrev = (id % 3 === 1 ? 'green' : id % 3 === 2 ? 'amber' : 'red') as 'green' | 'amber' | 'red';
  return {
    id,
    ts: 1000 + id,
    type: 've.budget.update',
    character_id: 'bench',
    encounter_id: null,
    priority: 'P1',
    data: {
      ve_remaining_month: 10000 - (id % 1000),
      ve_ceiling_month: 10000,
      tier,
      tier_prev: tierPrev,
      encounter_budget_ve: 200,
      encounter_budget_usd: 2.00,
    },
  };
}

export function runSseDrain(opts: {
  eventsPerFrame: number;
  frames: number;
  warmup: number;
  heap: HeapHelper;
}): ScenarioResult {
  const world = new World();
  const device = new HeadlessDevice();
  const time = createTimeResource();
  const camera = createCamera(640, 400);
  const veilBudget = createVeilBudgetResource();
  const bridge = new MockDirectorBridge();
  const knotCtx = new KnotContextResource();
  const log = createDirectorEventLog();
  bridge.start();

  world.resources.set(RESOURCE_TIME, time);
  world.resources.set(RESOURCE_CAMERA, camera);
  world.resources.set(RESOURCE_DEVICE, device);
  world.resources.set(RESOURCE_VEIL_BUDGET, veilBudget);
  world.resources.set(RESOURCE_DIRECTOR_BRIDGE, bridge);
  world.resources.set(RESOURCE_KNOT_CONTEXT, knotCtx);
  world.resources.set(RESOURCE_DIRECTOR_LOG, log);

  world.addSystem(new DirectorSystem(), SYSTEM_PHASE_INPUT);

  const dt = 1 / 60;
  let nextId = 1;

  // Warmup with the same event load so the JIT sees real shapes.
  for (let i = 0; i < opts.warmup; i++) {
    for (let k = 0; k < opts.eventsPerFrame; k++) {
      bridge.enqueue(makeBudgetEvent(nextId++));
    }
    device.beginFrame();
    world.update(dt);
    device.endFrame();
  }

  let heapBefore: number | null = null;
  let heapAfter: number | null = null;
  if (opts.heap.available) {
    opts.heap.forceGc();
    heapBefore = opts.heap.heapUsedBytes();
  }

  const samples: number[] = new Array(opts.frames);
  for (let i = 0; i < opts.frames; i++) {
    for (let k = 0; k < opts.eventsPerFrame; k++) {
      bridge.enqueue(makeBudgetEvent(nextId++));
    }
    const t0 = nowMs();
    device.beginFrame();
    world.update(dt);
    device.endFrame();
    samples[i] = nowMs() - t0;
  }

  if (opts.heap.available) {
    opts.heap.forceGc();
    heapAfter = opts.heap.heapUsedBytes();
  }
  const heapDeltaKb = heapBefore != null && heapAfter != null
    ? Math.round((heapAfter - heapBefore) / 1024)
    : null;

  const stats = summarize(samples);
  return {
    scenarioId: 'sse-drain',
    variant: 'eventsPerFrame=' + opts.eventsPerFrame,
    config: {
      eventsPerFrame: opts.eventsPerFrame,
      frames: opts.frames,
      warmup: opts.warmup,
    },
    stats,
    heapDeltaKb,
    customMetrics: {
      eventsApplied: log.eventsApplied,
      eventsPerSecAtMean: opts.eventsPerFrame * (1000 / Math.max(0.001, stats.meanMs)),
    },
  };
}

// ----- Scenario 5: ECS pool iteration cost -----
//
// Pure read-sweep over a TransformPool. World.query does not exist;
// systems iterate pool arrays directly. The cost we want is "how much
// does iterating N transforms cost per frame, ignoring everything
// else." Sum x+y+z to defeat dead-store elimination.

export const ECS_ITERATION_DEFAULT_COUNTS = [1000, 10000, 100000];

export function runEcsIteration(opts: {
  entityCount: number;
  iterations: number;
  heap: HeapHelper;
}): ScenarioResult {
  const world = new World();
  const transforms = new TransformPool();
  world.registerPool(POOL_TRANSFORM, transforms);
  for (let i = 0; i < opts.entityCount; i++) {
    const e = world.createEntity();
    transforms.attach(e, i % 256, (i / 256) | 0, (i % 32) * 0.1);
  }

  // Warmup
  let warmupAccum = 0;
  for (let k = 0; k < 50; k++) {
    for (let i = 0; i < opts.entityCount; i++) {
      warmupAccum += (transforms.x[i] ?? 0) + (transforms.y[i] ?? 0) + (transforms.z[i] ?? 0);
    }
  }
  // Touch warmupAccum so v8 doesn't dead-store the loop entirely.
  if (warmupAccum < -Number.MAX_VALUE) console.log('unreachable', warmupAccum);

  let heapBefore: number | null = null;
  if (opts.heap.available) {
    opts.heap.forceGc();
    heapBefore = opts.heap.heapUsedBytes();
  }

  const samples: number[] = new Array(opts.iterations);
  let accum = 0;
  for (let it = 0; it < opts.iterations; it++) {
    const t0 = nowMs();
    for (let i = 0; i < opts.entityCount; i++) {
      accum += (transforms.x[i] ?? 0) + (transforms.y[i] ?? 0) + (transforms.z[i] ?? 0);
    }
    samples[it] = nowMs() - t0;
  }
  if (accum < -Number.MAX_VALUE) console.log('unreachable', accum);

  let heapAfter: number | null = null;
  if (opts.heap.available) {
    opts.heap.forceGc();
    heapAfter = opts.heap.heapUsedBytes();
  }
  const heapDeltaKb = heapBefore != null && heapAfter != null
    ? Math.round((heapAfter - heapBefore) / 1024)
    : null;

  const stats = summarize(samples);
  return {
    scenarioId: 'ecs-iteration',
    variant: 'entities=' + opts.entityCount,
    config: {
      entityCount: opts.entityCount,
      iterations: opts.iterations,
    },
    stats,
    heapDeltaKb,
    customMetrics: {
      meanNsPerEntity: (stats.meanMs * 1_000_000) / Math.max(1, opts.entityCount),
    },
  };
}

// ----- Scenario 6: Asset load latency -----
//
// loadSpriteSheet with stub fetchImpl + stub decodeImage. We measure
// (a) the cold-cache parse + validate cost on first call, and (b) the
// warm path by calling the same loader N times; downstream callers
// typically cache the LoadedSpriteSheet so warm "load" is just a
// dictionary hit. We measure both halves so a regression in the
// validator shows up in the cold number, and a regression in the
// happy path shows up in the warm number.

const BENCH_MANIFEST_JSON = JSON.stringify({
  name: 'bench-knight',
  image: 'walk.png',
  frames: (function () {
    const out = [];
    for (let i = 0; i < 8; i++) {
      out.push({ x: i * 16, y: 0, w: 16, h: 32, name: 'walk_' + i, duration_ms: 100 });
    }
    return out;
  })(),
  anchor: { x: 8, y: 32 },
  fps: 8,
  clips: [{ name: 'walk', frames: [0, 1, 2, 3, 4, 5, 6, 7], loop: true }],
});

const BENCH_IMAGE_BYTES = new Uint8Array(64);

function makeStubFetch(): typeof fetch {
  return async function (
    input: RequestInfo | URL,
    _init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === 'string' ? input : (input as { url?: string }).url ?? '';
    if (url.endsWith('.json')) {
      return new Response(BENCH_MANIFEST_JSON, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(BENCH_IMAGE_BYTES, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  } as typeof fetch;
}

function makeStubDecode(): (bytes: ArrayBuffer, url: string) => Promise<HTMLImageElement> {
  return async function (_bytes, _url) {
    return { width: 128, height: 32 } as HTMLImageElement;
  };
}

export async function runAssetLoad(opts: {
  iterations: number;
  heap: HeapHelper;
}): Promise<ScenarioResult> {
  const fetchImpl = makeStubFetch();
  const decodeImage = makeStubDecode();
  const url = 'https://bench.invalid/knight/walk.json';

  // Cold: first call. Includes manifest validation + image decode.
  const coldT0 = nowMs();
  await loadSpriteSheet(url, { fetchImpl, decodeImage });
  const coldMs = nowMs() - coldT0;

  // Warm: N additional calls, same stubs. Measures steady-state
  // loader cost; downstream cache (which is the caller's job, not
  // the loader's) is NOT in the path here.
  let heapBefore: number | null = null;
  if (opts.heap.available) {
    opts.heap.forceGc();
    heapBefore = opts.heap.heapUsedBytes();
  }
  const samples: number[] = new Array(opts.iterations);
  for (let i = 0; i < opts.iterations; i++) {
    const t0 = nowMs();
    await loadSpriteSheet(url, { fetchImpl, decodeImage });
    samples[i] = nowMs() - t0;
  }
  let heapAfter: number | null = null;
  if (opts.heap.available) {
    opts.heap.forceGc();
    heapAfter = opts.heap.heapUsedBytes();
  }
  const heapDeltaKb = heapBefore != null && heapAfter != null
    ? Math.round((heapAfter - heapBefore) / 1024)
    : null;
  const stats = summarize(samples);

  return {
    scenarioId: 'asset-load',
    variant: 'iterations=' + opts.iterations,
    config: {
      iterations: opts.iterations,
    },
    stats,
    heapDeltaKb,
    customMetrics: {
      coldLoadMs: coldMs,
      warmMeanMs: stats.meanMs,
      coldOverWarmRatio: coldMs / Math.max(0.001, stats.meanMs),
    },
    note: 'stub fetch + stub decode; measures loader code path only',
  };
}

// ----- Scenario 7: Memory under sustained load -----
//
// Run the medium sprite scenario for a longer window (default 60s
// at 60fps = 3600 frames). Heap is sampled every 60 frames; we
// report peak above the post-warmup baseline. This is the metric
// that maps to "how much pressure does the alloc churn put on the
// GC during a real session." Residual heap after a final GC is
// uninteresting - what matters is peak BETWEEN collections.

export function runMemorySustained(opts: {
  entityCount: number;
  durationFrames: number;
  warmup: number;
  heap: HeapHelper;
}): ScenarioResult {
  const built = buildSpriteWorld({
    entityCount: opts.entityCount,
    tintedFraction: 0.5,
    withAnimation: true,
    withRender: true,
  });
  const loop = runFrameLoop({
    world: built.world,
    device: built.device,
    input: built.input,
    frames: opts.durationFrames,
    warmup: opts.warmup,
    heap: opts.heap,
  });
  return {
    scenarioId: 'memory-sustained',
    variant: 'entities=' + opts.entityCount + ',frames=' + opts.durationFrames,
    config: {
      entityCount: opts.entityCount,
      durationFrames: opts.durationFrames,
      warmup: opts.warmup,
    },
    stats: summarize(loop.samples),
    heapDeltaKb: loop.heapDeltaKb,
    peakHeapAboveBaselineKb: loop.peakHeapAboveBaselineKb,
    note: opts.heap.available
      ? 'heap sampled every 60 frames, residual after final GC reported as heapDeltaKb'
      : 'heap stats unavailable in this runtime (run Node with --expose-gc for these fields)',
  };
}

// ----- Legacy: tint alloc churn -----
//
// Phase 9.1 microbench. Preserved so cross-version comparisons stay
// stable across the 0.11 -> 0.12 release. Wraps the same logic as
// the original perf-bench main but returns the normalized
// ScenarioResult shape.

export function runTintAllocChurn(opts: {
  ticks: number;
  warmup: number;
  heap: HeapHelper;
}): ScenarioResult {
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

  world.addSystem(new SpriteRenderSystem(), SYSTEM_PHASE_RENDER);

  const N = 100;
  for (let i = 0; i < N; i++) {
    const e = world.createEntity();
    transforms.attach(e, i % 16, (i / 16) | 0, 0);
    sprites.attach(e, 0, 0, COLOR_KNOT_INT);
  }

  let heapBefore: number | null = null;
  if (opts.heap.available) {
    opts.heap.forceGc();
    heapBefore = opts.heap.heapUsedBytes();
  }

  for (let i = 0; i < opts.warmup; i++) {
    device.beginFrame();
    world.update(1 / 60);
    device.endFrame();
  }

  const t0 = nowMs();
  for (let i = 0; i < opts.ticks; i++) {
    device.beginFrame();
    world.update(1 / 60);
    device.endFrame();
  }
  const elapsed = nowMs() - t0;

  let heapAfter: number | null = null;
  if (opts.heap.available) {
    opts.heap.forceGc();
    heapAfter = opts.heap.heapUsedBytes();
  }
  const heapDeltaKb = heapBefore != null && heapAfter != null
    ? Math.round((heapAfter - heapBefore) / 1024)
    : null;

  const meanMs = elapsed / Math.max(1, opts.ticks);
  return {
    scenarioId: 'tint-alloc-churn',
    variant: 'ticks=' + opts.ticks,
    config: {
      ticks: opts.ticks,
      tintedSprites: N,
      warmup: opts.warmup,
    },
    customMetrics: {
      meanMsPerTick: meanMs,
      bytesPerTick: heapDeltaKb != null ? (heapDeltaKb * 1024) / opts.ticks : 0,
    },
    heapDeltaKb,
    note: 'preserved from Phase 9.1; isolates SpriteRenderSystem tinted-path alloc churn',
  };
}

// ----- Suite catalog -----
//
// Keys here are the canonical scenario ids. CLI consumers can filter
// the run by passing names through BENCH_SCENARIOS. The runner is
// responsible for fanning out variants (e.g. sprite-scaling -> 5
// distinct entity counts each producing a ScenarioResult).

export const SCENARIO_IDS = [
  'sprite-scaling',
  'animation-scaling',
  'particle-stress',
  'sse-drain',
  'ecs-iteration',
  'asset-load',
  'memory-sustained',
  'tint-alloc-churn',
] as const;

export type ScenarioId = typeof SCENARIO_IDS[number];

export function isScenarioId(s: string): s is ScenarioId {
  return (SCENARIO_IDS as readonly string[]).indexOf(s) >= 0;
}
