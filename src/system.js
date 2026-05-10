// System interface for the Loom Engine ECS.
//
// A System is just a function-with-name. Systems run in registration
// order, single-threaded, deterministic. No parallel scheduler in v1
// (Bevy-style work-stealing is post-funding).
//
// Systems read/write component pools and resources. They're registered
// with World.addSystem and run via World.update(dt).
// System lifecycle phase. The scheduler runs phases in this order
// every tick. Within a phase, systems run in registration order.
export const SYSTEM_PHASE_INPUT = 0;
export const SYSTEM_PHASE_LOGIC = 1;
export const SYSTEM_PHASE_PHYSICS = 2;
export const SYSTEM_PHASE_ANIMATION = 3;
export const SYSTEM_PHASE_RENDER = 4;
export const SYSTEM_PHASE_POST_RENDER = 5;
export const SYSTEM_PHASES_IN_ORDER = [
    SYSTEM_PHASE_INPUT,
    SYSTEM_PHASE_LOGIC,
    SYSTEM_PHASE_PHYSICS,
    SYSTEM_PHASE_ANIMATION,
    SYSTEM_PHASE_RENDER,
    SYSTEM_PHASE_POST_RENDER,
];
//# sourceMappingURL=system.js.map