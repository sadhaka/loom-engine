export interface ChainedRecord<T = unknown> {
    seq: number;
    type: string;
    payload: T;
    prevSig: string;
    sig: string;
}
export interface EventChainOptions {
    key: string | Uint8Array;
    genesis?: string;
}
export interface ChainMismatch {
    seq: number;
    type: string;
    reason: 'sig_mismatch' | 'broken_chain_link' | 'seal_mismatch';
}
export interface ChainVerifyResult {
    ok: boolean;
    total: number;
    mismatches: ChainMismatch[];
}
export interface ChainSeal {
    count: number;
    head: string;
    sig: string;
}
export declare class EventChain<T = unknown> {
    private records;
    private key;
    private genesis;
    private headSig;
    private nextSeq;
    private disposed;
    private constructor();
    static create<T = unknown>(opts: EventChainOptions): EventChain<T>;
    private sign;
    append(type: string, payload: T): ChainedRecord<T> | null;
    verify(expectedSeal?: ChainSeal): ChainVerifyResult;
    static verifyRecords<T = unknown>(key: string | Uint8Array, records: ReadonlyArray<ChainedRecord<T>>, genesis?: string, expectedSeal?: ChainSeal): ChainVerifyResult;
    seal(): ChainSeal;
    static verifySeal(key: string | Uint8Array, seal: ChainSeal): boolean;
    bySeq(seq: number): ChainedRecord<T> | null;
    byType(type: string): ChainedRecord<T>[];
    list(): ChainedRecord<T>[];
    head(): string;
    size(): number;
    highWaterMark(): number;
    toSnapshot(): ChainedRecord<T>[];
    fromSnapshot(records: ChainedRecord<T>[]): void;
    fromVerifiedSnapshot(records: ChainedRecord<T>[], expectedSeal?: ChainSeal): ChainVerifyResult;
    dispose(): void;
}
export declare const RESOURCE_EVENT_CHAIN = "event_chain";
//# sourceMappingURL=event-chain.d.ts.map