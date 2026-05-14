export declare const STATE_SNAPSHOT_VERSION = 1;
export declare function fnv1a32(bytes: Uint8Array, offset?: number, length?: number): number;
export declare class SnapshotWriter {
    private buf;
    private view;
    private u8;
    private len;
    constructor(initialCapacity?: number);
    get length(): number;
    reset(): void;
    private ensure;
    writeU8(v: number): void;
    writeU16(v: number): void;
    writeU32(v: number): void;
    writeI32(v: number): void;
    writeF32(v: number): void;
    writeF64(v: number): void;
    writeU8Slice(arr: Uint8Array, count: number): void;
    writeU32Slice(arr: Uint32Array | Int32Array, count: number): void;
    writeI32Slice(arr: Int32Array, count: number): void;
    writeF32Slice(arr: Float32Array, count: number): void;
    writeKey(s: string): void;
    writeString(s: string): void;
    reserveU32(): number;
    patchU32(offset: number, v: number): void;
    bytes(): Uint8Array;
}
export declare class SnapshotReader {
    private readonly view;
    private readonly u8;
    private off;
    private readonly end;
    constructor(bytes: Uint8Array);
    get offset(): number;
    get remaining(): number;
    private need;
    readU8(): number;
    readU16(): number;
    readU32(): number;
    readI32(): number;
    readF32(): number;
    readF64(): number;
    readU8Slice(): Uint8Array;
    readU32Slice(): Uint32Array;
    readI32Slice(): Int32Array;
    readF32Slice(): Float32Array;
    readKey(): string;
    readString(): string;
    readBlob(n: number): Uint8Array;
}
export interface ISnapshotable {
    readonly snapshotKey: string;
    snapshotInto(w: SnapshotWriter): void;
    restoreFrom(r: SnapshotReader): void;
}
export declare function isSnapshotable(x: unknown): x is ISnapshotable;
export declare class StateSnapshot {
    private readonly parts;
    private readonly keys;
    private readonly writer;
    constructor(initialCapacity?: number);
    get partCount(): number;
    register(part: ISnapshotable): void;
    serialize(): Uint8Array;
    hash(): number;
    restore(bytes: Uint8Array): void;
}
//# sourceMappingURL=state-snapshot.d.ts.map