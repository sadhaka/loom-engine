// v2.3.0 - Ruleset Adapters (5e + PF2e action economy / initiative / conditions).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  startTurnBudget,
  canSpend,
  spend,
  initiativeOrder,
  createConditionTrack,
  applyCondition,
  removeCondition,
  hasCondition,
  conditionRemaining,
  tickConditions,
  activeConditions,
  DURATION_UNTIL_REMOVED,
  RESOURCE_RULESET,
} from '../src/index.js';

test('ruleset: RESOURCE key stable', () => {
  assert.equal(RESOURCE_RULESET, 'ruleset');
});

// ---- action economy ----

test('ruleset: 5e budget = action + bonus + reaction', () => {
  const b = startTurnBudget('5e');
  assert.deepEqual(b.resources, { action: 1, bonus: 1, reaction: 1 });
  assert.equal(spend(b, 'action'), true);
  assert.equal(spend(b, 'action'), false);   // exhausted
  assert.equal(canSpend(b, 'bonus'), true);
  assert.equal(spend(b, 'bonus'), true);
});

test('ruleset: PF2e budget = 3 actions + reaction', () => {
  const b = startTurnBudget('pf2e');
  assert.deepEqual(b.resources, { action: 3, reaction: 1 });
  assert.equal(spend(b, 'action'), true);
  assert.equal(spend(b, 'action', 2), true);  // spend the remaining 2
  assert.equal(spend(b, 'action'), false);     // 0 left
  assert.equal(spend(b, 'reaction'), true);
  assert.equal(spend(b, 'reaction'), false);
});

// ---- initiative ordering ----

test('ruleset: initiative orders by total desc, tiebreak modifier > d20 > id', () => {
  const order = initiativeOrder([
    { id: 'c', total: 18, modifier: 2, d20: 16 },
    { id: 'a', total: 18, modifier: 5, d20: 13 },   // higher modifier wins the 18-tie
    { id: 'b', total: 12, modifier: 1, d20: 11 },
    { id: 'd', total: 18, modifier: 2, d20: 16 },   // ties c on total+mod+d20 -> id asc (c before d)
  ]);
  assert.deepEqual(order.map((e) => e.id), ['a', 'c', 'd', 'b']);
});

test('ruleset: initiativeOrder does not mutate input', () => {
  const input = [{ id: 'x', total: 5 }, { id: 'y', total: 9 }];
  const out = initiativeOrder(input);
  assert.equal(input[0]!.id, 'x');           // original order preserved
  assert.deepEqual(out.map((e) => e.id), ['y', 'x']);
});

// ---- conditions ----

test('ruleset: conditions apply / has / remaining / remove', () => {
  const t = createConditionTrack();
  applyCondition(t, 'frightened', 3);
  applyCondition(t, 'prone');                 // until removed
  assert.equal(hasCondition(t, 'frightened'), true);
  assert.equal(conditionRemaining(t, 'frightened'), 3);
  assert.equal(conditionRemaining(t, 'prone'), DURATION_UNTIL_REMOVED);
  assert.equal(conditionRemaining(t, 'poisoned'), 0); // absent
  assert.equal(removeCondition(t, 'prone'), true);
  assert.equal(hasCondition(t, 'prone'), false);
});

test('ruleset: tickConditions decrements finite, expires at 0, spares until-removed', () => {
  const t = createConditionTrack();
  applyCondition(t, 'frightened', 2);
  applyCondition(t, 'slowed', 1);
  applyCondition(t, 'doomed');                // until removed - never ticks
  assert.deepEqual(tickConditions(t), ['slowed']);  // slowed (1 -> expire)
  assert.equal(conditionRemaining(t, 'frightened'), 1);
  assert.deepEqual(activeConditions(t).sort(), ['doomed', 'frightened']);
  assert.deepEqual(tickConditions(t), ['frightened']); // now expires
  assert.deepEqual(activeConditions(t), ['doomed']);   // until-removed survives
});
