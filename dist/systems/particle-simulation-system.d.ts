import type { System } from '../system.js';
import type { World } from '../world.js';
export declare const POOL_PARTICLE = "particle";
export declare class ParticleSimulationSystem implements System {
    readonly name: string;
    update(world: World, dt: number): void;
}
//# sourceMappingURL=particle-simulation-system.d.ts.map