"""loom_engine.srd5e_spell_slots - SRD 5.1 spell-slot economy (content pack).

Byte-parity hand-port of the TypeScript runtime/srd5e-spell-slots.ts: the slot
tables (full / half / pact casters), spend / restore, rests, the widen-merge
(the P0 level-up merge: shape always derives fresh from the tables for the
CURRENT class + level, only `used` carries over capped at the new max), and
the SRD upcast ladder (upcast_effect / total_dice_for_cast).

PURE: no RNG, no wall-clock, no I/O, never mutates an input pool
(clone-on-spend). String slot keys plus the reserved 'pact' key keep the JSON
shape host-portable - a serialized pool round-trips unchanged. JSON-column
encode/decode stays host-side.

Pool shape (plain dicts, the cross-surface JSON contract):
  numeric tiers: pool['1'..'9'] = {'max': int, 'used': int}
  pact tier:     pool['pact']   = {'slot_level': int, 'max': int, 'used': int}

Content: mechanics from the D&D 5e System Reference Document 5.1 (CC-BY-4.0) -
see NOTICE.md. Not affiliated with or endorsed by Wizards of the Coast. No SRD
prose is reproduced; tables ship as numbers.

See ../test_vectors/srd5e_pack_v1.json for the cross-language gate.
"""

from __future__ import annotations

import math
import re
from typing import Dict, List, Optional

MAX_SLOT_LEVEL = 9
PACT_KEY = "pact"

SlotPool = Dict[str, dict]

# ---- Caster taxonomy (SRD 5.1) ---------------------------------------------

_FULL_CASTERS = {"bard": True, "cleric": True, "druid": True, "sorcerer": True, "wizard": True}
_HALF_CASTERS = {"paladin": True, "ranger": True}
_PACT_CASTERS = {"warlock": True}

_SPELL_ABILITY = {
    "bard": "cha", "cleric": "wis", "druid": "wis", "paladin": "cha", "ranger": "wis",
    "sorcerer": "cha", "warlock": "cha", "wizard": "int",
}


def _norm_id(s) -> str:
    return s.lower().strip() if isinstance(s, str) else ""


def caster_kind(class_id) -> Optional[str]:
    """'full' | 'half' | 'pact' for a caster class, None otherwise."""
    cid = _norm_id(class_id)
    if cid in _FULL_CASTERS:
        return "full"
    if cid in _HALF_CASTERS:
        return "half"
    if cid in _PACT_CASTERS:
        return "pact"
    return None


def is_caster(class_id) -> bool:
    return caster_kind(class_id) is not None


def spell_ability_for_class(class_id) -> Optional[str]:
    return _SPELL_ABILITY.get(_norm_id(class_id))


# ---- Slot tables (SRD 5.1) ---------------------------------------------------
# Row index = class level - 1; column index = slot level - 1.

_FULL_SLOT_TABLE: List[List[int]] = [
    [2],
    [3],
    [4, 2],
    [4, 3],
    [4, 3, 2],
    [4, 3, 3],
    [4, 3, 3, 1],
    [4, 3, 3, 2],
    [4, 3, 3, 3, 1],
    [4, 3, 3, 3, 2],
    [4, 3, 3, 3, 2, 1],
    [4, 3, 3, 3, 2, 1],
    [4, 3, 3, 3, 2, 1, 1],
    [4, 3, 3, 3, 2, 1, 1],
    [4, 3, 3, 3, 2, 1, 1, 1],
    [4, 3, 3, 3, 2, 1, 1, 1],
    [4, 3, 3, 3, 2, 1, 1, 1, 1],
    [4, 3, 3, 3, 3, 1, 1, 1, 1],
    [4, 3, 3, 3, 3, 2, 1, 1, 1],
    [4, 3, 3, 3, 3, 2, 2, 1, 1],
]

_HALF_SLOT_TABLE: List[List[int]] = [
    [],
    [2],
    [3],
    [3],
    [4, 2],
    [4, 2],
    [4, 3],
    [4, 3],
    [4, 3, 2],
    [4, 3, 2],
    [4, 3, 3],
    [4, 3, 3],
    [4, 3, 3, 1],
    [4, 3, 3, 1],
    [4, 3, 3, 2],
    [4, 3, 3, 2],
    [4, 3, 3, 3, 1],
    [4, 3, 3, 3, 1],
    [4, 3, 3, 3, 2],
    [4, 3, 3, 3, 2],
]

# [pact slot level, pact slot count] per warlock level (Mystic Arcanum is a
# class feature, not a slot - out of scope here, exactly as in the SRD table).
_PACT_TABLE: List[List[int]] = [
    [1, 1], [1, 2], [2, 2], [2, 2], [3, 2], [3, 2], [4, 2], [4, 2], [5, 2], [5, 2],
    [5, 3], [5, 3], [5, 3], [5, 3], [5, 3], [5, 3], [5, 4], [5, 4], [5, 4], [5, 4],
]


def _is_num(n) -> bool:
    """typeof n === 'number' && isFinite(n) (bools are NOT numbers here)."""
    return isinstance(n, (int, float)) and not isinstance(n, bool) and math.isfinite(n)


def _clamp_level(level) -> int:
    n = math.floor(level) if _is_num(level) else 1
    if n < 1:
        return 1
    if n > 20:
        return 20
    return n


def _is_int(n) -> bool:
    """TS isInt: a finite number whose floor equals itself."""
    return _is_num(n) and math.floor(n) == n


def _clone_pool(slots: SlotPool) -> SlotPool:
    out: SlotPool = {}
    for k in slots:
        if k == PACT_KEY:
            p = slots.get(PACT_KEY)
            if p:
                out[PACT_KEY] = {"slot_level": p["slot_level"], "max": p["max"], "used": p["used"]}
        else:
            e = slots[k]
            if e:
                out[k] = {"max": e["max"], "used": e["used"]}
    return out


def spell_slots_for(class_id, level) -> SlotPool:
    """Fresh slot pool for a class + level (all used = 0). Non-caster -> {}.
    Level is clamped into 1..20 (and floored)."""
    out: SlotPool = {}
    kind = caster_kind(class_id)
    if kind is None:
        return out
    lvl = _clamp_level(level)
    if kind == "pact":
        row = _PACT_TABLE[lvl - 1]
        out[PACT_KEY] = {"slot_level": row[0], "max": row[1], "used": 0}
        return out
    table = _FULL_SLOT_TABLE if kind == "full" else _HALF_SLOT_TABLE
    slots = table[lvl - 1]
    for i in range(len(slots)):
        mx = slots[i]
        if mx > 0:
            out[str(i + 1)] = {"max": mx, "used": 0}
    return out


def highest_slot_level(slots: SlotPool) -> int:
    """Highest slot level with max > 0 anywhere in the pool (pact included). 0 if none."""
    best = 0
    for lv in range(1, MAX_SLOT_LEVEL + 1):
        e = slots.get(str(lv))
        if e and e["max"] > 0:
            best = lv
    p = slots.get(PACT_KEY)
    if p and p["max"] > 0 and p["slot_level"] > best:
        best = p["slot_level"]
    return best


def slot_available(slots: SlotPool, slot_level) -> int:
    """Unused slots at exactly slot_level (numeric tier + a matching pact tier summed)."""
    n = 0
    e = slots.get(str(slot_level))
    if e and e["max"] > e["used"]:
        n += e["max"] - e["used"]
    p = slots.get(PACT_KEY)
    if p and p["slot_level"] == slot_level and p["max"] > p["used"]:
        n += p["max"] - p["used"]
    return n


def _spend_reject(slots: SlotPool, reason: str) -> dict:
    return {"ok": False, "reason": reason, "slot_level": None, "slots": _clone_pool(slots)}


def spend_slot(slots: SlotPool, slot_level) -> dict:
    """Spend ONE slot at exactly slot_level. Never mutates the input (the
    returned pool is a clone whether or not the spend succeeded). Numeric
    slots spend before a matching pact slot (deterministic order)."""
    if slot_level == 0:
        return _spend_reject(slots, "not_a_slot")  # a cantrip is not a slot
    if not _is_int(slot_level) or slot_level < 1 or slot_level > MAX_SLOT_LEVEL:
        return _spend_reject(slots, "bad_slot_level")
    out = _clone_pool(slots)
    e = out.get(str(slot_level))
    if e and e["used"] < e["max"]:
        e["used"] = e["used"] + 1
        return {"ok": True, "reason": "ok", "slot_level": slot_level, "slots": out}
    p = out.get(PACT_KEY)
    if p and p["slot_level"] == slot_level and p["used"] < p["max"]:
        p["used"] = p["used"] + 1
        return {"ok": True, "reason": "ok", "slot_level": slot_level, "slots": out}
    return _spend_reject(slots, "no_slot")


def spend_lowest_available(slots: SlotPool, min_level) -> dict:
    """Spend the LOWEST available slot at min_level or above (walks up from
    min_level - the 5e RAW auto-upcast when the base tier is dry). Reason
    'no_higher_slot' when the whole walk comes up dry."""
    if min_level == 0:
        return _spend_reject(slots, "not_a_slot")
    if not _is_int(min_level) or min_level < 1 or min_level > MAX_SLOT_LEVEL:
        return _spend_reject(slots, "bad_slot_level")
    for lv in range(int(min_level), MAX_SLOT_LEVEL + 1):
        if slot_available(slots, lv) > 0:
            return spend_slot(slots, lv)
    return _spend_reject(slots, "no_higher_slot")


def restore_slot(slots: SlotPool, slot_level, count=None) -> SlotPool:
    """Restore `count` (default 1) spent slots at slot_level (used floors at 0).
    Numeric tier restores first; a matching pact tier restores only when no
    numeric tier exists at that level. Unknown level is a no-op clone."""
    out = _clone_pool(slots)
    n = int(count) if _is_int(count) and count > 0 else 1
    e = out.get(str(slot_level))
    if e:
        e["used"] = 0 if e["used"] - n < 0 else e["used"] - n
        return out
    p = out.get(PACT_KEY)
    if p and p["slot_level"] == slot_level:
        p["used"] = 0 if p["used"] - n < 0 else p["used"] - n
    return out


def slots_remaining(slots: SlotPool) -> Dict[int, int]:
    """Remaining (unused) slots per level, pact merged into its slot level."""
    out: Dict[int, int] = {}
    for lv in range(1, MAX_SLOT_LEVEL + 1):
        e = slots.get(str(lv))
        if e and e["max"] > 0:
            out[lv] = e["max"] - e["used"] if e["max"] - e["used"] > 0 else 0
    p = slots.get(PACT_KEY)
    if p and p["max"] > 0:
        rem = p["max"] - p["used"] if p["max"] - p["used"] > 0 else 0
        out[p["slot_level"]] = out.get(p["slot_level"], 0) + rem
    return out


def long_rest(class_id, level) -> SlotPool:
    """Long rest: every slot refreshes - a fresh pool for the class + level."""
    return spell_slots_for(class_id, level)


def short_rest(class_id, level, slots: SlotPool) -> SlotPool:
    """Short rest: pact slots refresh (warlock); everyone else is unchanged.
    The pact entry's shape (slot_level / max) re-derives from the tables for
    the CURRENT class + level, so a stale stored shape self-heals here too."""
    out = _clone_pool(slots)
    if caster_kind(class_id) != "pact":
        return out
    fresh = spell_slots_for(class_id, level)
    fp = fresh.get(PACT_KEY)
    if fp:
        out[PACT_KEY] = {"slot_level": fp["slot_level"], "max": fp["max"], "used": 0}
    return out


def widen_slots(stored: Optional[SlotPool], class_id, level) -> SlotPool:
    """THE P0 widen-merge. Shape (tiers + maxima) ALWAYS derives fresh from
    the tables for the CURRENT class + level; only `used` carries over, capped
    at the new max. Levels present in the stored pool but absent from the
    fresh shape are dropped. Non-caster / unknown class returns the stored
    pool untouched (as a clone); None/empty stored returns the fresh pool."""
    kind = caster_kind(class_id)
    if kind is None:
        return _clone_pool(stored) if stored else {}
    fresh = spell_slots_for(class_id, level)
    if not stored:
        return fresh
    for lv in range(1, MAX_SLOT_LEVEL + 1):
        fe = fresh.get(str(lv))
        if not fe:
            continue
        se = stored.get(str(lv))
        carried = se["used"] if se and _is_int(se.get("used")) and se["used"] > 0 else 0
        fe["used"] = fe["max"] if carried > fe["max"] else carried
    fp = fresh.get(PACT_KEY)
    if fp:
        sp = stored.get(PACT_KEY)
        pc = sp["used"] if sp and _is_int(sp.get("used")) and sp["used"] > 0 else 0
        fp["used"] = fp["max"] if pc > fp["max"] else pc
    return fresh


# ---- SRD upcast ladder -------------------------------------------------------
# Mechanics-only upcast data (SRD-true). Entries with no action document yet
# (bless / bane / hex / charm_person / sleep / faerie_fire / hunters_mark)
# still ship - the ladder is useful catalog data on its own.
#
# Fields: base_level, effect, concentration, added_dice (per upcast STEP, ''
# when the upcast adds no dice), per_levels (slot levels per step - 2 for
# spiritual_weapon), extra_instances (extra darts/rays/targets per slot level
# above base), note.

_SPELL_UPCAST: Dict[str, dict] = {
    "magic_missile": {"base_level": 1, "effect": "damage", "concentration": False, "added_dice": "", "per_levels": 1, "extra_instances": 1, "note": "one extra dart per slot level above 1st"},
    "cure_wounds": {"base_level": 1, "effect": "heal", "concentration": False, "added_dice": "1d8", "per_levels": 1, "extra_instances": 0, "note": "+1d8 healing per slot level above 1st"},
    "healing_word": {"base_level": 1, "effect": "heal", "concentration": False, "added_dice": "1d4", "per_levels": 1, "extra_instances": 0, "note": "+1d4 healing per slot level above 1st"},
    "guiding_bolt": {"base_level": 1, "effect": "damage", "concentration": False, "added_dice": "1d6", "per_levels": 1, "extra_instances": 0, "note": "+1d6 damage per slot level above 1st"},
    "inflict_wounds": {"base_level": 1, "effect": "damage", "concentration": False, "added_dice": "1d10", "per_levels": 1, "extra_instances": 0, "note": "+1d10 damage per slot level above 1st"},
    "witch_bolt": {"base_level": 1, "effect": "damage", "concentration": True, "added_dice": "1d12", "per_levels": 1, "extra_instances": 0, "note": "+1d12 initial damage per slot level above 1st"},
    "hellish_rebuke": {"base_level": 1, "effect": "damage", "concentration": False, "added_dice": "1d10", "per_levels": 1, "extra_instances": 0, "note": "+1d10 damage per slot level above 1st"},
    "burning_hands": {"base_level": 1, "effect": "damage", "concentration": False, "added_dice": "1d6", "per_levels": 1, "extra_instances": 0, "note": "+1d6 damage per slot level above 1st"},
    "thunderwave": {"base_level": 1, "effect": "damage", "concentration": False, "added_dice": "1d8", "per_levels": 1, "extra_instances": 0, "note": "+1d8 damage per slot level above 1st"},
    "spiritual_weapon": {"base_level": 2, "effect": "damage", "concentration": False, "added_dice": "1d8", "per_levels": 2, "extra_instances": 0, "note": "+1d8 damage per TWO slot levels above 2nd - generated variants exist only at even slot levels"},
    "scorching_ray": {"base_level": 2, "effect": "damage", "concentration": False, "added_dice": "", "per_levels": 1, "extra_instances": 1, "note": "one extra ray per slot level above 2nd"},
    "shatter": {"base_level": 2, "effect": "damage", "concentration": False, "added_dice": "1d8", "per_levels": 1, "extra_instances": 0, "note": "+1d8 damage per slot level above 2nd"},
    "fireball": {"base_level": 3, "effect": "damage", "concentration": False, "added_dice": "1d6", "per_levels": 1, "extra_instances": 0, "note": "+1d6 damage per slot level above 3rd"},
    "lightning_bolt": {"base_level": 3, "effect": "damage", "concentration": False, "added_dice": "1d6", "per_levels": 1, "extra_instances": 0, "note": "+1d6 damage per slot level above 3rd"},
    "spirit_guardians": {"base_level": 3, "effect": "damage", "concentration": True, "added_dice": "1d8", "per_levels": 1, "extra_instances": 0, "note": "+1d8 damage per slot level above 3rd"},
    "cone_of_cold": {"base_level": 5, "effect": "damage", "concentration": False, "added_dice": "1d8", "per_levels": 1, "extra_instances": 0, "note": "+1d8 damage per slot level above 5th"},
    "hold_person": {"base_level": 2, "effect": "utility", "concentration": True, "added_dice": "", "per_levels": 1, "extra_instances": 1, "note": "one extra humanoid target per slot level above 2nd (host enumerates targets)"},
    "hold_monster": {"base_level": 5, "effect": "utility", "concentration": True, "added_dice": "", "per_levels": 1, "extra_instances": 1, "note": "one extra target per slot level above 5th (host enumerates targets)"},
    "web": {"base_level": 2, "effect": "utility", "concentration": True, "added_dice": "", "per_levels": 1, "extra_instances": 0, "note": "no upcast effect"},
    "blindness_deafness": {"base_level": 2, "effect": "utility", "concentration": False, "added_dice": "", "per_levels": 1, "extra_instances": 1, "note": "one extra target per slot level above 2nd (host enumerates targets)"},
    "slow": {"base_level": 3, "effect": "utility", "concentration": True, "added_dice": "", "per_levels": 1, "extra_instances": 0, "note": "no upcast effect"},
    "bless": {"base_level": 1, "effect": "utility", "concentration": True, "added_dice": "", "per_levels": 1, "extra_instances": 1, "note": "one extra creature per slot level above 1st"},
    "bane": {"base_level": 1, "effect": "utility", "concentration": True, "added_dice": "", "per_levels": 1, "extra_instances": 1, "note": "one extra creature per slot level above 1st"},
    "hex": {"base_level": 1, "effect": "utility", "concentration": True, "added_dice": "", "per_levels": 1, "extra_instances": 0, "note": "higher slots extend duration (host policy)"},
    "charm_person": {"base_level": 1, "effect": "utility", "concentration": False, "added_dice": "", "per_levels": 1, "extra_instances": 1, "note": "one extra creature per slot level above 1st"},
    "sleep": {"base_level": 1, "effect": "utility", "concentration": False, "added_dice": "2d8", "per_levels": 1, "extra_instances": 0, "note": "+2d8 to the hit-point pool per slot level above 1st"},
    "faerie_fire": {"base_level": 1, "effect": "utility", "concentration": True, "added_dice": "", "per_levels": 1, "extra_instances": 0, "note": "no upcast effect"},
    "hunters_mark": {"base_level": 1, "effect": "utility", "concentration": True, "added_dice": "", "per_levels": 1, "extra_instances": 0, "note": "higher slots extend duration (host policy)"},
}

_DICE_RE = re.compile(r"^([0-9]+)d([0-9]+)([+-][0-9]+)?$")
_PLAIN_DICE_RE = re.compile(r"^([0-9]+)d([0-9]+)$")


def spell_requires_concentration(spell_id) -> bool:
    d = _SPELL_UPCAST.get(_norm_id(spell_id))
    return d["concentration"] if d else False


def spell_base_level(spell_id) -> Optional[int]:
    d = _SPELL_UPCAST.get(_norm_id(spell_id))
    return d["base_level"] if d else None


def upcast_effect(spell_id, cast_slot_level) -> Optional[dict]:
    """Resolve the upcast effect of casting spell_id with a slot of
    cast_slot_level. The cast level is clamped into base_level..MAX_SLOT_LEVEL
    (a non-integer or under-level request casts at base). Unknown spell -> None.

    Returns {'spell_id', 'base_level', 'cast_level', 'levels_above', 'effect',
    'concentration', 'added_dice' (TOTAL added dice at this cast level, '' when
    none), 'extra_instances' (TOTAL extra darts/rays/targets), 'note'}."""
    sid = _norm_id(spell_id)
    d = _SPELL_UPCAST.get(sid)
    if not d:
        return None
    cast = int(cast_slot_level) if _is_int(cast_slot_level) else d["base_level"]
    if cast < d["base_level"]:
        cast = d["base_level"]
    if cast > MAX_SLOT_LEVEL:
        cast = MAX_SLOT_LEVEL
    above = cast - d["base_level"]
    steps = above // d["per_levels"] if d["per_levels"] > 0 else 0
    added_dice = ""
    if d["added_dice"] != "" and steps > 0:
        m = _DICE_RE.match(d["added_dice"])
        if m:
            added_dice = str(int(m.group(1)) * steps) + "d" + m.group(2)
    extra = d["extra_instances"] * above if d["extra_instances"] > 0 else 0
    return {
        "spell_id": sid,
        "base_level": d["base_level"],
        "cast_level": cast,
        "levels_above": above,
        "effect": d["effect"],
        "concentration": d["concentration"],
        "added_dice": added_dice,
        "extra_instances": extra,
        "note": d["note"],
    }


def total_dice_for_cast(base_dice, spell_id, cast_slot_level) -> str:
    """Total damage/heal dice for a cast: base_dice plus the upcast's added
    dice. Only same-sided dice merge (every SRD entry here adds the same die
    as its base); anything else returns base_dice unchanged. The base
    equation's flat modifier (if any) is preserved once, never scaled."""
    bm = _DICE_RE.match(base_dice if isinstance(base_dice, str) else "")
    if not bm:
        return base_dice
    info = upcast_effect(spell_id, cast_slot_level)
    if not info or info["added_dice"] == "":
        return base_dice
    am = _PLAIN_DICE_RE.match(info["added_dice"])
    if not am:
        return base_dice
    if am.group(2) != bm.group(2):
        return base_dice
    total = int(bm.group(1)) + int(am.group(1))
    return str(total) + "d" + bm.group(2) + (bm.group(3) if bm.group(3) else "")
