// LoomFlow - Trinity §20 adaptive-network packet router tests.
//
// Covers: constructor validation (including the throttle-leave <
// throttle-enter hysteresis invariant), every Codex gate (per-lane
// integer split with ordered/reliable config, transport profile
// selection from a capability bitset, per-lane sequence numbers +
// idempotency + authority epochs + stale rejection, jitter buffer
// capacity + TTL late-packet drop, per-client throttle hysteresis,
// WebTransport > WebRTC > WebSocket fallback), and bit-for-bit
// determinism across two independent runs.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  LoomFlow,
  pickTransport,
  LANE_UNRELIABLE_MOVEMENT,
  LANE_RELIABLE_COMBAT,
  LANE_RELIABLE_ECONOMY,
  TRANSPORT_WEBTRANSPORT,
  TRANSPORT_WEBRTC,
  TRANSPORT_WEBSOCKET,
  TRANSPORT_INVALID,
  FLOW_CAP_WEBTRANSPORT,
  FLOW_CAP_WEBRTC,
  FLOW_CAP_WEBSOCKET,
  FLOW_REASON_NONE,
  FLOW_REASON_STALE_SEQ,
  FLOW_REASON_STALE_EPOCH,
  FLOW_REASON_DUPLICATE,
  FLOW_REASON_THROTTLED,
  FLOW_REASON_BUFFER_FULL,
  FLOW_REASON_TTL_EXPIRED,
  PACKET_INVALID,
  FLOW_EVENT_STRIDE,
  FLOW_PACKET_STRIDE,
} from '../src/runtime/loom-flow.js';

function defaultConfig() {
  return {
    maxClients: 16,
    outboundRingCapacity: 64,
    jitterBufferCapacity: 8,
    jitterBufferTtlTicks: 30,
    payloadArenaBytes: 64 * 1024,
    throttleEnterRate: 100,
    throttleLeaveRate: 50,
    throttleReleaseTicks: 3,
    idempotencyWindow: 16,
    eventRingCapacity: 64,
    capabilities: FLOW_CAP_WEBTRANSPORT | FLOW_CAP_WEBRTC | FLOW_CAP_WEBSOCKET,
  };
}

function bytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = i & 0xff;
  return out;
}

test('LoomFlow: constructor rejects invalid maxClients / capacities', () => {
  assert.throws(() => new LoomFlow({ ...defaultConfig(), maxClients: 0 }), RangeError);
  assert.throws(() => new LoomFlow({ ...defaultConfig(), outboundRingCapacity: 0 }), RangeError);
  assert.throws(() => new LoomFlow({ ...defaultConfig(), jitterBufferCapacity: 0 }), RangeError);
});

test('LoomFlow: constructor rejects throttleLeaveRate >= throttleEnterRate (hysteresis invariant - gate 5)', () => {
  assert.throws(() => new LoomFlow({
    ...defaultConfig(),
    throttleEnterRate: 100,
    throttleLeaveRate: 100,
  }), RangeError);
  assert.throws(() => new LoomFlow({
    ...defaultConfig(),
    throttleEnterRate: 50,
    throttleLeaveRate: 60,
  }), RangeError);
});

test('LoomFlow: pickTransport - WebTransport wins when present (gate 6)', () => {
  assert.equal(pickTransport(FLOW_CAP_WEBTRANSPORT | FLOW_CAP_WEBRTC | FLOW_CAP_WEBSOCKET), TRANSPORT_WEBTRANSPORT);
});

test('LoomFlow: pickTransport - WebRTC fallback when no WebTransport (gate 6)', () => {
  assert.equal(pickTransport(FLOW_CAP_WEBRTC | FLOW_CAP_WEBSOCKET), TRANSPORT_WEBRTC);
});

test('LoomFlow: pickTransport - WebSocket fallback when only WebSocket (gate 6)', () => {
  assert.equal(pickTransport(FLOW_CAP_WEBSOCKET), TRANSPORT_WEBSOCKET);
});

test('LoomFlow: pickTransport - INVALID when no capabilities (gate 6)', () => {
  assert.equal(pickTransport(0), TRANSPORT_INVALID);
});

test('LoomFlow: setCapabilities re-picks transport (gate 6)', () => {
  const f = new LoomFlow({ ...defaultConfig(), capabilities: 0 });
  assert.equal(f.getSelectedTransport(), TRANSPORT_INVALID);
  f.setCapabilities(FLOW_CAP_WEBSOCKET);
  assert.equal(f.getSelectedTransport(), TRANSPORT_WEBSOCKET);
  f.setCapabilities(FLOW_CAP_WEBTRANSPORT | FLOW_CAP_WEBSOCKET);
  assert.equal(f.getSelectedTransport(), TRANSPORT_WEBTRANSPORT);
});

test('LoomFlow: lane config exposes ordered/reliable per lane (gate 1, 2)', () => {
  const f = new LoomFlow(defaultConfig());
  assert.equal(f.getLaneOrdered(LANE_UNRELIABLE_MOVEMENT), 0);
  assert.equal(f.getLaneReliable(LANE_UNRELIABLE_MOVEMENT), 0);
  assert.equal(f.getLaneOrdered(LANE_RELIABLE_COMBAT), 1);
  assert.equal(f.getLaneReliable(LANE_RELIABLE_COMBAT), 1);
  assert.equal(f.getLaneOrdered(LANE_RELIABLE_ECONOMY), 1);
  assert.equal(f.getLaneReliable(LANE_RELIABLE_ECONOMY), 1);
});

test('LoomFlow: enqueueOutbound assigns sequential seq + current epoch (gate 3)', () => {
  const f = new LoomFlow(defaultConfig());
  const a = f.enqueueOutbound(LANE_RELIABLE_COMBAT, 1, 100, bytes(10));
  const b = f.enqueueOutbound(LANE_RELIABLE_COMBAT, 1, 101, bytes(10));
  assert.equal(a, 1);
  assert.equal(b, 2);
  // Per-lane seq is independent.
  const e = f.enqueueOutbound(LANE_RELIABLE_ECONOMY, 1, 200, bytes(10));
  assert.equal(e, 1);
});

test('LoomFlow: drainOutbound yields packets in FIFO with epoch + idempotency (gate 3)', () => {
  const f = new LoomFlow(defaultConfig());
  f.rotateAuthorityEpoch(LANE_RELIABLE_COMBAT);     // bump to epoch 1
  f.enqueueOutbound(LANE_RELIABLE_COMBAT, 7, 999, bytes(5));
  const out = new Int32Array(FLOW_PACKET_STRIDE);
  assert.equal(f.drainOutbound(LANE_RELIABLE_COMBAT, out), true);
  assert.equal(out[0], LANE_RELIABLE_COMBAT);
  assert.equal(out[1], 7);          // clientId
  assert.equal(out[2], 1);          // seq
  assert.equal(out[3], 1);          // epoch (post-rotate)
  assert.equal(out[4], 999);        // idempotency
});

test('LoomFlow: enqueueOutbound drops past outbound ring capacity', () => {
  const f = new LoomFlow({ ...defaultConfig(), outboundRingCapacity: 2 });
  f.enqueueOutbound(LANE_RELIABLE_COMBAT, 1, 1, bytes(5));
  f.enqueueOutbound(LANE_RELIABLE_COMBAT, 1, 2, bytes(5));
  assert.equal(f.enqueueOutbound(LANE_RELIABLE_COMBAT, 1, 3, bytes(5)), PACKET_INVALID);
  assert.equal(f.getOutboundDroppedTotal(), 1);
});

test('LoomFlow: enqueueInbound rejects stale seq (gate 3 - ordered lane)', () => {
  const f = new LoomFlow(defaultConfig());
  // Ordered lane - deliver seq 1, then try seq 1 again.
  assert.equal(f.enqueueInbound(LANE_RELIABLE_COMBAT, 1, 1, 0, 0, bytes(5)), FLOW_REASON_NONE);
  const out = new Int32Array(FLOW_PACKET_STRIDE);
  assert.equal(f.drainInbound(LANE_RELIABLE_COMBAT, 1, out), true);
  assert.equal(f.enqueueInbound(LANE_RELIABLE_COMBAT, 1, 1, 0, 0, bytes(5)), FLOW_REASON_STALE_SEQ);
});

test('LoomFlow: enqueueInbound rejects stale epoch (gate 3 - rollback safety)', () => {
  const f = new LoomFlow(defaultConfig());
  f.rotateAuthorityEpoch(LANE_RELIABLE_COMBAT);     // current = 1
  f.rotateAuthorityEpoch(LANE_RELIABLE_COMBAT);     // current = 2
  // Inbound carrying epoch 1 - rejected.
  assert.equal(f.enqueueInbound(LANE_RELIABLE_COMBAT, 1, 1, 1, 0, bytes(5)), FLOW_REASON_STALE_EPOCH);
});

test('LoomFlow: enqueueInbound rejects duplicate idempotency key (gate 3)', () => {
  const f = new LoomFlow(defaultConfig());
  assert.equal(f.enqueueInbound(LANE_RELIABLE_COMBAT, 1, 1, 0, 12345, bytes(5)), FLOW_REASON_NONE);
  // Same idempotency, different seq - dropped.
  assert.equal(f.enqueueInbound(LANE_RELIABLE_COMBAT, 1, 2, 0, 12345, bytes(5)), FLOW_REASON_DUPLICATE);
});

test('LoomFlow: ordered lane delivers in-order; head-of-line blocks on gap (gate 4)', () => {
  const f = new LoomFlow(defaultConfig());
  // Send seq 2 first, then seq 1.
  f.enqueueInbound(LANE_RELIABLE_COMBAT, 1, 2, 0, 0, bytes(5));
  const out = new Int32Array(FLOW_PACKET_STRIDE);
  // First drain - bootstrap path picks lowest-seq buffered (seq=2) since
  // lastDelivered is -1 (first packet).
  assert.equal(f.drainInbound(LANE_RELIABLE_COMBAT, 1, out), true);
  assert.equal(out[2], 2);     // seq=2 delivered as bootstrap
  // Now lastDelivered=2; seq=3 is the next expected.
  // Buffer seq=4 - drain blocks (no seq=3).
  f.enqueueInbound(LANE_RELIABLE_COMBAT, 1, 4, 0, 0, bytes(5));
  assert.equal(f.drainInbound(LANE_RELIABLE_COMBAT, 1, out), false);
  // Buffer seq=3 - now seq=3 delivers, then seq=4.
  f.enqueueInbound(LANE_RELIABLE_COMBAT, 1, 3, 0, 0, bytes(5));
  assert.equal(f.drainInbound(LANE_RELIABLE_COMBAT, 1, out), true);
  assert.equal(out[2], 3);
  assert.equal(f.drainInbound(LANE_RELIABLE_COMBAT, 1, out), true);
  assert.equal(out[2], 4);
});

test('LoomFlow: unordered lane delivers newest, drops older (gate 1, 4)', () => {
  const f = new LoomFlow(defaultConfig());
  f.enqueueInbound(LANE_UNRELIABLE_MOVEMENT, 1, 5, 0, 0, bytes(5));
  f.enqueueInbound(LANE_UNRELIABLE_MOVEMENT, 1, 7, 0, 0, bytes(5));
  f.enqueueInbound(LANE_UNRELIABLE_MOVEMENT, 1, 6, 0, 0, bytes(5));
  const out = new Int32Array(FLOW_PACKET_STRIDE);
  assert.equal(f.drainInbound(LANE_UNRELIABLE_MOVEMENT, 1, out), true);
  assert.equal(out[2], 7);    // newest seq
  // Buffer should now be empty (older were dropped on delivery).
  assert.equal(f.drainInbound(LANE_UNRELIABLE_MOVEMENT, 1, out), false);
});

test('LoomFlow: jitter buffer drops past capacity (gate 4)', () => {
  const f = new LoomFlow({ ...defaultConfig(), jitterBufferCapacity: 2 });
  assert.equal(f.enqueueInbound(LANE_RELIABLE_COMBAT, 1, 1, 0, 0, bytes(5)), FLOW_REASON_NONE);
  assert.equal(f.enqueueInbound(LANE_RELIABLE_COMBAT, 1, 2, 0, 0, bytes(5)), FLOW_REASON_NONE);
  // Buffer full - third packet rejected.
  assert.equal(f.enqueueInbound(LANE_RELIABLE_COMBAT, 1, 3, 0, 0, bytes(5)), FLOW_REASON_BUFFER_FULL);
});

test('LoomFlow: tick() drops packets past TTL (gate 4 late-packet policy)', () => {
  const f = new LoomFlow({ ...defaultConfig(), jitterBufferTtlTicks: 5 });
  f.enqueueInbound(LANE_RELIABLE_COMBAT, 1, 1, 0, 0, bytes(5));
  assert.equal(f.getInboundBufferCount(LANE_RELIABLE_COMBAT, 1), 1);
  // Tick well past TTL.
  f.tick(20);
  assert.equal(f.getInboundBufferCount(LANE_RELIABLE_COMBAT, 1), 0);
  // Drop event for TTL_EXPIRED.
  const out = new Int32Array(FLOW_EVENT_STRIDE);
  // Drain the last event (the TTL drop).
  let lastReason = -1;
  while (f.consumeEvent(out)) lastReason = out[0] ?? -1;
  assert.equal(lastReason, FLOW_REASON_TTL_EXPIRED);
});

test('LoomFlow: per-client throttle activates past throttleEnterRate (gate 5)', () => {
  const f = new LoomFlow({ ...defaultConfig(), throttleEnterRate: 3, throttleLeaveRate: 1, throttleReleaseTicks: 2,
    jitterBufferCapacity: 16 });
  // 4 inbound packets - the 4th puts the client over the rate (3+1).
  for (let s = 1; s <= 4; s++) {
    f.enqueueInbound(LANE_RELIABLE_COMBAT, 1, s, 0, 0, bytes(5));
  }
  assert.equal(f.isClientThrottled(1), true);
  // Subsequent submit drops with REASON_THROTTLED.
  assert.equal(f.enqueueInbound(LANE_RELIABLE_COMBAT, 1, 5, 0, 0, bytes(5)), FLOW_REASON_THROTTLED);
});

test('LoomFlow: throttle releases after throttleReleaseTicks below leave-rate (gate 5 hysteresis)', () => {
  const f = new LoomFlow({ ...defaultConfig(), throttleEnterRate: 3, throttleLeaveRate: 1, throttleReleaseTicks: 2,
    jitterBufferCapacity: 16 });
  // Trigger throttle.
  for (let s = 1; s <= 4; s++) f.enqueueInbound(LANE_RELIABLE_COMBAT, 1, s, 0, 0, bytes(5));
  assert.equal(f.isClientThrottled(1), true);
  // tick(1): closes the noisy interval (rate=4, NOT below leave) - streak stays 0.
  f.tick(1);
  assert.equal(f.isClientThrottled(1), true);
  // tick(2): closes first quiet interval (rate=0, below leave) - streak=1, not yet at release.
  f.tick(2);
  assert.equal(f.isClientThrottled(1), true);
  // tick(3): closes second quiet interval - streak=2, hits release.
  f.tick(3);
  assert.equal(f.isClientThrottled(1), false);
});

test('LoomFlow: payload arena round-trips bytes (gate 1)', () => {
  const f = new LoomFlow(defaultConfig());
  const payload = bytes(20);
  f.enqueueOutbound(LANE_RELIABLE_COMBAT, 1, 0, payload);
  const out = new Int32Array(FLOW_PACKET_STRIDE);
  assert.equal(f.drainOutbound(LANE_RELIABLE_COMBAT, out), true);
  const offset = out[5] ?? 0;
  const length = out[6] ?? 0;
  const view = f.readPayload(offset, length);
  assert.ok(view !== null);
  assert.equal(view!.length, 20);
  for (let i = 0; i < 20; i++) assert.equal(view![i], i);
});

test('LoomFlow: deterministic across two independent runs (bit-for-bit)', () => {
  function run(): number[] {
    const f = new LoomFlow(defaultConfig());
    const out: number[] = [];
    for (let i = 0; i < 10; i++) {
      const seq = f.enqueueOutbound(i % 3, i % 16, i + 1000, bytes(8));
      out.push(seq);
    }
    return out;
  }
  assert.deepEqual(run(), run());
});

test('LoomFlow: clear() resets every queue / counter / throttle', () => {
  const f = new LoomFlow(defaultConfig());
  f.enqueueOutbound(LANE_RELIABLE_COMBAT, 1, 99, bytes(5));
  f.enqueueInbound(LANE_RELIABLE_COMBAT, 2, 1, 0, 0, bytes(5));
  f.rotateAuthorityEpoch(LANE_RELIABLE_COMBAT);
  f.clear();
  assert.equal(f.getOutboundQueueCount(LANE_RELIABLE_COMBAT), 0);
  assert.equal(f.getInboundBufferCount(LANE_RELIABLE_COMBAT, 2), 0);
  assert.equal(f.getLaneAuthorityEpoch(LANE_RELIABLE_COMBAT), 0);
  assert.equal(f.getOutboundEnqueuedTotal(), 0);
  assert.equal(f.getInboundDeliveredTotal(), 0);
});

test('LoomFlow: tick rejects out-of-range t', () => {
  const f = new LoomFlow(defaultConfig());
  assert.throws(() => f.tick(-1), RangeError);
  assert.throws(() => f.tick(1.5), RangeError);
  assert.throws(() => f.tick(0x100000000), RangeError);
});

test('LoomFlow: invalid lane / clientId rejected on outbound + inbound', () => {
  const f = new LoomFlow(defaultConfig());
  assert.equal(f.enqueueOutbound(99, 1, 0, bytes(5)), PACKET_INVALID);
  assert.equal(f.enqueueOutbound(LANE_RELIABLE_COMBAT, -1, 0, bytes(5)), PACKET_INVALID);
  assert.equal(f.enqueueInbound(99, 1, 1, 0, 0, bytes(5)), 6);    // FLOW_REASON_BAD_LANE
  assert.equal(f.enqueueInbound(LANE_RELIABLE_COMBAT, 99, 1, 0, 0, bytes(5)), 7);   // FLOW_REASON_BAD_CLIENT
});

test('LoomFlow: drainInbound returns false when buffer empty', () => {
  const f = new LoomFlow(defaultConfig());
  const out = new Int32Array(FLOW_PACKET_STRIDE);
  assert.equal(f.drainInbound(LANE_RELIABLE_COMBAT, 0, out), false);
});

test('LoomFlow: idempotency key 0 is treated as no-guarantee (no dedup)', () => {
  const f = new LoomFlow(defaultConfig());
  assert.equal(f.enqueueInbound(LANE_RELIABLE_COMBAT, 1, 1, 0, 0, bytes(5)), FLOW_REASON_NONE);
  // Same key 0 with different seq - allowed.
  assert.equal(f.enqueueInbound(LANE_RELIABLE_COMBAT, 1, 2, 0, 0, bytes(5)), FLOW_REASON_NONE);
});

test('LoomFlow: drainOutbound writes payload offset/length the consumer can read', () => {
  const f = new LoomFlow(defaultConfig());
  f.enqueueOutbound(LANE_RELIABLE_COMBAT, 1, 100, bytes(7));
  const out = new Int32Array(FLOW_PACKET_STRIDE);
  f.drainOutbound(LANE_RELIABLE_COMBAT, out);
  assert.equal(out[6], 7);
  const view = f.readPayload(out[5] ?? 0, out[6] ?? 0);
  assert.ok(view !== null);
  assert.equal(view!.length, 7);
});

test('LoomFlow: readPayload rejects out-of-range offset/length', () => {
  const f = new LoomFlow({ ...defaultConfig(), payloadArenaBytes: 100 });
  assert.equal(f.readPayload(-1, 5), null);
  assert.equal(f.readPayload(50, 200), null);
  assert.equal(f.readPayload(0, 0), null);
});
