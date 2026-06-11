// srd5e-conditions.ts - 5e condition tables: advantage/disadvantage mapping,
// STR/DEX save auto-fail, and reaction denial (content pack).
//
// Engine-side, conditions are world-state TAGS: the same lowercase ids feed
// has_tag arms inside pack documents (auto-fail expressed in data - see
// srd5e-pack.ts) AND this module (for host resolvers). PURE: no RNG, no
// state - this module computes the advantage/disadvantage MODE only. The
// extra-die mechanic itself (rolling a second d20 and keeping one) is NOT
// expressible in AST v2 (no max/min op - spec section 14 cut), so it stays a
// host-side resolver concern (or a future v3 expression op).
//
// Content: the 5e RAW condition rules from the SRD 5.1 (CC-BY-4.0) - see
// NOTICE.md. Tables are mechanics-only id lists; no SRD prose.
//
// Code style: var-only, no arrow functions.

// Attacks AGAINST a target with any of these have advantage.
export var ADV_AGAINST_TARGET: string[] = ['restrained', 'stunned', 'paralyzed', 'unconscious'];

// An ATTACKER with any of these has disadvantage on attack rolls.
export var DISADV_ON_ATTACKER: string[] = ['poisoned', 'frightened', 'restrained', 'prone'];

// These auto-fail STRENGTH and DEXTERITY saving throws (and only those).
export var AUTO_FAIL_STR_DEX: string[] = ['paralyzed', 'stunned', 'unconscious'];

// These deny reactions (the SRD incapacitated family - an incapacitated
// creature takes no actions or reactions).
export var INCAPACITATED_NO_REACTION: string[] = ['paralyzed', 'stunned', 'unconscious', 'incapacitated', 'petrified'];

export interface AdvDetail {
  adv_from: string[];
  dis_from: string[];
  cancelled: boolean;
  prone_skipped: boolean;
}

// Normalize arbitrary input into lowercase condition ids. Fail-soft: anything
// unusable coerces to []. Accepts an array of strings or one (possibly
// comma-separated) string; entries are trimmed, lowercased, deduped in first-
// seen order. Unknown ids pass through (the tables simply never match them).
export function coerceConditions(input: unknown): string[] {
  var raw: unknown[] = [];
  if (Array.isArray(input)) raw = input;
  else if (typeof input === 'string') raw = input.split(',');
  else return [];
  var out: string[] = [];
  var seen: { [id: string]: boolean } = {};
  for (var i = 0; i < raw.length; i++) {
    var v = raw[i];
    if (typeof v !== 'string') continue;
    var id = v.toLowerCase().trim();
    if (id.length === 0) continue;
    if (seen[id]) continue;
    seen[id] = true;
    out.push(id);
  }
  return out;
}

function hasCond(conds: string[], id: string): boolean {
  return conds.indexOf(id) >= 0;
}

// The 5e RAW advantage/disadvantage mapping for ONE attack roll.
//
// - Target conditions in ADV_AGAINST_TARGET grant advantage.
// - Attacker conditions in DISADV_ON_ATTACKER impose disadvantage.
// - A PRONE TARGET is split by range: melee attacks gain advantage, ranged
//   attacks suffer disadvantage - and when isMelee is null (the host could
//   not establish range), prone is SKIPPED entirely and flagged via
//   detail.prone_skipped (never guessed).
// - Any advantage + any disadvantage CANCEL to a straight roll (5e RAW: they
//   never stack or outweigh) - mode null with detail.cancelled true.
export function attackAdvantageMode(
  attackerConds: unknown, targetConds: unknown, isMelee: boolean | null,
): { mode: 'adv' | 'dis' | null; detail: AdvDetail } {
  var atk = coerceConditions(attackerConds);
  var tgt = coerceConditions(targetConds);
  var advFrom: string[] = [];
  var disFrom: string[] = [];
  var proneSkipped = false;
  var i: number;
  for (i = 0; i < ADV_AGAINST_TARGET.length; i++) {
    var ac = ADV_AGAINST_TARGET[i] as string;
    if (hasCond(tgt, ac)) advFrom.push(ac);
  }
  if (hasCond(tgt, 'prone')) {
    if (isMelee === true) advFrom.push('prone');
    else if (isMelee === false) disFrom.push('prone');
    else proneSkipped = true;
  }
  for (i = 0; i < DISADV_ON_ATTACKER.length; i++) {
    var dc = DISADV_ON_ATTACKER[i] as string;
    if (hasCond(atk, dc)) disFrom.push(dc);
  }
  var cancelled = advFrom.length > 0 && disFrom.length > 0;
  var mode: 'adv' | 'dis' | null = null;
  if (advFrom.length > 0 && disFrom.length === 0) mode = 'adv';
  else if (disFrom.length > 0 && advFrom.length === 0) mode = 'dis';
  var detail: AdvDetail = { adv_from: advFrom, dis_from: disFrom, cancelled: cancelled, prone_skipped: proneSkipped };
  return { mode: mode, detail: detail };
}

// Human-readable note for an attack roll's advantage state. `kept` (the die
// kept) and `pair` (e.g. '17/9') are passed explicitly by the host that
// rolled the extra die - this module never sees a roll object.
export function conditionRollNote(
  mode: 'adv' | 'dis' | null, detail: AdvDetail, kept: number | null, pair: string | null,
): string {
  var note = '';
  if (mode === 'adv') {
    note = 'advantage (' + detail.adv_from.join(', ') + ')';
    if (kept !== null && pair !== null) note = note + ': rolled ' + pair + ', kept ' + kept;
  } else if (mode === 'dis') {
    note = 'disadvantage (' + detail.dis_from.join(', ') + ')';
    if (kept !== null && pair !== null) note = note + ': rolled ' + pair + ', kept ' + kept;
  } else if (detail.cancelled) {
    note = 'advantage (' + detail.adv_from.join(', ') + ') and disadvantage ('
      + detail.dis_from.join(', ') + ') cancel: straight roll';
  }
  if (detail.prone_skipped) {
    note = note + (note.length > 0 ? ' ' : '') + '[prone ignored: melee/ranged unknown]';
  }
  return note;
}

// The first target condition that auto-fails a STR or DEX save, or null.
// Only STR/DEX saves auto-fail (5e RAW); every other ability returns null
// regardless of conditions. Accepts 'str'/'dex' or full ability names.
export function autoFailSaveCondition(saveAbility: string, targetConds: unknown): string | null {
  var a = typeof saveAbility === 'string' ? saveAbility.toLowerCase().trim().slice(0, 3) : '';
  if (a !== 'str' && a !== 'dex') return null;
  var conds = coerceConditions(targetConds);
  for (var i = 0; i < AUTO_FAIL_STR_DEX.length; i++) {
    var id = AUTO_FAIL_STR_DEX[i] as string;
    if (hasCond(conds, id)) return id;
  }
  return null;
}

// The first condition that denies the entity its reaction, or null.
export function reactionDeniedByConditions(targetConds: unknown): string | null {
  var conds = coerceConditions(targetConds);
  for (var i = 0; i < INCAPACITATED_NO_REACTION.length; i++) {
    var id = INCAPACITATED_NO_REACTION[i] as string;
    if (hasCond(conds, id)) return id;
  }
  return null;
}
