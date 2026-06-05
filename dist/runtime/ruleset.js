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
// The per-turn starting budget. 5e: 1 action + 1 bonus + 1 reaction. PF2e:
// 3 actions + 1 reaction. (Movement is tracked by the positioning layer and the
// reaction by the reaction-economy module across turns; this is the ACTIVE
// in-turn budget.)
export function startTurnBudget(ruleset) {
    if (ruleset === 'pf2e') {
        return { ruleset: 'pf2e', resources: { action: 3, reaction: 1 } };
    }
    return { ruleset: '5e', resources: { action: 1, bonus: 1, reaction: 1 } };
}
// True iff at least `n` (default 1) of `resource` remains.
export function canSpend(budget, resource, n) {
    var need = typeof n === 'number' && n > 0 ? n : 1;
    var have = budget.resources[resource];
    return typeof have === 'number' && have >= need;
}
// Spend `n` (default 1) of a resource. Returns true if spent, false if
// insufficient (no change on failure).
export function spend(budget, resource, n) {
    var need = typeof n === 'number' && n > 0 ? n : 1;
    if (!canSpend(budget, resource, need))
        return false;
    budget.resources[resource] = budget.resources[resource] - need;
    return true;
}
// UTF-8 byte comparison - matches Rust's `&[u8]` cmp + Python's encode('utf-8')
// compare (and codepoint order, which JS `<` does NOT give for astral chars).
function utf8Compare(a, b) {
    var ba = new TextEncoder().encode(a);
    var bb = new TextEncoder().encode(b);
    var n = ba.length < bb.length ? ba.length : bb.length;
    for (var i = 0; i < n; i++) {
        var x = ba[i];
        var y = bb[i];
        if (x !== y)
            return x < y ? -1 : 1;
    }
    return ba.length === bb.length ? 0 : (ba.length < bb.length ? -1 : 1);
}
// A "pure numeric" id: optional '-' then >=1 ASCII digit.
function isPureNumeric(s) {
    var rest = s.charCodeAt(0) === 45 ? s.slice(1) : s; // 45 = '-'
    if (rest.length === 0)
        return false;
    for (var i = 0; i < rest.length; i++) {
        var c = rest.charCodeAt(i);
        if (c < 48 || c > 57)
            return false; // not 0-9
    }
    return true;
}
function normalizeNumeric(s) {
    var neg = s.charCodeAt(0) === 45;
    var digits = neg ? s.slice(1) : s;
    var i = 0;
    while (i < digits.length - 1 && digits.charCodeAt(i) === 48)
        i++; // strip leading zeros, keep >=1
    var mag = digits.slice(i);
    if (mag === '')
        mag = '0';
    return { neg: neg && mag !== '0', mag: mag }; // -0 is +0
}
// Numeric-aware id comparison (Codex P1 / the shadow-wire finding). Numeric ids
// sort by VALUE (2 < 10), strings lexicographically, numbers before strings. No
// integer parsing - sign + digit-length + UTF-8 bytes, so ids beyond 2^53 / i64
// (uuids, huge numbers) are correct. Byte-identical across TS / Rust / Python.
export function compareIds(a, b) {
    var na = isPureNumeric(a);
    var nb = isPureNumeric(b);
    if (na && !nb)
        return -1; // numbers before strings
    if (!na && nb)
        return 1;
    if (!na && !nb)
        return utf8Compare(a, b);
    var an = normalizeNumeric(a);
    var bn = normalizeNumeric(b);
    if (!an.neg && bn.neg)
        return 1; // +a > -b
    if (an.neg && !bn.neg)
        return -1;
    var mag;
    if (an.mag.length !== bn.mag.length) {
        mag = an.mag.length < bn.mag.length ? -1 : 1;
    }
    else {
        mag = utf8Compare(an.mag, bn.mag);
    }
    var byValue = an.neg ? -mag : mag; // both negative: larger magnitude is smaller
    if (byValue !== 0)
        return byValue;
    return utf8Compare(a, b); // math-equal (e.g. "02" vs "2"): raw bytes, total order
}
// Deterministic initiative order: total DESC, then modifier DESC, then natural
// d20 DESC, then a NUMERIC-AWARE id tiebreak (compareIds). One tiebreak for BOTH
// 5e and PF2e and for integer ids AND string entity ids. Returns a NEW array.
export function initiativeOrder(entries) {
    var copy = entries.slice();
    copy.sort(function (a, b) {
        if (b.total !== a.total)
            return b.total - a.total;
        var am = a.modifier || 0;
        var bm = b.modifier || 0;
        if (bm !== am)
            return bm - am;
        var ad = a.d20 || 0;
        var bd = b.d20 || 0;
        if (bd !== ad)
            return bd - ad;
        return compareIds(a.id, b.id);
    });
    return copy;
}
// ---- Conditions (content-agnostic duration tracker) -----------------------
// A condition's remaining duration: a positive round count, or this sentinel
// for "until removed" (never ticks down). Covers both 5e "for N rounds" and
// PF2e value-N conditions as well as open-ended ones.
export const DURATION_UNTIL_REMOVED = -1;
export function createConditionTrack() {
    return { conditions: new Map() };
}
// Apply (or refresh) a condition by id. A `rounds` of 0 or omitted is treated as
// "until removed"; a positive value is a finite duration.
export function applyCondition(track, conditionId, rounds) {
    if (!conditionId)
        return;
    var r = typeof rounds === 'number' ? Math.floor(rounds) : DURATION_UNTIL_REMOVED;
    if (r === 0)
        r = DURATION_UNTIL_REMOVED;
    track.conditions.set(conditionId, r);
}
export function removeCondition(track, conditionId) {
    return track.conditions.delete(conditionId);
}
export function hasCondition(track, conditionId) {
    return track.conditions.has(conditionId);
}
// Remaining rounds for a condition, DURATION_UNTIL_REMOVED if open-ended, or 0
// if absent.
export function conditionRemaining(track, conditionId) {
    var v = track.conditions.get(conditionId);
    return v === undefined ? 0 : v;
}
// Tick every FINITE condition down one round; expire (remove) any that reach 0.
// The DURATION_UNTIL_REMOVED sentinel never ticks. Returns the expired ids in
// insertion order (deterministic).
export function tickConditions(track) {
    var expired = [];
    for (var entry of track.conditions) {
        var id = entry[0];
        var rem = entry[1];
        if (rem === DURATION_UNTIL_REMOVED)
            continue;
        if (rem <= 1)
            expired.push(id);
        else
            track.conditions.set(id, rem - 1);
    }
    for (var e of expired)
        track.conditions.delete(e);
    // Codex P1: SORTED order (UTF-8 bytes) so the returned ids match the Rust
    // core's BTreeMap iteration - cross-language identical, not insertion-order.
    expired.sort(utf8Compare);
    return expired;
}
// Active condition ids in canonical SORTED order (UTF-8 bytes), matching the
// Rust core's BTreeMap - identical across languages, not insertion-dependent.
export function activeConditions(track) {
    var out = [];
    for (var entry of track.conditions)
        out.push(entry[0]);
    out.sort(utf8Compare);
    return out;
}
export const RESOURCE_RULESET = 'ruleset';
//# sourceMappingURL=ruleset.js.map