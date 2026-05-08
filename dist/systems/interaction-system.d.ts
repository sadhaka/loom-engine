import type { System } from '../system.js';
import type { World } from '../world.js';
import { type InteractableKind } from '../components/interactable.js';
import { type EntityId } from '../entity.js';
export interface LastInteractionResource {
    entityIndex: number;
    atFrame: number;
    kind: InteractableKind;
    payload: string;
    prompt: string;
}
export declare function createLastInteraction(): LastInteractionResource;
export declare const RESOURCE_LAST_INTERACTION = "last_interaction";
export interface InteractionSystemOptions {
    player: EntityId;
}
export declare class InteractionSystem implements System {
    private opts;
    readonly name: string;
    constructor(opts: InteractionSystemOptions);
    update(world: World, _dt: number): void;
}
//# sourceMappingURL=interaction-system.d.ts.map