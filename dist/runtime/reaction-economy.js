// Reaction Economy - the per-round reaction ceiling.
//
// v2.3.0. A combatant gets exactly ONE reaction per round (the rule that kills
// infinite-reaction loops). This is the deterministic, storage-free core: a
// ReactionLedger tracks which combatants have spent their reaction in the
// CURRENT round; advancing the round refreshes everyone.
//
// Robust by construction: each spend is tagged with the round it happened in,
// and canReact compares against the ledger's current round - so even if a
// round-reset is ever missed, a stale spend from a PRIOR round is inert (it can
// never block the current round). advanceReactionRound just increments the
// counter; pruneSpentBefore is an optional memory-bound for very long fights.
//
// Pure + deterministic: no RNG, no wall-clock; an insertion-ordered Map snapshot
// replays identically. The engine owns the ceiling so an AI narrator can never
// grant a combatant a second reaction by describing one.
//
// Code style: var-only, no arrow functions.
// The hard ceiling: reactions available to a combatant at the start of a round.
export const REACTIONS_PER_ROUND = 1;
// Fresh ledger at the given round (default 1).
export function createReactionLedger(round) {
    var r = typeof round === 'number' && round > 0 ? Math.floor(round) : 1;
    return { round: r, spentInRound: new Map() };
}
// True iff `entityId` still has its reaction available THIS round.
export function canReact(ledger, entityId) {
    if (!entityId)
        return false;
    return ledger.spentInRound.get(entityId) !== ledger.round;
}
// Reactions left for `entityId` this round (0 or REACTIONS_PER_ROUND - the
// ceiling is one, so this is a 0/1 gauge for HUDs).
export function reactionsRemaining(ledger, entityId) {
    return canReact(ledger, entityId) ? REACTIONS_PER_ROUND : 0;
}
// Attempt to spend `entityId`'s reaction. Returns true if spent, false if it was
// already spent this round (the ceiling refusing a second reaction) or the id is
// empty. Idempotent within a round: a refused spend changes nothing.
export function spendReaction(ledger, entityId) {
    if (!entityId)
        return false;
    if (ledger.spentInRound.get(entityId) === ledger.round)
        return false;
    ledger.spentInRound.set(entityId, ledger.round);
    return true;
}
// Advance to the next round - every combatant's reaction refreshes (their prior
// spend is now tagged with a stale round). Returns the new round number.
export function advanceReactionRound(ledger) {
    ledger.round += 1;
    return ledger.round;
}
// Force the ledger's round (replay / authoritative sync). A non-positive or
// non-numeric value is ignored.
export function setReactionRound(ledger, round) {
    if (typeof round === 'number' && round > 0)
        ledger.round = Math.floor(round);
}
// Drop spend-records older than the current round (optional memory bound for
// very long encounters). Returns the number of stale records removed. Behavior
// is unchanged either way - stale records are already inert via the round tag.
export function pruneStaleSpends(ledger) {
    var stale = [];
    for (var entry of ledger.spentInRound) {
        if (entry[1] < ledger.round)
            stale.push(entry[0]);
    }
    for (var s of stale)
        ledger.spentInRound.delete(s);
    return stale.length;
}
// Clear every spend-record (encounter end / reset).
export function clearReactions(ledger) {
    ledger.spentInRound.clear();
}
// Deterministic, insertion-ordered snapshot for serialization / replay.
export function reactionLedgerSnapshot(ledger) {
    var spent = [];
    for (var entry of ledger.spentInRound) {
        spent.push({ entityId: entry[0], round: entry[1] });
    }
    return { round: ledger.round, spent: spent };
}
// Resource key for the world's resource registry.
export const RESOURCE_REACTION_ECONOMY = 'reactionEconomy';
//# sourceMappingURL=reaction-economy.js.map