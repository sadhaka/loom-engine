// Phase 0.57.0 - TileMap tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  TileMap,
  RESOURCE_TILE_MAP,
} from '../src/index.js';

test('tile-map: RESOURCE_TILE_MAP is the stable string', () => {
  assert.equal(RESOURCE_TILE_MAP, 'tile_map');
});

test('tile-map: create + size accessors', () => {
  const tm = TileMap.create({ width: 10, height: 8 });
  assert.equal(tm.width(), 10);
  assert.equal(tm.height(), 8);
  assert.equal(tm.cellCount(), 80);
});

test('tile-map: create rejects non-positive size', () => {
  assert.throws(() => TileMap.create({ width: 0, height: 5 }), /must be positive/);
  assert.throws(() => TileMap.create({ width: 5, height: -1 }), /must be positive/);
});

test('tile-map: defaults to all zeros', () => {
  const tm = TileMap.create({ width: 3, height: 3 });
  for (var y = 0; y < 3; y++) {
    for (var x = 0; x < 3; x++) {
      assert.equal(tm.get(x, y), 0);
    }
  }
});

test('tile-map: defaultTile fills initial state', () => {
  const tm = TileMap.create({ width: 3, height: 3, defaultTile: 7 });
  assert.equal(tm.get(0, 0), 7);
  assert.equal(tm.get(2, 2), 7);
});

test('tile-map: data array initializes the grid', () => {
  const tm = TileMap.create({ width: 2, height: 2, data: [1, 2, 3, 4] });
  assert.equal(tm.get(0, 0), 1);
  assert.equal(tm.get(1, 0), 2);
  assert.equal(tm.get(0, 1), 3);
  assert.equal(tm.get(1, 1), 4);
});

test('tile-map: data length mismatch throws', () => {
  assert.throws(
    () => TileMap.create({ width: 2, height: 2, data: [1, 2, 3] }),
    /does not match/,
  );
});

test('tile-map: get out-of-bounds returns 0', () => {
  const tm = TileMap.create({ width: 3, height: 3 });
  assert.equal(tm.get(-1, 0), 0);
  assert.equal(tm.get(0, -1), 0);
  assert.equal(tm.get(3, 0), 0);
  assert.equal(tm.get(0, 3), 0);
});

test('tile-map: set out-of-bounds is silent no-op', () => {
  const tm = TileMap.create({ width: 3, height: 3 });
  tm.set(10, 10, 99);
  assert.equal(tm.get(10, 10), 0);
  // No exception thrown.
});

test('tile-map: set + get roundtrip', () => {
  const tm = TileMap.create({ width: 5, height: 5 });
  tm.set(2, 3, 42);
  assert.equal(tm.get(2, 3), 42);
});

test('tile-map: tile id clamps to Uint16 range', () => {
  const tm = TileMap.create({ width: 2, height: 2 });
  tm.set(0, 0, -5);
  tm.set(1, 0, 100000);
  assert.equal(tm.get(0, 0), 0);
  assert.equal(tm.get(1, 0), 65535);
});

test('tile-map: float coordinates floor to integer cells', () => {
  const tm = TileMap.create({ width: 5, height: 5 });
  tm.set(2.7, 3.4, 9);
  assert.equal(tm.get(2.1, 3.9), 9);
});

test('tile-map: inBounds reflects valid range', () => {
  const tm = TileMap.create({ width: 5, height: 5 });
  assert.equal(tm.inBounds(0, 0), true);
  assert.equal(tm.inBounds(4, 4), true);
  assert.equal(tm.inBounds(5, 4), false);
  assert.equal(tm.inBounds(-1, 2), false);
});

test('tile-map: fill replaces every cell', () => {
  const tm = TileMap.create({ width: 3, height: 3 });
  tm.fill(99);
  for (var y = 0; y < 3; y++) {
    for (var x = 0; x < 3; x++) {
      assert.equal(tm.get(x, y), 99);
    }
  }
});

test('tile-map: fillRect fills clipped region only', () => {
  const tm = TileMap.create({ width: 5, height: 5 });
  tm.fillRect(1, 1, 3, 3, 7);
  // Inside region.
  assert.equal(tm.get(1, 1), 7);
  assert.equal(tm.get(3, 3), 7);
  // Outside region.
  assert.equal(tm.get(0, 0), 0);
  assert.equal(tm.get(4, 4), 0);
});

test('tile-map: fillRect clips to bounds', () => {
  const tm = TileMap.create({ width: 5, height: 5 });
  // Region extending past edge.
  tm.fillRect(3, 3, 10, 10, 7);
  assert.equal(tm.get(3, 3), 7);
  assert.equal(tm.get(4, 4), 7);
  // Out of bounds untouched (no exception).
});

test('tile-map: replaceAll swaps every matching cell', () => {
  const tm = TileMap.create({ width: 3, height: 3, data: [1, 2, 1, 3, 1, 2, 1, 3, 1] });
  const changed = tm.replaceAll(1, 9);
  assert.equal(changed, 5);
  assert.equal(tm.get(0, 0), 9);
  assert.equal(tm.get(1, 0), 2);
});

test('tile-map: floodFill replaces 4-connected region', () => {
  // Layout (0=floor, 1=wall):
  //   0 0 1 0
  //   0 0 1 0
  //   1 1 1 0
  //   0 0 0 0
  const tm = TileMap.create({
    width: 4,
    height: 4,
    data: [
      0, 0, 1, 0,
      0, 0, 1, 0,
      1, 1, 1, 0,
      0, 0, 0, 0,
    ],
  });
  const changed = tm.floodFill(0, 0, 5);
  assert.equal(changed, 4); // top-left 2x2 region
  assert.equal(tm.get(0, 0), 5);
  assert.equal(tm.get(1, 1), 5);
  // Right side untouched.
  assert.equal(tm.get(3, 0), 0);
});

test('tile-map: floodFill on identical replacement is a no-op', () => {
  const tm = TileMap.create({ width: 3, height: 3, defaultTile: 5 });
  const changed = tm.floodFill(1, 1, 5);
  assert.equal(changed, 0);
});

test('tile-map: floodFill out-of-bounds returns 0', () => {
  const tm = TileMap.create({ width: 3, height: 3 });
  assert.equal(tm.floodFill(-1, -1, 5), 0);
});

test('tile-map: forEach visits every cell once', () => {
  const tm = TileMap.create({ width: 3, height: 3, defaultTile: 1 });
  let count = 0;
  let sum = 0;
  tm.forEach((_x, _y, tile) => { count++; sum += tile; });
  assert.equal(count, 9);
  assert.equal(sum, 9);
});

test('tile-map: forEach throwing callback isolated', () => {
  const tm = TileMap.create({ width: 2, height: 2, defaultTile: 1 });
  let count = 0;
  tm.forEach((_x, _y, tile) => {
    count++;
    if (tile === 1 && count === 1) throw new Error('boom');
  });
  assert.equal(count, 4); // continued past throw
});

test('tile-map: findAll returns matching cells', () => {
  const tm = TileMap.create({
    width: 3, height: 3,
    data: [1, 2, 3, 2, 1, 2, 3, 2, 1],
  });
  const ones = tm.findAll((t) => t === 1);
  assert.equal(ones.length, 3);
  assert.deepEqual(ones.map((c) => c.x + ',' + c.y).sort(), ['0,0', '1,1', '2,2']);
});

test('tile-map: snapshot + fromSnapshot roundtrip', () => {
  const tm = TileMap.create({
    width: 4,
    height: 3,
    data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  });
  const snap = tm.toSnapshot();
  assert.equal(snap.width, 4);
  assert.equal(snap.height, 3);
  const restored = TileMap.fromSnapshot(snap);
  assert.ok(restored !== null);
  for (var i = 0; i < 12; i++) {
    var x = i % 4;
    var y = Math.floor(i / 4);
    assert.equal(restored!.get(x, y), tm.get(x, y));
  }
});

test('tile-map: fromSnapshot rejects malformed input', () => {
  // @ts-expect-error - testing runtime guard
  assert.equal(TileMap.fromSnapshot(null), null);
  // @ts-expect-error - testing runtime guard
  assert.equal(TileMap.fromSnapshot({ width: 'x' }), null);
  assert.equal(TileMap.fromSnapshot({ width: 5, height: 5, data: 'invalid-base64$$$' }), null);
});

test('tile-map: raw() exposes the underlying typed array', () => {
  const tm = TileMap.create({ width: 3, height: 3, defaultTile: 7 });
  const raw = tm.raw();
  assert.ok(raw instanceof Uint16Array);
  assert.equal(raw.length, 9);
  // Mutating raw mutates the map.
  raw[0] = 42;
  assert.equal(tm.get(0, 0), 42);
});
