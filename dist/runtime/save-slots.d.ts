import type { PersistentStorage } from './persistent-storage.js';
import type { WorldSnapshot } from './world-snapshot.js';
export interface SlotMetadata {
    id: string;
    label?: string;
    savedAtMs: number;
    engineVersion: string;
    thumbnailDataUrl?: string;
    playtimeSeconds?: number;
    userMeta?: Record<string, unknown>;
}
export interface SaveSlotsOptions {
    storage: PersistentStorage;
    prefix?: string;
    maxThumbnailBytes?: number;
}
export interface SaveSlotInput {
    snapshot: WorldSnapshot;
    label?: string;
    thumbnailDataUrl?: string;
    playtimeSeconds?: number;
    userMeta?: Record<string, unknown>;
}
export interface LoadedSlot {
    meta: SlotMetadata;
    snapshot: WorldSnapshot;
}
export declare class SaveSlots {
    private storage;
    private prefix;
    private maxThumbBytes;
    private disposed;
    private constructor();
    static create(opts: SaveSlotsOptions): SaveSlots;
    save(id: string, input: SaveSlotInput, nowFn?: () => number): Promise<SlotMetadata>;
    load(id: string): Promise<LoadedSlot | null>;
    loadMeta(id: string): Promise<SlotMetadata | null>;
    delete(id: string): Promise<boolean>;
    has(id: string): Promise<boolean>;
    listIds(): Promise<string[]>;
    listAll(sortBy?: 'recent' | 'name'): Promise<SlotMetadata[]>;
    rename(id: string, newId: string): Promise<boolean>;
    duplicate(id: string, newId: string, nowFn?: () => number): Promise<boolean>;
    clearAll(): Promise<void>;
    dispose(): void;
    private k;
    private byteLengthOf;
    private parseEnvelope;
}
export declare const RESOURCE_SAVE_SLOTS = "save_slots";
//# sourceMappingURL=save-slots.d.ts.map