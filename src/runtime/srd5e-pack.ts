// srd5e-pack.ts - SRD 5.1 action content pack: mechanics-only cantrip +
// leveled-spell catalogs, AST v2 document BUILDERS, and planLeveledCast (the
// dice-free economy half of a cast).
//
// The catalogs ship MECHANICS ONLY - no flavor prose, no narration strings.
// Riders are structured rider_tag data the host narrates itself. Builders are
// pure functions emitting CheckNode / MutationNode[] per spell id + tier /
// slot level (AST v2 documents are unparametrized, so each tier/slot is its
// own concrete document). Every emitted document passes validateCheck /
// validateTriggeredMutations - the pack test gates on it.
//
// PROPERTY-NAME CONVENTION (the contract between pack documents and host
// world states):
//   actor props:  str_mod / dex_mod / cha_mod / spell_atk / spell_dc / spell_mod
//   target props: hp / hp_max / ac / str_save / dex_save / con_save /
//                 wis_save / cha_save
//   condition tags: paralyzed / stunned / unconscious / restrained / poisoned /
//                 frightened / prone (see srd5e-conditions.ts)
//   selection tags: host-painted multi-target scopes (default 'in_blast') -
//                 the HOST paints the tag before evaluation and clears it
//                 after (the caller-enumerates contract).
//   scratch props: 'save_roll' (the spec 6.6 per-target-save idiom; persists
//                 in worldStateHash as a permanent, reused slot).
//
// Degree-slot semantics are mapping conventions: 'success' = the CASTER lands
// the action (on save spells that means the target FAILED its save). The
// nat-1 auto-miss lands in the failure degree via an or-arm (delta_lte -1 OR
// nat_roll_lte 1); nat-20 auto-hit falls out of degree order (the crit branch
// is tested first regardless of delta).
//
// Known AST v2 limits, deliberately NOT worked around (host-side or v3):
//   - advantage/disadvantage second-d20 (no max/min op) - srd5e-conditions
//     computes the MODE only.
//   - finesse max(STR, DEX) - ship str and dex variants, host picks.
//   - one SHARED damage roll across multi-target saves (no value bindings) -
//     per-target fresh rolls are the spec-blessed v2 idiom and what ships.
//   - rider/condition DURATIONS - catalog data for the host's ConditionTrack
//     (ruleset.ts tickConditions), never in the AST.
//   - min-0 damage clamp on negative mods / min-1 heal clamp - documents ship
//     the simple form (the clamp needs the scratch-prop if idiom; hosts that
//     need it can wrap).
//
// Content: mechanics from the D&D 5e System Reference Document 5.1
// (CC-BY-4.0) - see NOTICE.md. TWT-specific tuning is caller config with
// neutral defaults (agonizing default-off; selectTag/maxTargets caller-
// supplied; scorching_ray ships RAW per-ray).
//
// Code style: var-only, no arrow functions.

import type { CheckNode, MutationNode, DegreeCond, ExprNode } from './ruleset-ast.js';
import {
  MAX_SLOT_LEVEL, casterKind, spendLowestAvailable, spellBaseLevel,
  spellRequiresConcentration, totalDiceForCast, upcastEffect,
} from './srd5e-spell-slots.js';
import type { SlotPool } from './srd5e-spell-slots.js';

// ---- Catalogs ----------------------------------------------------------------

export interface CantripDef {
  id: string;
  name: string;
  kind: 'spell_attack' | 'save';
  damage_dice: string;
  damaged_dice?: string;      // toll_the_dead: the die used when target.hp < target.hp_max
  damage_type: string;
  save_ability?: string;      // save cantrips: 'dex' | 'con' | 'wis'
  beams?: boolean;            // eldritch_blast: beam count scales, not dice
  no_scale?: boolean;         // eldritch_blast: per-beam dice never tier-scale
  rider_tag?: string;         // structured rider (host narrates + tracks duration)
  aoe_radius_ft?: number;
}

export var CANTRIPS: { [id: string]: CantripDef } = {
  fire_bolt: { id: 'fire_bolt', name: 'Fire Bolt', kind: 'spell_attack', damage_dice: '1d10', damage_type: 'fire' },
  produce_flame: { id: 'produce_flame', name: 'Produce Flame', kind: 'spell_attack', damage_dice: '1d8', damage_type: 'fire' },
  ray_of_frost: { id: 'ray_of_frost', name: 'Ray of Frost', kind: 'spell_attack', damage_dice: '1d8', damage_type: 'cold', rider_tag: 'slowed_10ft' },
  chill_touch: { id: 'chill_touch', name: 'Chill Touch', kind: 'spell_attack', damage_dice: '1d8', damage_type: 'necrotic', rider_tag: 'no_heal' },
  thorn_whip: { id: 'thorn_whip', name: 'Thorn Whip', kind: 'spell_attack', damage_dice: '1d6', damage_type: 'piercing', rider_tag: 'pulled_10ft' },
  eldritch_blast: { id: 'eldritch_blast', name: 'Eldritch Blast', kind: 'spell_attack', damage_dice: '1d10', damage_type: 'force', beams: true, no_scale: true },
  sacred_flame: { id: 'sacred_flame', name: 'Sacred Flame', kind: 'save', damage_dice: '1d8', damage_type: 'radiant', save_ability: 'dex' },
  acid_splash: { id: 'acid_splash', name: 'Acid Splash', kind: 'save', damage_dice: '1d6', damage_type: 'acid', save_ability: 'dex', aoe_radius_ft: 5 },
  poison_spray: { id: 'poison_spray', name: 'Poison Spray', kind: 'save', damage_dice: '1d12', damage_type: 'poison', save_ability: 'con' },
  thunderclap: { id: 'thunderclap', name: 'Thunderclap', kind: 'save', damage_dice: '1d6', damage_type: 'thunder', save_ability: 'con', aoe_radius_ft: 5 },
  vicious_mockery: { id: 'vicious_mockery', name: 'Vicious Mockery', kind: 'save', damage_dice: '1d4', damage_type: 'psychic', save_ability: 'wis', rider_tag: 'disadv_next_attack' },
  toll_the_dead: { id: 'toll_the_dead', name: 'Toll the Dead', kind: 'save', damage_dice: '1d8', damaged_dice: '1d12', damage_type: 'necrotic', save_ability: 'wis' },
};

export var CLASS_CANTRIPS: { [classId: string]: string[] } = {
  bard: ['vicious_mockery', 'thunderclap'],
  cleric: ['sacred_flame', 'toll_the_dead'],
  druid: ['produce_flame', 'thorn_whip', 'poison_spray', 'thunderclap'],
  sorcerer: ['fire_bolt', 'ray_of_frost', 'chill_touch', 'acid_splash', 'poison_spray', 'thunderclap'],
  warlock: ['eldritch_blast', 'chill_touch', 'poison_spray', 'toll_the_dead'],
  wizard: ['fire_bolt', 'ray_of_frost', 'chill_touch', 'acid_splash', 'poison_spray', 'thunderclap', 'toll_the_dead'],
};

export interface LeveledDef {
  id: string;
  name: string;
  kind: 'auto' | 'spell_attack' | 'save' | 'save_utility' | 'heal' | 'utility';
  base_level: number;
  base_dice?: string;
  damage_type?: string;
  save_ability?: string;
  half_on_save?: boolean;
  darts?: number;             // magic_missile: darts at base level
  dart_bonus?: number;        // magic_missile: flat bonus per dart die
  add_ability_to_damage?: boolean; // spiritual_weapon damage / heal spells
  applies_tag?: string;       // condition spells (and rider tags)
  applies_duration_rounds?: number; // catalog data for the host ConditionTrack
  cures?: string[];
  ritual?: boolean;
  area?: { shape: 'caster_burst' | 'target_cluster'; default_max_targets: number };
}

export var LEVELED_SPELLS: { [id: string]: LeveledDef } = {
  magic_missile: { id: 'magic_missile', name: 'Magic Missile', kind: 'auto', base_level: 1, base_dice: '1d4', damage_type: 'force', darts: 3, dart_bonus: 1 },
  cure_wounds: { id: 'cure_wounds', name: 'Cure Wounds', kind: 'heal', base_level: 1, base_dice: '1d8', add_ability_to_damage: true },
  healing_word: { id: 'healing_word', name: 'Healing Word', kind: 'heal', base_level: 1, base_dice: '1d4', add_ability_to_damage: true },
  guiding_bolt: { id: 'guiding_bolt', name: 'Guiding Bolt', kind: 'spell_attack', base_level: 1, base_dice: '4d6', damage_type: 'radiant', applies_tag: 'guided', applies_duration_rounds: 1 },
  inflict_wounds: { id: 'inflict_wounds', name: 'Inflict Wounds', kind: 'spell_attack', base_level: 1, base_dice: '3d10', damage_type: 'necrotic' },
  witch_bolt: { id: 'witch_bolt', name: 'Witch Bolt', kind: 'spell_attack', base_level: 1, base_dice: '1d12', damage_type: 'lightning' },
  spiritual_weapon: { id: 'spiritual_weapon', name: 'Spiritual Weapon', kind: 'spell_attack', base_level: 2, base_dice: '1d8', damage_type: 'force', add_ability_to_damage: true },
  scorching_ray: { id: 'scorching_ray', name: 'Scorching Ray', kind: 'spell_attack', base_level: 2, base_dice: '2d6', damage_type: 'fire' },
  hellish_rebuke: { id: 'hellish_rebuke', name: 'Hellish Rebuke', kind: 'save', base_level: 1, base_dice: '2d10', damage_type: 'fire', save_ability: 'dex', half_on_save: true },
  burning_hands: { id: 'burning_hands', name: 'Burning Hands', kind: 'save', base_level: 1, base_dice: '3d6', damage_type: 'fire', save_ability: 'dex', half_on_save: true, area: { shape: 'caster_burst', default_max_targets: 6 } },
  thunderwave: { id: 'thunderwave', name: 'Thunderwave', kind: 'save', base_level: 1, base_dice: '2d8', damage_type: 'thunder', save_ability: 'con', half_on_save: true, area: { shape: 'caster_burst', default_max_targets: 6 } },
  shatter: { id: 'shatter', name: 'Shatter', kind: 'save', base_level: 2, base_dice: '3d8', damage_type: 'thunder', save_ability: 'con', half_on_save: true, area: { shape: 'target_cluster', default_max_targets: 6 } },
  fireball: { id: 'fireball', name: 'Fireball', kind: 'save', base_level: 3, base_dice: '8d6', damage_type: 'fire', save_ability: 'dex', half_on_save: true, area: { shape: 'target_cluster', default_max_targets: 6 } },
  lightning_bolt: { id: 'lightning_bolt', name: 'Lightning Bolt', kind: 'save', base_level: 3, base_dice: '8d6', damage_type: 'lightning', save_ability: 'dex', half_on_save: true, area: { shape: 'caster_burst', default_max_targets: 6 } },
  spirit_guardians: { id: 'spirit_guardians', name: 'Spirit Guardians', kind: 'save', base_level: 3, base_dice: '3d8', damage_type: 'radiant', save_ability: 'wis', half_on_save: true, area: { shape: 'caster_burst', default_max_targets: 6 } },
  cone_of_cold: { id: 'cone_of_cold', name: 'Cone of Cold', kind: 'save', base_level: 5, base_dice: '8d8', damage_type: 'cold', save_ability: 'con', half_on_save: true, area: { shape: 'caster_burst', default_max_targets: 6 } },
  hold_person: { id: 'hold_person', name: 'Hold Person', kind: 'save_utility', base_level: 2, save_ability: 'wis', applies_tag: 'paralyzed', applies_duration_rounds: 10 },
  hold_monster: { id: 'hold_monster', name: 'Hold Monster', kind: 'save_utility', base_level: 5, save_ability: 'wis', applies_tag: 'paralyzed', applies_duration_rounds: 10 },
  web: { id: 'web', name: 'Web', kind: 'save_utility', base_level: 2, save_ability: 'dex', applies_tag: 'restrained', applies_duration_rounds: 600 },
  blindness_deafness: { id: 'blindness_deafness', name: 'Blindness/Deafness', kind: 'save_utility', base_level: 2, save_ability: 'con', applies_tag: 'blinded', applies_duration_rounds: 10 },
  slow: { id: 'slow', name: 'Slow', kind: 'save_utility', base_level: 3, save_ability: 'wis', applies_tag: 'slowed', applies_duration_rounds: 10 },
};

export var CLASS_LEVELED_SPELLS: { [classId: string]: string[] } = {
  bard: ['cure_wounds', 'healing_word', 'thunderwave', 'blindness_deafness', 'shatter', 'hold_person', 'hold_monster'],
  cleric: ['cure_wounds', 'healing_word', 'guiding_bolt', 'inflict_wounds', 'blindness_deafness', 'hold_person', 'spiritual_weapon', 'spirit_guardians'],
  druid: ['cure_wounds', 'healing_word', 'thunderwave', 'hold_person'],
  paladin: ['cure_wounds'],
  ranger: ['cure_wounds'],
  sorcerer: ['burning_hands', 'magic_missile', 'thunderwave', 'witch_bolt', 'blindness_deafness', 'hold_person', 'scorching_ray', 'shatter', 'web', 'fireball', 'lightning_bolt', 'slow', 'cone_of_cold', 'hold_monster'],
  warlock: ['hellish_rebuke', 'witch_bolt', 'hold_person', 'shatter', 'hold_monster'],
  wizard: ['burning_hands', 'magic_missile', 'thunderwave', 'witch_bolt', 'blindness_deafness', 'hold_person', 'scorching_ray', 'shatter', 'web', 'fireball', 'lightning_bolt', 'slow', 'cone_of_cold', 'hold_monster'],
};

function normId(s: string): string {
  return typeof s === 'string' ? s.toLowerCase().trim() : '';
}

// True iff the class knows the spell/cantrip (mechanics gate, not a spellbook).
export function classCanCast(classId: string, spellId: string): boolean {
  var cls = normId(classId);
  var id = normId(spellId);
  var c = CLASS_CANTRIPS[cls];
  if (c && c.indexOf(id) >= 0) return true;
  var l = CLASS_LEVELED_SPELLS[cls];
  return !!(l && l.indexOf(id) >= 0);
}

// ---- Tier scaling --------------------------------------------------------------

// Cantrip damage dice per caster level: 1 at 1-4, 2 at 5-10, 3 at 11-16, 4 at 17+.
export function cantripDiceCount(level: number): number {
  var lvl = typeof level === 'number' && isFinite(level) ? Math.floor(level) : 1;
  if (lvl >= 17) return 4;
  if (lvl >= 11) return 3;
  if (lvl >= 5) return 2;
  return 1;
}

// Eldritch Blast BEAMS per caster level (dice per beam never scale - no_scale).
export function eldritchBlastBeams(level: number): number {
  return cantripDiceCount(level);
}

var DICE_RE = /^([0-9]+)d([0-9]+)([+-][0-9]+)?$/;

// Scale a cantrip's base dice to the caster's tier: '1d8' at level 11 -> '3d8'.
// The flat modifier (if any) is preserved once, never scaled.
export function scaledCantripDice(dice: string, level: number): string {
  var m = DICE_RE.exec(typeof dice === 'string' ? dice : '');
  if (!m) return dice;
  var count = parseInt(m[1] as string, 10) * cantripDiceCount(level);
  return String(count) + 'd' + m[2] + (m[3] ? m[3] : '');
}

// Double the DICE of an equation (crit: doubled dice, flat modifier once).
function doubleDice(dice: string): string {
  var m = DICE_RE.exec(dice);
  if (!m) return dice;
  return String(parseInt(m[1] as string, 10) * 2) + 'd' + m[2] + (m[3] ? m[3] : '');
}

// ---- Expression / mutation shorthands ------------------------------------------

function exDice(eq: string): ExprNode { return { type: 'dice', equation: eq }; }
function exLit(v: number): ExprNode { return { type: 'literal', value: v }; }
function exProp(target: string, property: string): ExprNode {
  return { type: 'prop_ref', target: target, property: property };
}
function exAdd(left: ExprNode, right: ExprNode): ExprNode {
  return { type: 'math', op: 'add', left: left, right: right };
}
function exHalf(e: ExprNode): ExprNode {
  return { type: 'math', op: 'floor_div', left: e, right: exLit(2) };
}
function muSubHp(target: string, value: ExprNode): MutationNode {
  return { type: 'sub_prop', target: target, property: 'hp', value: value };
}
function muAddTag(target: string, tag: string): MutationNode {
  return { type: 'add_tag', target: target, tag: tag };
}

function saveProp(ability: string): string {
  var a = typeof ability === 'string' ? ability.toLowerCase().trim().slice(0, 3) : '';
  if (a === 'str' || a === 'dex' || a === 'con' || a === 'wis' || a === 'cha' || a === 'int') {
    return a + '_save';
  }
  throw new Error('SRD5E: unknown save ability: ' + ability);
}

// 'success' on a save action = the spell LANDS (target failed). STR/DEX saves
// add the AUTO-FAIL or-arms (paralyzed/stunned/unconscious - srd5e-conditions
// AUTO_FAIL_STR_DEX, expressed in data via has_tag). Note the save d20 is
// STILL drawn in the auto-fail case (the check roll always evaluates) - the
// stream-alignment philosophy.
function landingCondition(saveAbility: string, targetRef: string): DegreeCond {
  var base: DegreeCond = { type: 'delta_lte', value: -1 };
  var a = saveAbility.toLowerCase().trim().slice(0, 3);
  if (a !== 'str' && a !== 'dex') return base;
  return {
    type: 'or', conditions: [
      base,
      { type: 'has_tag', target: targetRef, tag: 'paralyzed' },
      { type: 'has_tag', target: targetRef, tag: 'stunned' },
      { type: 'has_tag', target: targetRef, tag: 'unconscious' },
    ],
  };
}

// failure = miss: delta_lte -1 OR the natural 1 (auto-miss even when the
// total would beat AC).
var MISS_CONDITION: DegreeCond = {
  type: 'or', conditions: [
    { type: 'delta_lte', value: -1 },
    { type: 'nat_roll_lte', value: 1 },
  ],
};

// The shared attack-roll check shape: roll = 1d20 + atkProp vs dc = target.ac;
// crit = nat 20 (tested first - auto-hit), hit excludes nat 1, miss tags actor.
function attackCheck(atkProp: string, hitMuts: MutationNode[], critMuts: MutationNode[]): CheckNode {
  return {
    type: 'check',
    roll: exAdd(exDice('1d20'), exProp('actor', atkProp)),
    dc: exProp('target', 'ac'),
    degrees: {
      critical_success: { condition: { type: 'nat_roll_eq', value: 20 }, mutations: critMuts },
      success: {
        condition: {
          type: 'and', conditions: [
            { type: 'delta_gte', value: 0 },
            { type: 'nat_roll_gte', value: 2 },
          ],
        },
        mutations: hitMuts,
      },
      failure: { condition: MISS_CONDITION, mutations: [muAddTag('actor', 'missed')] },
    },
  };
}

// ---- Action document builders ---------------------------------------------------

// Weapon attack: roll = 1d20 + actor.<modProp> vs target.ac; damage = weapon
// die (+ the same mod when addModToDamage); crit doubles the DICE, mod once.
// Finesse max(STR, DEX) is NOT expressible (no max op) - hosts pick the
// str_mod or dex_mod variant. No min-0 clamp on a negative mod (documented cut).
export function buildWeaponAttackCheck(opts: { modProp: string; damageDice: string; addModToDamage: boolean }): CheckNode {
  if (!opts || (opts.modProp !== 'str_mod' && opts.modProp !== 'dex_mod')) {
    throw new Error('SRD5E: weapon attack modProp must be str_mod or dex_mod');
  }
  if (!DICE_RE.exec(opts.damageDice)) {
    throw new Error('SRD5E: invalid weapon damage dice: ' + opts.damageDice);
  }
  var hitVal: ExprNode = opts.addModToDamage
    ? exAdd(exDice(opts.damageDice), exProp('actor', opts.modProp))
    : exDice(opts.damageDice);
  var critVal: ExprNode = opts.addModToDamage
    ? exAdd(exDice(doubleDice(opts.damageDice)), exProp('actor', opts.modProp))
    : exDice(doubleDice(opts.damageDice));
  return attackCheck(opts.modProp, [muSubHp('target', hitVal)], [muSubHp('target', critVal)]);
}

// Attack cantrip (fire_bolt family): 1d20 + actor.spell_atk vs target.ac;
// FLAT tier-scaled dice (no mod - the 5e cantrip rule); riders as add_tag in
// the hit branches. ONE document = ONE beam for eldritch_blast - callers loop
// eldritchBlastBeams(level) times (each beam is a full attack roll).
// `agonizing` (default OFF - SRD-true) adds actor.cha_mod per beam; it only
// applies to eldritch_blast and is ignored elsewhere.
export function buildAttackCantripCheck(cantripId: string, casterLevel: number, opts?: { agonizing?: boolean }): CheckNode {
  var id = normId(cantripId);
  var def = CANTRIPS[id];
  if (!def || def.kind !== 'spell_attack') {
    throw new Error('SRD5E: unknown attack cantrip: ' + cantripId);
  }
  var hitDice = def.no_scale ? def.damage_dice : scaledCantripDice(def.damage_dice, casterLevel);
  var critDice = doubleDice(hitDice);
  var agonizing = !!(opts && opts.agonizing) && id === 'eldritch_blast';
  var hitVal: ExprNode = agonizing ? exAdd(exDice(hitDice), exProp('actor', 'cha_mod')) : exDice(hitDice);
  var critVal: ExprNode = agonizing ? exAdd(exDice(critDice), exProp('actor', 'cha_mod')) : exDice(critDice);
  var hitMuts: MutationNode[] = [muSubHp('target', hitVal)];
  var critMuts: MutationNode[] = [muSubHp('target', critVal)];
  if (def.rider_tag) {
    hitMuts.push(muAddTag('target', def.rider_tag));
    critMuts.push(muAddTag('target', def.rider_tag));
  }
  return attackCheck('spell_atk', hitMuts, critMuts);
}

// Save cantrip (sacred_flame family): roll = 1d20 + target.<save> vs
// dc = actor.spell_dc. 'success' = the spell LANDS (target failed, or a
// STR/DEX auto-fail tag); 'failure' = the target saved (save cantrips deal
// nothing on a save). toll_the_dead upgrades its die against a damaged
// target via a LIVE if-compare on hp < hp_max (no caller-supplied flag).
export function buildSaveCantripCheck(cantripId: string, casterLevel: number): CheckNode {
  var id = normId(cantripId);
  var def = CANTRIPS[id];
  if (!def || def.kind !== 'save' || !def.save_ability) {
    throw new Error('SRD5E: unknown save cantrip: ' + cantripId);
  }
  var landMuts: MutationNode[];
  if (def.damaged_dice) {
    landMuts = [{
      type: 'if',
      condition: {
        type: 'compare', op: 'lt',
        left: { source: 'prop', target: 'target', property: 'hp' },
        right: { source: 'prop', target: 'target', property: 'hp_max' },
      },
      then: [muSubHp('target', exDice(scaledCantripDice(def.damaged_dice, casterLevel)))],
      else: [muSubHp('target', exDice(scaledCantripDice(def.damage_dice, casterLevel)))],
    }];
  } else {
    landMuts = [muSubHp('target', exDice(scaledCantripDice(def.damage_dice, casterLevel)))];
    if (def.rider_tag) landMuts.push(muAddTag('target', def.rider_tag));
  }
  return {
    type: 'check',
    roll: exAdd(exDice('1d20'), exProp('target', saveProp(def.save_ability))),
    dc: exProp('actor', 'spell_dc'),
    degrees: {
      success: { condition: landingCondition(def.save_ability, 'target'), mutations: landMuts },
      failure: { condition: { type: 'delta_gte', value: 0 }, mutations: [] },
    },
  };
}

// Attack spell (guiding_bolt family): the weapon-attack shape with spell_atk
// vs target.ac; damage dice from totalDiceForCast per slot level; crit doubles
// dice; spiritual_weapon alone adds actor.spell_mod (the one SRD attack spell
// that does). scorching_ray returns ONE ray - host loops upcastEffect
// extra_instances + 3 rays (the eldritch_blast pattern, RAW per-ray).
export function buildAttackSpellCheck(spellId: string, castSlotLevel: number): CheckNode {
  var id = normId(spellId);
  var def = LEVELED_SPELLS[id];
  if (!def || def.kind !== 'spell_attack' || !def.base_dice) {
    throw new Error('SRD5E: unknown attack spell: ' + spellId);
  }
  var hitDice = totalDiceForCast(def.base_dice, id, castSlotLevel);
  var critDice = doubleDice(hitDice);
  var hitVal: ExprNode = def.add_ability_to_damage
    ? exAdd(exDice(hitDice), exProp('actor', 'spell_mod'))
    : exDice(hitDice);
  var critVal: ExprNode = def.add_ability_to_damage
    ? exAdd(exDice(critDice), exProp('actor', 'spell_mod'))
    : exDice(critDice);
  var hitMuts: MutationNode[] = [muSubHp('target', hitVal)];
  var critMuts: MutationNode[] = [muSubHp('target', critVal)];
  if (def.applies_tag) {
    hitMuts.push(muAddTag('target', def.applies_tag));
    critMuts.push(muAddTag('target', def.applies_tag));
  }
  return attackCheck('spell_atk', hitMuts, critMuts);
}

// Single-target save spell (hellish_rebuke shape): 'success' = target FAILED
// (full dice); 'failure' = target saved (half via floor_div when
// half_on_save). The half branch rolls its OWN fresh dice - only the taken
// branch rolls (no value bindings in v2); the divergence from roll-then-halve
// is invisible in distribution except the halved roll's granularity.
export function buildSaveSpellCheck(spellId: string, castSlotLevel: number): CheckNode {
  var id = normId(spellId);
  var def = LEVELED_SPELLS[id];
  if (!def || def.kind !== 'save' || !def.base_dice || !def.save_ability) {
    throw new Error('SRD5E: unknown save spell: ' + spellId);
  }
  var full = totalDiceForCast(def.base_dice, id, castSlotLevel);
  var savedMuts: MutationNode[] = def.half_on_save ? [muSubHp('target', exHalf(exDice(full)))] : [];
  return {
    type: 'check',
    roll: exAdd(exDice('1d20'), exProp('target', saveProp(def.save_ability))),
    dc: exProp('actor', 'spell_dc'),
    degrees: {
      success: { condition: landingCondition(def.save_ability, 'target'), mutations: [muSubHp('target', exDice(full))] },
      failure: { condition: { type: 'delta_gte', value: 0 }, mutations: savedMuts },
    },
  };
}

// THE multi-target save (fireball family) - the spec 6.6 blessed idiom
// (vector E6): every selected target rolls its OWN save into the 'save_roll'
// scratch prop, then full damage on a fail / floor_div half on a save, each
// with FRESH dice (one shared damage roll is NOT expressible in v2 - no value
// bindings; a v3 let-binding unlocks RAW). The HOST paints `selectTag` before
// evaluation and clears it after; `maxTargets` is an enumeration ceiling.
export function buildMultiTargetSaveTrigger(
  spellId: string, castSlotLevel: number,
  opts?: { selectTag?: string; maxTargets?: number },
): MutationNode[] {
  var id = normId(spellId);
  var def = LEVELED_SPELLS[id];
  if (!def || def.kind !== 'save' || !def.base_dice || !def.save_ability || !def.area) {
    throw new Error('SRD5E: not a multi-target save spell: ' + spellId);
  }
  var tag = opts && typeof opts.selectTag === 'string' && opts.selectTag.length > 0 ? opts.selectTag : 'in_blast';
  var limit = def.area.default_max_targets;
  if (opts && opts.maxTargets !== undefined) {
    if (typeof opts.maxTargets !== 'number' || Math.floor(opts.maxTargets) !== opts.maxTargets
      || opts.maxTargets < 1 || opts.maxTargets > 32) {
      throw new Error('SRD5E: maxTargets must be an integer in 1..32');
    }
    limit = opts.maxTargets;
  }
  var full = totalDiceForCast(def.base_dice, id, castSlotLevel);
  var failArms: DegreeCond[] = [{
    type: 'compare', op: 'lt',
    left: { source: 'prop', target: 'each', property: 'save_roll' },
    right: { source: 'prop', target: 'actor', property: 'spell_dc' },
  }];
  var a = def.save_ability.toLowerCase().trim().slice(0, 3);
  if (a === 'str' || a === 'dex') {
    failArms.push({ type: 'has_tag', target: 'each', tag: 'paralyzed' });
    failArms.push({ type: 'has_tag', target: 'each', tag: 'stunned' });
    failArms.push({ type: 'has_tag', target: 'each', tag: 'unconscious' });
  }
  return [{
    type: 'foreach_target',
    select: { tag: tag, limit: limit },
    mutations: [
      {
        type: 'set_prop', target: 'each', property: 'save_roll',
        value: exAdd(exDice('1d20'), exProp('each', saveProp(def.save_ability))),
      },
      {
        type: 'if',
        condition: { type: 'or', conditions: failArms },
        then: [muSubHp('each', exDice(full))],
        else: def.half_on_save ? [muSubHp('each', exHalf(exDice(full)))] : [],
      },
    ],
  }];
}

// Magic Missile: auto-hit is the ABSENCE of a check - a trigger of
// repeat(darts) { sub_prop target.hp 1d4+1 } (spec vector F1 literally).
// Darts: 3 at L1 + 1 per slot level above (upcastEffect extra_instances);
// per-dart fresh rolls are 5e RAW-compatible.
export function buildMagicMissileTrigger(castSlotLevel: number): MutationNode[] {
  var def = LEVELED_SPELLS['magic_missile'] as LeveledDef;
  var info = upcastEffect('magic_missile', castSlotLevel);
  var darts = (def.darts as number) + (info ? info.extra_instances : 0);
  var dartEq = (def.base_dice as string) + '+' + String(def.dart_bonus as number);
  return [{
    type: 'repeat', count: darts,
    mutations: [muSubHp('target', exDice(dartEq))],
  }];
}

// Heal (cure_wounds / healing_word): add_prop target.hp (dice + actor.spell_mod),
// then the hp_max overheal clamp via if-compare (hp_max is already convention).
// The min-1 heal clamp variant is documented, not shipped (simple form).
export function buildHealTrigger(spellId: string, castSlotLevel: number): MutationNode[] {
  var id = normId(spellId);
  var def = LEVELED_SPELLS[id];
  if (!def || def.kind !== 'heal' || !def.base_dice) {
    throw new Error('SRD5E: unknown heal spell: ' + spellId);
  }
  var healDice = totalDiceForCast(def.base_dice, id, castSlotLevel);
  return [
    { type: 'add_prop', target: 'target', property: 'hp', value: exAdd(exDice(healDice), exProp('actor', 'spell_mod')) },
    {
      type: 'if',
      condition: {
        type: 'compare', op: 'gt',
        left: { source: 'prop', target: 'target', property: 'hp' },
        right: { source: 'prop', target: 'target', property: 'hp_max' },
      },
      then: [{ type: 'set_prop', target: 'target', property: 'hp', value: exProp('target', 'hp_max') }],
    },
  ];
}

// Condition spell (hold_person family): save vs spell_dc; the condition tag
// lands on a failed save (with the STR/DEX auto-fail or-arm where it applies,
// e.g. web); ZERO damage by construction. Duration is catalog data
// (applies_duration_rounds) for the host's ConditionTrack - never in the AST.
// Upcast extra targets are host enumeration (extra single-target checks or a
// wider painted selection), per the catalog note.
export function buildConditionSpellCheck(spellId: string, castSlotLevel: number, appliesTagOverride?: string): CheckNode {
  var id = normId(spellId);
  var def = LEVELED_SPELLS[id];
  if (!def || def.kind !== 'save_utility' || !def.save_ability || !def.applies_tag) {
    throw new Error('SRD5E: unknown condition spell: ' + spellId);
  }
  void castSlotLevel; // the document is slot-invariant; upcast = more targets (host-side)
  // Codex audit P2: a spell offering a CHOICE of conditions (Blindness /
  // Deafness) ships one document per choice; appliesTagOverride selects which
  // tag this document lands, defaulting to the catalog tag.
  var tag = typeof appliesTagOverride === 'string' && appliesTagOverride.length > 0
    ? appliesTagOverride : def.applies_tag;
  return {
    type: 'check',
    roll: exAdd(exDice('1d20'), exProp('target', saveProp(def.save_ability))),
    dc: exProp('actor', 'spell_dc'),
    degrees: {
      success: { condition: landingCondition(def.save_ability, 'target'), mutations: [muAddTag('target', tag)] },
      failure: { condition: { type: 'delta_gte', value: 0 }, mutations: [] },
    },
  };
}

// ---- Cast economy (dice-free) ----------------------------------------------------

export interface CastPlan {
  ok: boolean;
  reason: 'ok' | 'no_slot' | 'not_known' | 'not_a_caster';
  slots: SlotPool;
  slot_level: number | null;
  concentration_spell: string | null;
  spell_name: string;
}

function clonePoolShallow(slots: SlotPool): SlotPool {
  return JSON.parse(JSON.stringify(slots)) as SlotPool;
}

// The economy half of a cast, with ZERO dice: catalog gate, class gate, clamp
// the requested level into base..MAX_SLOT_LEVEL, spend the lowest available
// slot (auto-upcast when the base tier is dry), and surface the concentration
// flag. Dice happen in the AST evaluation that follows; the host sequence is
// plan -> evaluateAction(doc) -> startConcentration. Pure: the input pool is
// never mutated.
export function planLeveledCast(
  slots: SlotPool, spellId: string, classId: string, requestedSlotLevel?: number | null,
): CastPlan {
  var id = normId(spellId);
  var def = LEVELED_SPELLS[id];
  if (!def) {
    return { ok: false, reason: 'not_known', slots: clonePoolShallow(slots), slot_level: null, concentration_spell: null, spell_name: id };
  }
  if (casterKind(classId) === null) {
    return { ok: false, reason: 'not_a_caster', slots: clonePoolShallow(slots), slot_level: null, concentration_spell: null, spell_name: def.name };
  }
  var list = CLASS_LEVELED_SPELLS[normId(classId)];
  if (!list || list.indexOf(id) < 0) {
    return { ok: false, reason: 'not_known', slots: clonePoolShallow(slots), slot_level: null, concentration_spell: null, spell_name: def.name };
  }
  var base = spellBaseLevel(id);
  if (base === null) base = def.base_level;
  var want = typeof requestedSlotLevel === 'number' && isFinite(requestedSlotLevel)
    ? Math.floor(requestedSlotLevel) : base;
  if (want < base) want = base;
  if (want > MAX_SLOT_LEVEL) want = MAX_SLOT_LEVEL;
  var spend = spendLowestAvailable(slots, want);
  if (!spend.ok) {
    return { ok: false, reason: 'no_slot', slots: spend.slots, slot_level: null, concentration_spell: null, spell_name: def.name };
  }
  var conc = spellRequiresConcentration(id) ? id : null;
  return { ok: true, reason: 'ok', slots: spend.slots, slot_level: spend.slot_level, concentration_spell: conc, spell_name: def.name };
}
