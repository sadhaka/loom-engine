import type { System } from '../../system.js';
import type { World } from '../../world.js';
export interface ZoneEventSystemOptions {
    currentZone?: () => string | null;
    applyKnotToSharedContext?: boolean;
}
export declare class ZoneEventSystem implements System {
    readonly name: string;
    private readonly currentZone;
    private readonly applyKnotToSharedContext;
    constructor(opts?: ZoneEventSystemOptions);
    update(world: World, _dt: number): void;
}
//# sourceMappingURL=zone-event-system.d.ts.map