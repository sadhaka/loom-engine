import type { System } from '../../system.js';
import type { World } from '../../world.js';
export declare class ZoneBossEntitySystem implements System {
    readonly name: string;
    private readonly cursors;
    update(world: World, _dt: number): void;
    cursorFor(zoneId: string): number;
}
//# sourceMappingURL=zone-boss-entity-system.d.ts.map