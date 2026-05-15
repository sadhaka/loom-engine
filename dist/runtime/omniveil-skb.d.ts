export declare const CLAIM_QUAD_STRIDE = 4;
export declare class OmniveilSKB {
    readonly maxClaims: number;
    readonly maxSources: number;
    readonly maxClaimsPerSource: number;
    private readonly mask;
    private readonly sourceWords;
    private readonly subject;
    private readonly predicate;
    private readonly object;
    private readonly flags;
    private readonly consensus;
    private readonly sourceBits;
    private readonly sourceClaimCount;
    private activeCount;
    constructor(maxClaims: number, maxSources: number, maxClaimsPerSource: number);
    getClaimCount(): number;
    getSourceClaimCount(source: number): number;
    assertClaim(source: number, subject: number, predicate: number, object: number): number;
    retractClaim(source: number, subject: number, predicate: number, object: number): boolean;
    consensusOf(subject: number, predicate: number, object: number): number;
    hasClaim(subject: number, predicate: number, object: number): boolean;
    hasSourceClaimed(source: number, subject: number, predicate: number, object: number): boolean;
    isContested(subject: number, predicate: number): boolean;
    resolveBest(subject: number, predicate: number): number;
    exportClaims(out: Uint32Array): number;
    clear(): void;
    private hashTriple;
    private findSlot;
    private addSource;
    private requireSource;
    private requireU32;
}
//# sourceMappingURL=omniveil-skb.d.ts.map