// InfiniteHorizonStreamer - a Morton-coded chunk streaming manager:
// discovers the chunks around a moving viewpoint, queues the missing
// ones for load, and evicts the ones that fall out of range.
//
// The Trinity dossier's section 11 (Gemini Volume I). The Gemini sketch
// was a lone getMortonCode(x, y): bigint that interleaved bits in a
// 32-iteration BigInt loop using `x & (1 << i)`. The Codex audit:
// "concept useful but publication order and signed coordinates are
// broken." The naive `x & (1 << i)` mishandles negative coordinates
// (two's-complement sign bits corrupt the interleave); BigInt on a
// per-chunk path is slow; and the sketch never actually streamed
// anything - no discovery, no queue, no eviction, no publish ordering.
//
// This is the corrected build, single-thread / single-owner like every
// shipped Trinity component (the SAB chunk-state and the loader-worker
// dispatch are the deferred integration layer). Two halves:
//
// MORTON ENCODING. mortonEncode biases a signed chunk coordinate in
// [-2^(k-1), 2^(k-1)) to an unsigned [0, 2^k) value, then interleaves
// with a branchless magic-number bit-spread. worldBitsPerAxis is
// capped at 15, so the interleaved code is at most 30 bits - a plain
// positive integer, no BigInt anywhere.
//
// CHUNK PIPELINE. updateHorizon(vx, vy) is the per-frame step. It
// evicts every registered chunk now outside the square horizon
// FIRST, then discovers every in-horizon chunk coordinate not yet
// registered and queues it. Evict-before-discover plus the
// constructor invariant maxChunks >= (2r+1)^2 means the registry can
// never overflow from a horizon. The load queue is drained by
// dequeueLoad (QUEUED -> LOADING); the deferred loader calls
// publishChunk (LOADING -> READY). The eviction queue is drained by
// dequeueEviction so the caller can release resources.
//
// The registry is an open-addressed hash table keyed by the Morton
// code (hashed first to scatter spatially-local codes), linear probed,
// with tombstone deletion - the OmniveilSKB structure.
//
// The 6 Codex gates for InfiniteHorizonStreamer, enforced:
//   1. "support signed chunk coordinates" - mortonEncode biases the
//      signed coordinate into the unsigned range before interleaving;
//      negative coordinates round-trip.
//   2. "keep BigInt Morton encoding off the hot path" - no BigInt at
//      all. worldBitsPerAxis <= 15 keeps the code <= 30 bits, a plain
//      integer; part1by1 is a branchless spread, not the Gemini loop.
//   3. "publish chunk payload fields first, then state" - publishChunk
//      writes every payload value, THEN flips the state to READY. The
//      state write is the publish point (a future SAB variant swaps
//      it for an Atomics.store).
//   4. "use a queue/semaphore pattern, not per-slot notify" - the load
//      queue is the queue: updateHorizon pushes QUEUED chunks, the
//      deferred loader pulls them with dequeueLoad.
//   5. "add resource cancellation and cleanup on eviction" - every
//      eviction / cancellation pushes a (morton, x, y, priorState)
//      record onto the eviction queue for the caller to drain;
//      cancelChunk aborts a pending load; freeing a chunk bumps its
//      generation, so a stale loader's later publishChunk is rejected.
//   6. "actually discover and queue missing horizon chunks" -
//      updateHorizon scans the square horizon and registers + queues
//      every coordinate not already known. The Gemini sketch was only
//      getMortonCode; this is the actual streaming.
//
// Non-negotiable engine gates: no RNG, no wall clock (encoding,
// hashing, discovery and eviction are deterministic - a run replays
// bit-for-bit); single-thread, no Atomics; every coordinate / handle /
// index bounds-checked; fixed-capacity storage.

// Chunk lifecycle states. NONE / QUEUED / LOADING / READY are exported
// so a caller can interpret getChunkState(); TOMBSTONE is an internal
// open-addressing marker and is never returned to a caller.
export const CHUNK_STATE_NONE = 0;
export const CHUNK_STATE_QUEUED = 1;
export const CHUNK_STATE_LOADING = 2;
export const CHUNK_STATE_READY = 3;
const CHUNK_STATE_TOMBSTONE = 4;   // freed slot: probe-past, reusable-by-insert

// dequeueEviction writes fixed-width records of this many i32:
// [morton, chunkX, chunkY, priorState]. priorState is the QUEUED /
// LOADING / READY the chunk was in - QUEUED / LOADING means a load
// was aborted, READY means loaded resources need releasing.
export const EVICTION_RECORD_STRIDE = 4;

// Returned by findChunk (no such chunk) and dequeueLoad (queue empty).
// Never a valid handle: a real handle's slot is in [0, maxChunks).
export const CHUNK_HANDLE_INVALID = -1;

// ChunkHandle layout, mirroring EntityId: low 24 bits slot, high 8
// bits generation.
const CHUNK_INDEX_MASK = 0x00ffffff;
const CHUNK_GENERATION_SHIFT = 24;
const CHUNK_GENERATION_MASK = 0xff;

// Sanity caps on the config-derived sizes.
const MAX_WORLD_BITS = 15;          // coords in [-2^14, 2^14); Morton <= 30 bits
const MAX_CHUNKS = 1 << 18;         // registry capacity
const MAX_PAYLOAD_STRIDE = 1 << 10; // u32 of opaque payload per chunk
const MAX_HORIZON_RADIUS = 255;     // (2*255+1)^2 = 261121 <= MAX_CHUNKS
const MAX_TOTAL_PAYLOAD = 1 << 24;  // ceiling on maxChunks * payloadStride

// A packed (generation, slot) reference to a chunk. A handle to a
// freed-and-reused slot fails generation validation - the generation
// is the staleness epoch (gate 5).
export type ChunkHandle = number;

export function makeChunkHandle(slot: number, generation: number): ChunkHandle {
  return ((generation & CHUNK_GENERATION_MASK) << CHUNK_GENERATION_SHIFT)
    | (slot & CHUNK_INDEX_MASK);
}

export function chunkSlot(handle: ChunkHandle): number {
  return handle & CHUNK_INDEX_MASK;
}

export function chunkGeneration(handle: ChunkHandle): number {
  return (handle >>> CHUNK_GENERATION_SHIFT) & CHUNK_GENERATION_MASK;
}

// Spread the low 16 bits of `n` into the even bit positions of a
// 32-bit result (bit i -> position 2i). Branchless magic-number
// bit-twiddling - no loop, no BigInt (gate 2).
function part1by1(n: number): number {
  let x = n & 0x0000ffff;
  x = (x | (x << 8)) & 0x00ff00ff;
  x = (x | (x << 4)) & 0x0f0f0f0f;
  x = (x | (x << 2)) & 0x33333333;
  x = (x | (x << 1)) & 0x55555555;
  return x;
}

// A murmur3-style integer finalizer - scatters a Morton code so that
// spatially-local (numerically-close) codes do not cluster into one
// probe chain. Deterministic; no BigInt.
function hashMorton(m: number): number {
  let h = m >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// InfiniteHorizonStreamer construction parameters.
export interface InfiniteHorizonStreamerConfig {
  // Bits per chunk-coordinate axis: a coordinate is in
  // [-2^(worldBitsPerAxis-1), 2^(worldBitsPerAxis-1)).
  worldBitsPerAxis: number;
  // Square horizon radius: a chunk is in-horizon iff it is within
  // this many chunks of the viewpoint on BOTH axes (Chebyshev).
  horizonRadius: number;
  // Registry capacity - a power of two, and >= (2*horizonRadius+1)^2
  // so a horizon always fits.
  maxChunks: number;
  // u32 of opaque, caller-defined payload stored per chunk.
  payloadStride: number;
  // Eviction-notification queue capacity - >= (2*horizonRadius+1)^2 so
  // one frame's evictions always fit (drain it every frame).
  evictionQueueSize: number;
}

export class InfiniteHorizonStreamer {
  readonly worldBitsPerAxis: number;
  readonly horizonRadius: number;
  readonly maxChunks: number;
  readonly payloadStride: number;
  readonly evictionQueueSize: number;

  // Signed-coordinate bias: 2^(worldBitsPerAxis-1). A coordinate plus
  // this lands in [0, 2^worldBitsPerAxis).
  private readonly coordBias: number;
  // maxChunks - 1: the open-addressing wrap mask.
  private readonly mask: number;

  // Registry columns, indexed by slot.
  private readonly chunkMorton: Int32Array;
  private readonly chunkX: Int32Array;
  private readonly chunkY: Int32Array;
  private readonly chunkState: Uint8Array;
  private readonly chunkGeneration: Uint8Array;   // bumped on free - the epoch (gate 5)
  // Each chunk's index in the dense load queue, or -1 if not queued.
  private readonly chunkLoadIndex: Int32Array;
  // Opaque per-chunk payload (gate 3).
  private readonly chunkPayload: Uint32Array;

  // Load queue: a dense list of QUEUED chunk slots (gate 4). Swap-pop,
  // so cancellation removes an entry in O(1).
  private readonly loadQueue: Int32Array;
  private loadQueueCount: number = 0;

  // Eviction queue: a dense list of (morton, x, y, priorState) records
  // the caller drains to release resources (gate 5).
  private readonly evictionQueue: Int32Array;
  private evictionCount: number = 0;

  // Live (QUEUED / LOADING / READY) chunk count.
  private chunkCount: number = 0;

  constructor(config: InfiniteHorizonStreamerConfig) {
    const { worldBitsPerAxis, horizonRadius, maxChunks, payloadStride, evictionQueueSize } = config;
    if (!Number.isInteger(worldBitsPerAxis) || worldBitsPerAxis < 1 || worldBitsPerAxis > MAX_WORLD_BITS) {
      throw new RangeError(
        'InfiniteHorizonStreamer: worldBitsPerAxis must be an integer in [1, ' + MAX_WORLD_BITS + '], got '
        + worldBitsPerAxis,
      );
    }
    if (!Number.isInteger(horizonRadius) || horizonRadius < 0 || horizonRadius > MAX_HORIZON_RADIUS) {
      throw new RangeError(
        'InfiniteHorizonStreamer: horizonRadius must be an integer in [0, ' + MAX_HORIZON_RADIUS + '], got '
        + horizonRadius,
      );
    }
    if (!Number.isInteger(maxChunks) || maxChunks < 1 || maxChunks > MAX_CHUNKS
      || (maxChunks & (maxChunks - 1)) !== 0) {
      throw new RangeError(
        'InfiniteHorizonStreamer: maxChunks must be a power of two in [1, ' + MAX_CHUNKS + '], got ' + maxChunks,
      );
    }
    if (!Number.isInteger(payloadStride) || payloadStride < 1 || payloadStride > MAX_PAYLOAD_STRIDE) {
      throw new RangeError(
        'InfiniteHorizonStreamer: payloadStride must be an integer in [1, ' + MAX_PAYLOAD_STRIDE + '], got '
        + payloadStride,
      );
    }
    const horizonSpan = 2 * horizonRadius + 1;
    const horizonArea = horizonSpan * horizonSpan;
    if (maxChunks < horizonArea) {
      throw new RangeError(
        'InfiniteHorizonStreamer: maxChunks ' + maxChunks + ' < horizon area (2r+1)^2 = ' + horizonArea
        + ' - the registry could not hold a full horizon',
      );
    }
    if (!Number.isInteger(evictionQueueSize) || evictionQueueSize < horizonArea) {
      throw new RangeError(
        'InfiniteHorizonStreamer: evictionQueueSize must be an integer >= horizon area ' + horizonArea
        + ', got ' + evictionQueueSize,
      );
    }
    if (maxChunks * payloadStride > MAX_TOTAL_PAYLOAD) {
      throw new RangeError(
        'InfiniteHorizonStreamer: maxChunks * payloadStride = ' + (maxChunks * payloadStride)
        + ' exceeds the cap ' + MAX_TOTAL_PAYLOAD,
      );
    }
    this.worldBitsPerAxis = worldBitsPerAxis;
    this.horizonRadius = horizonRadius;
    this.maxChunks = maxChunks;
    this.payloadStride = payloadStride;
    this.evictionQueueSize = evictionQueueSize;
    this.coordBias = 1 << (worldBitsPerAxis - 1);
    this.mask = maxChunks - 1;
    this.chunkMorton = new Int32Array(maxChunks);
    this.chunkX = new Int32Array(maxChunks);
    this.chunkY = new Int32Array(maxChunks);
    this.chunkState = new Uint8Array(maxChunks);
    this.chunkGeneration = new Uint8Array(maxChunks);
    this.chunkLoadIndex = new Int32Array(maxChunks).fill(-1);
    this.chunkPayload = new Uint32Array(maxChunks * payloadStride);
    this.loadQueue = new Int32Array(maxChunks);
    this.evictionQueue = new Int32Array(evictionQueueSize * EVICTION_RECORD_STRIDE);
  }

  // --- Morton encoding (gates 1, 2) ---

  // The Morton (Z-order) code of a signed chunk coordinate. The code
  // is a plain non-negative integer; spatially-near chunks have
  // near-ish codes.
  getMortonCode(chunkX: number, chunkY: number): number {
    this.requireChunkCoord(chunkX, 'getMortonCode', 'chunkX');
    this.requireChunkCoord(chunkY, 'getMortonCode', 'chunkY');
    return this.mortonEncode(chunkX, chunkY);
  }

  // --- counts ---

  // Live (QUEUED / LOADING / READY) chunk count.
  getChunkCount(): number {
    return this.chunkCount;
  }

  // Chunks waiting in the load queue (QUEUED, not yet dequeued).
  getLoadQueueCount(): number {
    return this.loadQueueCount;
  }

  // Eviction records waiting to be drained.
  getEvictionQueueCount(): number {
    return this.evictionCount;
  }

  // --- the per-frame step (gates 5, 6) ---

  // Update the horizon around viewpoint chunk (viewChunkX, viewChunkY):
  // FIRST evict every registered chunk now outside the square horizon
  // (pushing an eviction record for each), THEN discover every
  // in-horizon chunk coordinate not yet registered and queue it for
  // load. Evict-before-discover keeps the registry from ever
  // overflowing.
  updateHorizon(viewChunkX: number, viewChunkY: number): void {
    this.requireChunkCoord(viewChunkX, 'updateHorizon', 'viewChunkX');
    this.requireChunkCoord(viewChunkY, 'updateHorizon', 'viewChunkY');
    const r = this.horizonRadius;
    // STEP 1 - evict / cancel everything outside the new horizon.
    for (let slot = 0; slot < this.maxChunks; slot++) {
      const state = this.chunkState[slot] ?? CHUNK_STATE_NONE;
      if (state === CHUNK_STATE_NONE || state === CHUNK_STATE_TOMBSTONE) continue;
      const cx = this.chunkX[slot] ?? 0;
      const cy = this.chunkY[slot] ?? 0;
      let dx = cx - viewChunkX;
      if (dx < 0) dx = -dx;
      let dy = cy - viewChunkY;
      if (dy < 0) dy = -dy;
      if (dx > r || dy > r) {
        this.pushEviction(this.chunkMorton[slot] ?? 0, cx, cy, state);
        this.freeChunk(slot);
      }
    }
    // STEP 2 - discover and queue missing in-horizon chunks (gate 6).
    const bias = this.coordBias;
    for (let cy = viewChunkY - r; cy <= viewChunkY + r; cy++) {
      if (cy < -bias || cy >= bias) continue;   // off the edge of the world
      for (let cx = viewChunkX - r; cx <= viewChunkX + r; cx++) {
        if (cx < -bias || cx >= bias) continue;
        const morton = this.mortonEncode(cx, cy);
        if (this.findSlot(morton) >= 0) continue;   // already registered
        const slot = this.registerChunk(morton, cx, cy);
        this.chunkState[slot] = CHUNK_STATE_QUEUED;
        this.chunkCount++;
        this.pushLoadQueue(slot);
      }
    }
  }

  // --- the load pipeline (gates 3, 4) ---

  // Pop the next chunk waiting to load, transitioning it QUEUED ->
  // LOADING, and return its handle. Returns CHUNK_HANDLE_INVALID if
  // the load queue is empty. The deferred loader reads the chunk's
  // coordinates (getChunkX / getChunkY), loads the data, and calls
  // publishChunk.
  dequeueLoad(): ChunkHandle {
    if (this.loadQueueCount === 0) return CHUNK_HANDLE_INVALID;
    this.loadQueueCount--;
    const slot = this.loadQueue[this.loadQueueCount] ?? 0;
    this.chunkLoadIndex[slot] = -1;
    this.chunkState[slot] = CHUNK_STATE_LOADING;
    return makeChunkHandle(slot, this.chunkGeneration[slot] ?? 0);
  }

  // Publish a loaded chunk: write its payload, THEN flip its state to
  // READY (gate 3 - payload fields first, state last). Writes the
  // first `count` payload values from `values` (count defaults to
  // values.length); higher payload slots keep their prior value.
  // Returns false - a no-op - if the handle is stale (the chunk was
  // evicted / cancelled while loading) or the chunk is not LOADING; so
  // a stale loader's response is cleanly rejected (gate 5).
  publishChunk(handle: ChunkHandle, values: ArrayLike<number>, count?: number): boolean {
    const slot = this.resolveSlot(handle);
    if (slot < 0 || (this.chunkState[slot] ?? CHUNK_STATE_NONE) !== CHUNK_STATE_LOADING) return false;
    const n = count === undefined ? values.length : count;
    if (!Number.isInteger(n) || n < 0) {
      throw new RangeError('InfiniteHorizonStreamer.publishChunk: count must be a non-negative integer, got ' + n);
    }
    if (n > this.payloadStride) {
      throw new RangeError(
        'InfiniteHorizonStreamer.publishChunk: count ' + n + ' exceeds payloadStride ' + this.payloadStride,
      );
    }
    if (n > values.length) {
      throw new RangeError(
        'InfiniteHorizonStreamer.publishChunk: count ' + n + ' exceeds values.length ' + values.length,
      );
    }
    const base = slot * this.payloadStride;
    // Gate 3: every payload value written FIRST...
    for (let i = 0; i < n; i++) {
      this.chunkPayload[base + i] = values[i] ?? 0;
    }
    // ...THEN the state flips to READY - the publish point.
    this.chunkState[slot] = CHUNK_STATE_READY;
    return true;
  }

  // Abort a pending load: cancel a QUEUED or LOADING chunk, pushing an
  // eviction record so the caller can release any partial resources.
  // Returns false for a stale handle or a chunk that is not QUEUED /
  // LOADING (a READY chunk is removed by updateHorizon, not here).
  cancelChunk(handle: ChunkHandle): boolean {
    const slot = this.resolveSlot(handle);
    if (slot < 0) return false;
    const state = this.chunkState[slot] ?? CHUNK_STATE_NONE;
    if (state !== CHUNK_STATE_QUEUED && state !== CHUNK_STATE_LOADING) return false;
    this.pushEviction(this.chunkMorton[slot] ?? 0, this.chunkX[slot] ?? 0, this.chunkY[slot] ?? 0, state);
    this.freeChunk(slot);
    return true;
  }

  // --- the eviction pipeline (gate 5) ---

  // Drain one eviction record into `out` as [morton, chunkX, chunkY,
  // priorState] (EVICTION_RECORD_STRIDE wide). Returns false - leaving
  // `out` untouched - when the eviction queue is empty. The caller
  // drains this every frame to release evicted / cancelled chunks'
  // resources.
  dequeueEviction(out: Int32Array): boolean {
    if (out.length < EVICTION_RECORD_STRIDE) {
      throw new RangeError(
        'InfiniteHorizonStreamer.dequeueEviction: out must hold at least ' + EVICTION_RECORD_STRIDE
        + ' entries, got ' + out.length,
      );
    }
    if (this.evictionCount === 0) return false;
    this.evictionCount--;
    const base = this.evictionCount * EVICTION_RECORD_STRIDE;
    out[0] = this.evictionQueue[base] ?? 0;
    out[1] = this.evictionQueue[base + 1] ?? 0;
    out[2] = this.evictionQueue[base + 2] ?? 0;
    out[3] = this.evictionQueue[base + 3] ?? 0;
    return true;
  }

  // --- queries ---

  // The handle of the chunk at (chunkX, chunkY), or
  // CHUNK_HANDLE_INVALID if no such chunk is registered.
  findChunk(chunkX: number, chunkY: number): ChunkHandle {
    this.requireChunkCoord(chunkX, 'findChunk', 'chunkX');
    this.requireChunkCoord(chunkY, 'findChunk', 'chunkY');
    const slot = this.findSlot(this.mortonEncode(chunkX, chunkY));
    if (slot < 0) return CHUNK_HANDLE_INVALID;
    return makeChunkHandle(slot, this.chunkGeneration[slot] ?? 0);
  }

  // The chunk's lifecycle state (CHUNK_STATE_QUEUED / LOADING / READY),
  // or CHUNK_STATE_NONE for a stale / invalid handle.
  getChunkState(handle: ChunkHandle): number {
    const slot = this.resolveSlot(handle);
    return slot < 0 ? CHUNK_STATE_NONE : (this.chunkState[slot] ?? CHUNK_STATE_NONE);
  }

  // True only for a fully-loaded (READY) chunk.
  isChunkReady(handle: ChunkHandle): boolean {
    return this.getChunkState(handle) === CHUNK_STATE_READY;
  }

  // The chunk's coordinates / Morton code, or -1 for a stale / invalid
  // handle. (Chunk coordinates can be negative, but a stale handle is
  // unambiguous: it is never a valid coordinate query.)
  getChunkX(handle: ChunkHandle): number {
    const slot = this.resolveSlot(handle);
    return slot < 0 ? -1 : (this.chunkX[slot] ?? -1);
  }

  getChunkY(handle: ChunkHandle): number {
    const slot = this.resolveSlot(handle);
    return slot < 0 ? -1 : (this.chunkY[slot] ?? -1);
  }

  getChunkMorton(handle: ChunkHandle): number {
    const slot = this.resolveSlot(handle);
    return slot < 0 ? -1 : (this.chunkMorton[slot] ?? -1);
  }

  // Copy a chunk's payload into `out` (the lesser of out.length and
  // payloadStride values). Returns false - leaving `out` untouched -
  // for a stale / invalid handle.
  readChunkPayload(handle: ChunkHandle, out: Uint32Array): boolean {
    const slot = this.resolveSlot(handle);
    if (slot < 0) return false;
    const base = slot * this.payloadStride;
    const copyLen = Math.min(out.length, this.payloadStride);
    for (let i = 0; i < copyLen; i++) {
      out[i] = this.chunkPayload[base + i] ?? 0;
    }
    return true;
  }

  // Reset to the constructed-but-empty state. All handles are void
  // after clear().
  clear(): void {
    this.chunkMorton.fill(0);
    this.chunkX.fill(0);
    this.chunkY.fill(0);
    this.chunkState.fill(CHUNK_STATE_NONE);
    this.chunkGeneration.fill(0);
    this.chunkLoadIndex.fill(-1);
    this.chunkPayload.fill(0);
    this.loadQueueCount = 0;
    this.evictionCount = 0;
    this.chunkCount = 0;
  }

  // --- private ---

  // Bias a signed chunk coordinate into [0, 2^worldBitsPerAxis) and
  // interleave the two axes' bits (gates 1, 2). The result is a plain
  // non-negative integer.
  private mortonEncode(chunkX: number, chunkY: number): number {
    const ux = chunkX + this.coordBias;
    const uy = chunkY + this.coordBias;
    return (part1by1(ux) | (part1by1(uy) << 1)) >>> 0;
  }

  // Linear-probe for the slot holding `morton`, or -1 if not present.
  // Tombstones are probed past; a NONE slot ends the chain.
  private findSlot(morton: number): number {
    const start = hashMorton(morton) & this.mask;
    for (let probe = 0; probe < this.maxChunks; probe++) {
      const slot = (start + probe) & this.mask;
      const state = this.chunkState[slot] ?? CHUNK_STATE_NONE;
      if (state === CHUNK_STATE_NONE) return -1;
      if (state === CHUNK_STATE_TOMBSTONE) continue;
      if ((this.chunkMorton[slot] ?? 0) === morton) return slot;
    }
    return -1;
  }

  // Claim a slot for a new chunk: the first NONE or TOMBSTONE on the
  // probe chain. Writes morton / x / y; the caller sets the state.
  // Returns the slot. The registry never overflows (maxChunks >=
  // horizon area, evict-before-discover) - the throw is an invariant
  // tripwire.
  private registerChunk(morton: number, cx: number, cy: number): number {
    const start = hashMorton(morton) & this.mask;
    let firstTombstone = -1;
    let insertSlot = -1;
    for (let probe = 0; probe < this.maxChunks; probe++) {
      const slot = (start + probe) & this.mask;
      const state = this.chunkState[slot] ?? CHUNK_STATE_NONE;
      if (state === CHUNK_STATE_NONE) {
        insertSlot = firstTombstone >= 0 ? firstTombstone : slot;
        break;
      }
      if (state === CHUNK_STATE_TOMBSTONE && firstTombstone < 0) {
        firstTombstone = slot;
      }
    }
    if (insertSlot < 0) insertSlot = firstTombstone;
    if (insertSlot < 0) {
      throw new Error('InfiniteHorizonStreamer: chunk registry full - maxChunks invariant violated');
    }
    this.chunkMorton[insertSlot] = morton;
    this.chunkX[insertSlot] = cx;
    this.chunkY[insertSlot] = cy;
    return insertSlot;
  }

  // Free a chunk slot: remove it from the load queue if queued, mark
  // it a tombstone, and bump its generation so every handle to it
  // goes stale (gate 5 - stale async response rejection).
  private freeChunk(slot: number): void {
    if ((this.chunkState[slot] ?? CHUNK_STATE_NONE) === CHUNK_STATE_QUEUED) {
      this.removeFromLoadQueue(slot);
    }
    this.chunkState[slot] = CHUNK_STATE_TOMBSTONE;
    this.chunkGeneration[slot] = ((this.chunkGeneration[slot] ?? 0) + 1) & CHUNK_GENERATION_MASK;
    this.chunkCount--;
  }

  // Append a slot to the dense load queue.
  private pushLoadQueue(slot: number): void {
    this.loadQueue[this.loadQueueCount] = slot;
    this.chunkLoadIndex[slot] = this.loadQueueCount;
    this.loadQueueCount++;
  }

  // Swap-pop a slot out of the dense load queue in O(1).
  private removeFromLoadQueue(slot: number): void {
    const idx = this.chunkLoadIndex[slot] ?? -1;
    if (idx < 0) return;
    const lastIdx = this.loadQueueCount - 1;
    const lastSlot = this.loadQueue[lastIdx] ?? 0;
    this.loadQueue[idx] = lastSlot;
    this.chunkLoadIndex[lastSlot] = idx;
    this.loadQueueCount = lastIdx;
    this.chunkLoadIndex[slot] = -1;
  }

  // Append an eviction record. Throws if the queue is full - a caller
  // that does not drain dequeueEviction every frame.
  private pushEviction(morton: number, cx: number, cy: number, priorState: number): void {
    if (this.evictionCount >= this.evictionQueueSize) {
      throw new Error(
        'InfiniteHorizonStreamer: eviction queue full (evictionQueueSize=' + this.evictionQueueSize
        + ') - drain it every frame with dequeueEviction',
      );
    }
    const base = this.evictionCount * EVICTION_RECORD_STRIDE;
    this.evictionQueue[base] = morton;
    this.evictionQueue[base + 1] = cx;
    this.evictionQueue[base + 2] = cy;
    this.evictionQueue[base + 3] = priorState;
    this.evictionCount++;
  }

  // Resolve a handle to its slot, or -1: a non-integer, an
  // out-of-range slot, a slot that is not a live chunk (NONE /
  // TOMBSTONE), or a generation mismatch (the slot was freed and
  // reused - a stale epoch).
  private resolveSlot(handle: ChunkHandle): number {
    if (!Number.isInteger(handle)) return -1;
    const slot = chunkSlot(handle);
    if (slot >= this.maxChunks) return -1;
    const state = this.chunkState[slot] ?? CHUNK_STATE_NONE;
    if (state === CHUNK_STATE_NONE || state === CHUNK_STATE_TOMBSTONE) return -1;
    if ((this.chunkGeneration[slot] ?? 0) !== chunkGeneration(handle)) return -1;
    return slot;
  }

  private requireChunkCoord(value: number, op: string, name: string): void {
    if (!Number.isInteger(value) || value < -this.coordBias || value >= this.coordBias) {
      throw new RangeError(
        'InfiniteHorizonStreamer.' + op + ': ' + name + ' ' + value + ' out of ['
        + (-this.coordBias) + ', ' + this.coordBias + ')',
      );
    }
  }
}
