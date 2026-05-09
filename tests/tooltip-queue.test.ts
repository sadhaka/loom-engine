// Phase 0.97.0 - TooltipQueue tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  TooltipQueue,
  RESOURCE_TOOLTIP_QUEUE,
  type Tooltip,
} from '../src/index.js';

test('tooltip: RESOURCE_TOOLTIP_QUEUE is the stable string', () => {
  assert.equal(RESOURCE_TOOLTIP_QUEUE, 'tooltip_queue');
});

test('tooltip: starts empty', () => {
  const q = TooltipQueue.create();
  assert.equal(q.count(), 0);
  assert.equal(q.list().length, 0);
});

test('tooltip: show returns id and adds tooltip', () => {
  const q = TooltipQueue.create();
  const id = q.show('npc_1', 'Talk');
  assert.ok(id > 0);
  assert.equal(q.count(), 1);
  const list = q.list();
  assert.equal(list[0]!.anchorId, 'npc_1');
  assert.equal(list[0]!.content, 'Talk');
});

test('tooltip: show with empty / non-string anchor rejected', () => {
  const q = TooltipQueue.create();
  assert.equal(q.show('', 'msg'), 0);
  // @ts-expect-error - testing runtime guard
  assert.equal(q.show(null, 'msg'), 0);
  // @ts-expect-error - testing runtime guard
  assert.equal(q.show(123, 'msg'), 0);
  assert.equal(q.count(), 0);
});

test('tooltip: fade-in alpha ramps 0 -> 1 over fadeInMs', () => {
  const q = TooltipQueue.create({
    fadeInMs: 100,
    fadeOutMs: 100,
    defaultLifetimeMs: 1000,
  });
  q.show('a', 'hi');
  let list = q.list();
  assert.equal(list[0]!.state, 'fadeIn');
  assert.equal(list[0]!.alpha, 0);
  q.tick(50);
  list = q.list();
  assert.equal(list[0]!.state, 'fadeIn');
  assert.ok(Math.abs(list[0]!.alpha - 0.5) < 1e-6);
});

test('tooltip: transitions fadeIn -> visible after fadeInMs', () => {
  const q = TooltipQueue.create({
    fadeInMs: 100,
    fadeOutMs: 100,
    defaultLifetimeMs: 1000,
  });
  q.show('a', 'hi');
  q.tick(150);
  const list = q.list();
  assert.equal(list[0]!.state, 'visible');
  assert.equal(list[0]!.alpha, 1);
});

test('tooltip: fadeInMs=0 starts visible immediately', () => {
  const q = TooltipQueue.create({ fadeInMs: 0, defaultLifetimeMs: 1000 });
  q.show('a', 'hi');
  const list = q.list();
  assert.equal(list[0]!.state, 'visible');
  assert.equal(list[0]!.alpha, 1);
});

test('tooltip: visible -> fadeOut after lifetime expires', () => {
  const q = TooltipQueue.create({
    fadeInMs: 0,
    fadeOutMs: 100,
    defaultLifetimeMs: 200,
  });
  q.show('a', 'hi');
  q.tick(100);
  let list = q.list();
  assert.equal(list[0]!.state, 'visible');
  q.tick(150);
  list = q.list();
  assert.equal(list[0]!.state, 'fadeOut');
});

test('tooltip: fade-out alpha decays then tooltip removed', () => {
  const q = TooltipQueue.create({
    fadeInMs: 0,
    fadeOutMs: 100,
    defaultLifetimeMs: 100,
  });
  q.show('a', 'hi');
  q.tick(100); // visible -> fadeOut starts on next tick when remaining hits 0
  q.tick(1);   // remainingMs goes negative, fade-out begins
  let list = q.list();
  assert.equal(list[0]!.state, 'fadeOut');
  q.tick(50);
  list = q.list();
  assert.ok(list[0]!.alpha < 1 && list[0]!.alpha > 0);
  q.tick(60);
  assert.equal(q.count(), 0);
});

test('tooltip: lifetimeMs=-1 sticky never auto-fades', () => {
  const q = TooltipQueue.create({ fadeInMs: 0, fadeOutMs: 100 });
  q.show('a', 'persist', { lifetimeMs: -1 });
  q.tick(60000);
  assert.equal(q.count(), 1);
  assert.equal(q.list()[0]!.state, 'visible');
});

test('tooltip: replaceOnSameAnchor (default) fades out prior', () => {
  const q = TooltipQueue.create({
    fadeInMs: 0,
    fadeOutMs: 100,
    defaultLifetimeMs: 1000,
  });
  const id1 = q.show('npc', 'first');
  q.show('npc', 'second');
  // Both still alive; first now in fadeOut, second in visible.
  assert.equal(q.count(), 2);
  const list = q.list();
  const first = list.find((t) => t.id === id1);
  const second = list.find((t) => t.id !== id1);
  assert.equal(first!.state, 'fadeOut');
  assert.equal(second!.state, 'visible');
});

test('tooltip: replaceOnSameAnchor=false stacks', () => {
  const q = TooltipQueue.create({
    fadeInMs: 0,
    defaultLifetimeMs: 1000,
    replaceOnSameAnchor: false,
  });
  q.show('npc', 'a');
  q.show('npc', 'b');
  q.show('npc', 'c');
  assert.equal(q.count(), 3);
  const states = q.list().map((t) => t.state);
  for (const s of states) assert.equal(s, 'visible');
});

test('tooltip: hide(anchorId) triggers fade-out for all matches', () => {
  const q = TooltipQueue.create({
    fadeInMs: 0,
    defaultLifetimeMs: 1000,
    replaceOnSameAnchor: false,
  });
  q.show('npc', 'a');
  q.show('npc', 'b');
  q.show('other', 'c');
  const n = q.hide('npc');
  assert.equal(n, 2);
  const list = q.list();
  const npcStates = list.filter((t) => t.anchorId === 'npc').map((t) => t.state);
  for (const s of npcStates) assert.equal(s, 'fadeOut');
  const other = list.find((t) => t.anchorId === 'other');
  assert.equal(other!.state, 'visible');
});

test('tooltip: hide already-fading anchor returns 0 (no double-trigger)', () => {
  const q = TooltipQueue.create({ fadeInMs: 0, defaultLifetimeMs: 1000 });
  q.show('npc', 'a');
  assert.equal(q.hide('npc'), 1);
  assert.equal(q.hide('npc'), 0);
});

test('tooltip: hideById triggers fade-out for one tooltip', () => {
  const q = TooltipQueue.create({
    fadeInMs: 0,
    defaultLifetimeMs: 1000,
    replaceOnSameAnchor: false,
  });
  const idA = q.show('npc', 'a');
  q.show('npc', 'b');
  assert.equal(q.hideById(idA), true);
  const list = q.list();
  const a = list.find((t) => t.id === idA);
  const b = list.find((t) => t.id !== idA);
  assert.equal(a!.state, 'fadeOut');
  assert.equal(b!.state, 'visible');
});

test('tooltip: hideById unknown id returns false', () => {
  const q = TooltipQueue.create();
  assert.equal(q.hideById(999), false);
});

test('tooltip: capacity caps queue + onRemoved fires with evicted', () => {
  const events: Array<{ id: number; reason: string }> = [];
  const q = TooltipQueue.create({
    capacity: 2,
    fadeInMs: 0,
    defaultLifetimeMs: 1000,
    replaceOnSameAnchor: false,
    onRemoved: (t, r) => events.push({ id: t.id, reason: r }),
  });
  const idA = q.show('a', '1');
  q.show('b', '2');
  q.show('c', '3');
  assert.equal(q.count(), 2);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.id, idA);
  assert.equal(events[0]!.reason, 'evicted');
});

test('tooltip: eviction prefers an already-fading tooltip', () => {
  const q = TooltipQueue.create({
    capacity: 3,
    fadeInMs: 0,
    fadeOutMs: 1000,
    defaultLifetimeMs: 1000,
    replaceOnSameAnchor: false,
  });
  const idA = q.show('a', '1');
  q.show('b', '2');
  q.show('c', '3');
  q.hide('a'); // mark idA as fading
  q.show('d', '4'); // capacity hit; idA (fading) should evict first
  const ids = q.list().map((t) => t.id);
  assert.equal(ids.indexOf(idA), -1);
});

test('tooltip: clear removes all + onRemoved fires with hidden', () => {
  const removed: Tooltip[] = [];
  const q = TooltipQueue.create({
    fadeInMs: 0,
    defaultLifetimeMs: 1000,
    replaceOnSameAnchor: false,
    onRemoved: (t) => removed.push(t),
  });
  q.show('a', '1');
  q.show('b', '2');
  q.clear();
  assert.equal(q.count(), 0);
  assert.equal(removed.length, 2);
});

test('tooltip: byAnchor returns only matching tooltips', () => {
  const q = TooltipQueue.create({
    fadeInMs: 0,
    defaultLifetimeMs: 1000,
    replaceOnSameAnchor: false,
  });
  q.show('npc', 'a');
  q.show('npc', 'b');
  q.show('other', 'c');
  const npcTips = q.byAnchor('npc');
  assert.equal(npcTips.length, 2);
  assert.deepEqual(npcTips.map((t) => t.content).sort(), ['a', 'b']);
  assert.equal(q.byAnchor('missing').length, 0);
});

test('tooltip: data payload preserved + list defensive', () => {
  const q = TooltipQueue.create({ fadeInMs: 0, defaultLifetimeMs: 1000 });
  q.show('a', 'hi', { data: { kind: 'hint', step: 3 } });
  const list = q.list();
  assert.deepEqual(list[0]!.data, { kind: 'hint', step: 3 });
  list[0]!.content = 'mutated';
  const list2 = q.list();
  assert.equal(list2[0]!.content, 'hi');
});

test('tooltip: throwing onShow / onRemoved isolated', () => {
  const q = TooltipQueue.create({
    fadeInMs: 0,
    defaultLifetimeMs: 50,
    fadeOutMs: 0,
    onShow: () => { throw new Error('show-boom'); },
    onRemoved: () => { throw new Error('rm-boom'); },
  });
  q.show('a', 'msg'); // should not throw
  q.tick(60); // expires; onRemoved throws but is isolated
  q.tick(1);
  assert.equal(q.count(), 0);
});

test('tooltip: NaN / negative dt ignored', () => {
  const q = TooltipQueue.create({
    fadeInMs: 0,
    fadeOutMs: 100,
    defaultLifetimeMs: 100,
  });
  q.show('a', 'hi');
  q.tick(NaN);
  q.tick(-50);
  q.tick(Infinity);
  assert.equal(q.count(), 1);
  assert.equal(q.list()[0]!.state, 'visible');
});

test('tooltip: dispose locks ops', () => {
  const q = TooltipQueue.create({ fadeInMs: 0, defaultLifetimeMs: 1000 });
  q.show('a', 'hi');
  q.dispose();
  assert.equal(q.show('b', 'hi'), 0);
  assert.equal(q.hide('a'), 0);
  assert.equal(q.hideById(1), false);
  assert.equal(q.count(), 0);
});

test('tooltip: forEach iterates in post order', () => {
  const q = TooltipQueue.create({
    fadeInMs: 0,
    defaultLifetimeMs: 1000,
    replaceOnSameAnchor: false,
  });
  q.show('a', '1');
  q.show('b', '2');
  q.show('c', '3');
  const seen: string[] = [];
  q.forEach((t) => seen.push(t.content));
  assert.deepEqual(seen, ['1', '2', '3']);
});
