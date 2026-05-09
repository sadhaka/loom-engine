// Phase 1.6.3 - DungeonGenerator tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  DungeonGenerator,
  RESOURCE_DUNGEON_GENERATOR,
} from '../src/index.js';

test('dg: RESOURCE_DUNGEON_GENERATOR is the stable string', () => {
  assert.equal(RESOURCE_DUNGEON_GENERATOR, 'dungeon_generator');
});

test('dg: generate returns a valid result shape', () => {
  const dg = DungeonGenerator.create({ seed: 'a', width: 32, height: 24 });
  const r = dg.generate();
  assert.equal(r.width, 32);
  assert.equal(r.height, 24);
  assert.ok(r.tiles instanceof Uint8Array);
  assert.equal(r.tiles.length, 32 * 24);
  assert.ok(Array.isArray(r.rooms));
  assert.ok(Array.isArray(r.corridors));
});

test('dg: same seed produces identical layout', () => {
  const a = DungeonGenerator.create({ seed: 'twin', width: 48, height: 32 });
  const b = DungeonGenerator.create({ seed: 'twin', width: 48, height: 32 });
  const ra = a.generate();
  const rb = b.generate();
  assert.equal(ra.rooms.length, rb.rooms.length);
  for (let i = 0; i < ra.tiles.length; i++) {
    assert.equal(ra.tiles[i], rb.tiles[i]);
  }
});

test('dg: different seeds produce different layouts', () => {
  const a = DungeonGenerator.create({ seed: 'one', width: 48, height: 32 });
  const b = DungeonGenerator.create({ seed: 'two', width: 48, height: 32 });
  const ra = a.generate();
  const rb = b.generate();
  let differences = 0;
  for (let i = 0; i < ra.tiles.length; i++) {
    if (ra.tiles[i] !== rb.tiles[i]) differences++;
  }
  assert.ok(differences > 50, 'most tiles differ');
});

test('dg: all rooms fit in bounds', () => {
  const dg = DungeonGenerator.create({ seed: 'b', width: 40, height: 30 });
  const r = dg.generate();
  for (let i = 0; i < r.rooms.length; i++) {
    const room = r.rooms[i]!;
    assert.ok(room.x >= 0);
    assert.ok(room.y >= 0);
    assert.ok(room.x + room.w <= 40);
    assert.ok(room.y + room.h <= 30);
  }
});

test('dg: produces at least 2 rooms in a reasonable space', () => {
  const dg = DungeonGenerator.create({ seed: 'c', width: 64, height: 48 });
  const r = dg.generate();
  assert.ok(r.rooms.length >= 2, 'at least 2 rooms: ' + r.rooms.length);
});

test('dg: rooms respect min/max size', () => {
  const dg = DungeonGenerator.create({
    seed: 'd', width: 64, height: 48,
    minRoomSize: 4, maxRoomSize: 8
  });
  const r = dg.generate();
  for (let i = 0; i < r.rooms.length; i++) {
    const room = r.rooms[i]!;
    assert.ok(room.w >= 4 && room.w <= 8, 'room w in [4,8]: ' + room.w);
    assert.ok(room.h >= 4 && room.h <= 8, 'room h in [4,8]: ' + room.h);
  }
});

test('dg: tiles only contain 0 and 1', () => {
  const dg = DungeonGenerator.create({ seed: 'e', width: 32, height: 32 });
  const r = dg.generate();
  for (let i = 0; i < r.tiles.length; i++) {
    const t = r.tiles[i]!;
    assert.ok(t === 0 || t === 1, 'tile in {0,1}: ' + t);
  }
});

test('dg: rooms render as floor (1)', () => {
  const dg = DungeonGenerator.create({ seed: 'f', width: 64, height: 48 });
  const r = dg.generate();
  for (let i = 0; i < r.rooms.length; i++) {
    const room = r.rooms[i]!;
    const cx = room.x + Math.floor(room.w / 2);
    const cy = room.y + Math.floor(room.h / 2);
    assert.equal(r.tiles[cy * r.width + cx], 1, 'room center is floor');
  }
});

test('dg: corridors connect rooms (every room reachable from rooms[0])', () => {
  // Flood-fill from rooms[0] center over floor tiles. All other room
  // centers must be reachable.
  const dg = DungeonGenerator.create({ seed: 'g', width: 64, height: 48 });
  const r = dg.generate();
  if (r.rooms.length < 2) return;
  const start = r.rooms[0]!;
  const sx = start.x + Math.floor(start.w / 2);
  const sy = start.y + Math.floor(start.h / 2);
  const visited = new Uint8Array(r.width * r.height);
  const queue: Array<[number, number]> = [[sx, sy]];
  visited[sy * r.width + sx] = 1;
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    const neighbors: Array<[number, number]> = [
      [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= r.width || ny < 0 || ny >= r.height) continue;
      if (visited[ny * r.width + nx]) continue;
      if (r.tiles[ny * r.width + nx] !== 1) continue;
      visited[ny * r.width + nx] = 1;
      queue.push([nx, ny]);
    }
  }
  for (let i = 1; i < r.rooms.length; i++) {
    const room = r.rooms[i]!;
    const cx = room.x + Math.floor(room.w / 2);
    const cy = room.y + Math.floor(room.h / 2);
    assert.equal(visited[cy * r.width + cx], 1,
                 'room ' + i + ' center reachable from room 0');
  }
});

test('dg: rejects width=0 / height=0', () => {
  assert.throws(function () {
    DungeonGenerator.create({ width: 0, height: 30 });
  });
  assert.throws(function () {
    DungeonGenerator.create({ width: 30, height: 0 });
  });
});

test('dg: numeric seed works', () => {
  const a = DungeonGenerator.create({ seed: 99, width: 32, height: 24 });
  const b = DungeonGenerator.create({ seed: 99, width: 32, height: 24 });
  const ra = a.generate();
  const rb = b.generate();
  for (let i = 0; i < ra.tiles.length; i++) {
    assert.equal(ra.tiles[i], rb.tiles[i]);
  }
});

test('dg: small map still produces at least one room', () => {
  const dg = DungeonGenerator.create({
    seed: 's', width: 16, height: 16,
    minLeafSize: 6, minRoomSize: 4, maxRoomSize: 6,
  });
  const r = dg.generate();
  assert.ok(r.rooms.length >= 1, 'at least one room: ' + r.rooms.length);
});

test('dg: floor count is reasonable (not 0 percent, not 100 percent)', () => {
  const dg = DungeonGenerator.create({ seed: 'h', width: 64, height: 48 });
  const r = dg.generate();
  let floor = 0;
  for (let i = 0; i < r.tiles.length; i++) if (r.tiles[i] === 1) floor++;
  const pct = floor / r.tiles.length;
  assert.ok(pct > 0.05 && pct < 0.6, 'floor between 5% and 60%: ' + pct);
});
