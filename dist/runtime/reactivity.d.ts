export interface Signal<T> {
    get(): T;
    set(value: T): void;
    peek(): T;
}
export interface Computed<T> {
    get(): T;
    peek(): T;
    dispose(): void;
}
export interface EffectHandle {
    dispose(): void;
    isDisposed(): boolean;
}
export interface ReactivityOptions {
    equals?: (a: unknown, b: unknown) => boolean;
}
export declare class Reactivity {
    private trackStack;
    private untrackDepth;
    private pending;
    private batchDepth;
    private equals;
    private allObservers;
    private disposed;
    private constructor();
    static create(opts?: ReactivityOptions): Reactivity;
    signal<T>(initial: T): Signal<T>;
    computed<T>(fn: () => T): Computed<T>;
    effect(fn: () => void): EffectHandle;
    batch<T>(fn: () => T): T;
    untrack<T>(fn: () => T): T;
    dispose(): void;
    private subscribeCurrent;
    private notifyAll;
    private queueRerun;
    private flush;
}
export declare const RESOURCE_REACTIVITY = "reactivity";
//# sourceMappingURL=reactivity.d.ts.map