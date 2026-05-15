export interface LoomChronoOptions {
    keyframeBytes: number;
    maxKeyframes: number;
    inputWords: number;
    maxInputs: number;
}
export type ReplayPlanReason = 'no_keyframe' | 'inputs_evicted' | 'buffer_too_small';
export type ReplayPlan = {
    ok: true;
    keyframeHandle: number;
    keyframeTick: number;
    inputCount: number;
} | {
    ok: false;
    reason: ReplayPlanReason;
};
export declare class LoomChrono {
    readonly keyframeBytes: number;
    readonly maxKeyframes: number;
    readonly inputWords: number;
    readonly maxInputs: number;
    private readonly keyframeStorage;
    private readonly keyframeTicks;
    private readonly keyframeGens;
    private readonly keyframeValids;
    private readonly inputData;
    private readonly inputTicks;
    private readonly inputGens;
    private readonly inputValids;
    private snapshotWriteCount;
    private inputWriteCountInternal;
    private lastSnapshotSlot;
    private inputsEvictedMaxTick;
    constructor(opts: LoomChronoOptions);
    snapshot(tick: number, stateBytes: ArrayBufferView): number;
    getKeyframe(handle: number, destBytes: ArrayBufferView): boolean;
    getKeyframeTick(handle: number): number;
    isKeyframeValid(handle: number): boolean;
    latestKeyframeHandle(): number;
    logInput(tick: number, words: ArrayLike<number>): number;
    isInputValid(logicalIdx: number): boolean;
    inputTickAt(logicalIdx: number): number;
    inputWordAt(logicalIdx: number, wordIdx: number): number;
    findReplayPlan(targetTick: number, outInputIndices: Int32Array): ReplayPlan;
    invalidateAfter(tick: number): number;
    validKeyframeCount(): number;
    validInputCount(): number;
    inputWriteCount(): number;
    snapshotCount(): number;
    evictedInputTickHigh(): number;
    clear(): void;
    private makeHandle;
    private resolveKeyframeSlot;
    private requireValidInput;
}
export declare function chronoSlot(handle: number): number;
export declare function chronoGeneration(handle: number): number;
//# sourceMappingURL=loom-chrono.d.ts.map