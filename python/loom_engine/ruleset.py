"""loom_engine.ruleset - 5e + PF2e action economy / initiative / conditions.

Byte-parity hand-port of the TypeScript runtime/ruleset.ts. Deterministic +
content-agnostic (condition NAMES are caller-supplied, so no SRD text is
reproduced). Compatible with the D&D 5e SRD (CC-BY-4.0) and the Pathfinder 2e
Remaster ruleset (ORC License) - see ../../NOTICE.md. Pure (no RNG; the d20 is
rolled by the engine PRNG - this does the ruleset-correct ORDERING).
"""

from __future__ import annotations

from typing import Dict, List, Optional

RULESET_5E = "5e"
RULESET_PF2E = "pf2e"


# ---- action economy ----

def start_turn_budget(ruleset: str) -> dict:
    """5e: 1 action + 1 bonus + 1 reaction. PF2e: 3 actions + 1 reaction."""
    if ruleset == RULESET_PF2E:
        return {"ruleset": RULESET_PF2E, "resources": {"action": 3, "reaction": 1}}
    return {"ruleset": RULESET_5E,
            "resources": {"action": 1, "bonus": 1, "reaction": 1}}


def can_spend(budget: dict, resource: str, n: int = 1) -> bool:
    need = n if isinstance(n, int) and n > 0 else 1
    have = budget.get("resources", {}).get(resource)
    return isinstance(have, int) and have >= need


def spend(budget: dict, resource: str, n: int = 1) -> bool:
    """Spend n (default 1) of a resource. True if spent, False if insufficient."""
    need = n if isinstance(n, int) and n > 0 else 1
    if not can_spend(budget, resource, need):
        return False
    budget["resources"][resource] -= need
    return True


# ---- initiative ordering ----

def initiative_order(entries: List[dict]) -> List[dict]:
    """Deterministic order: total DESC, then modifier DESC, then natural d20 DESC,
    then id ASC. One tiebreak correct for BOTH 5e and PF2e. New list; input
    untouched. Each entry: {id, total, modifier?, d20?}."""
    return sorted(
        list(entries),
        key=lambda e: (-int(e.get("total", 0)),
                       -int(e.get("modifier", 0) or 0),
                       -int(e.get("d20", 0) or 0),
                       str(e.get("id", ""))),
    )


# ---- conditions (content-agnostic duration tracker) ----

DURATION_UNTIL_REMOVED = -1


def create_condition_track() -> dict:
    return {"conditions": {}}


def apply_condition(track: dict, condition_id: str, rounds: Optional[int] = None) -> None:
    """Apply / refresh a condition. rounds 0 or None -> 'until removed'."""
    if not condition_id:
        return
    r = int(rounds) if isinstance(rounds, int) else DURATION_UNTIL_REMOVED
    if r == 0:
        r = DURATION_UNTIL_REMOVED
    track["conditions"][condition_id] = r


def remove_condition(track: dict, condition_id: str) -> bool:
    if condition_id in track["conditions"]:
        del track["conditions"][condition_id]
        return True
    return False


def has_condition(track: dict, condition_id: str) -> bool:
    return condition_id in track["conditions"]


def condition_remaining(track: dict, condition_id: str) -> int:
    return track["conditions"].get(condition_id, 0)


def tick_conditions(track: dict) -> List[str]:
    """Tick every FINITE condition down one round; expire (remove) any reaching 0.
    DURATION_UNTIL_REMOVED never ticks. Returns expired ids (insertion order)."""
    conds = track["conditions"]
    expired: List[str] = []
    for cid, rem in list(conds.items()):
        if rem == DURATION_UNTIL_REMOVED:
            continue
        if rem <= 1:
            expired.append(cid)
        else:
            conds[cid] = rem - 1
    for cid in expired:
        del conds[cid]
    return expired


def active_conditions(track: dict) -> List[str]:
    return list(track["conditions"].keys())


RESOURCE_RULESET = "ruleset"
