export declare const REACTIONS_PER_ROUND = 1;
export interface ReactionLedger {
    round: number;
    spentInRound: Map<string, number>;
}
export declare function createReactionLedger(round?: number): ReactionLedger;
export declare function canReact(ledger: ReactionLedger, entityId: string): boolean;
export declare function reactionsRemaining(ledger: ReactionLedger, entityId: string): number;
export declare function spendReaction(ledger: ReactionLedger, entityId: string): boolean;
export declare function advanceReactionRound(ledger: ReactionLedger): number;
export declare function setReactionRound(ledger: ReactionLedger, round: number): void;
export declare function pruneStaleSpends(ledger: ReactionLedger): number;
export declare function clearReactions(ledger: ReactionLedger): void;
export declare function reactionLedgerSnapshot(ledger: ReactionLedger): {
    round: number;
    spent: Array<{
        entityId: string;
        round: number;
    }>;
};
export declare const RESOURCE_REACTION_ECONOMY = "reactionEconomy";
//# sourceMappingURL=reaction-economy.d.ts.map