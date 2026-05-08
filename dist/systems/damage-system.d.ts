import type { System } from '../system.js';
import type { World } from '../world.js';
export interface KillEvent {
    entityIndex: number;
    killerIndex: number | null;
    atMs: number;
}
export declare class DeathLog {
    recent: KillEvent[];
    totalKills: number;
    static readonly MAX_KILLS = 64;
}
export declare const RESOURCE_DEATH_LOG = "death_log";
export declare class DamageSystem implements System {
    readonly name: string;
    update(world: World, _dt: number): void;
}
//# sourceMappingURL=damage-system.d.ts.map