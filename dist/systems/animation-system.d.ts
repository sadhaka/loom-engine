import type { System } from '../system.js';
import type { World } from '../world.js';
export declare const POOL_ANIMATION = "animation";
export declare class AnimationSystem implements System {
    readonly name: string;
    update(world: World, dt: number): void;
}
//# sourceMappingURL=animation-system.d.ts.map