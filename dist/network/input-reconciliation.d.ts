export declare const FIXED_POINT_SHIFT = 16;
export declare const FIXED_POINT_ONE: number;
export declare function floatToFixed(value: number): number;
export declare function fixedToFloat(fixed: number): number;
export interface ReconcileResult {
    accepted: boolean;
    mispredicted: boolean;
}
export declare class InputReconciliation {
    readonly capacity: number;
    private readonly history;
    private lastRecordedTick;
    constructor(capacity: number);
    get lastTick(): number;
    record(tick: number, xFixed: number, yFixed: number, inputMask: number): void;
    reconcile(serverTick: number, serverXFixed: number, serverYFixed: number): ReconcileResult;
    readSlot(tick: number, out: Int32Array): boolean;
    clear(): void;
    static smoothVisual(clientXFixed: number, clientYFixed: number, serverXFixed: number, serverYFixed: number, lerpFixed: number, out: Int32Array): void;
}
//# sourceMappingURL=input-reconciliation.d.ts.map