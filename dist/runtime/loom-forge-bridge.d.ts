export declare const FORGE_POS_STRIDE = 16;
export declare const FORGE_VEL_STRIDE = 16;
export declare const FORGE_SCRATCH_STRIDE = 16;
export declare const FORGE_POS_OFFSET = 0;
export declare const WASM_PAGE_BYTES = 65536;
export declare const FORGE_STATE_UNINITIALIZED = 0;
export declare const FORGE_STATE_READY = 1;
export declare const FORGE_REASON_NONE = 0;
export declare const FORGE_REASON_NOT_INITIALIZED = 1;
export declare const FORGE_REASON_BAD_DT = 2;
export declare const FORGE_REASON_BAD_COUNT = 3;
export declare const FORGE_REASON_BAD_CONTRACT = 4;
export declare const FORGE_REASON_NO_CALLBACK = 5;
export declare const FORGE_MAX_DT_FP: number;
export interface LoomForgeBuildContract {
    importedSharedMemory: boolean;
    minPages: number;
    maxPages: number;
    simdEnabled: boolean;
    probeOpcode?: number;
}
export type StepCallback = (dtFp: number, activeCount: number) => void;
export interface LoomForgeBridgeConfig {
    maxEntities: number;
    contract: LoomForgeBuildContract;
}
export declare class LoomForgeBridge {
    readonly maxEntities: number;
    readonly contract: LoomForgeBuildContract;
    readonly posOffset: number;
    readonly velOffset: number;
    readonly scratchOffset: number;
    readonly posBackOffset: number;
    readonly totalBytes: number;
    readonly totalPages: number;
    private readonly contractValid;
    private state;
    private stepCallback;
    private currentTick;
    private stepsTotal;
    private invalidStepsTotal;
    private frontIsBack;
    constructor(config: LoomForgeBridgeConfig);
    getCurrentTick(): number;
    getState(): number;
    isInitialized(): boolean;
    isContractValid(): boolean;
    getStepsTotal(): number;
    getInvalidStepsTotal(): number;
    getFrontIsBack(): boolean;
    getFrontPosOffset(): number;
    getBackPosOffset(): number;
    completeInit(callback: StepCallback): number;
    step(dtFp: number, activeCount: number): number;
    tick(t: number): void;
    clear(): void;
}
//# sourceMappingURL=loom-forge-bridge.d.ts.map