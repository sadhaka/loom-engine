"""loom_engine.reaction_economy - the per-round reaction ceiling.

Byte-parity hand-port of the TypeScript runtime/reaction-economy.ts: exactly ONE
reaction per combatant per round, each spend round-tagged so a stale prior-round
record is inert. Pure + deterministic (no RNG, no wall-clock; ordered dict
matches the TS Map). See ../test_vectors/ for the cross-language gate.
"""

from __future__ import annotations

from typing import Dict, List

REACTIONS_PER_ROUND = 1


class ReactionLedger:
    """round is 1-based. spent_in_round maps entity_id -> the round it last spent
    its reaction (ordered-insertion dict, matching the TS Map)."""

    def __init__(self, round_no: int = 1) -> None:
        self.round = int(round_no) if isinstance(round_no, int) and round_no > 0 else 1
        self.spent_in_round: Dict[str, int] = {}


def create_reaction_ledger(round_no: int = 1) -> ReactionLedger:
    return ReactionLedger(round_no)


def can_react(ledger: ReactionLedger, entity_id: str) -> bool:
    """True iff entity_id still has its reaction available THIS round."""
    if not entity_id:
        return False
    return ledger.spent_in_round.get(entity_id) != ledger.round


def reactions_remaining(ledger: ReactionLedger, entity_id: str) -> int:
    return REACTIONS_PER_ROUND if can_react(ledger, entity_id) else 0


def spend_reaction(ledger: ReactionLedger, entity_id: str) -> bool:
    """Spend the reaction. True if spent, False if already spent this round (the
    ceiling refusing a second) or the id is empty."""
    if not entity_id:
        return False
    if ledger.spent_in_round.get(entity_id) == ledger.round:
        return False
    ledger.spent_in_round[entity_id] = ledger.round
    return True


def advance_reaction_round(ledger: ReactionLedger) -> int:
    """Advance to the next round - everyone's reaction refreshes (prior records
    become stale). Returns the new round number."""
    ledger.round += 1
    return ledger.round


def set_reaction_round(ledger: ReactionLedger, round_no: int) -> None:
    if isinstance(round_no, int) and round_no > 0:
        ledger.round = round_no


def prune_stale_spends(ledger: ReactionLedger) -> int:
    """Drop spend-records older than the current round (memory bound). Behavior
    unchanged - stale records are already inert. Returns the count removed."""
    stale = [eid for eid, r in ledger.spent_in_round.items() if r < ledger.round]
    for eid in stale:
        del ledger.spent_in_round[eid]
    return len(stale)


def clear_reactions(ledger: ReactionLedger) -> None:
    ledger.spent_in_round.clear()


def reaction_ledger_snapshot(ledger: ReactionLedger) -> dict:
    """Deterministic, insertion-ordered snapshot for serialization / replay."""
    return {
        "round": ledger.round,
        "spent": [{"entity_id": eid, "round": r}
                  for eid, r in ledger.spent_in_round.items()],
    }


RESOURCE_REACTION_ECONOMY = "reactionEconomy"
