// AetherGrid - Trinity §26 N2N authority handoff tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  AetherGrid,
  TRANSFER_STATE_PROPOSED,
  TRANSFER_STATE_COMMITTED,
  TRANSFER_STATE_ABORTED,
  TRANSFER_STATE_EXPIRED,
  AETHER_REASON_NONE,
  AETHER_REASON_STALE_EPOCH,
  AETHER_REASON_SPLIT_BRAIN,
  AETHER_REASON_BAD_HANDLE,
  AETHER_REASON_BAD_SEQ,
  TRANSFER_HANDLE_INVALID,
  NODE_INVALID,
  TRANSFER_RECORD_STRIDE,
  REPLICATION_RECORD_STRIDE,
} from '../src/runtime/aether-grid.js';

function defaultConfig() {
  return {
    maxEntities: 32,
    maxNodes: 8,
    maxTransfers: 16,
    maxChunks: 16,
    replicationRingCapacity: 32,
    payloadArenaBytes: 16 * 1024,
    localNodeId: 0,
    defaultDeadlineTicks: 100,
    idempotencyWindow: 8,
  };
}

test('AetherGrid: constructor rejects invalid config', () => {
  assert.throws(() => new AetherGrid({ ...defaultConfig(), maxEntities: 0 }), RangeError);
  assert.throws(() => new AetherGrid({ ...defaultConfig(), localNodeId: 99 }), RangeError);
  assert.throws(() => new AetherGrid({ ...defaultConfig(), defaultDeadlineTicks: 0 }), RangeError);
});

test('AetherGrid: setOwner / getOwner / getEpoch (gates 1, 2)', () => {
  const a = new AetherGrid(defaultConfig());
  assert.equal(a.getOwner(0), NODE_INVALID);
  assert.equal(a.setOwner(0, 1, 5), true);
  assert.equal(a.getOwner(0), 1);
  assert.equal(a.getEpoch(0), 5);
  assert.equal(a.setOwner(99, 1, 5), false);
  assert.equal(a.setOwner(0, 99, 5), false);
});

test('AetherGrid: proposeTransfer + commitTransfer round-trips authority (gate 3)', () => {
  const a = new AetherGrid(defaultConfig());
  a.setOwner(0, 1, 0);                                  // entity 0 owned by node 1
  const h = a.proposeTransfer(0, 1, 2, 100);            // node 1 -> node 2
  assert.notEqual(h, TRANSFER_HANDLE_INVALID);
  assert.equal(a.commitTransfer(h), AETHER_REASON_NONE);
  assert.equal(a.getOwner(0), 2);
  assert.equal(a.getEpoch(0), 1);
  assert.equal(a.getCommitsTotal(), 1);
});

test('AetherGrid: commitTransfer is idempotent on terminal COMMITTED (gate 3)', () => {
  const a = new AetherGrid(defaultConfig());
  a.setOwner(0, 1, 0);
  const h = a.proposeTransfer(0, 1, 2, 100);
  a.commitTransfer(h);
  assert.equal(a.commitTransfer(h), AETHER_REASON_NONE);     // re-commit OK
  assert.equal(a.getCommitsTotal(), 1);                       // still just 1
});

test('AetherGrid: commitTransfer rejects stale-epoch race (gate 2)', () => {
  const a = new AetherGrid(defaultConfig());
  a.setOwner(0, 1, 0);
  const h1 = a.proposeTransfer(0, 1, 2, 100);
  // Bump epoch externally - simulates concurrent commit from another path.
  a.setOwner(0, 3, 5);
  // h1's proposedEpoch was 0; current is 5 -> stale.
  assert.equal(a.commitTransfer(h1), AETHER_REASON_STALE_EPOCH);
});

test('AetherGrid: abortTransfer flips PROPOSED -> ABORTED', () => {
  const a = new AetherGrid(defaultConfig());
  a.setOwner(0, 1, 0);
  const h = a.proposeTransfer(0, 1, 2, 100);
  assert.equal(a.abortTransfer(h), AETHER_REASON_NONE);
  const out = new Int32Array(TRANSFER_RECORD_STRIDE);
  a.readTransfer(h, out);
  assert.equal(out[0], TRANSFER_STATE_ABORTED);
  // Re-abort idempotent.
  assert.equal(a.abortTransfer(h), AETHER_REASON_NONE);
});

test('AetherGrid: tick expires PROPOSED transfers past deadline (gates 3, 5)', () => {
  const a = new AetherGrid(defaultConfig());
  a.setOwner(0, 1, 0);
  const h = a.proposeTransfer(0, 1, 2, 100, 5);     // ttl=5
  a.tick(10);
  const out = new Int32Array(TRANSFER_RECORD_STRIDE);
  a.readTransfer(h, out);
  assert.equal(out[0], TRANSFER_STATE_EXPIRED);
  assert.equal(a.getExpiredTotal(), 1);
});

test('AetherGrid: proposeTransfer rejects if fromNode != current owner (gate 2)', () => {
  const a = new AetherGrid(defaultConfig());
  a.setOwner(0, 1, 0);
  // Node 3 tries to transfer entity 0, but it's owned by node 1.
  assert.equal(a.proposeTransfer(0, 3, 2, 100), TRANSFER_HANDLE_INVALID);
});

test('AetherGrid: idempotency-key dedup prevents duplicate proposals (gate 3)', () => {
  const a = new AetherGrid(defaultConfig());
  a.setOwner(0, 1, 0);
  const h1 = a.proposeTransfer(0, 1, 2, 12345);
  assert.notEqual(h1, TRANSFER_HANDLE_INVALID);
  // Same key from same node -> rejected.
  const h2 = a.proposeTransfer(0, 1, 2, 12345);
  assert.equal(h2, TRANSFER_HANDLE_INVALID);
});

test('AetherGrid: observeRemoteCommit detects split-brain (gate 5)', () => {
  const a = new AetherGrid(defaultConfig());
  a.setOwner(0, 1, 5);                              // local: owner=1 epoch=5
  // Remote claims same epoch but owner=3 -> SPLIT BRAIN.
  assert.equal(a.observeRemoteCommit(0, 5, 3), AETHER_REASON_SPLIT_BRAIN);
  assert.equal(a.getSplitBrainsTotal(), 1);
});

test('AetherGrid: observeRemoteCommit adopts ahead-of-us state (gate 5)', () => {
  const a = new AetherGrid(defaultConfig());
  a.setOwner(0, 1, 5);
  // Remote at higher epoch - we adopt it.
  assert.equal(a.observeRemoteCommit(0, 7, 4), AETHER_REASON_NONE);
  assert.equal(a.getOwner(0), 4);
  assert.equal(a.getEpoch(0), 7);
});

test('AetherGrid: observeRemoteCommit rejects stale remote (gate 5)', () => {
  const a = new AetherGrid(defaultConfig());
  a.setOwner(0, 1, 10);
  assert.equal(a.observeRemoteCommit(0, 5, 4), AETHER_REASON_STALE_EPOCH);
});

test('AetherGrid: enqueueChunkPayload assigns sequential seq per chunk (gate 4)', () => {
  const a = new AetherGrid(defaultConfig());
  const data = new Uint8Array(10);
  assert.equal(a.enqueueChunkPayload(0, 0, 0, data), 1);
  assert.equal(a.enqueueChunkPayload(0, 0, 0, data), 2);
  assert.equal(a.enqueueChunkPayload(1, 0, 0, data), 1);     // independent per chunk
});

test('AetherGrid: drainChunkReplication delivers in FIFO with payload offsets (gate 4)', () => {
  const a = new AetherGrid(defaultConfig());
  const p1 = new Uint8Array([1, 2, 3]);
  const p2 = new Uint8Array([4, 5, 6, 7]);
  a.enqueueChunkPayload(0, 1, 100, p1);
  a.enqueueChunkPayload(0, 1, 101, p2);
  const out = new Int32Array(REPLICATION_RECORD_STRIDE);
  a.drainChunkReplication(out);
  assert.equal(out[0], 0);    // chunkId
  assert.equal(out[1], 1);    // seq
  assert.equal(out[5], 3);    // payload length
  const view = a.readPayload(out[4] ?? 0, out[5] ?? 0);
  assert.equal(view![0], 1);
  a.drainChunkReplication(out);
  assert.equal(out[1], 2);
  assert.equal(out[5], 4);
});

test('AetherGrid: shouldAcceptChunk rejects stale seq (gate 4)', () => {
  const a = new AetherGrid(defaultConfig());
  a.markChunkDelivered(0, 5);
  assert.equal(a.shouldAcceptChunk(0, 5), AETHER_REASON_BAD_SEQ);    // <= last
  assert.equal(a.shouldAcceptChunk(0, 4), AETHER_REASON_BAD_SEQ);
  assert.equal(a.shouldAcceptChunk(0, 6), AETHER_REASON_NONE);
});

test('AetherGrid: replication ring drops past capacity', () => {
  const a = new AetherGrid({ ...defaultConfig(), replicationRingCapacity: 2 });
  const data = new Uint8Array(5);
  assert.equal(a.enqueueChunkPayload(0, 0, 0, data) > 0, true);
  assert.equal(a.enqueueChunkPayload(0, 0, 0, data) > 0, true);
  assert.equal(a.enqueueChunkPayload(0, 0, 0, data), -1);
  assert.equal(a.getReplicationDroppedTotal(), 1);
});

test('AetherGrid: recoverFromCheckpoint reloads owner+epoch and aborts pending (gate 5)', () => {
  const a = new AetherGrid(defaultConfig());
  a.setOwner(0, 1, 0);
  const h = a.proposeTransfer(0, 1, 2, 100);
  assert.notEqual(h, TRANSFER_HANDLE_INVALID);
  // Crash + recover with checkpoint state.
  const rows = new Uint32Array([0, 5, 10, 1, 7, 20]);    // entity 0 owner=5 epoch=10; entity 1 owner=7 epoch=20
  assert.equal(a.recoverFromCheckpoint(rows), true);
  assert.equal(a.getOwner(0), 5);
  assert.equal(a.getEpoch(0), 10);
  assert.equal(a.getOwner(1), 7);
  // The PROPOSED transfer should now be ABORTED.
  const out = new Int32Array(TRANSFER_RECORD_STRIDE);
  a.readTransfer(h, out);
  assert.equal(out[0], TRANSFER_STATE_ABORTED);
});

test('AetherGrid: deterministic across two independent runs', () => {
  function run(): number[] {
    const a = new AetherGrid(defaultConfig());
    const out: number[] = [];
    for (let i = 0; i < 5; i++) {
      a.setOwner(i, 1, 0);
      const h = a.proposeTransfer(i, 1, 2, 1000 + i);
      out.push(h, a.commitTransfer(h));
    }
    return out;
  }
  assert.deepEqual(run(), run());
});

test('AetherGrid: tick rejects out-of-range t', () => {
  const a = new AetherGrid(defaultConfig());
  assert.throws(() => a.tick(-1), RangeError);
  assert.throws(() => a.tick(1.5), RangeError);
});

test('AetherGrid: clear() resets every table', () => {
  const a = new AetherGrid(defaultConfig());
  a.setOwner(0, 1, 5);
  const h = a.proposeTransfer(0, 1, 2, 100);
  a.commitTransfer(h);
  a.clear();
  assert.equal(a.getOwner(0), NODE_INVALID);
  assert.equal(a.getEpoch(0), 0);
  assert.equal(a.getCommitsTotal(), 0);
});

test('AetherGrid: handle bad-handle rejection on terminal slot reuse', () => {
  const a = new AetherGrid({ ...defaultConfig(), maxTransfers: 1 });
  a.setOwner(0, 1, 0);
  const h1 = a.proposeTransfer(0, 1, 2, 100);
  a.commitTransfer(h1);
  // Slot 0 is now COMMITTED (terminal); allocate should reuse it
  // with a bumped generation.
  a.setOwner(0, 2, 1);     // epoch is already 1 from the commit
  const h2 = a.proposeTransfer(0, 2, 3, 200);
  assert.notEqual(h2, h1);
  // h1 is now stale.
  assert.equal(a.commitTransfer(h1), AETHER_REASON_BAD_HANDLE);
});
