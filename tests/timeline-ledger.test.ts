// Phase 1.5.1 - TimelineLedger tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  TimelineLedger,
  RESOURCE_TIMELINE_LEDGER,
} from '../src/index.js';

test('tl: RESOURCE_TIMELINE_LEDGER is the stable string', () => {
  assert.equal(RESOURCE_TIMELINE_LEDGER, 'timeline_ledger');
});

test('tl: starts empty', () => {
  const t = TimelineLedger.create({ width: 800 });
  assert.equal(t.count(), 0);
});

test('tl: add + has + get', () => {
  const t = TimelineLedger.create({ width: 800 });
  t.add({ id: 'a', atTime: 100, kind: 'level', label: 'L1' });
  assert.equal(t.has('a'), true);
  const e = t.get('a');
  assert.equal(e!.atTime, 100);
  assert.equal(e!.label, 'L1');
});

test('tl: add rejects empty / invalid args', () => {
  const t = TimelineLedger.create({ width: 800 });
  assert.equal(t.add({ id: '', atTime: 0, kind: 'a' }), false);
  assert.equal(t.add({ id: 'a', atTime: 0, kind: '' }), false);
  assert.equal(t.add({ id: 'a', atTime: NaN, kind: 'a' }), false);
});

test('tl: remove drops it', () => {
  const t = TimelineLedger.create({ width: 800 });
  t.add({ id: 'a', atTime: 100, kind: 'level' });
  assert.equal(t.remove('a'), true);
  assert.equal(t.has('a'), false);
});

test('tl: list returns events sorted by atTime', () => {
  const t = TimelineLedger.create({ width: 800 });
  t.add({ id: 'c', atTime: 300, kind: 'k' });
  t.add({ id: 'a', atTime: 100, kind: 'k' });
  t.add({ id: 'b', atTime: 200, kind: 'k' });
  const ids = t.list().map((e) => e.id);
  assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('tl: byRange filters', () => {
  const t = TimelineLedger.create({ width: 800 });
  t.add({ id: 'a', atTime: 50, kind: 'k' });
  t.add({ id: 'b', atTime: 150, kind: 'k' });
  t.add({ id: 'c', atTime: 250, kind: 'k' });
  const ids = t.byRange(100, 200).map((e) => e.id);
  assert.deepEqual(ids, ['b']);
});

test('tl: byRange with swapped args', () => {
  const t = TimelineLedger.create({ width: 800 });
  t.add({ id: 'a', atTime: 100, kind: 'k' });
  assert.equal(t.byRange(200, 50).length, 1);
});

test('tl: byKind filters', () => {
  const t = TimelineLedger.create({ width: 800 });
  t.add({ id: 'a', atTime: 100, kind: 'level' });
  t.add({ id: 'b', atTime: 200, kind: 'boss' });
  t.add({ id: 'c', atTime: 300, kind: 'level' });
  const levels = t.byKind('level').map((e) => e.id);
  assert.deepEqual(levels.sort(), ['a', 'c']);
});

test('tl: byTag filters', () => {
  const t = TimelineLedger.create({ width: 800 });
  t.add({ id: 'a', atTime: 100, kind: 'k', tags: ['important', 'boss'] });
  t.add({ id: 'b', atTime: 200, kind: 'k', tags: ['minor'] });
  t.add({ id: 'c', atTime: 300, kind: 'k' });
  const important = t.byTag('important');
  assert.equal(important.length, 1);
  assert.equal(important[0]!.id, 'a');
});

test('tl: setWindow + getWindow', () => {
  const t = TimelineLedger.create({ width: 800 });
  t.setWindow(100, 500);
  const w = t.getWindow();
  assert.equal(w.startTime, 100);
  assert.equal(w.endTime, 500);
});

test('tl: setWindow rejects equal or non-finite args', () => {
  const t = TimelineLedger.create({ width: 800 });
  assert.equal(t.setWindow(100, 100), false);
  assert.equal(t.setWindow(NaN, 100), false);
});

test('tl: setWindow swaps inverted args', () => {
  const t = TimelineLedger.create({ width: 800 });
  t.setWindow(500, 100);
  const w = t.getWindow();
  assert.equal(w.startTime, 100);
  assert.equal(w.endTime, 500);
});

test('tl: auto-window from data', () => {
  const t = TimelineLedger.create({ width: 800 });
  t.add({ id: 'a', atTime: 100, kind: 'k' });
  t.add({ id: 'b', atTime: 500, kind: 'k' });
  const w = t.getWindow();
  assert.equal(w.startTime, 100);
  assert.equal(w.endTime, 500);
});

test('tl: setWindow disables auto-window', () => {
  const t = TimelineLedger.create({ width: 800 });
  t.setWindow(0, 1000);
  t.add({ id: 'a', atTime: 5000, kind: 'k' });
  // Window stays at 0..1000.
  const w = t.getWindow();
  assert.equal(w.endTime, 1000);
});

test('tl: resetWindow re-enables auto', () => {
  const t = TimelineLedger.create({ width: 800 });
  t.setWindow(0, 1000);
  t.add({ id: 'a', atTime: 100, kind: 'k' });
  t.add({ id: 'b', atTime: 500, kind: 'k' });
  t.resetWindow();
  const w = t.getWindow();
  assert.equal(w.startTime, 100);
  assert.equal(w.endTime, 500);
});

test('tl: snapshot maps events to px', () => {
  const t = TimelineLedger.create({ width: 1000, paddingLeft: 0, paddingRight: 0 });
  t.add({ id: 'a', atTime: 0, kind: 'k' });
  t.add({ id: 'b', atTime: 100, kind: 'k' });
  t.setWindow(0, 100);
  const snap = t.getSnapshot();
  assert.equal(snap.events[0]!.px, 0);
  assert.equal(snap.events[1]!.px, 1000);
});

test('tl: snapshot inWindow flag', () => {
  const t = TimelineLedger.create({ width: 800 });
  t.add({ id: 'a', atTime: 50, kind: 'k' });
  t.add({ id: 'b', atTime: 150, kind: 'k' });
  t.setWindow(100, 200);
  const snap = t.getSnapshot();
  const a = snap.events.find((e) => e.id === 'a')!;
  const b = snap.events.find((e) => e.id === 'b')!;
  assert.equal(a.inWindow, false);
  assert.equal(b.inWindow, true);
});

test('tl: snapshot windowPct clamped to [0, 1]', () => {
  const t = TimelineLedger.create({ width: 800 });
  t.add({ id: 'pre', atTime: 50, kind: 'k' });
  t.add({ id: 'post', atTime: 250, kind: 'k' });
  t.setWindow(100, 200);
  const snap = t.getSnapshot();
  const pre = snap.events.find((e) => e.id === 'pre')!;
  const post = snap.events.find((e) => e.id === 'post')!;
  assert.equal(pre.windowPct, 0);
  assert.equal(post.windowPct, 1);
});

test('tl: padding offsets pixel x', () => {
  const t = TimelineLedger.create({
    width: 800, paddingLeft: 50, paddingRight: 50,
  });
  t.add({ id: 'a', atTime: 0, kind: 'k' });
  t.add({ id: 'b', atTime: 100, kind: 'k' });
  t.setWindow(0, 100);
  const snap = t.getSnapshot();
  // First event at start: px = 50.
  assert.equal(snap.events[0]!.px, 50);
  // Last event at end: px = 800 - 50 = 750.
  assert.equal(snap.events[1]!.px, 750);
});

test('tl: totalRange spans all events', () => {
  const t = TimelineLedger.create({ width: 800 });
  t.add({ id: 'a', atTime: 100, kind: 'k' });
  t.add({ id: 'b', atTime: 500, kind: 'k' });
  t.add({ id: 'c', atTime: 300, kind: 'k' });
  const r = t.totalRange();
  assert.equal(r.startTime, 100);
  assert.equal(r.endTime, 500);
});

test('tl: setSize updates width + padding', () => {
  const t = TimelineLedger.create({ width: 800 });
  t.setSize(1200, 100, 100);
  const snap = t.getSnapshot();
  assert.equal(snap.width, 1200);
  assert.equal(snap.paddingLeft, 100);
  assert.equal(snap.paddingRight, 100);
});

test('tl: throwing forEach callback isolated', () => {
  const t = TimelineLedger.create({ width: 800 });
  t.add({ id: 'a', atTime: 100, kind: 'k' });
  t.forEach(() => { throw new Error('boom'); });
  assert.equal(t.count(), 1);
});

test('tl: clear empties + dispose locks', () => {
  const t = TimelineLedger.create({ width: 800 });
  t.add({ id: 'a', atTime: 100, kind: 'k' });
  t.clear();
  assert.equal(t.count(), 0);
  t.dispose();
  assert.equal(t.add({ id: 'b', atTime: 100, kind: 'k' }), false);
});

test('tl: realistic example - run history with milestones', () => {
  const t = TimelineLedger.create({ width: 1200, paddingLeft: 40, paddingRight: 40 });
  t.add({ id: 'start',     atTime: 0,    kind: 'level',    label: 'Run start' });
  t.add({ id: 'first_kill', atTime: 45,  kind: 'kill',     label: 'First kill', tags: ['notable'] });
  t.add({ id: 'level_2',   atTime: 90,   kind: 'level',    label: 'Level 2 unlocked' });
  t.add({ id: 'boss_1',    atTime: 300,  kind: 'boss',     label: 'Boss 1 spawned', tags: ['notable', 'boss'] });
  t.add({ id: 'death',     atTime: 320,  kind: 'death',    label: 'Player died' });
  t.add({ id: 'end',       atTime: 320,  kind: 'level',    label: 'Run ended' });
  // Notable events.
  const notable = t.byTag('notable');
  assert.equal(notable.length, 2);
  assert.deepEqual(notable.map((e) => e.id), ['first_kill', 'boss_1']);
  // Window onto last 100 seconds.
  t.setWindow(220, 320);
  const snap = t.getSnapshot();
  // start, first_kill, level_2 are out of window.
  const inWin = snap.events.filter((e) => e.inWindow).map((e) => e.id);
  assert.deepEqual(inWin.sort(), ['boss_1', 'death', 'end']);
});
