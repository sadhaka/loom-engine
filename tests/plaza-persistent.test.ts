// Plaza-persistent tests - v6.1 (persistence + partial sync, end to end).
//
// Re-drives the ENTIRE demo/plaza-persistent scenario headlessly from the
// canonical vector via src imports - build, live epochs on the HMAC chain,
// suspend (the bundle carries its STRUCTURAL seal, bundle format v2), resume
// (verify + replay + 12 offline epochs), partition, leaves, diffRegionLeaves,
// applyPartialSync - and asserts every pinned stage hash. The demo page cannot import src/ (rootDir) and this test cannot
// resolve the demo's importmap specifier in Node, so the VECTOR is the shared
// contract: same inputs, same pinned hashes, driven twice (exactly how
// world-session.test.ts and golden_session.rs already share v3_4).
//
// Also asserts demo/plaza-persistent/vector.json is byte-identical to the
// canonical test_vectors copy (the shipped demo can never drift from what npm
// test proves), the whole run is deterministic (driven twice in-process,
// byte-identical), and the fail-closed negative paths: corrupted snapshot,
// tampered tail, TRUNCATED tail caught by the seal (a bare hash chain cannot
// see truncation), a tampered seal, a tampered pulled region, and a stale
// cached region caught by the root recompute.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventChain, canonicalJson } from '../src/runtime/event-chain.js';
import { tickEpoch } from '../src/runtime/world-epoch.js';
import type { ProposalMap, EpochResolvedEvent } from '../src/runtime/world-epoch.js';
import { suspend, resume, replayEpochEvent } from '../src/runtime/world-session.js';
import type { WorldBundle } from '../src/runtime/world-session.js';
import { worldStateHash } from '../src/runtime/world-state-snapshot.js';
import { regionLeaves, globalRegionHash } from '../src/runtime/region-hash.js';
import { partitionRegions, diffRegionLeaves, applyPartialSync } from '../src/runtime/region-sync.js';

var here = dirname(fileURLToPath(import.meta.url));
var canonicalPath = join(here, '..', 'test_vectors', 'v6_1_plaza_persistent.json');
var demoCopyPath = join(here, '..', 'demo', 'plaza-persistent', 'vector.json');
var vec = JSON.parse(readFileSync(canonicalPath, 'utf8'));

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

// Drive the full scenario once from the vector's literal inputs. Returns every
// stage product so the tests can pin each one.
function runScenario() {
  var i = vec.inputs;

  // (1) BUILD
  var s0 = JSON.parse(JSON.stringify(i.s0));

  // (2) LIVE PLAY - epochs 1..2 onto the HMAC chain.
  var t1 = tickEpoch({ worldId: i.worldId, state: s0, epochNumber: 1, proposals: i.liveProposalsByEpoch['1'] as ProposalMap, ruleset: i.ruleset, actorTags: i.actorTags });
  var t2 = tickEpoch({ worldId: i.worldId, state: t1.state, epochNumber: 2, proposals: i.liveProposalsByEpoch['2'] as ProposalMap, ruleset: i.ruleset, actorTags: i.actorTags });
  var chain = EventChain.create<EpochResolvedEvent>({ key: i.key, genesis: i.genesis });
  var rec1 = chain.append('EpochResolved', t1.event);
  var rec2 = chain.append('EpochResolved', t2.event);

  // (3) SUSPEND - bundle format v2: the bundle CARRIES its seal structurally.
  var bundle = suspend({ key: i.key, worldId: i.worldId, snapshotState: s0, snapshotEventIndex: i.snapshotEventIndex, chain: chain });
  var seal = bundle.seal;

  // (4) RESUME.
  var postTail = replayEpochEvent(replayEpochEvent(s0, t1.event), t2.event);
  var r = resume({
    key: i.key, bundle: bundle, currentEpoch: i.currentEpoch, ruleset: i.ruleset,
    proposalsByEpoch: i.offlineProposalsByEpoch, maxCatchup: i.maxCatchup, actorTags: i.actorTags,
  });

  // (5) PARTIAL SYNC - server = resumed state, client cache = pre-suspend state.
  var serverRegions = partitionRegions(r.state, i.regionTagPrefix);
  var clientRegions = partitionRegions(t2.state, i.regionTagPrefix);
  var serverLeaves = regionLeaves(i.key, serverRegions);
  var serverRoot = globalRegionHash(i.key, serverRegions);
  var clientLeaves = regionLeaves(i.key, clientRegions);
  var diff = diffRegionLeaves(clientLeaves, serverLeaves);
  var pulledRegions: Record<string, unknown> = {};
  for (var p = 0; p < diff.changed.length; p++) {
    var id = diff.changed[p] as string;
    pulledRegions[id] = (serverRegions as Record<string, unknown>)[id];
  }
  var synced = applyPartialSync({
    key: i.key, cachedRegions: clientRegions, pulledRegions: pulledRegions,
    serverLeaves: serverLeaves, serverRoot: serverRoot,
  });

  return {
    s0: s0, t1: t1, t2: t2, rec1: rec1, rec2: rec2, chainHead: chain.head(),
    bundle: bundle, seal: seal, postTail: postTail, r: r,
    serverRegions: serverRegions, clientRegions: clientRegions,
    serverLeaves: serverLeaves, serverRoot: serverRoot, clientLeaves: clientLeaves,
    diff: diff, pulledRegions: pulledRegions, synced: synced,
  };
}

var run = runScenario();

test('vector copy: demo/plaza-persistent/vector.json is byte-identical to the canonical vector', function () {
  var canonical = readFileSync(canonicalPath, 'utf8');
  var shipped = readFileSync(demoCopyPath, 'utf8');
  assert.strictEqual(shipped, canonical, 'the demo ships exactly what npm test proves');
});

test('build: S0 hashes to the pinned s0_hash; the bundle snapshot commits to it', function () {
  assert.strictEqual(worldStateHash(vec.inputs.key, run.s0), vec.expect.s0_hash, 's0 hash');
  assert.strictEqual(run.bundle.snapshot.stateHash, vec.expect.suspend.snapshot_state_hash, 'bundle snapshot hash');
  assert.strictEqual(run.bundle.snapshot.stateHash, vec.expect.s0_hash, 'snapshot commits to S0');
});

test('live play: both EpochResolved events + chain records reproduce the pinned hashes', function () {
  var i = vec.inputs;
  assert.ok(run.rec1 && run.rec2, 'both events accepted by the chain');
  assert.deepStrictEqual(
    [worldStateHash(i.key, run.t1.event), worldStateHash(i.key, run.t2.event)],
    vec.expect.live.event_hashes, 'event hashes');
  assert.deepStrictEqual([run.rec1!.sig, run.rec2!.sig], vec.expect.live.record_sigs, 'record sigs');
  assert.strictEqual(run.chainHead, vec.expect.live.chain_head, 'chain head');
  assert.strictEqual(run.t2.state.epoch, vec.expect.live.post_live_epoch, 'post-live epoch');
  assert.strictEqual(worldStateHash(i.key, run.t2.state), vec.expect.live.post_live_state_hash, 'post-live state hash');
});

test('suspend: tail + tailGenesis + the STRUCTURAL seal match the pins; tail verifies under the seal', function () {
  var i = vec.inputs;
  assert.strictEqual(run.bundle.chainTail.length, vec.expect.suspend.tail_length, 'tail length');
  assert.strictEqual(run.bundle.tailGenesis, vec.expect.suspend.tail_genesis, 'tail genesis');
  assert.strictEqual(run.bundle.tailGenesis, i.genesis, 'snapshot @ 0 anchors the tail at the genesis');
  // Bundle format v2: the seal is INSIDE the bundle (suspend embeds chain.seal()).
  assert.deepStrictEqual(run.bundle.seal, vec.expect.suspend.seal, 'pinned structural seal (count, head, sig)');
  assert.deepStrictEqual(run.seal, run.bundle.seal, 'the scenario uses the embedded seal, not an external one');
  var res = EventChain.verifyRecords<EpochResolvedEvent>(i.key, run.bundle.chainTail, run.bundle.tailGenesis, run.bundle.seal);
  assert.strictEqual(res.ok, true, 'tail HMAC + linkage + seal commitment verify');
  assert.strictEqual(vec.expect.suspend.tail_verify_ok, true, 'pinned');
});

test('resume: tail replay + 12 offline epochs reproduce every pinned hash and count', function () {
  var i = vec.inputs;
  var postTailHash = worldStateHash(i.key, run.postTail);
  assert.strictEqual(postTailHash, vec.expect.resume.post_tail_state_hash, 'post-tail hash');
  assert.strictEqual(postTailHash, vec.expect.live.post_live_state_hash, 'reducer reconstructs the live state');
  assert.strictEqual(vec.expect.resume.reducer_equals_live, true, 'pinned');
  assert.strictEqual(run.r.state.epoch, vec.expect.resume.final_epoch, 'final epoch 14');
  assert.strictEqual(run.r.epochsResolved, vec.expect.resume.epochs_resolved, '12 resolved');
  assert.strictEqual(run.r.epochsVoided, vec.expect.resume.epochs_voided, '0 voided');
  assert.strictEqual(run.r.newEvents.length, vec.expect.resume.new_events_count, '12 new events');
  assert.strictEqual(worldStateHash(i.key, run.r.newEvents), vec.expect.resume.new_events_hash, 'new events hash');
  assert.strictEqual(worldStateHash(i.key, run.r.state), vec.expect.resume.final_state_hash, 'final state hash');
});

test('partial sync: leaves, root, diff, pulled/kept sets, and bytes metric match the pins', function () {
  assert.deepStrictEqual(run.clientLeaves, vec.expect.partial_sync.client_leaves, 'client leaves');
  assert.deepStrictEqual(run.serverLeaves, vec.expect.partial_sync.server_leaves, 'server leaves');
  assert.strictEqual(run.serverRoot, vec.expect.partial_sync.server_root, 'server root');
  assert.deepStrictEqual(run.diff, vec.expect.partial_sync.diff, 'pinned diff');
  assert.deepStrictEqual(run.diff.changed, ['east', 'south'], 'exactly the 2 offline-touched regions');
  assert.deepStrictEqual(run.synced.pulled, vec.expect.partial_sync.pulled, 'pulled set');
  assert.deepStrictEqual(run.synced.kept, vec.expect.partial_sync.kept, 'kept set');
  assert.strictEqual(run.synced.root, run.serverRoot, 'recombined root equals the server root');
  assert.deepStrictEqual(run.synced.regions, run.serverRegions, 'recombined regions ARE the server regions');
  var bytesPulled = 0;
  var bytesFull = 0;
  var ids = Object.keys(run.serverRegions);
  for (var b = 0; b < ids.length; b++) {
    var rid = ids[b] as string;
    var size = utf8Bytes(canonicalJson((run.serverRegions as Record<string, unknown>)[rid]));
    bytesFull = bytesFull + size;
    if (run.diff.changed.indexOf(rid) >= 0) bytesPulled = bytesPulled + size;
  }
  assert.strictEqual(bytesPulled, vec.expect.partial_sync.bytes_pulled, 'bytes pulled');
  assert.strictEqual(bytesFull, vec.expect.partial_sync.bytes_full, 'bytes full');
  assert.ok(bytesPulled < bytesFull, 'partial sync is cheaper than a full sync');
});

test('determinism: the whole scenario driven twice in-process is byte-identical', function () {
  var again = runScenario();
  assert.strictEqual(JSON.stringify(again), JSON.stringify(run), 'run 2 == run 1, byte for byte');
});

test('fail-closed: a corrupted snapshot is rejected on resume', function () {
  var i = vec.inputs;
  var tampered: WorldBundle = JSON.parse(JSON.stringify(run.bundle));
  (tampered.snapshot.state.entities['trader_selm'] as { properties: Record<string, number> }).properties['gold'] = 9999;
  assert.throws(function () {
    resume({ key: i.key, bundle: tampered, currentEpoch: i.currentEpoch, ruleset: i.ruleset, proposalsByEpoch: i.offlineProposalsByEpoch, maxCatchup: i.maxCatchup, actorTags: i.actorTags });
  }, /corrupted snapshot/);
});

test('fail-closed: a tampered chain tail is rejected on resume', function () {
  var i = vec.inputs;
  var tampered: WorldBundle = JSON.parse(JSON.stringify(run.bundle));
  (tampered.chainTail[0] as { payload: EpochResolvedEvent }).payload.epoch_number = 999;
  assert.throws(function () {
    resume({ key: i.key, bundle: tampered, currentEpoch: i.currentEpoch, ruleset: i.ruleset, proposalsByEpoch: i.offlineProposalsByEpoch, maxCatchup: i.maxCatchup, actorTags: i.actorTags });
  }, /chain tamper/);
});

test('fail-closed: a TRUNCATED tail passes the bare chain verify but is caught BY THE SEAL', function () {
  var i = vec.inputs;
  var truncated = run.bundle.chainTail.slice(0, 1);
  var bare = EventChain.verifyRecords<EpochResolvedEvent>(i.key, truncated, run.bundle.tailGenesis);
  assert.strictEqual(bare.ok, true, 'the truncation hole: a bare hash chain cannot see a cut tail');
  assert.strictEqual(vec.expect.suspend.truncated_tail_passes_without_seal, true, 'pinned');
  var sealed = EventChain.verifyRecords<EpochResolvedEvent>(i.key, truncated, run.bundle.tailGenesis, run.bundle.seal);
  assert.strictEqual(sealed.ok, false, 'the seal closes it');
  assert.strictEqual(sealed.mismatches.some(function (m) { return m.reason === 'seal_mismatch'; }), true, 'seal_mismatch reported');
  assert.strictEqual(vec.expect.suspend.truncated_tail_fails_with_seal, true, 'pinned');
});

test('fail-closed: an end-truncated BUNDLE is rejected by resume via the STRUCTURAL seal', function () {
  // Bundle format v2: the seal travels INSIDE the bundle, so resume() itself
  // rejects the cut tail - no external seal bookkeeping required.
  var i = vec.inputs;
  var tampered: WorldBundle = JSON.parse(JSON.stringify(run.bundle));
  tampered.chainTail = tampered.chainTail.slice(0, 1);
  assert.throws(function () {
    resume({ key: i.key, bundle: tampered, currentEpoch: i.currentEpoch, ruleset: i.ruleset, proposalsByEpoch: i.offlineProposalsByEpoch, maxCatchup: i.maxCatchup, actorTags: i.actorTags });
  }, /does not match the seal/);
});

test('fail-closed: a seal-less (pre-v2 format) bundle is rejected by resume', function () {
  var i = vec.inputs;
  var sealless = JSON.parse(JSON.stringify(run.bundle)) as { seal?: unknown };
  delete sealless.seal;
  assert.throws(function () {
    resume({ key: i.key, bundle: sealless as never, currentEpoch: i.currentEpoch, ruleset: i.ruleset, proposalsByEpoch: i.offlineProposalsByEpoch, maxCatchup: i.maxCatchup, actorTags: i.actorTags });
  }, /carries no chain seal/);
});

test('fail-closed: a tampered seal is rejected', function () {
  var i = vec.inputs;
  var forgedSig = { count: run.seal.count, head: run.seal.head, sig: run.seal.sig.slice(0, -2) + (run.seal.sig.slice(-2) === '00' ? '11' : '00') };
  assert.strictEqual(EventChain.verifySeal(i.key, forgedSig), false, 'forged sig fails verifySeal');
  var forgedCount = { count: run.seal.count + 1, head: run.seal.head, sig: run.seal.sig };
  var res = EventChain.verifyRecords<EpochResolvedEvent>(i.key, run.bundle.chainTail, run.bundle.tailGenesis, forgedCount);
  assert.strictEqual(res.ok, false, 'a seal whose count was edited no longer carries a valid signature');
});

test('fail-closed: a tampered pulled region is rejected by its leaf', function () {
  var i = vec.inputs;
  var tamperedPull: Record<string, unknown> = JSON.parse(JSON.stringify(run.pulledRegions));
  var east = tamperedPull['east'] as { entities: Record<string, { properties: Record<string, number> }> };
  (east.entities['farmer_edda'] as { properties: Record<string, number> }).properties['gold'] = 9999;
  assert.throws(function () {
    applyPartialSync({ key: i.key, cachedRegions: run.clientRegions, pulledRegions: tamperedPull, serverLeaves: run.serverLeaves, serverRoot: run.serverRoot });
  }, /failed leaf verification/);
});

test('fail-closed: a stale/tampered KEPT cached region is caught by the root recompute', function () {
  var i = vec.inputs;
  var staleCache: Record<string, unknown> = JSON.parse(JSON.stringify(run.clientRegions));
  var north = staleCache['north'] as { entities: Record<string, { properties: Record<string, number> }> };
  (north.entities['guard_norri'] as { properties: Record<string, number> }).properties['gold'] = 777;
  assert.throws(function () {
    applyPartialSync({ key: i.key, cachedRegions: staleCache, pulledRegions: run.pulledRegions, serverLeaves: run.serverLeaves, serverRoot: run.serverRoot });
  }, /root does not match/);
});

test('fail-closed: a region neither pulled nor cached is a hard error', function () {
  var i = vec.inputs;
  var partialCache: Record<string, unknown> = JSON.parse(JSON.stringify(run.clientRegions));
  delete partialCache['west'];
  assert.throws(function () {
    applyPartialSync({ key: i.key, cachedRegions: partialCache, pulledRegions: run.pulledRegions, serverLeaves: run.serverLeaves, serverRoot: run.serverRoot });
  }, /neither pulled nor cached/);
});
