export interface FactionTier {
    name: string;
    min: number;
}
export interface FactionSpec {
    id: string;
    name: string;
    tiers?: FactionTier[];
    initialReputation?: number;
    minReputation?: number;
    maxReputation?: number;
    data?: Record<string, unknown>;
}
export interface FactionStatus {
    id: string;
    name: string;
    reputation: number;
    tier: string | null;
}
export interface FactionReputationOptions {
    onChanged?: (factionId: string, next: number, prev: number) => void;
    onTierChanged?: (factionId: string, nextTier: string | null, prevTier: string | null) => void;
}
export declare class FactionReputation {
    private factions;
    private onChanged;
    private onTierChanged;
    private disposed;
    private constructor();
    static create(opts?: FactionReputationOptions): FactionReputation;
    registerFaction(spec: FactionSpec): boolean;
    unregisterFaction(id: string): boolean;
    has(id: string): boolean;
    getReputation(id: string): number;
    getTier(id: string): string | null;
    addReputation(id: string, delta: number): boolean;
    setReputation(id: string, value: number): boolean;
    list(): FactionStatus[];
    size(): number;
    toSnapshot(): Record<string, number>;
    fromSnapshot(snap: Record<string, number>): void;
    dispose(): void;
    private applyReputation;
}
export declare const RESOURCE_FACTION_REPUTATION = "faction_reputation";
//# sourceMappingURL=faction-reputation.d.ts.map