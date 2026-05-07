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
import { HealthPool, POOL_HEALTH } from './components/health.js';
import { PursuePool, POOL_PURSUE } from './components/pursue.js';
import { DeathLog, RESOURCE_DEATH_LOG } from './systems/damage-system.js';
import { RangedAttackPool, POOL_RANGED } from './components/ranged-attack.js';
import { ProjectilePool, POOL_PROJECTILE } from './vfx/projectile-pool.js';
import { InteractablePool, POOL_INTERACTABLE } from './components/interactable.js';
import {
  createZoneState,
  RESOURCE_ZONE_STATE,
} from './zone/zone-state.js';
import {
  createLastInteraction,
  RESOURCE_LAST_INTERACTION,
} from './systems/interaction-system.js';
import {
  createVeilBudgetResource,
  RESOURCE_VEIL_BUDGET,
} from './resources.js';
import { AudioBus, RESOURCE_AUDIO_BUS } from './audio/audio-bus.js';
import {
  InputManager,
  RESOURCE_INPUT_MANAGER,
  RESOURCE_INPUT,
} from './input/input-manager.js';
import {
  createTapWalkTarget,
  RESOURCE_TAP_WALK,
} from './input/tap-to-walk.js';
import {
  RESOURCE_KNOT_CONTEXT,
} from './director/director-bridge.js';
import { KnotContextResource } from './director/knot-context-resource.js';
import {
  RESOURCE_DIRECTOR_LOG,
  createDirectorEventLog,
} from './director/director-system.js';
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
  // Optional Window for input listeners. Defaults to globalThis.window
  // when present. Tests pass a fake; non-DOM environments can pass
  // null to skip input attachment.
  inputWindow?: Window | null;
  // If true, Engine.create will NOT construct an AudioBus. Useful in
  // tests where AudioContext isn't available. Defaults to false in
  // browser, true in Node.
  skipAudio?: boolean;
}

// Max delta clamp. Long pauses (background tab, breakpoint) shouldn't
// produce one giant dt that breaks physics. 1/30s is the spec frame
// loop guidance.
const MAX_DT_SECONDS = 1 / 30;

export class Engine {
  readonly device: IGraphicsDevice;
  readonly world: World;
  readonly camera: CameraView;
  readonly input: InputManager;
  readonly audio: AudioBus | null;

  private time: TimeResource;
  private prevTimeMs: number = 0;

  private constructor(
    device: IGraphicsDevice,
    world: World,
    camera: CameraView,
    time: TimeResource,
    input: InputManager,
    audio: AudioBus | null,
  ) {
    this.device = device;
    this.world = world;
    this.camera = camera;
    this.time = time;
    this.input = input;
    this.audio = audio;
  }

  // Constructs an Engine + default resources + default pools +
  // default render system. Caller registers their own systems
  // afterward via engine.world.addSystem.
  static create(opts: EngineOptions): Engine {
    const device = new Canvas2DDevice(opts.canvas);
    const camera = createCamera(opts.canvas.width, opts.canvas.height);
    const world = new World();
    const time = createTimeResource();

    // Input manager - attached to the canvas so pointer events work.
    // Window defaults to globalThis.window when in a DOM context.
    const input = new InputManager();
    if (opts.inputWindow !== null) {
      const win = opts.inputWindow ?? (typeof window !== 'undefined' ? window : null);
      if (win) input.attach(opts.canvas, win);
    }

    // Audio bus - browser-only. In Node tests, opts.skipAudio = true
    // (or AudioContext is undefined) bypasses construction.
    let audio: AudioBus | null = null;
    const wantAudio = opts.skipAudio !== true && typeof AudioContext !== 'undefined';
    if (wantAudio) {
      try {
        audio = AudioBus.create();
      } catch {
        audio = null;
      }
    }

    // Resources
    world.resources.set(RESOURCE_TIME, time);
    world.resources.set(RESOURCE_CAMERA, camera);
    world.resources.set(RESOURCE_DEVICE, device);
    world.resources.set(RESOURCE_VEIL_BUDGET, createVeilBudgetResource());
    world.resources.set(RESOURCE_INPUT_MANAGER, input);
    world.resources.set(RESOURCE_INPUT, input.snapshot());
    world.resources.set(RESOURCE_TAP_WALK, createTapWalkTarget());
    if (audio) world.resources.set(RESOURCE_AUDIO_BUS, audio);

    // Director defaults. RESOURCE_DIRECTOR_BRIDGE is intentionally
    // NOT registered by Engine.create - the consumer chooses
    // MockDirectorBridge or SSEDirectorBridge based on whether they
    // have a backend. KnotContextResource defaults to Strknot palette;
    // DirectorEventLog ring buffer is empty until events arrive.
    world.resources.set(RESOURCE_KNOT_CONTEXT, new KnotContextResource());
    world.resources.set(RESOURCE_DIRECTOR_LOG, createDirectorEventLog());

    // Pools
    world.registerPool(POOL_TRANSFORM, new TransformPool());
    world.registerPool(POOL_SPRITE, new SpritePool());
    world.registerPool(POOL_ANIMATION, new AnimationStatePool());
    world.registerPool(POOL_PARTICLE, new ParticlePool());
    world.registerPool(POOL_EMITTER, new ParticleEmitterPool());
    world.registerPool(POOL_HEALTH, new HealthPool());
    world.registerPool(POOL_PURSUE, new PursuePool());
    world.registerPool(POOL_RANGED, new RangedAttackPool());
    world.registerPool(POOL_PROJECTILE, new ProjectilePool());
    world.registerPool(POOL_INTERACTABLE, new InteractablePool());
    world.resources.set(RESOURCE_DEATH_LOG, new DeathLog());
    world.resources.set(RESOURCE_ZONE_STATE, createZoneState());
    world.resources.set(RESOURCE_LAST_INTERACTION, createLastInteraction());

    // Systems are NOT pre-registered. Callers add their own systems
    // explicitly. The Phase 5 idiomatic order is:
    //   [InputSystem, VeilBudgetSystem] in PHASE_INPUT, then game
    //   logic, then PHASE_PHYSICS for sim, then PHASE_ANIMATION,
    //   then PHASE_RENDER. Demo wires this order.

    return new Engine(device, world, camera, time, input, audio);
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
    // Tear down listeners + audio nodes.
    this.input.detach();
    if (this.audio) this.audio.dispose();
  }
}
