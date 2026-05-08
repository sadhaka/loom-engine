import type { System } from '../system.js';
import type { World } from '../world.js';
export declare const POOL_EMITTER = "emitter";
export declare class ParticleEmitterSystem implements System {
    readonly name: string;
    update(world: World, dt: number): void;
}
//# sourceMappingURL=particle-emitter-system.d.ts.map