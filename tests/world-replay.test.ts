// WorldReplay tests - v3.0 Phase 1.
//
// A toy deterministic reducer (apply an integer property delta) stands in for
// the real game/ruleset reducer, so we can prove the engine-level guarantees:
// reconstruct-from-snapshot equals full replay, the property holds at every
// snapshot point, a tampered snapshot is caught, and a NON-pure reducer fails
// the equivalence check (the determinism-violation bug class it exists to catch).

import { test } from 'node:test';
import assert from 'node:assert';
import type { WorldState } from '../src/runtime/world-state-snapshot.js';
import { worldStateHash } from '../src/runtime/world-state-snapshot.js';
import {
  replayEvents,
  replayFromSnapshot,
  verifyReplayEquivalence,
} from '../src/runtime/world-replay.js';

interface DeltaEvent { id: string; prop: string; delta: number; }

// Pure, integer-only reducer: entities[id].properties[prop] += delta.
function toyReducer(state: WorldState, ev: DeltaEvent): WorldState {
  var next: WorldState = JSON.parse(JSON.stringify(state));
  var ent = next.entities[ev.id];
  if (!ent) { ent = { properties: {}, tags: [] }; next.entities[ev.id] = ent; }
  ent.properties[ev.prop] = (ent.properties[ev.prop] || 0) + ev.delta;
  return next;
}

var genesis: WorldState = { epoch: 0, worldSeed: 1, entities: {} };
var events: DeltaEvent[] = [
  { id: 'hero', prop: 'hp', delta: 30 },
  { id: 'hero', prop: 'hp', delta: -5 },
  { id: 'goblin', prop: 'hp', delta: 7 },
  { id: 'hero', prop: 'xp', delta: 100 },
  { id: 'goblin', prop: 'hp', delta: -7 },
];

test('replayFromSnapshot reconstructs the same head as full replay', function () {
  var head = replayEvents(genesis, events, toyReducer);
  var snapAt2 = replayEvents(genesis, events.slice(0, 2), toyReducer);
  var r = replayFromSnapshot('k', snapAt2, events.slice(2), toyReducer);
  assert.strictEqual(r.headHash, worldStateHash('k', head));
});

test('snapshot+replay == full replay at EVERY snapshot point', function () {
  for (var k = 0; k <= events.length; k++) {
    assert.strictEqual(
      verifyReplayEquivalence('k', genesis, events, k, toyReducer), true, 'k=' + k);
  }
});

test('a tampered snapshot diverges the head hash (the cheat is caught)', function () {
  var snapAt2 = replayEvents(genesis, events.slice(0, 2), toyReducer);
  var good = replayFromSnapshot('k', snapAt2, events.slice(2), toyReducer);
  var tampered: WorldState = JSON.parse(JSON.stringify(snapAt2));
  (tampered.entities.hero as { properties: Record<string, number> }).properties.hp += 1000;
  var bad = replayFromSnapshot('k', tampered, events.slice(2), toyReducer);
  assert.notStrictEqual(bad.headHash, good.headHash);
});

test('a NON-pure reducer fails the equivalence check (the bug class it catches)', function () {
  var counter = 0;
  function impureReducer(state: WorldState, ev: DeltaEvent): WorldState {
    counter++; // external mutable dependency - NOT a pure function of (state,event)
    var next: WorldState = JSON.parse(JSON.stringify(state));
    var ent = next.entities[ev.id];
    if (!ent) { ent = { properties: {}, tags: [] }; next.entities[ev.id] = ent; }
    ent.properties[ev.prop] = (ent.properties[ev.prop] || 0) + ev.delta + counter;
    return next;
  }
  assert.strictEqual(
    verifyReplayEquivalence('k', genesis, events, 2, impureReducer), false);
});

test('replayEvents rejects a non-function reducer; empty events = base unchanged', function () {
  assert.throws(function () { replayEvents(genesis, events, null as unknown as (s: WorldState, e: DeltaEvent, i: number) => WorldState); });
  var r = replayFromSnapshot('k', genesis, [], toyReducer);
  assert.strictEqual(r.headHash, worldStateHash('k', genesis));
});

test('verifyReplayEquivalence rejects an out-of-range snapshotIndex', function () {
  assert.throws(function () { verifyReplayEquivalence('k', genesis, events, -1, toyReducer); });
  assert.throws(function () { verifyReplayEquivalence('k', genesis, events, events.length + 1, toyReducer); });
});
