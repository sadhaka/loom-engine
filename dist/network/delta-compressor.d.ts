import type { SnapshotWriter, SnapshotReader } from '../runtime/state-snapshot.js';
export declare const DELTA_WIRE_MAGIC = 826562380;
export declare const DELTA_WIRE_VERSION = 1;
export declare const DELTA_MAX_COLUMNS = 32;
export interface DeltaFrameInfo {
    tick: number;
    baselineTick: number;
}
export declare class DeltaCompressor {
    static encode(prev: Uint32Array, curr: Uint32Array, tick: number, baselineTick: number, writer: SnapshotWriter): number;
    static decode(prev: Uint32Array, reader: SnapshotReader, out: Uint32Array): DeltaFrameInfo;
}
export declare function deltaFrameToBase64(bytes: Uint8Array): string;
export declare function deltaFrameFromBase64(text: string): Uint8Array;
//# sourceMappingURL=delta-compressor.d.ts.map