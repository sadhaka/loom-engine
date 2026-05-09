// Phase 0.82.0 - ThresholdTrigger tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  ThresholdTrigger,
  RESOURCE_THRESHOLD_TRIGGER,
} from '../src/index.js';

test('threshold-trigger: RESOURCE constant', () => {
  assert.equal(RESOURCE_THRESHOLD_TRIGGER, 'threshold_trigger');
});

test('threshold-trigger: register / has / unregister', () => {
  const t = ThresholdTrigger.create();
  assert.ok(t.register({ id: 'x', threshold: 10, direction: 'below' }));
  assert.ok(t.has('x'));
  assert.ok(t.unregister('x'));
  assert.equal(t.has('x'), false);
});

test('threshold-trigger: register rejects duplicates / invalid', () => {
  const t = ThresholdTrigger.create();
  t.register({ id: 'x', threshold: 10, direction: 'below' });
  assert.equal(t.register({ id: 'x', threshold: 5, direction: 'below' }), false);
  assert.equal(t.register({ id: '', threshold: 10, direction: 'below' }), false);
  assert.equal(t.register({ id: 'y', threshold: NaN, direction: 'below' }), false);
  assert.equal(t.register({ id: 'y', threshold: 10, direction: 'sideways' as 'below' }), false);
});

test('threshold-trigger: below direction fires when value <= threshold', () => {
  let fires = 0;
  const t = ThresholdTrigger.create();
  t.register({
    id: 'low-hp', threshold: 25, direction: 'below',
    onTrigger: () => { fires++; },
  });
  t.update('low-hp', 50);
  assert.equal(fires, 0);
  t.update('low-hp', 25); // exact threshold
  assert.equal(fires, 1);
});

test('threshold-trigger: above direction fires when value >= threshold', () => {
  let fires = 0;
  const t = ThresholdTrigger.create();
  t.register({
    id: 'high-temp', threshold: 100, direction: 'above',
    onTrigger: () => { fires++; },
  });
  t.update('high-temp', 50);
  assert.equal(fires, 0);
  t.update('high-temp', 110);
  assert.equal(fires, 1);
});

test('threshold-trigger: does not refire while remaining triggered', () => {
  let fires = 0;
  const t = ThresholdTrigger.create();
  t.register({
    id: 'x', threshold: 25, direction: 'below',
    onTrigger: () => { fires++; },
  });
  t.update('x', 20);
  t.update('x', 15);
  t.update('x', 10);
  assert.equal(fires, 1);
});

test('threshold-trigger: rearms when value crosses back; no hysteresis', () => {
  let triggers = 0;
  let rearms = 0;
  const t = ThresholdTrigger.create();
  t.register({
    id: 'x', threshold: 25, direction: 'below',
    onTrigger: () => { triggers++; },
    onRearm: () => { rearms++; },
  });
  t.update('x', 20); // trigger
  t.update('x', 30); // rearm
  t.update('x', 20); // trigger again
  assert.equal(triggers, 2);
  assert.equal(rearms, 1);
});

test('threshold-trigger: hysteresis prevents flapping near boundary', () => {
  let triggers = 0;
  let rearms = 0;
  const t = ThresholdTrigger.create();
  t.register({
    id: 'x', threshold: 25, direction: 'below', hysteresis: 5,
    onTrigger: () => { triggers++; },
    onRearm: () => { rearms++; },
  });
  t.update('x', 20); // trigger
  t.update('x', 26); // not yet rearmed (need > 30)
  t.update('x', 28); // not yet rearmed
  t.update('x', 31); // rearm
  t.update('x', 28); // not yet triggered (still > 25)
  t.update('x', 24); // trigger
  assert.equal(triggers, 2);
  assert.equal(rearms, 1);
});

test('threshold-trigger: hysteresis above direction', () => {
  let triggers = 0;
  let rearms = 0;
  const t = ThresholdTrigger.create();
  t.register({
    id: 'x', threshold: 100, direction: 'above', hysteresis: 5,
    onTrigger: () => { triggers++; },
    onRearm: () => { rearms++; },
  });
  t.update('x', 110); // trigger
  t.update('x', 96); // not yet rearmed (need < 95)
  t.update('x', 90); // rearm
  t.update('x', 102); // trigger
  assert.equal(triggers, 2);
  assert.equal(rearms, 1);
});

test('threshold-trigger: reset force-arms', () => {
  const t = ThresholdTrigger.create();
  t.register({ id: 'x', threshold: 25, direction: 'below' });
  t.update('x', 20);
  assert.ok(t.isTriggered('x'));
  assert.equal(t.isArmed('x'), false);
  t.reset('x');
  assert.ok(t.isArmed('x'));
  assert.equal(t.isTriggered('x'), false);
});

test('threshold-trigger: lastValueOf reports last observed value', () => {
  const t = ThresholdTrigger.create();
  t.register({ id: 'x', threshold: 25, direction: 'below' });
  assert.ok(isNaN(t.lastValueOf('x')));
  t.update('x', 42);
  assert.equal(t.lastValueOf('x'), 42);
});

test('threshold-trigger: unknown id update returns false', () => {
  const t = ThresholdTrigger.create();
  assert.equal(t.update('ghost', 50), false);
});

test('threshold-trigger: NaN value rejected', () => {
  const t = ThresholdTrigger.create();
  t.register({ id: 'x', threshold: 25, direction: 'below' });
  assert.equal(t.update('x', NaN), false);
});

test('threshold-trigger: list returns defensive copy', () => {
  const t = ThresholdTrigger.create();
  t.register({ id: 'x', threshold: 25, direction: 'below', hysteresis: 5 });
  t.register({ id: 'y', threshold: 100, direction: 'above' });
  const arr = t.list();
  assert.equal(arr.length, 2);
  arr.push({} as never);
  assert.equal(t.list().length, 2);
});

test('threshold-trigger: dispose locks ops', () => {
  const t = ThresholdTrigger.create();
  t.register({ id: 'x', threshold: 25, direction: 'below' });
  t.dispose();
  assert.equal(t.register({ id: 'y', threshold: 5, direction: 'above' }), false);
  assert.equal(t.update('x', 5), false);
  assert.equal(t.unregister('x'), false);
  assert.equal(t.has('x'), false);
});

test('threshold-trigger: throwing callbacks isolated', () => {
  const t = ThresholdTrigger.create();
  t.register({
    id: 'x', threshold: 25, direction: 'below',
    onTrigger: () => { throw new Error('boom'); },
    onRearm: () => { throw new Error('boom'); },
  });
  // Should not throw.
  t.update('x', 20);
  t.update('x', 30);
});

test('threshold-trigger: realistic low-hp alarm with rearm cycle', () => {
  const log: string[] = [];
  const t = ThresholdTrigger.create();
  t.register({
    id: 'low-hp', threshold: 25, direction: 'below', hysteresis: 5,
    onTrigger: () => log.push('trigger'),
    onRearm: () => log.push('rearm'),
  });
  // Player drops to 20% HP.
  t.update('low-hp', 20);
  // Heals to 28% (within hysteresis - no rearm).
  t.update('low-hp', 28);
  // Drops back to 22% - still no new trigger (already triggered).
  t.update('low-hp', 22);
  // Heals to 35% (past 30 = threshold + hysteresis) - rearm.
  t.update('low-hp', 35);
  // Drops to 24% - new trigger.
  t.update('low-hp', 24);
  assert.deepEqual(log, ['trigger', 'rearm', 'trigger']);
});

test('threshold-trigger: size + list count match', () => {
  const t = ThresholdTrigger.create();
  for (let i = 0; i < 5; i++) t.register({ id: 't' + i, threshold: i, direction: 'below' });
  assert.equal(t.size(), 5);
  assert.equal(t.list().length, 5);
});

test('threshold-trigger: register without callbacks tolerated', () => {
  const t = ThresholdTrigger.create();
  assert.ok(t.register({ id: 'x', threshold: 10, direction: 'below' }));
  // No callbacks; just polls state.
  t.update('x', 5);
  assert.ok(t.isTriggered('x'));
  t.update('x', 15);
  assert.ok(t.isArmed('x'));
});

test('threshold-trigger: triggers can be queried via isTriggered / isArmed', () => {
  const t = ThresholdTrigger.create();
  t.register({ id: 'x', threshold: 50, direction: 'below' });
  assert.ok(t.isArmed('x'));
  assert.equal(t.isTriggered('x'), false);
  t.update('x', 40);
  assert.equal(t.isArmed('x'), false);
  assert.ok(t.isTriggered('x'));
});

test('threshold-trigger: unknown id queries return defaults', () => {
  const t = ThresholdTrigger.create();
  assert.equal(t.isArmed('ghost'), false);
  assert.equal(t.isTriggered('ghost'), false);
  assert.ok(isNaN(t.lastValueOf('ghost')));
});

test('threshold-trigger: invalid hysteresis rejected (negative ignored)', () => {
  const t = ThresholdTrigger.create();
  t.register({ id: 'x', threshold: 25, direction: 'below', hysteresis: -10 });
  // hysteresis stored as 0 (rejected for being < 0).
  const list = t.list();
  // Hysteresis field absent in returned spec.
  assert.equal(list[0]!.hysteresis, undefined);
});
