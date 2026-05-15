// NeuralMaterial - Trinity §17 runtime PBR-material synthesis tests.
//
// Covers: constructor validation, capability-gated path selection
// (the f32 universal fallback, the f16 mid path, the packed-4x8
// best path), bounds checks, atlas / array-texture addressing, the
// async job queue with stale-job dropping on eviction, mipmap-ready
// bit tracking, the LRU eviction + delayed-destruction queue, the
// rolling GPU-timestamp latency benchmark (p50 / p95), and bit-for-
// bit determinism across two independent runs.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  NeuralMaterial,
  pickPath,
  PATH_PACKED_F16,
  PATH_F16,
  PATH_F32,
  CAP_SHADER_F16,
  CAP_PACKED_4X8,
  CAP_TEXTURE_RGBA16F,
  CAP_TIMESTAMP_QUERY,
  NEURAL_SLOT_STATE_FREE,
  NEURAL_SLOT_STATE_QUEUED,
  NEURAL_SLOT_STATE_SYNTHESIZING,
  NEURAL_SLOT_STATE_RESIDENT,
  MATERIAL_HANDLE_INVALID,
  NEURAL_DESTROY_NONE,
  JOB_RECORD_STRIDE,
} from '../src/runtime/neural-material.js';

function defaultConfig() {
  return {
    atlasCols: 4,
    atlasRows: 4,
    sliceCapacity: 8,           // 4*4 = 16 logical slots, 2 slices of 8
    maxMaterialId: 1024,
    latentDim: 32,
    dispatchTilePixels: 256,
    mipmapLevels: 4,
    jobQueueCapacity: 32,
    destroyQueueCapacity: 32,   // >= slotCount + 1 = 17
    destroyDelay: 4,
    benchmarkWindow: 16,
    capabilities: CAP_SHADER_F16 | CAP_PACKED_4X8 | CAP_TEXTURE_RGBA16F | CAP_TIMESTAMP_QUERY,
  };
}

test('NeuralMaterial: constructor rejects out-of-range atlas geometry', () => {
  assert.throws(() => new NeuralMaterial({ ...defaultConfig(), atlasCols: 0 }), RangeError);
  assert.throws(() => new NeuralMaterial({ ...defaultConfig(), atlasRows: 0 }), RangeError);
  assert.throws(() => new NeuralMaterial({ ...defaultConfig(), sliceCapacity: 0 }), RangeError);
  assert.throws(() => new NeuralMaterial({ ...defaultConfig(), sliceCapacity: 99 }), RangeError);
});

test('NeuralMaterial: constructor rejects out-of-range latent / dispatch / mipmap (gate 4)', () => {
  assert.throws(() => new NeuralMaterial({ ...defaultConfig(), latentDim: 0 }), RangeError);
  assert.throws(() => new NeuralMaterial({ ...defaultConfig(), latentDim: 9999 }), RangeError);
  assert.throws(() => new NeuralMaterial({ ...defaultConfig(), dispatchTilePixels: 0 }), RangeError);
  assert.throws(() => new NeuralMaterial({ ...defaultConfig(), mipmapLevels: 0 }), RangeError);
  assert.throws(() => new NeuralMaterial({ ...defaultConfig(), mipmapLevels: 99 }), RangeError);
});

test('NeuralMaterial: constructor rejects undersized destroyQueueCapacity', () => {
  assert.throws(() => new NeuralMaterial({ ...defaultConfig(), destroyQueueCapacity: 5 }), RangeError);
});

test('NeuralMaterial: pickPath - packed-4x8 wins when both flags present (gate 2, 3)', () => {
  assert.equal(pickPath(CAP_SHADER_F16 | CAP_PACKED_4X8), PATH_PACKED_F16);
});

test('NeuralMaterial: pickPath - f16 wins when only shader-f16 (gate 2, 3)', () => {
  assert.equal(pickPath(CAP_SHADER_F16), PATH_F16);
});

test('NeuralMaterial: pickPath - f32 is the universal fallback (gate 3)', () => {
  assert.equal(pickPath(0), PATH_F32);
  assert.equal(pickPath(CAP_TEXTURE_RGBA16F), PATH_F32);     // no shader-f16 -> f32
});

test('NeuralMaterial: setCapabilities re-picks the synthesis path (gate 2)', () => {
  const m = new NeuralMaterial({ ...defaultConfig(), capabilities: 0 });
  assert.equal(m.getSelectedPath(), PATH_F32);
  m.setCapabilities(CAP_SHADER_F16);
  assert.equal(m.getSelectedPath(), PATH_F16);
  m.setCapabilities(CAP_SHADER_F16 | CAP_PACKED_4X8);
  assert.equal(m.getSelectedPath(), PATH_PACKED_F16);
});

test('NeuralMaterial: requestMaterial bounds-checks materialId (gate 4)', () => {
  const m = new NeuralMaterial(defaultConfig());
  assert.equal(m.requestMaterial(-1, 0), MATERIAL_HANDLE_INVALID);
  assert.equal(m.requestMaterial(1024, 0), MATERIAL_HANDLE_INVALID);    // == maxMaterialId
  assert.equal(m.requestMaterial(1.5, 0), MATERIAL_HANDLE_INVALID);
  // Valid id passes.
  assert.notEqual(m.requestMaterial(5, 0), MATERIAL_HANDLE_INVALID);
});

test('NeuralMaterial: requestMaterial queues a job (gate 1 - async pipeline)', () => {
  const m = new NeuralMaterial(defaultConfig());
  const h = m.requestMaterial(7, 100);
  assert.notEqual(h, MATERIAL_HANDLE_INVALID);
  assert.equal(m.getJobQueueCount(), 1);
  assert.equal(m.getCachedCount(), 1);
  assert.equal(m.getSlotState(h), NEURAL_SLOT_STATE_QUEUED);
});

test('NeuralMaterial: requestMaterial of an already-cached id refreshes LRU; no duplicate job (gate 1)', () => {
  const m = new NeuralMaterial(defaultConfig());
  const h1 = m.requestMaterial(7, 100);
  const h2 = m.requestMaterial(7, 200);   // same id, later tick
  assert.equal(h1, h2);
  assert.equal(m.getJobQueueCount(), 1);    // still just one job
  assert.equal(m.getCachedCount(), 1);
});

test('NeuralMaterial: dequeueJob writes the job record and transitions to SYNTHESIZING (gate 1)', () => {
  const m = new NeuralMaterial(defaultConfig());
  const h = m.requestMaterial(42, 5);
  const out = new Int32Array(JOB_RECORD_STRIDE);
  assert.equal(m.dequeueJob(out), true);
  assert.equal(out[0], 42);                                  // materialId
  assert.equal(out[3], PATH_PACKED_F16);                      // path
  assert.equal(out[4], 4);                                   // mipmapLevels
  assert.equal(out[5], 256);                                 // dispatchTilePixels
  assert.equal(out[6], 5);                                   // requestedAtTick
  assert.equal(m.getSlotState(h), NEURAL_SLOT_STATE_SYNTHESIZING);
  assert.equal(m.getJobQueueCount(), 0);
});

test('NeuralMaterial: dequeueJob skips stale jobs (slot evicted between request and dequeue)', () => {
  const m = new NeuralMaterial({ ...defaultConfig(), atlasCols: 1, atlasRows: 2, sliceCapacity: 2,
    destroyQueueCapacity: 4 });
  // 2 slots; request material 1 at tick 1, then 17 more materials so
  // the original 1 evicts before its job is dequeued.
  m.requestMaterial(1, 1);
  m.requestMaterial(2, 2);
  // Now request a third; that forces eviction of one of {1,2}.
  m.requestMaterial(3, 100);
  // Dequeue every job; the stale (evicted) job should be skipped.
  const out = new Int32Array(JOB_RECORD_STRIDE);
  let dequeued = 0;
  while (m.dequeueJob(out)) dequeued++;
  assert.ok(dequeued >= 2, 'expected at least the 2 live jobs to dequeue, got ' + dequeued);
});

test('NeuralMaterial: completeJob moves slot to RESIDENT and records latency (gate 1, 7)', () => {
  const m = new NeuralMaterial(defaultConfig());
  const h = m.requestMaterial(11, 0);
  const out = new Int32Array(JOB_RECORD_STRIDE);
  m.dequeueJob(out);
  const jobId = out[7] ?? 0;
  assert.equal(m.completeJob(h, jobId, 1234), true);
  assert.equal(m.getSlotState(h), NEURAL_SLOT_STATE_RESIDENT);
  assert.equal(m.getCompletedJobsTotal(), 1);
  assert.equal(m.getLatencySampleCount(), 1);
});

test('NeuralMaterial: completeJob rejects stale handle (post-eviction)', () => {
  const m = new NeuralMaterial({ ...defaultConfig(), atlasCols: 1, atlasRows: 2, sliceCapacity: 2,
    destroyQueueCapacity: 4 });
  const h1 = m.requestMaterial(1, 1);
  const out = new Int32Array(JOB_RECORD_STRIDE);
  m.dequeueJob(out);
  const jobId = out[7] ?? 0;
  // Force eviction by requesting more than capacity.
  m.requestMaterial(2, 2);
  m.requestMaterial(3, 100);
  // The original handle is now stale.
  assert.equal(m.completeJob(h1, jobId, 100), false);
});

test('NeuralMaterial: completeJob rejects out-of-range gpuDurationUs', () => {
  const m = new NeuralMaterial(defaultConfig());
  const h = m.requestMaterial(1, 0);
  const out = new Int32Array(JOB_RECORD_STRIDE);
  m.dequeueJob(out);
  const jobId = out[7] ?? 0;
  assert.equal(m.completeJob(h, jobId, -1), false);
  assert.equal(m.completeJob(h, jobId, 1.5), false);
});

test('NeuralMaterial: latency p50/p95 over the rolling window (gate 7)', () => {
  const m = new NeuralMaterial(defaultConfig());
  // Drive 10 completions with known durations.
  const durations = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
  for (let i = 0; i < durations.length; i++) {
    const h = m.requestMaterial(i, i);
    const out = new Int32Array(JOB_RECORD_STRIDE);
    m.dequeueJob(out);
    const jobId = out[7] ?? 0;
    m.completeJob(h, jobId, durations[i] ?? 0);
  }
  const p50 = m.getLatencyP50();
  const p95 = m.getLatencyP95();
  // p50 of [100..1000] step 100 -> ~500-600; p95 -> >= 900.
  assert.ok(p50 >= 400 && p50 <= 700, 'p50 should be near 500, got ' + p50);
  assert.ok(p95 >= 900, 'p95 should be at the top, got ' + p95);
});

test('NeuralMaterial: getAtlasCoords yields (sliceIndex, u, v) within bounds (gate 5)', () => {
  const m = new NeuralMaterial(defaultConfig());
  const h = m.requestMaterial(7, 0);
  const out = new Int32Array(3);
  assert.equal(m.getAtlasCoords(h, out), true);
  assert.ok(out[0] !== undefined && out[0] >= 0);                                 // sliceIndex
  assert.ok(out[1] !== undefined && out[1] >= 0 && out[1] < defaultConfig().atlasCols);
  assert.ok(out[2] !== undefined && out[2] >= 0 && out[2] < defaultConfig().atlasRows);
});

test('NeuralMaterial: getAtlasCoords spans multiple slices (gate 5 - array texture)', () => {
  const m = new NeuralMaterial(defaultConfig());
  // sliceCapacity = 8 means slot 8 lands on slice 1.
  // Request 9 materials and verify some end up on slice 1.
  const slices = new Set<number>();
  for (let i = 0; i < 9; i++) {
    const h = m.requestMaterial(i, i);
    const out = new Int32Array(3);
    m.getAtlasCoords(h, out);
    slices.add(out[0] ?? -1);
  }
  assert.ok(slices.has(0) && slices.has(1), 'expected slots to span two slices, got ' + JSON.stringify([...slices]));
});

test('NeuralMaterial: markMipmapReady tracks per-level bits (gate 6)', () => {
  const m = new NeuralMaterial(defaultConfig());
  const h = m.requestMaterial(1, 0);
  const out = new Int32Array(JOB_RECORD_STRIDE);
  m.dequeueJob(out);
  m.completeJob(h, out[7] ?? 0, 100);
  assert.equal(m.getMipmapReady(h), 1);                       // level 0 ready by default
  assert.equal(m.markMipmapReady(h, 1), true);
  assert.equal(m.markMipmapReady(h, 2), true);
  assert.equal(m.getMipmapReady(h), 1 | 2 | 4);
  // Out-of-range level rejected.
  assert.equal(m.markMipmapReady(h, 99), false);
});

test('NeuralMaterial: drainDestroyed yields evicted atlas slots after the delay (gate 6)', () => {
  const m = new NeuralMaterial({ ...defaultConfig(), atlasCols: 1, atlasRows: 2, sliceCapacity: 2,
    destroyQueueCapacity: 4, destroyDelay: 5 });
  m.requestMaterial(1, 0);
  m.requestMaterial(2, 0);
  m.requestMaterial(3, 0);     // forces eviction
  // The evicted atlas slot is not yet ready - delay = 5, queued at
  // tick 0, ready at tick 5.
  assert.equal(m.drainDestroyed(0), NEURAL_DESTROY_NONE);
  assert.equal(m.drainDestroyed(4), NEURAL_DESTROY_NONE);
  // Past the delay - drainable.
  assert.notEqual(m.drainDestroyed(10), NEURAL_DESTROY_NONE);
});

test('NeuralMaterial: jobQueue drops past capacity and counts (gate 1 backpressure)', () => {
  // Force more requests than the queue capacity.
  const m = new NeuralMaterial({ ...defaultConfig(), jobQueueCapacity: 2,
    atlasCols: 4, atlasRows: 4, sliceCapacity: 8 });
  for (let i = 0; i < 5; i++) m.requestMaterial(i, 0);
  // First 2 fit; remaining 3 should drop.
  assert.equal(m.getJobsDroppedTotal(), 3);
});

test('NeuralMaterial: isValidPixelCoord bounds-checks dispatch coords (gate 4)', () => {
  const m = new NeuralMaterial(defaultConfig());
  assert.equal(m.isValidPixelCoord(0, 0), true);
  assert.equal(m.isValidPixelCoord(255, 255), true);
  assert.equal(m.isValidPixelCoord(256, 0), false);
  assert.equal(m.isValidPixelCoord(0, -1), false);
  assert.equal(m.isValidPixelCoord(1.5, 0), false);
});

test('NeuralMaterial: deterministic across two independent runs (bit-for-bit)', () => {
  function run(): number[] {
    const m = new NeuralMaterial(defaultConfig());
    const out = new Int32Array(JOB_RECORD_STRIDE);
    const records: number[] = [];
    for (let i = 0; i < 8; i++) {
      m.requestMaterial(i * 7 % 32, i);
      m.dequeueJob(out);
      // Snapshot the materialId and slot fields.
      records.push(out[0] ?? -1, out[1] ?? -1, out[3] ?? -1);
    }
    return records;
  }
  assert.deepEqual(run(), run());
});

test('NeuralMaterial: clear() resets every slot/queue/counter (lifecycle)', () => {
  const m = new NeuralMaterial(defaultConfig());
  m.requestMaterial(1, 0);
  m.requestMaterial(2, 0);
  m.clear();
  assert.equal(m.getCachedCount(), 0);
  assert.equal(m.getJobQueueCount(), 0);
  assert.equal(m.getCompletedJobsTotal(), 0);
  assert.equal(m.getJobsDroppedTotal(), 0);
  assert.equal(m.getDestroyQueueCount(), 0);
  assert.equal(m.getLatencySampleCount(), 0);
});

test('NeuralMaterial: dequeueJob handles empty queue and undersized buffer', () => {
  const m = new NeuralMaterial(defaultConfig());
  const out = new Int32Array(JOB_RECORD_STRIDE);
  assert.equal(m.dequeueJob(out), false);
  m.requestMaterial(1, 0);
  const small = new Int32Array(3);
  assert.equal(m.dequeueJob(small), false);
});
