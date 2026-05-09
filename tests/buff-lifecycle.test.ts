// Phase 0.73.0 - BuffLifecycle tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  BuffLifecycle,
  RESOURCE_BUFF_LIFECYCLE,
  StatStack,
  type Modifier,
  type Buff,
} from '../src/index.js';

// Recording stat-stack-like for tests that don't need full StatStack.
function makeRecorder() {
  const added: Modifier[] = [];
  const removed: string[] = [];
  return {
    added,
    removed,
    addModifier: (m: Modifier) => { added.push(m); return true; },
    removeBySource: (s: string) => {
      const before = added.length;
      // Remove from `added` for tracking (mimic StatStack).
      for (let i = added.length - 1; i >= 0; i--) {
        if ((added[i] as Modifier).source === s) added.splice(i, 1);
      }
      removed.push(s);
      return before - added.length;
    },
  };
}

test('buff-lifecycle: RESOURCE_BUFF_LIFECYCLE is the stable string', () => {
  assert.equal(RESOURCE_BUFF_LIFECYCLE, 'buff_lifecycle');
});

test('buff-lifecycle: apply pushes modifiers to StatStack with prefixed source', () => {
  const rec = makeRecorder();
  const lifecycle = BuffLifecycle.create({ statStack: rec });
  assert.ok(lifecycle.apply({
    id: 'rage',
    durationMs: 5000,
    modifiers: [
      { source: '', stat: 'attackPower', kind: 'flat', value: 20 },
      { source: '', stat: 'attackPower', kind: 'percentBase', value: 0.1 },
    ],
  }));
  assert.equal(rec.added.length, 2);
  assert.equal(rec.added[0]!.source, 'buff:rage');
  assert.equal(rec.added[0]!.stat, 'attackPower');
  assert.equal(rec.added[0]!.kind, 'flat');
  assert.equal(rec.added[0]!.value, 20);
  assert.ok(lifecycle.has('rage'));
  assert.equal(lifecycle.remainingMs('rage'), 5000);
});

test('buff-lifecycle: apply without StatStack just tracks (no error)', () => {
  const lifecycle = BuffLifecycle.create();
  assert.ok(lifecycle.apply({
    id: 'mark',
    durationMs: 1000,
    modifiers: [{ source: '', stat: 'speed', kind: 'flat', value: 5 }],
  }));
  assert.ok(lifecycle.has('mark'));
});

test('buff-lifecycle: duplicate apply refreshes duration + replaces modifiers; isRefresh=true', () => {
  const log: Array<{ id: string; refresh: boolean }> = [];
  const rec = makeRecorder();
  const lifecycle = BuffLifecycle.create({
    statStack: rec,
    onApplied: (b, refresh) => log.push({ id: b.id, refresh }),
  });
  lifecycle.apply({
    id: 'rage', durationMs: 5000,
    modifiers: [{ source: '', stat: 'atk', kind: 'flat', value: 10 }],
  });
  // Tick partway.
  lifecycle.tick(2000);
  assert.equal(lifecycle.remainingMs('rage'), 3000);
  // Refresh via re-apply.
  lifecycle.apply({
    id: 'rage', durationMs: 5000,
    modifiers: [{ source: '', stat: 'atk', kind: 'flat', value: 25 }],
  });
  assert.equal(log[0]!.refresh, false);
  assert.equal(log[1]!.refresh, true);
  assert.equal(lifecycle.remainingMs('rage'), 5000);
  // Old modifier gone, new one in place.
  assert.equal(rec.added.length, 1);
  assert.equal(rec.added[0]!.value, 25);
});

test('buff-lifecycle: remove drops modifiers + fires onRemoved (not onExpired)', () => {
  let removedCount = 0;
  let expiredCount = 0;
  const rec = makeRecorder();
  const lifecycle = BuffLifecycle.create({
    statStack: rec,
    onRemoved: () => { removedCount++; },
    onExpired: () => { expiredCount++; },
  });
  lifecycle.apply({
    id: 'shield', durationMs: 5000,
    modifiers: [{ source: '', stat: 'armor', kind: 'flat', value: 50 }],
  });
  assert.equal(rec.added.length, 1);
  assert.ok(lifecycle.remove('shield'));
  assert.equal(rec.added.length, 0);
  assert.ok(!lifecycle.has('shield'));
  assert.equal(removedCount, 1);
  assert.equal(expiredCount, 0);
});

test('buff-lifecycle: tick advances elapsedMs; fires onExpired at expiry; modifiers stripped', () => {
  let expired = 0;
  const rec = makeRecorder();
  const lifecycle = BuffLifecycle.create({
    statStack: rec,
    onExpired: () => { expired++; },
  });
  lifecycle.apply({
    id: 'haste', durationMs: 1000,
    modifiers: [{ source: '', stat: 'speed', kind: 'flat', value: 5 }],
  });
  assert.equal(rec.added.length, 1);
  lifecycle.tick(500);
  assert.equal(lifecycle.remainingMs('haste'), 500);
  assert.equal(expired, 0);
  lifecycle.tick(500);
  assert.equal(expired, 1);
  assert.ok(!lifecycle.has('haste'));
  // Modifiers gone.
  assert.equal(rec.added.length, 0);
});

test('buff-lifecycle: permanent buff (durationMs <= 0) never expires', () => {
  const lifecycle = BuffLifecycle.create();
  lifecycle.apply({ id: 'aura', durationMs: 0, modifiers: [] });
  lifecycle.tick(1_000_000);
  assert.ok(lifecycle.has('aura'));
  assert.equal(lifecycle.remainingMs('aura'), -1);
  // Negative duration also permanent.
  lifecycle.apply({ id: 'aura2', durationMs: -1, modifiers: [] });
  lifecycle.tick(1_000_000);
  assert.ok(lifecycle.has('aura2'));
  assert.equal(lifecycle.remainingMs('aura2'), -1);
});

test('buff-lifecycle: tickIntervalMs fires onTick at the right cadence', () => {
  const ticks: Array<{ id: string; idx: number }> = [];
  const lifecycle = BuffLifecycle.create({
    onTick: (b, idx) => ticks.push({ id: b.id, idx }),
  });
  lifecycle.apply({
    id: 'burn', durationMs: 5000, tickIntervalMs: 1000,
  });
  lifecycle.tick(500);
  assert.equal(ticks.length, 0);
  lifecycle.tick(600); // crosses 1000ms boundary
  assert.equal(ticks.length, 1);
  assert.equal(ticks[0]!.idx, 1);
  // 4 more ticks crossing 2000, 3000, 4000, 5000.
  lifecycle.tick(4000);
  assert.equal(ticks.length, 5);
});

test('buff-lifecycle: large dt fires multiple ticks in one call', () => {
  const ticks: number[] = [];
  const lifecycle = BuffLifecycle.create({
    onTick: (_b, idx) => ticks.push(idx),
  });
  lifecycle.apply({ id: 'poison', durationMs: 10_000, tickIntervalMs: 250 });
  lifecycle.tick(1000); // 4 ticks at 250/500/750/1000
  assert.deepEqual(ticks, [1, 2, 3, 4]);
});

test('buff-lifecycle: tick boundary at exactly tickIntervalMs (epoch crossing)', () => {
  const ticks: number[] = [];
  const lifecycle = BuffLifecycle.create({
    onTick: (_b, idx) => ticks.push(idx),
  });
  lifecycle.apply({ id: 'tick', durationMs: 5000, tickIntervalMs: 100 });
  lifecycle.tick(99); // no boundary crossed
  assert.deepEqual(ticks, []);
  lifecycle.tick(1); // crosses 100
  assert.deepEqual(ticks, [1]);
});

test('buff-lifecycle: ticks bounded by durationMs (no over-tick on expiry)', () => {
  const ticks: number[] = [];
  let expired = 0;
  const lifecycle = BuffLifecycle.create({
    onTick: (_b, i) => ticks.push(i),
    onExpired: () => { expired++; },
  });
  lifecycle.apply({ id: 'short', durationMs: 1000, tickIntervalMs: 250 });
  // dt past duration: 1500ms. Boundaries: 250/500/750/1000 = 4 ticks.
  // No 5th tick because elapsed > duration.
  lifecycle.tick(1500);
  assert.deepEqual(ticks, [1, 2, 3, 4]);
  assert.equal(expired, 1);
});

test('buff-lifecycle: has + remainingMs reflect state correctly', () => {
  const lifecycle = BuffLifecycle.create();
  assert.equal(lifecycle.has('x'), false);
  assert.equal(lifecycle.remainingMs('x'), 0);
  lifecycle.apply({ id: 'x', durationMs: 1000 });
  assert.equal(lifecycle.has('x'), true);
  assert.equal(lifecycle.remainingMs('x'), 1000);
  lifecycle.tick(400);
  assert.equal(lifecycle.remainingMs('x'), 600);
});

test('buff-lifecycle: list returns defensive copy of active buffs', () => {
  const lifecycle = BuffLifecycle.create();
  lifecycle.apply({ id: 'a', durationMs: 1000 });
  lifecycle.apply({ id: 'b', durationMs: 2000 });
  const arr = lifecycle.list();
  assert.equal(arr.length, 2);
  // Mutating the list does not affect lifecycle.
  arr.push({} as never);
  assert.equal(lifecycle.list().length, 2);
});

test('buff-lifecycle: removeAll clears + fires onRemoved per buff', () => {
  let removed = 0;
  const lifecycle = BuffLifecycle.create({
    onRemoved: () => { removed++; },
  });
  lifecycle.apply({ id: 'a', durationMs: 1000 });
  lifecycle.apply({ id: 'b', durationMs: 1000 });
  lifecycle.apply({ id: 'c', durationMs: 1000 });
  assert.equal(lifecycle.removeAll(), 3);
  assert.equal(removed, 3);
  assert.equal(lifecycle.list().length, 0);
});

test('buff-lifecycle: NaN / negative dt ignored', () => {
  const ticks: number[] = [];
  const lifecycle = BuffLifecycle.create({
    onTick: (_b, i) => ticks.push(i),
  });
  lifecycle.apply({ id: 't', durationMs: 1000, tickIntervalMs: 100 });
  lifecycle.tick(NaN);
  lifecycle.tick(-50);
  assert.deepEqual(ticks, []);
  assert.equal(lifecycle.remainingMs('t'), 1000);
});

test('buff-lifecycle: throwing onApplied / onTick / onExpired / onRemoved isolated', () => {
  const lifecycle = BuffLifecycle.create({
    onApplied: () => { throw new Error('onApplied boom'); },
    onTick: () => { throw new Error('onTick boom'); },
    onExpired: () => { throw new Error('onExpired boom'); },
    onRemoved: () => { throw new Error('onRemoved boom'); },
  });
  // Should not throw.
  lifecycle.apply({ id: 'x', durationMs: 100, tickIntervalMs: 50 });
  lifecycle.tick(50);
  lifecycle.tick(60);
  lifecycle.apply({ id: 'y', durationMs: 100 });
  lifecycle.remove('y');
  assert.equal(lifecycle.list().length, 0);
});

test('buff-lifecycle: dispose strips all StatStack mods + locks ops', () => {
  const rec = makeRecorder();
  const lifecycle = BuffLifecycle.create({ statStack: rec });
  lifecycle.apply({
    id: 'a', durationMs: 1000,
    modifiers: [{ source: '', stat: 's', kind: 'flat', value: 1 }],
  });
  lifecycle.apply({
    id: 'b', durationMs: 1000,
    modifiers: [{ source: '', stat: 's', kind: 'flat', value: 2 }],
  });
  assert.equal(rec.added.length, 2);
  lifecycle.dispose();
  assert.equal(rec.added.length, 0);
  // Subsequent ops no-op.
  assert.equal(lifecycle.apply({ id: 'c', durationMs: 1000 }), false);
  lifecycle.tick(1000);
  assert.equal(lifecycle.has('a'), false);
});

test('buff-lifecycle: multiple distinct buff ids stack independently', () => {
  const ticks: string[] = [];
  const lifecycle = BuffLifecycle.create({
    onTick: (b) => ticks.push(b.id),
  });
  lifecycle.apply({ id: 'burn', durationMs: 3000, tickIntervalMs: 500 });
  lifecycle.apply({ id: 'bleed', durationMs: 2000, tickIntervalMs: 1000 });
  lifecycle.tick(1000);
  // burn ticks at 500, 1000 (2 ticks); bleed ticks at 1000 (1 tick).
  assert.deepEqual(ticks.sort(), ['bleed', 'burn', 'burn'].sort());
});

test('buff-lifecycle: buff.modifiers undefined treated as no-op for StatStack', () => {
  const rec = makeRecorder();
  const lifecycle = BuffLifecycle.create({ statStack: rec });
  lifecycle.apply({ id: 'marker', durationMs: 1000 });
  assert.equal(rec.added.length, 0);
  assert.ok(lifecycle.has('marker'));
});

test('buff-lifecycle: refresh resets timer + ticks but does not re-apply modifiers', () => {
  const rec = makeRecorder();
  const lifecycle = BuffLifecycle.create({ statStack: rec });
  lifecycle.apply({
    id: 'rage', durationMs: 5000,
    modifiers: [{ source: '', stat: 'atk', kind: 'flat', value: 10 }],
    tickIntervalMs: 1000,
  });
  lifecycle.tick(3000); // 3 ticks elapsed
  assert.equal(rec.added.length, 1);
  assert.ok(lifecycle.refresh('rage'));
  assert.equal(lifecycle.remainingMs('rage'), 5000);
  // Tick counter reset.
  const list = lifecycle.list();
  assert.equal(list[0]!.ticksFired, 0);
  // Modifier still in place; not re-pushed.
  assert.equal(rec.added.length, 1);
});

test('buff-lifecycle: refresh on inactive buff returns false', () => {
  const lifecycle = BuffLifecycle.create();
  assert.equal(lifecycle.refresh('nope'), false);
});

test('buff-lifecycle: realistic DoT - burn for 3 seconds, ticks every 500ms', () => {
  const stats = StatStack.create();
  stats.setBase('hp', 100);
  let hp = 100;
  const lifecycle = BuffLifecycle.create({
    statStack: stats,
    onTick: (b) => {
      if (b.id === 'burn') {
        const dmg = (b.data && typeof b.data['damage'] === 'number') ? b.data['damage'] as number : 0;
        hp -= dmg;
      }
    },
    onExpired: (b) => {
      assert.equal(b.id, 'burn');
    },
  });
  lifecycle.apply({
    id: 'burn',
    durationMs: 3000,
    tickIntervalMs: 500,
    data: { damage: 5 },
  });
  // 3 seconds / 500ms = 6 ticks.
  lifecycle.tick(3000);
  assert.equal(hp, 100 - 5 * 6);
  assert.ok(!lifecycle.has('burn'));
});
