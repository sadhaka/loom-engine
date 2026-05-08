import type { World } from './world.js';
export interface System {
    readonly name: string;
    update(world: World, dt: number): void;
}
export declare const SYSTEM_PHASE_INPUT = 0;
export declare const SYSTEM_PHASE_LOGIC = 1;
export declare const SYSTEM_PHASE_PHYSICS = 2;
export declare const SYSTEM_PHASE_ANIMATION = 3;
export declare const SYSTEM_PHASE_RENDER = 4;
export declare const SYSTEM_PHASE_POST_RENDER = 5;
export type SystemPhase = typeof SYSTEM_PHASE_INPUT | typeof SYSTEM_PHASE_LOGIC | typeof SYSTEM_PHASE_PHYSICS | typeof SYSTEM_PHASE_ANIMATION | typeof SYSTEM_PHASE_RENDER | typeof SYSTEM_PHASE_POST_RENDER;
export declare const SYSTEM_PHASES_IN_ORDER: ReadonlyArray<SystemPhase>;
//# sourceMappingURL=system.d.ts.map