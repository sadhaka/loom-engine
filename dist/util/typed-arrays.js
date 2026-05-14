// Typed array helpers for the Loom Engine.
//
// Pools use a power-of-two grow strategy: when a write exceeds the
// current capacity, allocate a 2x array and copy the old contents.
// All component pools (TransformPool, etc.) use these helpers to
// stay consistent.
export function nextPow2(n) {
    if (n <= 1)
        return 1;
    let p = 1;
    while (p < n)
        p <<= 1;
    return p;
}
export function growF32(src, newCapacity) {
    const next = new Float32Array(newCapacity);
    next.set(src);
    return next;
}
export function growI32(src, newCapacity) {
    const next = new Int32Array(newCapacity);
    next.set(src);
    return next;
}
export function growU32(src, newCapacity) {
    const next = new Uint32Array(newCapacity);
    next.set(src);
    return next;
}
export function growU8(src, newCapacity) {
    const next = new Uint8Array(newCapacity);
    next.set(src);
    return next;
}
// Fast clear for a typed array slice. Avoids allocating a new array
// when the pool is reset (between encounters, scene swaps).
export function fillF32(arr, value, start = 0, end = arr.length) {
    for (let i = start; i < end; i++) {
        arr[i] = value;
    }
}
// Lower a pool's high-water mark past trailing slots whose flags byte
// is zero. A pool's flags byte is non-zero for exactly the lifetime
// of an attached / alive slot (attach or spawn sets at least one bit;
// detach or kill clears all bits), so the topmost non-zero flags byte
// marks the highest live index. Returns the tightened mark - the new
// iteration bound. O(trailing dead slots), so it is a maintenance
// pass, not a per-tick call.
export function tightenHighWaterMark(flags, highWaterMark) {
    let h = highWaterMark;
    while (h > 0 && (flags[h - 1] ?? 0) === 0)
        h--;
    return h;
}
//# sourceMappingURL=typed-arrays.js.map