export declare const RESOURCE_ENTROPY = "loom.entropy";
export declare const DEFAULT_ENTROPY_SEED = 2654435769;
export interface IEntropy {
    random(): number;
    int(min: number, max: number): number;
    pick<T>(arr: ReadonlyArray<T>): T;
    getState(): number;
    setState(s: number): void;
    reseed(seed: number): void;
}
export declare class Entropy implements IEntropy {
    private state;
    constructor(seed?: number);
    random(): number;
    int(min: number, max: number): number;
    pick<T>(arr: ReadonlyArray<T>): T;
    getState(): number;
    setState(s: number): void;
    reseed(seed: number): void;
}
export declare function createEntropy(seed?: number): Entropy;
//# sourceMappingURL=entropy.d.ts.map