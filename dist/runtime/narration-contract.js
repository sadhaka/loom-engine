// Narration Contract - the "engine owns outcomes, AI only narrates" guarantee.
//
// v2.3.0. This is the differentiator between an engine-adjudicated AI game and a
// pure-LLM story app: the dice are REAL, and the narrator may only DESCRIBE the
// engine's outcomes - it can never INVENT a roll, a total, a DC, or a damage
// number. This module is the deterministic checker for that guarantee
// (validate-before-show): given the canonical numbers the engine produced this
// turn, find any mechanics-significant number in the prose the engine did NOT
// produce.
//
// It catches numerals ("you take 7 damage") AND number-words ("you take seven
// damage"), so a narrator cannot smuggle an invented value past in words.
//
// Conservative + configurable: small "flavor" counts ("the two guards", "a
// dozen torches") are genuinely ambiguous, so numbers at/below `ignoreAtOrBelow`
// (default 2) are not treated as mechanics claims. The caller passes the
// ENGINE's attested numbers (dice results, totals, DCs, damage, remaining HP);
// any other number of size in the prose is invented -> reject + re-narrate.
//
// Pure + deterministic. Code style: var-only, no arrow functions.
var ONES = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19,
};
var TENS = {
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
    eighty: 80, ninety: 90,
};
// Parse a single number-WORD token ("seven", "twenty", "twenty-one",
// "twenty one") to its value, or null if it is not a number word. Handles a
// tens word optionally joined (by hyphen or space) to a ones word 1-9.
export function parseNumberWord(token) {
    var t = String(token || '').trim().toLowerCase();
    if (!t)
        return null;
    if (Object.prototype.hasOwnProperty.call(ONES, t))
        return ONES[t];
    if (Object.prototype.hasOwnProperty.call(TENS, t))
        return TENS[t];
    // "twenty-one" / "twenty one"
    var parts = t.split(/[\s-]+/);
    if (parts.length === 2) {
        var tens = TENS[parts[0]];
        var ones = ONES[parts[1]];
        if (tens !== undefined && ones !== undefined && ones >= 1 && ones <= 9) {
            return tens + ones;
        }
    }
    return null;
}
// Every candidate mechanics number in `text` - both numerals (\d+, ignoring
// decimals' fractional part and ordinals) and number-words (including
// "twenty-one"). Order-preserving, with duplicates (the caller dedupes if it
// cares). Deterministic.
export function extractCandidateNumbers(text) {
    var out = [];
    if (!text || typeof text !== 'string')
        return out;
    var lower = text.toLowerCase();
    // Numerals: runs of digits (comma separators tolerated: 1,024).
    var numRe = /\d[\d,]*/g;
    var m;
    while ((m = numRe.exec(text)) !== null) {
        var raw = m[0].replace(/,/g, '');
        var n = parseInt(raw, 10);
        if (!isNaN(n))
            out.push(n);
    }
    // Number-words. Walk word tokens; greedily fold a tens word + a following
    // ones word into one value (so "twenty one" counts once as 21, not 20 + 1).
    var words = lower.split(/[^a-z]+/);
    for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (!w)
            continue;
        if (TENS[w] !== undefined) {
            var next = (i + 1 < words.length ? words[i + 1] : '');
            var ones = ONES[next];
            if (ones !== undefined && ones >= 1 && ones <= 9) {
                out.push(TENS[w] + ones);
                i++; // consume the ones word
            }
            else {
                out.push(TENS[w]);
            }
        }
        else if (ONES[w] !== undefined) {
            out.push(ONES[w]);
        }
    }
    return out;
}
// Find the first mechanics-significant number in `text` that is NOT in the
// engine's attested set, or null if the prose invents nothing. `attested` is
// every number the engine actually produced this turn (rolls, totals, DCs,
// damage, remaining HP). This is the no-invented-number backstop.
export function findInventedNumber(text, attested, opts) {
    var floor = opts && typeof opts.ignoreAtOrBelow === 'number' ? opts.ignoreAtOrBelow : 2;
    var allowed = new Set();
    if (attested) {
        for (var a of attested) {
            if (typeof a === 'number' && !isNaN(a))
                allowed.add(a);
        }
    }
    var candidates = extractCandidateNumbers(text);
    for (var c of candidates) {
        if (c <= floor)
            continue; // ambiguous flavor count - not a claim
        if (!allowed.has(c))
            return c; // a number the engine never produced
    }
    return null;
}
// True iff the prose introduces no mechanics number the engine did not produce.
export function isNarrationGrounded(text, attested, opts) {
    return findInventedNumber(text, attested, opts) === null;
}
// Resource key for the world's resource registry.
export const RESOURCE_NARRATION_CONTRACT = 'narrationContract';
//# sourceMappingURL=narration-contract.js.map