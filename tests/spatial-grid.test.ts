// Loom Engine - SpatialGrid tests.
//
// Covers the dense bounded uniform grid: constructor validation, the
// position -> cell mapping with edge clamping, the insert/query
// round-trip and rebuild model, the firstInCell/nextOf traversal API,
// and the Codex gates - bounds checks on every public read, the
// hard-capped traversal that refuses to hang on a corrupt next[], and
// the epoch counter that exposes an interleaved write.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { SpatialGrid } from '../src/index.js';

test('spatial grid: constructor rejects invalid arguments', () => {
  assert.doesNotThrow(() => new SpatialGrid(32, 10, 10, 1000));
  // cellSize must be a positive finite number.
  assert.throws(() => new SpatialGrid(0, 10, 10, 100), /cellSize/);
  assert.throws(() => new SpatialGrid(-1, 10, 10, 100), /cellSize/);
  assert.throws(() => new SpatialGrid(Infinity, 10, 10, 100), /cellSize/);
  assert.throws(() => new SpatialGrid(NaN, 10, 10, 100), /cellSize/);
  // gridWidth / gridHeight / maxEntities must be positive integers.
  assert.throws(() => new SpatialGrid(32, 0, 10, 100), /gridWidth/);
  assert.throws(() => new SpatialGrid(32, 2.5, 10, 100), /gridWidth/);
  assert.throws(() => new SpatialGrid(32, 10, -3, 100), /gridHeight/);
  assert.throws(() => new SpatialGrid(32, 10, 10, 0), /maxEntities/);
  // Derived-size caps: numCells and maxEntities each have a sanity cap.
  assert.throws(() => new SpatialGrid(32, 1 << 13, 1 << 13, 100), /numCells/);
  assert.throws(() => new SpatialGrid(32, 10, 10, (1 << 24) + 1), /maxEntities/);
});

test('spatial grid: cellIndexOf maps positions and clamps out-of-bounds', () => {
  const grid = new SpatialGrid(10, 4, 3, 100);   // 4x3 cells, 10 units each
  // In-bounds: index is col + row * gridWidth.
  assert.equal(grid.cellIndexOf(0, 0), 0);
  assert.equal(grid.cellIndexOf(5, 5), 0);     // still cell (0, 0)
  assert.equal(grid.cellIndexOf(15, 0), 1);    // col 1, row 0
  assert.equal(grid.cellIndexOf(0, 12), 4);    // col 0, row 1 -> 0 + 1*4
  assert.equal(grid.cellIndexOf(35, 25), 11);  // col 3, row 2 -> 3 + 2*4
  // Out-of-bounds clamps to the nearest edge cell.
  assert.equal(grid.cellIndexOf(-100, -100), 0);
  assert.equal(grid.cellIndexOf(9999, 9999), 11);
  assert.equal(grid.cellIndexOf(-5, 25), 8);   // col clamps to 0, row 2
  assert.equal(grid.cellIndexOf(35, -5), 3);   // col 3, row clamps to 0
});

test('spatial grid: insert chains entities, query returns them newest-first', () => {
  const grid = new SpatialGrid(10, 8, 8, 100);
  const out = new Int32Array(16);
  assert.equal(grid.query(5, out), 0, 'an untouched cell is empty');
  // insert prepends, so query walks newest-first.
  grid.insert(7, 5);
  grid.insert(12, 5);
  grid.insert(3, 5);
  const n = grid.query(5, out);
  assert.equal(n, 3);
  assert.deepEqual(Array.from(out.subarray(0, n)), [3, 12, 7]);
  // A different cell is independent.
  grid.insert(99, 6);
  assert.equal(grid.query(6, out), 1);
  assert.equal(out[0], 99);
  assert.equal(grid.query(5, out), 3, 'cell 5 untouched by the cell 6 insert');
});

test('spatial grid: insert bounds-checks entityId and cellIdx', () => {
  const grid = new SpatialGrid(10, 4, 4, 50);   // 16 cells, 50 entities
  assert.doesNotThrow(() => grid.insert(49, 15));   // max valid
  assert.doesNotThrow(() => grid.insert(0, 0));     // min valid
  assert.throws(() => grid.insert(50, 0), /entityId/);   // == maxEntities
  assert.throws(() => grid.insert(-1, 0), /entityId/);
  assert.throws(() => grid.insert(2.5, 0), /entityId/);
  assert.throws(() => grid.insert(0, 16), /cellIdx/);    // == numCells
  assert.throws(() => grid.insert(0, -1), /cellIdx/);
});

test('spatial grid: query bounds-checks cellIdx', () => {
  const grid = new SpatialGrid(10, 4, 4, 50);
  const out = new Int32Array(8);
  assert.doesNotThrow(() => grid.query(15, out));
  assert.throws(() => grid.query(16, out), /cellIdx/);
  assert.throws(() => grid.query(-1, out), /cellIdx/);
});

test('spatial grid: query truncates to the result buffer length', () => {
  const grid = new SpatialGrid(10, 4, 4, 50);
  for (let e = 0; e < 10; e++) grid.insert(e, 3);
  const small = new Int32Array(4);
  assert.equal(grid.query(3, small), 4, 'fills only out.length entries');
  const big = new Int32Array(32);
  assert.equal(grid.query(3, big), 10, 'a buffer large enough gets the whole cell');
});

test('spatial grid: clear empties every cell for the next rebuild', () => {
  const grid = new SpatialGrid(10, 4, 4, 50);
  const out = new Int32Array(16);
  grid.insert(1, 0);
  grid.insert(2, 0);
  grid.insert(3, 7);
  assert.equal(grid.query(0, out), 2);
  assert.equal(grid.query(7, out), 1);
  grid.clear();
  assert.equal(grid.query(0, out), 0, 'cell 0 emptied');
  assert.equal(grid.query(7, out), 0, 'cell 7 emptied');
  // Rebuild after clear works.
  grid.insert(5, 0);
  assert.equal(grid.query(0, out), 1);
  assert.equal(out[0], 5);
});

test('spatial grid: firstInCell / nextOf walk a cell without the result buffer', () => {
  const grid = new SpatialGrid(10, 4, 4, 50);
  grid.insert(8, 2);
  grid.insert(4, 2);
  grid.insert(1, 2);
  // The manual walk matches query's newest-first order.
  const walked: number[] = [];
  for (let e = grid.firstInCell(2); e !== -1; e = grid.nextOf(e)) {
    walked.push(e);
  }
  assert.deepEqual(walked, [1, 4, 8]);
  assert.equal(grid.firstInCell(0), -1, 'an empty cell has no first entity');
  assert.equal(grid.nextOf(8), -1, 'the last entity in a chain points at EMPTY');
  // Bounds-checked, same as the other public reads.
  assert.throws(() => grid.firstInCell(16), /cellIdx/);
  assert.throws(() => grid.nextOf(50), /entityId/);
  assert.throws(() => grid.nextOf(-1), /entityId/);
});

test('spatial grid: query caps a corrupt next[] chain instead of hanging', () => {
  const grid = new SpatialGrid(10, 4, 4, 8);   // small maxEntities
  grid.insert(0, 0);
  grid.insert(1, 0);
  // Deliberately corrupt the intrusive list into a cycle (1 -> 0 -> 1).
  // Reaching into a private field is exactly what the formal traversal
  // API exists to prevent in real code; here it simulates memory
  // corruption to prove the maxEntities traversal cap.
  (grid as unknown as { next: Int32Array }).next[0] = 1;
  const out = new Int32Array(64);   // big enough that the buffer cap is not what stops us
  assert.throws(() => grid.query(0, out), /corrupt/);
});

test('spatial grid: epoch bumps on writes, not on reads', () => {
  const grid = new SpatialGrid(10, 4, 4, 50);
  const out = new Int32Array(8);
  assert.equal(grid.epoch, 0, 'a fresh grid starts at epoch 0');
  grid.insert(1, 0);
  assert.equal(grid.epoch, 1, 'insert bumps epoch');
  grid.insert(2, 0);
  assert.equal(grid.epoch, 2);
  const before = grid.epoch;
  grid.query(0, out);
  grid.firstInCell(0);
  grid.nextOf(1);
  grid.cellIndexOf(5, 5);
  assert.equal(grid.epoch, before, 'query / traversal / cellIndexOf do not bump epoch');
  grid.clear();
  assert.equal(grid.epoch, before + 1, 'clear bumps epoch');
});
