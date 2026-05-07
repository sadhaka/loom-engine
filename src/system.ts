// System interface for the Loom Engine ECS.
//
// A System is just a function-with-name. Systems run in registration
// order, single-threaded, deterministic. No parallel scheduler in v1
// (Bevy-style work-stealing is post-funding).
//
// Systems read/write component pools and resources. They're registered
// with World.addSystem and run via World.update(dt).

import type { World } from './world.js';

export interface System {
  // Human-readable name. Surfaced in profiling tools and error
  // messages.
  readonly name: string;
  // Called once per frame. dt is the seconds-since-last-tick.
  update(world: World, dt: number): void;
}

// System lifecycle phase. The scheduler runs phases in this order
// every tick. Within a phase, systems run in registration order.
export const SYSTEM_PHASE_INPUT = 0;
export const SYSTEM_PHASE_LOGIC = 1;
export const SYSTEM_PHASE_PHYSICS = 2;
export const SYSTEM_PHASE_ANIMATION = 3;
export const SYSTEM_PHASE_RENDER = 4;
export const SYSTEM_PHASE_POST_RENDER = 5;
export type SystemPhase =
  | typeof SYSTEM_PHASE_INPUT
  | typeof SYSTEM_PHASE_LOGIC
  | typeof SYSTEM_PHASE_PHYSICS
  | typeof SYSTEM_PHASE_ANIMATION
  | typeof SYSTEM_PHASE_RENDER
  | typeof SYSTEM_PHASE_POST_RENDER;

export const SYSTEM_PHASES_IN_ORDER: ReadonlyArray<SystemPhase> = [
  SYSTEM_PHASE_INPUT,
  SYSTEM_PHASE_LOGIC,
  SYSTEM_PHASE_PHYSICS,
  SYSTEM_PHASE_ANIMATION,
  SYSTEM_PHASE_RENDER,
  SYSTEM_PHASE_POST_RENDER,
];
