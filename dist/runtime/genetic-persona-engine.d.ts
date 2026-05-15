import type { IEntropy } from './entropy.js';
export declare const GENOME_WORDS = 8;
export declare const GENOME_BITS = 256;
export declare class GeneticPersonaEngine {
    readonly capacity: number;
    private readonly genomes;
    constructor(capacity: number);
    randomize(entityId: number, entropy: IEntropy): void;
    setGenome(entityId: number, words: ArrayLike<number>): void;
    copyGenome(srcId: number, dstId: number): void;
    clearGenome(entityId: number): void;
    mutate(entityId: number, entropy: IEntropy, mutationCount: number): void;
    crossover(parentA: number, parentB: number, childId: number, entropy: IEntropy): void;
    getTrait(entityId: number, traitBit: number): boolean;
    setTrait(entityId: number, traitBit: number, value: boolean): void;
    getGenomeWord(entityId: number, wordIndex: number): number;
    hammingDistance(entityA: number, entityB: number): number;
    clear(): void;
    private requireEntity;
    private requireTraitBit;
    private requireWordIndex;
}
//# sourceMappingURL=genetic-persona-engine.d.ts.map