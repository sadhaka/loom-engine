// srd5e-spell-slots.ts - SRD 5.1 spell-slot economy (content pack, pure data + resolvers).
//
// The slot tables (full / half / pact casters), spend / restore, rests, the
// widen-merge (the P0 level-up merge: shape always derives fresh from the
// tables for the CURRENT class + level, only `used` carries over capped at the
// new max), and the SRD upcast ladder (upcastEffect / totalDiceForCast).
//
// PURE: no RNG, no wall-clock, no I/O, never mutates an input pool
// (clone-on-spend). String slot keys plus the reserved 'pact' key keep the
// JSON shape host-portable - a serialized pool round-trips unchanged.
// JSON-column encode/decode stays host-side.
//
// Content: mechanics from the D&D 5e System Reference Document 5.1
// (CC-BY-4.0) - see NOTICE.md. Not affiliated with or endorsed by Wizards of
// the Coast. No SRD prose is reproduced; tables ship as numbers.
//
// Code style: var-only, no arrow functions.

export var MAX_SLOT_LEVEL: number = 9;
export var PACT_KEY: string = 'pact';

export interface SlotEntry { max: number; used: number }
export interface PactEntry { slot_level: number; max: number; used: number }
// Keys '1'..'9' map to SlotEntry; the reserved 'pact' key maps to PactEntry.
export type SlotPool = { [level: string]: SlotEntry } & { pact?: PactEntry };

export interface SpendResult {
  ok: boolean;
  reason: 'ok' | 'no_slot' | 'no_higher_slot' | 'bad_slot_level' | 'not_a_slot';
  slot_level: number | null;
  slots: SlotPool;
}

export interface UpcastInfo {
  spell_id: string;
  base_level: number;
  cast_level: number;
  levels_above: number;
  effect: 'damage' | 'heal' | 'utility';
  concentration: boolean;
  added_dice: string;       // TOTAL added dice at this cast level ('' when none)
  extra_instances: number;  // TOTAL extra darts/rays/targets at this cast level
  note: string;
}

// ---- Caster taxonomy (SRD 5.1) ---------------------------------------------

var FULL_CASTERS: { [id: string]: boolean } = {
  bard: true, cleric: true, druid: true, sorcerer: true, wizard: true,
};
var HALF_CASTERS: { [id: string]: boolean } = { paladin: true, ranger: true };
var PACT_CASTERS: { [id: string]: boolean } = { warlock: true };

var SPELL_ABILITY: { [id: string]: 'int' | 'wis' | 'cha' } = {
  bard: 'cha', cleric: 'wis', druid: 'wis', paladin: 'cha', ranger: 'wis',
  sorcerer: 'cha', warlock: 'cha', wizard: 'int',
};

function normId(s: string): string {
  return typeof s === 'string' ? s.toLowerCase().trim() : '';
}

export function casterKind(classId: string): 'full' | 'half' | 'pact' | null {
  var id = normId(classId);
  if (FULL_CASTERS[id]) return 'full';
  if (HALF_CASTERS[id]) return 'half';
  if (PACT_CASTERS[id]) return 'pact';
  return null;
}

export function isCaster(classId: string): boolean {
  return casterKind(classId) !== null;
}

export function spellAbilityForClass(classId: string): 'int' | 'wis' | 'cha' | null {
  var a = SPELL_ABILITY[normId(classId)];
  return a === undefined ? null : a;
}

// ---- Slot tables (SRD 5.1) --------------------------------------------------
// Row index = class level - 1; column index = slot level - 1.

var FULL_SLOT_TABLE: number[][] = [
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
];

var HALF_SLOT_TABLE: number[][] = [
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
];

// [pact slot level, pact slot count] per warlock level (Mystic Arcanum is a
// class feature, not a slot - out of scope here, exactly as in the SRD table).
var PACT_TABLE: number[][] = [
  [1, 1], [1, 2], [2, 2], [2, 2], [3, 2], [3, 2], [4, 2], [4, 2], [5, 2], [5, 2],
  [5, 3], [5, 3], [5, 3], [5, 3], [5, 3], [5, 3], [5, 4], [5, 4], [5, 4], [5, 4],
];

function clampLevel(level: number): number {
  var n = typeof level === 'number' && isFinite(level) ? Math.floor(level) : 1;
  if (n < 1) return 1;
  if (n > 20) return 20;
  return n;
}

function isInt(n: unknown): n is number {
  return typeof n === 'number' && isFinite(n) && Math.floor(n) === n;
}

function setPact(pool: SlotPool, p: PactEntry): void {
  (pool as { pact?: PactEntry }).pact = p;
}

function clonePool(slots: SlotPool): SlotPool {
  var out = {} as SlotPool;
  for (var k in slots) {
    if (!Object.prototype.hasOwnProperty.call(slots, k)) continue;
    if (k === PACT_KEY) {
      var p = slots.pact;
      if (p) setPact(out, { slot_level: p.slot_level, max: p.max, used: p.used });
    } else {
      var e = slots[k];
      if (e) out[k] = { max: e.max, used: e.used };
    }
  }
  return out;
}

// Fresh slot pool for a class + level (all used = 0). Non-caster -> {}.
// Level is clamped into 1..20 (and floored).
export function spellSlotsFor(classId: string, level: number): SlotPool {
  var out = {} as SlotPool;
  var kind = casterKind(classId);
  if (kind === null) return out;
  var lvl = clampLevel(level);
  if (kind === 'pact') {
    var row = PACT_TABLE[lvl - 1];
    if (row) setPact(out, { slot_level: row[0] as number, max: row[1] as number, used: 0 });
    return out;
  }
  var table = kind === 'full' ? FULL_SLOT_TABLE : HALF_SLOT_TABLE;
  var slots = table[lvl - 1];
  if (!slots) return out;
  for (var i = 0; i < slots.length; i++) {
    var max = slots[i] as number;
    if (max > 0) out[String(i + 1)] = { max: max, used: 0 };
  }
  return out;
}

// Highest slot level with max > 0 anywhere in the pool (pact included). 0 if none.
export function highestSlotLevel(slots: SlotPool): number {
  var best = 0;
  for (var L = 1; L <= MAX_SLOT_LEVEL; L++) {
    var e = slots[String(L)];
    if (e && e.max > 0) best = L;
  }
  var p = slots.pact;
  if (p && p.max > 0 && p.slot_level > best) best = p.slot_level;
  return best;
}

// Unused slots at exactly slotLevel (numeric tier + a matching pact tier summed).
export function slotAvailable(slots: SlotPool, slotLevel: number): number {
  var n = 0;
  var e = slots[String(slotLevel)];
  if (e && e.max > e.used) n += e.max - e.used;
  var p = slots.pact;
  if (p && p.slot_level === slotLevel && p.max > p.used) n += p.max - p.used;
  return n;
}

function spendReject(slots: SlotPool, reason: 'no_slot' | 'no_higher_slot' | 'bad_slot_level' | 'not_a_slot'): SpendResult {
  return { ok: false, reason: reason, slot_level: null, slots: clonePool(slots) };
}

// Spend ONE slot at exactly slotLevel. Never mutates the input (the returned
// pool is a clone whether or not the spend succeeded). Numeric slots spend
// before a matching pact slot (deterministic order).
export function spendSlot(slots: SlotPool, slotLevel: number): SpendResult {
  if (slotLevel === 0) return spendReject(slots, 'not_a_slot'); // a cantrip is not a slot
  if (!isInt(slotLevel) || slotLevel < 1 || slotLevel > MAX_SLOT_LEVEL) {
    return spendReject(slots, 'bad_slot_level');
  }
  var out = clonePool(slots);
  var e = out[String(slotLevel)];
  if (e && e.used < e.max) {
    e.used = e.used + 1;
    return { ok: true, reason: 'ok', slot_level: slotLevel, slots: out };
  }
  var p = out.pact;
  if (p && p.slot_level === slotLevel && p.used < p.max) {
    p.used = p.used + 1;
    return { ok: true, reason: 'ok', slot_level: slotLevel, slots: out };
  }
  return spendReject(slots, 'no_slot');
}

// Spend the LOWEST available slot at minLevel or above (walks up from
// min_level - the 5e RAW auto-upcast when the base tier is dry). Reason
// 'no_higher_slot' when the whole walk comes up dry.
export function spendLowestAvailable(slots: SlotPool, minLevel: number): SpendResult {
  if (minLevel === 0) return spendReject(slots, 'not_a_slot');
  if (!isInt(minLevel) || minLevel < 1 || minLevel > MAX_SLOT_LEVEL) {
    return spendReject(slots, 'bad_slot_level');
  }
  for (var L = minLevel; L <= MAX_SLOT_LEVEL; L++) {
    if (slotAvailable(slots, L) > 0) return spendSlot(slots, L);
  }
  return spendReject(slots, 'no_higher_slot');
}

// Restore `count` (default 1) spent slots at slotLevel (used floors at 0).
// Numeric tier restores first; a matching pact tier restores only when no
// numeric tier exists at that level. Unknown level is a no-op clone.
export function restoreSlot(slots: SlotPool, slotLevel: number, count?: number): SlotPool {
  var out = clonePool(slots);
  var n = isInt(count) && (count as number) > 0 ? (count as number) : 1;
  var e = out[String(slotLevel)];
  if (e) {
    e.used = e.used - n < 0 ? 0 : e.used - n;
    return out;
  }
  var p = out.pact;
  if (p && p.slot_level === slotLevel) {
    p.used = p.used - n < 0 ? 0 : p.used - n;
  }
  return out;
}

// Remaining (unused) slots per level, pact merged into its slot level.
export function slotsRemaining(slots: SlotPool): { [level: number]: number } {
  var out: { [level: number]: number } = {};
  for (var L = 1; L <= MAX_SLOT_LEVEL; L++) {
    var e = slots[String(L)];
    if (e && e.max > 0) out[L] = e.max - e.used > 0 ? e.max - e.used : 0;
  }
  var p = slots.pact;
  if (p && p.max > 0) {
    var rem = p.max - p.used > 0 ? p.max - p.used : 0;
    out[p.slot_level] = (out[p.slot_level] === undefined ? 0 : out[p.slot_level] as number) + rem;
  }
  return out;
}

// Long rest: every slot refreshes - a fresh pool for the class + level.
export function longRest(classId: string, level: number): SlotPool {
  return spellSlotsFor(classId, level);
}

// Short rest: pact slots refresh (warlock); everyone else is unchanged. The
// pact entry's shape (slot_level / max) re-derives from the tables for the
// CURRENT class + level, so a stale stored shape self-heals here too.
export function shortRest(classId: string, level: number, slots: SlotPool): SlotPool {
  var out = clonePool(slots);
  if (casterKind(classId) !== 'pact') return out;
  var fresh = spellSlotsFor(classId, level);
  var fp = fresh.pact;
  if (fp) setPact(out, { slot_level: fp.slot_level, max: fp.max, used: 0 });
  return out;
}

// THE P0 widen-merge. Shape (tiers + maxima) ALWAYS derives fresh from the
// tables for the CURRENT class + level; only `used` carries over, capped at
// the new max. Levels present in the stored pool but absent from the fresh
// shape are dropped. Non-caster / unknown class returns the stored pool
// untouched (as a clone); null/undefined/empty stored returns the fresh pool.
export function widenSlots(stored: SlotPool | null | undefined, classId: string, level: number): SlotPool {
  var kind = casterKind(classId);
  if (kind === null) return stored ? clonePool(stored) : ({} as SlotPool);
  var fresh = spellSlotsFor(classId, level);
  if (stored === null || stored === undefined) return fresh;
  var hasAny = false;
  for (var k in stored) {
    if (Object.prototype.hasOwnProperty.call(stored, k)) { hasAny = true; break; }
  }
  if (!hasAny) return fresh;
  for (var L = 1; L <= MAX_SLOT_LEVEL; L++) {
    var fe = fresh[String(L)];
    if (!fe) continue;
    var se = stored[String(L)];
    var carried = se && isInt(se.used) && se.used > 0 ? se.used : 0;
    fe.used = carried > fe.max ? fe.max : carried;
  }
  var fp = fresh.pact;
  if (fp) {
    var sp = stored.pact;
    var pc = sp && isInt(sp.used) && sp.used > 0 ? sp.used : 0;
    fp.used = pc > fp.max ? fp.max : pc;
  }
  return fresh;
}

// ---- SRD upcast ladder -------------------------------------------------------
// Mechanics-only upcast data (SRD-true). Entries with no action document yet
// (bless / bane / hex / charm_person / sleep / faerie_fire / hunters_mark)
// still ship - the ladder is useful catalog data on its own.

interface UpcastDef {
  base_level: number;
  effect: 'damage' | 'heal' | 'utility';
  concentration: boolean;
  added_dice: string;     // per upcast STEP ('' when the upcast adds no dice)
  per_levels: number;     // slot levels per step (2 for spiritual_weapon)
  extra_instances: number; // extra darts/rays/targets per slot level above base
  note: string;
}

var SPELL_UPCAST: { [id: string]: UpcastDef } = {
  magic_missile: { base_level: 1, effect: 'damage', concentration: false, added_dice: '', per_levels: 1, extra_instances: 1, note: 'one extra dart per slot level above 1st' },
  cure_wounds: { base_level: 1, effect: 'heal', concentration: false, added_dice: '1d8', per_levels: 1, extra_instances: 0, note: '+1d8 healing per slot level above 1st' },
  healing_word: { base_level: 1, effect: 'heal', concentration: false, added_dice: '1d4', per_levels: 1, extra_instances: 0, note: '+1d4 healing per slot level above 1st' },
  guiding_bolt: { base_level: 1, effect: 'damage', concentration: false, added_dice: '1d6', per_levels: 1, extra_instances: 0, note: '+1d6 damage per slot level above 1st' },
  inflict_wounds: { base_level: 1, effect: 'damage', concentration: false, added_dice: '1d10', per_levels: 1, extra_instances: 0, note: '+1d10 damage per slot level above 1st' },
  witch_bolt: { base_level: 1, effect: 'damage', concentration: true, added_dice: '1d12', per_levels: 1, extra_instances: 0, note: '+1d12 initial damage per slot level above 1st' },
  hellish_rebuke: { base_level: 1, effect: 'damage', concentration: false, added_dice: '1d10', per_levels: 1, extra_instances: 0, note: '+1d10 damage per slot level above 1st' },
  burning_hands: { base_level: 1, effect: 'damage', concentration: false, added_dice: '1d6', per_levels: 1, extra_instances: 0, note: '+1d6 damage per slot level above 1st' },
  thunderwave: { base_level: 1, effect: 'damage', concentration: false, added_dice: '1d8', per_levels: 1, extra_instances: 0, note: '+1d8 damage per slot level above 1st' },
  spiritual_weapon: { base_level: 2, effect: 'damage', concentration: false, added_dice: '1d8', per_levels: 2, extra_instances: 0, note: '+1d8 damage per TWO slot levels above 2nd - generated variants exist only at even slot levels' },
  scorching_ray: { base_level: 2, effect: 'damage', concentration: false, added_dice: '', per_levels: 1, extra_instances: 1, note: 'one extra ray per slot level above 2nd' },
  shatter: { base_level: 2, effect: 'damage', concentration: false, added_dice: '1d8', per_levels: 1, extra_instances: 0, note: '+1d8 damage per slot level above 2nd' },
  fireball: { base_level: 3, effect: 'damage', concentration: false, added_dice: '1d6', per_levels: 1, extra_instances: 0, note: '+1d6 damage per slot level above 3rd' },
  lightning_bolt: { base_level: 3, effect: 'damage', concentration: false, added_dice: '1d6', per_levels: 1, extra_instances: 0, note: '+1d6 damage per slot level above 3rd' },
  spirit_guardians: { base_level: 3, effect: 'damage', concentration: true, added_dice: '1d8', per_levels: 1, extra_instances: 0, note: '+1d8 damage per slot level above 3rd' },
  cone_of_cold: { base_level: 5, effect: 'damage', concentration: false, added_dice: '1d8', per_levels: 1, extra_instances: 0, note: '+1d8 damage per slot level above 5th' },
  hold_person: { base_level: 2, effect: 'utility', concentration: true, added_dice: '', per_levels: 1, extra_instances: 1, note: 'one extra humanoid target per slot level above 2nd (host enumerates targets)' },
  hold_monster: { base_level: 5, effect: 'utility', concentration: true, added_dice: '', per_levels: 1, extra_instances: 1, note: 'one extra target per slot level above 5th (host enumerates targets)' },
  web: { base_level: 2, effect: 'utility', concentration: true, added_dice: '', per_levels: 1, extra_instances: 0, note: 'no upcast effect' },
  blindness_deafness: { base_level: 2, effect: 'utility', concentration: false, added_dice: '', per_levels: 1, extra_instances: 1, note: 'one extra target per slot level above 2nd (host enumerates targets)' },
  slow: { base_level: 3, effect: 'utility', concentration: true, added_dice: '', per_levels: 1, extra_instances: 0, note: 'no upcast effect' },
  bless: { base_level: 1, effect: 'utility', concentration: true, added_dice: '', per_levels: 1, extra_instances: 1, note: 'one extra creature per slot level above 1st' },
  bane: { base_level: 1, effect: 'utility', concentration: true, added_dice: '', per_levels: 1, extra_instances: 1, note: 'one extra creature per slot level above 1st' },
  hex: { base_level: 1, effect: 'utility', concentration: true, added_dice: '', per_levels: 1, extra_instances: 0, note: 'higher slots extend duration (host policy)' },
  charm_person: { base_level: 1, effect: 'utility', concentration: false, added_dice: '', per_levels: 1, extra_instances: 1, note: 'one extra creature per slot level above 1st' },
  sleep: { base_level: 1, effect: 'utility', concentration: false, added_dice: '2d8', per_levels: 1, extra_instances: 0, note: '+2d8 to the hit-point pool per slot level above 1st' },
  faerie_fire: { base_level: 1, effect: 'utility', concentration: true, added_dice: '', per_levels: 1, extra_instances: 0, note: 'no upcast effect' },
  hunters_mark: { base_level: 1, effect: 'utility', concentration: true, added_dice: '', per_levels: 1, extra_instances: 0, note: 'higher slots extend duration (host policy)' },
};

var DICE_RE = /^([0-9]+)d([0-9]+)([+-][0-9]+)?$/;

export function spellRequiresConcentration(spellId: string): boolean {
  var def = SPELL_UPCAST[normId(spellId)];
  return def ? def.concentration : false;
}

export function spellBaseLevel(spellId: string): number | null {
  var def = SPELL_UPCAST[normId(spellId)];
  return def ? def.base_level : null;
}

// Resolve the upcast effect of casting spellId with a slot of castSlotLevel.
// The cast level is clamped into base_level..MAX_SLOT_LEVEL (a non-integer or
// under-level request casts at base). Unknown spell -> null.
export function upcastEffect(spellId: string, castSlotLevel: number): UpcastInfo | null {
  var id = normId(spellId);
  var def = SPELL_UPCAST[id];
  if (!def) return null;
  var cast = isInt(castSlotLevel) ? castSlotLevel : def.base_level;
  if (cast < def.base_level) cast = def.base_level;
  if (cast > MAX_SLOT_LEVEL) cast = MAX_SLOT_LEVEL;
  var above = cast - def.base_level;
  var steps = def.per_levels > 0 ? Math.floor(above / def.per_levels) : 0;
  var addedDice = '';
  if (def.added_dice !== '' && steps > 0) {
    var m = DICE_RE.exec(def.added_dice);
    if (m) addedDice = String(parseInt(m[1] as string, 10) * steps) + 'd' + m[2];
  }
  var extra = def.extra_instances > 0 ? def.extra_instances * above : 0;
  return {
    spell_id: id,
    base_level: def.base_level,
    cast_level: cast,
    levels_above: above,
    effect: def.effect,
    concentration: def.concentration,
    added_dice: addedDice,
    extra_instances: extra,
    note: def.note,
  };
}

// Total damage/heal dice for a cast: baseDice plus the upcast's added dice.
// Only same-sided dice merge (every SRD entry here adds the same die as its
// base); anything else returns baseDice unchanged. The base equation's flat
// modifier (if any) is preserved once, never scaled.
export function totalDiceForCast(baseDice: string, spellId: string, castSlotLevel: number): string {
  var bm = DICE_RE.exec(typeof baseDice === 'string' ? baseDice : '');
  if (!bm) return baseDice;
  var info = upcastEffect(spellId, castSlotLevel);
  if (!info || info.added_dice === '') return baseDice;
  var am = /^([0-9]+)d([0-9]+)$/.exec(info.added_dice);
  if (!am) return baseDice;
  if (am[2] !== bm[2]) return baseDice;
  var total = parseInt(bm[1] as string, 10) + parseInt(am[1] as string, 10);
  return String(total) + 'd' + bm[2] + (bm[3] ? bm[3] : '');
}
