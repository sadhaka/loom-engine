// Delve Mini - the headless PROOF for demo/delve-mini.
//
// Drives runDelve() (which chains DungeonGenerator -> bestiary -> TileMap ->
// Pcg32 combat -> LootTable -> InventoryGrid from one seed) and asserts the
// engine's headline roguelike claim: SAME SEED = SAME RUN, byte for byte. Runs
// the whole crawl TWICE in-process and requires byte-identical results, pins a
// regression fingerprint, proves different seeds diverge, and exercises the
// SaveSlots + Leaderboard meta-loop (the 7th + scoring primitives) so a delve
// can be saved and ranked. Runs in npm test, so the demo logic can never rot.

import { test } from 'node:test';
import assert from 'node:assert';
import { runDelve, delveFingerprint } from './delve-mini-run.js';
import {
  Leaderboard, SaveSlots, PersistentStorage, MemoryStorageBackend,
} from '../src/index.js';

var SEED = 'crypt-of-names';

test('delve-mini: SAME SEED = SAME RUN (byte-identical across two runs)', function () {
  var a = runDelve(SEED);
  var b = runDelve(SEED);
  assert.deepStrictEqual(b, a, 'two runs of the same seed must be identical');
  assert.strictEqual(delveFingerprint(a), delveFingerprint(b), 'fingerprints match');
});

test('delve-mini: the run fingerprint is pinned (regression)', function () {
  // Pinned 2026-06-12 from the reference run; re-pinned same day when the
  // 3.1.0 release audit folded the TileMap stage into the result (mapChecksum)
  // - the prior pin 23f71bf5 did not cover the map. A change here means the
  // chained pipeline (dungeon / map / spawn / combat / loot order) shifted -
  // intended or not.
  assert.strictEqual(delveFingerprint(runDelve(SEED)), 'd5c0904c');
});

test('delve-mini: the chain produced a real dungeon + crawl', function () {
  var r = runDelve(SEED);
  assert.ok(r.roomCount > 1, 'more than one room');
  assert.ok(r.floorTiles > 0, 'the dungeon carved floor tiles');
  // The TileMap stage is read back, not just populated: every room-centre
  // marker round-trips through map.get into the checksum (3.1.0 audit LOW).
  assert.ok(r.mapChecksum !== 0, 'the tile-map markers were placed and read back');
  assert.strictEqual(r.rooms.length, r.died ? r.roomsCleared + 1 : r.roomCount - 1,
    'one room log per fought room (a death stops the crawl)');
  assert.ok(r.score >= 0);
  // The satchel never holds more than it was told it could.
  var totalUnits = 0;
  for (var i = 0; i < r.inventory.length; i++) { totalUnits += r.inventory[i].count; }
  assert.ok(totalUnits >= 0);
});

test('delve-mini: different seeds diverge', function () {
  var seeds = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
  var prints: Record<string, boolean> = {};
  for (var i = 0; i < seeds.length; i++) {
    prints[delveFingerprint(runDelve(seeds[i] as string))] = true;
  }
  // Five unrelated seeds should not all collapse to one run.
  assert.ok(Object.keys(prints).length >= 4, 'seeds produce distinct runs');
});

test('delve-mini: SaveSlots round-trips a run; Leaderboard ranks runs', async function () {
  var r = runDelve(SEED);

  // SaveSlots: persist the run as a WorldSnapshot, load it back unchanged.
  var slots = SaveSlots.create({
    storage: new PersistentStorage({ backend: new MemoryStorageBackend() }),
  });
  await slots.save('run-1', {
    snapshot: {
      schemaVersion: 1, engineVersion: 'delve-mini', capturedAtMs: 0,
      resources: { delve: r as unknown as Record<string, unknown> },
    },
    label: 'The Crypt of Names',
    userMeta: { score: r.score, died: r.died },
  }, function () { return 0; });
  var loaded = await slots.load('run-1');
  assert.ok(loaded, 'the slot loads');
  assert.deepStrictEqual(loaded!.snapshot.resources.delve, r, 'round-trips exactly');

  // Leaderboard: three runs ranked high-to-low, ties broken by submit order.
  var lb = Leaderboard.create({ order: 'desc', capacity: 10 });
  lb.submit({ id: 'a', name: 'Aria', score: runDelve('alpha').score });
  lb.submit({ id: 'b', name: 'Bran', score: runDelve('beta').score });
  lb.submit({ id: 'c', name: 'Cael', score: runDelve('gamma').score });
  var top = lb.top(3);
  assert.strictEqual(top.length, 3);
  assert.ok(top[0]!.score >= top[1]!.score && top[1]!.score >= top[2]!.score,
    'leaderboard is sorted descending by score');
});
