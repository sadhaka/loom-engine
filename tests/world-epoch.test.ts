// Epoch world-tick tests - v3.0 Phase 3 (Living Persistent World).
//
// Pins the golden vector (numeric-aware actor sort, zero-prng-on-reject, the
// max_actions Veil-Ceiling guard, catch-up + void) AND covers the behavioral
// guarantees directly: PRNG isolation/derivation, input purity, fail-closed
// rejection rolling back BOTH prng and state, and the bounded catch-up loop.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  tickEpoch, catchUpEpochs, deriveEpochPrng,
  type Ruleset, type WorldAction,
} from '../src/runtime/world-epoch.js';
import { worldStateHash, type WorldState } from '../src/runtime/world-state-snapshot.js';

var here = dirname(fileURLToPath(import.meta.url));
var vec = JSON.parse(readFileSync(join(here, '..', 'test_vectors', 'v3_3_epoch_tick.json'), 'utf8'));

var GAIN_POWER: WorldAction = {
  kind: 'mutations',
  mutations: [{ type: 'add_prop', target: 'self', property: 'power', value: { type: 'dice', equation: '1d6' } }],
};
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

test('golden vector: every epoch case reproduces the pinned hashes', function () {
  assert.ok(vec.cases.length >= 6, 'expected >= 6 golden cases');
  for (var i = 0; i < vec.cases.length; i++) {
    var c = vec.cases[i];
    if (c.kind === 'tick') {
      var r = tickEpoch({ worldId: c.worldId, state: c.state, epochNumber: c.epochNumber, proposals: c.proposals, ruleset: c.ruleset, actorTags: c.actorTags, maxActions: c.maxActions });
      assert.strictEqual(worldStateHash(c.key, r.state), c.expect.state_hash, c.label + ' state_hash');
      assert.strictEqual(worldStateHash(c.key, [r.event]), c.expect.events_hash, c.label + ' events_hash');
      assert.strictEqual(r.event.pcg_steps_consumed, c.expect.pcg_steps_consumed, c.label + ' steps');
      assert.strictEqual(r.resolved, c.expect.resolved, c.label + ' resolved');
      assert.strictEqual(r.rejected, c.expect.rejected, c.label + ' rejected');
    } else {
      var rc = catchUpEpochs({ worldId: c.worldId, state: c.state, currentEpoch: c.currentEpoch, maxCatchup: c.maxCatchup, ruleset: c.ruleset, actorTags: c.actorTags, proposalsByEpoch: c.proposalsByEpoch });
      assert.strictEqual(worldStateHash(c.key, rc.state), c.expect.state_hash, c.label + ' state_hash');
      assert.strictEqual(worldStateHash(c.key, rc.events), c.expect.events_hash, c.label + ' events_hash');
      assert.strictEqual(rc.epochsResolved, c.expect.epochsResolved, c.label + ' resolved');
      assert.strictEqual(rc.epochsVoided, c.expect.epochsVoided, c.label + ' voided');
    }
  }
});

test('PRNG isolation: derivation is deterministic + epoch-distinct', function () {
  var a1 = deriveEpochPrng('w', 5);
  var a2 = deriveEpochPrng('w', 5);
  assert.strictEqual(a1.nextU32(), a2.nextU32(), 'same (world,epoch) -> same stream');
  var b = deriveEpochPrng('w', 6);
  var c = deriveEpochPrng('x', 5);
  // Overwhelmingly likely distinct; assert at least one of the next words differs.
  var fresh1 = deriveEpochPrng('w', 5).nextU32();
  assert.ok(fresh1 !== b.nextU32() || fresh1 !== c.nextU32(), 'different world/epoch -> different stream');
});

test('input purity: tickEpoch does not mutate the caller state', function () {
  var state: WorldState = { epoch: 0, worldSeed: 0, entities: { faction_1: { properties: { power: 7 }, tags: ['faction'] } } };
  var before = worldStateHash('k', state);
  tickEpoch({ worldId: 'w', state: state, epochNumber: 1, proposals: { faction_1: { actionId: 'gain_power' } }, ruleset: RULESET, actorTags: ['faction'] });
  assert.strictEqual(worldStateHash('k', state), before, 'caller state unchanged');
  assert.strictEqual(state.epoch, 0, 'caller epoch unchanged');
});

test('fail-closed: a rejected proposal rolls back prng AND state (faction_3 unshifted)', function () {
  var entities = {
    faction_1: { properties: { power: 0 }, tags: ['faction'] },
    faction_2: { properties: { power: 0 }, tags: ['faction'] },
    faction_3: { properties: { power: 0 }, tags: ['faction'] },
  };
  var withReject = tickEpoch({ worldId: 'w', state: { epoch: 0, worldSeed: 0, entities: JSON.parse(JSON.stringify(entities)) }, epochNumber: 1,
    proposals: { faction_1: { actionId: 'gain_power' }, faction_2: { actionId: 'nope' }, faction_3: { actionId: 'gain_power' } }, ruleset: RULESET, actorTags: ['faction'] });
  // The same two resolves with NO middle actor at all must yield identical faction_1/faction_3 rolls.
  var noReject = tickEpoch({ worldId: 'w', state: { epoch: 0, worldSeed: 0, entities: {
    faction_1: { properties: { power: 0 }, tags: ['faction'] },
    faction_3: { properties: { power: 0 }, tags: ['faction'] },
  } }, epochNumber: 1, proposals: { faction_1: { actionId: 'gain_power' }, faction_3: { actionId: 'gain_power' } }, ruleset: RULESET, actorTags: ['faction'] });
  assert.strictEqual(withReject.state.entities.faction_1.properties.power, noReject.state.entities.faction_1.properties.power, 'faction_1 roll matches');
  assert.strictEqual(withReject.state.entities.faction_3.properties.power, noReject.state.entities.faction_3.properties.power, 'faction_3 roll unshifted by the rejection');
  assert.strictEqual(withReject.resolved, 2);
  assert.strictEqual(withReject.rejected, 1);
  assert.strictEqual(withReject.event.pcg_steps_consumed, 2, 'rejection consumed zero prng');
});

test('Veil-Ceiling guard: max_actions caps successful resolutions (numeric-aware first)', function () {
  // Pure-numeric ids exercise compareIds' numeric-VALUE branch: "2" sorts before
  // "10" (NOT byte order). The cap of 1 must therefore resolve "2".
  var state: WorldState = { epoch: 0, worldSeed: 0, entities: {
    '2': { properties: { power: 0 }, tags: ['faction'] },
    '10': { properties: { power: 0 }, tags: ['faction'] },
  } };
  var r = tickEpoch({ worldId: 'w', state: state, epochNumber: 1, proposals: { '2': { actionId: 'gain_power' }, '10': { actionId: 'gain_power' } }, ruleset: RULESET, actorTags: ['faction'], maxActions: 1 });
  assert.strictEqual(r.resolved, 1, 'only one resolved');
  assert.strictEqual(r.event.actions_processed.length, 1, 'only one listed');
  assert.strictEqual(r.event.actions_processed[0].actor_id, '2', 'id 2 sorts before id 10 by value');
  assert.strictEqual(r.event.pcg_steps_consumed, 1, 'one die drawn');
});

test('catch-up: bounded loop resolves min(target, cap) and voids the rest', function () {
  var state: WorldState = { epoch: 0, worldSeed: 0, entities: { faction_1: { properties: { power: 0 }, tags: ['faction'] } } };
  var r = catchUpEpochs({ worldId: 'w', state: state, currentEpoch: 100, maxCatchup: 3, ruleset: RULESET, actorTags: ['faction'],
    proposalsByEpoch: { '1': { faction_1: { actionId: 'gain_power' } }, '2': { faction_1: { actionId: 'gain_power' } }, '3': { faction_1: { actionId: 'gain_power' } } } });
  assert.strictEqual(r.epochsResolved, 3, 'capped at maxCatchup');
  assert.strictEqual(r.epochsVoided, 97, 'remainder lost to the void');
  assert.strictEqual(r.state.epoch, 3, 'epoch advanced by the cap only');
  assert.strictEqual(r.events.length, 3);
});

test('catch-up: nothing to do when already current', function () {
  var state: WorldState = { epoch: 9, worldSeed: 0, entities: {} };
  var r = catchUpEpochs({ worldId: 'w', state: state, currentEpoch: 9, maxCatchup: 30, ruleset: RULESET });
  assert.strictEqual(r.epochsResolved, 0);
  assert.strictEqual(r.epochsVoided, 0);
  assert.strictEqual(r.state, state, 'returns the same state untouched');
});
