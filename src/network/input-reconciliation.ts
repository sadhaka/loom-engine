// InputReconciliation - fixed-point client-side prediction with a
// flat ring of predicted frames, for server reconciliation.
//
// The client predicts its own position every tick and record()s the
// frame. When the server later sends the authoritative position for
// a past tick, reconcile() looks that tick up in the ring, compares
// it against what the client predicted, and reports whether the
// prediction was wrong - a "mispredict" the caller must re-simulate
// from. The render layer separately calls the static smoothVisual()
// to ease the visible position toward the corrected one WITHOUT
// touching gameplay state.
//
// This is the dossier's section 5, the standalone fixed-point
// specialization. It is complementary to LagCompensation, not a
// replacement: LagCompensation is a generic <TState, TInput>
// object-array rewind buffer; InputReconciliation is the concrete,
// zero-allocation, fixed-point ring - the deterministic predictor,
// the way SpatialGrid is the dense counterpart to SpatialHash.
//
// Storage is one flat Int32Array, SLOT_STRIDE Int32s per ring slot:
//   [ tick, xFixed, yFixed, inputMask ]
// indexed by tick % capacity. xFixed / yFixed are 16.16 fixed-point
// (see floatToFixed): integer math so prediction is bit-identical on
// every runtime. A slot's tick stamp is the validation key - it is
// EMPTY_TICK until written, and reconcile() / readSlot() only trust
// a slot whose stamp equals the tick being looked up, so a slot the
// ring has since recycled to a newer tick fails the check.
//
// The Codex gates, enforced:
//   1. tick-history validation - reconcile() / readSlot() verify the
//      slot's stamp equals the requested tick before trusting it.
//   2. fixed-point rounding / overflow / tick wrap are all defined:
//      floatToFixed rounds via Math.round (half toward +Infinity) and
//      throws on Int32 overflow; tick wrap is the tick % capacity
//      ring index, disambiguated by the per-slot tick stamp.
//   3. strict tick ordering - record() rejects a forward gap or a
//      write into an already-recycled slot.
//   4. direct SoA writes - readSlot() and smoothVisual() fill a
//      caller-owned Int32Array; neither returns a fresh object.
//   5. visual smoothing is out of gameplay state - smoothVisual() is
//      static and pure, so it structurally cannot read or write the
//      prediction ring.
//   6. single correction entry point - reconcile() is the only path
//      a server correction takes into the ring; the caller owns the
//      re-simulation loop (readSlot feeds it the recorded inputs).

// 16.16 fixed-point: a world value is stored as round(value * 2^16).
export const FIXED_POINT_SHIFT = 16;
export const FIXED_POINT_ONE = 1 << FIXED_POINT_SHIFT;   // 65536

// Int32 per ring slot: [tick, xFixed, yFixed, inputMask].
const SLOT_STRIDE = 4;
// Tick stamp of a never-written slot. Real ticks are non-negative, so
// -1 can never collide with one.
const EMPTY_TICK = -1;
// Sanity cap on the ring slot count - a bad argument throws a clear
// error instead of attempting an absurd typed-array allocation.
const MAX_HISTORY_CAPACITY = 1 << 20;
// Inclusive Int32 bounds.
const INT32_MIN = -0x80000000;
const INT32_MAX = 0x7fffffff;

function requireTick(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > INT32_MAX) {
    throw new RangeError(
      'InputReconciliation: ' + name + ' must be a non-negative Int32 integer, got ' + value,
    );
  }
}

function requireFixed(value: number, name: string): void {
  if (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX) {
    throw new RangeError(
      'InputReconciliation: ' + name + ' must be an Int32 integer, got ' + value,
    );
  }
}

// Convert a world-space float to 16.16 fixed-point. Rounding is
// Math.round - half rounds toward +Infinity - and is identical on
// every runtime. Throws if the result would not fit Int32 (world
// positions must stay within +-32768 units); that is the defined
// overflow behaviour, failing loud at the conversion boundary.
export function floatToFixed(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError('InputReconciliation.floatToFixed: value must be finite, got ' + value);
  }
  const fixed = Math.round(value * FIXED_POINT_ONE);
  if (fixed < INT32_MIN || fixed > INT32_MAX) {
    throw new RangeError(
      'InputReconciliation.floatToFixed: ' + value
      + ' overflows 16.16 fixed-point (keep world values within +-32768)',
    );
  }
  // Math.round can produce -0; normalise it to +0 so the fixed-point
  // zero is canonical for a standalone caller (Int32Array storage
  // would coerce it anyway).
  return fixed === 0 ? 0 : fixed;
}

// Convert a 16.16 fixed-point value back to a float.
export function fixedToFloat(fixed: number): number {
  return fixed / FIXED_POINT_ONE;
}

export interface ReconcileResult {
  // True if the server tick matched a live slot in the ring (its
  // stamp equalled serverTick). False means the tick has aged out of
  // the ring or was never recorded - the caller cannot re-simulate
  // from it and must do a full resync instead.
  accepted: boolean;
  // Only meaningful when accepted: true if the client's predicted
  // position for that tick differed from the server's authoritative
  // one. The caller must re-simulate forward from serverTick when
  // this is set; when it is false the prediction was correct and no
  // re-simulation is needed.
  mispredicted: boolean;
}

export class InputReconciliation {
  // Ring slot count.
  readonly capacity: number;

  // capacity * SLOT_STRIDE Int32s: [tick, xFixed, yFixed, inputMask]
  // per slot. A slot's tick stamp is EMPTY_TICK until written.
  private readonly history: Int32Array;

  // Highest tick ever recorded, or EMPTY_TICK if none. Re-recording a
  // past tick during re-simulation does not move this backward.
  private lastRecordedTick: number = EMPTY_TICK;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_HISTORY_CAPACITY) {
      throw new RangeError(
        'InputReconciliation: capacity must be an integer in [1, '
        + MAX_HISTORY_CAPACITY + '], got ' + capacity,
      );
    }
    this.capacity = capacity;
    this.history = new Int32Array(capacity * SLOT_STRIDE).fill(EMPTY_TICK);
  }

  // Highest recorded tick, or -1 if nothing has been recorded.
  get lastTick(): number {
    return this.lastRecordedTick;
  }

  // Record the client's predicted frame for `tick`. xFixed / yFixed
  // are 16.16 fixed-point; inputMask is the 32-bit input bitmask that
  // produced this frame (stored verbatim, read back as bits).
  //
  // Strict tick ordering (gate 3): after the first record, `tick`
  // must be either the next tick (lastRecordedTick + 1) or a re-write
  // of a tick still inside the ring window
  // [lastRecordedTick - capacity + 1, lastRecordedTick]. A forward
  // gap, or a write into a slot the ring has already recycled to a
  // newer tick, throws.
  record(tick: number, xFixed: number, yFixed: number, inputMask: number): void {
    requireTick(tick, 'tick');
    requireFixed(xFixed, 'xFixed');
    requireFixed(yFixed, 'yFixed');
    if (!Number.isInteger(inputMask)) {
      throw new RangeError('InputReconciliation.record: inputMask must be an integer, got ' + inputMask);
    }
    if (this.lastRecordedTick !== EMPTY_TICK) {
      const oldest = this.lastRecordedTick - this.capacity + 1;
      const newest = this.lastRecordedTick + 1;
      if (tick < oldest || tick > newest) {
        throw new RangeError(
          'InputReconciliation.record: tick ' + tick + ' out of the ordered window ['
          + oldest + ', ' + newest + '] - forward gap or recycled slot',
        );
      }
    }
    const slot = (tick % this.capacity) * SLOT_STRIDE;
    this.history[slot] = tick;
    this.history[slot + 1] = xFixed;
    this.history[slot + 2] = yFixed;
    this.history[slot + 3] = inputMask;
    if (tick > this.lastRecordedTick) this.lastRecordedTick = tick;
  }

  // Apply a server's authoritative position for `serverTick`. Gate 1:
  // the ring slot is trusted only if its stamp equals serverTick.
  //
  //   - slot stamp != serverTick -> { accepted: false } (aged out or
  //     never recorded; the caller must full-resync, not re-simulate).
  //   - stamp matches -> the predicted position is compared with the
  //     server's, the server's is written into the slot (so a
  //     re-simulation starts from authoritative truth), and
  //     { accepted: true, mispredicted } is returned.
  //
  // Gate 6: this is the only path a network correction takes into the
  // ring. The caller owns the re-simulation loop - on a mispredict it
  // walks serverTick+1..lastTick, readSlot()-ing each recorded input.
  reconcile(serverTick: number, serverXFixed: number, serverYFixed: number): ReconcileResult {
    requireTick(serverTick, 'serverTick');
    requireFixed(serverXFixed, 'serverXFixed');
    requireFixed(serverYFixed, 'serverYFixed');
    const slot = (serverTick % this.capacity) * SLOT_STRIDE;
    if ((this.history[slot] ?? EMPTY_TICK) !== serverTick) {
      return { accepted: false, mispredicted: false };
    }
    const predictedX = this.history[slot + 1] ?? 0;
    const predictedY = this.history[slot + 2] ?? 0;
    const mispredicted = predictedX !== serverXFixed || predictedY !== serverYFixed;
    this.history[slot + 1] = serverXFixed;
    this.history[slot + 2] = serverYFixed;
    return { accepted: true, mispredicted };
  }

  // Read the recorded frame for `tick` into `out` as
  // [xFixed, yFixed, inputMask] - a direct SoA write, no object
  // allocation (gate 4). Returns true if the slot's stamp matches
  // `tick`; returns false and leaves `out` untouched otherwise. The
  // re-simulation loop uses this to replay recorded inputs.
  readSlot(tick: number, out: Int32Array): boolean {
    requireTick(tick, 'tick');
    if (out.length < 3) {
      throw new RangeError('InputReconciliation.readSlot: out must hold at least 3 Int32s, got ' + out.length);
    }
    const slot = (tick % this.capacity) * SLOT_STRIDE;
    if ((this.history[slot] ?? EMPTY_TICK) !== tick) return false;
    out[0] = this.history[slot + 1] ?? 0;
    out[1] = this.history[slot + 2] ?? 0;
    out[2] = this.history[slot + 3] ?? 0;
    return true;
  }

  // Reset every slot to empty.
  clear(): void {
    this.history.fill(EMPTY_TICK);
    this.lastRecordedTick = EMPTY_TICK;
  }

  // Render-only visual smoothing (gates 4 + 5). Eases a visible
  // position from the client's predicted value toward the server's
  // corrected value: visual = client + (server - client) * lerp.
  // lerpFixed is a 16.16 factor, clamped to [0, FIXED_POINT_ONE]
  // (0.0 .. 1.0). The result is written into `out` as
  // [visualXFixed, visualYFixed].
  //
  // This is static and pure - it touches no instance state, so it
  // structurally cannot leak smoothing into the prediction ring or
  // the gameplay simulation. Gameplay always uses the raw server
  // truth; only the renderer sees the smoothed value.
  static smoothVisual(
    clientXFixed: number,
    clientYFixed: number,
    serverXFixed: number,
    serverYFixed: number,
    lerpFixed: number,
    out: Int32Array,
  ): void {
    requireFixed(clientXFixed, 'clientXFixed');
    requireFixed(clientYFixed, 'clientYFixed');
    requireFixed(serverXFixed, 'serverXFixed');
    requireFixed(serverYFixed, 'serverYFixed');
    if (!Number.isInteger(lerpFixed)) {
      throw new RangeError('InputReconciliation.smoothVisual: lerpFixed must be an integer, got ' + lerpFixed);
    }
    if (out.length < 2) {
      throw new RangeError('InputReconciliation.smoothVisual: out must hold at least 2 Int32s, got ' + out.length);
    }
    let lerp = lerpFixed;
    if (lerp < 0) lerp = 0;
    else if (lerp > FIXED_POINT_ONE) lerp = FIXED_POINT_ONE;
    // (server - client) is an Int32-range difference and lerp <=
    // 2^16, so the product stays well inside the 2^53 safe-integer
    // range - divide rather than >> 16, which would truncate to
    // Int32 and drop the high bits. The result lies between client
    // and server, so it fits Int32.
    const visualX = clientXFixed + Math.round((serverXFixed - clientXFixed) * lerp / FIXED_POINT_ONE);
    const visualY = clientYFixed + Math.round((serverYFixed - clientYFixed) * lerp / FIXED_POINT_ONE);
    out[0] = visualX;
    out[1] = visualY;
  }
}
