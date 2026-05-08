import type { System } from '../system.js';
import type { World } from '../world.js';
import { type EntityId } from '../entity.js';
export interface AttackSystemOptions {
    damage: number;
    range: number;
    player: EntityId;
}
export declare class AttackSystem implements System {
    private opts;
    readonly name: string;
    lastTargetIndex: number;
    lastDamageApplied: number;
    constructor(opts: AttackSystemOptions);
    update(world: World, _dt: number): void;
}
//# sourceMappingURL=attack-system.d.ts.map