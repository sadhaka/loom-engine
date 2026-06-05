// integer-math.ts - the cross-language integer division contract.
//
// 3.0 primitive. floorDiv rounds toward negative infinity (Python `//`), so TS -
// whose native `/` truncates toward zero - agrees with the Rust loom_math
// floor_div on NEGATIVE operands. Every deterministic surface calls this instead
// of native `/`; the ruleset AST has NO native-division node, only floor_div.
//
// Exact for all JS-safe integers: the division is done in BigInt, because float
// `a / b` can mis-round near 2^53 and yield a wrong truncation. Pinned by the
// floor_div cases in test_vectors/v3_pcg32.json (shared with Rust).
//
// Code style: var-only in browser source.
// Floor division (toward -inf). Returns 0 on a zero divisor (defensive; the
// deterministic core never divides by zero). Inputs are JS-safe integers.
export function floorDiv(a, b) {
    if (b === 0)
        return 0;
    var ba = BigInt(a);
    var bb = BigInt(b);
    var q = ba / bb; // BigInt division truncates toward zero - exact, no float.
    if (((ba % bb) !== 0n) && ((ba < 0n) !== (bb < 0n))) {
        q = q - 1n;
    }
    return Number(q);
}
// Modulo paired with floorDiv (result takes the divisor's sign), so
// floorDiv(a,b) * b + floorMod(a,b) === a.
export function floorMod(a, b) {
    if (b === 0)
        return 0;
    var ba = BigInt(a);
    var bb = BigInt(b);
    return Number(ba - BigInt(floorDiv(a, b)) * bb);
}
//# sourceMappingURL=integer-math.js.map