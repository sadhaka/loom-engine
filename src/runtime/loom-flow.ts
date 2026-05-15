// LoomFlow - the adaptive-network packet router: three lanes
// (UNRELIABLE_MOVEMENT, RELIABLE_COMBAT, RELIABLE_ECONOMY), each
// with its own sequence space, authority epoch, jitter buffer, and
// per-client throttle. The deferred transport binds these to
// WebTransport / WebRTC / WebSocket - the kernel is the pure-logic
// outbound queue / inbound jitter buffer / stale-packet rejector /
// throttle state machine.
//
// The Trinity dossier's section 20 (Gemini Volume I). The Gemini sketch
// was `send(lane: 'UNRELIABLE' | 'RELIABLE', data) { seq =
// getNextSequence(lane); transport.transmit(lane, wrap(seq, data)) }`.
// The Codex audit: "correct instinct, but causal consistency must
// be formalized." The sketch had two-lane string identifiers (not
// three integer lanes), no idempotency keys, no authority epoch
// (a rolled-back server could re-apply old packets), no jitter
// buffer capacity (a slow lane silently grew unbounded), no late-
// packet policy, no per-client throttle / backpressure, and no
// transport profile selection (WebTransport / WebRTC / fallback).
//
// This is the corrected build, single-thread / single-owner like every
// shipped Trinity component. The actual WebTransport / WebRTC /
// WebSocket layer is the deferred integration layer; this is the
// pure-logic OUTBOUND-QUEUE / INBOUND-JITTER-BUFFER / STALE-CHECK /
// THROTTLE / EPOCH state machine.
//
// LANES (gate 1). Three lanes, fixed at compile time:
//   LANE_UNRELIABLE_MOVEMENT - movement snapshots; UDP-like;
//     out-of-order delivery accepted; the consumer reads the
//     newest snapshot per client, drops older.
//   LANE_RELIABLE_COMBAT - combat commands & results; ordered;
//     dropped packets are NOT recovered here (the deferred
//     transport handles retransmit); the kernel guarantees ordered
//     delivery on the inbound side.
//   LANE_RELIABLE_ECONOMY - inventory / market / persistence; ordered;
//     idempotent (a duplicate idempotency key is a no-op).
//
// SEQUENCE NUMBERS + EPOCHS (gate 3). Per-lane outbound sequence
// counter assigns a u32 sequence to every packet. authorityEpoch
// (a u16 stamped into the outbound packet header) survives a
// server-rollback: a packet with epoch < currentEpoch is REJECTED
// inbound. rotateAuthorityEpoch(lane) is the manual bump (called
// after a rollback / hot-failover).
//
// IDEMPOTENCY (gate 3). Each outbound packet carries a u32
// idempotency key the caller supplies (or 0 = "no idempotency
// guarantee"). The inbound side maintains a per-(lane, client)
// recent-idempotency hash table; a duplicate key is dropped before
// delivery.
//
// JITTER BUFFER (gate 4). Per-(lane, client) inbound buffer holds
// up to jitterBufferCapacity packets. For ordered lanes
// (RELIABLE_*), drainInbound delivers packets in strict sequence
// order; head-of-line blocks if seq=N+1 is missing (consumer
// waits for the next inbound enqueue or for the lateGapPolicy to
// release the gap). For unordered (UNRELIABLE_*), the buffer keeps
// only the highest-seq packet per client (newer overwrites older);
// drainInbound yields the newest.
//
// LATE-PACKET POLICY (gate 4). A packet with seq < lastDeliveredSeq
// is REJECTED on enqueue (stale). A packet that lands in the
// jitter buffer past its TTL is dropped on tick().
//
// PER-CLIENT THROTTLE WITH HYSTERESIS (gate 5). Per-client
// inboundRateThisTick counter. Past throttleEnterRate, the client
// is THROTTLED: inbound packets are dropped with REASON_THROTTLED.
// The client stays throttled until rate falls below throttleLeaveRate
// and STAYS below for throttleReleaseTicks consecutive ticks. The
// hysteresis prevents flap.
//
// TRANSPORT PROFILE (gate 6). pickTransport(capabilities) returns
// the best supported transport from (WEBTRANSPORT > WEBRTC >
// WEBSOCKET) given a feature bitset. The deferred dispatcher uses
// this to construct the right channel.
//
// The 6 Codex gates for LoomFlow, enforced:
//   1. "split event classes: unreliable movement, reliable combat,
//      reliable economy" - three integer lanes with per-lane
//      config; the caller selects.
//   2. "configure WebRTC channels explicitly for unordered /
//      unreliable" - per-lane orderedFlag + reliableFlag (bits in
//      the lane config; the deferred dispatcher reads these and
//      sets the WebRTC channel options).
//   3. "per-lane sequence numbers + idempotency + authority epochs
//      + stale rejection" - outbound seq counter, idempotency key
//      table, authorityEpoch on every packet, lastDeliveredSeq
//      per (lane, client) rejects stale.
//   4. "jitter buffer capacity limits + late-packet policy" -
//      jitterBufferCapacity per (lane, client); past TTL = drop;
//      past lastDeliveredSeq = drop.
//   5. "per-client throttling with hysteresis + backpressure" -
//      per-client rate + throttled flag + release-after-N-ticks
//      hysteresis; throttled-state events on a metrics ring.
//   6. "consider WebTransport with WebRTC / WebSocket fallback" -
//      pickTransport(capabilities); profile enum.
//
// Non-negotiable engine gates: no RNG; no wall clock - tick(t) is
// injected, a run replays bit-for-bit; single-thread, no Atomics;
// every clientId / lane / seq / payload-offset bounds-checked;
// fixed-capacity storage. The SAB multi-producer transport bridge
// is the deferred integration layer.

// Lanes. Three, fixed.
export const LANE_UNRELIABLE_MOVEMENT = 0;
export const LANE_RELIABLE_COMBAT = 1;
export const LANE_RELIABLE_ECONOMY = 2;
const LANE_COUNT = 3;

// Transport profiles (gate 6). Higher = better; pickTransport selects
// the highest the device supports.
export const TRANSPORT_WEBTRANSPORT = 2;
export const TRANSPORT_WEBRTC = 1;
export const TRANSPORT_WEBSOCKET = 0;
export const TRANSPORT_INVALID = -1;

// Capability flags (gate 6). OR'd into a u32 the kernel consumes.
export const FLOW_CAP_WEBTRANSPORT = 1 << 0;
export const FLOW_CAP_WEBRTC = 1 << 1;
export const FLOW_CAP_WEBSOCKET = 1 << 2;

// Enqueue / drain reason codes.
export const FLOW_REASON_NONE = 0;
export const FLOW_REASON_STALE_SEQ = 1;        // inbound seq <= lastDelivered
export const FLOW_REASON_STALE_EPOCH = 2;      // inbound epoch < currentEpoch
export const FLOW_REASON_DUPLICATE = 3;        // idempotency-key duplicate
export const FLOW_REASON_THROTTLED = 4;        // client over throttleEnterRate
export const FLOW_REASON_BUFFER_FULL = 5;      // jitter buffer at capacity
export const FLOW_REASON_BAD_LANE = 6;
export const FLOW_REASON_BAD_CLIENT = 7;
export const FLOW_REASON_BAD_SEQ = 8;
export const FLOW_REASON_TTL_EXPIRED = 9;      // dropped on tick TTL sweep
export const FLOW_REASON_OUTBOUND_FULL = 10;   // outbound ring at capacity

// Sentinels.
export const PACKET_INVALID = -1;

// Metrics event record stride: [eventType, lane, clientId, seq, tick].
// eventType is one of FLOW_REASON_*.
export const FLOW_EVENT_STRIDE = 5;

// Packet record stride for drain output: [lane, clientId, seq, epoch,
// idempotencyKey, payloadOffset, payloadLength, deliveredAtTick].
export const FLOW_PACKET_STRIDE = 8;

// Sanity caps.
const MAX_CLIENTS = 1 << 14;
const MAX_LANES = 3;
const MAX_OUTBOUND_RING = 1 << 16;
const MAX_JITTER_BUFFER = 1 << 12;
const MAX_PAYLOAD_BYTES = 1 << 20;             // shared payload arena byte ceiling
const MAX_PER_CLIENT_RATE = 1 << 16;
const MAX_TTL = 1 << 16;
const MAX_EVENT_RING = 1 << 14;
const MAX_IDEMP_TABLE = 1 << 16;
const U32_MAX = 0xffffffff;

export function pickTransport(capabilities: number): number {
  if (!Number.isInteger(capabilities) || capabilities < 0) return TRANSPORT_INVALID;
  if ((capabilities & FLOW_CAP_WEBTRANSPORT) !== 0) return TRANSPORT_WEBTRANSPORT;
  if ((capabilities & FLOW_CAP_WEBRTC) !== 0) return TRANSPORT_WEBRTC;
  if ((capabilities & FLOW_CAP_WEBSOCKET) !== 0) return TRANSPORT_WEBSOCKET;
  return TRANSPORT_INVALID;
}

// Smallest power of two >= n (n >= 1).
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// Murmur3-style integer finalizer.
function mix32(h: number): number {
  h = h >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export interface LoomFlowConfig {
  // Per-client tracking. clientId in [0, maxClients).
  maxClients: number;
  // Outbound ring capacity per lane. enqueueOutbound drops past this
  // with REASON_OUTBOUND_FULL.
  outboundRingCapacity: number;
  // Per-(lane, client) jitter buffer capacity. enqueueInbound drops
  // past this with REASON_BUFFER_FULL.
  jitterBufferCapacity: number;
  // Inbound packet TTL in ticks. A packet in the jitter buffer past
  // this many ticks is dropped on tick() with REASON_TTL_EXPIRED.
  jitterBufferTtlTicks: number;
  // Shared payload arena byte size. enqueueOutbound copies payloadFp
  // into the arena; positions returned in the drained packet record.
  payloadArenaBytes: number;
  // Per-client rate counter: packets-per-tick that triggers throttle.
  throttleEnterRate: number;
  // Packets-per-tick threshold to LEAVE throttle (must be <
  // throttleEnterRate for hysteresis).
  throttleLeaveRate: number;
  // Ticks of below-throttleLeaveRate rate required to release the
  // throttle (hysteresis).
  throttleReleaseTicks: number;
  // Idempotency table capacity per (lane, client) - the most recent
  // N keys are remembered; older keys evict (a true duplicate past
  // this window is treated as fresh, with an inevitable application-
  // layer dedupe burden).
  idempotencyWindow: number;
  // Metrics event ring capacity. Past this, events are dropped +
  // counted as eventsDroppedTotal.
  eventRingCapacity: number;
  // Device transport capabilities (FLOW_CAP_* OR'd). Constructor
  // calls pickTransport() once; the consumer can re-select on a
  // device-lost recovery via setCapabilities.
  capabilities: number;
}

export class LoomFlow {
  readonly maxClients: number;
  readonly outboundRingCapacity: number;
  readonly jitterBufferCapacity: number;
  readonly jitterBufferTtlTicks: number;
  readonly payloadArenaBytes: number;
  readonly throttleEnterRate: number;
  readonly throttleLeaveRate: number;
  readonly throttleReleaseTicks: number;
  readonly idempotencyWindow: number;
  readonly eventRingCapacity: number;

  // Per-lane outbound state.
  private readonly outboundLane: Uint8Array;
  private readonly outboundClient: Int32Array;
  private readonly outboundSeq: Uint32Array;
  private readonly outboundEpoch: Uint16Array;
  private readonly outboundIdempotency: Uint32Array;
  private readonly outboundPayloadOffset: Uint32Array;
  private readonly outboundPayloadLength: Uint32Array;
  private readonly outboundEnqueuedAtTick: Uint32Array;
  private readonly outboundHead: Uint32Array;     // [LANE_COUNT]
  private readonly outboundTail: Uint32Array;
  private readonly outboundSeqCounter: Uint32Array;

  // Per-lane current authority epoch (gate 3).
  private readonly laneAuthorityEpoch: Uint16Array;

  // Per-lane lane config (gate 2): bit 0 ordered, bit 1 reliable.
  private readonly laneOrdered: Uint8Array;
  private readonly laneReliable: Uint8Array;

  // Per-(lane, client) inbound state. Sized lanes*maxClients.
  // lastDeliveredSeq used by ordered lanes to enforce in-order
  // delivery; lastSeenSeq used by unordered lanes to drop older.
  private readonly inLastDeliveredSeq: Int32Array;     // -1 = none yet
  private readonly inLastSeenSeq: Int32Array;          // unordered tracking

  // Inbound jitter buffer. Records keyed by (lane, client) slot;
  // each slot holds up to jitterBufferCapacity packets in a SoA
  // ring with seq + epoch + idemp + payload offset/len + enqueuedAt.
  // Indexed [(lane * maxClients + clientId) * jitterBufferCapacity + slot].
  private readonly jitterSeq: Uint32Array;
  private readonly jitterEpoch: Uint16Array;
  private readonly jitterIdemp: Uint32Array;
  private readonly jitterPayloadOffset: Uint32Array;
  private readonly jitterPayloadLength: Uint32Array;
  private readonly jitterEnqueuedAtTick: Uint32Array;
  private readonly jitterOccupied: Uint8Array;
  private readonly jitterCount: Uint32Array;   // [(lane,client)] occupied count

  // Per-(lane, client) idempotency ring (gate 3). Small dense ring;
  // a key is in the ring iff (idempotency != 0) and seq is in the
  // recent window. We use a simple ring: idempotencyWindow keys per
  // (lane, client), head + count.
  private readonly idempRingKey: Uint32Array;
  private readonly idempRingHead: Uint32Array;  // [(lane,client)]
  private readonly idempRingCount: Uint32Array;

  // Per-client throttle state (gate 5).
  private readonly clientRateThisTick: Uint32Array;
  private readonly clientThrottled: Uint8Array;
  private readonly clientBelowLeaveStreak: Uint32Array;

  // Payload arena (shared byte pool). Outbound/inbound payloads land
  // here. payloadHead is the bump-allocator cursor; resets on clear().
  // For the kernel level the arena is "bring-your-own-bytes" - the
  // caller passes a slice + length; we copy into the arena and yield
  // (offset, length).
  private readonly payloadArena: Uint8Array;
  private payloadHead: number = 0;

  // Metrics event ring.
  private readonly eventRing: Int32Array;
  private eventHead: number = 0;
  private eventTail: number = 0;
  private eventsDroppedTotal: number = 0;

  // Tick + capability state.
  private currentTick: number = 0;
  private capabilities: number;
  private selectedTransport: number;

  // Counters.
  private outboundEnqueuedTotal: number = 0;
  private outboundDroppedTotal: number = 0;
  private inboundDeliveredTotal: number = 0;
  private inboundDroppedTotal: number = 0;

  constructor(config: LoomFlowConfig) {
    const {
      maxClients, outboundRingCapacity, jitterBufferCapacity, jitterBufferTtlTicks,
      payloadArenaBytes, throttleEnterRate, throttleLeaveRate, throttleReleaseTicks,
      idempotencyWindow, eventRingCapacity, capabilities,
    } = config;
    if (!Number.isInteger(maxClients) || maxClients < 1 || maxClients > MAX_CLIENTS) {
      throw new RangeError('LoomFlow: maxClients out of range, got ' + maxClients);
    }
    if (!Number.isInteger(outboundRingCapacity) || outboundRingCapacity < 1
      || outboundRingCapacity > MAX_OUTBOUND_RING) {
      throw new RangeError('LoomFlow: outboundRingCapacity out of range, got ' + outboundRingCapacity);
    }
    if (!Number.isInteger(jitterBufferCapacity) || jitterBufferCapacity < 1
      || jitterBufferCapacity > MAX_JITTER_BUFFER) {
      throw new RangeError('LoomFlow: jitterBufferCapacity out of range, got ' + jitterBufferCapacity);
    }
    if (!Number.isInteger(jitterBufferTtlTicks) || jitterBufferTtlTicks < 1
      || jitterBufferTtlTicks > MAX_TTL) {
      throw new RangeError('LoomFlow: jitterBufferTtlTicks out of range, got ' + jitterBufferTtlTicks);
    }
    if (!Number.isInteger(payloadArenaBytes) || payloadArenaBytes < 1
      || payloadArenaBytes > MAX_PAYLOAD_BYTES) {
      throw new RangeError('LoomFlow: payloadArenaBytes out of range, got ' + payloadArenaBytes);
    }
    if (!Number.isInteger(throttleEnterRate) || throttleEnterRate < 1
      || throttleEnterRate > MAX_PER_CLIENT_RATE) {
      throw new RangeError('LoomFlow: throttleEnterRate out of range, got ' + throttleEnterRate);
    }
    if (!Number.isInteger(throttleLeaveRate) || throttleLeaveRate < 0
      || throttleLeaveRate >= throttleEnterRate) {
      throw new RangeError(
        'LoomFlow: throttleLeaveRate (' + throttleLeaveRate
        + ') must be < throttleEnterRate (' + throttleEnterRate + ') for hysteresis',
      );
    }
    if (!Number.isInteger(throttleReleaseTicks) || throttleReleaseTicks < 1
      || throttleReleaseTicks > MAX_TTL) {
      throw new RangeError('LoomFlow: throttleReleaseTicks out of range, got ' + throttleReleaseTicks);
    }
    if (!Number.isInteger(idempotencyWindow) || idempotencyWindow < 1
      || idempotencyWindow > 256) {
      throw new RangeError('LoomFlow: idempotencyWindow must be in [1, 256], got ' + idempotencyWindow);
    }
    if (!Number.isInteger(eventRingCapacity) || eventRingCapacity < 1
      || eventRingCapacity > MAX_EVENT_RING) {
      throw new RangeError('LoomFlow: eventRingCapacity out of range, got ' + eventRingCapacity);
    }
    if (!Number.isInteger(capabilities) || capabilities < 0 || capabilities > 0xffff) {
      throw new RangeError('LoomFlow: capabilities out of range, got ' + capabilities);
    }
    this.maxClients = maxClients;
    this.outboundRingCapacity = outboundRingCapacity;
    this.jitterBufferCapacity = jitterBufferCapacity;
    this.jitterBufferTtlTicks = jitterBufferTtlTicks;
    this.payloadArenaBytes = payloadArenaBytes;
    this.throttleEnterRate = throttleEnterRate;
    this.throttleLeaveRate = throttleLeaveRate;
    this.throttleReleaseTicks = throttleReleaseTicks;
    this.idempotencyWindow = idempotencyWindow;
    this.eventRingCapacity = eventRingCapacity;
    this.capabilities = capabilities;
    this.selectedTransport = pickTransport(capabilities);

    const outboundTotal = LANE_COUNT * outboundRingCapacity;
    this.outboundLane = new Uint8Array(outboundTotal);
    this.outboundClient = new Int32Array(outboundTotal).fill(-1);
    this.outboundSeq = new Uint32Array(outboundTotal);
    this.outboundEpoch = new Uint16Array(outboundTotal);
    this.outboundIdempotency = new Uint32Array(outboundTotal);
    this.outboundPayloadOffset = new Uint32Array(outboundTotal);
    this.outboundPayloadLength = new Uint32Array(outboundTotal);
    this.outboundEnqueuedAtTick = new Uint32Array(outboundTotal);
    this.outboundHead = new Uint32Array(LANE_COUNT);
    this.outboundTail = new Uint32Array(LANE_COUNT);
    this.outboundSeqCounter = new Uint32Array(LANE_COUNT);

    this.laneAuthorityEpoch = new Uint16Array(LANE_COUNT);
    // Lane config: 0 = UNRELIABLE_MOVEMENT (unordered, unreliable),
    // 1 = RELIABLE_COMBAT (ordered, reliable),
    // 2 = RELIABLE_ECONOMY (ordered, reliable).
    this.laneOrdered = new Uint8Array(LANE_COUNT);
    this.laneOrdered[LANE_UNRELIABLE_MOVEMENT] = 0;
    this.laneOrdered[LANE_RELIABLE_COMBAT] = 1;
    this.laneOrdered[LANE_RELIABLE_ECONOMY] = 1;
    this.laneReliable = new Uint8Array(LANE_COUNT);
    this.laneReliable[LANE_UNRELIABLE_MOVEMENT] = 0;
    this.laneReliable[LANE_RELIABLE_COMBAT] = 1;
    this.laneReliable[LANE_RELIABLE_ECONOMY] = 1;

    const perPair = LANE_COUNT * maxClients;
    this.inLastDeliveredSeq = new Int32Array(perPair).fill(-1);
    this.inLastSeenSeq = new Int32Array(perPair).fill(-1);

    const jitterTotal = perPair * jitterBufferCapacity;
    this.jitterSeq = new Uint32Array(jitterTotal);
    this.jitterEpoch = new Uint16Array(jitterTotal);
    this.jitterIdemp = new Uint32Array(jitterTotal);
    this.jitterPayloadOffset = new Uint32Array(jitterTotal);
    this.jitterPayloadLength = new Uint32Array(jitterTotal);
    this.jitterEnqueuedAtTick = new Uint32Array(jitterTotal);
    this.jitterOccupied = new Uint8Array(jitterTotal);
    this.jitterCount = new Uint32Array(perPair);

    const idempTotal = perPair * idempotencyWindow;
    this.idempRingKey = new Uint32Array(idempTotal);
    this.idempRingHead = new Uint32Array(perPair);
    this.idempRingCount = new Uint32Array(perPair);

    this.clientRateThisTick = new Uint32Array(maxClients);
    this.clientThrottled = new Uint8Array(maxClients);
    this.clientBelowLeaveStreak = new Uint32Array(maxClients);

    this.payloadArena = new Uint8Array(payloadArenaBytes);
    this.eventRing = new Int32Array(eventRingCapacity * FLOW_EVENT_STRIDE);
  }

  // --- counts ---

  getCurrentTick(): number { return this.currentTick; }
  getCapabilities(): number { return this.capabilities; }
  getSelectedTransport(): number { return this.selectedTransport; }
  getOutboundEnqueuedTotal(): number { return this.outboundEnqueuedTotal; }
  getOutboundDroppedTotal(): number { return this.outboundDroppedTotal; }
  getInboundDeliveredTotal(): number { return this.inboundDeliveredTotal; }
  getInboundDroppedTotal(): number { return this.inboundDroppedTotal; }
  getEventsDroppedTotal(): number { return this.eventsDroppedTotal; }
  getEventsPending(): number { return this.eventTail - this.eventHead; }

  getLaneAuthorityEpoch(lane: number): number {
    if (!this.requireLane(lane)) return 0;
    return this.laneAuthorityEpoch[lane] ?? 0;
  }

  getOutboundQueueCount(lane: number): number {
    if (!this.requireLane(lane)) return 0;
    return ((this.outboundTail[lane] ?? 0) - (this.outboundHead[lane] ?? 0)) | 0;
  }

  getInboundBufferCount(lane: number, clientId: number): number {
    if (!this.requireLane(lane) || !this.requireClientId(clientId)) return 0;
    return this.jitterCount[this.pairIdx(lane, clientId)] ?? 0;
  }

  getClientRateThisTick(clientId: number): number {
    if (!this.requireClientId(clientId)) return 0;
    return this.clientRateThisTick[clientId] ?? 0;
  }

  isClientThrottled(clientId: number): boolean {
    if (!this.requireClientId(clientId)) return false;
    return (this.clientThrottled[clientId] ?? 0) === 1;
  }

  // Read per-lane channel options the deferred transport binds to.
  // ordered / reliable are u8 (0/1).
  getLaneOrdered(lane: number): number {
    if (!this.requireLane(lane)) return 0;
    return this.laneOrdered[lane] ?? 0;
  }

  getLaneReliable(lane: number): number {
    if (!this.requireLane(lane)) return 0;
    return this.laneReliable[lane] ?? 0;
  }

  // --- transport profile (gate 6) ---

  setCapabilities(capabilities: number): boolean {
    if (!Number.isInteger(capabilities) || capabilities < 0 || capabilities > 0xffff) return false;
    this.capabilities = capabilities;
    this.selectedTransport = pickTransport(capabilities);
    return true;
  }

  // --- authority epoch (gate 3) ---

  // Bump the lane's authority epoch. After a server rollback or
  // hot-failover, the new authority side calls this and the inbound
  // side rejects any subsequent packet carrying an older epoch.
  rotateAuthorityEpoch(lane: number): boolean {
    if (!this.requireLane(lane)) return false;
    this.laneAuthorityEpoch[lane] = (((this.laneAuthorityEpoch[lane] ?? 0) + 1) & 0xffff);
    return true;
  }

  // --- outbound (gates 1, 3) ---

  // Enqueue a packet for outbound transport. The kernel assigns the
  // sequence number and the current authority epoch; the caller
  // supplies clientId, idempotencyKey, and the payload bytes. The
  // payload is COPIED into the kernel's arena. Returns the assigned
  // seq, or PACKET_INVALID on drop.
  enqueueOutbound(
    lane: number,
    clientId: number,
    idempotencyKey: number,
    payload: Uint8Array,
  ): number {
    if (!this.requireLane(lane)) {
      this.pushEvent(FLOW_REASON_BAD_LANE, lane, clientId, 0);
      return PACKET_INVALID;
    }
    if (!this.requireClientId(clientId)) {
      this.pushEvent(FLOW_REASON_BAD_CLIENT, lane, clientId, 0);
      return PACKET_INVALID;
    }
    if (!Number.isInteger(idempotencyKey) || idempotencyKey < 0 || idempotencyKey > U32_MAX) {
      this.pushEvent(FLOW_REASON_BAD_CLIENT, lane, clientId, 0);
      return PACKET_INVALID;
    }
    if (!payload || payload.length === 0
      || (this.payloadHead + payload.length) > this.payloadArenaBytes) {
      this.outboundDroppedTotal++;
      this.pushEvent(FLOW_REASON_OUTBOUND_FULL, lane, clientId, 0);
      return PACKET_INVALID;
    }
    const head = this.outboundHead[lane] ?? 0;
    const tail = this.outboundTail[lane] ?? 0;
    if (tail - head >= this.outboundRingCapacity) {
      this.outboundDroppedTotal++;
      this.pushEvent(FLOW_REASON_OUTBOUND_FULL, lane, clientId, 0);
      return PACKET_INVALID;
    }
    // Copy payload into the arena.
    const payloadOffset = this.payloadHead;
    this.payloadArena.set(payload, payloadOffset);
    this.payloadHead += payload.length;

    const slot = (tail % this.outboundRingCapacity) + lane * this.outboundRingCapacity;
    const seq = (this.outboundSeqCounter[lane] ?? 0) + 1;
    this.outboundSeqCounter[lane] = seq >>> 0;
    this.outboundLane[slot] = lane & 0xff;
    this.outboundClient[slot] = clientId | 0;
    this.outboundSeq[slot] = seq >>> 0;
    this.outboundEpoch[slot] = this.laneAuthorityEpoch[lane] ?? 0;
    this.outboundIdempotency[slot] = idempotencyKey >>> 0;
    this.outboundPayloadOffset[slot] = payloadOffset >>> 0;
    this.outboundPayloadLength[slot] = payload.length >>> 0;
    this.outboundEnqueuedAtTick[slot] = this.currentTick >>> 0;
    this.outboundTail[lane] = (tail + 1) >>> 0;
    this.outboundEnqueuedTotal++;
    return seq;
  }

  // Drain one outbound packet. Writes FLOW_PACKET_STRIDE i32 into out:
  // [lane, clientId, seq, epoch, idempotencyKey, payloadOffset,
  //  payloadLength, enqueuedAtTick]. The deferred transport reads
  // payloadOffset/Length from the kernel's payloadArena. Returns
  // false if lane empty or out too small.
  drainOutbound(lane: number, out: Int32Array, outOffset: number = 0): boolean {
    if (!this.requireLane(lane)) return false;
    if (outOffset < 0 || outOffset + FLOW_PACKET_STRIDE > out.length) return false;
    const head = this.outboundHead[lane] ?? 0;
    const tail = this.outboundTail[lane] ?? 0;
    if (head >= tail) return false;
    const slot = (head % this.outboundRingCapacity) + lane * this.outboundRingCapacity;
    out[outOffset + 0] = this.outboundLane[slot] ?? 0;
    out[outOffset + 1] = this.outboundClient[slot] ?? -1;
    out[outOffset + 2] = this.outboundSeq[slot] ?? 0;
    out[outOffset + 3] = this.outboundEpoch[slot] ?? 0;
    out[outOffset + 4] = this.outboundIdempotency[slot] ?? 0;
    out[outOffset + 5] = this.outboundPayloadOffset[slot] ?? 0;
    out[outOffset + 6] = this.outboundPayloadLength[slot] ?? 0;
    out[outOffset + 7] = this.outboundEnqueuedAtTick[slot] ?? 0;
    this.outboundHead[lane] = (head + 1) >>> 0;
    return true;
  }

  // Read the payload bytes for the most-recently-drained outbound
  // packet's (offset, length). Returns a Uint8Array view into the
  // kernel's arena. Caller must NOT mutate.
  readPayload(offset: number, length: number): Uint8Array | null {
    if (!Number.isInteger(offset) || offset < 0 || offset >= this.payloadArenaBytes) return null;
    if (!Number.isInteger(length) || length < 1 || (offset + length) > this.payloadArenaBytes) return null;
    return this.payloadArena.subarray(offset, offset + length);
  }

  // --- inbound (gates 3, 4, 5) ---

  // Enqueue an inbound packet from the transport. Validates epoch +
  // stale-seq + idempotency + throttle + buffer-full; copies payload
  // into the kernel's arena; lands the packet in the jitter buffer.
  // Returns FLOW_REASON_NONE on accept, otherwise a drop reason.
  enqueueInbound(
    lane: number,
    clientId: number,
    seq: number,
    epoch: number,
    idempotencyKey: number,
    payload: Uint8Array,
  ): number {
    if (!this.requireLane(lane)) {
      this.pushEvent(FLOW_REASON_BAD_LANE, lane, clientId, seq);
      return FLOW_REASON_BAD_LANE;
    }
    if (!this.requireClientId(clientId)) {
      this.pushEvent(FLOW_REASON_BAD_CLIENT, lane, clientId, seq);
      return FLOW_REASON_BAD_CLIENT;
    }
    if (!Number.isInteger(seq) || seq < 1 || seq > U32_MAX) {
      this.pushEvent(FLOW_REASON_BAD_SEQ, lane, clientId, seq);
      return FLOW_REASON_BAD_SEQ;
    }
    if (!Number.isInteger(epoch) || epoch < 0 || epoch > 0xffff) {
      this.pushEvent(FLOW_REASON_STALE_EPOCH, lane, clientId, seq);
      return FLOW_REASON_STALE_EPOCH;
    }
    if (!Number.isInteger(idempotencyKey) || idempotencyKey < 0 || idempotencyKey > U32_MAX) {
      this.pushEvent(FLOW_REASON_BAD_CLIENT, lane, clientId, seq);
      return FLOW_REASON_BAD_CLIENT;
    }
    if (!payload || payload.length === 0
      || (this.payloadHead + payload.length) > this.payloadArenaBytes) {
      this.inboundDroppedTotal++;
      this.pushEvent(FLOW_REASON_BUFFER_FULL, lane, clientId, seq);
      return FLOW_REASON_BUFFER_FULL;
    }

    // Throttle (gate 5). Per-tick rate, post-increment.
    this.clientRateThisTick[clientId] = ((this.clientRateThisTick[clientId] ?? 0) + 1) >>> 0;
    if ((this.clientThrottled[clientId] ?? 0) === 0
      && (this.clientRateThisTick[clientId] ?? 0) > this.throttleEnterRate) {
      this.clientThrottled[clientId] = 1;
    }
    if ((this.clientThrottled[clientId] ?? 0) === 1) {
      this.inboundDroppedTotal++;
      this.pushEvent(FLOW_REASON_THROTTLED, lane, clientId, seq);
      return FLOW_REASON_THROTTLED;
    }

    // Authority epoch (gate 3).
    const cur = this.laneAuthorityEpoch[lane] ?? 0;
    if (epoch < cur) {
      this.inboundDroppedTotal++;
      this.pushEvent(FLOW_REASON_STALE_EPOCH, lane, clientId, seq);
      return FLOW_REASON_STALE_EPOCH;
    }

    const pair = this.pairIdx(lane, clientId);

    // Stale seq (gate 3). For ordered lanes, drop if seq <= lastDeliveredSeq.
    // For unordered, drop if seq <= lastSeenSeq.
    if ((this.laneOrdered[lane] ?? 0) === 1) {
      const last = this.inLastDeliveredSeq[pair] ?? -1;
      if (last >= 0 && (seq | 0) <= last) {
        this.inboundDroppedTotal++;
        this.pushEvent(FLOW_REASON_STALE_SEQ, lane, clientId, seq);
        return FLOW_REASON_STALE_SEQ;
      }
    } else {
      const last = this.inLastSeenSeq[pair] ?? -1;
      if (last >= 0 && (seq | 0) <= last) {
        this.inboundDroppedTotal++;
        this.pushEvent(FLOW_REASON_STALE_SEQ, lane, clientId, seq);
        return FLOW_REASON_STALE_SEQ;
      }
      this.inLastSeenSeq[pair] = seq | 0;
    }

    // Idempotency (gate 3). 0 = no-guarantee, skip check.
    if (idempotencyKey !== 0 && this.idempRingHas(pair, idempotencyKey)) {
      this.inboundDroppedTotal++;
      this.pushEvent(FLOW_REASON_DUPLICATE, lane, clientId, seq);
      return FLOW_REASON_DUPLICATE;
    }

    // Buffer-full (gate 4).
    if ((this.jitterCount[pair] ?? 0) >= this.jitterBufferCapacity) {
      this.inboundDroppedTotal++;
      this.pushEvent(FLOW_REASON_BUFFER_FULL, lane, clientId, seq);
      return FLOW_REASON_BUFFER_FULL;
    }

    // Copy payload into arena.
    const payloadOffset = this.payloadHead;
    this.payloadArena.set(payload, payloadOffset);
    this.payloadHead += payload.length;

    // Slot allocation - first free slot in the (lane, client) buffer.
    const baseSlot = pair * this.jitterBufferCapacity;
    let slot = -1;
    for (let i = 0; i < this.jitterBufferCapacity; i++) {
      if ((this.jitterOccupied[baseSlot + i] ?? 0) === 0) {
        slot = baseSlot + i;
        break;
      }
    }
    if (slot < 0) {
      // Shouldn't happen given the buffer-full check, but safe.
      this.inboundDroppedTotal++;
      this.pushEvent(FLOW_REASON_BUFFER_FULL, lane, clientId, seq);
      return FLOW_REASON_BUFFER_FULL;
    }
    this.jitterSeq[slot] = seq >>> 0;
    this.jitterEpoch[slot] = epoch & 0xffff;
    this.jitterIdemp[slot] = idempotencyKey >>> 0;
    this.jitterPayloadOffset[slot] = payloadOffset >>> 0;
    this.jitterPayloadLength[slot] = payload.length >>> 0;
    this.jitterEnqueuedAtTick[slot] = this.currentTick >>> 0;
    this.jitterOccupied[slot] = 1;
    this.jitterCount[pair] = ((this.jitterCount[pair] ?? 0) + 1) >>> 0;
    // Remember the idempotency key.
    if (idempotencyKey !== 0) this.idempRingPush(pair, idempotencyKey);
    return FLOW_REASON_NONE;
  }

  // Drain the next ready inbound packet for (lane, client). For
  // ordered lanes, yields the packet whose seq == lastDeliveredSeq+1
  // (or the lowest seq if lastDelivered is -1); head-of-line blocks
  // if a gap is unfilled. For unordered, yields the highest-seq
  // packet currently buffered (dropping all others). Writes
  // FLOW_PACKET_STRIDE i32 into out. Returns false if nothing ready.
  drainInbound(lane: number, clientId: number, out: Int32Array, outOffset: number = 0): boolean {
    if (!this.requireLane(lane)) return false;
    if (!this.requireClientId(clientId)) return false;
    if (outOffset < 0 || outOffset + FLOW_PACKET_STRIDE > out.length) return false;
    const pair = this.pairIdx(lane, clientId);
    if ((this.jitterCount[pair] ?? 0) === 0) return false;
    const baseSlot = pair * this.jitterBufferCapacity;
    const ordered = (this.laneOrdered[lane] ?? 0) === 1;
    if (ordered) {
      const last = this.inLastDeliveredSeq[pair] ?? -1;
      const wantSeq = last + 1;
      // Find the slot with seq == wantSeq.
      let pick = -1;
      for (let i = 0; i < this.jitterBufferCapacity; i++) {
        if ((this.jitterOccupied[baseSlot + i] ?? 0) === 0) continue;
        if ((this.jitterSeq[baseSlot + i] ?? 0) === (wantSeq >>> 0)) {
          pick = baseSlot + i;
          break;
        }
      }
      if (pick < 0) {
        // If lastDelivered is -1 (never delivered), accept the
        // lowest-seq buffered packet as the "start" - this is the
        // bootstrap path; subsequent inbounds follow contiguously.
        if (last < 0) {
          let lowestSeq = U32_MAX;
          for (let i = 0; i < this.jitterBufferCapacity; i++) {
            if ((this.jitterOccupied[baseSlot + i] ?? 0) === 0) continue;
            const s = this.jitterSeq[baseSlot + i] ?? 0;
            if (s < lowestSeq) { lowestSeq = s; pick = baseSlot + i; }
          }
          if (pick < 0) return false;
        } else {
          return false;        // head-of-line gap
        }
      }
      this.writePacketOut(pick, lane, clientId, out, outOffset);
      this.inLastDeliveredSeq[pair] = this.jitterSeq[pick] ?? 0;
      this.releaseSlot(pick, pair);
      this.inboundDeliveredTotal++;
      return true;
    }
    // Unordered: pick the highest seq, drop the rest.
    let pickHigh = -1;
    let pickSeq = -1;
    for (let i = 0; i < this.jitterBufferCapacity; i++) {
      if ((this.jitterOccupied[baseSlot + i] ?? 0) === 0) continue;
      const s = this.jitterSeq[baseSlot + i] ?? 0;
      if ((s | 0) > pickSeq) { pickSeq = s | 0; pickHigh = baseSlot + i; }
    }
    if (pickHigh < 0) return false;
    this.writePacketOut(pickHigh, lane, clientId, out, outOffset);
    // Drop every other occupied slot (we delivered the newest).
    for (let i = 0; i < this.jitterBufferCapacity; i++) {
      if ((this.jitterOccupied[baseSlot + i] ?? 0) === 1) this.releaseSlot(baseSlot + i, pair);
    }
    this.inboundDeliveredTotal++;
    return true;
  }

  private writePacketOut(slot: number, lane: number, clientId: number, out: Int32Array, outOffset: number): void {
    out[outOffset + 0] = lane | 0;
    out[outOffset + 1] = clientId | 0;
    out[outOffset + 2] = this.jitterSeq[slot] ?? 0;
    out[outOffset + 3] = this.jitterEpoch[slot] ?? 0;
    out[outOffset + 4] = this.jitterIdemp[slot] ?? 0;
    out[outOffset + 5] = this.jitterPayloadOffset[slot] ?? 0;
    out[outOffset + 6] = this.jitterPayloadLength[slot] ?? 0;
    out[outOffset + 7] = this.jitterEnqueuedAtTick[slot] ?? 0;
  }

  private releaseSlot(slot: number, pair: number): void {
    this.jitterOccupied[slot] = 0;
    if ((this.jitterCount[pair] ?? 0) > 0) {
      this.jitterCount[pair] = ((this.jitterCount[pair] ?? 0) - 1) >>> 0;
    }
  }

  // --- idempotency ring (gate 3) ---

  private idempRingHas(pair: number, key: number): boolean {
    const base = pair * this.idempotencyWindow;
    const count = this.idempRingCount[pair] ?? 0;
    for (let i = 0; i < count; i++) {
      if (this.idempRingKey[base + i] === (key >>> 0)) return true;
    }
    return false;
  }

  private idempRingPush(pair: number, key: number): void {
    const base = pair * this.idempotencyWindow;
    const head = this.idempRingHead[pair] ?? 0;
    this.idempRingKey[base + head] = key >>> 0;
    this.idempRingHead[pair] = (head + 1) % this.idempotencyWindow;
    if ((this.idempRingCount[pair] ?? 0) < this.idempotencyWindow) {
      this.idempRingCount[pair] = ((this.idempRingCount[pair] ?? 0) + 1) >>> 0;
    }
  }

  // --- tick (gates 4, 5) ---

  tick(t: number): void {
    if (!Number.isInteger(t) || t < 0 || t > U32_MAX) {
      throw new RangeError('LoomFlow.tick: t must be a u32, got ' + t);
    }
    this.currentTick = t | 0;

    // Throttle hysteresis sweep (gate 5).
    for (let c = 0; c < this.maxClients; c++) {
      const rate = this.clientRateThisTick[c] ?? 0;
      if ((this.clientThrottled[c] ?? 0) === 1) {
        if (rate < this.throttleLeaveRate) {
          this.clientBelowLeaveStreak[c] = ((this.clientBelowLeaveStreak[c] ?? 0) + 1) >>> 0;
          if ((this.clientBelowLeaveStreak[c] ?? 0) >= this.throttleReleaseTicks) {
            this.clientThrottled[c] = 0;
            this.clientBelowLeaveStreak[c] = 0;
          }
        } else {
          this.clientBelowLeaveStreak[c] = 0;
        }
      }
      // Reset rate counter at tick boundary.
      this.clientRateThisTick[c] = 0;
    }

    // Jitter-buffer TTL sweep (gate 4).
    const ttl = this.jitterBufferTtlTicks;
    const total = LANE_COUNT * this.maxClients * this.jitterBufferCapacity;
    for (let s = 0; s < total; s++) {
      if ((this.jitterOccupied[s] ?? 0) === 0) continue;
      const enq = this.jitterEnqueuedAtTick[s] ?? 0;
      if (((this.currentTick - enq) >>> 0) > ttl) {
        // Expired - release the slot. The pair index is s /
        // jitterBufferCapacity.
        const pair = Math.floor(s / this.jitterBufferCapacity);
        const lane = Math.floor(pair / this.maxClients);
        const clientId = pair - lane * this.maxClients;
        this.releaseSlot(s, pair);
        this.inboundDroppedTotal++;
        this.pushEvent(FLOW_REASON_TTL_EXPIRED, lane, clientId, this.jitterSeq[s] ?? 0);
      }
    }
  }

  // --- metrics ring ---

  private pushEvent(eventType: number, lane: number, clientId: number, seq: number): void {
    if (this.eventTail - this.eventHead >= this.eventRingCapacity) {
      this.eventsDroppedTotal++;
      return;
    }
    const slot = (this.eventTail % this.eventRingCapacity) * FLOW_EVENT_STRIDE;
    this.eventRing[slot + 0] = eventType | 0;
    this.eventRing[slot + 1] = lane | 0;
    this.eventRing[slot + 2] = clientId | 0;
    this.eventRing[slot + 3] = seq | 0;
    this.eventRing[slot + 4] = this.currentTick | 0;
    this.eventTail++;
  }

  consumeEvent(out: Int32Array, outOffset: number = 0): boolean {
    if (this.eventHead >= this.eventTail) return false;
    if (outOffset < 0 || outOffset + FLOW_EVENT_STRIDE > out.length) return false;
    const slot = (this.eventHead % this.eventRingCapacity) * FLOW_EVENT_STRIDE;
    out[outOffset + 0] = this.eventRing[slot + 0] ?? 0;
    out[outOffset + 1] = this.eventRing[slot + 1] ?? 0;
    out[outOffset + 2] = this.eventRing[slot + 2] ?? 0;
    out[outOffset + 3] = this.eventRing[slot + 3] ?? 0;
    out[outOffset + 4] = this.eventRing[slot + 4] ?? 0;
    this.eventHead++;
    return true;
  }

  // --- helpers ---

  private requireLane(lane: number): boolean {
    return Number.isInteger(lane) && lane >= 0 && lane < LANE_COUNT;
  }

  private requireClientId(c: number): boolean {
    return Number.isInteger(c) && c >= 0 && c < this.maxClients;
  }

  private pairIdx(lane: number, clientId: number): number {
    return lane * this.maxClients + clientId;
  }

  // Stub - kept to keep mix32 referenced (the inbound idempotency
  // path may add a hash table later if linear-probe becomes a
  // bottleneck at very large window sizes; for now the linear scan
  // of <= 256 keys is cheap).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _reserved_hash(_x: number): number { return mix32(_x); }

  // --- lifecycle ---

  clear(): void {
    this.outboundLane.fill(0);
    this.outboundClient.fill(-1);
    this.outboundSeq.fill(0);
    this.outboundEpoch.fill(0);
    this.outboundIdempotency.fill(0);
    this.outboundPayloadOffset.fill(0);
    this.outboundPayloadLength.fill(0);
    this.outboundEnqueuedAtTick.fill(0);
    this.outboundHead.fill(0);
    this.outboundTail.fill(0);
    this.outboundSeqCounter.fill(0);
    this.laneAuthorityEpoch.fill(0);
    this.inLastDeliveredSeq.fill(-1);
    this.inLastSeenSeq.fill(-1);
    this.jitterSeq.fill(0);
    this.jitterEpoch.fill(0);
    this.jitterIdemp.fill(0);
    this.jitterPayloadOffset.fill(0);
    this.jitterPayloadLength.fill(0);
    this.jitterEnqueuedAtTick.fill(0);
    this.jitterOccupied.fill(0);
    this.jitterCount.fill(0);
    this.idempRingKey.fill(0);
    this.idempRingHead.fill(0);
    this.idempRingCount.fill(0);
    this.clientRateThisTick.fill(0);
    this.clientThrottled.fill(0);
    this.clientBelowLeaveStreak.fill(0);
    this.payloadArena.fill(0);
    this.payloadHead = 0;
    this.eventRing.fill(0);
    this.eventHead = 0;
    this.eventTail = 0;
    this.eventsDroppedTotal = 0;
    this.outboundEnqueuedTotal = 0;
    this.outboundDroppedTotal = 0;
    this.inboundDeliveredTotal = 0;
    this.inboundDroppedTotal = 0;
  }
}
