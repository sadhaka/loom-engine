// Engine - the top-level facade for the Loom Engine.
//
// One Engine instance per running game. Owns the device, world,
// camera, time. Consumers call Engine.create({canvas}) to spin up,
// engine.tick(now) once per RAF, and engine.dispose() on teardown.
//
// The Engine wires the default resource set:
//   - 'time': TimeResource
//   - 'camera': CameraView
//   - 'device': IGraphicsDevice
// And the default pools:
//   - 'transform': TransformPool
//   - 'sprite': SpritePool
// Plus the default render system: SpriteRenderSystem in
// SYSTEM_PHASE_RENDER.
//
// Higher-level layers (Director-bridge in Phase 6, ARPG in Phase 8)
// register their own systems and pools on top.

import { Canvas2DDevice } from './renderer/canvas2d-device.js';
import type { IGraphicsDevice } from './renderer/graphics-device.js';
import { createCamera, type CameraView } from './renderer/camera.js';
import { World, POOL_TRANSFORM, POOL_SPRITE } from './world.js';
import { TransformPool } from './components/transform.js';
import { SpritePool } from './components/sprite.js';
import { AnimationStatePool } from './animation/animation-state-pool.js';
import { POOL_ANIMATION } from './systems/animation-system.js';
import { ParticlePool } from './vfx/particle-pool.js';
import { ParticleEmitterPool } from './components/particle-emitter.js';
import { POOL_PARTICLE } from './systems/particle-simulation-system.js';
import { POOL_EMITTER } from './systems/particle-emitter-system.js';
import {
  createVeilBudgetResource,
  RESOURCE_VEIL_BUDGET,
} from './resources.js';
import {
  RESOURCE_TIME,
  RESOURCE_CAMERA,
  RESOURCE_DEVICE,
  createTimeResource,
  type TimeResource,
} from './resources.js';
import { clamp } from './util/math.js';

export interface EngineOptions {
  canvas: HTMLCanvasElement;
}

// Max delta clamp. Long pauses (background tab, breakpoint) shouldn't
// produce one giant dt that breaks physics. 1/30s is the spec frame
// loop guidance.
const MAX_DT_SECONDS = 1 / 30;

export class Engine {
  readonly device: IGraphicsDevice;
  readonly world: World;
  readonly camera: CameraView;

  private time: TimeResource;
  private prevTimeMs: number = 0;

  private constructor(device: IGraphicsDevice, world: World, camera: CameraView, time: TimeResource) {
    this.device = device;
    this.world = world;
    this.camera = camera;
    this.time = time;
  }

  // Constructs an Engine + default resources + default pools +
  // default render system. Caller registers their own systems
  // afterward via engine.world.addSystem.
  static create(opts: EngineOptions): Engine {
    const device = new Canvas2DDevice(opts.canvas);
    const camera = createCamera(opts.canvas.width, opts.canvas.height);
    const world = new World();
    const time = createTimeResource();

    // Resources
    world.resources.set(RESOURCE_TIME, time);
    world.resources.set(RESOURCE_CAMERA, camera);
    world.resources.set(RESOURCE_DEVICE, device);
    world.resources.set(RESOURCE_VEIL_BUDGET, createVeilBudgetResource());

    // Pools
    world.registerPool(POOL_TRANSFORM, new TransformPool());
    world.registerPool(POOL_SPRITE, new SpritePool());
    world.registerPool(POOL_ANIMATION, new AnimationStatePool());
    world.registerPool(POOL_PARTICLE, new ParticlePool());
    world.registerPool(POOL_EMITTER, new ParticleEmitterPool());

    // Systems are NOT pre-registered. Callers add their own render
    // and game logic systems explicitly, in the order they want.
    // This keeps the engine flexible: a demo registers
    // SpriteRenderSystem alone, an ARPG registers
    // [TileRender, SpriteRender, ParticleRender, UIRender] in that
    // order, etc.

    return new Engine(device, world, camera, time);
  }

  // One frame of work. Call from requestAnimationFrame.
  // - nowMs is performance.now() value (fractional milliseconds).
  // - First tick has dt = 0; subsequent ticks compute dt from
  //   the previous nowMs.
  tick(nowMs: number): void {
    let dt = 0;
    if (this.prevTimeMs > 0) {
      dt = clamp((nowMs - this.prevTimeMs) / 1000, 0, MAX_DT_SECONDS);
    }
    this.prevTimeMs = nowMs;

    this.time.delta = dt;
    this.time.elapsed += dt;
    this.time.frame += 1;

    this.device.beginFrame();
    this.world.update(dt);
    this.device.endFrame();
  }

  // Reset the time bookkeeping. Useful when resuming after a long
  // pause to avoid the first tick being a no-op due to MAX_DT_SECONDS
  // clamping to a tiny value. Hopefully rarely needed.
  resetTime(): void {
    this.prevTimeMs = 0;
    this.time.delta = 0;
    this.time.elapsed = 0;
    this.time.frame = 0;
  }

  dispose(): void {
    // Currently nothing to release. Atlases live on the device until
    // explicitly released via device.releaseAtlas. Future work: tear
    // down WebGL state, audio nodes, etc.
  }
}
