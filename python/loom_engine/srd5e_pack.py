"""loom_engine.srd5e_pack - SRD 5.1 action content pack: mechanics-only
cantrip + leveled-spell catalogs, AST v2 document BUILDERS, and
plan_leveled_cast (the dice-free economy half of a cast).

Byte-parity hand-port of the TypeScript runtime/srd5e-pack.ts. Builders emit
plain-dict CheckNode / MutationNode documents that deep-equal the TS output
after JSON normalization - the golden harness's builder-drift pin
(test_vectors/srd5e_pack_v1.json) gates on it. Builder option dicts use the
TS JSON key names (modProp / damageDice / addModToDamage / agonizing /
selectTag / maxTargets) - they are the cross-surface vector contract.

The catalogs ship MECHANICS ONLY - no flavor prose, no narration strings.
Riders are structured rider_tag data the host narrates itself. Builders are
pure functions emitting check / mutation documents per spell id + tier / slot
level (AST v2 documents are unparametrized, so each tier/slot is its own
concrete document). Every emitted document passes validate_check /
validate_triggered_mutations - the pack test gates on it.

PROPERTY-NAME CONVENTION (the contract between pack documents and host world
states):
  actor props:  str_mod / dex_mod / cha_mod / spell_atk / spell_dc / spell_mod
  target props: hp / hp_max / ac / str_save / dex_save / con_save /
                wis_save / cha_save
  condition tags: paralyzed / stunned / unconscious / restrained / poisoned /
                frightened / prone (see srd5e_conditions.py)
  selection tags: host-painted multi-target scopes (default 'in_blast') - the
                HOST paints the tag before evaluation and clears it after
                (the caller-enumerates contract).
  scratch props: 'save_roll' (the spec 6.6 per-target-save idiom; persists in
                world_state_hash as a permanent, reused slot).

Degree-slot semantics are mapping conventions: 'success' = the CASTER lands
the action (on save spells that means the target FAILED its save). The nat-1
auto-miss lands in the failure degree via an or-arm (delta_lte -1 OR
nat_roll_lte 1); nat-20 auto-hit falls out of degree order (the crit branch
is tested first regardless of delta).

Known AST v2 limits, deliberately NOT worked around (host-side or v3):
  - advantage/disadvantage second-d20 (no max/min op) - srd5e_conditions
    computes the MODE only.
  - finesse max(STR, DEX) - ship str and dex variants, host picks.
  - one SHARED damage roll across multi-target saves (no value bindings) -
    per-target fresh rolls are the spec-blessed v2 idiom and what ships.
  - rider/condition DURATIONS - catalog data for the host's ConditionTrack
    (ruleset.py tick_conditions), never in the AST.
  - min-0 damage clamp on negative mods / min-1 heal clamp - documents ship
    the simple form (the clamp needs the scratch-prop if idiom; hosts that
    need it can wrap).

Content: mechanics from the D&D 5e System Reference Document 5.1 (CC-BY-4.0) -
see NOTICE.md. Engine-host tuning is caller config with neutral defaults
(agonizing default-off; selectTag/maxTargets caller-supplied; scorching_ray
ships RAW per-ray).
"""

from __future__ import annotations

import copy
import math
import re
from typing import Dict, List

from .srd5e_spell_slots import (
    MAX_SLOT_LEVEL, caster_kind, spend_lowest_available, spell_base_level,
    spell_requires_concentration, total_dice_for_cast, upcast_effect,
)

# ---- Catalogs ----------------------------------------------------------------
# Cantrip fields: id, name, kind ('spell_attack'|'save'), damage_dice,
# damaged_dice (toll_the_dead: the die used when target.hp < target.hp_max),
# damage_type, save_ability ('dex'|'con'|'wis' on save cantrips), beams
# (eldritch_blast: beam count scales, not dice), no_scale (eldritch_blast:
# per-beam dice never tier-scale), rider_tag (structured rider - host narrates
# + tracks duration), aoe_radius_ft.

CANTRIPS: Dict[str, dict] = {
    "fire_bolt": {"id": "fire_bolt", "name": "Fire Bolt", "kind": "spell_attack", "damage_dice": "1d10", "damage_type": "fire"},
    "produce_flame": {"id": "produce_flame", "name": "Produce Flame", "kind": "spell_attack", "damage_dice": "1d8", "damage_type": "fire"},
    "ray_of_frost": {"id": "ray_of_frost", "name": "Ray of Frost", "kind": "spell_attack", "damage_dice": "1d8", "damage_type": "cold", "rider_tag": "slowed_10ft"},
    "chill_touch": {"id": "chill_touch", "name": "Chill Touch", "kind": "spell_attack", "damage_dice": "1d8", "damage_type": "necrotic", "rider_tag": "no_heal"},
    "thorn_whip": {"id": "thorn_whip", "name": "Thorn Whip", "kind": "spell_attack", "damage_dice": "1d6", "damage_type": "piercing", "rider_tag": "pulled_10ft"},
    "eldritch_blast": {"id": "eldritch_blast", "name": "Eldritch Blast", "kind": "spell_attack", "damage_dice": "1d10", "damage_type": "force", "beams": True, "no_scale": True},
    "sacred_flame": {"id": "sacred_flame", "name": "Sacred Flame", "kind": "save", "damage_dice": "1d8", "damage_type": "radiant", "save_ability": "dex"},
    "acid_splash": {"id": "acid_splash", "name": "Acid Splash", "kind": "save", "damage_dice": "1d6", "damage_type": "acid", "save_ability": "dex", "aoe_radius_ft": 5},
    "poison_spray": {"id": "poison_spray", "name": "Poison Spray", "kind": "save", "damage_dice": "1d12", "damage_type": "poison", "save_ability": "con"},
    "thunderclap": {"id": "thunderclap", "name": "Thunderclap", "kind": "save", "damage_dice": "1d6", "damage_type": "thunder", "save_ability": "con", "aoe_radius_ft": 5},
    "vicious_mockery": {"id": "vicious_mockery", "name": "Vicious Mockery", "kind": "save", "damage_dice": "1d4", "damage_type": "psychic", "save_ability": "wis", "rider_tag": "disadv_next_attack"},
    "toll_the_dead": {"id": "toll_the_dead", "name": "Toll the Dead", "kind": "save", "damage_dice": "1d8", "damaged_dice": "1d12", "damage_type": "necrotic", "save_ability": "wis"},
}

CLASS_CANTRIPS: Dict[str, List[str]] = {
    "bard": ["vicious_mockery", "thunderclap"],
    "cleric": ["sacred_flame", "toll_the_dead"],
    "druid": ["produce_flame", "thorn_whip", "poison_spray", "thunderclap"],
    "sorcerer": ["fire_bolt", "ray_of_frost", "chill_touch", "acid_splash", "poison_spray", "thunderclap"],
    "warlock": ["eldritch_blast", "chill_touch", "poison_spray", "toll_the_dead"],
    "wizard": ["fire_bolt", "ray_of_frost", "chill_touch", "acid_splash", "poison_spray", "thunderclap", "toll_the_dead"],
}

# Leveled-spell fields: id, name, kind ('auto'|'spell_attack'|'save'|
# 'save_utility'|'heal'|'utility'), base_level, base_dice, damage_type,
# save_ability, half_on_save, darts (magic_missile: darts at base level),
# dart_bonus (flat bonus per dart die), add_ability_to_damage
# (spiritual_weapon damage / heal spells), applies_tag (condition spells and
# rider tags), applies_duration_rounds (catalog data for the host
# ConditionTrack), cures, ritual, area ({'shape': 'caster_burst'|
# 'target_cluster', 'default_max_targets': int}).

LEVELED_SPELLS: Dict[str, dict] = {
    "magic_missile": {"id": "magic_missile", "name": "Magic Missile", "kind": "auto", "base_level": 1, "base_dice": "1d4", "damage_type": "force", "darts": 3, "dart_bonus": 1},
    "cure_wounds": {"id": "cure_wounds", "name": "Cure Wounds", "kind": "heal", "base_level": 1, "base_dice": "1d8", "add_ability_to_damage": True},
    "healing_word": {"id": "healing_word", "name": "Healing Word", "kind": "heal", "base_level": 1, "base_dice": "1d4", "add_ability_to_damage": True},
    "guiding_bolt": {"id": "guiding_bolt", "name": "Guiding Bolt", "kind": "spell_attack", "base_level": 1, "base_dice": "4d6", "damage_type": "radiant", "applies_tag": "guided", "applies_duration_rounds": 1},
    "inflict_wounds": {"id": "inflict_wounds", "name": "Inflict Wounds", "kind": "spell_attack", "base_level": 1, "base_dice": "3d10", "damage_type": "necrotic"},
    "witch_bolt": {"id": "witch_bolt", "name": "Witch Bolt", "kind": "spell_attack", "base_level": 1, "base_dice": "1d12", "damage_type": "lightning"},
    "spiritual_weapon": {"id": "spiritual_weapon", "name": "Spiritual Weapon", "kind": "spell_attack", "base_level": 2, "base_dice": "1d8", "damage_type": "force", "add_ability_to_damage": True},
    "scorching_ray": {"id": "scorching_ray", "name": "Scorching Ray", "kind": "spell_attack", "base_level": 2, "base_dice": "2d6", "damage_type": "fire"},
    "hellish_rebuke": {"id": "hellish_rebuke", "name": "Hellish Rebuke", "kind": "save", "base_level": 1, "base_dice": "2d10", "damage_type": "fire", "save_ability": "dex", "half_on_save": True},
    "burning_hands": {"id": "burning_hands", "name": "Burning Hands", "kind": "save", "base_level": 1, "base_dice": "3d6", "damage_type": "fire", "save_ability": "dex", "half_on_save": True, "area": {"shape": "caster_burst", "default_max_targets": 6}},
    "thunderwave": {"id": "thunderwave", "name": "Thunderwave", "kind": "save", "base_level": 1, "base_dice": "2d8", "damage_type": "thunder", "save_ability": "con", "half_on_save": True, "area": {"shape": "caster_burst", "default_max_targets": 6}},
    "shatter": {"id": "shatter", "name": "Shatter", "kind": "save", "base_level": 2, "base_dice": "3d8", "damage_type": "thunder", "save_ability": "con", "half_on_save": True, "area": {"shape": "target_cluster", "default_max_targets": 6}},
    "fireball": {"id": "fireball", "name": "Fireball", "kind": "save", "base_level": 3, "base_dice": "8d6", "damage_type": "fire", "save_ability": "dex", "half_on_save": True, "area": {"shape": "target_cluster", "default_max_targets": 6}},
    "lightning_bolt": {"id": "lightning_bolt", "name": "Lightning Bolt", "kind": "save", "base_level": 3, "base_dice": "8d6", "damage_type": "lightning", "save_ability": "dex", "half_on_save": True, "area": {"shape": "caster_burst", "default_max_targets": 6}},
    "spirit_guardians": {"id": "spirit_guardians", "name": "Spirit Guardians", "kind": "save", "base_level": 3, "base_dice": "3d8", "damage_type": "radiant", "save_ability": "wis", "half_on_save": True, "area": {"shape": "caster_burst", "default_max_targets": 6}},
    "cone_of_cold": {"id": "cone_of_cold", "name": "Cone of Cold", "kind": "save", "base_level": 5, "base_dice": "8d8", "damage_type": "cold", "save_ability": "con", "half_on_save": True, "area": {"shape": "caster_burst", "default_max_targets": 6}},
    "hold_person": {"id": "hold_person", "name": "Hold Person", "kind": "save_utility", "base_level": 2, "save_ability": "wis", "applies_tag": "paralyzed", "applies_duration_rounds": 10},
    "hold_monster": {"id": "hold_monster", "name": "Hold Monster", "kind": "save_utility", "base_level": 5, "save_ability": "wis", "applies_tag": "paralyzed", "applies_duration_rounds": 10},
    "web": {"id": "web", "name": "Web", "kind": "save_utility", "base_level": 2, "save_ability": "dex", "applies_tag": "restrained", "applies_duration_rounds": 600},
    "blindness_deafness": {"id": "blindness_deafness", "name": "Blindness/Deafness", "kind": "save_utility", "base_level": 2, "save_ability": "con", "applies_tag": "blinded", "applies_duration_rounds": 10},
    "slow": {"id": "slow", "name": "Slow", "kind": "save_utility", "base_level": 3, "save_ability": "wis", "applies_tag": "slowed", "applies_duration_rounds": 10},
}

CLASS_LEVELED_SPELLS: Dict[str, List[str]] = {
    "bard": ["cure_wounds", "healing_word", "thunderwave", "blindness_deafness", "shatter", "hold_person", "hold_monster"],
    "cleric": ["cure_wounds", "healing_word", "guiding_bolt", "inflict_wounds", "blindness_deafness", "hold_person", "spiritual_weapon", "spirit_guardians"],
    "druid": ["cure_wounds", "healing_word", "thunderwave", "hold_person"],
    "paladin": ["cure_wounds"],
    "ranger": ["cure_wounds"],
    "sorcerer": ["burning_hands", "magic_missile", "thunderwave", "witch_bolt", "blindness_deafness", "hold_person", "scorching_ray", "shatter", "web", "fireball", "lightning_bolt", "slow", "cone_of_cold", "hold_monster"],
    "warlock": ["hellish_rebuke", "witch_bolt", "hold_person", "shatter", "hold_monster"],
    "wizard": ["burning_hands", "magic_missile", "thunderwave", "witch_bolt", "blindness_deafness", "hold_person", "scorching_ray", "shatter", "web", "fireball", "lightning_bolt", "slow", "cone_of_cold", "hold_monster"],
}


def _norm_id(s) -> str:
    return s.lower().strip() if isinstance(s, str) else ""


def class_can_cast(class_id, spell_id) -> bool:
    """True iff the class knows the spell/cantrip (mechanics gate, not a spellbook)."""
    cls = _norm_id(class_id)
    sid = _norm_id(spell_id)
    c = CLASS_CANTRIPS.get(cls)
    if c and sid in c:
        return True
    lst = CLASS_LEVELED_SPELLS.get(cls)
    return bool(lst and sid in lst)


# ---- Tier scaling --------------------------------------------------------------

def cantrip_dice_count(level) -> int:
    """Cantrip damage dice per caster level: 1 at 1-4, 2 at 5-10, 3 at 11-16, 4 at 17+."""
    lvl = math.floor(level) if isinstance(level, (int, float)) and not isinstance(level, bool) and math.isfinite(level) else 1
    if lvl >= 17:
        return 4
    if lvl >= 11:
        return 3
    if lvl >= 5:
        return 2
    return 1


def eldritch_blast_beams(level) -> int:
    """Eldritch Blast BEAMS per caster level (dice per beam never scale - no_scale)."""
    return cantrip_dice_count(level)


_DICE_RE = re.compile(r"^([0-9]+)d([0-9]+)([+-][0-9]+)?$")


def scaled_cantrip_dice(dice, level) -> str:
    """Scale a cantrip's base dice to the caster's tier: '1d8' at level 11 ->
    '3d8'. The flat modifier (if any) is preserved once, never scaled."""
    m = _DICE_RE.match(dice if isinstance(dice, str) else "")
    if not m:
        return dice
    count = int(m.group(1)) * cantrip_dice_count(level)
    return str(count) + "d" + m.group(2) + (m.group(3) if m.group(3) else "")


def _double_dice(dice: str) -> str:
    """Double the DICE of an equation (crit: doubled dice, flat modifier once)."""
    m = _DICE_RE.match(dice)
    if not m:
        return dice
    return str(int(m.group(1)) * 2) + "d" + m.group(2) + (m.group(3) if m.group(3) else "")


# ---- Expression / mutation shorthands ------------------------------------------

def _ex_dice(eq: str) -> dict:
    return {"type": "dice", "equation": eq}


def _ex_lit(v: int) -> dict:
    return {"type": "literal", "value": v}


def _ex_prop(target: str, prop: str) -> dict:
    return {"type": "prop_ref", "target": target, "property": prop}


def _ex_add(left: dict, right: dict) -> dict:
    return {"type": "math", "op": "add", "left": left, "right": right}


def _ex_half(e: dict) -> dict:
    return {"type": "math", "op": "floor_div", "left": e, "right": _ex_lit(2)}


def _mu_sub_hp(target: str, value: dict) -> dict:
    return {"type": "sub_prop", "target": target, "property": "hp", "value": value}


def _mu_add_tag(target: str, tag: str) -> dict:
    return {"type": "add_tag", "target": target, "tag": tag}


def _save_prop(ability) -> str:
    a = ability.lower().strip()[:3] if isinstance(ability, str) else ""
    if a in ("str", "dex", "con", "wis", "cha", "int"):
        return a + "_save"
    raise ValueError("SRD5E: unknown save ability: " + str(ability))


def _landing_condition(save_ability: str, target_ref: str) -> dict:
    """'success' on a save action = the spell LANDS (target failed). STR/DEX
    saves add the AUTO-FAIL or-arms (paralyzed/stunned/unconscious -
    srd5e_conditions AUTO_FAIL_STR_DEX, expressed in data via has_tag). Note
    the save d20 is STILL drawn in the auto-fail case (the check roll always
    evaluates) - the stream-alignment philosophy."""
    base = {"type": "delta_lte", "value": -1}
    a = save_ability.lower().strip()[:3]
    if a != "str" and a != "dex":
        return base
    return {
        "type": "or", "conditions": [
            base,
            {"type": "has_tag", "target": target_ref, "tag": "paralyzed"},
            {"type": "has_tag", "target": target_ref, "tag": "stunned"},
            {"type": "has_tag", "target": target_ref, "tag": "unconscious"},
        ],
    }


def _miss_condition() -> dict:
    """failure = miss: delta_lte -1 OR the natural 1 (auto-miss even when the
    total would beat AC). Built fresh per document (no shared aliasing)."""
    return {
        "type": "or", "conditions": [
            {"type": "delta_lte", "value": -1},
            {"type": "nat_roll_lte", "value": 1},
        ],
    }


def _attack_check(atk_prop: str, hit_muts: List[dict], crit_muts: List[dict]) -> dict:
    """The shared attack-roll check shape: roll = 1d20 + atk_prop vs dc =
    target.ac; crit = nat 20 (tested first - auto-hit), hit excludes nat 1,
    miss tags actor."""
    return {
        "type": "check",
        "roll": _ex_add(_ex_dice("1d20"), _ex_prop("actor", atk_prop)),
        "dc": _ex_prop("target", "ac"),
        "degrees": {
            "critical_success": {"condition": {"type": "nat_roll_eq", "value": 20}, "mutations": crit_muts},
            "success": {
                "condition": {
                    "type": "and", "conditions": [
                        {"type": "delta_gte", "value": 0},
                        {"type": "nat_roll_gte", "value": 2},
                    ],
                },
                "mutations": hit_muts,
            },
            "failure": {"condition": _miss_condition(), "mutations": [_mu_add_tag("actor", "missed")]},
        },
    }


# ---- Action document builders ---------------------------------------------------

def build_weapon_attack_check(opts) -> dict:
    """Weapon attack: roll = 1d20 + actor.<modProp> vs target.ac; damage =
    weapon die (+ the same mod when addModToDamage); crit doubles the DICE,
    mod once. Finesse max(STR, DEX) is NOT expressible (no max op) - hosts
    pick the str_mod or dex_mod variant. No min-0 clamp on a negative mod
    (documented cut). `opts` keys: modProp / damageDice / addModToDamage."""
    if not isinstance(opts, dict) or opts.get("modProp") not in ("str_mod", "dex_mod"):
        raise ValueError("SRD5E: weapon attack modProp must be str_mod or dex_mod")
    damage_dice = opts.get("damageDice")
    if not isinstance(damage_dice, str) or not _DICE_RE.match(damage_dice):
        raise ValueError("SRD5E: invalid weapon damage dice: " + str(damage_dice))
    mod_prop = opts["modProp"]
    add_mod = bool(opts.get("addModToDamage"))
    if add_mod:
        hit_val = _ex_add(_ex_dice(damage_dice), _ex_prop("actor", mod_prop))
        crit_val = _ex_add(_ex_dice(_double_dice(damage_dice)), _ex_prop("actor", mod_prop))
    else:
        hit_val = _ex_dice(damage_dice)
        crit_val = _ex_dice(_double_dice(damage_dice))
    return _attack_check(mod_prop, [_mu_sub_hp("target", hit_val)], [_mu_sub_hp("target", crit_val)])


def build_attack_cantrip_check(cantrip_id, caster_level, opts=None) -> dict:
    """Attack cantrip (fire_bolt family): 1d20 + actor.spell_atk vs target.ac;
    FLAT tier-scaled dice (no mod - the 5e cantrip rule); riders as add_tag in
    the hit branches. ONE document = ONE beam for eldritch_blast - callers
    loop eldritch_blast_beams(level) times (each beam is a full attack roll).
    `agonizing` (default OFF - SRD-true) adds actor.cha_mod per beam; it only
    applies to eldritch_blast and is ignored elsewhere."""
    cid = _norm_id(cantrip_id)
    d = CANTRIPS.get(cid)
    if not d or d["kind"] != "spell_attack":
        raise ValueError("SRD5E: unknown attack cantrip: " + str(cantrip_id))
    hit_dice = d["damage_dice"] if d.get("no_scale") else scaled_cantrip_dice(d["damage_dice"], caster_level)
    crit_dice = _double_dice(hit_dice)
    agonizing = bool(opts and opts.get("agonizing")) and cid == "eldritch_blast"
    if agonizing:
        hit_val = _ex_add(_ex_dice(hit_dice), _ex_prop("actor", "cha_mod"))
        crit_val = _ex_add(_ex_dice(crit_dice), _ex_prop("actor", "cha_mod"))
    else:
        hit_val = _ex_dice(hit_dice)
        crit_val = _ex_dice(crit_dice)
    hit_muts = [_mu_sub_hp("target", hit_val)]
    crit_muts = [_mu_sub_hp("target", crit_val)]
    if d.get("rider_tag"):
        hit_muts.append(_mu_add_tag("target", d["rider_tag"]))
        crit_muts.append(_mu_add_tag("target", d["rider_tag"]))
    return _attack_check("spell_atk", hit_muts, crit_muts)


def build_save_cantrip_check(cantrip_id, caster_level) -> dict:
    """Save cantrip (sacred_flame family): roll = 1d20 + target.<save> vs
    dc = actor.spell_dc. 'success' = the spell LANDS (target failed, or a
    STR/DEX auto-fail tag); 'failure' = the target saved (save cantrips deal
    nothing on a save). toll_the_dead upgrades its die against a damaged
    target via a LIVE if-compare on hp < hp_max (no caller-supplied flag)."""
    cid = _norm_id(cantrip_id)
    d = CANTRIPS.get(cid)
    if not d or d["kind"] != "save" or not d.get("save_ability"):
        raise ValueError("SRD5E: unknown save cantrip: " + str(cantrip_id))
    if d.get("damaged_dice"):
        land_muts = [{
            "type": "if",
            "condition": {
                "type": "compare", "op": "lt",
                "left": {"source": "prop", "target": "target", "property": "hp"},
                "right": {"source": "prop", "target": "target", "property": "hp_max"},
            },
            "then": [_mu_sub_hp("target", _ex_dice(scaled_cantrip_dice(d["damaged_dice"], caster_level)))],
            "else": [_mu_sub_hp("target", _ex_dice(scaled_cantrip_dice(d["damage_dice"], caster_level)))],
        }]
    else:
        land_muts = [_mu_sub_hp("target", _ex_dice(scaled_cantrip_dice(d["damage_dice"], caster_level)))]
        if d.get("rider_tag"):
            land_muts.append(_mu_add_tag("target", d["rider_tag"]))
    return {
        "type": "check",
        "roll": _ex_add(_ex_dice("1d20"), _ex_prop("target", _save_prop(d["save_ability"]))),
        "dc": _ex_prop("actor", "spell_dc"),
        "degrees": {
            "success": {"condition": _landing_condition(d["save_ability"], "target"), "mutations": land_muts},
            "failure": {"condition": {"type": "delta_gte", "value": 0}, "mutations": []},
        },
    }


def build_attack_spell_check(spell_id, cast_slot_level) -> dict:
    """Attack spell (guiding_bolt family): the weapon-attack shape with
    spell_atk vs target.ac; damage dice from total_dice_for_cast per slot
    level; crit doubles dice; spiritual_weapon alone adds actor.spell_mod
    (the one SRD attack spell that does). scorching_ray returns ONE ray -
    host loops upcast_effect extra_instances + 3 rays (the eldritch_blast
    pattern, RAW per-ray)."""
    sid = _norm_id(spell_id)
    d = LEVELED_SPELLS.get(sid)
    if not d or d["kind"] != "spell_attack" or not d.get("base_dice"):
        raise ValueError("SRD5E: unknown attack spell: " + str(spell_id))
    hit_dice = total_dice_for_cast(d["base_dice"], sid, cast_slot_level)
    crit_dice = _double_dice(hit_dice)
    if d.get("add_ability_to_damage"):
        hit_val = _ex_add(_ex_dice(hit_dice), _ex_prop("actor", "spell_mod"))
        crit_val = _ex_add(_ex_dice(crit_dice), _ex_prop("actor", "spell_mod"))
    else:
        hit_val = _ex_dice(hit_dice)
        crit_val = _ex_dice(crit_dice)
    hit_muts = [_mu_sub_hp("target", hit_val)]
    crit_muts = [_mu_sub_hp("target", crit_val)]
    if d.get("applies_tag"):
        hit_muts.append(_mu_add_tag("target", d["applies_tag"]))
        crit_muts.append(_mu_add_tag("target", d["applies_tag"]))
    return _attack_check("spell_atk", hit_muts, crit_muts)


def build_save_spell_check(spell_id, cast_slot_level) -> dict:
    """Single-target save spell (hellish_rebuke shape): 'success' = target
    FAILED (full dice); 'failure' = target saved (half via floor_div when
    half_on_save). The half branch rolls its OWN fresh dice - only the taken
    branch rolls (no value bindings in v2); the divergence from
    roll-then-halve is invisible in distribution except the halved roll's
    granularity."""
    sid = _norm_id(spell_id)
    d = LEVELED_SPELLS.get(sid)
    if not d or d["kind"] != "save" or not d.get("base_dice") or not d.get("save_ability"):
        raise ValueError("SRD5E: unknown save spell: " + str(spell_id))
    full = total_dice_for_cast(d["base_dice"], sid, cast_slot_level)
    saved_muts = [_mu_sub_hp("target", _ex_half(_ex_dice(full)))] if d.get("half_on_save") else []
    return {
        "type": "check",
        "roll": _ex_add(_ex_dice("1d20"), _ex_prop("target", _save_prop(d["save_ability"]))),
        "dc": _ex_prop("actor", "spell_dc"),
        "degrees": {
            "success": {"condition": _landing_condition(d["save_ability"], "target"), "mutations": [_mu_sub_hp("target", _ex_dice(full))]},
            "failure": {"condition": {"type": "delta_gte", "value": 0}, "mutations": saved_muts},
        },
    }


def build_multi_target_save_trigger(spell_id, cast_slot_level, opts=None) -> List[dict]:
    """THE multi-target save (fireball family) - the spec 6.6 blessed idiom
    (vector E6): every selected target rolls its OWN save into the
    'save_roll' scratch prop, then full damage on a fail / floor_div half on
    a save, each with FRESH dice (one shared damage roll is NOT expressible
    in v2 - no value bindings; a v3 let-binding unlocks RAW). The HOST paints
    `selectTag` before evaluation and clears it after; `maxTargets` is an
    enumeration ceiling. `opts` keys: selectTag / maxTargets."""
    sid = _norm_id(spell_id)
    d = LEVELED_SPELLS.get(sid)
    if not d or d["kind"] != "save" or not d.get("base_dice") or not d.get("save_ability") or not d.get("area"):
        raise ValueError("SRD5E: not a multi-target save spell: " + str(spell_id))
    tag = "in_blast"
    if opts and isinstance(opts.get("selectTag"), str) and len(opts["selectTag"]) > 0:
        tag = opts["selectTag"]
    limit = d["area"]["default_max_targets"]
    if opts and opts.get("maxTargets") is not None:
        mt = opts["maxTargets"]
        if not isinstance(mt, int) or isinstance(mt, bool) or mt < 1 or mt > 32:
            raise ValueError("SRD5E: maxTargets must be an integer in 1..32")
        limit = mt
    full = total_dice_for_cast(d["base_dice"], sid, cast_slot_level)
    fail_arms = [{
        "type": "compare", "op": "lt",
        "left": {"source": "prop", "target": "each", "property": "save_roll"},
        "right": {"source": "prop", "target": "actor", "property": "spell_dc"},
    }]
    a = d["save_ability"].lower().strip()[:3]
    if a in ("str", "dex"):
        fail_arms.append({"type": "has_tag", "target": "each", "tag": "paralyzed"})
        fail_arms.append({"type": "has_tag", "target": "each", "tag": "stunned"})
        fail_arms.append({"type": "has_tag", "target": "each", "tag": "unconscious"})
    return [{
        "type": "foreach_target",
        "select": {"tag": tag, "limit": limit},
        "mutations": [
            {
                "type": "set_prop", "target": "each", "property": "save_roll",
                "value": _ex_add(_ex_dice("1d20"), _ex_prop("each", _save_prop(d["save_ability"]))),
            },
            {
                "type": "if",
                "condition": {"type": "or", "conditions": fail_arms},
                "then": [_mu_sub_hp("each", _ex_dice(full))],
                "else": [_mu_sub_hp("each", _ex_half(_ex_dice(full)))] if d.get("half_on_save") else [],
            },
        ],
    }]


def build_magic_missile_trigger(cast_slot_level) -> List[dict]:
    """Magic Missile: auto-hit is the ABSENCE of a check - a trigger of
    repeat(darts) { sub_prop target.hp 1d4+1 } (spec vector F1 literally).
    Darts: 3 at L1 + 1 per slot level above (upcast_effect extra_instances);
    per-dart fresh rolls are 5e RAW-compatible."""
    d = LEVELED_SPELLS["magic_missile"]
    info = upcast_effect("magic_missile", cast_slot_level)
    darts = d["darts"] + (info["extra_instances"] if info else 0)
    dart_eq = d["base_dice"] + "+" + str(d["dart_bonus"])
    return [{
        "type": "repeat", "count": darts,
        "mutations": [_mu_sub_hp("target", _ex_dice(dart_eq))],
    }]


def build_heal_trigger(spell_id, cast_slot_level) -> List[dict]:
    """Heal (cure_wounds / healing_word): add_prop target.hp (dice +
    actor.spell_mod), then the hp_max overheal clamp via if-compare (hp_max
    is already convention). The min-1 heal clamp variant is documented, not
    shipped (simple form)."""
    sid = _norm_id(spell_id)
    d = LEVELED_SPELLS.get(sid)
    if not d or d["kind"] != "heal" or not d.get("base_dice"):
        raise ValueError("SRD5E: unknown heal spell: " + str(spell_id))
    heal_dice = total_dice_for_cast(d["base_dice"], sid, cast_slot_level)
    return [
        {"type": "add_prop", "target": "target", "property": "hp",
         "value": _ex_add(_ex_dice(heal_dice), _ex_prop("actor", "spell_mod"))},
        {
            "type": "if",
            "condition": {
                "type": "compare", "op": "gt",
                "left": {"source": "prop", "target": "target", "property": "hp"},
                "right": {"source": "prop", "target": "target", "property": "hp_max"},
            },
            "then": [{"type": "set_prop", "target": "target", "property": "hp",
                      "value": _ex_prop("target", "hp_max")}],
        },
    ]


def build_condition_spell_check(spell_id, cast_slot_level) -> dict:
    """Condition spell (hold_person family): save vs spell_dc; the condition
    tag lands on a failed save (with the STR/DEX auto-fail or-arm where it
    applies, e.g. web); ZERO damage by construction. Duration is catalog data
    (applies_duration_rounds) for the host's ConditionTrack - never in the
    AST. Upcast extra targets are host enumeration (extra single-target
    checks or a wider painted selection), per the catalog note. The document
    is slot-invariant; upcast = more targets (host-side)."""
    sid = _norm_id(spell_id)
    d = LEVELED_SPELLS.get(sid)
    if not d or d["kind"] != "save_utility" or not d.get("save_ability") or not d.get("applies_tag"):
        raise ValueError("SRD5E: unknown condition spell: " + str(spell_id))
    _ = cast_slot_level  # the document is slot-invariant; upcast = more targets (host-side)
    return {
        "type": "check",
        "roll": _ex_add(_ex_dice("1d20"), _ex_prop("target", _save_prop(d["save_ability"]))),
        "dc": _ex_prop("actor", "spell_dc"),
        "degrees": {
            "success": {"condition": _landing_condition(d["save_ability"], "target"), "mutations": [_mu_add_tag("target", d["applies_tag"])]},
            "failure": {"condition": {"type": "delta_gte", "value": 0}, "mutations": []},
        },
    }


# ---- Cast economy (dice-free) ----------------------------------------------------

def plan_leveled_cast(slots, spell_id, class_id, requested_slot_level=None) -> dict:
    """The economy half of a cast, with ZERO dice: catalog gate, class gate,
    clamp the requested level into base..MAX_SLOT_LEVEL, spend the lowest
    available slot (auto-upcast when the base tier is dry), and surface the
    concentration flag. Dice happen in the AST evaluation that follows; the
    host sequence is plan -> evaluate_action(doc) -> start_concentration.
    Pure: the input pool is never mutated.

    Returns {'ok', 'reason' ('ok'|'no_slot'|'not_known'|'not_a_caster'),
    'slots', 'slot_level', 'concentration_spell', 'spell_name'}."""
    sid = _norm_id(spell_id)
    d = LEVELED_SPELLS.get(sid)
    if not d:
        return {"ok": False, "reason": "not_known", "slots": copy.deepcopy(slots),
                "slot_level": None, "concentration_spell": None, "spell_name": sid}
    if caster_kind(class_id) is None:
        return {"ok": False, "reason": "not_a_caster", "slots": copy.deepcopy(slots),
                "slot_level": None, "concentration_spell": None, "spell_name": d["name"]}
    lst = CLASS_LEVELED_SPELLS.get(_norm_id(class_id))
    if not lst or sid not in lst:
        return {"ok": False, "reason": "not_known", "slots": copy.deepcopy(slots),
                "slot_level": None, "concentration_spell": None, "spell_name": d["name"]}
    base = spell_base_level(sid)
    if base is None:
        base = d["base_level"]
    if isinstance(requested_slot_level, (int, float)) and not isinstance(requested_slot_level, bool) \
            and math.isfinite(requested_slot_level):
        want = math.floor(requested_slot_level)
    else:
        want = base
    if want < base:
        want = base
    if want > MAX_SLOT_LEVEL:
        want = MAX_SLOT_LEVEL
    spend = spend_lowest_available(slots, want)
    if not spend["ok"]:
        return {"ok": False, "reason": "no_slot", "slots": spend["slots"],
                "slot_level": None, "concentration_spell": None, "spell_name": d["name"]}
    conc = sid if spell_requires_concentration(sid) else None
    return {"ok": True, "reason": "ok", "slots": spend["slots"], "slot_level": spend["slot_level"],
            "concentration_spell": conc, "spell_name": d["name"]}
