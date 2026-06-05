// WorldSession lifecycle tests - v3.0 Phase 4.
//
// Pins the golden vector (snapshot verify -> HMAC tail verify -> recorded-mutation
// reducer -> bounded catch-up) AND covers the fail-closed gates directly: a
// corrupted snapshot, a tampered chain tail, and time-travel are all rejected; the
// reducer reconstructs tickEpoch's own output; and a no-tail resume just catches up.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resume, suspend } from '../src/runtime/world-session.js';
import { EventChain } from '../src/runtime/event-chain.js';
import { worldStateHash } from '../src/runtime/world-state-snapshot.js';

var here = dirname(fileURLToPath(import.meta.url));
var vec = JSON.parse(readFileSync(join(here, '..', 'test_vectors', 'v3_4_world_session.json'), 'utf8'));

function doResume(bundle: unknown, currentEpoch: number) {
  var i = vec.inputs;
  return resume({ key: i.key, bundle: bundle as never, currentEpoch: currentEpoch, ruleset: i.ruleset, proposalsByEpoch: i.proposalsByEpoch, maxCatchup: i.maxCatchup, actorTags: i.actorTags });
}

test('golden vector: resume reproduces the pinned pipeline', function () {
  var i = vec.inputs;
  var r = doResume(i.bundle, i.currentEpoch);
  assert.strictEqual(r.state.epoch, vec.expect.final_epoch, 'final epoch');
  assert.strictEqual(r.epochsResolved, vec.expect.epochsResolved, 'epochsResolved');
  assert.strictEqual(r.epochsVoided, vec.expect.epochsVoided, 'epochsVoided');
  assert.strictEqual(r.newEvents.length, vec.expect.newEvents_count, 'newEvents count');
  assert.strictEqual(worldStateHash(i.key, r.state), vec.expect.final_state_hash, 'final state hash');
  assert.strictEqual(worldStateHash(i.key, r.newEvents), vec.expect.newEvents_hash, 'newEvents hash');
  assert.strictEqual(vec.expect.tail_reducer_equals_tick, true, 'reducer reconstructs tickEpoch output');
});

test('fail-closed: a corrupted snapshot is rejected', function () {
  var tampered = JSON.parse(JSON.stringify(vec.inputs.bundle));
  tampered.snapshot.state.entities.faction_1.properties.power = 999; // hash no longer matches
  assert.throws(function () { doResume(tampered, vec.inputs.currentEpoch); }, /corrupted snapshot/);
});

test('fail-closed: a tampered chain tail is rejected', function () {
  var tampered = JSON.parse(JSON.stringify(vec.inputs.bundle));
  // mutate the signed event payload without re-signing -> sig mismatch
  tampered.chainTail[0].payload.epoch_number = 999;
  assert.throws(function () { doResume(tampered, vec.inputs.currentEpoch); }, /chain tamper/);
});

test('fail-closed: time travel (currentEpoch < state.epoch) is rejected', function () {
  // after replaying the tail the world is at epoch 6; a clock at 0 is time-travel
  assert.throws(function () { doResume(vec.inputs.bundle, 0); }, /time travel/);
});

test('no-tail resume: a current snapshot just catches up', function () {
  var i = vec.inputs;
  var state = { epoch: 2, worldSeed: 0, entities: { faction_1: { properties: { power: 0 }, tags: ['faction'] } } };
  var chain = EventChain.create({ key: i.key, genesis: 'g' }); // empty chain -> empty tail
  var bundle = suspend({ key: i.key, worldId: 'w', snapshotState: state, snapshotEventIndex: 0, chain: chain });
  assert.strictEqual(bundle.chainTail.length, 0, 'no tail');
  var r = resume({ key: i.key, bundle: bundle, currentEpoch: 4, ruleset: i.ruleset, proposalsByEpoch: { '3': { faction_1: { actionId: 'rest' } }, '4': { faction_1: { actionId: 'rest' } } }, maxCatchup: 10, actorTags: ['faction'] });
  assert.strictEqual(r.epochsResolved, 2, 'caught up 2 epochs');
  assert.strictEqual(r.epochsVoided, 0, 'none voided');
  assert.strictEqual(r.state.epoch, 4, 'advanced to clock');
});
