// LoomChrono - a deterministic rewind / replay log: a circular ring of
// fixed-size state keyframes plus a circular log of fixed-size input
// events, both with generation-validated handles.
//
// The Trinity dossier's section 10 (Gemini Volume I). The Gemini sketch
// was a 15-line stub: an array of Uint8Array per keyframe, a snapshot()
// that copied a SharedArrayBuffer wholesale, no input log, no validity
// tracking, no replay path. Codex flagged "concept is good,
// implementation is not rewind-safe." This rebuild closes that:
// keyframes are copied byte-for-byte into a flat ring (never live
// references), every slot carries a generation + valid flag so a stale
// handle cannot read a recycled snapshot, overwriting a slot bumps the
// generation and clears its validity bit, the input log is event-
// sourced (the consumer logs every nondeterministic action), and a
// rewind to tick T finds the latest keyframe at tick K and returns the
// inputs in (K, T] in tick order so the consumer can replay forward.
// invalidateAfter(tick) lets a consumer start a new branch from a
// rewind point. The keyframe ring is hard-capped at 256 slots of at
// most 1 MiB each (256 MiB total, far below any 2 GB browser guard) so
// the structure cannot demand a hostile allocation.
//
// Storage:
//   keyframeStorage      Uint8   maxKeyframes * keyframeBytes total
//   keyframeTicks        Float64 per slot
//   keyframeGens         Uint32  per slot (bumped on overwrite)
//   keyframeValids       Uint8   per slot (1 valid, 0 invalid)
//   inputData            Int32   inputWords per event * maxInputs slots
//   inputTicks           Float64 per slot
//   inputGens            Uint32  per slot
//   inputValids          Uint8   per slot
//
// The 7 Codex gates, enforced:
//   1. immutable keyframe snapshots / copy-on-write - snapshot() copies
//      the consumer's bytes into the ring slot; the slot is the
//      authoritative immutable store. The consumer can mutate its
//      source buffer freely after snapshot() returns - the slot is
//      never a live view of the source.
//   2. valid metadata flags + generations - every keyframe and input
//      slot carries both a generation counter and a validity bit. A
//      handle packs (gen, slot); getKeyframe / inputTickAt /
//      inputWordAt check both. A handle to a recycled slot fails on
//      the generation; a handle to an invalidated slot fails on the
//      validity bit; a logical input index past the ring window fails
//      on the eviction check.
//   3. complete overwrite invalidation - snapshot() / logInput() into
//      an existing valid slot bump that slot's generation and clear
//      the validity bit before re-setting them for the new occupant,
//      so a stale handle cannot validate against the new occupant.
//   4. preallocated seek scratch - findReplayPlan fills a caller-
//      provided Int32Array with the input indices to replay; the
//      chrono allocates nothing per call. The keyframe scan is a
//      linear walk over <= 256 slots.
//   5. event-source all nondeterministic inputs - the API exposes
//      logInput(tick, words) and findReplayPlan but does NOT apply
//      inputs itself. The consumer's deterministic loop is the only
//      thing that knows how to apply each event. Replay correctness
//      requires the consumer to log every nondeterministic input
//      before it affects state; this is the contract.
//   6. single-thread ownership during restore / replay - one owner
//      calls snapshot / logInput / getKeyframe / findReplayPlan /
//      invalidateAfter / clear. The chrono is not concurrency-safe;
//      a worker-parallel consumer pauses workers during a rewind and
//      drives them through the chrono on the owning thread.
//   7. bounded keyframe footprint - keyframeBytes <= 1 MiB per slot
//      and maxKeyframes <= 256, so the ring's hard ceiling is 256 MiB.
//      Far below any 2 GB browser allocation; an oversized request
//      throws a RangeError at construction.

// Sanity caps on the constructor-derived sizes.
const MAX_KEYFRAME_BYTES = 1 << 20;       // 1 MiB per slot
const MAX_KEYFRAMES = 256;
const MAX_INPUT_WORDS = 16;
const MAX_INPUTS = 1 << 16;

// Handle layout, mirroring the engine cohort: low 24 bits slot, high 8
// bits generation, packed into a non-negative uint32.
const SLOT_MASK = 0x00ffffff;
const GEN_SHIFT = 24;
const GEN_MASK = 0xff;

// validity-bit values.
const SLOT_INVALID = 0;
const SLOT_VALID = 1;

export interface LoomChronoOptions {
  // Bytes per state snapshot. Every snapshot() call must pass exactly
  // this many bytes; getKeyframe writes exactly this many bytes into
  // the destination buffer.
  keyframeBytes: number;
  // Circular keyframe ring size.
  maxKeyframes: number;
  // Int32 words per logged input event. The consumer encodes its event
  // payload into this many words.
  inputWords: number;
  // Circular input ring size.
  maxInputs: number;
}

export type ReplayPlanReason = 'no_keyframe' | 'inputs_evicted' | 'buffer_too_small';

export type ReplayPlan =
  | {
      ok: true;
      keyframeHandle: number;
      keyframeTick: number;
      inputCount: number;
    }
  | { ok: false; reason: ReplayPlanReason };

export class LoomChrono {
  readonly keyframeBytes: number;
  readonly maxKeyframes: number;
  readonly inputWords: number;
  readonly maxInputs: number;

  private readonly keyframeStorage: Uint8Array;
  private readonly keyframeTicks: Float64Array;
  private readonly keyframeGens: Uint32Array;
  private readonly keyframeValids: Uint8Array;

  private readonly inputData: Int32Array;
  private readonly inputTicks: Float64Array;
  private readonly inputGens: Uint32Array;
  private readonly inputValids: Uint8Array;

  // Monotonic counters - the "logical" position of a snapshot or input.
  private snapshotWriteCount = 0;
  private inputWriteCountInternal = 0;

  // The slot of the most recent valid snapshot, or -1 if none.
  private lastSnapshotSlot = -1;

  // The largest tick of any input that has been evicted (overwritten)
  // from the ring. A rewind to a keyframe whose tick predates this
  // value cannot fully replay: some inputs in (keyframeTick, ...] are
  // gone. Reset to -Infinity by clear().
  private inputsEvictedMaxTick = -Infinity;

  constructor(opts: LoomChronoOptions) {
    requireOpts(opts);
    requireCap('keyframeBytes', opts.keyframeBytes, 1, MAX_KEYFRAME_BYTES);
    requireCap('maxKeyframes', opts.maxKeyframes, 1, MAX_KEYFRAMES);
    requireCap('inputWords', opts.inputWords, 1, MAX_INPUT_WORDS);
    requireCap('maxInputs', opts.maxInputs, 1, MAX_INPUTS);

    this.keyframeBytes = opts.keyframeBytes;
    this.maxKeyframes = opts.maxKeyframes;
    this.inputWords = opts.inputWords;
    this.maxInputs = opts.maxInputs;

    this.keyframeStorage = new Uint8Array(opts.maxKeyframes * opts.keyframeBytes);
    this.keyframeTicks = new Float64Array(opts.maxKeyframes);
    this.keyframeGens = new Uint32Array(opts.maxKeyframes);
    this.keyframeValids = new Uint8Array(opts.maxKeyframes);

    this.inputData = new Int32Array(opts.maxInputs * opts.inputWords);
    this.inputTicks = new Float64Array(opts.maxInputs);
    this.inputGens = new Uint32Array(opts.maxInputs);
    this.inputValids = new Uint8Array(opts.maxInputs);
  }

  // ---------- snapshot ----------

  // Copy stateBytes into the next keyframe ring slot. The source view
  // is read once - the slot is the immutable authoritative store after
  // this call. Returns a (gen, slot) handle for getKeyframe.
  snapshot(tick: number, stateBytes: ArrayBufferView): number {
    if (!Number.isFinite(tick)) {
      throw new RangeError('LoomChrono.snapshot: tick must be a finite number, got ' + tick);
    }
    if (!stateBytes || stateBytes.byteLength !== this.keyframeBytes) {
      throw new RangeError(
        'LoomChrono.snapshot: stateBytes.byteLength must equal keyframeBytes ('
        + this.keyframeBytes + '), got ' + (stateBytes ? stateBytes.byteLength : 'null'),
      );
    }
    const slot = this.snapshotWriteCount % this.maxKeyframes;
    // Gate 3: overwriting an existing valid slot bumps its generation
    // and drops its validity, so a handle to the old occupant fails.
    if ((this.keyframeValids[slot] ?? 0) === SLOT_VALID) {
      this.keyframeGens[slot] = ((this.keyframeGens[slot] ?? 0) + 1) & GEN_MASK;
      this.keyframeValids[slot] = SLOT_INVALID;
    }
    // Copy bytes into the slot. Wrap the source as a Uint8Array view
    // of the same buffer so byte-for-byte copy works for any
    // ArrayBufferView (not only Uint8Array).
    const offset = slot * this.keyframeBytes;
    const srcBytes = new Uint8Array(stateBytes.buffer, stateBytes.byteOffset, stateBytes.byteLength);
    this.keyframeStorage.set(srcBytes, offset);
    this.keyframeTicks[slot] = tick;
    this.keyframeValids[slot] = SLOT_VALID;
    this.snapshotWriteCount++;
    this.lastSnapshotSlot = slot;
    return this.makeHandle(slot, this.keyframeGens[slot] ?? 0);
  }

  // Copy the keyframe identified by handle into destBytes. Returns
  // false if the handle is stale or destBytes is too small. Does not
  // throw - this is the inspection / restore path that callers walk in
  // bulk.
  getKeyframe(handle: number, destBytes: ArrayBufferView): boolean {
    const slot = this.resolveKeyframeSlot(handle);
    if (slot < 0) return false;
    if (!destBytes || destBytes.byteLength < this.keyframeBytes) return false;
    const offset = slot * this.keyframeBytes;
    const dstBytes = new Uint8Array(destBytes.buffer, destBytes.byteOffset, destBytes.byteLength);
    dstBytes.set(this.keyframeStorage.subarray(offset, offset + this.keyframeBytes), 0);
    return true;
  }

  // The tick a keyframe was captured at. Throws if the handle is stale
  // or invalid.
  getKeyframeTick(handle: number): number {
    const slot = this.resolveKeyframeSlot(handle);
    if (slot < 0) {
      throw new RangeError('LoomChrono.getKeyframeTick: handle is stale or invalid');
    }
    return this.keyframeTicks[slot] ?? 0;
  }

  isKeyframeValid(handle: number): boolean {
    return this.resolveKeyframeSlot(handle) >= 0;
  }

  // Handle of the most recent snapshot still in the ring, or -1 if the
  // ring is empty / the latest was invalidated.
  latestKeyframeHandle(): number {
    if (this.lastSnapshotSlot < 0) return -1;
    if ((this.keyframeValids[this.lastSnapshotSlot] ?? 0) !== SLOT_VALID) return -1;
    return this.makeHandle(this.lastSnapshotSlot, this.keyframeGens[this.lastSnapshotSlot] ?? 0);
  }

  // ---------- input log ----------

  // Append an input event at tick. Returns the logical index of the
  // event - a monotonic counter the caller can later pass to
  // inputTickAt / inputWordAt. words must have at least inputWords
  // elements; only the first inputWords are read.
  logInput(tick: number, words: ArrayLike<number>): number {
    if (!Number.isFinite(tick)) {
      throw new RangeError('LoomChrono.logInput: tick must be a finite number, got ' + tick);
    }
    if (!words || words.length < this.inputWords) {
      throw new RangeError(
        'LoomChrono.logInput: words must be ArrayLike<number> of length >= '
        + this.inputWords + ', got ' + (words ? words.length : 'null'),
      );
    }
    const slot = this.inputWriteCountInternal % this.maxInputs;
    if ((this.inputValids[slot] ?? 0) === SLOT_VALID) {
      // Track the evicted input's tick so a future rewind to a
      // keyframe predating the evicted input can detect the gap.
      const oldTick = this.inputTicks[slot] ?? 0;
      if (oldTick > this.inputsEvictedMaxTick) this.inputsEvictedMaxTick = oldTick;
      this.inputGens[slot] = ((this.inputGens[slot] ?? 0) + 1) & GEN_MASK;
      this.inputValids[slot] = SLOT_INVALID;
    }
    const offset = slot * this.inputWords;
    for (let w = 0; w < this.inputWords; w++) {
      this.inputData[offset + w] = (words[w] ?? 0) | 0;
    }
    this.inputTicks[slot] = tick;
    this.inputValids[slot] = SLOT_VALID;
    const logicalIdx = this.inputWriteCountInternal;
    this.inputWriteCountInternal++;
    return logicalIdx;
  }

  // Whether an input at the given logical index is still in the ring,
  // valid, and addressable. Cheap read - safe to call before every
  // inputTickAt / inputWordAt during a manual scan.
  isInputValid(logicalIdx: number): boolean {
    if (!Number.isInteger(logicalIdx)
      || logicalIdx < 0
      || logicalIdx >= this.inputWriteCountInternal) {
      return false;
    }
    if (logicalIdx < this.inputWriteCountInternal - this.maxInputs) return false;
    const slot = logicalIdx % this.maxInputs;
    return (this.inputValids[slot] ?? 0) === SLOT_VALID;
  }

  inputTickAt(logicalIdx: number): number {
    this.requireValidInput(logicalIdx, 'inputTickAt');
    return this.inputTicks[logicalIdx % this.maxInputs] ?? 0;
  }

  inputWordAt(logicalIdx: number, wordIdx: number): number {
    this.requireValidInput(logicalIdx, 'inputWordAt');
    if (!Number.isInteger(wordIdx) || wordIdx < 0 || wordIdx >= this.inputWords) {
      throw new RangeError(
        'LoomChrono.inputWordAt: wordIdx ' + wordIdx + ' out of [0, ' + this.inputWords + ')',
      );
    }
    const slot = logicalIdx % this.maxInputs;
    return this.inputData[slot * this.inputWords + wordIdx] ?? 0;
  }

  // ---------- replay ----------

  // Build a rewind plan: find the latest valid keyframe with tick
  // <= targetTick and fill outInputIndices with the logical indices of
  // every valid input in (keyframeTick, targetTick], in tick order.
  // The chrono allocates nothing - outInputIndices is the seek scratch
  // (gate 4). Returns ok:false with a typed reason if no keyframe is
  // available, the keyframe predates evicted inputs (gap), or the
  // output buffer is too small.
  findReplayPlan(targetTick: number, outInputIndices: Int32Array): ReplayPlan {
    if (!Number.isFinite(targetTick)) {
      throw new RangeError(
        'LoomChrono.findReplayPlan: targetTick must be a finite number, got ' + targetTick,
      );
    }
    if (!outInputIndices) {
      throw new TypeError('LoomChrono.findReplayPlan: outInputIndices is required');
    }
    // Walk the keyframe ring, pick the valid slot with the largest
    // tick <= targetTick.
    let bestSlot = -1;
    let bestTick = -Infinity;
    for (let s = 0; s < this.maxKeyframes; s++) {
      if ((this.keyframeValids[s] ?? 0) !== SLOT_VALID) continue;
      const t = this.keyframeTicks[s] ?? 0;
      if (t > targetTick) continue;
      if (t > bestTick) {
        bestTick = t;
        bestSlot = s;
      }
    }
    if (bestSlot < 0) {
      return { ok: false, reason: 'no_keyframe' };
    }
    // Conservative gap detection: any input ever evicted whose tick
    // was above the chosen keyframe's tick means there was a state
    // change in (keyframeTick, ...] we no longer have.
    if (this.inputsEvictedMaxTick > bestTick) {
      return { ok: false, reason: 'inputs_evicted' };
    }
    // Walk inputs in logical order from the oldest still-present;
    // collect those with bestTick < tick <= targetTick AND valid.
    const oldestLogical = Math.max(0, this.inputWriteCountInternal - this.maxInputs);
    const cap = outInputIndices.length;
    let count = 0;
    for (let i = oldestLogical; i < this.inputWriteCountInternal; i++) {
      const slot = i % this.maxInputs;
      if ((this.inputValids[slot] ?? 0) !== SLOT_VALID) continue;
      const t = this.inputTicks[slot] ?? 0;
      if (t <= bestTick || t > targetTick) continue;
      if (count >= cap) {
        return { ok: false, reason: 'buffer_too_small' };
      }
      outInputIndices[count] = i;
      count++;
    }
    const handle = this.makeHandle(bestSlot, this.keyframeGens[bestSlot] ?? 0);
    return { ok: true, keyframeHandle: handle, keyframeTick: bestTick, inputCount: count };
  }

  // ---------- branch / invalidation ----------

  // Mark every keyframe and input with tick > the given value as
  // invalid. Used by a consumer that has rewound to `tick` and is
  // about to start a new branch from there - any logged events past
  // that point are stale. Returns the count of slots invalidated.
  invalidateAfter(tick: number): number {
    if (!Number.isFinite(tick)) {
      throw new RangeError(
        'LoomChrono.invalidateAfter: tick must be a finite number, got ' + tick,
      );
    }
    let count = 0;
    for (let s = 0; s < this.maxKeyframes; s++) {
      if ((this.keyframeValids[s] ?? 0) === SLOT_VALID
        && (this.keyframeTicks[s] ?? 0) > tick) {
        this.keyframeGens[s] = ((this.keyframeGens[s] ?? 0) + 1) & GEN_MASK;
        this.keyframeValids[s] = SLOT_INVALID;
        count++;
      }
    }
    for (let s = 0; s < this.maxInputs; s++) {
      if ((this.inputValids[s] ?? 0) === SLOT_VALID
        && (this.inputTicks[s] ?? 0) > tick) {
        this.inputGens[s] = ((this.inputGens[s] ?? 0) + 1) & GEN_MASK;
        this.inputValids[s] = SLOT_INVALID;
        count++;
      }
    }
    // The latest-snapshot pointer may now point at an invalidated
    // slot; recompute it by tick.
    if (this.lastSnapshotSlot >= 0
      && (this.keyframeValids[this.lastSnapshotSlot] ?? 0) !== SLOT_VALID) {
      let bestSlot = -1;
      let bestTick = -Infinity;
      for (let s = 0; s < this.maxKeyframes; s++) {
        if ((this.keyframeValids[s] ?? 0) !== SLOT_VALID) continue;
        const t = this.keyframeTicks[s] ?? 0;
        if (t > bestTick) {
          bestTick = t;
          bestSlot = s;
        }
      }
      this.lastSnapshotSlot = bestSlot;
    }
    return count;
  }

  // ---------- inspection ----------

  // Count of keyframe slots currently valid (a linear scan over a
  // small ring, <= 256).
  validKeyframeCount(): number {
    let n = 0;
    for (let s = 0; s < this.maxKeyframes; s++) {
      if ((this.keyframeValids[s] ?? 0) === SLOT_VALID) n++;
    }
    return n;
  }

  // Count of input slots currently valid.
  validInputCount(): number {
    let n = 0;
    for (let s = 0; s < this.maxInputs; s++) {
      if ((this.inputValids[s] ?? 0) === SLOT_VALID) n++;
    }
    return n;
  }

  // Total inputs ever logged - the upper bound on logical indices.
  inputWriteCount(): number {
    return this.inputWriteCountInternal;
  }

  // Total snapshots ever taken.
  snapshotCount(): number {
    return this.snapshotWriteCount;
  }

  // Largest input tick ever evicted from the ring; -Infinity if none.
  evictedInputTickHigh(): number {
    return this.inputsEvictedMaxTick;
  }

  // ---------- lifecycle ----------

  // Reset to the constructed-but-empty state. Bumps every generation so
  // any outstanding handle stops validating.
  clear(): void {
    this.keyframeStorage.fill(0);
    this.keyframeTicks.fill(0);
    for (let s = 0; s < this.maxKeyframes; s++) {
      this.keyframeGens[s] = ((this.keyframeGens[s] ?? 0) + 1) & GEN_MASK;
    }
    this.keyframeValids.fill(SLOT_INVALID);
    this.inputData.fill(0);
    this.inputTicks.fill(0);
    for (let s = 0; s < this.maxInputs; s++) {
      this.inputGens[s] = ((this.inputGens[s] ?? 0) + 1) & GEN_MASK;
    }
    this.inputValids.fill(SLOT_INVALID);
    this.snapshotWriteCount = 0;
    this.inputWriteCountInternal = 0;
    this.lastSnapshotSlot = -1;
    this.inputsEvictedMaxTick = -Infinity;
  }

  // ---------- private ----------

  private makeHandle(slot: number, gen: number): number {
    return (((gen & GEN_MASK) << GEN_SHIFT) | (slot & SLOT_MASK)) >>> 0;
  }

  private resolveKeyframeSlot(handle: number): number {
    if (!Number.isInteger(handle) || handle < 0 || handle > 0xffffffff) return -1;
    const slot = handle & SLOT_MASK;
    if (slot >= this.maxKeyframes) return -1;
    if ((this.keyframeValids[slot] ?? 0) !== SLOT_VALID) return -1;
    const gen = (handle >>> GEN_SHIFT) & GEN_MASK;
    if (gen !== (this.keyframeGens[slot] ?? 0)) return -1;
    return slot;
  }

  private requireValidInput(logicalIdx: number, op: string): void {
    if (!Number.isInteger(logicalIdx)
      || logicalIdx < 0
      || logicalIdx >= this.inputWriteCountInternal) {
      throw new RangeError(
        'LoomChrono.' + op + ': logicalIdx ' + logicalIdx
        + ' out of [0, ' + this.inputWriteCountInternal + ')',
      );
    }
    if (logicalIdx < this.inputWriteCountInternal - this.maxInputs) {
      throw new RangeError(
        'LoomChrono.' + op + ': logicalIdx ' + logicalIdx
        + ' has been evicted from the input ring',
      );
    }
    const slot = logicalIdx % this.maxInputs;
    if ((this.inputValids[slot] ?? 0) !== SLOT_VALID) {
      throw new RangeError(
        'LoomChrono.' + op + ': logicalIdx ' + logicalIdx + ' has been invalidated',
      );
    }
  }
}

// ---------- module helpers ----------

function requireOpts(opts: LoomChronoOptions): void {
  if (!opts) {
    throw new TypeError('LoomChrono: options object is required');
  }
}

function requireCap(name: string, value: number, lo: number, hi: number): void {
  if (!Number.isInteger(value) || value < lo || value > hi) {
    throw new RangeError(
      'LoomChrono: ' + name + ' must be an integer in [' + lo + ', ' + hi + '], got ' + value,
    );
  }
}

// Decode helpers for a chrono handle - exported so a consumer can
// inspect a handle without round-tripping through the chrono.
export function chronoSlot(handle: number): number {
  return (handle >>> 0) & SLOT_MASK;
}

export function chronoGeneration(handle: number): number {
  return ((handle >>> 0) >>> GEN_SHIFT) & GEN_MASK;
}
