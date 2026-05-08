// ComponentSignature - per-entity component bitmask for fast query
// matching.
//
// 0.22.0 rationale: existing component pools are structure-of-arrays
// indexed by entity. Each pool tracks its own membership via
// `highWaterMark` + per-slot zeros. A system that needs entities with
// BOTH transform AND sprite has to iterate one pool and check the
// other per-entity. With many systems making the same combined query
// per frame, the intersection cost compounds.
//
// ComponentSignature gives every entity a single Uint32 bitmask where
// each bit names a component pool. A system asks "give me entities
// that have these N components" once; the QueryCache memoizes the
// answer until any entity's signature changes.
//
// Cap at 32 components per entity (one Uint32 per entity). Beyond
// that, a future v2 can move to per-entity Uint32Array of N words.
// The current engine has roughly 12 component pools; 32 leaves
// generous headroom.
//
// Code style: var-only in browser-bound source. ComponentSignature is
// engine-internal so let/const are fine here, but the public API
// follows the engine's existing TS-class style.
// Maximum component bit index. Component bits are 0..31 inclusive.
// A bit value of 32+ is a programmer error and surfaces via setBit
// throwing in development.
export const COMPONENT_SIGNATURE_MAX_BIT = 31;
// Helper: turn a list of component bits into a single bitmask.
export function componentMask(...bits) {
    var mask = 0;
    for (var i = 0; i < bits.length; i++) {
        var raw = bits[i];
        var b = (raw === undefined ? 0 : raw) | 0;
        if (b < 0 || b > COMPONENT_SIGNATURE_MAX_BIT) {
            throw new Error('componentMask: bit ' + b + ' out of range [0, 31]');
        }
        mask |= 1 << b;
    }
    return mask >>> 0;
}
export class ComponentSignature {
    // Per-entity bitmask. masks[entityIndex] is the entity's signature.
    // Bit 0 = first component pool, bit 1 = second, etc.
    masks;
    cap;
    // Version counter. Bumped on every mutation so query caches can
    // invalidate cheaply. Wraps around naturally at 2^32; consumers
    // compare for equality, not ordering, so wraparound is safe.
    versionValue = 0;
    constructor(initialCapacity = 64) {
        this.cap = nextPow2(initialCapacity);
        this.masks = new Uint32Array(this.cap);
    }
    // Ensure the underlying typed array can address `idx`. Grows by
    // pow-2 amortising to O(1) append cost.
    ensureCapacity(idx) {
        if (idx < this.cap)
            return;
        var next = nextPow2(idx + 1);
        var newMasks = new Uint32Array(next);
        newMasks.set(this.masks);
        this.masks = newMasks;
        this.cap = next;
    }
    // Set a single bit on the entity's signature. No-op if already set.
    // Bumps version iff the bit was previously clear.
    setBit(entityIdx, bit) {
        if (bit < 0 || bit > COMPONENT_SIGNATURE_MAX_BIT) {
            throw new Error('ComponentSignature.setBit: bit ' + bit + ' out of range [0, 31]');
        }
        this.ensureCapacity(entityIdx);
        var prev = this.masks[entityIdx] ?? 0;
        var bitMask = (1 << bit) >>> 0;
        var next = (prev | bitMask) >>> 0;
        if (next !== prev) {
            this.masks[entityIdx] = next;
            this.versionValue = (this.versionValue + 1) >>> 0;
        }
    }
    // Clear a single bit on the entity's signature. No-op if already
    // clear. Bumps version iff the bit was previously set.
    clearBit(entityIdx, bit) {
        if (bit < 0 || bit > COMPONENT_SIGNATURE_MAX_BIT) {
            throw new Error('ComponentSignature.clearBit: bit ' + bit + ' out of range [0, 31]');
        }
        if (entityIdx >= this.cap)
            return;
        var prev = this.masks[entityIdx] ?? 0;
        var bitMask = (1 << bit) >>> 0;
        var inv = (~bitMask) >>> 0;
        var next = (prev & inv) >>> 0;
        if (next !== prev) {
            this.masks[entityIdx] = next;
            this.versionValue = (this.versionValue + 1) >>> 0;
        }
    }
    // Clear every bit on the entity. Used on entity destroy.
    clearEntity(entityIdx) {
        if (entityIdx >= this.cap)
            return;
        if (this.masks[entityIdx] !== 0) {
            this.masks[entityIdx] = 0;
            this.versionValue = (this.versionValue + 1) >>> 0;
        }
    }
    // Read the entity's full signature. Returns 0 if entity is out of
    // current capacity (unset entities are implicitly empty).
    getMask(entityIdx) {
        if (entityIdx >= this.cap)
            return 0;
        var v = this.masks[entityIdx] ?? 0;
        return v >>> 0;
    }
    // True iff every bit in `mask` is set on the entity.
    hasAll(entityIdx, mask) {
        if (entityIdx >= this.cap)
            return mask === 0;
        var v = this.masks[entityIdx] ?? 0;
        return (v & mask) === (mask >>> 0);
    }
    // True iff at least one bit in `mask` is set on the entity.
    hasAny(entityIdx, mask) {
        if (entityIdx >= this.cap)
            return false;
        var v = this.masks[entityIdx] ?? 0;
        return (v & mask) !== 0;
    }
    // Current version. Bumps on every actual mutation. Used by
    // QueryCache to invalidate.
    version() {
        return this.versionValue;
    }
    // Iterate every entity index whose signature has all bits in
    // `mask` set. Visits 0..highest-set-index inclusive; entities never
    // touched (mask=0) are naturally skipped because mask=0 fails the
    // hasAll test for a non-zero query mask. For a mask=0 query, the
    // iteration is empty (matches no entity meaningfully).
    collectMatching(mask) {
        if (mask === 0)
            return new Int32Array(0);
        // Scan; copy matching indices into a growable buffer.
        var matches = [];
        var m = mask >>> 0;
        for (var i = 0; i < this.cap; i++) {
            var v = this.masks[i] ?? 0;
            if ((v & m) === m) {
                matches.push(i);
            }
        }
        var out = new Int32Array(matches.length);
        for (var j = 0; j < matches.length; j++) {
            out[j] = matches[j] ?? 0;
        }
        return out;
    }
    // For tests / introspection.
    capacity() {
        return this.cap;
    }
}
// Local pow-2 helper - avoids depending on util/typed-arrays so this
// module can be imported by anything without circularity worries.
function nextPow2(n) {
    if (n <= 1)
        return 1;
    var p = 1;
    while (p < n)
        p <<= 1;
    return p >>> 0;
}
// Resource key for the world-attached signature.
export const RESOURCE_COMPONENT_SIGNATURE = 'loom.component_signature';
//# sourceMappingURL=component-signature.js.map