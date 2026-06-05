export declare function parseNumberWord(token: string): number | null;
export declare function extractCandidateNumbers(text: string): number[];
export interface NarrationContractOptions {
    ignoreAtOrBelow?: number;
}
export declare function findInventedNumber(text: string, attested: Iterable<number>, opts?: NarrationContractOptions): number | null;
export declare function isNarrationGrounded(text: string, attested: Iterable<number>, opts?: NarrationContractOptions): boolean;
export declare const RESOURCE_NARRATION_CONTRACT = "narrationContract";
//# sourceMappingURL=narration-contract.d.ts.map