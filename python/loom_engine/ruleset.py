"""loom_engine.ruleset - 5e + PF2e action economy / initiative / conditions.

Byte-parity hand-port of the TypeScript runtime/ruleset.ts. Deterministic +
content-agnostic (condition NAMES are caller-supplied, so no SRD text is
reproduced). Compatible with the D&D 5e SRD (CC-BY-4.0) and the Pathfinder 2e
Remaster ruleset (ORC License) - see ../../NOTICE.md. Pure (no RNG; the d20 is
rolled by the engine PRNG - this does the ruleset-correct ORDERING).
"""

from __future__ import annotations

import functools
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

def _is_pure_numeric(s: str) -> bool:
    """An optional '-' then >=1 ASCII digit."""
    rest = s[1:] if s[:1] == "-" else s
    return len(rest) > 0 and all("0" <= c <= "9" for c in rest)


def _normalize_numeric(s: str):
    neg = s[:1] == "-"
    digits = s[1:] if neg else s
    mag = digits.lstrip("0") or "0"
    return (neg and mag != "0", mag)  # -0 is +0


def _byte_cmp(a: str, b: str) -> int:
    ba = a.encode("utf-8")
    bb = b.encode("utf-8")
    return -1 if ba < bb else (1 if ba > bb else 0)


def compare_ids(a: str, b: str) -> int:
    """Numeric-aware id comparison (Codex P1 / the shadow-wire finding). Numeric
    ids sort by VALUE (2 < 10), strings lexicographically, numbers before strings.
    No int parsing - sign + digit-length + UTF-8 bytes, so ids beyond i64 (uuids,
    huge numbers) are correct. Byte-identical to the TS + Rust comparators."""
    na = _is_pure_numeric(a)
    nb = _is_pure_numeric(b)
    if na and not nb:
        return -1  # numbers before strings
    if not na and nb:
        return 1
    if not na and not nb:
        return _byte_cmp(a, b)
    a_neg, a_mag = _normalize_numeric(a)
    b_neg, b_mag = _normalize_numeric(b)
    if not a_neg and b_neg:
        return 1  # +a > -b
    if a_neg and not b_neg:
        return -1
    if len(a_mag) != len(b_mag):
        mag = -1 if len(a_mag) < len(b_mag) else 1
    else:
        mag = _byte_cmp(a_mag, b_mag)
    by_value = -mag if a_neg else mag  # both negative: larger magnitude is smaller
    if by_value != 0:
        return by_value
    return _byte_cmp(a, b)  # math-equal (e.g. "02" vs "2"): raw bytes, total order


def _initiative_cmp(a: dict, b: dict) -> int:
    for key in ("total", "modifier", "d20"):
        av = int(a.get(key, 0) or 0)
        bv = int(b.get(key, 0) or 0)
        if av != bv:
            return -1 if av > bv else 1  # DESC
    return compare_ids(str(a.get("id", "")), str(b.get("id", "")))


def initiative_order(entries: List[dict]) -> List[dict]:
    """Deterministic order: total DESC, then modifier DESC, then natural d20 DESC,
    then a NUMERIC-AWARE id tiebreak (compare_ids). Correct for BOTH 5e and PF2e
    and for integer ids AND string entity ids. New list; input untouched."""
    return sorted(list(entries), key=functools.cmp_to_key(_initiative_cmp))


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
    # Codex P1: SORTED by UTF-8 bytes so the result matches the Rust core's
    # BTreeMap order - identical across languages, not insertion-dependent.
    expired.sort(key=lambda s: s.encode("utf-8"))
    return expired


def active_conditions(track: dict) -> List[str]:
    """Active condition ids in canonical SORTED order (UTF-8 bytes), matching the
    Rust core's BTreeMap - identical across languages."""
    return sorted(track["conditions"].keys(), key=lambda s: s.encode("utf-8"))


RESOURCE_RULESET = "ruleset"
