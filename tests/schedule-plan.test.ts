// Phase 1.3.4 - SchedulePlan tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  SchedulePlan,
  RESOURCE_SCHEDULE_PLAN,
} from '../src/index.js';

test('sp: RESOURCE_SCHEDULE_PLAN is the stable string', () => {
  assert.equal(RESOURCE_SCHEDULE_PLAN, 'schedule_plan');
});

test('sp: starts empty', () => {
  const sp = SchedulePlan.create();
  assert.equal(sp.blockCount(), 0);
});

test('sp: addBlock + hasBlock + getBlock', () => {
  const sp = SchedulePlan.create();
  sp.addBlock({
    id: 'a', characterId: 'mira',
    startMinute: 9 * 60, endMinute: 11 * 60,
    location: 'market',
  });
  assert.equal(sp.hasBlock('a'), true);
  const b = sp.getBlock('a');
  assert.equal(b!.location, 'market');
});

test('sp: addBlock rejects empty / invalid args', () => {
  const sp = SchedulePlan.create();
  assert.equal(sp.addBlock({
    id: '', characterId: 'mira', startMinute: 0, endMinute: 100, location: 'a',
  }), false);
  assert.equal(sp.addBlock({
    id: 'a', characterId: '', startMinute: 0, endMinute: 100, location: 'a',
  }), false);
  assert.equal(sp.addBlock({
    id: 'a', characterId: 'mira', startMinute: -10, endMinute: 100, location: 'a',
  }), false);
});

test('sp: removeBlock drops it', () => {
  const sp = SchedulePlan.create();
  sp.addBlock({
    id: 'a', characterId: 'mira', startMinute: 0, endMinute: 100, location: 'home',
  });
  assert.equal(sp.removeBlock('a'), true);
  assert.equal(sp.hasBlock('a'), false);
});

test('sp: updateBlock partial mutation', () => {
  const sp = SchedulePlan.create();
  sp.addBlock({
    id: 'a', characterId: 'mira', startMinute: 0, endMinute: 100, location: 'home',
  });
  sp.updateBlock('a', { location: 'market', startMinute: 60 });
  const b = sp.getBlock('a');
  assert.equal(b!.location, 'market');
  assert.equal(b!.startMinute, 60);
});

test('sp: current picks active block in window', () => {
  const sp = SchedulePlan.create();
  sp.addBlock({
    id: 'morning', characterId: 'mira',
    startMinute: 9 * 60, endMinute: 11 * 60, location: 'market',
  });
  const at10 = sp.current('mira', { minute: 10 * 60 });
  assert.ok(at10);
  assert.equal(at10!.location, 'market');
  const at8 = sp.current('mira', { minute: 8 * 60 });
  assert.equal(at8, null);
});

test('sp: current returns progress + remainingMinutes', () => {
  const sp = SchedulePlan.create();
  sp.addBlock({
    id: 'a', characterId: 'mira',
    startMinute: 9 * 60, endMinute: 11 * 60, location: 'market',
  });
  const at10 = sp.current('mira', { minute: 10 * 60 });
  assert.ok(Math.abs(at10!.progress - 0.5) < 1e-6);
  assert.equal(at10!.remainingMinutes, 60);
});

test('sp: weekday filter', () => {
  const sp = SchedulePlan.create();
  sp.addBlock({
    id: 'tue_market', characterId: 'mira',
    startMinute: 9 * 60, endMinute: 11 * 60, location: 'market',
    weekdays: [2], // Tuesday only
  });
  const tue = sp.current('mira', { minute: 10 * 60, weekday: 2 });
  assert.ok(tue);
  const wed = sp.current('mira', { minute: 10 * 60, weekday: 3 });
  assert.equal(wed, null);
});

test('sp: weekday filter ignored when ctx.weekday absent', () => {
  const sp = SchedulePlan.create();
  sp.addBlock({
    id: 'a', characterId: 'mira',
    startMinute: 0, endMinute: 1000, location: 'home',
    weekdays: [0],
  });
  // No weekday in ctx -> matches.
  const r = sp.current('mira', { minute: 100 });
  assert.ok(r);
});

test('sp: condition predicate gates block', () => {
  const sp = SchedulePlan.create();
  sp.addBlock({
    id: 'festival', characterId: 'mira',
    startMinute: 0, endMinute: 1440, location: 'plaza',
    condition: (ctx) => !!ctx.festivalActive,
  });
  assert.equal(sp.current('mira', { minute: 600 }), null);
  const fest = sp.current('mira', { minute: 600, festivalActive: true });
  assert.equal(fest!.location, 'plaza');
});

test('sp: throwing condition treated as false', () => {
  const sp = SchedulePlan.create();
  sp.addBlock({
    id: 'a', characterId: 'mira',
    startMinute: 0, endMinute: 1000, location: 'home',
    condition: () => { throw new Error('boom'); },
  });
  assert.equal(sp.current('mira', { minute: 100 }), null);
});

test('sp: priority resolves overlap (higher wins)', () => {
  const sp = SchedulePlan.create();
  sp.addBlock({
    id: 'home', characterId: 'mira',
    startMinute: 0, endMinute: 1440, location: 'home', priority: 0,
  });
  sp.addBlock({
    id: 'work', characterId: 'mira',
    startMinute: 9 * 60, endMinute: 17 * 60, location: 'office', priority: 10,
  });
  // At 10am: both match; office (priority 10) wins.
  const at10 = sp.current('mira', { minute: 10 * 60 });
  assert.equal(at10!.location, 'office');
  // At 8am: only home matches.
  const at8 = sp.current('mira', { minute: 8 * 60 });
  assert.equal(at8!.location, 'home');
});

test('sp: same-priority overlap = later-added wins', () => {
  const sp = SchedulePlan.create();
  sp.addBlock({
    id: 'first', characterId: 'mira',
    startMinute: 0, endMinute: 1000, location: 'a',
  });
  sp.addBlock({
    id: 'second', characterId: 'mira',
    startMinute: 0, endMinute: 1000, location: 'b',
  });
  const r = sp.current('mira', { minute: 500 });
  assert.equal(r!.location, 'b');
});

test('sp: midnight-crossing block (start > end)', () => {
  const sp = SchedulePlan.create();
  sp.addBlock({
    id: 'sleep', characterId: 'mira',
    startMinute: 22 * 60, endMinute: 6 * 60, location: 'home',
  });
  // 11pm: in window.
  assert.ok(sp.current('mira', { minute: 23 * 60 }));
  // 3am: in window (wrapped).
  assert.ok(sp.current('mira', { minute: 3 * 60 }));
  // 10am: out.
  assert.equal(sp.current('mira', { minute: 10 * 60 }), null);
});

test('sp: allActive returns all matching blocks', () => {
  const sp = SchedulePlan.create();
  sp.addBlock({
    id: 'home', characterId: 'mira',
    startMinute: 0, endMinute: 1440, location: 'home',
  });
  sp.addBlock({
    id: 'work', characterId: 'mira',
    startMinute: 9 * 60, endMinute: 17 * 60, location: 'office',
  });
  const all = sp.allActive('mira', { minute: 10 * 60 });
  assert.equal(all.length, 2);
});

test('sp: blocksFor returns regular blocks for character', () => {
  const sp = SchedulePlan.create();
  sp.addBlock({
    id: 'a', characterId: 'mira',
    startMinute: 0, endMinute: 100, location: 'home',
  });
  sp.addBlock({
    id: 'b', characterId: 'thane',
    startMinute: 0, endMinute: 100, location: 'home',
  });
  const mira = sp.blocksFor('mira');
  assert.equal(mira.length, 1);
});

test('sp: allCurrent returns map of all characters with blocks', () => {
  const sp = SchedulePlan.create();
  sp.addBlock({
    id: 'a', characterId: 'mira',
    startMinute: 0, endMinute: 1000, location: 'home',
  });
  sp.addBlock({
    id: 'b', characterId: 'thane',
    startMinute: 0, endMinute: 1000, location: 'forest',
  });
  const all = sp.allCurrent({ minute: 500 });
  assert.equal(all['mira']!.location, 'home');
  assert.equal(all['thane']!.location, 'forest');
});

test('sp: clear empties + dispose locks', () => {
  const sp = SchedulePlan.create();
  sp.addBlock({
    id: 'a', characterId: 'mira',
    startMinute: 0, endMinute: 100, location: 'home',
  });
  sp.clear();
  assert.equal(sp.blockCount(), 0);
  sp.dispose();
  assert.equal(sp.addBlock({
    id: 'b', characterId: 'mira', startMinute: 0, endMinute: 100, location: 'home',
  }), false);
});

test('sp: realistic example - NPC daily routine + festival override', () => {
  const sp = SchedulePlan.create();
  // Mira's regular schedule: home at night, market mornings, temple afternoons.
  sp.addBlock({
    id: 'mira_sleep', characterId: 'mira',
    startMinute: 22 * 60, endMinute: 7 * 60, location: 'home',
    activity: 'sleep', priority: 0,
  });
  sp.addBlock({
    id: 'mira_market', characterId: 'mira',
    startMinute: 9 * 60, endMinute: 12 * 60, location: 'market',
    activity: 'shopping', priority: 0,
  });
  sp.addBlock({
    id: 'mira_temple', characterId: 'mira',
    startMinute: 14 * 60, endMinute: 17 * 60, location: 'temple',
    activity: 'pray', priority: 0,
  });
  // Festival override: priority 100, gated by festivalActive ctx.
  sp.addBlock({
    id: 'mira_festival', characterId: 'mira',
    startMinute: 0, endMinute: 1440, location: 'plaza',
    activity: 'festival', priority: 100,
    condition: (ctx) => !!ctx.festivalActive,
  });

  // Normal Wednesday at 10am: market.
  const normal = sp.current('mira', { minute: 10 * 60, festivalActive: false });
  assert.equal(normal!.location, 'market');
  // Festival day at 10am: plaza (override wins).
  const fest = sp.current('mira', { minute: 10 * 60, festivalActive: true });
  assert.equal(fest!.location, 'plaza');
  // 11pm any day: sleep.
  const night = sp.current('mira', { minute: 23 * 60 });
  assert.equal(night!.location, 'home');
});
