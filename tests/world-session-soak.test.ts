// WorldSession SOAK tests - v3.5 (persistence + partial sync PROVEN).
//
// Re-executes the five long-horizon golden cases from
// test_vectors/v3_5_session_soak.json against the live TS core:
//
//   S1 - 120-epoch catch-up, run BOTH single-shot and in four 30-epoch chunks,
//        pinned to be byte-identical (catch-up COMPOSABILITY) with 30/60/90
//        checkpoint hashes - long-horizon PRNG/order/accumulation stability.
//   S2 - the zero-catch-up resume boundary (currentEpoch == post-tail epoch),
//        one epoch across the boundary, MID-CHAIN suspend (snapshotEventIndex 2)
//        snapshot-position independence, plus the time-travel rejection.
//   S3 - THE composed flow the audit flagged as never run: three
//        suspend -> resume -> append-newEvents-to-the-ONE-chain -> re-suspend
//        cycles, pinned per cycle, equal to one 21-epoch resume.
//   S4 - the accumulated 21-record chain sealed + verified across the whole gap,
//        AND the negative space: tail truncation WITHOUT a seal verifies CLEAN
//        (the documented WorldBundle truncation hole - resume() cannot detect a
//        dropped tail because the bundle carries no ChainSeal), WITH the seal it
//        is caught (seal_mismatch), and a flipped recorded mutation is a
//        sig_mismatch.
//   S5 - void-at-scale (100 of 500 resolved, 400 voided) and a deterministic
//        SECOND resume across the void boundary.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resume, suspend } from '../src/runtime/world-session.js';
import { catchUpEpochs, type EpochResolvedEvent } from '../src/runtime/world-epoch.js';
import { EventChain } from '../src/runtime/event-chain.js';
import { worldStateHash } from '../src/runtime/world-state-snapshot.js';

var here = dirname(fileURLToPath(import.meta.url));
var vec = JSON.parse(readFileSync(join(here, '..', 'test_vectors', 'v3_5_session_soak.json'), 'utf8'));

function byKind(kind: string) {
  for (var i = 0; i < vec.cases.length; i++) {
    if (vec.cases[i].kind === kind) return vec.cases[i];
  }
  throw new Error('soak vector case missing: ' + kind);
}

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

// ---- S1 ----------------------------------------------------------------------

test('S1 soak: 120-epoch single-shot catch-up reproduces the pinned hashes', function () {
  var c = byKind('soak_catchup');
  var r = catchUpEpochs({ worldId: c.worldId, state: c.state, currentEpoch: c.currentEpoch, maxCatchup: c.maxCatchup, ruleset: c.ruleset, proposalsByEpoch: c.proposalsByEpoch, actorTags: c.actorTags });
  assert.strictEqual(r.epochsResolved, c.expect.epochsResolved, 'epochsResolved');
  assert.strictEqual(r.epochsVoided, c.expect.epochsVoided, 'epochsVoided');
  assert.strictEqual(r.state.epoch, c.expect.final_epoch, 'final epoch');
  assert.strictEqual(r.events.length, c.expect.newEvents_count, 'event count');
  assert.strictEqual(worldStateHash(c.key, r.events), c.expect.events_hash, 'events hash');
  assert.strictEqual(worldStateHash(c.key, r.state), c.expect.final_state_hash, 'final state hash');
});

test('S1 soak: chunked catch-up (4 x 30) equals single-shot, checkpoint-pinned', function () {
  var c = byKind('soak_catchup');
  assert.strictEqual(c.expect.chunked_equals_single, true, 'generator pinned composability');
  var work = c.state;
  var allEvents: unknown[] = [];
  for (var i = 0; i < c.chunk_stops.length; i++) {
    var stop = c.chunk_stops[i];
    var r = catchUpEpochs({ worldId: c.worldId, state: work, currentEpoch: stop, maxCatchup: c.maxCatchup, ruleset: c.ruleset, proposalsByEpoch: c.proposalsByEpoch, actorTags: c.actorTags });
    work = r.state;
    for (var e = 0; e < r.events.length; e++) allEvents.push(r.events[e]);
    assert.strictEqual(worldStateHash(c.key, work), c.expect.checkpoint_state_hashes[String(stop)], 'checkpoint hash @ epoch ' + stop);
  }
  assert.strictEqual(worldStateHash(c.key, work), c.expect.final_state_hash, 'chunked final == single-shot final');
  assert.strictEqual(worldStateHash(c.key, allEvents), c.expect.events_hash, 'chunked events == single-shot events');
  assert.strictEqual(allEvents.length, c.expect.newEvents_count, 'chunked event count');
});

// ---- S2 ----------------------------------------------------------------------

test('S2 soak: resume at the post-tail epoch is a zero-catch-up no-op', function () {
  var c = byKind('boundary');
  var r = resume({ key: c.key, bundle: c.bundleA, currentEpoch: c.expect.a.currentEpoch, ruleset: c.ruleset, proposalsByEpoch: c.proposalsByEpoch, maxCatchup: c.maxCatchup, actorTags: c.actorTags });
  assert.strictEqual(r.epochsResolved, c.expect.a.epochsResolved, 'epochsResolved');
  assert.strictEqual(r.epochsVoided, c.expect.a.epochsVoided, 'epochsVoided');
  assert.strictEqual(r.newEvents.length, c.expect.a.newEvents_count, 'no new events');
  assert.strictEqual(worldStateHash(c.key, r.state), c.expect.a.resumed_state_hash, 'resumed hash');
  // The tail-replayed resume lands EXACTLY on the live epoch-13 state hash.
  assert.strictEqual(c.expect.a.resumed_state_hash, c.expect.live_epoch13_state_hash, 'resumed == live');
});

test('S2 soak: one epoch across the suspend boundary', function () {
  var c = byKind('boundary');
  var r = resume({ key: c.key, bundle: c.bundleA, currentEpoch: c.expect.b.currentEpoch, ruleset: c.ruleset, proposalsByEpoch: c.proposalsByEpoch, maxCatchup: c.maxCatchup, actorTags: c.actorTags });
  assert.strictEqual(r.epochsResolved, c.expect.b.epochsResolved, 'epochsResolved');
  assert.strictEqual(r.state.epoch, c.expect.b.final_epoch, 'final epoch');
  assert.strictEqual(worldStateHash(c.key, r.state), c.expect.b.final_state_hash, 'final hash');
});

test('S2 soak: mid-chain suspend is snapshot-position independent', function () {
  var c = byKind('boundary');
  assert.strictEqual(c.bundleC.chainTail.length, c.expect.c.tail_length, 'mid-chain tail length');
  assert.strictEqual(c.bundleC.snapshot.eventIndex, 2, 'snapshot taken mid-chain');
  var r = resume({ key: c.key, bundle: c.bundleC, currentEpoch: c.expect.c.currentEpoch, ruleset: c.ruleset, proposalsByEpoch: c.proposalsByEpoch, maxCatchup: c.maxCatchup, actorTags: c.actorTags });
  assert.strictEqual(worldStateHash(c.key, r.state), c.expect.c.final_state_hash, 'mid-chain resume hash');
  // The SAME final hash as bundle A (suspend at index 0): where the snapshot was
  // taken along the chain does not change the resumed world.
  assert.strictEqual(c.expect.c.final_state_hash, c.expect.b.final_state_hash, 'C == B');
  assert.strictEqual(c.expect.c.snapshot_position_independent, true, 'pinned independence');
});

test('S2 soak: a clock behind the replayed tail is time-travel (fail-closed)', function () {
  var c = byKind('boundary');
  // After replaying bundle A's 3-event tail the world is at epoch 13; a clock at
  // 12 must throw AFTER tail replay (the guard runs post-reduce).
  assert.throws(function () {
    resume({ key: c.key, bundle: c.bundleA, currentEpoch: 12, ruleset: c.ruleset, proposalsByEpoch: c.proposalsByEpoch, maxCatchup: c.maxCatchup, actorTags: c.actorTags });
  }, /time travel/);
});

// ---- S3 ----------------------------------------------------------------------

test('S3 soak: three suspend/resume cycles on ONE chain, pinned per cycle', function () {
  var c = byKind('cycles');
  var chain = EventChain.create<EpochResolvedEvent>({ key: c.key, genesis: c.genesis });
  var bundle = c.bundle0;
  for (var k = 0; k < c.cycle_count; k++) {
    var exp = c.expect.cycles[k];
    var r = resume({ key: c.key, bundle: bundle, currentEpoch: exp.currentEpoch, ruleset: c.ruleset, proposalsByEpoch: c.proposalsByEpoch, maxCatchup: c.maxCatchup, actorTags: c.actorTags });
    assert.strictEqual(r.epochsResolved, exp.epochsResolved, 'cycle ' + k + ' resolved');
    assert.strictEqual(r.epochsVoided, exp.epochsVoided, 'cycle ' + k + ' voided');
    // The composed flow the audit flagged: every resume newEvent goes BACK onto
    // the persistent chain before the world re-suspends.
    for (var e = 0; e < r.newEvents.length; e++) {
      var rec = chain.append('EpochResolved', r.newEvents[e]);
      assert.ok(rec, 'cycle ' + k + ' event ' + e + ' appended');
    }
    assert.strictEqual(worldStateHash(c.key, r.state), exp.state_hash, 'cycle ' + k + ' state hash');
    assert.strictEqual(chain.size(), exp.chain_record_count, 'cycle ' + k + ' chain count');
    assert.strictEqual(chain.head(), exp.chain_head_sig, 'cycle ' + k + ' chain head');
    bundle = suspend({ key: c.key, worldId: c.worldId, snapshotState: r.state, snapshotEventIndex: chain.size(), chain: chain });
    assert.strictEqual(bundle.chainTail.length, 0, 'cycle ' + k + ' re-suspend has a current snapshot');
  }
  assert.strictEqual(c.expect.cycles[c.cycle_count - 1].state_hash, c.expect.final_state_hash, 'last cycle == final');
});

test('S3 soak: one 21-epoch resume equals the three cycles', function () {
  var c = byKind('cycles');
  assert.strictEqual(c.expect.one_shot_equals_cycles, true, 'generator pinned equivalence');
  var r = resume({ key: c.key, bundle: c.bundle0, currentEpoch: c.expect.final_epoch, ruleset: c.ruleset, proposalsByEpoch: c.proposalsByEpoch, maxCatchup: c.one_shot_maxCatchup, actorTags: c.actorTags });
  assert.strictEqual(r.epochsResolved, 21, 'all 21 resolved');
  assert.strictEqual(r.state.epoch, c.expect.final_epoch, 'final epoch');
  assert.strictEqual(worldStateHash(c.key, r.state), c.expect.final_state_hash, 'one-shot final hash');
});

// ---- S4 ----------------------------------------------------------------------

test('S4 soak: the 21-record chain seals and verifies across the whole gap', function () {
  var c = byKind('chain_seal');
  assert.strictEqual(c.records.length, c.expect.seal_count, 'record count');
  assert.strictEqual(worldStateHash(c.key, c.records), c.expect.records_hash, 'records hash');
  var seal = { count: c.expect.seal_count, head: c.expect.seal_head, sig: c.expect.seal_sig };
  assert.strictEqual(EventChain.verifySeal(c.key, seal), true, 'seal self-verifies');
  var res = EventChain.verifyRecords(c.key, c.records, c.genesis, seal);
  assert.strictEqual(res.ok, c.expect.full_chain_verify_ok, 'full chain + seal verify');
  assert.strictEqual(res.total, c.expect.seal_count, 'verified total');
  // The seal head IS the last record's signature.
  assert.strictEqual(c.expect.seal_head, c.records[c.records.length - 1].sig, 'seal head == chain head');
});

test('S4 soak: tail truncation WITHOUT a seal verifies CLEAN (the documented hole)', function () {
  var c = byKind('chain_seal');
  var truncated = clone(c.records).slice(0, c.records.length - 1);
  // verifyRecords alone CANNOT see records dropped off the END - and WorldBundle
  // carries no ChainSeal, so resume() silently accepts a tail-truncated bundle
  // (recorded history replaced by re-simulated catch-up). This pin is the
  // regression net: it documents the hole until WorldBundle grows a seal field.
  var res = EventChain.verifyRecords(c.key, truncated, c.genesis);
  assert.strictEqual(res.ok, true, 'truncated tail verifies clean without a seal');
  assert.strictEqual(res.total, c.records.length - 1, 'one record silently gone');
});

test('S4 soak: tail truncation WITH the seal is caught (seal_mismatch)', function () {
  var c = byKind('chain_seal');
  var truncated = clone(c.records).slice(0, c.records.length - 1);
  var seal = { count: c.expect.seal_count, head: c.expect.seal_head, sig: c.expect.seal_sig };
  var res = EventChain.verifyRecords(c.key, truncated, c.genesis, seal);
  assert.strictEqual(res.ok, false, 'seal catches the dropped tail');
  var reasons: string[] = [];
  for (var i = 0; i < res.mismatches.length; i++) reasons.push(res.mismatches[i].reason);
  assert.ok(reasons.indexOf('seal_mismatch') !== -1, 'reason is seal_mismatch');
});

test('S4 soak: a flipped recorded mutation in a middle cycle is a sig_mismatch', function () {
  var c = byKind('chain_seal');
  var tampered = clone(c.records);
  // Record 10 (seq 10, epoch 10, second cycle) carries gain_power mutations -
  // flip one recorded `next` without re-signing.
  var entry = tampered[9].payload.actions_processed[0];
  assert.ok(Array.isArray(entry.mutations_applied) && entry.mutations_applied.length > 0, 'target record has mutations');
  entry.mutations_applied[0].next = entry.mutations_applied[0].next + 1;
  var res = EventChain.verifyRecords(c.key, tampered, c.genesis);
  assert.strictEqual(res.ok, false, 'tamper detected');
  var hit = false;
  for (var i = 0; i < res.mismatches.length; i++) {
    if (res.mismatches[i].seq === 10 && res.mismatches[i].reason === 'sig_mismatch') hit = true;
  }
  assert.ok(hit, 'sig_mismatch at seq 10');
});

// ---- S5 ----------------------------------------------------------------------

test('S5 soak: void at scale - resolve 100 of 500, 400 lost to the void', function () {
  var c = byKind('void');
  var r = resume({ key: c.key, bundle: c.bundle1, currentEpoch: c.first.currentEpoch, ruleset: c.ruleset, proposalsByEpoch: c.proposalsByEpoch1, maxCatchup: c.first.maxCatchup, actorTags: c.actorTags });
  assert.strictEqual(r.epochsResolved, c.expect.first.epochsResolved, 'epochsResolved');
  assert.strictEqual(r.epochsVoided, c.expect.first.epochsVoided, 'epochsVoided');
  assert.strictEqual(r.state.epoch, c.expect.first.final_epoch, 'final epoch');
  assert.strictEqual(r.newEvents.length, c.expect.first.newEvents_count, 'event count');
  assert.strictEqual(worldStateHash(c.key, r.newEvents), c.expect.first.events_hash, 'events hash');
  assert.strictEqual(worldStateHash(c.key, r.state), c.expect.first.final_state_hash, 'final state hash');
});

test('S5 soak: a SECOND resume across the void boundary is deterministic', function () {
  var c = byKind('void');
  // Re-derive the post-void bundle from the first resume (the live flow), then
  // check it matches the vector's stored bundle2 before resuming across the void.
  var r1 = resume({ key: c.key, bundle: c.bundle1, currentEpoch: c.first.currentEpoch, ruleset: c.ruleset, proposalsByEpoch: c.proposalsByEpoch1, maxCatchup: c.first.maxCatchup, actorTags: c.actorTags });
  var chain = EventChain.create<EpochResolvedEvent>({ key: c.key, genesis: c.bundle2.tailGenesis });
  var rebuilt = suspend({ key: c.key, worldId: c.worldId, snapshotState: r1.state, snapshotEventIndex: 0, chain: chain });
  assert.strictEqual(rebuilt.snapshot.stateHash, c.bundle2.snapshot.stateHash, 'rebuilt bundle matches the stored post-void bundle');

  var r2 = resume({ key: c.key, bundle: c.bundle2, currentEpoch: c.second.currentEpoch, ruleset: c.ruleset, proposalsByEpoch: c.proposalsByEpoch2, maxCatchup: c.second.maxCatchup, actorTags: c.actorTags });
  assert.strictEqual(r2.epochsResolved, c.expect.second.epochsResolved, 'epochsResolved');
  assert.strictEqual(r2.epochsVoided, c.expect.second.epochsVoided, 'epochsVoided');
  assert.strictEqual(r2.state.epoch, c.expect.second.final_epoch, 'final epoch');
  assert.strictEqual(r2.newEvents.length, c.expect.second.newEvents_count, 'event count');
  assert.strictEqual(worldStateHash(c.key, r2.newEvents), c.expect.second.events_hash, 'events hash');
  assert.strictEqual(worldStateHash(c.key, r2.state), c.expect.second.final_state_hash, 'final state hash');
});
