export interface WaitMs {
    kind: 'ms';
    remainingMs: number;
}
export interface WaitUntil {
    kind: 'until';
    predicate: () => boolean;
}
export interface WaitFrames {
    kind: 'frames';
    remainingFrames: number;
}
export type Yieldable = WaitMs | WaitUntil | WaitFrames | null | undefined;
export declare function waitMs(ms: number): WaitMs;
export declare function waitUntil(predicate: () => boolean): WaitUntil;
export declare function waitFrames(n: number): WaitFrames;
export interface CoroutineOptions {
    onCompleted?: (id: number) => void;
}
export interface StartOptions {
    onDone?: () => void;
    onError?: (err: unknown) => void;
}
export declare class Coroutine {
    private routines;
    private nextId;
    private onCompleted;
    private disposed;
    private constructor();
    static create(opts?: CoroutineOptions): Coroutine;
    start(genFn: () => Generator<Yieldable, void, void>, opts?: StartOptions): number;
    cancel(id: number): boolean;
    activeCount(): number;
    isActive(id: number): boolean;
    tick(dtMs: number): void;
    cancelAll(): void;
    dispose(): void;
    private advance;
}
export declare const RESOURCE_COROUTINE = "coroutine";
//# sourceMappingURL=coroutine.d.ts.map