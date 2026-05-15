// Loom Engine - InfiniteHorizonStreamer (Morton chunk streamer) tests.
//
// Covers constructor validation, Morton encoding, and the 6 Codex gates:
//   gate 1 - signed chunk coordinates: a brute-force bijection test
//            proves the encoding round-trips the full signed range
//            (negatives included).
//   gate 2 - no BigInt: getMortonCode returns a plain integer number.
//   gate 3 - publishChunk writes the payload, then flips to READY.
//   gate 4 - updateHorizon pushes a load queue; dequeueLoad pulls it.
//   gate 5 - eviction / cancellation push records the caller drains;
//            a stale loader's publishChunk is rejected.
//   gate 6 - updateHorizon discovers and queues the missing chunks.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  InfiniteHorizonStreamer,
  CHUNK_STATE_QUEUED,
  CHUNK_STATE_LOADING,
  CHUNK_STATE_READY,
  CHUNK_STATE_NONE,
  CHUNK_HANDLE_INVALID,
  EVICTION_RECORD_STRIDE,
  chunkSlot,
  type InfiniteHorizonStreamerConfig,
} from '../src/index.js';

// A default config with selective overrides.
function cfg(over: Partial<InfiniteHorizonStreamerConfig> = {}): InfiniteHorizonStreamerConfig {
  return {
    worldBitsPerAxis: 8,   // coords in [-128, 128)
    horizonRadius: 2,      // 5x5 = 25 chunk horizon
    maxChunks: 32,         // power of two, >= 25
    payloadStride: 4,
    evictionQueueSize: 32, // >= 25
    ...over,
  };
}

test('infinite horizon streamer: constructor validates the config', () => {
  const s = new InfiniteHorizonStreamer(cfg());
  assert.equal(s.worldBitsPerAxis, 8);
  assert.equal(s.horizonRadius, 2);
  assert.equal(s.maxChunks, 32);
  assert.equal(s.payloadStride, 4);
  assert.equal(s.getChunkCount(), 0);
  assert.throws(() => new InfiniteHorizonStreamer(cfg({ worldBitsPerAxis: 0 })), /worldBitsPerAxis/);
  assert.throws(() => new InfiniteHorizonStreamer(cfg({ worldBitsPerAxis: 16 })), /worldBitsPerAxis/);
  assert.throws(() => new InfiniteHorizonStreamer(cfg({ horizonRadius: -1 })), /horizonRadius/);
  // maxChunks must be a power of two.
  assert.throws(() => new InfiniteHorizonStreamer(cfg({ maxChunks: 25 })), /power of two/);
  // ...and >= the horizon area (2r+1)^2 = 25.
  assert.throws(() => new InfiniteHorizonStreamer(cfg({ maxChunks: 16 })), /horizon area/);
  assert.throws(() => new InfiniteHorizonStreamer(cfg({ payloadStride: 0 })), /payloadStride/);
  // evictionQueueSize must be >= the horizon area.
  assert.throws(() => new InfiniteHorizonStreamer(cfg({ evictionQueueSize: 8 })), /evictionQueueSize/);
});

test('infinite horizon streamer: Morton encoding round-trips the full signed range (gate 1)', () => {
  // worldBitsPerAxis 4 -> coords in [-8, 8); a brute-force bijection
  // check: 16 x 16 distinct coordinates must give 256 distinct codes,
  // negatives included. The Gemini `x & (1 << i)` mishandled negatives.
  const s = new InfiniteHorizonStreamer(cfg({ worldBitsPerAxis: 4, horizonRadius: 1, maxChunks: 16, evictionQueueSize: 16 }));
  const codes = new Set<number>();
  for (let cy = -8; cy < 8; cy++) {
    for (let cx = -8; cx < 8; cx++) {
      const m = s.getMortonCode(cx, cy);
      assert.ok(Number.isInteger(m) && m >= 0, 'code for (' + cx + ',' + cy + ') is a non-negative integer');
      codes.add(m);
    }
  }
  assert.equal(codes.size, 256, 'every signed coordinate maps to a distinct code');
  // Coordinates outside the signed range are rejected.
  assert.throws(() => s.getMortonCode(8, 0), /chunkX/);
  assert.throws(() => s.getMortonCode(0, -9), /chunkY/);
});

test('infinite horizon streamer: getMortonCode returns a plain number, not a BigInt (gate 2)', () => {
  const s = new InfiniteHorizonStreamer(cfg());
  assert.equal(typeof s.getMortonCode(3, -2), 'number');
  assert.equal(typeof s.getMortonCode(-100, 100), 'number');
});

test('infinite horizon streamer: updateHorizon discovers and queues the missing chunks (gate 6)', () => {
  const s = new InfiniteHorizonStreamer(cfg({ horizonRadius: 2 }));   // 5x5 = 25
  s.updateHorizon(0, 0);
  assert.equal(s.getChunkCount(), 25, 'a fresh horizon of radius 2 is 25 chunks');
  assert.equal(s.getLoadQueueCount(), 25, 'all 25 are queued for load');
  // Every chunk in the square horizon is registered and QUEUED.
  for (let cy = -2; cy <= 2; cy++) {
    for (let cx = -2; cx <= 2; cx++) {
      const h = s.findChunk(cx, cy);
      assert.notEqual(h, CHUNK_HANDLE_INVALID, '(' + cx + ',' + cy + ') is registered');
      assert.equal(s.getChunkState(h), CHUNK_STATE_QUEUED);
    }
  }
  // A chunk just outside the horizon is not registered.
  assert.equal(s.findChunk(3, 0), CHUNK_HANDLE_INVALID);
  // Re-running with the same viewpoint discovers nothing new.
  s.updateHorizon(0, 0);
  assert.equal(s.getChunkCount(), 25);
  assert.equal(s.getLoadQueueCount(), 25);
});

test('infinite horizon streamer: updateHorizon clips the horizon at the world edge', () => {
  // worldBitsPerAxis 4 -> coords [-8, 8). Viewpoint at the corner with
  // radius 2: only the in-world part of the horizon is discovered.
  const s = new InfiniteHorizonStreamer(cfg({ worldBitsPerAxis: 4, horizonRadius: 2, maxChunks: 32, evictionQueueSize: 32 }));
  s.updateHorizon(7, 7);
  // cx, cy in {5, 6, 7} - coords 8, 9 are off the edge of the world.
  assert.equal(s.getChunkCount(), 9, 'the horizon is clipped to 3x3 at the corner');
});

test('infinite horizon streamer: moving the viewpoint evicts and discovers (gates 5, 6)', () => {
  const s = new InfiniteHorizonStreamer(cfg({ horizonRadius: 1, maxChunks: 16, evictionQueueSize: 16 }));   // 3x3 = 9
  s.updateHorizon(0, 0);
  assert.equal(s.getChunkCount(), 9);
  // A teleport with no overlap: all 9 old chunks evicted, 9 new queued.
  s.updateHorizon(100, 100);
  assert.equal(s.getChunkCount(), 9, 'the new horizon');
  assert.equal(s.getEvictionQueueCount(), 9, 'the 9 old chunks were evicted');
  // The eviction records carry the prior state (all were QUEUED).
  const rec = new Int32Array(EVICTION_RECORD_STRIDE);
  let drained = 0;
  while (s.dequeueEviction(rec)) {
    assert.equal(rec[3], CHUNK_STATE_QUEUED, 'priorState is QUEUED');
    drained++;
  }
  assert.equal(drained, 9);
  assert.equal(s.getEvictionQueueCount(), 0);
  // A partial-overlap move evicts only the chunks that left.
  s.updateHorizon(101, 100);   // shifted one chunk on x
  assert.equal(s.getChunkCount(), 9);
  assert.equal(s.getEvictionQueueCount(), 3, 'one column of 3 left the horizon');
});

test('infinite horizon streamer: dequeueLoad pulls the load queue, QUEUED -> LOADING (gate 4)', () => {
  const s = new InfiniteHorizonStreamer(cfg({ horizonRadius: 1, maxChunks: 16, evictionQueueSize: 16 }));
  s.updateHorizon(0, 0);
  assert.equal(s.getLoadQueueCount(), 9);
  const h = s.dequeueLoad();
  assert.notEqual(h, CHUNK_HANDLE_INVALID);
  assert.equal(s.getChunkState(h), CHUNK_STATE_LOADING);
  assert.equal(s.getLoadQueueCount(), 8);
  // Drain the rest.
  let pulled = 1;
  while (s.dequeueLoad() !== CHUNK_HANDLE_INVALID) pulled++;
  assert.equal(pulled, 9);
  assert.equal(s.getLoadQueueCount(), 0);
  assert.equal(s.dequeueLoad(), CHUNK_HANDLE_INVALID, 'an empty queue returns the invalid sentinel');
});

test('infinite horizon streamer: publishChunk writes payload then flips to READY (gate 3)', () => {
  const s = new InfiniteHorizonStreamer(cfg({ horizonRadius: 1, maxChunks: 16, evictionQueueSize: 16, payloadStride: 4 }));
  s.updateHorizon(0, 0);
  // A QUEUED chunk cannot be published - publishChunk only fires from LOADING.
  const queuedHandle = s.findChunk(0, 0);
  assert.equal(s.getChunkState(queuedHandle), CHUNK_STATE_QUEUED);
  assert.equal(s.publishChunk(queuedHandle, [1, 2, 3, 4]), false, 'cannot publish a QUEUED chunk');
  // Pull a chunk to LOADING and publish it.
  const h = s.dequeueLoad();
  assert.equal(s.getChunkState(h), CHUNK_STATE_LOADING);
  assert.equal(s.publishChunk(h, [11, 22, 33, 44]), true);
  assert.equal(s.getChunkState(h), CHUNK_STATE_READY);
  assert.equal(s.isChunkReady(h), true);
  const payload = new Uint32Array(4);
  assert.equal(s.readChunkPayload(h, payload), true);
  assert.deepEqual(Array.from(payload), [11, 22, 33, 44]);
  // publishChunk only fires from LOADING - a second call on a now-READY chunk is a no-op.
  assert.equal(s.publishChunk(h, [0, 0, 0, 0]), false);
  // count validation - exercised against a LOADING chunk.
  const h2 = s.dequeueLoad();
  assert.throws(() => s.publishChunk(h2, [1, 2, 3, 4, 5], 5), /payloadStride/);
  assert.throws(() => s.publishChunk(h2, [1, 2], 3), /values\.length/);
});

test('infinite horizon streamer: a stale loader response is rejected (gate 5)', () => {
  // dequeueLoad gives a handle to a LOADING chunk. The viewpoint then
  // teleports away, so updateHorizon cancels that chunk. When the
  // (now-pointless) loader finally calls publishChunk, the stale
  // handle must be rejected - the generation was bumped on the free.
  const s = new InfiniteHorizonStreamer(cfg({ horizonRadius: 1, maxChunks: 16, evictionQueueSize: 16 }));
  s.updateHorizon(0, 0);
  const h = s.dequeueLoad();
  assert.equal(s.getChunkState(h), CHUNK_STATE_LOADING);
  // Teleport - the LOADING chunk is now outside the horizon.
  s.updateHorizon(100, 100);
  assert.equal(s.getChunkState(h), CHUNK_STATE_NONE, 'the stale handle no longer resolves');
  assert.equal(s.publishChunk(h, [1, 2, 3, 4]), false, 'the stale loader response is rejected');
  // The cancellation pushed an eviction record with priorState LOADING.
  const rec = new Int32Array(EVICTION_RECORD_STRIDE);
  let sawLoading = false;
  while (s.dequeueEviction(rec)) {
    if (rec[3] === CHUNK_STATE_LOADING) sawLoading = true;
  }
  assert.equal(sawLoading, true, 'the in-flight load was recorded as cancelled');
});

test('infinite horizon streamer: cancelChunk aborts a pending load (gate 5)', () => {
  const s = new InfiniteHorizonStreamer(cfg({ horizonRadius: 1, maxChunks: 16, evictionQueueSize: 16 }));
  s.updateHorizon(0, 0);
  // Cancel a QUEUED chunk.
  const q = s.findChunk(1, 1);
  assert.equal(s.getChunkState(q), CHUNK_STATE_QUEUED);
  assert.equal(s.cancelChunk(q), true);
  assert.equal(s.getChunkState(q), CHUNK_STATE_NONE);
  assert.equal(s.getChunkCount(), 8);
  assert.equal(s.getLoadQueueCount(), 8, 'the cancelled chunk left the load queue too');
  assert.equal(s.cancelChunk(q), false, 'cancelling a stale handle is a no-op');
  // Cancel a LOADING chunk.
  const ldHandle = s.dequeueLoad();
  assert.equal(s.getChunkState(ldHandle), CHUNK_STATE_LOADING);
  assert.equal(s.cancelChunk(ldHandle), true);
  assert.equal(s.getChunkState(ldHandle), CHUNK_STATE_NONE);
  // A READY chunk is not cancellable (updateHorizon evicts those).
  const r = s.dequeueLoad();
  s.publishChunk(r, [1, 2, 3, 4]);
  assert.equal(s.cancelChunk(r), false, 'a READY chunk is not cancelled by cancelChunk');
  assert.equal(s.getChunkState(r), CHUNK_STATE_READY);
});

test('infinite horizon streamer: dequeueEviction drains records and validates out', () => {
  const s = new InfiniteHorizonStreamer(cfg({ horizonRadius: 1, maxChunks: 16, evictionQueueSize: 16 }));
  s.updateHorizon(5, 5);
  const h = s.findChunk(5, 5);
  const morton = s.getChunkMorton(h);
  s.cancelChunk(h);
  assert.equal(s.getEvictionQueueCount(), 1);
  const rec = new Int32Array(EVICTION_RECORD_STRIDE);
  assert.equal(s.dequeueEviction(rec), true);
  assert.equal(rec[0], morton, 'the record carries the chunk Morton code');
  assert.equal(rec[1], 5, 'chunkX');
  assert.equal(rec[2], 5, 'chunkY');
  assert.equal(rec[3], CHUNK_STATE_QUEUED, 'priorState');
  assert.equal(s.dequeueEviction(rec), false, 'an empty eviction queue returns false');
  // out must be large enough.
  assert.throws(() => s.dequeueEviction(new Int32Array(2)), /out must hold/);
});

test('infinite horizon streamer: an undrained eviction queue throws when it overflows', () => {
  // evictionQueueSize is exactly the horizon area (the minimum). One
  // full eviction batch fills it; a second without draining throws.
  const s = new InfiniteHorizonStreamer(cfg({ horizonRadius: 1, maxChunks: 16, evictionQueueSize: 9 }));
  s.updateHorizon(0, 0);
  s.updateHorizon(50, 50);   // evicts 9 - the queue is now full
  assert.equal(s.getEvictionQueueCount(), 9);
  assert.throws(() => s.updateHorizon(100, 100), /eviction queue full/);
});

test('infinite horizon streamer: findChunk and the chunk getters validate and resolve', () => {
  const s = new InfiniteHorizonStreamer(cfg({ horizonRadius: 1, maxChunks: 16, evictionQueueSize: 16 }));
  s.updateHorizon(0, 0);
  const h = s.findChunk(-1, 1);
  assert.notEqual(h, CHUNK_HANDLE_INVALID);
  assert.equal(s.getChunkX(h), -1);
  assert.equal(s.getChunkY(h), 1);
  assert.equal(s.getChunkMorton(h), s.getMortonCode(-1, 1));
  assert.ok(chunkSlot(h) >= 0 && chunkSlot(h) < s.maxChunks);
  // An unregistered coordinate.
  assert.equal(s.findChunk(50, 50), CHUNK_HANDLE_INVALID);
  // Out-of-range coordinates throw.
  assert.throws(() => s.findChunk(999, 0), /chunkX/);
  // Stale-handle getters return -1.
  s.cancelChunk(h);
  assert.equal(s.getChunkX(h), -1);
  assert.equal(s.getChunkState(h), CHUNK_STATE_NONE);
  assert.equal(s.readChunkPayload(h, new Uint32Array(4)), false);
});

test('infinite horizon streamer: clear resets the registry, queues, and handles', () => {
  const s = new InfiniteHorizonStreamer(cfg({ horizonRadius: 1, maxChunks: 16, evictionQueueSize: 16 }));
  s.updateHorizon(0, 0);
  // Leave the streamer in a mixed state: one cancelled, one READY, the rest QUEUED.
  const cancelled = s.findChunk(-1, -1);
  assert.equal(s.getChunkState(cancelled), CHUNK_STATE_QUEUED);
  s.cancelChunk(cancelled);              // -> an eviction record
  const h = s.dequeueLoad();
  s.publishChunk(h, [9, 9, 9, 9]);       // -> one READY chunk
  assert.ok(s.getChunkCount() > 0 && s.getEvictionQueueCount() > 0);
  s.clear();
  assert.equal(s.getChunkCount(), 0);
  assert.equal(s.getLoadQueueCount(), 0);
  assert.equal(s.getEvictionQueueCount(), 0);
  assert.equal(s.getChunkState(h), CHUNK_STATE_NONE, 'old handles are void after clear');
  assert.equal(s.findChunk(0, 0), CHUNK_HANDLE_INVALID);
  // Reusable after clear.
  s.updateHorizon(0, 0);
  assert.equal(s.getChunkCount(), 9);
});

test('infinite horizon streamer: the full pipeline is deterministic - identical runs match', () => {
  function run(): number[] {
    const s = new InfiniteHorizonStreamer(cfg({ horizonRadius: 2, maxChunks: 32, evictionQueueSize: 32, payloadStride: 3 }));
    const out: number[] = [];
    const path: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [3, 2], [3, 2], [-2, -1]];
    for (const point of path) {
      s.updateHorizon(point[0] ?? 0, point[1] ?? 0);
      // Load up to 4 chunks per step.
      for (let i = 0; i < 4; i++) {
        const h = s.dequeueLoad();
        if (h === CHUNK_HANDLE_INVALID) break;
        s.publishChunk(h, [s.getChunkX(h), s.getChunkY(h), s.getChunkMorton(h)]);
      }
      // Drain evictions.
      const rec = new Int32Array(EVICTION_RECORD_STRIDE);
      while (s.dequeueEviction(rec)) out.push(rec[0] ?? 0, rec[3] ?? 0);
      out.push(s.getChunkCount(), s.getLoadQueueCount());
    }
    // Final chunk states across the last horizon.
    for (let cy = -4; cy <= 4; cy++) {
      for (let cx = -4; cx <= 4; cx++) {
        const h = s.findChunk(cx, cy);
        out.push(h === CHUNK_HANDLE_INVALID ? -1 : s.getChunkState(h));
      }
    }
    return out;
  }
  assert.deepEqual(run(), run(), 'no RNG, no clock - the streamer is fully reproducible');
});
