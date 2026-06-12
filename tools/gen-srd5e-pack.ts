// gen-srd5e-pack.ts - generate packs/srd5e/srd5e_actions_v1.json.
//
// Emits the SRD 5.1 action pack as surface-neutral JSON ({ meta, actions } -
// the gen-ast-v2-vectors.ts pattern) so Python / Rust hosts consume the pack
// without the TS builders. Every document is built by the real
// src/runtime/srd5e-pack.ts builders and VALIDATED (validateCheck /
// validateTriggeredMutations) before writing - the generator refuses to emit
// a document the AST evaluator would reject.
//
// Enumeration policy: AST v2 documents are unparametrized (repeat.count and
// dice equations are literals - spec 7.1), so dice-scaling actions enumerate
// one concrete variant per cantrip tier (1/5/11/17) and per legal slot level.
// Slot-INVARIANT documents (the hold_person condition family, the
// scorching_ray per-ray check, the eldritch_blast per-beam check) emit ONCE
// with the scaling rule in their notes - emitting identical documents per
// level would pin nothing.
//
// Re-run with: npx tsx tools/gen-srd5e-pack.ts

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateCheck, validateTriggeredMutations } from '../src/runtime/ruleset-ast.js';
import type { CheckNode, MutationNode, ExprNode } from '../src/runtime/ruleset-ast.js';
import {
  CANTRIPS, LEVELED_SPELLS,
  buildWeaponAttackCheck, buildAttackCantripCheck, buildSaveCantripCheck,
  buildAttackSpellCheck, buildSaveSpellCheck, buildMultiTargetSaveTrigger,
  buildMagicMissileTrigger, buildHealTrigger, buildConditionSpellCheck,
  scaledCantripDice, eldritchBlastBeams,
} from '../src/runtime/srd5e-pack.js';
import { upcastEffect, MAX_SLOT_LEVEL } from '../src/runtime/srd5e-spell-slots.js';

interface PackAction {
  id: string;
  name: string;
  action_type: 'check' | 'trigger';
  spell?: string;
  tier?: number;
  slot_level?: number;
  options?: Record<string, unknown>;
  notes?: string[];
  document: unknown;
}

var actions: PackAction[] = [];

function pushCheck(a: PackAction): void {
  validateCheck(a.document as CheckNode);
  actions.push(a);
}

function pushTrigger(a: PackAction): void {
  validateTriggeredMutations(a.document as MutationNode[]);
  actions.push(a);
}

var CANTRIP_TIERS = [1, 5, 11, 17];

// ---- Weapon attacks ----------------------------------------------------------

var WEAPON_DICE = ['1d4', '1d6', '1d8', '1d10', '1d12', '2d6'];
var WEAPON_VARIANTS: Array<{ key: string; modProp: string; note: string }> = [
  { key: 'str', modProp: 'str_mod', note: 'STR melee weapon attack' },
  { key: 'finesse', modProp: 'dex_mod', note: 'DEX finesse weapon attack (finesse max(STR,DEX) is not expressible - host picks the str or dex variant)' },
  { key: 'ranged', modProp: 'dex_mod', note: 'DEX ranged weapon attack' },
];

for (var wv = 0; wv < WEAPON_VARIANTS.length; wv++) {
  var variant = WEAPON_VARIANTS[wv] as { key: string; modProp: string; note: string };
  for (var wd = 0; wd < WEAPON_DICE.length; wd++) {
    var die = WEAPON_DICE[wd] as string;
    pushCheck({
      id: 'weapon_attack_' + variant.key + '_' + die,
      name: 'Weapon Attack (' + variant.key + ', ' + die + ')',
      action_type: 'check',
      options: { modProp: variant.modProp, damageDice: die, addModToDamage: true },
      notes: [
        variant.note,
        'crit doubles the dice, the ability mod applies once',
        'nat-20 auto-hit (crit branch first); nat-1 auto-miss (or-arm in the failure branch)',
        'no min-0 damage clamp on a negative mod (documented cut - hosts that need it wrap with the scratch-prop if idiom)',
      ],
      document: buildWeaponAttackCheck({ modProp: variant.modProp, damageDice: die, addModToDamage: true }),
    });
  }
}

// ---- Attack cantrips (tier variants) ------------------------------------------

var ATTACK_CANTRIPS = ['fire_bolt', 'produce_flame', 'ray_of_frost', 'chill_touch', 'thorn_whip'];
for (var ac = 0; ac < ATTACK_CANTRIPS.length; ac++) {
  var acId = ATTACK_CANTRIPS[ac] as string;
  var acDef = CANTRIPS[acId];
  if (!acDef) throw new Error('missing cantrip def: ' + acId);
  for (var at = 0; at < CANTRIP_TIERS.length; at++) {
    var tier = CANTRIP_TIERS[at] as number;
    var notes: string[] = ['flat dice - no spell mod on cantrip damage (5e rule)'];
    if (acDef.rider_tag) {
      notes.push('rider tag "' + acDef.rider_tag + '" applied on hit; the DURATION (until the start of the caster\'s next turn) is catalog data for the host ConditionTrack, not AST');
    }
    pushCheck({
      id: acId + '_t' + tier,
      name: acDef.name + ' (tier ' + tier + ')',
      action_type: 'check',
      spell: acId,
      tier: tier,
      notes: notes,
      document: buildAttackCantripCheck(acId, tier),
    });
  }
}

// ---- Eldritch Blast (per-beam; beam count is module data, not AST) -------------

var ebBeamsByTier: Record<string, number> = {};
for (var eb = 0; eb < CANTRIP_TIERS.length; eb++) {
  var ebTier = CANTRIP_TIERS[eb] as number;
  ebBeamsByTier[String(ebTier)] = eldritchBlastBeams(ebTier);
}
var EB_NOTES = [
  'ONE document = ONE beam (1d10 force, no tier die-scaling). Hosts evaluate the document eldritchBlastBeams(level) times - each beam is a full attack roll.',
  'beams_by_tier: ' + JSON.stringify(ebBeamsByTier),
  'multi-beam in a single document is deliberately not forced: a check has one roll + one degree walk; any-hit/any-crit/summed-damage aggregation is host-side',
];
pushCheck({
  id: 'eldritch_blast_beam',
  name: 'Eldritch Blast (one beam)',
  action_type: 'check',
  spell: 'eldritch_blast',
  notes: EB_NOTES,
  document: buildAttackCantripCheck('eldritch_blast', 1),
});
pushCheck({
  id: 'eldritch_blast_beam_agonizing',
  name: 'Eldritch Blast (one beam, Agonizing)',
  action_type: 'check',
  spell: 'eldritch_blast',
  options: { agonizing: true },
  notes: EB_NOTES.concat(['agonizing adds actor.cha_mod per beam - default OFF in this pack (SRD-true); always-on is caller tuning']),
  document: buildAttackCantripCheck('eldritch_blast', 1, { agonizing: true }),
});

// ---- Save cantrips (tier variants) ---------------------------------------------

var SAVE_CANTRIPS = ['sacred_flame', 'acid_splash', 'poison_spray', 'thunderclap', 'vicious_mockery', 'toll_the_dead'];
for (var sc = 0; sc < SAVE_CANTRIPS.length; sc++) {
  var scId = SAVE_CANTRIPS[sc] as string;
  var scDef = CANTRIPS[scId];
  if (!scDef) throw new Error('missing cantrip def: ' + scId);
  for (var st = 0; st < CANTRIP_TIERS.length; st++) {
    var sTier = CANTRIP_TIERS[st] as number;
    var sNotes: string[] = [
      "degree 'success' = the spell LANDS (the target FAILED its save); a save cantrip deals nothing on a save",
      'the save d20 is always drawn, even when an auto-fail tag decides the outcome (stream alignment)',
    ];
    if (scDef.save_ability === 'dex') {
      sNotes.push('DEX save: paralyzed/stunned/unconscious auto-fail via has_tag or-arms (in data)');
    }
    if (scId === 'vicious_mockery') {
      sNotes.push("rider tag 'disadv_next_attack': the disadvantage mechanic itself is the adv/dis second d20 AST v2 cannot roll - consumption is host-side via srd5e-conditions + ConditionTrack");
    }
    if (scId === 'toll_the_dead') {
      sNotes.push('wounded-die upgrade is a LIVE state read (if target.hp < target.hp_max -> d12 else d8), replacing any caller-supplied damaged flag');
    }
    pushCheck({
      id: scId + '_t' + sTier,
      name: scDef.name + ' (tier ' + sTier + ')',
      action_type: 'check',
      spell: scId,
      tier: sTier,
      notes: sNotes,
      document: buildSaveCantripCheck(scId, sTier),
    });
  }
}

// ---- Thunderclap burst trigger (the E6 idiom on a cantrip) ---------------------

function thunderclapTrigger(tier: number): MutationNode[] {
  var dmg = scaledCantripDice('1d6', tier);
  var roll: ExprNode = {
    type: 'math', op: 'add',
    left: { type: 'dice', equation: '1d20' },
    right: { type: 'prop_ref', target: 'each', property: 'con_save' },
  };
  return [{
    type: 'foreach_target',
    select: { tag: 'in_burst', limit: 6 },
    mutations: [
      { type: 'set_prop', target: 'each', property: 'save_roll', value: roll },
      {
        type: 'if',
        condition: {
          type: 'compare', op: 'lt',
          left: { source: 'prop', target: 'each', property: 'save_roll' },
          right: { source: 'prop', target: 'actor', property: 'spell_dc' },
        },
        then: [{ type: 'sub_prop', target: 'each', property: 'hp', value: { type: 'dice', equation: dmg } }],
        else: [],
      },
    ],
  }];
}

for (var tc = 0; tc < CANTRIP_TIERS.length; tc++) {
  var tcTier = CANTRIP_TIERS[tc] as number;
  pushTrigger({
    id: 'thunderclap_burst_t' + tcTier,
    name: 'Thunderclap (burst, tier ' + tcTier + ')',
    action_type: 'trigger',
    spell: 'thunderclap',
    tier: tcTier,
    options: { selectTag: 'in_burst', maxTargets: 6 },
    notes: [
      "foreach variant: every 'in_burst' target rolls its OWN save (scratch prop save_roll) and takes its own dice on a fail - nothing on a save",
      'the host paints in_burst before evaluation and clears it after',
    ],
    document: thunderclapTrigger(tcTier),
  });
}

// ---- Magic Missile (auto-hit trigger, upcast variants) --------------------------

for (var mm = 1; mm <= MAX_SLOT_LEVEL; mm++) {
  pushTrigger({
    id: 'magic_missile_l' + mm,
    name: 'Magic Missile (slot ' + mm + ')',
    action_type: 'trigger',
    spell: 'magic_missile',
    slot_level: mm,
    notes: [
      'auto-hit is the absence of a check; per-dart fresh 1d4+1 rolls (RAW-compatible table variance)',
      'darts = 3 + 1 per slot level above 1st (repeat.count is a literal - one variant per slot level)',
    ],
    document: buildMagicMissileTrigger(mm),
  });
}

// ---- Heals (upcast variants) ----------------------------------------------------

var HEALS = ['cure_wounds', 'healing_word'];
for (var h = 0; h < HEALS.length; h++) {
  var healId = HEALS[h] as string;
  var healDef = LEVELED_SPELLS[healId];
  if (!healDef) throw new Error('missing heal def: ' + healId);
  for (var hl = healDef.base_level; hl <= MAX_SLOT_LEVEL; hl++) {
    pushTrigger({
      id: healId + '_l' + hl,
      name: healDef.name + ' (slot ' + hl + ')',
      action_type: 'trigger',
      spell: healId,
      slot_level: hl,
      notes: [
        'heal = dice + actor.spell_mod; overheal clamps to target.hp_max via the if-compare idiom',
        'no min-1 heal clamp (documented cut); targeting is the engine target ref - self-heal is a call-site choice',
      ],
      document: buildHealTrigger(healId, hl),
    });
  }
}

// ---- Attack spells (upcast variants) ---------------------------------------------

var ATTACK_SPELLS = ['guiding_bolt', 'inflict_wounds', 'witch_bolt'];
for (var as_ = 0; as_ < ATTACK_SPELLS.length; as_++) {
  var atkId = ATTACK_SPELLS[as_] as string;
  var atkDef = LEVELED_SPELLS[atkId];
  if (!atkDef) throw new Error('missing attack spell def: ' + atkId);
  for (var al = atkDef.base_level; al <= MAX_SLOT_LEVEL; al++) {
    var aNotes: string[] = ['spell attack vs target.ac; crit doubles dice'];
    if (atkId === 'witch_bolt') aNotes.push('CONCENTRATION - the flag lives in the upcast ladder, fired by planLeveledCast, never in the document');
    if (atkId === 'guiding_bolt') aNotes.push("rider tag 'guided' (advantage on the next attack against the target) - 1 round, host ConditionTrack");
    pushCheck({
      id: atkId + '_l' + al,
      name: atkDef.name + ' (slot ' + al + ')',
      action_type: 'check',
      spell: atkId,
      slot_level: al,
      notes: aNotes,
      document: buildAttackSpellCheck(atkId, al),
    });
  }
}

// spiritual_weapon: +1d8 per TWO slot levels - variants exist only at the even
// steps where the dice actually change (RAW is not auto-scaled per level).
var SW_LEVELS = [2, 4, 6, 8];
for (var sw = 0; sw < SW_LEVELS.length; sw++) {
  var swL = SW_LEVELS[sw] as number;
  pushCheck({
    id: 'spiritual_weapon_l' + swL,
    name: 'Spiritual Weapon (slot ' + swL + ')',
    action_type: 'check',
    spell: 'spiritual_weapon',
    slot_level: swL,
    notes: [
      '+1d8 per TWO slot levels above 2nd - generated variants only at even steps; an odd slot casts as the even step below it',
      'the one SRD attack spell that adds the casting ability mod (actor.spell_mod) to damage',
    ],
    document: buildAttackSpellCheck('spiritual_weapon', swL),
  });
}

// scorching_ray: RAW per-ray (one 2d6 spell-attack check per ray; the host
// loops the ray count). Codex audit P2: the shipped note must not reference any
// private host tuning - that commentary stays in private docs.
var srRays: Record<string, number> = {};
for (var srl = 2; srl <= MAX_SLOT_LEVEL; srl++) {
  var srInfo = upcastEffect('scorching_ray', srl);
  srRays[String(srl)] = 3 + (srInfo ? srInfo.extra_instances : 0);
}
pushCheck({
  id: 'scorching_ray_ray',
  name: 'Scorching Ray (one ray)',
  action_type: 'check',
  spell: 'scorching_ray',
  notes: [
    'ONE document = ONE ray (2d6 fire, spell attack, crit 4d6) - the eldritch_blast pattern; the host loops the ray count',
    'rays_by_slot: ' + JSON.stringify(srRays),
    'This pack resolves Scorching Ray as RAW: each ray is its own spell attack roll (no merged all-or-nothing damage).',
  ],
  document: buildAttackSpellCheck('scorching_ray', 2),
});

// ---- Single-target save spells (hellish_rebuke + the blast family as single) ----

var SINGLE_SAVE_SPELLS = ['hellish_rebuke', 'burning_hands', 'thunderwave', 'shatter', 'fireball', 'lightning_bolt', 'spirit_guardians', 'cone_of_cold'];
for (var ss = 0; ss < SINGLE_SAVE_SPELLS.length; ss++) {
  var ssId = SINGLE_SAVE_SPELLS[ss] as string;
  var ssDef = LEVELED_SPELLS[ssId];
  if (!ssDef) throw new Error('missing save spell def: ' + ssId);
  for (var sl = ssDef.base_level; sl <= MAX_SLOT_LEVEL; sl++) {
    pushCheck({
      id: ssId + '_single_l' + sl,
      name: ssDef.name + ' (single target, slot ' + sl + ')',
      action_type: 'check',
      spell: ssId,
      slot_level: sl,
      notes: [
        "degree 'success' = the target FAILED its save (full dice); 'failure' = saved (floor_div half - 5e round-down)",
        'the half branch rolls its OWN fresh dice (only the taken branch rolls - no value bindings in v2)',
      ],
      document: buildSaveSpellCheck(ssId, sl),
    });
  }
}

// ---- Multi-target save triggers (the spec 6.6 blessed idiom) ---------------------

var MULTI_SAVE_SPELLS = ['burning_hands', 'thunderwave', 'shatter', 'fireball', 'lightning_bolt', 'spirit_guardians', 'cone_of_cold'];
for (var ms = 0; ms < MULTI_SAVE_SPELLS.length; ms++) {
  var msId = MULTI_SAVE_SPELLS[ms] as string;
  var msDef = LEVELED_SPELLS[msId];
  if (!msDef || !msDef.area) throw new Error('missing multi save def: ' + msId);
  for (var ml = msDef.base_level; ml <= MAX_SLOT_LEVEL; ml++) {
    pushTrigger({
      id: msId + '_blast_l' + ml,
      name: msDef.name + ' (multi-target, slot ' + ml + ')',
      action_type: 'trigger',
      spell: msId,
      slot_level: ml,
      options: { selectTag: 'in_blast', maxTargets: msDef.area.default_max_targets },
      notes: [
        'per-target fresh save AND fresh damage rolls - the spec-blessed v2 idiom; one SHARED damage roll for all targets is NOT expressible (no value bindings; a v3 let-binding unlocks RAW)',
        "the host paints 'in_blast' before evaluation and clears it after (caller-enumerates contract); area shape '" + msDef.area.shape + "' is painter metadata, not AST",
        "the 'save_roll' scratch property persists in worldStateHash (spec 6.6) - a permanent, reused slot",
      ],
      document: buildMultiTargetSaveTrigger(msId, ml),
    });
  }
}

// ---- Condition spells (slot-invariant documents) ----------------------------------

var CONDITION_SPELLS = ['hold_person', 'hold_monster', 'web', 'blindness_deafness', 'slow'];
for (var cs = 0; cs < CONDITION_SPELLS.length; cs++) {
  var csId = CONDITION_SPELLS[cs] as string;
  var csDef = LEVELED_SPELLS[csId];
  if (!csDef) throw new Error('missing condition spell def: ' + csId);
  var csInfo = upcastEffect(csId, csDef.base_level);
  pushCheck({
    id: csId,
    name: csDef.name,
    action_type: 'check',
    spell: csId,
    slot_level: csDef.base_level,
    notes: [
      "zero damage by construction; tag '" + csDef.applies_tag + "' lands on a failed save",
      'duration ' + String(csDef.applies_duration_rounds) + ' rounds is catalog data for the host ConditionTrack, never AST',
      'concentration (where the ladder flags it) is module-side via planLeveledCast + srd5e-concentration',
      csInfo && csInfo.note ? 'upcast: ' + csInfo.note : 'no upcast effect',
      'repeat-save-each-round policy is a host call-site choice, not pack data',
    ],
    document: buildConditionSpellCheck(csId, csDef.base_level),
  });
}

// Codex audit P2: Blindness/Deafness offers a CHOICE of conditions. The loop
// above shipped only the blindness branch (applies 'blinded'); ship the
// deafness branch explicitly so a consumer can represent either choice.
var bdDef = LEVELED_SPELLS['blindness_deafness'];
if (!bdDef) throw new Error('missing blindness_deafness def');
pushCheck({
  id: 'blindness_deafness_deafened',
  name: 'Blindness/Deafness (deafness)',
  action_type: 'check',
  spell: 'blindness_deafness',
  slot_level: bdDef.base_level,
  notes: [
    "the deafness choice: applies 'deafened' instead of 'blinded' on a failed CON save",
    'duration ' + String(bdDef.applies_duration_rounds) + ' rounds is catalog data for the host ConditionTrack, never AST',
    "the blindness choice is the sibling action 'blindness_deafness' (applies 'blinded')",
  ],
  document: buildConditionSpellCheck('blindness_deafness', bdDef.base_level, 'deafened'),
});

// ---- Write -------------------------------------------------------------------------

var out = {
  meta: {
    generator: 'tools/gen-srd5e-pack.ts',
    pack: 'srd5e_actions_v1',
    spec: 'docs/specs/AST-V2-SPEC.md',
    license: 'Mechanics derived from the D&D 5e System Reference Document 5.1 (CC-BY-4.0) - see NOTICE.md. Mechanics only; no SRD prose.',
    generated_note: 'Regenerate with: npx tsx tools/gen-srd5e-pack.ts (builds every document with the real src/runtime/srd5e-pack.ts builders and validates each via validateCheck / validateTriggeredMutations before writing).',
    property_convention: {
      actor: ['str_mod', 'dex_mod', 'cha_mod', 'spell_atk', 'spell_dc', 'spell_mod'],
      target: ['hp', 'hp_max', 'ac', 'str_save', 'dex_save', 'con_save', 'wis_save', 'cha_save'],
      condition_tags: ['paralyzed', 'stunned', 'unconscious', 'restrained', 'poisoned', 'frightened', 'prone'],
      selection_tags: 'host-painted multi-target scopes (in_blast / in_burst by default) - paint before evaluation, clear after',
      scratch_props: ['save_roll'],
    },
    limits: [
      'advantage/disadvantage second-d20 is NOT expressible (no max/min op - spec 14): srd5e-conditions computes the MODE, the extra die is host-side or a v3 op',
      'finesse max(STR, DEX) is NOT expressible: str and dex variants ship, the host picks',
      'one SHARED multi-target damage roll is NOT expressible (no value bindings): per-target fresh rolls ship (the spec 6.6 idiom)',
      'rider/condition DURATIONS are catalog data for the host ConditionTrack, never AST',
      'dynamic repeat counts are NOT expressible: upcast dart/ray/target counts enumerate as concrete variants or host loops',
    ],
    consume: 'action_type check -> validateCheck + evaluateAction; action_type trigger -> validateTriggeredMutations + applyTriggeredMutations',
  },
  actions: actions,
};

var dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'packs', 'srd5e');
mkdirSync(dest, { recursive: true });
var file = join(dest, 'srd5e_actions_v1.json');
writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('wrote ' + file + ' (' + actions.length + ' actions, all validated)');
