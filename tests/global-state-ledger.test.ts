// GlobalStateLedger - Trinity §30 spatio-temporal persistence tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  GlobalStateLedger,
  MERGE_RULE_LAST_WRITE_WINS,
  MERGE_RULE_SUM,
  MERGE_RULE_BITSET_OR,
  DELTA_FLAG_HAS_VECTOR_EMBEDDING,
  DELTA_HANDLE_INVALID,
  DELTA_RECORD_STRIDE,
  COMPACTION_ENTRY_STRIDE,
  LEDGER_REASON_NONE,
} from '../src/runtime/global-state-ledger.js';

function defaultConfig() {
  return {
    maxRegions: 4,
    maxNodes: 8,
    maxDeltas: 64,
    maxComponentTypes: 16,
    valueArenaBytes: 4096,
    idempotencyWindow: 8,
    auditRingCapacity: 16,
  };
}

test('GlobalStateLedger: constructor rejects out-of-range capacities', () => {
  assert.throws(() => new GlobalStateLedger({ ...defaultConfig(), maxRegions: 0 }), RangeError);
  assert.throws(() => new GlobalStateLedger({ ...defaultConfig(), valueArenaBytes: 0 }), RangeError);
  assert.throws(() => new GlobalStateLedger({ ...defaultConfig(), idempotencyWindow: 0 }), RangeError);
});

test('GlobalStateLedger: registerComponentType + getComponentMergeRule (gates 3, 6)', () => {
  const l = new GlobalStateLedger(defaultConfig());
  assert.equal(l.registerComponentType(0, 1, MERGE_RULE_LAST_WRITE_WINS), LEDGER_REASON_NONE);
  assert.equal(l.getComponentMergeRule(0), MERGE_RULE_LAST_WRITE_WINS);
});

test('GlobalStateLedger: appendDelta requires a registered componentType (gate 3)', () => {
  const l = new GlobalStateLedger(defaultConfig());
  // Component type not yet registered.
  const idx = l.appendDelta(0, 0, 100, 7, 1, 1, 0, new Uint8Array([1, 2, 3]));
  assert.equal(idx, DELTA_HANDLE_INVALID);
  // Register and retry.
  l.registerComponentType(7, 1, MERGE_RULE_LAST_WRITE_WINS);
  const idx2 = l.appendDelta(0, 0, 100, 7, 1, 1, 0, new Uint8Array([1, 2, 3]));
  assert.notEqual(idx2, DELTA_HANDLE_INVALID);
});

test('GlobalStateLedger: appendDelta rejects codecVersion > registered max (gate 3)', () => {
  const l = new GlobalStateLedger(defaultConfig());
  l.registerComponentType(7, 2, MERGE_RULE_LAST_WRITE_WINS);     // max version 2
  // codecVersion = 3 -> rejected.
  assert.equal(l.appendDelta(0, 0, 100, 7, 3, 1, 0, new Uint8Array([1])), DELTA_HANDLE_INVALID);
});

test('GlobalStateLedger: appendDelta dedupes on idempotency key (gate 2)', () => {
  const l = new GlobalStateLedger(defaultConfig());
  l.registerComponentType(0, 1, MERGE_RULE_LAST_WRITE_WINS);
  assert.notEqual(l.appendDelta(0, 0, 100, 0, 1, 12345, 0, new Uint8Array([1])), DELTA_HANDLE_INVALID);
  // Same idempotency key -> dropped.
  assert.equal(l.appendDelta(0, 0, 100, 0, 1, 12345, 0, new Uint8Array([1])), DELTA_HANDLE_INVALID);
});

test('GlobalStateLedger: appendDelta rejects stale authority epoch (gate 2)', () => {
  const l = new GlobalStateLedger(defaultConfig());
  l.registerComponentType(0, 1, MERGE_RULE_LAST_WRITE_WINS);
  l.rotateRegionAuthorityEpoch(0);     // current = 1
  l.rotateRegionAuthorityEpoch(0);     // current = 2
  // Submit with epoch 1 -> rejected.
  assert.equal(l.appendDelta(0, 0, 100, 0, 1, 1, 1, new Uint8Array([1])), DELTA_HANDLE_INVALID);
  // Submit with current = 2 -> accepted.
  assert.notEqual(l.appendDelta(0, 0, 100, 0, 1, 2, 2, new Uint8Array([1])), DELTA_HANDLE_INVALID);
});

test('GlobalStateLedger: Lamport clock advances on every append (gate 1)', () => {
  const l = new GlobalStateLedger(defaultConfig());
  l.registerComponentType(0, 1, MERGE_RULE_LAST_WRITE_WINS);
  const before = l.getRegionLamport(0);
  assert.ok(before !== null);
  l.appendDelta(0, 0, 100, 0, 1, 1, 0, new Uint8Array([1]));
  const after = l.getRegionLamport(0);
  assert.ok(after !== null);
  assert.equal(after!.lo, (before!.lo + 1) >>> 0);
});

test('GlobalStateLedger: receivedLamport bumps clock to max+1 (gate 1)', () => {
  const l = new GlobalStateLedger(defaultConfig());
  l.registerComponentType(0, 1, MERGE_RULE_LAST_WRITE_WINS);
  l.appendDelta(0, 0, 100, 0, 1, 1, 0, new Uint8Array([1]), 0, 0, 100);    // received lamport 100
  const after = l.getRegionLamport(0);
  assert.equal(after!.lo, 101);                  // max(0, 100) + 1
});

test('GlobalStateLedger: readDeltaRecord returns the full ordering tuple (gate 1)', () => {
  const l = new GlobalStateLedger(defaultConfig());
  l.registerComponentType(7, 1, MERGE_RULE_LAST_WRITE_WINS);
  const idx = l.appendDelta(2, 5, 100, 7, 1, 999, 3, new Uint8Array([1, 2, 3]),
    DELTA_FLAG_HAS_VECTOR_EMBEDDING);
  const out = new Int32Array(DELTA_RECORD_STRIDE);
  assert.equal(l.readDeltaRecord(idx, out), true);
  assert.equal(out[0], 2);                       // regionId
  assert.equal(out[3], 5);                       // nodeId
  assert.equal(out[5], 999);                     // idempotencyKey
  assert.equal(out[6], 3);                       // authorityEpoch
  assert.equal(out[7], 100);                     // entityId
  assert.equal(out[8], 7);                       // componentTypeId
  assert.equal(out[12], DELTA_FLAG_HAS_VECTOR_EMBEDDING);
});

test('GlobalStateLedger: readValueBytes returns the appended payload (gate 3)', () => {
  const l = new GlobalStateLedger(defaultConfig());
  l.registerComponentType(0, 1, MERGE_RULE_LAST_WRITE_WINS);
  const idx = l.appendDelta(0, 0, 100, 0, 1, 1, 0, new Uint8Array([10, 20, 30]));
  const out = new Int32Array(DELTA_RECORD_STRIDE);
  l.readDeltaRecord(idx, out);
  const view = l.readValueBytes(out[10] ?? 0, out[11] ?? 0);
  assert.equal(view![0], 10);
  assert.equal(view![1], 20);
  assert.equal(view![2], 30);
});

test('GlobalStateLedger: hasVectorEmbedding bit flags deltas for the derived index (gate 4)', () => {
  const l = new GlobalStateLedger(defaultConfig());
  l.registerComponentType(0, 1, MERGE_RULE_LAST_WRITE_WINS);
  const idx = l.appendDelta(0, 0, 100, 0, 1, 1, 0, new Uint8Array([1]),
    DELTA_FLAG_HAS_VECTOR_EMBEDDING);
  const out = new Int32Array(DELTA_RECORD_STRIDE);
  l.readDeltaRecord(idx, out);
  assert.equal((out[12] ?? 0) & DELTA_FLAG_HAS_VECTOR_EMBEDDING, DELTA_FLAG_HAS_VECTOR_EMBEDDING);
});

test('GlobalStateLedger: compactionPlan emits older-deltas-per-(entity,component) (gate 5)', () => {
  const l = new GlobalStateLedger(defaultConfig());
  l.registerComponentType(0, 1, MERGE_RULE_LAST_WRITE_WINS);
  // 3 deltas for (entity=100, comp=0); 1 delta for (entity=200, comp=0).
  l.appendDelta(0, 0, 100, 0, 1, 1, 0, new Uint8Array([1]));
  l.appendDelta(0, 0, 100, 0, 1, 2, 0, new Uint8Array([2]));
  l.appendDelta(0, 0, 100, 0, 1, 3, 0, new Uint8Array([3]));
  l.appendDelta(0, 0, 200, 0, 1, 4, 0, new Uint8Array([4]));
  const out = new Int32Array(64);
  const len = l.compactionPlan(0, out);
  // (100, 0) has 3 deltas - 2 are older. (200, 0) has 1 - none compactable.
  assert.equal(len, COMPACTION_ENTRY_STRIDE);
  assert.equal(out[0], 100);
  assert.equal(out[1], 0);
  assert.equal(out[3], 2);                       // older count
});

test('GlobalStateLedger: compactionPlan emits an audit event (gate 5)', () => {
  const l = new GlobalStateLedger(defaultConfig());
  l.registerComponentType(0, 1, MERGE_RULE_LAST_WRITE_WINS);
  l.appendDelta(0, 0, 100, 0, 1, 1, 0, new Uint8Array([1]));
  l.appendDelta(0, 0, 100, 0, 1, 2, 0, new Uint8Array([2]));
  const out = new Int32Array(16);
  l.compactionPlan(0, out);
  // Drain the audit ring; there should be one PLANNED event.
  const audit = new Int32Array(4);
  assert.equal(l.consumeAuditEvent(audit), true);
  assert.equal(audit[0], GlobalStateLedger.AUDIT_COMPACTION_PLANNED);
});

test('GlobalStateLedger: notifyCompactionApplied counts + audits', () => {
  const l = new GlobalStateLedger(defaultConfig());
  l.notifyCompactionApplied(0, 5);
  assert.equal(l.getCompactionsTotal(), 1);
  const audit = new Int32Array(4);
  assert.equal(l.consumeAuditEvent(audit), true);
  assert.equal(audit[0], GlobalStateLedger.AUDIT_COMPACTION_APPLIED);
  assert.equal(audit[2], 5);
});

test('GlobalStateLedger: getStatsSnapshot exposes counters (gate 7)', () => {
  const l = new GlobalStateLedger(defaultConfig());
  l.registerComponentType(0, 1, MERGE_RULE_LAST_WRITE_WINS);
  l.appendDelta(0, 0, 100, 0, 1, 1, 0, new Uint8Array([1]));
  l.appendDelta(0, 0, 100, 0, 1, 1, 0, new Uint8Array([1]));     // dup -> drop
  const stats = new Uint32Array(4);
  l.getStatsSnapshot(stats);
  assert.equal(stats[0], 1);                     // appends
  assert.equal(stats[1], 1);                     // drops
  assert.equal(stats[3], 1);                     // delta count
});

test('GlobalStateLedger: deterministic across two independent runs', () => {
  function run(): number[] {
    const l = new GlobalStateLedger(defaultConfig());
    l.registerComponentType(0, 1, MERGE_RULE_SUM);
    l.registerComponentType(1, 1, MERGE_RULE_BITSET_OR);
    const out: number[] = [];
    for (let i = 0; i < 5; i++) {
      out.push(l.appendDelta(0, i % 3, i, i % 2, 1, 100 + i, 0, new Uint8Array([i & 0xff])));
    }
    return out;
  }
  assert.deepEqual(run(), run());
});

test('GlobalStateLedger: clear() resets every table', () => {
  const l = new GlobalStateLedger(defaultConfig());
  l.registerComponentType(0, 1, MERGE_RULE_LAST_WRITE_WINS);
  l.appendDelta(0, 0, 100, 0, 1, 1, 0, new Uint8Array([1]));
  l.clear();
  assert.equal(l.getDeltaCount(), 0);
  assert.equal(l.getAppendsTotal(), 0);
  // Component registry also cleared.
  assert.equal(l.appendDelta(0, 0, 100, 0, 1, 1, 0, new Uint8Array([1])), DELTA_HANDLE_INVALID);
});

test('GlobalStateLedger: tick rejects out-of-range t', () => {
  const l = new GlobalStateLedger(defaultConfig());
  assert.throws(() => l.tick(-1), RangeError);
});

test('GlobalStateLedger: appendDelta drops past valueArena capacity', () => {
  const l = new GlobalStateLedger({ ...defaultConfig(), valueArenaBytes: 8 });
  l.registerComponentType(0, 1, MERGE_RULE_LAST_WRITE_WINS);
  // 8 bytes fit one delta of length 8; the next one drops.
  assert.notEqual(l.appendDelta(0, 0, 100, 0, 1, 1, 0, new Uint8Array(8)), DELTA_HANDLE_INVALID);
  assert.equal(l.appendDelta(0, 0, 100, 0, 1, 2, 0, new Uint8Array(8)), DELTA_HANDLE_INVALID);
});
