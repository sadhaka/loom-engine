import { type EntityId } from '../entity.js';
import type { ISnapshotable, SnapshotWriter, SnapshotReader } from '../runtime/state-snapshot.js';
export declare const TRANSFORM_FLAG_DIRTY: number;
export declare const TRANSFORM_FLAG_VISIBLE: number;
export declare const TRANSFORM_FLAG_STATIC: number;
export declare const TRANSFORM_FLAG_HAS_PARENT: number;
export declare const TRANSFORM_FLAG_ATTACHED: number;
export declare class TransformPool implements ISnapshotable {
    x: Float32Array;
    y: Float32Array;
    z: Float32Array;
    rotation: Float32Array;
    scaleX: Float32Array;
    scaleY: Float32Array;
    parent: Int32Array;
    flags: Uint8Array;
    private highWaterMark;
    private capacity;
    constructor(initialCapacity?: number);
    ensureCapacity(neededIndex: number): void;
    attach(e: EntityId, x?: number, y?: number, z?: number): void;
    detach(e: EntityId): void;
    setPosition(e: EntityId, x: number, y: number, z?: number): void;
    setScale(e: EntityId, sx: number, sy: number): void;
    setRotation(e: EntityId, radians: number): void;
    isVisible(e: EntityId): boolean;
    setVisible(e: EntityId, visible: boolean): void;
    getHighWaterMark(): number;
    getCapacity(): number;
    clearDirtyAt(index: number): void;
    tighten(): void;
    readonly snapshotKey: string;
    snapshotInto(w: SnapshotWriter): void;
    restoreFrom(r: SnapshotReader): void;
}
//# sourceMappingURL=transform.d.ts.map