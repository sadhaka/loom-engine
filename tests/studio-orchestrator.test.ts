// LoomStudioOrchestrator - Trinity §31 AI Director governance tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  LoomStudioOrchestrator,
  FACT_TIER_LOW,
  FACT_TIER_HIGH,
  FACT_TIER_VERIFIED,
  FACT_STATE_PROPOSED,
  FACT_STATE_EXPIRED,
  RESERVED_FACT_INDEX,
  STUDIO_REASON_NONE,
  STUDIO_REASON_BAD_FACT_INDEX,
  STUDIO_REASON_TIER_FORBIDDEN,
  STUDIO_REASON_STALE_EPOCH,
  STUDIO_REASON_BAD_ACTION_MASK,
  STUDIO_REASON_BAD_HANDLE,
  QUERY_HANDLE_INVALID,
  QUERY_RECORD_STRIDE,
  FACT_RECORD_STRIDE,
} from '../src/runtime/studio-orchestrator.js';

function defaultConfig() {
  return {
    numSignals: 8,
    numQueryTypes: 4,
    maxQueries: 16,
    maxFacts: 32,
    maxTelemetryEpochSkew: 5,
  };
}

test('Studio: constructor rejects out-of-range capacities', () => {
  assert.throws(() => new LoomStudioOrchestrator({ ...defaultConfig(), numSignals: 0 }), RangeError);
  assert.throws(() => new LoomStudioOrchestrator({ ...defaultConfig(), maxFacts: 1 }), RangeError);
  assert.throws(() => new LoomStudioOrchestrator({ ...defaultConfig(), maxTelemetryEpochSkew: 0 }), RangeError);
});

test('Studio: telemetry double-buffer + epoch advance (gate 2)', () => {
  const o = new LoomStudioOrchestrator(defaultConfig());
  o.recordTelemetrySignal(0, 100);
  // Front not yet promoted - still 0.
  assert.equal(o.readSignal(0), 0);
  const ep = o.advanceTelemetryEpoch();
  assert.equal(ep, 1);
  assert.equal(o.readSignal(0), 100);
});

test('Studio: registerQueryAllowedMask + isQueryTypeRegistered (gate 3)', () => {
  const o = new LoomStudioOrchestrator(defaultConfig());
  assert.equal(o.registerQueryAllowedMask(0, 0xff), STUDIO_REASON_NONE);
  assert.equal(o.isQueryTypeRegistered(0), true);
  assert.equal(o.isQueryTypeRegistered(1), false);
});

test('Studio: enqueueQuery rejects unregistered queryType (gate 3)', () => {
  const o = new LoomStudioOrchestrator(defaultConfig());
  assert.equal(o.enqueueQuery(0, 0, 0, 10), QUERY_HANDLE_INVALID);
});

test('Studio: enqueueQuery rejects stale telemetry epoch on submit (gate 2)', () => {
  const o = new LoomStudioOrchestrator(defaultConfig());
  o.registerQueryAllowedMask(0, 0xff);
  // Advance to epoch 10.
  for (let i = 0; i < 10; i++) o.advanceTelemetryEpoch();
  // Submit with epoch 0 - skew = 10 > 5 -> rejected.
  assert.equal(o.enqueueQuery(0, 0, 0, 10), QUERY_HANDLE_INVALID);
  // Submit with epoch 7 - skew = 3 <= 5 -> accepted.
  assert.notEqual(o.enqueueQuery(0, 7, 0, 10), QUERY_HANDLE_INVALID);
});

test('Studio: drainQueryBatch yields PENDING queries (gate 1)', () => {
  const o = new LoomStudioOrchestrator(defaultConfig());
  o.registerQueryAllowedMask(0, 0xff);
  for (let i = 0; i < 3; i++) o.enqueueQuery(0, 0, i * 10, 10);
  const out = new Int32Array(QUERY_RECORD_STRIDE * 8);
  const drained = o.drainQueryBatch(8, out);
  assert.equal(drained, 3);
});

test('Studio: completeQuery validates action mask against allowed (gate 3)', () => {
  const o = new LoomStudioOrchestrator(defaultConfig());
  o.registerQueryAllowedMask(0, 0x0f);     // bits 0..3 allowed
  const h = o.enqueueQuery(0, 0, 0, 10);
  const out = new Int32Array(QUERY_RECORD_STRIDE * 8);
  o.drainQueryBatch(8, out);
  // Action 0x07 fits.
  assert.equal(o.completeQuery(h, 0, 0x07), STUDIO_REASON_NONE);
});

test('Studio: completeQuery rejects out-of-mask action (gate 3)', () => {
  const o = new LoomStudioOrchestrator(defaultConfig());
  o.registerQueryAllowedMask(0, 0x0f);
  const h = o.enqueueQuery(0, 0, 0, 10);
  const out = new Int32Array(QUERY_RECORD_STRIDE * 8);
  o.drainQueryBatch(8, out);
  // Action 0x10 has bit 4 - outside 0x0f.
  assert.equal(o.completeQuery(h, 0, 0x10), STUDIO_REASON_BAD_ACTION_MASK);
  assert.equal(o.getQueriesRejectedTotal(), 1);
});

test('Studio: completeQuery rejects stale telemetry epoch (gate 2)', () => {
  const o = new LoomStudioOrchestrator(defaultConfig());
  o.registerQueryAllowedMask(0, 0xff);
  const h = o.enqueueQuery(0, 0, 0, 10);
  const out = new Int32Array(QUERY_RECORD_STRIDE * 8);
  o.drainQueryBatch(8, out);
  // Advance many epochs - skew exceeds limit.
  for (let i = 0; i < 10; i++) o.advanceTelemetryEpoch();
  assert.equal(o.completeQuery(h, 0, 0x01), STUDIO_REASON_STALE_EPOCH);
});

test('Studio: completeQuery rejects mismatched submitted-vs-response epoch (gate 2)', () => {
  const o = new LoomStudioOrchestrator(defaultConfig());
  o.registerQueryAllowedMask(0, 0xff);
  const h = o.enqueueQuery(0, 0, 0, 10);
  const out = new Int32Array(QUERY_RECORD_STRIDE * 8);
  o.drainQueryBatch(8, out);
  // Response carries epoch 999 - doesn't match submitted (0).
  assert.equal(o.completeQuery(h, 999, 0x01), STUDIO_REASON_STALE_EPOCH);
});

test('Studio: proposeFact REJECTS reserved index 0 (gate 4)', () => {
  const o = new LoomStudioOrchestrator(defaultConfig());
  assert.equal(
    o.proposeFact(RESERVED_FACT_INDEX, FACT_TIER_LOW, 1, 0, 100, 0xabc),
    STUDIO_REASON_BAD_FACT_INDEX,
  );
});

test('Studio: proposeFact REJECTS VERIFIED tier (gate 6)', () => {
  const o = new LoomStudioOrchestrator(defaultConfig());
  assert.equal(
    o.proposeFact(5, FACT_TIER_VERIFIED, 1, 0, 100, 0xabc),
    STUDIO_REASON_TIER_FORBIDDEN,
  );
});

test('Studio: adminProposeFact CAN write VERIFIED (gate 6)', () => {
  const o = new LoomStudioOrchestrator(defaultConfig());
  assert.equal(
    o.adminProposeFact(5, FACT_TIER_VERIFIED, 1, 0, 100, 0xabc),
    STUDIO_REASON_NONE,
  );
});

test('Studio: adminProposeFact CAN write index 0 (admin-only - gate 4)', () => {
  const o = new LoomStudioOrchestrator(defaultConfig());
  assert.equal(
    o.adminProposeFact(RESERVED_FACT_INDEX, FACT_TIER_VERIFIED, 1, 0, 100, 0xabc),
    STUDIO_REASON_NONE,
  );
});

test('Studio: proposeFact accepts LOW/MEDIUM/HIGH at non-zero index (gates 4, 5)', () => {
  const o = new LoomStudioOrchestrator(defaultConfig());
  assert.equal(o.proposeFact(5, FACT_TIER_LOW, 1, 0, 100, 0xabc), STUDIO_REASON_NONE);
  assert.equal(o.proposeFact(6, FACT_TIER_HIGH, 2, 0, 100, 0xdef), STUDIO_REASON_NONE);
  assert.equal(o.getFactsProposedTotal(), 2);
});

test('Studio: readFact exposes provenance + expiry (gate 5)', () => {
  const o = new LoomStudioOrchestrator(defaultConfig());
  o.proposeFact(5, FACT_TIER_HIGH, 99, 7, 1000, 0xfeed);
  const out = new Int32Array(FACT_RECORD_STRIDE);
  assert.equal(o.readFact(5, out), true);
  assert.equal(out[0], 5);                       // factIndex
  assert.equal(out[1], FACT_TIER_HIGH);
  assert.equal(out[2], FACT_STATE_PROPOSED);
  assert.equal(out[3], 99);                      // sourceId
  assert.equal(out[4], 7);                       // telemetryEpoch
  assert.equal(out[5], 1000);                    // expiresAtTick
});

test('Studio: tick expires past-TTL facts (gate 5)', () => {
  const o = new LoomStudioOrchestrator(defaultConfig());
  o.proposeFact(5, FACT_TIER_LOW, 1, 0, 50, 0xabc);
  o.tick(100);
  const out = new Int32Array(FACT_RECORD_STRIDE);
  o.readFact(5, out);
  assert.equal(out[2], FACT_STATE_EXPIRED);
  assert.equal(o.getFactsExpiredTotal(), 1);
});

test('Studio: completeQuery rejects stale handle (slot reused)', () => {
  const o = new LoomStudioOrchestrator({ ...defaultConfig(), maxQueries: 1 });
  o.registerQueryAllowedMask(0, 0xff);
  const h1 = o.enqueueQuery(0, 0, 0, 10);
  const out = new Int32Array(QUERY_RECORD_STRIDE * 8);
  o.drainQueryBatch(8, out);
  o.completeQuery(h1, 0, 0x01);
  // Slot 0 reused with bumped generation.
  o.enqueueQuery(0, 0, 0, 10);
  // h1 is now stale.
  assert.equal(o.completeQuery(h1, 0, 0x01), STUDIO_REASON_BAD_HANDLE);
});

test('Studio: deterministic across two independent runs', () => {
  function run(): number[] {
    const o = new LoomStudioOrchestrator(defaultConfig());
    o.registerQueryAllowedMask(0, 0xff);
    const out: number[] = [];
    for (let i = 0; i < 5; i++) {
      out.push(o.enqueueQuery(0, 0, i * 10, 10));
    }
    return out;
  }
  assert.deepEqual(run(), run());
});

test('Studio: clear() resets every table', () => {
  const o = new LoomStudioOrchestrator(defaultConfig());
  o.registerQueryAllowedMask(0, 0xff);
  o.enqueueQuery(0, 0, 0, 10);
  o.proposeFact(5, FACT_TIER_LOW, 1, 0, 100, 0xabc);
  o.clear();
  assert.equal(o.getQueriesEnqueuedTotal(), 0);
  assert.equal(o.getFactsProposedTotal(), 0);
  assert.equal(o.isQueryTypeRegistered(0), false);
});

test('Studio: tick rejects out-of-range t', () => {
  const o = new LoomStudioOrchestrator(defaultConfig());
  assert.throws(() => o.tick(-1), RangeError);
});
