// gen-plaza-persistent-vectors.ts - generate the v6.1 plaza-persistent golden vector.
//
// THE PLAZA THAT REMEMBERS: one seeded end-to-end run proving the full
// persistence + partial-sync story on the real src modules:
//
//   build S0 (12 villagers across 4 regions) -> live epochs 1..2 on an HMAC
//   EventChain -> suspend (snapshot @ index 0, tail = both events) + seal ->
//   resume at currentEpoch 14 (tail verified + replayed, then 12 offline epochs
//   resolved, 0 voided) -> partitionRegions on both sides -> diffRegionLeaves
//   finds exactly the 2 regions the offline proposals touched (east + south) ->
//   applyPartialSync pulls only those 2 partitions and proves the recombined
//   root equals the server root.
//
// The scenario is driven TWICE in-process and the two results must be
// byte-identical before anything is written. The same vector is written to BOTH
// test_vectors/v6_1_plaza_persistent.json (the canonical copy npm test pins)
// AND demo/plaza-persistent/vector.json (the byte-identical copy the gh-pages
// demo fetches) - the npm test asserts the two files never drift.
//
// Re-run with: npx tsx tools/gen-plaza-persistent-vectors.ts

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';
import { EventChain, canonicalJson } from '../src/runtime/event-chain.js';
import type { ChainSeal } from '../src/runtime/event-chain.js';
import { tickEpoch } from '../src/runtime/world-epoch.js';
import type { Ruleset, ProposalMap, EpochResolvedEvent } from '../src/runtime/world-epoch.js';
import { suspend, resume, replayEpochEvent } from '../src/runtime/world-session.js';
import { worldStateHash } from '../src/runtime/world-state-snapshot.js';
import type { WorldState } from '../src/runtime/world-state-snapshot.js';
import { regionLeaves, globalRegionHash } from '../src/runtime/region-hash.js';
import { partitionRegions, diffRegionLeaves, applyPartialSync } from '../src/runtime/region-sync.js';

var KEY = 'v6-plaza-golden-key';
var WORLD = 'plaza-persistent';
var GENESIS = 'loom.world/plaza-persistent';
var ACTOR_TAGS = ['acts_offline'];
var REGION_TAG_PREFIX = 'region:';
var SNAPSHOT_EVENT_INDEX = 0;
var CURRENT_EPOCH = 14;
var MAX_CATCHUP = 12;

// ---- the plaza: 12 villagers across 4 regions (all inputs literal) ----------

function villager(hp: number, gold: number, region: string, actsOffline: boolean): { properties: Record<string, number>; tags: string[] } {
  var tags = actsOffline ? ['acts_offline', 'region:' + region] : ['region:' + region];
  return { properties: { gold: gold, hp: hp }, tags: tags };
}

var S0: WorldState = {
  epoch: 0,
  worldSeed: 2026,
  entities: {
    gardener_nora: villager(10, 5, 'north', true),
    guard_norri: villager(14, 2, 'north', false),
    lamplighter_nim: villager(8, 1, 'north', false),
    trader_selm: villager(9, 20, 'south', true),
    baker_senna: villager(10, 6, 'south', false),
    child_sofi: villager(6, 0, 'south', false),
    farmer_edda: villager(11, 4, 'east', true),
    smith_eron: villager(13, 7, 'east', false),
    fisher_eyla: villager(9, 3, 'east', false),
    weaver_wren: villager(8, 5, 'west', true),
    elder_wyn: villager(7, 9, 'west', false),
    scribe_wim: villager(9, 2, 'west', false),
  },
};

// ---- the ruleset (caller-owned content, supplied as data) -------------------

var RULESET: Ruleset = {
  tend_garden: {
    kind: 'mutations',
    mutations: [{ type: 'add_prop', target: 'self', property: 'gold', value: { type: 'dice', equation: '1d4' } }],
  },
  market_haggle: {
    kind: 'check',
    check: {
      type: 'check',
      roll: { type: 'dice', equation: '1d20' },
      dc: { type: 'literal', value: 11 },
      degrees: {
        success: {
          condition: { type: 'delta_gte', value: 0 },
          mutations: [{ type: 'add_prop', target: 'self', property: 'gold', value: { type: 'literal', value: 3 } }],
        },
        failure: {
          condition: { type: 'delta_lte', value: -1 },
          mutations: [{ type: 'sub_prop', target: 'self', property: 'gold', value: { type: 'literal', value: 1 } }],
        },
      },
    },
  },
  rest: {
    kind: 'mutations',
    mutations: [{ type: 'add_prop', target: 'self', property: 'hp', value: { type: 'literal', value: 1 } }],
  },
};

// LIVE epochs 1..2: all four regions act (this history lands on BOTH sides, so
// it must NOT show up in the partial-sync diff).
var LIVE_PROPOSALS_BY_EPOCH: Record<string, ProposalMap> = {
  '1': {
    gardener_nora: { actionId: 'tend_garden' },
    trader_selm: { actionId: 'market_haggle' },
    farmer_edda: { actionId: 'tend_garden' },
    weaver_wren: { actionId: 'rest' },
  },
  '2': {
    gardener_nora: { actionId: 'rest' },
    trader_selm: { actionId: 'market_haggle' },
    farmer_edda: { actionId: 'tend_garden' },
    weaver_wren: { actionId: 'tend_garden' },
  },
};

// OFFLINE epochs 3..14: ONLY the south (trader_selm) + east (farmer_edda)
// actors act, so the partial-sync diff must report exactly those 2 regions.
function offlineProposals(): Record<string, ProposalMap> {
  var out: Record<string, ProposalMap> = {};
  for (var epoch = 3; epoch <= 14; epoch++) {
    var selmAction = epoch === 9 ? 'rest' : 'market_haggle';
    var eddaAction = (epoch === 6 || epoch === 12) ? 'rest' : 'tend_garden';
    out[String(epoch)] = {
      trader_selm: { actionId: selmAction },
      farmer_edda: { actionId: eddaAction },
    };
  }
  return out;
}
var OFFLINE_PROPOSALS_BY_EPOCH = offlineProposals();

// ---- drive the scenario once (pure function of the literals above) ----------

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

interface ScenarioResult {
  s0Hash: string;
  eventHashes: string[];
  recordSigs: string[];
  chainHead: string;
  postLiveEpoch: number;
  postLiveStateHash: string;
  tailLength: number;
  tailGenesis: string;
  snapshotStateHash: string;
  seal: ChainSeal;
  tailVerifyOk: boolean;
  truncatedTailPassesWithoutSeal: boolean;
  truncatedTailFailsWithSeal: boolean;
  postTailStateHash: string;
  reducerEqualsLive: boolean;
  finalEpoch: number;
  epochsResolved: number;
  epochsVoided: number;
  newEventsCount: number;
  newEventsHash: string;
  finalStateHash: string;
  clientLeaves: Record<string, string>;
  serverLeaves: Record<string, string>;
  serverRoot: string;
  diff: { changed: string[]; added: string[]; removed: string[] };
  pulled: string[];
  kept: string[];
  mergedRootEqualsServerRoot: boolean;
  bytesPulled: number;
  bytesFull: number;
}

function runScenario(): ScenarioResult {
  // (1) BUILD - S0 is the plaza at epoch 0.
  var s0Hash = worldStateHash(KEY, S0);

  // (2) LIVE PLAY - tickEpoch epochs 1..2, append both events to the chain.
  var t1 = tickEpoch({ worldId: WORLD, state: S0, epochNumber: 1, proposals: LIVE_PROPOSALS_BY_EPOCH['1'] as ProposalMap, ruleset: RULESET, actorTags: ACTOR_TAGS });
  var t2 = tickEpoch({ worldId: WORLD, state: t1.state, epochNumber: 2, proposals: LIVE_PROPOSALS_BY_EPOCH['2'] as ProposalMap, ruleset: RULESET, actorTags: ACTOR_TAGS });
  var chain = EventChain.create<EpochResolvedEvent>({ key: KEY, genesis: GENESIS });
  var rec1 = chain.append('EpochResolved', t1.event);
  var rec2 = chain.append('EpochResolved', t2.event);
  if (!rec1 || !rec2) throw new Error('gen-plaza: chain append rejected an event');

  // (3) SUSPEND - bundle (snapshot S0 @ index 0, tail = both events) + seal.
  var bundle = suspend({ key: KEY, worldId: WORLD, snapshotState: S0, snapshotEventIndex: SNAPSHOT_EVENT_INDEX, chain: chain });
  var seal = chain.seal();
  // The snapshot is at index 0, so the tail IS the full chain and ONE
  // verifyRecords call checks signatures + linkage + the seal commitment.
  var tailVerify = EventChain.verifyRecords<EpochResolvedEvent>(KEY, bundle.chainTail, bundle.tailGenesis, seal);
  // The truncation hole the seal closes: a tail with the last record dropped
  // still passes a bare hash-chain verify, but the seal's (count, head)
  // commitment catches it.
  var truncated = bundle.chainTail.slice(0, 1);
  var truncatedBare = EventChain.verifyRecords<EpochResolvedEvent>(KEY, truncated, bundle.tailGenesis);
  var truncatedSealed = EventChain.verifyRecords<EpochResolvedEvent>(KEY, truncated, bundle.tailGenesis, seal);

  // (4) RESUME - verify + replay the tail, then 12 offline epochs (3..14).
  var postTail = replayEpochEvent(replayEpochEvent(S0, t1.event), t2.event);
  var postTailHash = worldStateHash(KEY, postTail);
  var r = resume({
    key: KEY, bundle: bundle, currentEpoch: CURRENT_EPOCH, ruleset: RULESET,
    proposalsByEpoch: OFFLINE_PROPOSALS_BY_EPOCH, maxCatchup: MAX_CATCHUP, actorTags: ACTOR_TAGS,
  });

  // (5) PARTIAL SYNC - server partitions the RESUMED state; the client still
  // holds the PRE-suspend state (its last sync).
  var serverRegions = partitionRegions(r.state, REGION_TAG_PREFIX);
  var clientRegions = partitionRegions(t2.state, REGION_TAG_PREFIX);
  var serverLeaves = regionLeaves(KEY, serverRegions);
  var serverRoot = globalRegionHash(KEY, serverRegions);
  var clientLeaves = regionLeaves(KEY, clientRegions);
  var diff = diffRegionLeaves(clientLeaves, serverLeaves);
  var pulledRegions: Record<string, unknown> = {};
  for (var i = 0; i < diff.changed.length; i++) {
    var id = diff.changed[i] as string;
    pulledRegions[id] = (serverRegions as Record<string, unknown>)[id];
  }
  var synced = applyPartialSync({
    key: KEY, cachedRegions: clientRegions, pulledRegions: pulledRegions,
    serverLeaves: serverLeaves, serverRoot: serverRoot,
  });
  var bytesPulled = 0;
  var bytesFull = 0;
  var allIds = Object.keys(serverRegions);
  for (var b = 0; b < allIds.length; b++) {
    var rid = allIds[b] as string;
    var size = utf8Bytes(canonicalJson((serverRegions as Record<string, unknown>)[rid]));
    bytesFull = bytesFull + size;
    if (diff.changed.indexOf(rid) >= 0) bytesPulled = bytesPulled + size;
  }

  return {
    s0Hash: s0Hash,
    eventHashes: [worldStateHash(KEY, t1.event), worldStateHash(KEY, t2.event)],
    recordSigs: [rec1.sig, rec2.sig],
    chainHead: chain.head(),
    postLiveEpoch: t2.state.epoch,
    postLiveStateHash: worldStateHash(KEY, t2.state),
    tailLength: bundle.chainTail.length,
    tailGenesis: bundle.tailGenesis,
    snapshotStateHash: bundle.snapshot.stateHash,
    seal: seal,
    tailVerifyOk: tailVerify.ok,
    truncatedTailPassesWithoutSeal: truncatedBare.ok,
    truncatedTailFailsWithSeal: !truncatedSealed.ok,
    postTailStateHash: postTailHash,
    reducerEqualsLive: postTailHash === worldStateHash(KEY, t2.state),
    finalEpoch: r.state.epoch,
    epochsResolved: r.epochsResolved,
    epochsVoided: r.epochsVoided,
    newEventsCount: r.newEvents.length,
    newEventsHash: worldStateHash(KEY, r.newEvents),
    finalStateHash: worldStateHash(KEY, r.state),
    clientLeaves: clientLeaves,
    serverLeaves: serverLeaves,
    serverRoot: serverRoot,
    diff: diff,
    pulled: synced.pulled,
    kept: synced.kept,
    mergedRootEqualsServerRoot: synced.root === serverRoot,
    bytesPulled: bytesPulled,
    bytesFull: bytesFull,
  };
}

// ---- run twice, assert byte-identical, assert the story, then write ---------

var run1 = runScenario();
var run2 = runScenario();
assert.strictEqual(JSON.stringify(run1), JSON.stringify(run2), 'two in-process runs must be byte-identical');

assert.strictEqual(run1.tailVerifyOk, true, 'tail + seal verify');
assert.strictEqual(run1.truncatedTailPassesWithoutSeal, true, 'bare chain verify cannot see truncation');
assert.strictEqual(run1.truncatedTailFailsWithSeal, true, 'the seal catches truncation');
assert.strictEqual(run1.reducerEqualsLive, true, 'tail replay reconstructs the live state');
assert.strictEqual(run1.snapshotStateHash, run1.s0Hash, 'bundle snapshot hash is the S0 hash');
assert.strictEqual(run1.postLiveEpoch, 2, 'live play ends at epoch 2');
assert.strictEqual(run1.finalEpoch, 14, 'resume lands on epoch 14');
assert.strictEqual(run1.epochsResolved, 12, '12 offline epochs resolved');
assert.strictEqual(run1.epochsVoided, 0, '0 epochs voided');
assert.strictEqual(run1.newEventsCount, 12, '12 new EpochResolved events');
assert.deepStrictEqual(run1.diff, { changed: ['east', 'south'], added: [], removed: [] },
  'the offline proposals touched exactly east + south');
assert.deepStrictEqual(run1.pulled, ['east', 'south'], 'client pulled exactly the changed regions');
assert.deepStrictEqual(run1.kept, ['north', 'west'], 'client kept the unchanged cached regions');
assert.strictEqual(run1.mergedRootEqualsServerRoot, true, 'recombined root equals the server root');
assert.ok(run1.bytesPulled < run1.bytesFull, 'partial sync pulls fewer bytes than a full sync');

var out = {
  meta: {
    generator: 'tools/gen-plaza-persistent-vectors.ts',
    generated_note: 'Regenerate with: npx tsx tools/gen-plaza-persistent-vectors.ts (runs the real TS build/chain/suspend+seal/resume/partition/diff/partial-sync pipeline twice and writes BOTH test_vectors/v6_1_plaza_persistent.json AND the byte-identical demo/plaza-persistent/vector.json).',
    vector: 'v6.1 - plaza-persistent (persistence + partial sync, end to end)',
    key: KEY,
    note: 'Generated by the real TS modules. One seeded run: build S0 (12 villagers, 4 regions) -> tickEpoch live epochs 1..2 appended to an HMAC EventChain -> suspend (snapshot @ index 0, tail = 2 events) + chain.seal() -> resume at currentEpoch 14 (snapshot verified, tail HMAC + seal verified, tail replayed by the recorded-mutation reducer, then 12 offline epochs resolved / 0 voided) -> partitionRegions on the resumed (server) and pre-suspend (client) states -> diffRegionLeaves reports exactly the 2 regions the offline proposals touched (east + south) -> applyPartialSync pulls only those 2 partitions, verifies each leaf, recombines with the kept cached regions, and proves the recombined root equals the server root. Consumers (tests/plaza-persistent.test.ts headless via src; demo/plaza-persistent/main.ts in-browser via dist) re-drive the same inputs and must reproduce every pinned hash. The seal expectations pin the truncation hole a bare hash chain cannot see: a truncated tail verifies WITHOUT the seal and is rejected WITH it.',
  },
  inputs: {
    key: KEY,
    worldId: WORLD,
    genesis: GENESIS,
    actorTags: ACTOR_TAGS,
    regionTagPrefix: REGION_TAG_PREFIX,
    snapshotEventIndex: SNAPSHOT_EVENT_INDEX,
    currentEpoch: CURRENT_EPOCH,
    maxCatchup: MAX_CATCHUP,
    s0: S0,
    ruleset: RULESET,
    liveProposalsByEpoch: LIVE_PROPOSALS_BY_EPOCH,
    offlineProposalsByEpoch: OFFLINE_PROPOSALS_BY_EPOCH,
  },
  expect: {
    s0_hash: run1.s0Hash,
    live: {
      event_hashes: run1.eventHashes,
      record_sigs: run1.recordSigs,
      chain_head: run1.chainHead,
      post_live_epoch: run1.postLiveEpoch,
      post_live_state_hash: run1.postLiveStateHash,
    },
    suspend: {
      tail_length: run1.tailLength,
      tail_genesis: run1.tailGenesis,
      snapshot_state_hash: run1.snapshotStateHash,
      seal: run1.seal,
      tail_verify_ok: run1.tailVerifyOk,
      truncated_tail_passes_without_seal: run1.truncatedTailPassesWithoutSeal,
      truncated_tail_fails_with_seal: run1.truncatedTailFailsWithSeal,
    },
    resume: {
      post_tail_state_hash: run1.postTailStateHash,
      reducer_equals_live: run1.reducerEqualsLive,
      final_epoch: run1.finalEpoch,
      epochs_resolved: run1.epochsResolved,
      epochs_voided: run1.epochsVoided,
      new_events_count: run1.newEventsCount,
      new_events_hash: run1.newEventsHash,
      final_state_hash: run1.finalStateHash,
    },
    partial_sync: {
      client_leaves: run1.clientLeaves,
      server_leaves: run1.serverLeaves,
      server_root: run1.serverRoot,
      diff: run1.diff,
      pulled: run1.pulled,
      kept: run1.kept,
      merged_root_equals_server_root: run1.mergedRootEqualsServerRoot,
      bytes_pulled: run1.bytesPulled,
      bytes_full: run1.bytesFull,
    },
    determinism: { runs: 2, identical: true },
  },
};

var here = dirname(fileURLToPath(import.meta.url));
var json = JSON.stringify(out, null, 2) + '\n';
var canonicalDest = join(here, '..', 'test_vectors', 'v6_1_plaza_persistent.json');
var demoDir = join(here, '..', 'demo', 'plaza-persistent');
mkdirSync(demoDir, { recursive: true });
var demoDest = join(demoDir, 'vector.json');
writeFileSync(canonicalDest, json, 'utf8');
writeFileSync(demoDest, json, 'utf8');
console.log('wrote ' + canonicalDest);
console.log('wrote ' + demoDest + ' (byte-identical copy)');
console.log('  resolved=' + run1.epochsResolved + ' voided=' + run1.epochsVoided
  + ' changed=' + run1.diff.changed.join(',') + ' bytes ' + run1.bytesPulled + '/' + run1.bytesFull);
console.log('  final_state_hash=' + run1.finalStateHash.slice(0, 16) + '...');
