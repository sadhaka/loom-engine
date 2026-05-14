import { type EntityId } from '../entity.js';
import type { AtlasHandle } from '../renderer/graphics-device.js';
import type { ColorRGBA } from '../util/color.js';
import type { ISnapshotable, SnapshotWriter, SnapshotReader } from '../runtime/state-snapshot.js';
export declare const SPRITE_FLAG_ACTIVE: number;
export declare const SPRITE_FLAG_TINTED: number;
export declare class SpritePool implements ISnapshotable {
    atlas: Int32Array;
    frame: Int32Array;
    tintR: Float32Array;
    tintG: Float32Array;
    tintB: Float32Array;
    tintA: Float32Array;
    flags: Uint8Array;
    private highWaterMark;
    private capacity;
    constructor(initialCapacity?: number);
    ensureCapacity(neededIndex: number): void;
    attach(e: EntityId, atlas: AtlasHandle, frame?: number, tint?: Readonly<ColorRGBA>): void;
    detach(e: EntityId): void;
    setFrame(e: EntityId, frame: number): void;
    setTint(e: EntityId, tint: Readonly<ColorRGBA>): void;
    clearTint(e: EntityId): void;
    isActive(e: EntityId): boolean;
    getHighWaterMark(): number;
    getCapacity(): number;
    tighten(): void;
    readonly snapshotKey: string;
    snapshotInto(w: SnapshotWriter): void;
    restoreFrom(r: SnapshotReader): void;
}
//# sourceMappingURL=sprite.d.ts.map