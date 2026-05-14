// Typed array helpers for the Loom Engine.
//
// Pools use a power-of-two grow strategy: when a write exceeds the
// current capacity, allocate a 2x array and copy the old contents.
// All component pools (TransformPool, etc.) use these helpers to
// stay consistent.

export function nextPow2(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function growF32(src: Float32Array, newCapacity: number): Float32Array {
  const next = new Float32Array(newCapacity);
  next.set(src);
  return next;
}

export function growI32(src: Int32Array, newCapacity: number): Int32Array {
  const next = new Int32Array(newCapacity);
  next.set(src);
  return next;
}

export function growU32(src: Uint32Array, newCapacity: number): Uint32Array {
  const next = new Uint32Array(newCapacity);
  next.set(src);
  return next;
}

export function growU8(src: Uint8Array, newCapacity: number): Uint8Array {
  const next = new Uint8Array(newCapacity);
  next.set(src);
  return next;
}

// Fast clear for a typed array slice. Avoids allocating a new array
// when the pool is reset (between encounters, scene swaps).
export function fillF32(arr: Float32Array, value: number, start: number = 0, end: number = arr.length): void {
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
export function tightenHighWaterMark(flags: Uint8Array, highWaterMark: number): number {
  let h = highWaterMark;
  while (h > 0 && (flags[h - 1] ?? 0) === 0) h--;
  return h;
}
