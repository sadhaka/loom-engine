export type MarkovOrder = 1 | 2 | 3;
export interface NameGeneratorOptions {
    seed?: number | string;
    order?: MarkovOrder;
    startToken?: string;
    endToken?: string;
}
export interface GenerateOptions {
    minLen?: number;
    maxLen?: number;
    maxAttempts?: number;
    titleCase?: boolean;
}
export declare class NameGenerator {
    private order;
    private startToken;
    private endToken;
    private rng;
    private seedNumeric;
    private chain;
    private starts;
    private trainedTokens;
    private constructor();
    static create(opts?: NameGeneratorOptions): NameGenerator;
    train(corpus: string[]): void;
    generate(opts?: GenerateOptions): string;
    setSeed(seed: number | string): void;
    reset(): void;
    count(): number;
    states(): number;
    private recomputeStarts;
    private buildOne;
    private weightedPick;
}
export declare const RESOURCE_NAME_GENERATOR = "name_generator";
//# sourceMappingURL=name-generator.d.ts.map