//! loom_math - deterministic integer math + RNG for the Loom Engine core.
//!
//! Byte-identical across platforms: pure wrapping integer ops only, no floats,
//! no platform intrinsics. wasm32 and x86_64 (and a future Python/PyO3 or C#
//! binding) yield the EXACT same sequence for a given seed. This is the
//! canonical RNG + math every Loom surface must reproduce - the foundation of
//! the cross-language determinism guarantee.
//!
//! Phase 1 of the Rust extraction (see ../../LOOM-RUST-EXTRACTION-SPEC.md):
//! "swap only the dice-rolling mechanism, validate identical sequences."

#![forbid(unsafe_code)]
// no_std for normal builds (WASM / embedded-friendly); std is pulled in only for
// the test harness.
#![cfg_attr(not(test), no_std)]

/// PCG32 (XSH RR 64/32 variant) - small, fast, statistically strong, and fully
/// deterministic via wrapping integer arithmetic. The reference RNG the TS +
/// Python surfaces must reproduce bit-for-bit.
#[derive(Clone, Debug)]
pub struct Pcg32 {
    state: u64,
    inc: u64,
}

impl Pcg32 {
    /// The PCG multiplier constant (LCG step).
    pub const MULT: u64 = 6364136223846793005;
    /// Default stream selector when a caller only supplies a seed.
    pub const DEFAULT_STREAM: u64 = 0xda3e_39cb_94b9_5bdb;

    /// Construct from a seed + a stream selector (`seq`). Two PRNGs with the same
    /// seed but different streams produce distinct, non-correlated sequences.
    pub fn new(seed: u64, seq: u64) -> Self {
        let mut rng = Pcg32 {
            state: 0,
            inc: (seq << 1) | 1,
        };
        let _ = rng.next_u32();
        rng.state = rng.state.wrapping_add(seed);
        let _ = rng.next_u32();
        rng
    }

    /// Construct from a seed alone (uses DEFAULT_STREAM).
    pub fn seeded(seed: u64) -> Self {
        Pcg32::new(seed, Self::DEFAULT_STREAM)
    }

    /// The next 32-bit output + advance the state.
    pub fn next_u32(&mut self) -> u32 {
        let old = self.state;
        self.state = old.wrapping_mul(Self::MULT).wrapping_add(self.inc);
        // XSH RR: xorshift high bits, then a data-dependent rotate.
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        let rot = (old >> 59) as u32;
        xorshifted.rotate_right(rot)
    }

    /// Uniform integer in `[0, bound)` with NO modulo bias (rejection sampling).
    /// `bound == 0` returns 0.
    pub fn bounded_u32(&mut self, bound: u32) -> u32 {
        if bound == 0 {
            return 0;
        }
        // Reject the low `2^32 mod bound` outputs so the rest map uniformly.
        let threshold = bound.wrapping_neg() % bound;
        loop {
            let r = self.next_u32();
            if r >= threshold {
                return r % bound;
            }
        }
    }

    /// Roll one die with `sides` faces -> `1..=sides`. `sides == 0` returns 0.
    /// Unbiased (built on bounded_u32).
    pub fn roll_die(&mut self, sides: u32) -> u32 {
        if sides == 0 {
            return 0;
        }
        self.bounded_u32(sides) + 1
    }

    /// Roll `count` dice of `sides` faces, returning the sum. Deterministic in
    /// roll order (die 1, die 2, ...), so a replay reproduces it exactly.
    pub fn roll_dice(&mut self, count: u32, sides: u32) -> u64 {
        let mut total: u64 = 0;
        let mut i = 0;
        while i < count {
            total = total.wrapping_add(self.roll_die(sides) as u64);
            i += 1;
        }
        total
    }
}

/// Floor division (rounds toward negative infinity, like Python `//`). The ONE
/// cross-language division contract: every surface calls this instead of native
/// `/` so TS (which truncates toward zero) and Rust agree on negative operands.
/// Returns 0 on a zero divisor (defensive; the core never divides by zero).
pub fn floor_div(a: i64, b: i64) -> i64 {
    if b == 0 {
        return 0;
    }
    // Codex P1: i64::MIN / -1 overflows a fixed-width divide and would PANIC
    // (UB across the C ABI). a / -1 == -a, and floor(-a) == -a for integers, so
    // return the wrapping negation - no panic. (wrapping_neg(i64::MIN) ==
    // i64::MIN; the true value 2^63 is unrepresentable, and the bindings reject
    // this one input explicitly rather than return a wrong number.)
    if b == -1 {
        return a.wrapping_neg();
    }
    let q = a / b;
    if (a % b != 0) && ((a < 0) != (b < 0)) {
        q - 1
    } else {
        q
    }
}

/// Modulo paired with `floor_div` (result takes the divisor's sign), so
/// `floor_div(a,b) * b + floor_mod(a,b) == a`.
pub fn floor_mod(a: i64, b: i64) -> i64 {
    if b == 0 {
        return 0;
    }
    // wrapping so the i64::MIN / -1 edge (mod == 0) cannot panic on the multiply.
    a.wrapping_sub(floor_div(a, b).wrapping_mul(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pcg32_is_deterministic_for_a_seed() {
        let mut a = Pcg32::seeded(883_719_472);
        let mut b = Pcg32::seeded(883_719_472);
        for _ in 0..1000 {
            assert_eq!(a.next_u32(), b.next_u32());
        }
    }

    #[test]
    fn pcg32_distinct_seeds_diverge() {
        let mut a = Pcg32::seeded(1);
        let mut b = Pcg32::seeded(2);
        // Vanishingly unlikely to match across 8 draws if seeding works.
        let mut same = 0;
        for _ in 0..8 {
            if a.next_u32() == b.next_u32() {
                same += 1;
            }
        }
        assert!(same < 8);
    }

    #[test]
    fn roll_die_in_range_and_replayable() {
        let mut r = Pcg32::seeded(42);
        for _ in 0..10_000 {
            let d = r.roll_die(20);
            assert!((1..=20).contains(&d));
        }
        // d0 -> 0 (defensive).
        assert_eq!(Pcg32::seeded(1).roll_die(0), 0);
        // replay: same seed -> same multi-die sum.
        let s1 = Pcg32::seeded(7).roll_dice(3, 6);
        let s2 = Pcg32::seeded(7).roll_dice(3, 6);
        assert_eq!(s1, s2);
        assert!((3..=18).contains(&s1));
    }

    #[test]
    fn floor_div_matches_python_semantics() {
        assert_eq!(floor_div(7, 3), 2);
        assert_eq!(floor_div(-7, 3), -3); // floors toward -inf (Python: -7 // 3 == -3)
        assert_eq!(floor_div(7, -3), -3);
        assert_eq!(floor_div(-7, -3), 2);
        assert_eq!(floor_div(6, 3), 2);
        assert_eq!(floor_div(5, 0), 0); // defensive
        // Codex P1: the i64::MIN / -1 overflow edge must NOT panic.
        assert_eq!(floor_div(i64::MIN, -1), i64::MIN); // wrapping (true 2^63 unrepresentable)
        assert_eq!(floor_mod(i64::MIN, -1), 0);
        assert_eq!(floor_div(-9, -1), 9); // b == -1 general case stays exact
        assert_eq!(floor_div(9, -1), -9);
        // floor_div * b + floor_mod == a
        for &(a, b) in &[(7i64, 3i64), (-7, 3), (7, -3), (-7, -3), (10, 4)] {
            assert_eq!(floor_div(a, b) * b + floor_mod(a, b), a);
        }
    }

    #[test]
    fn emit_pcg32_golden() {
        // Emits the cross-language PCG32 reference (run with --nocapture). The TS +
        // Python ports must reproduce it; captured into test_vectors/v3_pcg32.json.
        fn seq(seed: u64, n: usize) -> Vec<u32> {
            let mut r = Pcg32::seeded(seed);
            (0..n).map(|_| r.next_u32()).collect()
        }
        let mut r7 = Pcg32::seeded(7);
        let dice = r7.roll_dice(3, 6);
        let mut r7b = Pcg32::seeded(7);
        let dies: Vec<u32> = (0..5).map(|_| r7b.roll_die(20)).collect();
        println!("PCG32_VECTOR_BEGIN");
        println!(
            "{{\"seed42_next8\":{:?},\"seed1_next4\":{:?},\"seed7_roll3d6\":{},\"seed7_die20x5\":{:?}}}",
            seq(42, 8),
            seq(1, 4),
            dice,
            dies
        );
        println!("PCG32_VECTOR_END");
    }
}
