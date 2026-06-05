"""pcg32 - PCG32 (XSH RR 64/32) PRNG + the floor-division contract (Python).

Bit-identical to the Rust loom_math::Pcg32 and the TS pcg32.ts, pinned by
test_vectors/v3_pcg32.json. Python ints are arbitrary precision, so the 64-bit
LCG just masks to 64 bits; floor_div is Python's native // (which already floors
toward -inf - exactly the cross-language division contract).
"""

_MASK64 = (1 << 64) - 1
_MASK32 = 0xFFFFFFFF
_MULT = 6364136223846793005
_DEFAULT_STREAM = 0xDA3E39CB94B95BDB


class Pcg32:
    """PCG32 XSH RR 64/32 - the canonical deterministic PRNG."""

    MULT = _MULT
    DEFAULT_STREAM = _DEFAULT_STREAM

    def __init__(self, seed, seq):
        # 3.0 Phase 3: count of next_u32() draws since construction (or since
        # from_raw / restore last reset it). Pure metadata - never affects outputs
        # - reported as pcg_steps_consumed by the Epoch world-tick. Mirrors the
        # TS pcg32.ts / Rust draws counter.
        self._draws = 0
        self._state = 0
        self._inc = ((seq << 1) | 1) & _MASK64
        self.next_u32()
        self._state = (self._state + (seed & _MASK64)) & _MASK64
        self.next_u32()

    @classmethod
    def seeded(cls, seed):
        return cls(seed, _DEFAULT_STREAM)

    @classmethod
    def from_raw(cls, raw_state, raw_inc):
        """3.0 Phase 3: construct directly from a RAW (state, inc) pair - NO seeding
        steps. The Epoch world-tick derives these from SHA-256(world_id || epoch),
        so the offline PRNG is reproducible by any surface from PUBLIC inputs alone.
        inc is forced odd (a PCG requirement). Resets the draw counter to 0.
        Matches the TS Pcg32.fromRaw / Rust Pcg32::from_raw."""
        p = cls(0, 0)
        p._state = raw_state & _MASK64
        p._inc = (raw_inc | 1) & _MASK64
        p._draws = 0
        return p

    def get_draws(self):
        """Draws (next_u32 calls) since construction or the last from_raw / restore."""
        return self._draws

    def snapshot(self):
        """Capture the full PRNG position (state, inc, draws). The Epoch tick
        captures before resolving a proposal and restores on rejection, so a
        rejected proposal advances the PRNG by exactly zero on every surface."""
        return (self._state, self._inc, self._draws)

    def restore(self, snap):
        self._state, self._inc, self._draws = snap

    def next_u32(self):
        self._draws += 1
        old = self._state
        self._state = (old * _MULT + self._inc) & _MASK64
        xorshifted = (((old >> 18) ^ old) >> 27) & _MASK32
        rot = (old >> 59) & 31
        if rot == 0:
            return xorshifted
        return ((xorshifted >> rot) | (xorshifted << (32 - rot))) & _MASK32

    def bounded_u32(self, bound):
        if bound == 0:
            return 0
        threshold = ((1 << 32) - bound) % bound
        while True:
            r = self.next_u32()
            if r >= threshold:
                return r % bound

    def roll_die(self, sides):
        if sides == 0:
            return 0
        return self.bounded_u32(sides) + 1

    def roll_dice(self, count, sides):
        total = 0
        for _ in range(count):
            total += self.roll_die(sides)
        return total


def floor_div(a, b):
    """Floor division (toward -inf). Python // is already this for ints."""
    if b == 0:
        return 0
    return a // b


def floor_mod(a, b):
    """Modulo paired with floor_div (takes the divisor's sign)."""
    if b == 0:
        return 0
    return a % b
