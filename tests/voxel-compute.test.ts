// VoxelComputeSystem - Trinity §24 marching-cubes mesher tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  VoxelComputeSystem,
  VOXEL_VERTEX_STRIDE,
} from '../src/runtime/voxel-compute.js';

function defaultConfig() {
  return { maxChunks: 4, chunkSize: 4, vertexCapacity: 256 };
}

// Build trivial edge + tri tables for testing - case 0 = no triangles,
// case 255 = full inside (also no triangles), case 1 = corner 0 only
// (one triangle on edges 0, 3, 8).
function trivialEdgeTable(): Uint16Array {
  const t = new Uint16Array(256);
  t[1] = (1 << 0) | (1 << 3) | (1 << 8);     // edges 0, 3, 8 crossed
  return t;
}

function trivialTriTable(): Int8Array {
  const t = new Int8Array(256 * 16);
  for (let i = 0; i < t.length; i++) t[i] = -1;
  // Case 1: one triangle (edge 0, edge 8, edge 3).
  t[1 * 16 + 0] = 0;
  t[1 * 16 + 1] = 8;
  t[1 * 16 + 2] = 3;
  return t;
}

test('VoxelCompute: constructor rejects invalid config', () => {
  assert.throws(() => new VoxelComputeSystem({ ...defaultConfig(), maxChunks: 0 }), RangeError);
  assert.throws(() => new VoxelComputeSystem({ ...defaultConfig(), chunkSize: 1 }), RangeError);
  assert.throws(() => new VoxelComputeSystem({ ...defaultConfig(), vertexCapacity: 0 }), RangeError);
});

test('VoxelCompute: meshChunk throws if tables not loaded (gate 2)', () => {
  const v = new VoxelComputeSystem(defaultConfig());
  assert.equal(v.isReady(), false);
  assert.throws(() => v.meshChunk(0), Error);
});

test('VoxelCompute: setEdgeTable / setTriTable validate length and content (gate 2)', () => {
  const v = new VoxelComputeSystem(defaultConfig());
  assert.equal(v.setEdgeTable(new Uint16Array(255)), false);          // too short
  assert.equal(v.setEdgeTable(new Uint16Array(256)), true);
  assert.equal(v.setTriTable(new Int8Array(255)), false);
  const tri = new Int8Array(256 * 16);
  tri.fill(-1);
  assert.equal(v.setTriTable(tri), true);
  assert.equal(v.isReady(), true);
});

test('VoxelCompute: setVoxelDensity rejects out-of-bounds + invalid range', () => {
  const v = new VoxelComputeSystem(defaultConfig());
  assert.equal(v.setVoxelDensity(0, 0, 0, 0, 100), true);
  assert.equal(v.setVoxelDensity(0, -1, 0, 0, 0), false);
  assert.equal(v.setVoxelDensity(0, 0, 4, 0, 0), false);            // == chunkSize
  assert.equal(v.setVoxelDensity(0, 0, 0, 0, 200), false);          // > 127
  assert.equal(v.setVoxelDensity(0, 0, 0, 0, -200), false);         // < -128
  assert.equal(v.setVoxelDensity(99, 0, 0, 0, 0), false);           // bad chunk
});

test('VoxelCompute: front/back epoch swap promotes density (gate 6)', () => {
  const v = new VoxelComputeSystem(defaultConfig());
  v.setVoxelDensity(0, 1, 1, 1, 50);    // writes to BACK
  // FRONT not yet promoted - reads 0.
  assert.equal(v.getFrontDensity(0, 1, 1, 1), 0);
  v.promoteChunk(0);
  assert.equal(v.getFrontDensity(0, 1, 1, 1), 50);
  assert.equal(v.getChunkEpoch(0), 1);
  // Subsequent BACK write doesn't affect FRONT.
  v.setVoxelDensity(0, 1, 1, 1, 100);
  assert.equal(v.getFrontDensity(0, 1, 1, 1), 50);     // FRONT still 50
  v.promoteChunk(0);
  assert.equal(v.getFrontDensity(0, 1, 1, 1), 100);
  assert.equal(v.getChunkEpoch(0), 2);
});

test('VoxelCompute: counter reset buffer is a single zero (gate 4)', () => {
  const v = new VoxelComputeSystem(defaultConfig());
  const buf = v.getCounterResetBuffer();
  assert.equal(buf.length, 1);
  assert.equal(buf[0], 0);
});

test('VoxelCompute: mesh empty chunk yields zero triangles', () => {
  const v = new VoxelComputeSystem(defaultConfig());
  v.setEdgeTable(trivialEdgeTable());
  v.setTriTable(trivialTriTable());
  // Default density 0, all corners >= 0 = all "outside" by our convention
  // (cornerD < 0 => inside). cornerMask stays 0; case 0 has no triangles.
  const tris = v.meshChunk(0);
  assert.equal(tris, 0);
  assert.equal(v.getVertexCount(0), 0);
});

test('VoxelCompute: case 1 emits one triangle (gates 1, 3, 5)', () => {
  const v = new VoxelComputeSystem(defaultConfig());
  v.setEdgeTable(trivialEdgeTable());
  v.setTriTable(trivialTriTable());
  // Make corner 0 of cell (0,0,0) negative (inside) - cornerMask = 1 - case 1.
  v.setVoxelDensity(0, 0, 0, 0, -10);
  v.setVoxelDensity(0, 1, 0, 0, 10);
  v.setVoxelDensity(0, 0, 1, 0, 10);
  v.setVoxelDensity(0, 0, 0, 1, 10);
  v.promoteChunk(0);
  const tris = v.meshChunk(0);
  assert.equal(tris, 1);
  assert.equal(v.getVertexCount(0), 3);                // 1 triangle = 3 vertices
});

test('VoxelCompute: emitted vertex stride is exactly VOXEL_VERTEX_STRIDE (gate 1)', () => {
  const v = new VoxelComputeSystem(defaultConfig());
  v.setEdgeTable(trivialEdgeTable());
  v.setTriTable(trivialTriTable());
  v.setVoxelDensity(0, 0, 0, 0, -10);
  v.promoteChunk(0);
  v.meshChunk(0);
  const out = new Int32Array(VOXEL_VERTEX_STRIDE);
  assert.equal(v.readVertex(0, 0, out), true);
  assert.equal(VOXEL_VERTEX_STRIDE, 6);
});

test('VoxelCompute: vertex capacity overflow drops the triangle and counts (gate 3)', () => {
  const v = new VoxelComputeSystem({ ...defaultConfig(), vertexCapacity: 2 });
  v.setEdgeTable(trivialEdgeTable());
  v.setTriTable(trivialTriTable());
  v.setVoxelDensity(0, 0, 0, 0, -10);   // cell (0,0,0) case 1 -> 1 triangle = 3 vertices
  v.promoteChunk(0);
  v.meshChunk(0);
  // Capacity 2 < 3 - the triangle should drop.
  assert.equal(v.getVertexCount(0), 0);
  assert.equal(v.getVertexOverflowTotal(), 1);
});

test('VoxelCompute: edge interpolation positions are in fp world units (gate 5)', () => {
  const v = new VoxelComputeSystem(defaultConfig());
  v.setEdgeTable(trivialEdgeTable());
  v.setTriTable(trivialTriTable());
  // Corner 0 = -10, corner 1 = +10 -> midpoint t = 0.5; edge 0 = corners 0->1.
  v.setVoxelDensity(0, 0, 0, 0, -10);
  v.setVoxelDensity(0, 1, 0, 0, 10);
  v.promoteChunk(0);
  v.meshChunk(0);
  const out = new Int32Array(VOXEL_VERTEX_STRIDE);
  v.readVertex(0, 0, out);
  // Vertex on edge 0 should be at x = 0.5 fp = FP_ONE / 2 = 32768.
  assert.equal(out[0], 32768);
});

test('VoxelCompute: tick rejects out-of-range t', () => {
  const v = new VoxelComputeSystem(defaultConfig());
  assert.throws(() => v.tick(-1), RangeError);
  assert.throws(() => v.tick(1.5), RangeError);
});

test('VoxelCompute: clear() resets counters + buffers', () => {
  const v = new VoxelComputeSystem(defaultConfig());
  v.setEdgeTable(trivialEdgeTable());
  v.setTriTable(trivialTriTable());
  v.setVoxelDensity(0, 0, 0, 0, -10);
  v.promoteChunk(0);
  v.meshChunk(0);
  v.clear();
  assert.equal(v.getVertexCount(0), 0);
  assert.equal(v.getChunkEpoch(0), 0);
  assert.equal(v.getTrianglesEmittedTotal(), 0);
});

test('VoxelCompute: getVertexBufferView yields a view of the right size', () => {
  const v = new VoxelComputeSystem(defaultConfig());
  const view = v.getVertexBufferView(0);
  assert.ok(view !== null);
  assert.equal(view!.length, defaultConfig().vertexCapacity * VOXEL_VERTEX_STRIDE);
  assert.equal(v.getVertexBufferView(99), null);
});

test('VoxelCompute: deterministic across two independent runs', () => {
  function run(): number[] {
    const v = new VoxelComputeSystem(defaultConfig());
    v.setEdgeTable(trivialEdgeTable());
    v.setTriTable(trivialTriTable());
    for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      v.setVoxelDensity(0, x, y, z, ((x * 7 + y * 3 + z * 11) % 64) - 32);
    }
    v.promoteChunk(0);
    const tris = v.meshChunk(0);
    return [tris, v.getVertexCount(0)];
  }
  assert.deepEqual(run(), run());
});

test('VoxelCompute: setVoxelMaterial validates input', () => {
  const v = new VoxelComputeSystem(defaultConfig());
  assert.equal(v.setVoxelMaterial(0, 0, 0, 0, 7), true);
  assert.equal(v.setVoxelMaterial(0, 0, 0, 0, -1), false);
  assert.equal(v.setVoxelMaterial(0, 0, 0, 0, 256), false);
});
