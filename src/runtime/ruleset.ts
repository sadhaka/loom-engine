// Ruleset Adapters - 5e + PF2e action economy, initiative ordering, conditions.
//
// v2.3.0. Deterministic, content-agnostic primitives for the two rulesets the
// engine targets. PURE: no RNG (the d20 itself is rolled by the engine's seeded
// PRNG; this module does the ruleset-correct ORDERING), no wall-clock. It covers
// the three mechanics that differ by system: the per-turn action budget, the
// initiative tiebreak, and a condition-duration tracker.
//
// Compatible with the D&D 5e SRD (CC-BY-4.0) and the Pathfinder Second Edition
// Remaster ruleset (ORC License) - see NOTICE.md. Not affiliated with or
// endorsed by Wizards of the Coast or Paizo. Condition NAMES are supplied by the
// caller (the tracker is content-agnostic), so no SRD text is reproduced here.
//
// Code style: var-only, no arrow functions.

export type RulesetId = '5e' | 'pf2e';

// ---- Action economy -------------------------------------------------------

export interface TurnBudget {
  ruleset: RulesetId;
  resources: { [resource: string]: number };
}

// The per-turn starting budget. 5e: 1 action + 1 bonus + 1 reaction. PF2e:
// 3 actions + 1 reaction. (Movement is tracked by the positioning layer and the
// reaction by the reaction-economy module across turns; this is the ACTIVE
// in-turn budget.)
export function startTurnBudget(ruleset: RulesetId): TurnBudget {
  if (ruleset === 'pf2e') {
    return { ruleset: 'pf2e', resources: { action: 3, reaction: 1 } };
  }
  return { ruleset: '5e', resources: { action: 1, bonus: 1, reaction: 1 } };
}

// True iff at least `n` (default 1) of `resource` remains.
export function canSpend(budget: TurnBudget, resource: string, n?: number): boolean {
  var need = typeof n === 'number' && n > 0 ? n : 1;
  var have = budget.resources[resource];
  return typeof have === 'number' && have >= need;
}

// Spend `n` (default 1) of a resource. Returns true if spent, false if
// insufficient (no change on failure).
export function spend(budget: TurnBudget, resource: string, n?: number): boolean {
  var need = typeof n === 'number' && n > 0 ? n : 1;
  if (!canSpend(budget, resource, need)) return false;
  budget.resources[resource] = (budget.resources[resource] as number) - need;
  return true;
}

// ---- Initiative ordering --------------------------------------------------

export interface InitiativeEntry {
  id: string;
  total: number;       // d20 + modifier
  modifier?: number;   // DEX mod (5e) / initiative mod (PF2e)
  d20?: number;        // the natural roll, for tiebreaks
}

// Deterministic initiative order: total DESC, then modifier DESC, then natural
// d20 DESC, then id ASC (stable). One tiebreak for BOTH 5e and PF2e (both break
// initiative ties by the modifier). Returns a NEW sorted array; input untouched.
export function initiativeOrder(entries: ReadonlyArray<InitiativeEntry>): InitiativeEntry[] {
  var copy = entries.slice();
  copy.sort(function (a, b) {
    if (b.total !== a.total) return b.total - a.total;
    var am = a.modifier || 0;
    var bm = b.modifier || 0;
    if (bm !== am) return bm - am;
    var ad = a.d20 || 0;
    var bd = b.d20 || 0;
    if (bd !== ad) return bd - ad;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  });
  return copy;
}

// ---- Conditions (content-agnostic duration tracker) -----------------------

// A condition's remaining duration: a positive round count, or this sentinel
// for "until removed" (never ticks down). Covers both 5e "for N rounds" and
// PF2e value-N conditions as well as open-ended ones.
export const DURATION_UNTIL_REMOVED = -1;

export interface ConditionTrack {
  conditions: Map<string, number>;
}

export function createConditionTrack(): ConditionTrack {
  return { conditions: new Map() };
}

// Apply (or refresh) a condition by id. A `rounds` of 0 or omitted is treated as
// "until removed"; a positive value is a finite duration.
export function applyCondition(track: ConditionTrack, conditionId: string, rounds?: number): void {
  if (!conditionId) return;
  var r = typeof rounds === 'number' ? Math.floor(rounds) : DURATION_UNTIL_REMOVED;
  if (r === 0) r = DURATION_UNTIL_REMOVED;
  track.conditions.set(conditionId, r);
}

export function removeCondition(track: ConditionTrack, conditionId: string): boolean {
  return track.conditions.delete(conditionId);
}

export function hasCondition(track: ConditionTrack, conditionId: string): boolean {
  return track.conditions.has(conditionId);
}

// Remaining rounds for a condition, DURATION_UNTIL_REMOVED if open-ended, or 0
// if absent.
export function conditionRemaining(track: ConditionTrack, conditionId: string): number {
  var v = track.conditions.get(conditionId);
  return v === undefined ? 0 : v;
}

// Tick every FINITE condition down one round; expire (remove) any that reach 0.
// The DURATION_UNTIL_REMOVED sentinel never ticks. Returns the expired ids in
// insertion order (deterministic).
export function tickConditions(track: ConditionTrack): string[] {
  var expired: string[] = [];
  for (var entry of track.conditions) {
    var id = entry[0];
    var rem = entry[1];
    if (rem === DURATION_UNTIL_REMOVED) continue;
    if (rem <= 1) expired.push(id);
    else track.conditions.set(id, rem - 1);
  }
  for (var e of expired) track.conditions.delete(e);
  return expired;
}

// Active condition ids in insertion order (deterministic).
export function activeConditions(track: ConditionTrack): string[] {
  var out: string[] = [];
  for (var entry of track.conditions) out.push(entry[0]);
  return out;
}

export const RESOURCE_RULESET = 'ruleset';
