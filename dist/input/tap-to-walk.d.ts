import type { System } from '../system.js';
import type { World } from '../world.js';
export interface TapWalkTargetResource {
    x: number;
    y: number;
    active: boolean;
    frameSet: number;
}
export declare const RESOURCE_TAP_WALK: 'tap_walk';
export declare function createTapWalkTarget(): TapWalkTargetResource;
export interface TapToWalkSystemOptions {
    moveThresholdPx?: number;
    maxFrames?: number;
}
export declare class TapToWalkSystem implements System {
    readonly name: string;
    private inFlight;
    private moveThresholdSq;
    private maxFrames;
    private scratchA;
    private scratchB;
    constructor(opts?: TapToWalkSystemOptions);
    update(world: World, _dt: number): void;
    private publishTarget;
    resetInFlight(): void;
}
//# sourceMappingURL=tap-to-walk.d.ts.map