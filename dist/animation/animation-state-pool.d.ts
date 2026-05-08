import { type EntityId } from '../entity.js';
import type { SpriteSheetManifest } from '../asset/sprite-sheet-loader.js';
export declare const ANIMATION_FLAG_ACTIVE: number;
export declare const ANIMATION_FLAG_FINISHED: number;
export declare class AnimationStatePool {
    elapsedMs: Float32Array;
    manifest: Array<SpriteSheetManifest | null>;
    clipName: string[];
    flags: Uint8Array;
    private highWaterMark;
    private capacity;
    constructor(initialCapacity?: number);
    ensureCapacity(neededIndex: number): void;
    play(e: EntityId, manifest: SpriteSheetManifest, clipName: string, options?: {
        startMs?: number;
    }): void;
    stop(e: EntityId): void;
    isActive(e: EntityId): boolean;
    isFinished(e: EntityId): boolean;
    getClipName(e: EntityId): string;
    getManifest(e: EntityId): SpriteSheetManifest | null;
    getHighWaterMark(): number;
    getCapacity(): number;
}
//# sourceMappingURL=animation-state-pool.d.ts.map