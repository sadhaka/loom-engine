"""loom_engine.srd5e_conditions - 5e condition tables: advantage/disadvantage
mapping, STR/DEX save auto-fail, and reaction denial (content pack).

Byte-parity hand-port of the TypeScript runtime/srd5e-conditions.ts.

Engine-side, conditions are world-state TAGS: the same lowercase ids feed
has_tag arms inside pack documents (auto-fail expressed in data - see
srd5e_pack.py) AND this module (for host resolvers). PURE: no RNG, no state -
this module computes the advantage/disadvantage MODE only. The extra-die
mechanic itself (rolling a second d20 and keeping one) is NOT expressible in
AST v2 (no max/min op - spec section 14 cut), so it stays a host-side
resolver concern (or a future v3 expression op).

Content: the 5e RAW condition rules from the SRD 5.1 (CC-BY-4.0) - see
NOTICE.md. Tables are mechanics-only id lists; no SRD prose.
"""

from __future__ import annotations

from typing import Dict, List, Optional

# Attacks AGAINST a target with any of these have advantage.
ADV_AGAINST_TARGET: List[str] = ["restrained", "stunned", "paralyzed", "unconscious"]

# An ATTACKER with any of these has disadvantage on attack rolls.
DISADV_ON_ATTACKER: List[str] = ["poisoned", "frightened", "restrained", "prone"]

# These auto-fail STRENGTH and DEXTERITY saving throws (and only those).
AUTO_FAIL_STR_DEX: List[str] = ["paralyzed", "stunned", "unconscious"]

# These deny reactions (the SRD incapacitated family - an incapacitated
# creature takes no actions or reactions).
INCAPACITATED_NO_REACTION: List[str] = ["paralyzed", "stunned", "unconscious", "incapacitated", "petrified"]


def coerce_conditions(value) -> List[str]:
    """Normalize arbitrary input into lowercase condition ids. Fail-soft:
    anything unusable coerces to []. Accepts a list of strings or one
    (possibly comma-separated) string; entries are trimmed, lowercased,
    deduped in first-seen order. Unknown ids pass through (the tables simply
    never match them)."""
    if isinstance(value, list):
        raw = value
    elif isinstance(value, str):
        raw = value.split(",")
    else:
        return []
    out: List[str] = []
    seen: Dict[str, bool] = {}
    for v in raw:
        if not isinstance(v, str):
            continue
        cid = v.lower().strip()
        if len(cid) == 0:
            continue
        if cid in seen:
            continue
        seen[cid] = True
        out.append(cid)
    return out


def _has_cond(conds: List[str], cid: str) -> bool:
    return cid in conds


def attack_advantage_mode(attacker_conds, target_conds, is_melee) -> dict:
    """The 5e RAW advantage/disadvantage mapping for ONE attack roll.

    - Target conditions in ADV_AGAINST_TARGET grant advantage.
    - Attacker conditions in DISADV_ON_ATTACKER impose disadvantage.
    - A PRONE TARGET is split by range: melee attacks gain advantage, ranged
      attacks suffer disadvantage - and when is_melee is None (the host could
      not establish range), prone is SKIPPED entirely and flagged via
      detail['prone_skipped'] (never guessed).
    - Any advantage + any disadvantage CANCEL to a straight roll (5e RAW:
      they never stack or outweigh) - mode None with detail['cancelled'] True.

    Returns {'mode': 'adv'|'dis'|None, 'detail': {'adv_from', 'dis_from',
    'cancelled', 'prone_skipped'}}."""
    atk = coerce_conditions(attacker_conds)
    tgt = coerce_conditions(target_conds)
    adv_from: List[str] = []
    dis_from: List[str] = []
    prone_skipped = False
    for ac in ADV_AGAINST_TARGET:
        if _has_cond(tgt, ac):
            adv_from.append(ac)
    if _has_cond(tgt, "prone"):
        if is_melee is True:
            adv_from.append("prone")
        elif is_melee is False:
            dis_from.append("prone")
        else:
            prone_skipped = True
    for dc in DISADV_ON_ATTACKER:
        if _has_cond(atk, dc):
            dis_from.append(dc)
    cancelled = len(adv_from) > 0 and len(dis_from) > 0
    mode: Optional[str] = None
    if len(adv_from) > 0 and len(dis_from) == 0:
        mode = "adv"
    elif len(dis_from) > 0 and len(adv_from) == 0:
        mode = "dis"
    detail = {"adv_from": adv_from, "dis_from": dis_from,
              "cancelled": cancelled, "prone_skipped": prone_skipped}
    return {"mode": mode, "detail": detail}


def condition_roll_note(mode, detail, kept, pair) -> str:
    """Human-readable note for an attack roll's advantage state. `kept` (the
    die kept) and `pair` (e.g. '17/9') are passed explicitly by the host that
    rolled the extra die - this module never sees a roll object."""
    note = ""
    if mode == "adv":
        note = "advantage (" + ", ".join(detail["adv_from"]) + ")"
        if kept is not None and pair is not None:
            note = note + ": rolled " + pair + ", kept " + str(kept)
    elif mode == "dis":
        note = "disadvantage (" + ", ".join(detail["dis_from"]) + ")"
        if kept is not None and pair is not None:
            note = note + ": rolled " + pair + ", kept " + str(kept)
    elif detail["cancelled"]:
        note = ("advantage (" + ", ".join(detail["adv_from"]) + ") and disadvantage ("
                + ", ".join(detail["dis_from"]) + ") cancel: straight roll")
    if detail["prone_skipped"]:
        note = note + (" " if len(note) > 0 else "") + "[prone ignored: melee/ranged unknown]"
    return note


def auto_fail_save_condition(save_ability, target_conds) -> Optional[str]:
    """The first target condition that auto-fails a STR or DEX save, or None.
    Only STR/DEX saves auto-fail (5e RAW); every other ability returns None
    regardless of conditions. Accepts 'str'/'dex' or full ability names."""
    a = save_ability.lower().strip()[:3] if isinstance(save_ability, str) else ""
    if a != "str" and a != "dex":
        return None
    conds = coerce_conditions(target_conds)
    for cid in AUTO_FAIL_STR_DEX:
        if _has_cond(conds, cid):
            return cid
    return None


def reaction_denied_by_conditions(target_conds) -> Optional[str]:
    """The first condition that denies the entity its reaction, or None."""
    conds = coerce_conditions(target_conds)
    for cid in INCAPACITATED_NO_REACTION:
        if _has_cond(conds, cid):
            return cid
    return None
