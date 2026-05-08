// Loom Engine - headless tick harness.
//
// Pure Node, no DOM, no WebGL, no requestAnimationFrame. Spins up the
// raw ECS World, pre-registers the same default pools + the most
// commonly-needed resources that Engine.create wires (minus device,
// audio, input, camera), and exposes a tiny tick() driver so tests can
// pump deterministic frames at a fixed timestep.
//
// Why this exists:
//   - Engine.create depends on Canvas2DDevice (constructs from an
//     HTMLCanvasElement). Tests that just want to exercise game logic
//     should not need jsdom or a fake canvas.
//   - tests/trace-replay (item E2) and tests/fuzzer (item E4) feed
//     synthetic event streams into the system layer at a controlled
//     cadence. They need a tickable World, not the full Engine.
//
// API:
//   const ticker = createHeadlessTicker({ tps: 60 });
//   ticker.addSystem(sys, SYSTEM_PHASE_INPUT);
//   ticker.tick(60);                  // 60 fixed-step frames
//   const w = ticker.getWorld();
//   ticker.reset();                   // back to a fresh world + state
//
// This is a TEST harness file - modern TS / arrow fns / etc. allowed
// per CLAUDE.md "Tests can use modern JS".

import {
  World,
  POOL_TRANSFORM,
  POOL_SPRITE,
  TransformPool,
  SpritePool,
  AnimationStatePool,
  ParticlePool,
  ParticleEmitterPool,
  HealthPool,
  PursuePool,
  RangedAttackPool,
  ProjectilePool,
  InteractablePool,
  POOL_HEALTH,
  POOL_PURSUE,
  POOL_RANGED,
  POOL_PROJECTILE,
  POOL_INTERACTABLE,
  DeathLog,
  RESOURCE_DEATH_LOG,
  KnotContextResource,
  RESOURCE_KNOT_CONTEXT,
  createDirectorEventLog,
  RESOURCE_DIRECTOR_LOG,
  createZoneEventLog,
  RESOURCE_ZONE_EVENT_LOG,
  createDirectorZoneStateResource,
  RESOURCE_DIRECTOR_ZONE_STATE,
  createZoneState,
  RESOURCE_ZONE_STATE,
  createTimeResource,
  RESOURCE_TIME,
  type TimeResource,
  createVeilBudgetResource,
  RESOURCE_VEIL_BUDGET,
  createZoneBossEntityResource,
  RESOURCE_ZONE_BOSS_ENTITY,
  type System,
  type SystemPhase,
} from '../src/index.js';

import { POOL_ANIMATION } from '../src/systems/animation-system.js';
import { POOL_PARTICLE } from '../src/systems/particle-simulation-system.js';
import { POOL_EMITTER } from '../src/systems/particle-emitter-system.js';

const DEFAULT_TPS = 60;

export interface HeadlessTickerOptions {
  tps?: number;
}

export interface HeadlessTicker {
  getWorld(): World;
  getDeltaSeconds(): number;
  getFrame(): number;
  addSystem(sys: System, phase: SystemPhase): void;
  tick(n?: number): void;
  reset(): void;
}

function buildWorld(): World {
  const world = new World();
  // Pools - mirror Engine.create's set, minus the device-bound ones.
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
  // Resources - the ones engine logic depends on, minus device / audio /
  // input which are browser-bound.
  world.resources.set(RESOURCE_TIME, createTimeResource());
  world.resources.set(RESOURCE_VEIL_BUDGET, createVeilBudgetResource());
  world.resources.set(RESOURCE_KNOT_CONTEXT, new KnotContextResource());
  world.resources.set(RESOURCE_DIRECTOR_LOG, createDirectorEventLog());
  world.resources.set(RESOURCE_ZONE_EVENT_LOG, createZoneEventLog());
  world.resources.set(RESOURCE_DIRECTOR_ZONE_STATE, createDirectorZoneStateResource());
  world.resources.set(RESOURCE_ZONE_BOSS_ENTITY, createZoneBossEntityResource());
  world.resources.set(RESOURCE_ZONE_STATE, createZoneState());
  world.resources.set(RESOURCE_DEATH_LOG, new DeathLog());
  return world;
}

export function createHeadlessTicker(opts: HeadlessTickerOptions = {}): HeadlessTicker {
  const tps = typeof opts.tps === 'number' && opts.tps > 0 ? opts.tps : DEFAULT_TPS;
  const dtSeconds = 1 / tps;
  let world = buildWorld();
  let frameCount = 0;
  // Track systems registered by the consumer so reset() can re-register
  // them onto the new world.
  const registered: { sys: System; phase: SystemPhase }[] = [];

  return {
    getWorld() {
      return world;
    },
    getDeltaSeconds() {
      return dtSeconds;
    },
    getFrame() {
      return frameCount;
    },
    addSystem(sys: System, phase: SystemPhase) {
      registered.push({ sys, phase });
      world.addSystem(sys, phase);
    },
    tick(n?: number) {
      // Default arg = 1; explicit non-finite / negative also treated
      // as 1; explicit 0 is a no-op.
      let count: number;
      if (n === undefined) {
        count = 1;
      } else if (typeof n === 'number' && Number.isFinite(n) && n >= 0) {
        count = Math.floor(n);
      } else {
        count = 1;
      }
      const time = world.resources.require<TimeResource>(RESOURCE_TIME);
      for (let i = 0; i < count; i++) {
        time.delta = dtSeconds;
        time.elapsed += dtSeconds;
        time.frame += 1;
        world.update(dtSeconds);
        frameCount += 1;
      }
    },
    reset() {
      world = buildWorld();
      frameCount = 0;
      for (let i = 0; i < registered.length; i++) {
        const r = registered[i]!;
        world.addSystem(r.sys, r.phase);
      }
    },
  };
}
