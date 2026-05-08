import type { System } from '../system.js';
import type { World } from '../world.js';
import type { EntityId } from '../entity.js';
import type { SpatialAudioBus } from './spatial-audio-bus.js';
export declare class SpatialAudioSystem implements System {
    readonly name: string;
    private localCharacter;
    private spatialBus;
    constructor(opts?: {
        spatialBus?: SpatialAudioBus;
    });
    setSpatialBus(bus: SpatialAudioBus | null): void;
    setLocalCharacterEntity(entity: EntityId | null): void;
    getLocalCharacterEntity(): EntityId | null;
    update(world: World, _dt: number): void;
}
//# sourceMappingURL=spatial-audio-system.d.ts.map