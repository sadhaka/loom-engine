// gen-epoch-vectors.ts - generate the v3.0 Phase 3 Epoch world-tick golden vector.
//
// Runs the REAL TS tickEpoch / catchUpEpochs over: a 2-actor single tick (Gemini's
// faction_2-before-faction_10 numeric sort), an unknown-action rejection wedged
// BETWEEN two resolves (proves a rejected proposal consumes ZERO prng and never
// shifts a later actor's roll), a check-action tick, a max_actions cap, a 3-epoch
// catch-up, and a catch-up that voids excess offline time past max_catchup. Each
// case pins the resulting world-state hash AND the hash of the emitted
// EpochResolved event(s), so the Rust + Python ports load the SAME inputs and must
// reproduce the SAME hashes byte-for-byte.
// Re-run with: npx tsx tools/gen-epoch-vectors.ts

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  tickEpoch, catchUpEpochs, deriveEpochPrng,
  type Ruleset, type ProposalMap, type WorldAction,
} from '../src/runtime/world-epoch.js';
import { worldStateHash, type WorldState } from '../src/runtime/world-state-snapshot.js';

var KEY = 'v3-epoch-golden-key';

// gain_power: a flat mutation action - power += 1d6 on self. One die per actor.
var GAIN_POWER: WorldAction = {
  kind: 'mutations',
  mutations: [{ type: 'add_prop', target: 'self', property: 'power', value: { type: 'dice', equation: '1d6' } }],
};
// gamble: a CHECK action - 1d20 vs DC 10; success power += 5, failure power -= 1.
var GAMBLE: WorldAction = {
  kind: 'check',
  roll: { type: 'dice', equation: '1d20' },
  dc: { type: 'literal', value: 10 },
  degrees: {
    success: { condition: { type: 'delta_gte', value: 0 }, mutations: [{ type: 'add_prop', target: 'self', property: 'power', value: { type: 'literal', value: 5 } }] },
    failure: { condition: { type: 'delta_lte', value: -1 }, mutations: [{ type: 'sub_prop', target: 'self', property: 'power', value: { type: 'literal', value: 1 } }] },
  },
};
var RULESET: Ruleset = { gain_power: GAIN_POWER, gamble: GAMBLE };

var FACTION_TAG = 'faction';

interface Case {
  label: string;
  kind: 'tick' | 'catchup';
  key: string;
  worldId: string;
  actorTags: string[];
  ruleset: Ruleset;
  state: WorldState;
  // tick:
  epochNumber?: number;
  proposals?: ProposalMap;
  maxActions?: number;
  // catchup:
  currentEpoch?: number;
  maxCatchup?: number;
  proposalsByEpoch?: Record<string, ProposalMap>;
  expect: Record<string, unknown>;
}
var cases: Case[] = [];

function tickCase(label: string, worldId: string, state: WorldState, epochNumber: number,
  proposals: ProposalMap, maxActions: number | undefined): void {
  var r = tickEpoch({ worldId, state, epochNumber, proposals, ruleset: RULESET, actorTags: [FACTION_TAG], maxActions });
  var seed = deriveEpochPrng(worldId, epochNumber).snapshot();
  // sorted_actors: the actor ids actually listed in the event, in resolution order.
  var listed: string[] = [];
  for (var i = 0; i < r.event.actions_processed.length; i++) listed.push(r.event.actions_processed[i].actor_id);
  cases.push({
    label, kind: 'tick', key: KEY, worldId, actorTags: [FACTION_TAG], ruleset: RULESET, state,
    epochNumber, proposals, maxActions,
    expect: {
      seed_state_hex: seed.state.toString(16),
      seed_inc_hex: seed.inc.toString(16),
      listed_actors: listed,
      pcg_steps_consumed: r.event.pcg_steps_consumed,
      resolved: r.resolved,
      rejected: r.rejected,
      event: r.event,
      events_hash: worldStateHash(KEY, [r.event]),
      state_hash: worldStateHash(KEY, r.state),
    },
  });
}

function catchUpCase(label: string, worldId: string, state: WorldState, currentEpoch: number,
  maxCatchup: number, proposalsByEpoch: Record<string, ProposalMap>): void {
  var r = catchUpEpochs({ worldId, state, currentEpoch, maxCatchup, ruleset: RULESET, actorTags: [FACTION_TAG], proposalsByEpoch });
  cases.push({
    label, kind: 'catchup', key: KEY, worldId, actorTags: [FACTION_TAG], ruleset: RULESET, state,
    currentEpoch, maxCatchup, proposalsByEpoch,
    expect: {
      epochsResolved: r.epochsResolved,
      epochsVoided: r.epochsVoided,
      final_epoch: r.state.epoch,
      events: r.events,
      events_hash: worldStateHash(KEY, r.events),
      state_hash: worldStateHash(KEY, r.state),
    },
  });
}

// 1. Two factions gain_power. NOTE: prefixed ids 'faction_2' / 'faction_10' are NOT
//    pure-numeric, so compareIds sorts them by UTF-8 bytes -> faction_10 precedes
//    faction_2 (Gemini's blueprint assumed numeric ordering here; that only applies
//    to PURE-numeric ids - see the dedicated numeric-id case below).
tickCase('single-tick: two factions gain_power (compareIds byte order: faction_10 first)', 'test_world_alpha',
  { epoch: 14, worldSeed: 0, entities: {
    faction_2: { properties: { power: 10 }, tags: [FACTION_TAG] },
    faction_10: { properties: { power: 5 }, tags: [FACTION_TAG] },
  } }, 15,
  { faction_2: { actionId: 'gain_power' }, faction_10: { actionId: 'gain_power' } }, undefined);

// 2. Rejection wedged between resolves: faction_1 resolves, faction_2 is rejected
//    (unknown action) consuming ZERO prng, faction_3 still gets the SECOND die (not
//    the third) - proves the snapshot/restore rollback.
tickCase('reject-mid-list: unknown action consumes zero prng (faction_3 unshifted)', 'voidreach',
  { epoch: 0, worldSeed: 0, entities: {
    faction_1: { properties: { power: 1 }, tags: [FACTION_TAG] },
    faction_2: { properties: { power: 1 }, tags: [FACTION_TAG] },
    faction_3: { properties: { power: 1 }, tags: [FACTION_TAG] },
  } }, 1,
  { faction_1: { actionId: 'gain_power' }, faction_2: { actionId: 'no_such_action' }, faction_3: { actionId: 'gain_power' } }, undefined);

// 3. Check-action tick: gamble (1d20 vs DC10) for two factions - exercises the
//    evaluateAction (degree) path inside the epoch loop.
tickCase('check-action tick: gamble degree resolution', 'wyrmrest',
  { epoch: 41, worldSeed: 0, entities: {
    faction_a: { properties: { power: 3 }, tags: [FACTION_TAG] },
    faction_b: { properties: { power: 3 }, tags: [FACTION_TAG] },
    bystander: { properties: { power: 99 }, tags: ['npc'] },
  } }, 42,
  { faction_a: { actionId: 'gamble' }, faction_b: { actionId: 'gamble' } }, undefined);

// 4. Veil-Ceiling guard: max_actions = 1 - only the first actor (faction_2) resolves;
//    faction_10 is never processed (one die total).
tickCase('max-actions cap: only first actor resolves', 'test_world_alpha',
  { epoch: 14, worldSeed: 0, entities: {
    faction_2: { properties: { power: 10 }, tags: [FACTION_TAG] },
    faction_10: { properties: { power: 5 }, tags: [FACTION_TAG] },
  } }, 15,
  { faction_2: { actionId: 'gain_power' }, faction_10: { actionId: 'gain_power' } }, 1);

// 4b. Numeric-id ordering: PURE-numeric actor ids '2' / '10' DO sort by value -
//     '2' before '10' - via compareIds' numeric branch (the ports must reproduce
//     this distinct from the byte-order prefixed case above).
tickCase('numeric-id ordering: id 2 before id 10 (compareIds by value)', 'numeria',
  { epoch: 7, worldSeed: 0, entities: {
    '2': { properties: { power: 0 }, tags: [FACTION_TAG] },
    '10': { properties: { power: 0 }, tags: [FACTION_TAG] },
  } }, 8,
  { '2': { actionId: 'gain_power' }, '10': { actionId: 'gain_power' } }, undefined);

// 5. Catch-up: 3 offline epochs (currentEpoch 3, cap 30) all resolved.
catchUpCase('catch-up: resolve 3 epochs, none voided', 'emberfall',
  { epoch: 0, worldSeed: 0, entities: {
    faction_5: { properties: { power: 0 }, tags: [FACTION_TAG] },
  } }, 3, 30,
  {
    '1': { faction_5: { actionId: 'gain_power' } },
    '2': { faction_5: { actionId: 'gain_power' } },
    '3': { faction_5: { actionId: 'gain_power' } },
  });

// 6. Catch-up void: 100 epochs behind, cap 2 - resolve 2, void 98, final epoch = 2.
catchUpCase('catch-up void: cap 2 of 100, 98 lost to the void', 'emberfall',
  { epoch: 0, worldSeed: 0, entities: {
    faction_5: { properties: { power: 0 }, tags: [FACTION_TAG] },
  } }, 100, 2,
  {
    '1': { faction_5: { actionId: 'gain_power' } },
    '2': { faction_5: { actionId: 'gain_power' } },
  });

var out = {
  meta: {
    vector: 'v3.0 Phase 3 - Epoch between-session world-tick',
    key: KEY,
    note: 'Generated by the real TS tickEpoch / catchUpEpochs. Rust + Python ports load the same inputs (state, proposals, ruleset, caps) and must reproduce the same listed actors, pcg_steps_consumed, resolved/rejected counts, epoch seed (state/inc), EpochResolved event(s) and the resulting world-state + events hashes. seed_*_hex pins the SHA-256(world_id || LE64(epoch)) -> raw PCG derivation; reject-mid-list pins zero-prng-on-reject; max-actions pins the Veil-Ceiling guard; catch-up void pins the bounded loop.',
  },
  cases,
};
var dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'test_vectors', 'v3_3_epoch_tick.json');
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('wrote ' + dest + ' (' + cases.length + ' cases)');
for (var i = 0; i < cases.length; i++) {
  console.log('  ' + cases[i].label + ' -> state_hash ' + String(cases[i].expect.state_hash).slice(0, 16) + '...');
}
