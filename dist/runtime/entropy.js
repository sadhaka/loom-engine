// Entropy - the engine's seeded PRNG resource.
//
// Replaces Math.random() in any code path that wants deterministic
// behaviour across replays / smoke tests / save state / network sync.
// Math.random() is non-reproducible (different across runs, different
// across V8 builds). The engine never wants that.
//
// This module is the only way the engine should produce randomness.
// See the audit list in `RANDOM_AUDIT` below for every Math.random
// call site that was historically present in src/ before 0.17.0.
//
// Algorithm: mulberry32. Tiny (12 lines), fast (~3 ns/call), 32-bit
// state, full 2^32 period. Good enough for visual jitter, particle
// cones, AI tie-breakers - which is everything the engine generates
// internally. NOT cryptographic. Authoritative server-side dice rolls
// must use crypto.getRandomValues, not this module.
//
// Why not seedrandom or any npm package? The browser bundle ships
// every byte we import; a 200-byte inlined PRNG beats 4 KB of pulled-
// in dependency.
//
// API:
//   const e = createEntropy(seed);
//   e.random();         // float in [0, 1)
//   e.pick(arr);        // uniform pick from a non-empty array
//   e.int(min, max);    // integer in [min, max] inclusive (min<=max)
//
// Resource pattern: the engine registers an Entropy on World.resources
// at key RESOURCE_ENTROPY. Systems that want randomness call:
//
//   const entropy = world.resources.require<IEntropy>(RESOURCE_ENTROPY);
//   const r = entropy.random();
//
// Engine.create constructs one with a default seed so the engine is
// deterministic out of the box. Consumers override per-character or
// per-run by replacing the resource before adding their systems, or
// by calling entropy.reseed(seed).
//
// AUDIT: Math.random() call sites in src/ as of 0.17.0:
//   src/systems/particle-emitter-system.ts:58 - cone direction
//   src/systems/particle-emitter-system.ts:60 - azimuth around axis
//   src/systems/particle-emitter-system.ts:142 - particle speed
//
// All three were replaced with the world entropy resource in 0.17.0.
// New src/ code MUST go through Entropy. Adding a Math.random() call
// to engine source breaks the seeded-replay contract; the existence
// of this comment is a tripwire that should make a reviewer pause.
// Resource registry key for the engine-level entropy source. Use this
// when registering or fetching the entropy resource. The string value
// is intentionally namespaced to avoid collisions with consumer-side
// resources.
export const RESOURCE_ENTROPY = 'loom.entropy';
// Default seed used by Engine.create when the consumer does not
// supply one. Picked so the very first random() call is not 0; any
// stable non-zero u32 will do. The value is a well-known constant
// (golden-ratio fraction) that tests can reference by name.
export const DEFAULT_ENTROPY_SEED = 0x9e3779b9;
// mulberry32 - public-domain PRNG (https://gist.github.com/tommyettinger/46a3b34b6c2d3edaadc7a76b67e6c10b).
// Re-implemented inline; no dependencies, no imports. State is a
// single uint32. Each call mutates state by adding the constant
// 0x6d2b79f5, then mixes via three xor-and-multiply rounds.
function mulberry32Seed(seed) {
    // Coerce non-finite or float seeds to a stable u32. NaN -> 1.
    let s = seed;
    if (typeof s !== 'number' || !Number.isFinite(s))
        s = 1;
    // Force u32 wrap.
    return (s | 0) >>> 0;
}
function mulberry32Step(state) {
    const s = (state + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const v = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return { value: v, nextState: s };
}
// Concrete deterministic Entropy. Single class so both the test
// double and the production implementation share one shape.
export class Entropy {
    state;
    constructor(seed = DEFAULT_ENTROPY_SEED) {
        this.state = mulberry32Seed(seed);
    }
    random() {
        const step = mulberry32Step(this.state);
        this.state = step.nextState;
        return step.value;
    }
    int(min, max) {
        if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
            throw new Error('Entropy.int: bad range [' + min + ',' + max + ']');
        }
        const lo = Math.floor(min);
        const hi = Math.floor(max);
        const span = hi - lo + 1;
        return lo + Math.floor(this.random() * span);
    }
    pick(arr) {
        if (!arr || arr.length === 0) {
            throw new Error('Entropy.pick: empty array');
        }
        let idx = Math.floor(this.random() * arr.length);
        if (idx >= arr.length)
            idx = arr.length - 1;
        return arr[idx];
    }
    getState() {
        return this.state >>> 0;
    }
    setState(s) {
        this.state = mulberry32Seed(s);
    }
    reseed(seed) {
        this.state = mulberry32Seed(seed);
    }
}
// Factory helper - shorter than `new Entropy(seed)` at call sites.
export function createEntropy(seed = DEFAULT_ENTROPY_SEED) {
    return new Entropy(seed);
}
//# sourceMappingURL=entropy.js.map