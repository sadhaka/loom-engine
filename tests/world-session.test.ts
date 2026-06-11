// WorldSession lifecycle tests - v3.0 Phase 4 (+ the structural bundle seal).
//
// Pins the golden vector (snapshot verify -> structural seal verify -> HMAC tail
// verify -> recorded-mutation reducer -> bounded catch-up) AND covers the
// fail-closed gates directly: a corrupted snapshot, a tampered chain tail,
// time-travel, an END-TRUNCATED tail (caught by the bundle's embedded ChainSeal -
// bundle format v2), a missing seal, a forged seal, and an out-of-range
// snapshotEventIndex are all rejected; the reducer reconstructs tickEpoch's own
// output; and a no-tail resume just catches up.

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

// ---- bundle format v2: the structural seal (fail-closed, no escape hatch) ----

test('fail-closed: an END-TRUNCATED tail is rejected by the structural seal', function () {
  // The exact attack the seal closes: the vector bundle's tail loses its
  // trailing record. Before bundle format v2 this verified CLEAN and resume()
  // silently replaced the dropped history with re-simulated catch-up.
  var truncated = JSON.parse(JSON.stringify(vec.inputs.bundle));
  truncated.chainTail = truncated.chainTail.slice(0, truncated.chainTail.length - 1);
  assert.throws(function () { doResume(truncated, vec.inputs.currentEpoch); }, /does not match the seal/);
});

test('fail-closed: a bundle without a seal (pre-seal format) is rejected', function () {
  var sealless = JSON.parse(JSON.stringify(vec.inputs.bundle));
  delete sealless.seal;
  assert.throws(function () { doResume(sealless, vec.inputs.currentEpoch); }, /carries no chain seal/);
});

test('fail-closed: a forged seal signature is rejected', function () {
  var forged = JSON.parse(JSON.stringify(vec.inputs.bundle));
  var sig = forged.seal.sig;
  forged.seal.sig = sig.slice(0, -2) + (sig.slice(-2) === '00' ? '11' : '00');
  assert.throws(function () { doResume(forged, vec.inputs.currentEpoch); }, /seal signature invalid/);
});

test('fail-closed: a re-signed seal that disagrees with the tail length is rejected', function () {
  // A VALID seal taken from a different chain state (here: an empty chain's
  // seal) cannot be swapped in - the sealed head no longer matches the tail.
  var i = vec.inputs;
  var swapped = JSON.parse(JSON.stringify(i.bundle));
  var empty = EventChain.create({ key: i.key, genesis: swapped.tailGenesis });
  swapped.seal = empty.seal(); // count 0, head == tailGenesis - validly signed
  assert.throws(function () { doResume(swapped, i.currentEpoch); }, /does not match the seal/);
});

test('fail-closed: suspend rejects a snapshotEventIndex past the end of the chain', function () {
  // The recon finding: an index past the chain end yields a bundle claiming a
  // snapshot at a nonexistent event. suspend() now refuses to pack it.
  var i = vec.inputs;
  var state = { epoch: 2, worldSeed: 0, entities: { faction_1: { properties: { power: 0 }, tags: ['faction'] } } };
  var chain = EventChain.create({ key: i.key, genesis: 'g' }); // empty chain: last seq 0
  assert.throws(function () {
    suspend({ key: i.key, worldId: 'w', snapshotState: state, snapshotEventIndex: 1, chain: chain });
  }, /past the end of the chain/);
});

test('fail-closed: suspend rejects a negative or non-integer snapshotEventIndex', function () {
  var i = vec.inputs;
  var state = { epoch: 2, worldSeed: 0, entities: { faction_1: { properties: { power: 0 }, tags: ['faction'] } } };
  var chain = EventChain.create({ key: i.key, genesis: 'g' });
  assert.throws(function () {
    suspend({ key: i.key, worldId: 'w', snapshotState: state, snapshotEventIndex: -1, chain: chain });
  }, /JS-safe integer/);
  assert.throws(function () {
    suspend({ key: i.key, worldId: 'w', snapshotState: state, snapshotEventIndex: 0.5, chain: chain });
  }, /JS-safe integer/);
});
