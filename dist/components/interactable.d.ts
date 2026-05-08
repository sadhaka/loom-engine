import { type EntityId } from '../entity.js';
export declare const INTERACTABLE_FLAG_ACTIVE: number;
export type InteractableKind = 'npc' | 'portal' | 'lore' | 'item';
export interface InteractableConfig {
    kind: InteractableKind;
    prompt: string;
    payload: string;
    radius: number;
}
export declare class InteractablePool {
    radius: Float32Array;
    kind: InteractableKind[];
    prompt: string[];
    payload: string[];
    flags: Uint8Array;
    private capacity;
    private highWaterMark;
    constructor(initialCapacity?: number);
    ensureCapacity(neededIndex: number): void;
    attach(e: EntityId, cfg: InteractableConfig): void;
    detach(e: EntityId): void;
    isActive(e: EntityId): boolean;
    getPrompt(e: EntityId): string;
    getKind(e: EntityId): InteractableKind;
    getPayload(e: EntityId): string;
    getHighWaterMark(): number;
    getCapacity(): number;
}
export declare const POOL_INTERACTABLE = "interactable";
//# sourceMappingURL=interactable.d.ts.map