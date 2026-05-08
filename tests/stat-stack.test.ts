// Phase 0.59.0 - StatStack tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  StatStack,
  RESOURCE_STAT_STACK,
} from '../src/index.js';

test('stat-stack: RESOURCE_STAT_STACK is the stable string', () => {
  assert.equal(RESOURCE_STAT_STACK, 'stat_stack');
});

test('stat-stack: starts with no stats', () => {
  const ss = StatStack.create();
  assert.equal(ss.get('hp'), 0);
  assert.equal(ss.getBase('hp'), 0);
  assert.deepEqual(ss.statNames(), []);
});

test('stat-stack: setBase + get returns base when no modifiers', () => {
  const ss = StatStack.create();
  ss.setBase('hp', 100);
  assert.equal(ss.get('hp'), 100);
  assert.equal(ss.getBase('hp'), 100);
});

test('stat-stack: setBase ignores invalid input', () => {
  const ss = StatStack.create();
  ss.setBase('', 100);
  assert.equal(ss.get(''), 0);
  ss.setBase('hp', NaN);
  assert.equal(ss.get('hp'), 0);
  ss.setBase('hp', Infinity);
  assert.equal(ss.get('hp'), 0);
});

test('stat-stack: flat modifier adds to base', () => {
  const ss = StatStack.create();
  ss.setBase('hp', 100);
  ss.addModifier({ source: 'equip:helm', stat: 'hp', kind: 'flat', value: 25 });
  assert.equal(ss.get('hp'), 125);
});

test('stat-stack: percentBase scales base', () => {
  const ss = StatStack.create();
  ss.setBase('hp', 100);
  ss.addModifier({ source: 'buff:str', stat: 'hp', kind: 'percentBase', value: 0.10 });
  // (100 + 0) * (1 + 0.10) * 1 = 110 (within FP tolerance).
  assert.ok(Math.abs(ss.get('hp') - 110) < 1e-9);
});

test('stat-stack: multiplier scales final', () => {
  const ss = StatStack.create();
  ss.setBase('hp', 100);
  ss.addModifier({ source: 'aura:weakness', stat: 'hp', kind: 'multiplier', value: 0.5 });
  assert.equal(ss.get('hp'), 50);
});

test('stat-stack: full order example - flat -> percent -> multiplier', () => {
  const ss = StatStack.create();
  ss.setBase('atk', 100);
  ss.addModifier({ source: 'equip:weapon', stat: 'atk', kind: 'flat', value: 50 });
  ss.addModifier({ source: 'buff:str', stat: 'atk', kind: 'percentBase', value: 0.20 });
  ss.addModifier({ source: 'aura:rage', stat: 'atk', kind: 'multiplier', value: 1.50 });
  // (100 + 50) * (1 + 0.20) * 1.50 = 150 * 1.2 * 1.5 = 270.
  assert.equal(ss.get('atk'), 270);
});

test('stat-stack: multiple flat sums; multiple percent sum; multipliers multiply', () => {
  const ss = StatStack.create();
  ss.setBase('atk', 100);
  ss.addModifier({ source: 'a', stat: 'atk', kind: 'flat', value: 10 });
  ss.addModifier({ source: 'b', stat: 'atk', kind: 'flat', value: 20 });
  ss.addModifier({ source: 'c', stat: 'atk', kind: 'percentBase', value: 0.10 });
  ss.addModifier({ source: 'd', stat: 'atk', kind: 'percentBase', value: 0.10 });
  ss.addModifier({ source: 'e', stat: 'atk', kind: 'multiplier', value: 1.5 });
  ss.addModifier({ source: 'f', stat: 'atk', kind: 'multiplier', value: 2.0 });
  // (100 + 30) * (1 + 0.20) * (1.5 * 2.0) = 130 * 1.2 * 3.0 = 468.
  assert.equal(ss.get('atk'), 468);
});

test('stat-stack: re-adding same source+kind replaces in place', () => {
  const ss = StatStack.create();
  ss.setBase('hp', 100);
  ss.addModifier({ source: 'equip:helm', stat: 'hp', kind: 'flat', value: 10 });
  ss.addModifier({ source: 'equip:helm', stat: 'hp', kind: 'flat', value: 50 });
  // Second replaces first; not 60.
  assert.equal(ss.get('hp'), 150);
});

test('stat-stack: same source can have different kinds', () => {
  const ss = StatStack.create();
  ss.setBase('hp', 100);
  ss.addModifier({ source: 'item', stat: 'hp', kind: 'flat', value: 50 });
  ss.addModifier({ source: 'item', stat: 'hp', kind: 'percentBase', value: 0.10 });
  // Both apply: (100 + 50) * (1 + 0.10) = 165.
  assert.equal(ss.get('hp'), 165);
});

test('stat-stack: addModifier rejects invalid input', () => {
  const ss = StatStack.create();
  // @ts-expect-error - testing runtime guard
  assert.equal(ss.addModifier(null), false);
  assert.equal(ss.addModifier({ source: '', stat: 'hp', kind: 'flat', value: 1 }), false);
  assert.equal(ss.addModifier({ source: 's', stat: '', kind: 'flat', value: 1 }), false);
  assert.equal(ss.addModifier({ source: 's', stat: 'hp', kind: 'flat', value: NaN }), false);
});

test('stat-stack: removeModifier without kind drops all kinds', () => {
  const ss = StatStack.create();
  ss.setBase('hp', 100);
  ss.addModifier({ source: 'item', stat: 'hp', kind: 'flat', value: 50 });
  ss.addModifier({ source: 'item', stat: 'hp', kind: 'percentBase', value: 0.10 });
  ss.removeModifier('item', 'hp');
  assert.equal(ss.get('hp'), 100);
});

test('stat-stack: removeModifier with kind drops only that kind', () => {
  const ss = StatStack.create();
  ss.setBase('hp', 100);
  ss.addModifier({ source: 'item', stat: 'hp', kind: 'flat', value: 50 });
  ss.addModifier({ source: 'item', stat: 'hp', kind: 'percentBase', value: 0.10 });
  ss.removeModifier('item', 'hp', 'flat');
  // (100 + 0) * (1 + 0.10) = 110 (within FP tolerance).
  assert.ok(Math.abs(ss.get('hp') - 110) < 1e-9);
});

test('stat-stack: removeModifier on missing returns false', () => {
  const ss = StatStack.create();
  assert.equal(ss.removeModifier('s', 'hp'), false);
});

test('stat-stack: removeBySource drops every modifier with that source across stats', () => {
  const ss = StatStack.create();
  ss.setBase('hp', 100);
  ss.setBase('atk', 100);
  ss.addModifier({ source: 'equip:fire', stat: 'hp', kind: 'flat', value: 20 });
  ss.addModifier({ source: 'equip:fire', stat: 'atk', kind: 'flat', value: 30 });
  ss.addModifier({ source: 'buff:str', stat: 'atk', kind: 'flat', value: 10 });
  const dropped = ss.removeBySource('equip:fire');
  assert.equal(dropped, 2);
  assert.equal(ss.get('hp'), 100);
  assert.equal(ss.get('atk'), 110);
});

test('stat-stack: getModifiers returns a fresh array of copies', () => {
  const ss = StatStack.create();
  ss.addModifier({ source: 'a', stat: 'hp', kind: 'flat', value: 10 });
  const list = ss.getModifiers('hp');
  list[0]!.value = 999;
  // Mutation does not change the stack's state.
  assert.equal(ss.getModifiers('hp')[0]!.value, 10);
});

test('stat-stack: getModifiers on missing stat returns empty array', () => {
  const ss = StatStack.create();
  assert.deepEqual(ss.getModifiers('nope'), []);
});

test('stat-stack: statNames lists every defined stat', () => {
  const ss = StatStack.create();
  ss.setBase('hp', 100);
  ss.setBase('atk', 50);
  // Adding a modifier registers a stat too.
  ss.addModifier({ source: 's', stat: 'crit', kind: 'flat', value: 0.05 });
  assert.deepEqual(ss.statNames().sort(), ['atk', 'crit', 'hp']);
});

test('stat-stack: onChanged fires with new + previous values', () => {
  const log: Array<{ stat: string; n: number; p: number }> = [];
  const ss = StatStack.create({
    onChanged: (s, n, p) => log.push({ stat: s, n: n, p: p }),
  });
  ss.setBase('hp', 100);
  ss.addModifier({ source: 'item', stat: 'hp', kind: 'flat', value: 50 });
  // Two events: setBase 0->100, addModifier 100->150.
  assert.equal(log.length, 2);
  assert.deepEqual(log[0], { stat: 'hp', n: 100, p: 0 });
  assert.deepEqual(log[1], { stat: 'hp', n: 150, p: 100 });
});

test('stat-stack: onChanged does NOT fire when value is unchanged', () => {
  const log: number[] = [];
  const ss = StatStack.create({ onChanged: (_, n) => log.push(n) });
  ss.setBase('hp', 100);
  ss.setBase('hp', 100);  // unchanged
  // Only the initial 0 -> 100 transition fires.
  assert.equal(log.length, 1);
});

test('stat-stack: throwing onChanged is isolated', () => {
  const ss = StatStack.create({
    onChanged: () => { throw new Error('boom'); },
  });
  ss.setBase('hp', 100);
  // Should not throw.
  assert.equal(ss.get('hp'), 100);
});

test('stat-stack: clear empties everything', () => {
  const ss = StatStack.create();
  ss.setBase('hp', 100);
  ss.addModifier({ source: 's', stat: 'hp', kind: 'flat', value: 10 });
  ss.clear();
  assert.equal(ss.get('hp'), 0);
  assert.deepEqual(ss.statNames(), []);
});

test('stat-stack: dispose makes ops no-op', () => {
  const ss = StatStack.create();
  ss.setBase('hp', 100);
  ss.dispose();
  assert.equal(ss.addModifier({ source: 's', stat: 'hp', kind: 'flat', value: 10 }), false);
  assert.equal(ss.get('hp'), 0);
});

test('stat-stack: realistic example - hero buff stack', () => {
  const ss = StatStack.create();
  ss.setBase('attackPower', 100);
  // Equip sword: +50 flat, +10% base.
  ss.addModifier({ source: 'equip:sword', stat: 'attackPower', kind: 'flat', value: 50 });
  ss.addModifier({ source: 'equip:sword', stat: 'attackPower', kind: 'percentBase', value: 0.10 });
  // Buff: +25% base (rage).
  ss.addModifier({ source: 'buff:rage', stat: 'attackPower', kind: 'percentBase', value: 0.25 });
  // Multiplier: critical strike x2.
  ss.addModifier({ source: 'crit', stat: 'attackPower', kind: 'multiplier', value: 2.0 });
  // (100 + 50) * (1 + 0.10 + 0.25) * 2.0 = 150 * 1.35 * 2.0 = 405.
  assert.equal(ss.get('attackPower'), 405);
  // Buff expires: drop rage.
  ss.removeBySource('buff:rage');
  // (150) * (1 + 0.10) * 2.0 = 150 * 1.10 * 2.0 = 330.
  assert.equal(ss.get('attackPower'), 330);
});
