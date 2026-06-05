// WorldReplay tests - v3.0 Phase 1.
//
// A toy deterministic reducer (apply an integer property delta) stands in for
// the real game/ruleset reducer, so we can prove the engine-level guarantees:
// reconstruct-from-snapshot equals full replay, the property holds at every
// snapshot point, a tampered snapshot is caught, a NON-pure reducer fails the
// equivalence check, AND an ABSOLUTE-INDEX reducer stays equivalent (audit P1
// regression: the slice-local index bug broke exactly this).

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
  var r = replayFromSnapshot('k', snapAt2, 2, events.slice(2), toyReducer);
  assert.strictEqual(r.headHash, worldStateHash('k', head));
});

test('snapshot+replay == full replay at EVERY snapshot point', function () {
  for (var k = 0; k <= events.length; k++) {
    assert.strictEqual(
      verifyReplayEquivalence('k', genesis, events, k, toyReducer), true, 'k=' + k);
  }
});

test('REGRESSION (audit P1): an ABSOLUTE-INDEX reducer stays equivalent at every snapshot point', function () {
  // Folds the absolute event index into state - the exact case the slice-local
  // index bug broke. Full replay sums 0+1+2+3+4=10; snapshot+tail must also sum
  // to 10 at every k (the tail is numbered from snapshotIndex, not restarted).
  function indexReducer(state: WorldState, _ev: DeltaEvent, index: number): WorldState {
    var next: WorldState = JSON.parse(JSON.stringify(state));
    var ent = next.entities.acc;
    if (!ent) { ent = { properties: { sum: 0 }, tags: [] }; next.entities.acc = ent; }
    ent.properties.sum = (ent.properties.sum || 0) + index;
    return next;
  }
  for (var k = 0; k <= events.length; k++) {
    assert.strictEqual(
      verifyReplayEquivalence('k', genesis, events, k, indexReducer), true,
      'absolute-index equivalence broke at k=' + k);
  }
});

test('a tampered snapshot diverges the head hash (the cheat is caught)', function () {
  var snapAt2 = replayEvents(genesis, events.slice(0, 2), toyReducer);
  var good = replayFromSnapshot('k', snapAt2, 2, events.slice(2), toyReducer);
  var tampered: WorldState = JSON.parse(JSON.stringify(snapAt2));
  (tampered.entities.hero as { properties: Record<string, number> }).properties.hp += 1000;
  var bad = replayFromSnapshot('k', tampered, 2, events.slice(2), toyReducer);
  assert.notStrictEqual(bad.headHash, good.headHash);
});

test('a NON-pure reducer fails the equivalence check (the bug class it catches)', function () {
  var counter = 0;
  function impureReducer(state: WorldState, ev: DeltaEvent): WorldState {
    counter++; // external mutable dependency - NOT a pure function of (state,event,index)
    var next: WorldState = JSON.parse(JSON.stringify(state));
    var ent = next.entities[ev.id];
    if (!ent) { ent = { properties: {}, tags: [] }; next.entities[ev.id] = ent; }
    ent.properties[ev.prop] = (ent.properties[ev.prop] || 0) + ev.delta + counter;
    return next;
  }
  assert.strictEqual(
    verifyReplayEquivalence('k', genesis, events, 2, impureReducer), false);
});

test('replayEvents rejects a non-function reducer + a negative startIndex; empty events = base unchanged', function () {
  assert.throws(function () { replayEvents(genesis, events, null as unknown as (s: WorldState, e: DeltaEvent, i: number) => WorldState); });
  assert.throws(function () { replayEvents(genesis, events, toyReducer, -1); });
  var r = replayFromSnapshot('k', genesis, 0, [], toyReducer);
  assert.strictEqual(r.headHash, worldStateHash('k', genesis));
});

test('verifyReplayEquivalence rejects an out-of-range snapshotIndex', function () {
  assert.throws(function () { verifyReplayEquivalence('k', genesis, events, -1, toyReducer); });
  assert.throws(function () { verifyReplayEquivalence('k', genesis, events, events.length + 1, toyReducer); });
});
