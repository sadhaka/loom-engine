// gen-session-soak-vectors.ts - generate the v3.5 WorldSession SOAK golden vectors.
//
// The persistence + partial-sync PROOF vectors: where v3_4 pins ONE tiny
// suspend/resume case, this file pins the composed long-horizon flows that the
// public audit flagged as unexercised:
//
//   S1 long-horizon-catchup-120  - 120 epochs of catch-up over 3 actors that
//        exercise BOTH compareIds branches ('7' pure-numeric; faction_2/faction_10
//        byte order), with idle epochs in the rotation, run BOTH in four 30-epoch
//        chunks and single-shot. Pins catch-up COMPOSABILITY (chunked == single)
//        plus 120-epoch PRNG/order/accumulation stability with checkpoints.
//   S2 boundary-suspend-resume   - resume at EXACTLY the post-tail epoch (zero
//        catch-up boundary), one epoch across the boundary, and a MID-CHAIN
//        suspend (snapshotEventIndex 2) proving snapshot-position independence.
//   S3 multi-suspend-cycles-3x7  - THE one-flow proof: three suspend -> resume ->
//        append-newEvents-to-the-ONE-chain -> re-suspend cycles (7 epochs each),
//        pinned per cycle, plus one_shot_equals_cycles (resume(bundle_0, 21)
//        reproduces the same final hash).
//   S4 chain-verification-across-the-gap - the 21-record chain from S3 sealed via
//        chain.seal(); full verifyRecords(key, records, genesis, seal) ok. The
//        test adds the negative space: tail truncation WITHOUT a seal verifies
//        clean (the documented WorldBundle truncation hole), WITH the seal it is
//        caught, and a flipped recorded mutation is a sig_mismatch.
//   S5 void-at-scale             - 400 epochs lost to the void (cap 100 of 500),
//        then a SECOND resume ACROSS the void boundary (502, cap 5) - resuming
//        deterministically after voided time, which nothing covered before.
//
// Determinism discipline: every input is literal vector data, every draw comes
// from deriveEpochPrng(worldId, epoch), no wall clock anywhere (currentEpoch
// values are vector constants).
// Re-run with: npx tsx tools/gen-session-soak-vectors.ts

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventChain } from '../src/runtime/event-chain.js';
import type { ChainedRecord } from '../src/runtime/event-chain.js';
import {
  tickEpoch, catchUpEpochs,
  type Ruleset, type ProposalMap, type WorldAction, type EpochResolvedEvent,
} from '../src/runtime/world-epoch.js';
import { suspend, resume } from '../src/runtime/world-session.js';
import { worldStateHash, type WorldState } from '../src/runtime/world-state-snapshot.js';

var KEY = 'v3-soak-golden-key';
var TAG = 'faction';

// Shared ruleset: a flat dice mutation, a check action, and a flat literal.
var GAIN: WorldAction = {
  kind: 'mutations',
  mutations: [{ type: 'add_prop', target: 'self', property: 'power', value: { type: 'dice', equation: '1d6' } }],
};
var GAMBLE: WorldAction = {
  kind: 'check',
  check: {
    type: 'check',
    roll: { type: 'dice', equation: '1d20' },
    dc: { type: 'literal', value: 10 },
    degrees: {
      success: { condition: { type: 'delta_gte', value: 0 }, mutations: [{ type: 'add_prop', target: 'self', property: 'power', value: { type: 'literal', value: 5 } }] },
      failure: { condition: { type: 'delta_lte', value: -1 }, mutations: [{ type: 'sub_prop', target: 'self', property: 'power', value: { type: 'literal', value: 1 } }] },
    },
  },
};
var REST: WorldAction = {
  kind: 'mutations',
  mutations: [{ type: 'add_prop', target: 'self', property: 'power', value: { type: 'literal', value: 1 } }],
};
var RULESET: Ruleset = { gain_power: GAIN, gamble: GAMBLE, rest: REST };

// The 3-actor roster: '7' is PURE-numeric (compareIds numeric branch - sorts
// first, before all string ids); 'faction_10' precedes 'faction_2' by UTF-8 byte
// order ('1' < '2'). Resolution order every epoch: 7, faction_10, faction_2.
function rosterState(epoch: number): WorldState {
  return {
    epoch: epoch, worldSeed: 0, entities: {
      '7': { properties: { power: 0 }, tags: [TAG] },
      faction_10: { properties: { power: 5 }, tags: [TAG] },
      faction_2: { properties: { power: 10 }, tags: [TAG] },
    },
  };
}

// S1/S5 proposal rule by epoch % 3: 0 -> gamble for faction_2 only; 1 ->
// gain_power for all three; 2 -> NO entry (idle epoch - still emits a 0-action
// EpochResolved and advances the epoch with a fresh PRNG derivation).
function ruleSparse(epoch: number): ProposalMap | null {
  var m = epoch % 3;
  if (m === 0) return { faction_2: { actionId: 'gamble' } };
  if (m === 1) {
    return {
      '7': { actionId: 'gain_power' },
      faction_10: { actionId: 'gain_power' },
      faction_2: { actionId: 'gain_power' },
    };
  }
  return null;
}

// S3 proposal rule by epoch % 3: 0 -> rest for all three; 1 -> gain_power for
// all three; 2 -> gamble for faction_2 only. Every epoch acts (full proposals).
function ruleFull(epoch: number): ProposalMap {
  var m = epoch % 3;
  if (m === 0) {
    return {
      '7': { actionId: 'rest' },
      faction_10: { actionId: 'rest' },
      faction_2: { actionId: 'rest' },
    };
  }
  if (m === 1) {
    return {
      '7': { actionId: 'gain_power' },
      faction_10: { actionId: 'gain_power' },
      faction_2: { actionId: 'gain_power' },
    };
  }
  return { faction_2: { actionId: 'gamble' } };
}

function buildProposals(fromEpoch: number, toEpoch: number, rule: (e: number) => ProposalMap | null): Record<string, ProposalMap> {
  var out: Record<string, ProposalMap> = {};
  for (var e = fromEpoch; e <= toEpoch; e++) {
    var p = rule(e);
    if (p) out[String(e)] = p;
  }
  return out;
}

// HONESTY GUARD: the generator refuses to pin a divergent run as golden. Any
// mismatch here is a GENUINE core bug (state diverging across a suspend boundary,
// chunked catch-up drifting from single-shot) and must be fixed in the core, not
// recorded.
function mustEqual(a: unknown, b: unknown, label: string): void {
  if (a !== b) {
    throw new Error('SOAK GENERATOR DIVERGENCE (' + label + '): ' + String(a) + ' !== ' + String(b));
  }
}

var cases: Record<string, unknown>[] = [];

// ---- S1: long-horizon-catchup-120 -------------------------------------------

(function s1(): void {
  var worldId = 'soak_horizon';
  var state0 = rosterState(0);
  var proposals = buildProposals(1, 120, ruleSparse);

  // Single-shot: 0 -> 120 in one catchUpEpochs call.
  var single = catchUpEpochs({ worldId: worldId, state: state0, currentEpoch: 120, maxCatchup: 200, ruleset: RULESET, proposalsByEpoch: proposals, actorTags: [TAG] });
  mustEqual(single.epochsResolved, 120, 'S1 single resolved');
  mustEqual(single.epochsVoided, 0, 'S1 single voided');
  mustEqual(single.events.length, 120, 'S1 single events');

  // Chunked: four 30-epoch chunks over the SAME proposals (catchUpEpochs keys
  // proposals by ABSOLUTE epoch, so passing the full map to each chunk is exact).
  var work = state0;
  var chunkEvents: EpochResolvedEvent[] = [];
  var checkpoints: Record<string, string> = {};
  var stops = [30, 60, 90, 120];
  for (var c = 0; c < stops.length; c++) {
    var r = catchUpEpochs({ worldId: worldId, state: work, currentEpoch: stops[c] as number, maxCatchup: 200, ruleset: RULESET, proposalsByEpoch: proposals, actorTags: [TAG] });
    mustEqual(r.epochsResolved, 30, 'S1 chunk ' + c + ' resolved');
    work = r.state;
    for (var e = 0; e < r.events.length; e++) chunkEvents.push(r.events[e] as EpochResolvedEvent);
    checkpoints[String(stops[c])] = worldStateHash(KEY, work);
  }

  var singleStateHash = worldStateHash(KEY, single.state);
  var singleEventsHash = worldStateHash(KEY, single.events);
  mustEqual(worldStateHash(KEY, work), singleStateHash, 'S1 chunked final state == single-shot');
  mustEqual(worldStateHash(KEY, chunkEvents), singleEventsHash, 'S1 chunked events == single-shot');

  cases.push({
    label: 'S1 long-horizon-catchup-120: chunked == single-shot over 120 epochs',
    kind: 'soak_catchup',
    key: KEY, worldId: worldId, actorTags: [TAG], ruleset: RULESET,
    state: state0,
    currentEpoch: 120, maxCatchup: 200,
    chunk_stops: stops,
    proposalsByEpoch: proposals,
    expect: {
      epochsResolved: 120,
      epochsVoided: 0,
      final_epoch: single.state.epoch,
      newEvents_count: 120,
      events_hash: singleEventsHash,
      final_state_hash: singleStateHash,
      // Hashes after the chunked run reaches epoch 30 / 60 / 90 (and 120 == final).
      checkpoint_state_hashes: checkpoints,
      chunked_equals_single: true,
    },
  });
})();

// ---- S2: boundary-suspend-resume --------------------------------------------

(function s2(): void {
  var worldId = 'soak_boundary';
  var genesis = 'loom.world/soak_boundary';
  var S0 = rosterState(10);

  // Live play: tickEpoch for epochs 11..13, each appended to ONE chain.
  var p11: ProposalMap = { '7': { actionId: 'gain_power' }, faction_10: { actionId: 'gain_power' }, faction_2: { actionId: 'gain_power' } };
  var p12: ProposalMap = { faction_10: { actionId: 'rest' }, faction_2: { actionId: 'gamble' } };
  var p13: ProposalMap = { '7': { actionId: 'rest' } };
  var t11 = tickEpoch({ worldId: worldId, state: S0, epochNumber: 11, proposals: p11, ruleset: RULESET, actorTags: [TAG] });
  var t12 = tickEpoch({ worldId: worldId, state: t11.state, epochNumber: 12, proposals: p12, ruleset: RULESET, actorTags: [TAG] });
  var t13 = tickEpoch({ worldId: worldId, state: t12.state, epochNumber: 13, proposals: p13, ruleset: RULESET, actorTags: [TAG] });
  var chain = EventChain.create<EpochResolvedEvent>({ key: KEY, genesis: genesis });
  chain.append('EpochResolved', t11.event);
  chain.append('EpochResolved', t12.event);
  chain.append('EpochResolved', t13.event);

  var liveEpoch13Hash = worldStateHash(KEY, t13.state);
  var proposals14: Record<string, ProposalMap> = { '14': { faction_2: { actionId: 'gamble' } } };

  // A: suspend at index 0 (tail = all 3 events); resume at EXACTLY the post-tail
  // epoch - the zero-catch-up boundary.
  var bundleA = suspend({ key: KEY, worldId: worldId, snapshotState: S0, snapshotEventIndex: 0, chain: chain });
  mustEqual(bundleA.chainTail.length, 3, 'S2 bundleA tail');
  var rA = resume({ key: KEY, bundle: bundleA, currentEpoch: 13, ruleset: RULESET, proposalsByEpoch: proposals14, maxCatchup: 5, actorTags: [TAG] });
  mustEqual(rA.epochsResolved, 0, 'S2 A resolved');
  mustEqual(rA.epochsVoided, 0, 'S2 A voided');
  mustEqual(worldStateHash(KEY, rA.state), liveEpoch13Hash, 'S2 A resumed == live epoch-13');

  // B: same bundle, ONE epoch across the boundary.
  var rB = resume({ key: KEY, bundle: bundleA, currentEpoch: 14, ruleset: RULESET, proposalsByEpoch: proposals14, maxCatchup: 5, actorTags: [TAG] });
  mustEqual(rB.epochsResolved, 1, 'S2 B resolved');
  var bFinalHash = worldStateHash(KEY, rB.state);

  // C: MID-CHAIN suspend - snapshot at index 2 (post-epoch-12 state), tail = the
  // epoch-13 record only. Resume to 14 must land on B's exact hash
  // (snapshot-position independence).
  var bundleC = suspend({ key: KEY, worldId: worldId, snapshotState: t12.state, snapshotEventIndex: 2, chain: chain });
  mustEqual(bundleC.chainTail.length, 1, 'S2 bundleC tail');
  var rC = resume({ key: KEY, bundle: bundleC, currentEpoch: 14, ruleset: RULESET, proposalsByEpoch: proposals14, maxCatchup: 5, actorTags: [TAG] });
  mustEqual(worldStateHash(KEY, rC.state), bFinalHash, 'S2 C == B (snapshot-position independence)');

  cases.push({
    label: 'S2 boundary-suspend-resume: zero-catch-up boundary + mid-chain suspend',
    kind: 'boundary',
    key: KEY, worldId: worldId, actorTags: [TAG], ruleset: RULESET,
    bundleA: bundleA,
    bundleC: bundleC,
    maxCatchup: 5,
    proposalsByEpoch: proposals14,
    expect: {
      live_epoch13_state_hash: liveEpoch13Hash,
      a: { currentEpoch: 13, epochsResolved: 0, epochsVoided: 0, newEvents_count: 0, resumed_state_hash: liveEpoch13Hash },
      b: { currentEpoch: 14, epochsResolved: 1, epochsVoided: 0, final_epoch: 14, final_state_hash: bFinalHash },
      c: { currentEpoch: 14, tail_length: 1, final_state_hash: bFinalHash, snapshot_position_independent: true },
    },
  });
})();

// ---- S3 + S4: multi-suspend cycles + chain seal across the gap ---------------

(function s3s4(): void {
  var worldId = 'soak_cycles';
  var genesis = 'loom.world/soak_cycles';
  var state0 = rosterState(0);
  var mergedProposals = buildProposals(1, 21, ruleFull);

  var chain = EventChain.create<EpochResolvedEvent>({ key: KEY, genesis: genesis });
  var bundle0 = suspend({ key: KEY, worldId: worldId, snapshotState: state0, snapshotEventIndex: 0, chain: chain });
  mustEqual(bundle0.chainTail.length, 0, 'S3 bundle0 empty tail');

  // Three suspend/resume cycles of 7 epochs each, all events onto the ONE chain.
  var bundle = bundle0;
  var cycles: Record<string, unknown>[] = [];
  for (var k = 0; k < 3; k++) {
    var to = 7 * (k + 1);
    var r = resume({ key: KEY, bundle: bundle, currentEpoch: to, ruleset: RULESET, proposalsByEpoch: mergedProposals, maxCatchup: 10, actorTags: [TAG] });
    mustEqual(r.epochsResolved, 7, 'S3 cycle ' + k + ' resolved');
    mustEqual(r.epochsVoided, 0, 'S3 cycle ' + k + ' voided');
    for (var e = 0; e < r.newEvents.length; e++) {
      var rec = chain.append('EpochResolved', r.newEvents[e] as EpochResolvedEvent);
      if (!rec) throw new Error('SOAK GENERATOR: chain.append rejected an EpochResolved event');
    }
    cycles.push({
      currentEpoch: to,
      epochsResolved: 7,
      epochsVoided: 0,
      state_hash: worldStateHash(KEY, r.state),
      chain_record_count: chain.size(),
      chain_head_sig: chain.head(),
    });
    // Re-suspend at the new chain length: the snapshot is current, tail empty.
    bundle = suspend({ key: KEY, worldId: worldId, snapshotState: r.state, snapshotEventIndex: chain.size(), chain: chain });
    mustEqual(bundle.chainTail.length, 0, 'S3 cycle ' + k + ' re-suspend tail');
  }
  var cyclesFinalHash = (cycles[2] as Record<string, unknown>).state_hash as string;
  mustEqual(chain.size(), 21, 'S3 chain length');

  // One-shot equivalence: resume(bundle_0, 21) over the merged map must reproduce
  // the cycles' final hash - multi-suspend cycles == one long resume.
  var oneShot = resume({ key: KEY, bundle: bundle0, currentEpoch: 21, ruleset: RULESET, proposalsByEpoch: mergedProposals, maxCatchup: 25, actorTags: [TAG] });
  mustEqual(worldStateHash(KEY, oneShot.state), cyclesFinalHash, 'S3 one-shot == cycles');

  cases.push({
    label: 'S3 multi-suspend-cycles-3x7: suspend -> resume -> append -> re-suspend, one chain',
    kind: 'cycles',
    key: KEY, worldId: worldId, actorTags: [TAG], ruleset: RULESET,
    genesis: genesis,
    bundle0: bundle0,
    cycle_length: 7,
    cycle_count: 3,
    maxCatchup: 10,
    one_shot_maxCatchup: 25,
    proposalsByEpoch: mergedProposals,
    expect: {
      cycles: cycles,
      final_epoch: 21,
      final_state_hash: cyclesFinalHash,
      one_shot_equals_cycles: true,
    },
  });

  // S4: seal the accumulated 21-record chain and pin full verification across the
  // whole multi-cycle gap. The test adds the negative space (truncation without /
  // with the seal, and a flipped recorded mutation).
  var records = chain.list();
  var seal = chain.seal();
  var full = EventChain.verifyRecords<EpochResolvedEvent>(KEY, records, genesis, seal);
  mustEqual(full.ok, true, 'S4 full chain verify');
  mustEqual(seal.count, 21, 'S4 seal count');

  cases.push({
    label: 'S4 chain-verification-across-the-gap: 21-record chain + seal',
    kind: 'chain_seal',
    key: KEY, worldId: worldId,
    genesis: genesis,
    records: records,
    expect: {
      seal_count: seal.count,
      seal_head: seal.head,
      seal_sig: seal.sig,
      records_hash: worldStateHash(KEY, records),
      full_chain_verify_ok: true,
    },
  });
})();

// ---- S5: void-at-scale + resume across the void -------------------------------

(function s5(): void {
  var worldId = 'soak_void';
  var genesis = 'loom.world/soak_void';
  var state0 = rosterState(0);
  var proposals1 = buildProposals(1, 100, ruleSparse);

  var emptyChain1 = EventChain.create<EpochResolvedEvent>({ key: KEY, genesis: genesis });
  var bundle1 = suspend({ key: KEY, worldId: worldId, snapshotState: state0, snapshotEventIndex: 0, chain: emptyChain1 });
  var r1 = resume({ key: KEY, bundle: bundle1, currentEpoch: 500, ruleset: RULESET, proposalsByEpoch: proposals1, maxCatchup: 100, actorTags: [TAG] });
  mustEqual(r1.epochsResolved, 100, 'S5 first resolved');
  mustEqual(r1.epochsVoided, 400, 'S5 first voided');
  mustEqual(r1.state.epoch, 100, 'S5 first final epoch');

  // SECOND resume from the post-void state: the world sat at epoch 100 after 400
  // voided epochs; the clock is now 502, cap 5 - epochs 101..105 resolve, 397 void.
  var proposals2 = buildProposals(101, 105, ruleSparse);
  var emptyChain2 = EventChain.create<EpochResolvedEvent>({ key: KEY, genesis: genesis });
  var bundle2 = suspend({ key: KEY, worldId: worldId, snapshotState: r1.state, snapshotEventIndex: 0, chain: emptyChain2 });
  var r2 = resume({ key: KEY, bundle: bundle2, currentEpoch: 502, ruleset: RULESET, proposalsByEpoch: proposals2, maxCatchup: 5, actorTags: [TAG] });
  mustEqual(r2.epochsResolved, 5, 'S5 second resolved');
  mustEqual(r2.epochsVoided, 397, 'S5 second voided');
  mustEqual(r2.state.epoch, 105, 'S5 second final epoch');

  cases.push({
    label: 'S5 void-at-scale: 400 epochs voided, then resume across the void',
    kind: 'void',
    key: KEY, worldId: worldId, actorTags: [TAG], ruleset: RULESET,
    bundle1: bundle1,
    first: { currentEpoch: 500, maxCatchup: 100 },
    proposalsByEpoch1: proposals1,
    bundle2: bundle2,
    second: { currentEpoch: 502, maxCatchup: 5 },
    proposalsByEpoch2: proposals2,
    expect: {
      first: {
        epochsResolved: 100, epochsVoided: 400, final_epoch: 100,
        newEvents_count: 100,
        events_hash: worldStateHash(KEY, r1.newEvents),
        final_state_hash: worldStateHash(KEY, r1.state),
      },
      second: {
        epochsResolved: 5, epochsVoided: 397, final_epoch: 105,
        newEvents_count: 5,
        events_hash: worldStateHash(KEY, r2.newEvents),
        final_state_hash: worldStateHash(KEY, r2.state),
      },
    },
  });
})();

// ---- write -------------------------------------------------------------------

var out = {
  meta: {
    generator: 'tools/gen-session-soak-vectors.ts',
    generated_note: 'Regenerate with: npx tsx tools/gen-session-soak-vectors.ts (runs the real TS suspend/resume + catchUpEpochs).',
    vector: 'v3.5 - WorldSession persistence SOAK (long-horizon + multi-cycle suspend/resume + seal)',
    key: KEY,
    note: 'Generated by the real TS suspend/resume + catchUpEpochs. Five cases: S1 pins 120-epoch catch-up composability (four 30-epoch chunks == single-shot, with 30/60/90 checkpoints); S2 pins the zero-catch-up resume boundary and mid-chain suspend (snapshotEventIndex 2) snapshot-position independence; S3 pins three suspend->resume->append->re-suspend cycles on ONE chain == one 21-epoch resume; S4 pins the sealed 21-record chain verifying across the whole gap (tests add the truncation/tamper negative space - a tail-truncated bundle verifies CLEAN without a seal, the documented WorldBundle hole); S5 pins void-at-scale (resolve 100 of 500, void 400) and a deterministic SECOND resume across the void boundary. Ports (Rust/Python) gain v3_5 consumers in a follow-up; the format matches what golden_epoch.rs / golden_session.rs parse.',
  },
  cases: cases,
};

var dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'test_vectors', 'v3_5_session_soak.json');
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('wrote ' + dest + ' (' + cases.length + ' cases)');
for (var i = 0; i < cases.length; i++) {
  console.log('  ' + (cases[i] as Record<string, unknown>).label);
}
