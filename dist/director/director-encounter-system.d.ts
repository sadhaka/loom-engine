import type { System } from '../system.js';
import type { World } from '../world.js';
import type { AtlasHandle } from '../renderer/graphics-device.js';
import type { EntityId } from '../entity.js';
export interface DirectorEncounterSystemOptions {
    player: EntityId;
    mobAtlas: AtlasHandle;
    onEncounterStarted?: (encounterId: string, mobCount: number, narratorLine: string | null) => void;
}
export declare class DirectorEncounterSystem implements System {
    readonly name: string;
    private handled;
    private opts;
    constructor(opts: DirectorEncounterSystemOptions);
    update(world: World, _dt: number): void;
    private spawnEncounter;
    private spawnOne;
    clearHandled(): void;
    hasHandled(encounterId: string): boolean;
}
//# sourceMappingURL=director-encounter-system.d.ts.map