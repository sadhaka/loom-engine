// Phase 1.1.1 - StatusEffectStack tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  StatusEffectStack,
  RESOURCE_STATUS_EFFECT_STACK,
  type ActiveEffect,
  type ApplyResult,
} from '../src/index.js';

test('sefx: RESOURCE_STATUS_EFFECT_STACK is the stable string', () => {
  assert.equal(RESOURCE_STATUS_EFFECT_STACK, 'status_effect_stack');
});

test('sefx: starts empty', () => {
  const s = StatusEffectStack.create();
  assert.equal(s.count(), 0);
});

test('sefx: defineEffect rejects empty / non-string id', () => {
  const s = StatusEffectStack.create();
  assert.equal(s.defineEffect({ id: '' }), false);
  // @ts-expect-error - testing runtime guard
  assert.equal(s.defineEffect({ id: null }), false);
});

test('sefx: apply unknown effect returns rejected_unknown', () => {
  const s = StatusEffectStack.create();
  assert.equal(s.apply('mob1', 'never-defined'), 'rejected_unknown');
});

test('sefx: apply with replace rule (default) replaces', () => {
  const s = StatusEffectStack.create();
  s.defineEffect({ id: 'slow', defaultDurationMs: 1000, defaultMagnitude: 0.5 });
  assert.equal(s.apply('mob1', 'slow'), 'applied');
  assert.equal(s.apply('mob1', 'slow', { magnitude: 0.7, durationMs: 500 }), 'replaced');
  const got = s.get('mob1', 'slow');
  assert.equal(got!.magnitude, 0.7);
  assert.equal(got!.remainingMs, 500);
  assert.equal(got!.stackCount, 1);
});

test('sefx: apply with refresh rule refreshes duration only', () => {
  const s = StatusEffectStack.create();
  s.defineEffect({
    id: 'haste', stacking: 'refresh',
    defaultDurationMs: 1000, defaultMagnitude: 1.5,
  });
  s.apply('mob1', 'haste', { magnitude: 1.5, durationMs: 1000 });
  s.tick(400);
  assert.equal(s.get('mob1', 'haste')!.remainingMs, 600);
  // Refresh: magnitude unchanged, duration reset.
  assert.equal(s.apply('mob1', 'haste', { magnitude: 9, durationMs: 1000 }), 'refreshed');
  const got = s.get('mob1', 'haste');
  assert.equal(got!.magnitude, 1.5);
  assert.equal(got!.remainingMs, 1000);
});

test('sefx: apply with stack rule increments stackCount up to maxStacks', () => {
  const s = StatusEffectStack.create();
  s.defineEffect({
    id: 'bleed', stacking: 'stack', maxStacks: 5,
    defaultDurationMs: 2000, defaultMagnitude: 2,
  });
  assert.equal(s.apply('mob1', 'bleed'), 'applied');
  assert.equal(s.apply('mob1', 'bleed'), 'stacked');
  assert.equal(s.apply('mob1', 'bleed'), 'stacked');
  assert.equal(s.getStacks('mob1', 'bleed'), 3);
  const got = s.get('mob1', 'bleed');
  assert.equal(got!.stackCount, 3);
  assert.equal(got!.magnitude, 2);
  assert.equal(got!.totalMagnitude, 6);
});

test('sefx: apply at maxStacks does not exceed cap', () => {
  const s = StatusEffectStack.create();
  s.defineEffect({
    id: 'bleed', stacking: 'stack', maxStacks: 3,
    defaultDurationMs: 2000, defaultMagnitude: 2,
  });
  s.apply('mob1', 'bleed');
  s.apply('mob1', 'bleed');
  s.apply('mob1', 'bleed');
  s.apply('mob1', 'bleed');
  s.apply('mob1', 'bleed');
  assert.equal(s.getStacks('mob1', 'bleed'), 3);
});

test('sefx: stack rule durationDR scales each successive stack', () => {
  const s = StatusEffectStack.create();
  s.defineEffect({
    id: 'stun', stacking: 'stack', maxStacks: 5,
    defaultDurationMs: 1000, defaultMagnitude: 1,
    durationDR: 0.5,
  });
  s.apply('mob1', 'stun', { durationMs: 1000 });
  // First stack: dur = 1000 * 0.5^0 = 1000.
  assert.equal(s.get('mob1', 'stun')!.remainingMs, 1000);
  s.apply('mob1', 'stun', { durationMs: 1000 });
  // Second stack: scaled = 1000 * 0.5^1 = 500. But remainingMs uses
  // max(existing, scaled), so existing 1000 wins.
  assert.equal(s.get('mob1', 'stun')!.remainingMs, 1000);
});

test('sefx: highest rule keeps higher magnitude', () => {
  const s = StatusEffectStack.create();
  s.defineEffect({
    id: 'slow', stacking: 'highest',
    defaultDurationMs: 1000, defaultMagnitude: 0.3,
  });
  s.apply('mob1', 'slow', { magnitude: 0.3 });
  assert.equal(s.apply('mob1', 'slow', { magnitude: 0.6 }), 'replaced');
  assert.equal(s.get('mob1', 'slow')!.magnitude, 0.6);
  // Apply lower magnitude should be rejected.
  assert.equal(s.apply('mob1', 'slow', { magnitude: 0.4 }), 'rejected_lower');
  assert.equal(s.get('mob1', 'slow')!.magnitude, 0.6);
});

test('sefx: longest rule keeps longer remaining', () => {
  const s = StatusEffectStack.create();
  s.defineEffect({
    id: 'curse', stacking: 'longest',
    defaultDurationMs: 1000, defaultMagnitude: 1,
  });
  s.apply('mob1', 'curse', { durationMs: 1000 });
  s.tick(400); // remaining = 600
  // Apply with shorter remaining -> rejected.
  assert.equal(s.apply('mob1', 'curse', { durationMs: 500 }), 'rejected_lower');
  // Apply with longer -> replaces.
  assert.equal(s.apply('mob1', 'curse', { durationMs: 800 }), 'replaced');
  assert.equal(s.get('mob1', 'curse')!.remainingMs, 800);
});

test('sefx: tick advances ageMs and decreases remainingMs', () => {
  const s = StatusEffectStack.create();
  s.defineEffect({ id: 'slow', defaultDurationMs: 1000, defaultMagnitude: 0.5 });
  s.apply('mob1', 'slow');
  s.tick(300);
  const got = s.get('mob1', 'slow');
  assert.equal(got!.ageMs, 300);
  assert.equal(got!.remainingMs, 700);
});

test('sefx: tick expires when remainingMs reaches 0', () => {
  const s = StatusEffectStack.create();
  s.defineEffect({ id: 'slow', defaultDurationMs: 100, defaultMagnitude: 0.5 });
  s.apply('mob1', 'slow');
  s.tick(150);
  assert.equal(s.has('mob1', 'slow'), false);
});

test('sefx: immunityAfterExpireMs blocks new applies during window', () => {
  const s = StatusEffectStack.create();
  s.defineEffect({
    id: 'stun', defaultDurationMs: 100, defaultMagnitude: 1,
    immunityAfterExpireMs: 200,
  });
  s.apply('mob1', 'stun');
  s.tick(150); // expires
  assert.equal(s.has('mob1', 'stun'), false);
  assert.equal(s.isImmune('mob1', 'stun'), true);
  // Apply during immunity is rejected.
  assert.equal(s.apply('mob1', 'stun'), 'rejected_immune');
  // Tick past immunity.
  s.tick(250);
  assert.equal(s.isImmune('mob1', 'stun'), false);
  // Apply now allowed.
  assert.equal(s.apply('mob1', 'stun'), 'applied');
});

test('sefx: removeEffect removes + triggers immunity if configured', () => {
  const s = StatusEffectStack.create();
  s.defineEffect({
    id: 'stun', defaultDurationMs: 1000, defaultMagnitude: 1,
    immunityAfterExpireMs: 500,
  });
  s.apply('mob1', 'stun');
  assert.equal(s.removeEffect('mob1', 'stun'), true);
  assert.equal(s.has('mob1', 'stun'), false);
  assert.equal(s.isImmune('mob1', 'stun'), true);
});

test('sefx: removeEffect on missing returns false', () => {
  const s = StatusEffectStack.create();
  s.defineEffect({ id: 'slow' });
  assert.equal(s.removeEffect('mob1', 'slow'), false);
});

test('sefx: listForTarget returns active effects on target', () => {
  const s = StatusEffectStack.create();
  s.defineEffect({ id: 'slow' });
  s.defineEffect({ id: 'bleed', stacking: 'stack', maxStacks: 5 });
  s.apply('mob1', 'slow');
  s.apply('mob1', 'bleed');
  s.apply('mob2', 'slow');
  const list = s.listForTarget('mob1');
  assert.equal(list.length, 2);
  const ids = list.map((e) => e.effectId).sort();
  assert.deepEqual(ids, ['bleed', 'slow']);
});

test('sefx: listByEffect returns targets with that effect', () => {
  const s = StatusEffectStack.create();
  s.defineEffect({ id: 'slow' });
  s.apply('mob1', 'slow');
  s.apply('mob2', 'slow');
  s.apply('mob3', 'slow');
  const list = s.listByEffect('slow');
  assert.equal(list.length, 3);
});

test('sefx: clearTarget removes all from target + fires onExpire', () => {
  const events: Array<{ id: string; reason: string }> = [];
  const s = StatusEffectStack.create({
    onExpire: (e, r) => events.push({ id: e.effectId, reason: r }),
  });
  s.defineEffect({ id: 'slow' });
  s.defineEffect({ id: 'bleed', stacking: 'stack', maxStacks: 5 });
  s.apply('mob1', 'slow');
  s.apply('mob1', 'bleed');
  const cleared = s.clearTarget('mob1');
  assert.equal(cleared, 2);
  assert.equal(events.length, 2);
  for (const e of events) assert.equal(e.reason, 'cleared');
});

test('sefx: forEach iterates all active entries', () => {
  const s = StatusEffectStack.create();
  s.defineEffect({ id: 'slow' });
  s.apply('mob1', 'slow');
  s.apply('mob2', 'slow');
  const seen: string[] = [];
  s.forEach((e) => seen.push(e.targetId));
  assert.deepEqual(seen.sort(), ['mob1', 'mob2']);
});

test('sefx: NaN / Infinity / negative dt no-op', () => {
  const s = StatusEffectStack.create();
  s.defineEffect({ id: 'slow', defaultDurationMs: 100 });
  s.apply('mob1', 'slow');
  s.tick(NaN);
  s.tick(-50);
  s.tick(Infinity);
  assert.equal(s.has('mob1', 'slow'), true);
  assert.equal(s.get('mob1', 'slow')!.ageMs, 0);
});

test('sefx: throwing onApply / onExpire isolated', () => {
  const s = StatusEffectStack.create({
    onApply: () => { throw new Error('apply-boom'); },
    onExpire: () => { throw new Error('expire-boom'); },
  });
  s.defineEffect({ id: 'slow', defaultDurationMs: 100 });
  s.apply('mob1', 'slow');
  s.tick(150);
  // Should not throw.
  assert.equal(s.has('mob1', 'slow'), false);
});

test('sefx: dispose locks ops', () => {
  const s = StatusEffectStack.create();
  s.defineEffect({ id: 'slow' });
  s.apply('mob1', 'slow');
  s.dispose();
  assert.equal(s.defineEffect({ id: 'b' }), false);
  assert.equal(s.apply('mob1', 'slow'), 'rejected_unknown');
  assert.equal(s.removeEffect('mob1', 'slow'), false);
  assert.equal(s.count(), 0);
});

test('sefx: realistic example - bleed stacks + slow highest-wins + stun DR', () => {
  const events: Array<{ id: string; result: ApplyResult }> = [];
  const s = StatusEffectStack.create({
    onApply: (e, r) => events.push({ id: e.effectId, result: r }),
  });
  // Bleed stacks up to 5.
  s.defineEffect({ id: 'bleed', stacking: 'stack', maxStacks: 5,
    defaultDurationMs: 4000, defaultMagnitude: 2 });
  // Slow doesn't stack - highest wins.
  s.defineEffect({ id: 'slow', stacking: 'highest',
    defaultDurationMs: 3000, defaultMagnitude: 0.3 });
  // Stun DR: each stun lasts half the duration of the prior.
  s.defineEffect({ id: 'stun', stacking: 'stack', maxStacks: 3,
    defaultDurationMs: 1000, defaultMagnitude: 1, durationDR: 0.5,
    immunityAfterExpireMs: 500 });

  // Combat: 3 bleed hits, 2 slow attempts (60% then 40%), 2 stun hits.
  s.apply('mob1', 'bleed');
  s.apply('mob1', 'bleed');
  s.apply('mob1', 'bleed');
  s.apply('mob1', 'slow', { magnitude: 0.6 });
  s.apply('mob1', 'slow', { magnitude: 0.4 });
  s.apply('mob1', 'stun');
  s.apply('mob1', 'stun');

  const bleed = s.get('mob1', 'bleed');
  assert.equal(bleed!.stackCount, 3);
  assert.equal(bleed!.totalMagnitude, 6);
  const slow = s.get('mob1', 'slow');
  assert.equal(slow!.magnitude, 0.6); // higher wins
  const stun = s.get('mob1', 'stun');
  assert.equal(stun!.stackCount, 2);

  // Last slow apply rejected (lower magnitude).
  const slowEvents = events.filter((e) => e.id === 'slow');
  assert.equal(slowEvents.length, 1); // only the first apply succeeded
  assert.equal(slowEvents[0]!.result, 'applied');
});
