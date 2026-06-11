"""loom_engine.srd5e_concentration - the 5e concentration state machine.

Byte-parity hand-port of the TypeScript runtime/srd5e-concentration.ts.

PURE and RNG-FREE BY DESIGN: the caller rolls the d20 CON save (via its own
AST check or host rng) and passes the TOTAL in - this module only decides.
The one-spell-at-a-time rule lives in start_concentration's `dropped` return.

State shape (plain dicts, the cross-surface JSON contract):
  {'spell_id': str, 'spell_name': str, 'slot_level'?: int}

Content: mechanics from the D&D 5e System Reference Document 5.1 (CC-BY-4.0) -
see NOTICE.md. DC = max(10, floor(damage / 2)), keep iff total >= dc.

See ../test_vectors/srd5e_pack_v1.json for the cross-language gate.
"""

from __future__ import annotations

import math
from typing import Optional

from .pcg32 import floor_div

CONCENTRATION_MIN_DC = 10


def _is_num(n) -> bool:
    return isinstance(n, (int, float)) and not isinstance(n, bool) and math.isfinite(n)


def _clone_state(c: dict) -> dict:
    out = {"spell_id": c["spell_id"], "spell_name": c["spell_name"]}
    sl = c.get("slot_level")
    if isinstance(sl, (int, float)) and not isinstance(sl, bool):
        out["slot_level"] = sl
    return out


def maintain_save_dc(damage) -> int:
    """The concentration save DC for taking `damage`: max(10, floor(damage / 2)).
    floor_div is the engine's one division (toward -inf), shared across surfaces."""
    dmg = math.floor(damage) if _is_num(damage) else 0
    half = floor_div(dmg, 2)
    return half if half > CONCENTRATION_MIN_DC else CONCENTRATION_MIN_DC


def is_concentrating(c) -> bool:
    return bool(c and isinstance(c.get("spell_id"), str) and len(c["spell_id"]) > 0)


def start_concentration(c: Optional[dict], spell_id, spell_name=None, slot_level=None) -> dict:
    """Begin concentrating on a spell. If already concentrating, the previous
    spell DROPS (one spell at a time - 5e RAW) and is returned in 'dropped'."""
    dropped = _clone_state(c) if is_concentrating(c) else None
    nxt = {
        "spell_id": spell_id,
        "spell_name": spell_name if isinstance(spell_name, str) and len(spell_name) > 0 else spell_id,
    }
    if _is_num(slot_level):
        nxt["slot_level"] = math.floor(slot_level)
    return {"concentration": nxt, "dropped": dropped}


def drop_concentration(c: Optional[dict]) -> dict:
    """Voluntarily (or forcibly) end concentration. No-op when not concentrating."""
    if not is_concentrating(c):
        return {"concentration": None, "dropped": None}
    return {"concentration": None, "dropped": _clone_state(c)}


def maintain_save(c: Optional[dict], damage, con_save_total) -> dict:
    """Resolve a concentration save after taking damage. The caller has
    already rolled the d20 CON save and passes the TOTAL; this module compares
    it to the DC. Keep iff total >= dc (exact direction - 5e RAW "DC or
    higher"). Not concentrating: nothing is needed and nothing can drop."""
    dc = maintain_save_dc(damage)
    total = math.floor(con_save_total) if _is_num(con_save_total) else 0
    if not is_concentrating(c):
        return {"needed": False, "dc": dc, "total": total, "success": True,
                "concentration": c if c is not None else None, "dropped": None}
    keep = total >= dc
    if keep:
        return {"needed": True, "dc": dc, "total": total, "success": True,
                "concentration": _clone_state(c), "dropped": None}
    return {"needed": True, "dc": dc, "total": total, "success": False,
            "concentration": None, "dropped": _clone_state(c)}
