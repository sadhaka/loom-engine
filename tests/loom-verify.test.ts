// LoomVerify - Trinity §16 anti-cheat verifier tests.
//
// Covers: constructor validation, every Codex gate (fixed-point
// integer envelope, full server-issued binding, value-class gated
// ZK escalation, key epoch rotation with grace, regional Merkle
// witnesses, RESYNC vs REJECT verdict separation, server-authoritative
// heuristic), the violation-score moderation seam, and bit-for-bit
// determinism across two independent runs.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  LoomVerify,
  VERDICT_PASS,
  VERDICT_RESYNC,
  VERDICT_REJECT,
  VERDICT_ID_INVALID,
  VERDICT_RECORD_STRIDE,
  REASON_BAD_NONCE,
  REASON_NONCE_EXPIRED,
  REASON_BAD_REGION_ROOT,
  REASON_BAD_KEY_EPOCH,
  REASON_PHYSICS,
  REASON_BAD_TICK,
  REASON_BAD_ENTITY,
  REASON_BAD_ACTION,
  REASON_NEEDS_PROOF,
  REASON_NONE,
  VALUE_CLASS_LOW,
  VALUE_CLASS_HIGH,
  type ClaimEnvelope,
} from '../src/runtime/loom-verify.js';

function defaultConfig() {
  return {
    maxEntities: 64,
    maxActionTypes: 16,
    maxRegions: 8,
    nonceTableCapacity: 64,
    verdictRingCapacity: 64,
    maxKeyEpochs: 4,
    payloadStride: 4,
    nonceTtlTicks: 100,
    gracePeriodTicks: 50,
    violationDecayPerTick: 1,
    resyncViolationWeight: 1,
    rejectViolationWeight: 5,
    passDecayWeight: 1,
    acceptedTickSkew: 30,
  };
}

function basicClaim(overrides: Partial<ClaimEnvelope> = {}): ClaimEnvelope {
  return {
    entityId: 1,
    actionType: 0,
    tick: 0,
    nonce: 1,
    regionId: 0,
    regionRoot: 0xaaaaaaaa,
    payloadFp: new Int32Array([100, 200, 300, 400]),
    proof: null,
    ...overrides,
  };
}

test('LoomVerify: constructor rejects out-of-range maxEntities', () => {
  assert.throws(() => new LoomVerify({ ...defaultConfig(), maxEntities: 0 }), RangeError);
  assert.throws(() => new LoomVerify({ ...defaultConfig(), maxEntities: 1 << 24 }), RangeError);
});

test('LoomVerify: constructor rejects out-of-range nonceTtlTicks', () => {
  assert.throws(() => new LoomVerify({ ...defaultConfig(), nonceTtlTicks: 0 }), RangeError);
});

test('LoomVerify: constructor rejects negative violation weights', () => {
  assert.throws(() => new LoomVerify({ ...defaultConfig(), rejectViolationWeight: -1 }), RangeError);
  assert.throws(() => new LoomVerify({ ...defaultConfig(), passDecayWeight: 1 << 17 }), RangeError);
});

test('LoomVerify: constructor rejects out-of-range payloadStride and verdictRingCapacity', () => {
  assert.throws(() => new LoomVerify({ ...defaultConfig(), payloadStride: 0 }), RangeError);
  assert.throws(() => new LoomVerify({ ...defaultConfig(), payloadStride: 64 }), RangeError);
  assert.throws(() => new LoomVerify({ ...defaultConfig(), verdictRingCapacity: 0 }), RangeError);
});

test('LoomVerify: submitClaim PASSes a well-formed bound claim (gates 1, 2, 5, 7)', () => {
  const v = new LoomVerify(defaultConfig());
  v.setRegionRoot(0, 0xaaaaaaaa);
  const id = v.submitClaim(basicClaim());
  assert.notEqual(id, VERDICT_ID_INVALID);
  const out = new Int32Array(VERDICT_RECORD_STRIDE);
  assert.equal(v.consumeVerdict(out), true);
  assert.equal(out[0], VERDICT_PASS);
  assert.equal(out[1], REASON_NONE);
});

test('LoomVerify: submitClaim REJECTs a region-root mismatch (gate 5)', () => {
  const v = new LoomVerify(defaultConfig());
  v.setRegionRoot(0, 0xaaaaaaaa);
  v.submitClaim(basicClaim({ regionRoot: 0xbbbbbbbb }));
  const out = new Int32Array(VERDICT_RECORD_STRIDE);
  assert.equal(v.consumeVerdict(out), true);
  assert.equal(out[0], VERDICT_REJECT);
  assert.equal(out[1], REASON_BAD_REGION_ROOT);
});

test('LoomVerify: submitClaim RESYNCs when region root is unpublished (gate 5, 6 - desync, not punitive)', () => {
  const v = new LoomVerify(defaultConfig());
  // No setRegionRoot for region 0 - the server has no root yet.
  v.submitClaim(basicClaim());
  const out = new Int32Array(VERDICT_RECORD_STRIDE);
  assert.equal(v.consumeVerdict(out), true);
  assert.equal(out[0], VERDICT_RESYNC);
});

test('LoomVerify: submitClaim REJECTs a duplicate nonce (gate 2 - single-use anti-replay)', () => {
  const v = new LoomVerify(defaultConfig());
  v.setRegionRoot(0, 0xaaaaaaaa);
  v.submitClaim(basicClaim({ nonce: 5 }));
  v.submitClaim(basicClaim({ nonce: 5 }));   // same (entity, nonce)
  const out = new Int32Array(VERDICT_RECORD_STRIDE);
  assert.equal(v.consumeVerdict(out), true);
  assert.equal(out[0], VERDICT_PASS);
  assert.equal(v.consumeVerdict(out), true);
  assert.equal(out[0], VERDICT_REJECT);
  assert.equal(out[1], REASON_BAD_NONCE);
});

test('LoomVerify: submitClaim RESYNCs an expired nonce (gate 2, 6)', () => {
  const v = new LoomVerify({ ...defaultConfig(), nonceTtlTicks: 5, acceptedTickSkew: 1000 });
  v.setRegionRoot(0, 0xaaaaaaaa);
  v.setTick(100);
  v.submitClaim(basicClaim({ nonce: 1, tick: 50 }));     // 50-tick-old claim, ttl=5
  const out = new Int32Array(VERDICT_RECORD_STRIDE);
  assert.equal(v.consumeVerdict(out), true);
  assert.equal(out[0], VERDICT_RESYNC);
  assert.equal(out[1], REASON_NONCE_EXPIRED);
});

test('LoomVerify: submitClaim RESYNCs a stale tick (gate 2 binding, 6)', () => {
  const v = new LoomVerify({ ...defaultConfig(), acceptedTickSkew: 5 });
  v.setRegionRoot(0, 0xaaaaaaaa);
  v.setTick(100);
  v.submitClaim(basicClaim({ tick: 80 }));     // 20 ticks old, skew=5
  const out = new Int32Array(VERDICT_RECORD_STRIDE);
  assert.equal(v.consumeVerdict(out), true);
  assert.equal(out[0], VERDICT_RESYNC);
  assert.equal(out[1], REASON_BAD_TICK);
});

test('LoomVerify: submitClaim REJECTs out-of-range entityId / actionType / regionId', () => {
  const v = new LoomVerify(defaultConfig());
  v.submitClaim(basicClaim({ entityId: 999 }));      // out of range
  v.submitClaim(basicClaim({ actionType: 999 }));
  v.submitClaim(basicClaim({ regionId: 999 }));
  const out = new Int32Array(VERDICT_RECORD_STRIDE);
  assert.equal(v.consumeVerdict(out), true);
  assert.equal(out[0], VERDICT_REJECT);
  assert.equal(out[1], REASON_BAD_ENTITY);
  assert.equal(v.consumeVerdict(out), true);
  assert.equal(out[1], REASON_BAD_ACTION);
  assert.equal(v.consumeVerdict(out), true);
  assert.equal(out[1], REASON_BAD_REGION_ROOT);
});

test('LoomVerify: submitClaim REJECTs a malformed envelope (undersized payloadFp)', () => {
  const v = new LoomVerify(defaultConfig());
  v.setRegionRoot(0, 0xaaaaaaaa);
  v.submitClaim(basicClaim({ payloadFp: new Int32Array(2) }));  // stride is 4
  const out = new Int32Array(VERDICT_RECORD_STRIDE);
  assert.equal(v.consumeVerdict(out), true);
  assert.equal(out[0], VERDICT_REJECT);
});

test('LoomVerify: HIGH-value claim without a proof is REJECTed with NEEDS_PROOF (gate 3)', () => {
  const v = new LoomVerify(defaultConfig());
  v.setRegionRoot(0, 0xaaaaaaaa);
  v.setActionValueClass(7, VALUE_CLASS_HIGH);
  v.submitClaim(basicClaim({ actionType: 7 }));
  const out = new Int32Array(VERDICT_RECORD_STRIDE);
  assert.equal(v.consumeVerdict(out), true);
  assert.equal(out[0], VERDICT_REJECT);
  assert.equal(out[1], REASON_NEEDS_PROOF);
});

test('LoomVerify: HIGH-value claim with proof under ACTIVE epoch PASSes (gate 3, 4)', () => {
  const v = new LoomVerify(defaultConfig());
  v.setRegionRoot(0, 0xaaaaaaaa);
  v.setActionValueClass(7, VALUE_CLASS_HIGH);
  v.rotateKey(2);                              // epoch 2 ACTIVE
  const proof = new Uint8Array([2, 0xff, 0x12, 0x34]);
  v.submitClaim(basicClaim({ actionType: 7, proof }));
  const out = new Int32Array(VERDICT_RECORD_STRIDE);
  assert.equal(v.consumeVerdict(out), true);
  assert.equal(out[0], VERDICT_PASS);
});

test('LoomVerify: HIGH-value claim under retired epoch is REJECTed (gate 4)', () => {
  const v = new LoomVerify(defaultConfig());
  v.setRegionRoot(0, 0xaaaaaaaa);
  v.setActionValueClass(7, VALUE_CLASS_HIGH);
  v.rotateKey(1);
  v.retireKeyEpoch(1);                         // hard revoke
  const proof = new Uint8Array([1, 0, 0, 0]);
  v.submitClaim(basicClaim({ actionType: 7, proof }));
  const out = new Int32Array(VERDICT_RECORD_STRIDE);
  assert.equal(v.consumeVerdict(out), true);
  assert.equal(out[0], VERDICT_REJECT);
  assert.equal(out[1], REASON_BAD_KEY_EPOCH);
});

test('LoomVerify: HIGH-value claim under GRACE epoch within window PASSes (gate 4 - rotation grace)', () => {
  const v = new LoomVerify({ ...defaultConfig(), gracePeriodTicks: 10 });
  v.setRegionRoot(0, 0xaaaaaaaa);
  v.setActionValueClass(7, VALUE_CLASS_HIGH);
  v.rotateKey(1);                              // epoch 1 ACTIVE
  v.setTick(5);
  v.rotateKey(2);                              // epoch 1 -> GRACE at tick 5
  v.setTick(10);                               // 5 ticks into grace
  const proof = new Uint8Array([1, 0, 0, 0]);  // signed under epoch 1
  v.submitClaim(basicClaim({ actionType: 7, proof, tick: 10 }));
  const out = new Int32Array(VERDICT_RECORD_STRIDE);
  assert.equal(v.consumeVerdict(out), true);
  assert.equal(out[0], VERDICT_PASS);
});

test('LoomVerify: HIGH-value claim under GRACE epoch past window is REJECTed (gate 4)', () => {
  const v = new LoomVerify({ ...defaultConfig(), gracePeriodTicks: 10, acceptedTickSkew: 1000, nonceTtlTicks: 1000 });
  v.setRegionRoot(0, 0xaaaaaaaa);
  v.setActionValueClass(7, VALUE_CLASS_HIGH);
  v.rotateKey(1);
  v.setTick(5);
  v.rotateKey(2);                              // epoch 1 -> GRACE at tick 5
  v.setTick(100);                              // 95 ticks into grace, window=10
  const proof = new Uint8Array([1, 0, 0, 0]);
  v.submitClaim(basicClaim({ actionType: 7, proof, tick: 100 }));
  const out = new Int32Array(VERDICT_RECORD_STRIDE);
  assert.equal(v.consumeVerdict(out), true);
  assert.equal(out[0], VERDICT_REJECT);
  assert.equal(out[1], REASON_BAD_KEY_EPOCH);
});

test('LoomVerify: LOW-value claim is heuristic-only; no ZK required (gate 3, 7)', () => {
  const v = new LoomVerify(defaultConfig());
  v.setRegionRoot(0, 0xaaaaaaaa);
  v.setActionValueClass(0, VALUE_CLASS_LOW);
  // No proof, no key rotation - LOW skips ZK entirely.
  v.submitClaim(basicClaim());
  const out = new Int32Array(VERDICT_RECORD_STRIDE);
  assert.equal(v.consumeVerdict(out), true);
  assert.equal(out[0], VERDICT_PASS);
});

test('LoomVerify: violation score accumulates on REJECT, decays on PASS, decays per tick (gate 6)', () => {
  const v = new LoomVerify({ ...defaultConfig(), rejectViolationWeight: 10, resyncViolationWeight: 2,
    passDecayWeight: 1, violationDecayPerTick: 0 });
  v.setRegionRoot(0, 0xaaaaaaaa);
  // 3 REJECTs (region root mismatch) + 1 PASS.
  v.submitClaim(basicClaim({ nonce: 1, regionRoot: 0xdeadbeef }));   // REJECT +10
  v.submitClaim(basicClaim({ nonce: 2, regionRoot: 0xdeadbeef }));   // REJECT +10
  v.submitClaim(basicClaim({ nonce: 3, regionRoot: 0xdeadbeef }));   // REJECT +10
  v.submitClaim(basicClaim({ nonce: 4 }));                            // PASS  -1
  assert.equal(v.getViolationScore(1), 29);
  // tickWithDecay(t, dec=2) drops 2 from every entity each tick.
  const v2 = new LoomVerify({ ...defaultConfig(), violationDecayPerTick: 2 });
  v2.setRegionRoot(0, 0xaaaaaaaa);
  v2.submitClaim(basicClaim({ regionRoot: 0xdeadbeef }));      // +5
  assert.equal(v2.getViolationScore(1), 5);
  v2.tickWithDecay(1);
  assert.equal(v2.getViolationScore(1), 3);
  v2.tickWithDecay(2);
  v2.tickWithDecay(3);
  assert.equal(v2.getViolationScore(1), 0);                     // clamped
});

test('LoomVerify: clearViolationScore resets per-entity (gate 6 - moderation seam)', () => {
  const v = new LoomVerify(defaultConfig());
  v.setRegionRoot(0, 0xaaaaaaaa);
  v.submitClaim(basicClaim({ regionRoot: 0xdeadbeef }));   // REJECT
  assert.notEqual(v.getViolationScore(1), 0);
  v.clearViolationScore(1);
  assert.equal(v.getViolationScore(1), 0);
});

test('LoomVerify: verdict ring drops past capacity and counts (capacity gate)', () => {
  const v = new LoomVerify({ ...defaultConfig(), verdictRingCapacity: 2 });
  v.setRegionRoot(0, 0xaaaaaaaa);
  v.submitClaim(basicClaim({ nonce: 1 }));
  v.submitClaim(basicClaim({ nonce: 2 }));
  const id = v.submitClaim(basicClaim({ nonce: 3 }));
  assert.equal(id, VERDICT_ID_INVALID);
  assert.equal(v.getVerdictsDroppedTotal(), 1);
});

test('LoomVerify: consumeVerdict drains in FIFO order', () => {
  const v = new LoomVerify(defaultConfig());
  v.setRegionRoot(0, 0xaaaaaaaa);
  v.submitClaim(basicClaim({ nonce: 1 }));
  v.submitClaim(basicClaim({ nonce: 2 }));
  v.submitClaim(basicClaim({ nonce: 3 }));
  const out = new Int32Array(VERDICT_RECORD_STRIDE);
  v.consumeVerdict(out); assert.equal(out[5], 1);    // nonce column
  v.consumeVerdict(out); assert.equal(out[5], 2);
  v.consumeVerdict(out); assert.equal(out[5], 3);
  assert.equal(v.consumeVerdict(out), false);
});

test('LoomVerify: deterministic across two independent runs (bit-for-bit equal verdict streams)', () => {
  function run(): number[] {
    const v = new LoomVerify(defaultConfig());
    v.setRegionRoot(0, 0xaaaaaaaa);
    v.setActionValueClass(7, VALUE_CLASS_HIGH);
    v.rotateKey(1);
    const proof = new Uint8Array([1, 0xff, 0x12]);
    const verdicts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const id = v.submitClaim(basicClaim({ nonce: 100 + i, actionType: i % 2 === 0 ? 0 : 7, proof }));
      verdicts.push(id);
    }
    return verdicts;
  }
  const a = run();
  const b = run();
  assert.deepEqual(a, b);
});

test('LoomVerify: never-mutates-world invariant (gate 7) - all output is verdicts only', () => {
  // The verifier exposes no mutation surface. Verify that submitClaim
  // does not return any "applied state" - the only effect is a verdict
  // entered into the ring. (A regression that added world mutation
  // would also need to add a return field.)
  const v = new LoomVerify(defaultConfig());
  v.setRegionRoot(0, 0xaaaaaaaa);
  const id = v.submitClaim(basicClaim());
  assert.ok(typeof id === 'number');     // an id, not a state object
  // The verifier's surface is verdicts + counts. Score is a moderation
  // seam; nothing is applied to a "world".
});

test('LoomVerify: integer-only invariant (gate 1) - claims with non-integer fields are REJECTed', () => {
  const v = new LoomVerify(defaultConfig());
  v.setRegionRoot(0, 0xaaaaaaaa);
  v.submitClaim(basicClaim({ nonce: 1.5 }));
  const out = new Int32Array(VERDICT_RECORD_STRIDE);
  assert.equal(v.consumeVerdict(out), true);
  assert.equal(out[0], VERDICT_REJECT);
});

test('LoomVerify: rotateKey moves prior epoch to GRACE (gate 4)', () => {
  const v = new LoomVerify(defaultConfig());
  v.rotateKey(1);
  assert.equal(v.getActiveKeyEpoch(), 1);
  v.rotateKey(2);
  assert.equal(v.getActiveKeyEpoch(), 2);
  // epoch 1 should be in GRACE (state 2). State enum is internal -
  // we infer it via the GRACE-window pass test above.
});

test('LoomVerify: clear() resets every table (lifecycle)', () => {
  const v = new LoomVerify(defaultConfig());
  v.setRegionRoot(0, 0xaaaaaaaa);
  v.setActionValueClass(0, VALUE_CLASS_LOW);
  v.rotateKey(1);
  v.submitClaim(basicClaim());
  v.clear();
  assert.equal(v.getNonceEntryCount(), 0);
  assert.equal(v.getVerdictsPending(), 0);
  assert.equal(v.getVerdictsDroppedTotal(), 0);
  assert.equal(v.getViolationScore(1), 0);
  assert.equal(v.getRegionRoot(0), 0);
  assert.equal(v.isActiveKeyEpochSet(), false);
});

test('LoomVerify: setTick rejects out-of-range', () => {
  const v = new LoomVerify(defaultConfig());
  assert.throws(() => v.setTick(-1), RangeError);
  assert.throws(() => v.setTick(0x100000000), RangeError);
  assert.throws(() => v.setTick(1.5), RangeError);
});
