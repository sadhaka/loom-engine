export declare const SNAPSHOT_NEVER_WRITTEN = 0;
export declare const SNAPSHOT_TORN = -1;
export declare const SNAPSHOT_UNCHANGED = -2;
export type ObserverHandle = number;
export declare function makeObserverHandle(slot: number, generation: number): ObserverHandle;
export declare function observerSlot(handle: ObserverHandle): number;
export declare function observerGeneration(handle: ObserverHandle): number;
export declare class AIBehaviorBuffer {
    readonly capacity: number;
    readonly payloadLength: number;
    readonly stride: number;
    readonly maxObservers: number;
    private readonly u32;
    private readonly f32;
    private readonly observerActive;
    private readonly observerGen;
    private readonly observerLastSeen;
    private observerCount;
    constructor(capacity: number, payloadLength: number, maxObservers: number, buffer?: ArrayBufferLike);
    get buffer(): ArrayBufferLike;
    writeSnapshot(slot: number, values: ArrayLike<number>, count?: number): number;
    getVersion(slot: number): number;
    readSnapshot(slot: number, out: Float32Array, attempts?: number): number;
    createObserver(): ObserverHandle;
    releaseObserver(handle: ObserverHandle): boolean;
    isObserver(handle: ObserverHandle): boolean;
    getObserverCount(): number;
    readChanged(observer: ObserverHandle, slot: number, out: Float32Array, attempts?: number): number;
    hasChanged(observer: ObserverHandle, slot: number): boolean;
    getLastSeen(observer: ObserverHandle, slot: number): number;
    resetObserver(observer: ObserverHandle): void;
    clear(): void;
    private requireSlot;
    private resolveAttempts;
    private requireObserver;
}
//# sourceMappingURL=ai-behavior-buffer.d.ts.map