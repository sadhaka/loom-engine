// v2.3.0 - Reaction Economy (per-round reaction ceiling) tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  REACTIONS_PER_ROUND,
  createReactionLedger,
  canReact,
  reactionsRemaining,
  spendReaction,
  advanceReactionRound,
  setReactionRound,
  pruneStaleSpends,
  clearReactions,
  reactionLedgerSnapshot,
  RESOURCE_REACTION_ECONOMY,
} from '../src/index.js';

test('reaction-economy: stable constants', () => {
  assert.equal(REACTIONS_PER_ROUND, 1);
  assert.equal(RESOURCE_REACTION_ECONOMY, 'reactionEconomy');
});

test('reaction-economy: fresh ledger - everyone can react', () => {
  const l = createReactionLedger();
  assert.equal(l.round, 1);
  assert.equal(canReact(l, 'pc'), true);
  assert.equal(reactionsRemaining(l, 'pc'), 1);
});

test('reaction-economy: spend once succeeds, twice in a round is refused (the ceiling)', () => {
  const l = createReactionLedger();
  assert.equal(spendReaction(l, 'pc'), true);
  assert.equal(canReact(l, 'pc'), false);
  assert.equal(reactionsRemaining(l, 'pc'), 0);
  assert.equal(spendReaction(l, 'pc'), false);   // 2nd in same round -> refused
});

test('reaction-economy: per-combatant independence', () => {
  const l = createReactionLedger();
  spendReaction(l, 'pc');
  assert.equal(canReact(l, 'goblin'), true);     // foe unaffected
  assert.equal(spendReaction(l, 'goblin'), true);
  assert.equal(canReact(l, 'pc'), false);        // pc still spent
});

test('reaction-economy: advancing the round refreshes everyone', () => {
  const l = createReactionLedger();
  spendReaction(l, 'pc');
  spendReaction(l, 'goblin');
  assert.equal(advanceReactionRound(l), 2);
  assert.equal(canReact(l, 'pc'), true);
  assert.equal(canReact(l, 'goblin'), true);
  assert.equal(spendReaction(l, 'pc'), true);    // can spend again in round 2
});

test('reaction-economy: a stale prior-round spend is inert (round-tag robustness)', () => {
  const l = createReactionLedger();
  spendReaction(l, 'pc');           // spent in round 1
  advanceReactionRound(l);          // -> round 2; the round-1 record is stale
  assert.equal(canReact(l, 'pc'), true);   // not blocked by the stale record
});

test('reaction-economy: empty id is a safe no-op', () => {
  const l = createReactionLedger();
  assert.equal(spendReaction(l, ''), false);
  assert.equal(canReact(l, ''), false);
});

test('reaction-economy: setReactionRound + prune + clear + snapshot', () => {
  const l = createReactionLedger();
  spendReaction(l, 'pc');           // round 1
  spendReaction(l, 'goblin');       // round 1
  setReactionRound(l, 3);
  setReactionRound(l, -5);          // ignored
  assert.equal(l.round, 3);
  assert.equal(canReact(l, 'pc'), true);          // round-1 records now stale
  assert.equal(pruneStaleSpends(l), 2);           // both round-1 records removed
  assert.equal(reactionLedgerSnapshot(l).spent.length, 0);

  spendReaction(l, 'pc');                          // round 3
  const snap = reactionLedgerSnapshot(l);
  assert.equal(snap.round, 3);
  assert.deepEqual(snap.spent, [{ entityId: 'pc', round: 3 }]);
  clearReactions(l);
  assert.equal(reactionLedgerSnapshot(l).spent.length, 0);
});
