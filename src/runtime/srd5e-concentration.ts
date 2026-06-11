// srd5e-concentration.ts - the 5e concentration state machine (content pack).
//
// PURE and RNG-FREE BY DESIGN: the caller rolls the d20 CON save (via its own
// AST check or host rng) and passes the TOTAL in - this module only decides.
// The one-spell-at-a-time rule lives in startConcentration's `dropped` return.
//
// Content: mechanics from the D&D 5e System Reference Document 5.1
// (CC-BY-4.0) - see NOTICE.md. DC = max(10, floor(damage / 2)), keep iff
// total >= dc.
//
// Code style: var-only, no arrow functions.

import { floorDiv } from './integer-math.js';

export var CONCENTRATION_MIN_DC: number = 10;

export interface ConcentrationState {
  spell_id: string;
  spell_name: string;
  slot_level?: number;
}

export interface ConcChange {
  concentration: ConcentrationState | null;
  dropped: ConcentrationState | null;
}

export interface MaintainResult {
  needed: boolean;
  dc: number;
  total: number;
  success: boolean;
  concentration: ConcentrationState | null;
  dropped: ConcentrationState | null;
}

function cloneState(c: ConcentrationState): ConcentrationState {
  var out: ConcentrationState = { spell_id: c.spell_id, spell_name: c.spell_name };
  if (typeof c.slot_level === 'number') out.slot_level = c.slot_level;
  return out;
}

// The concentration save DC for taking `damage`: max(10, floor(damage / 2)).
// floorDiv is the engine's one division (toward -inf), shared across surfaces.
export function maintainSaveDc(damage: number): number {
  var dmg = typeof damage === 'number' && isFinite(damage) ? Math.floor(damage) : 0;
  var half = floorDiv(dmg, 2);
  return half > CONCENTRATION_MIN_DC ? half : CONCENTRATION_MIN_DC;
}

export function isConcentrating(c: ConcentrationState | null | undefined): boolean {
  return !!(c && typeof c.spell_id === 'string' && c.spell_id.length > 0);
}

// Begin concentrating on a spell. If already concentrating, the previous
// spell DROPS (one spell at a time - 5e RAW) and is returned in `dropped`.
export function startConcentration(
  c: ConcentrationState | null, spellId: string, spellName?: string, slotLevel?: number,
): ConcChange {
  var dropped = isConcentrating(c) ? cloneState(c as ConcentrationState) : null;
  var next: ConcentrationState = {
    spell_id: spellId,
    spell_name: typeof spellName === 'string' && spellName.length > 0 ? spellName : spellId,
  };
  if (typeof slotLevel === 'number' && isFinite(slotLevel)) next.slot_level = Math.floor(slotLevel);
  return { concentration: next, dropped: dropped };
}

// Voluntarily (or forcibly) end concentration. No-op when not concentrating.
export function dropConcentration(c: ConcentrationState | null): ConcChange {
  if (!isConcentrating(c)) return { concentration: null, dropped: null };
  return { concentration: null, dropped: cloneState(c as ConcentrationState) };
}

// Resolve a concentration save after taking damage. The caller has already
// rolled the d20 CON save and passes the TOTAL; this module compares it to
// the DC. Keep iff total >= dc (exact direction - 5e RAW "DC or higher").
// Not concentrating: nothing is needed and nothing can drop.
export function maintainSave(
  c: ConcentrationState | null, damage: number, conSaveTotal: number,
): MaintainResult {
  var dc = maintainSaveDc(damage);
  var total = typeof conSaveTotal === 'number' && isFinite(conSaveTotal) ? Math.floor(conSaveTotal) : 0;
  if (!isConcentrating(c)) {
    return { needed: false, dc: dc, total: total, success: true, concentration: c === undefined ? null : c, dropped: null };
  }
  var keep = total >= dc;
  if (keep) {
    return { needed: true, dc: dc, total: total, success: true, concentration: cloneState(c as ConcentrationState), dropped: null };
  }
  return { needed: true, dc: dc, total: total, success: false, concentration: null, dropped: cloneState(c as ConcentrationState) };
}
