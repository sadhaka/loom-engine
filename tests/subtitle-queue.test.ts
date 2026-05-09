// Phase 1.4.2 - SubtitleQueue tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  SubtitleQueue,
  RESOURCE_SUBTITLE_QUEUE,
} from '../src/index.js';

test('sub: RESOURCE_SUBTITLE_QUEUE is the stable string', () => {
  assert.equal(RESOURCE_SUBTITLE_QUEUE, 'subtitle_queue');
});

test('sub: starts empty', () => {
  const s = SubtitleQueue.create();
  assert.equal(s.count(), 0);
});

test('sub: push adds line + isShowing', () => {
  const s = SubtitleQueue.create();
  s.push({ id: 'a', text: 'hello', durationMs: 1000 });
  assert.equal(s.isShowing('a'), true);
  assert.equal(s.count(), 1);
});

test('sub: push rejects empty id / non-string text', () => {
  const s = SubtitleQueue.create();
  assert.equal(s.push({ id: '', text: 'a', durationMs: 100 }), false);
  // @ts-expect-error
  assert.equal(s.push({ id: 'a', text: null, durationMs: 100 }), false);
});

test('sub: fadeIn alpha ramps 0 -> 1', () => {
  const s = SubtitleQueue.create();
  s.push({
    id: 'a', text: 'hi', durationMs: 1000,
    fadeInMs: 100, fadeOutMs: 100,
  });
  s.tick(50);
  const list = s.list();
  assert.equal(list[0]!.state, 'fadeIn');
  assert.ok(Math.abs(list[0]!.alpha - 0.5) < 0.01);
});

test('sub: visible state alpha=1 after fadeIn', () => {
  const s = SubtitleQueue.create();
  s.push({
    id: 'a', text: 'hi', durationMs: 1000,
    fadeInMs: 100, fadeOutMs: 100,
  });
  s.tick(150);
  assert.equal(s.list()[0]!.state, 'visible');
  assert.equal(s.list()[0]!.alpha, 1);
});

test('sub: fadeIn=0 starts visible', () => {
  const s = SubtitleQueue.create();
  s.push({ id: 'a', text: 'hi', durationMs: 1000, fadeInMs: 0 });
  assert.equal(s.list()[0]!.state, 'visible');
  assert.equal(s.list()[0]!.alpha, 1);
});

test('sub: visible -> fadeOut after duration expires', () => {
  const s = SubtitleQueue.create();
  s.push({
    id: 'a', text: 'hi', durationMs: 200,
    fadeInMs: 0, fadeOutMs: 200,
  });
  s.tick(100);
  assert.equal(s.list()[0]!.state, 'visible');
  s.tick(150); // duration done; into fadeOut
  assert.equal(s.list()[0]!.state, 'fadeOut');
});

test('sub: fadeOut decays then line removed', () => {
  const s = SubtitleQueue.create();
  s.push({
    id: 'a', text: 'hi', durationMs: 100,
    fadeInMs: 0, fadeOutMs: 100,
  });
  s.tick(100); // duration done
  s.tick(1);   // fadeOut starts
  assert.equal(s.list()[0]!.state, 'fadeOut');
  s.tick(150); // fadeOut complete
  assert.equal(s.count(), 0);
});

test('sub: durationMs=-1 sticky never auto-fades', () => {
  const s = SubtitleQueue.create();
  s.push({ id: 'a', text: 'sticky', durationMs: -1, fadeInMs: 0 });
  s.tick(60000);
  assert.equal(s.count(), 1);
  assert.equal(s.list()[0]!.state, 'visible');
});

test('sub: cancel triggers fadeOut', () => {
  const s = SubtitleQueue.create();
  s.push({ id: 'a', text: 'hi', durationMs: 5000, fadeInMs: 0 });
  s.cancel('a');
  assert.equal(s.list()[0]!.state, 'fadeOut');
});

test('sub: cancel unknown id returns false', () => {
  const s = SubtitleQueue.create();
  assert.equal(s.cancel('missing'), false);
});

test('sub: cancelAll removes all + fires onRemoved cleared', () => {
  const removed: string[] = [];
  const s = SubtitleQueue.create({
    onRemoved: (l, r) => removed.push(l.id + ':' + r),
  });
  s.push({ id: 'a', text: 'a', durationMs: 1000 });
  s.push({ id: 'b', text: 'b', durationMs: 1000 });
  s.cancelAll();
  assert.equal(s.count(), 0);
  assert.equal(removed.length, 2);
});

test('sub: visible() respects maxConcurrent + priority', () => {
  const s = SubtitleQueue.create({ maxConcurrent: 2 });
  s.push({ id: 'a', text: 'a', durationMs: 1000, priority: 0, fadeInMs: 0 });
  s.push({ id: 'b', text: 'b', durationMs: 1000, priority: 10, fadeInMs: 0 });
  s.push({ id: 'c', text: 'c', durationMs: 1000, priority: 5, fadeInMs: 0 });
  const v = s.visible();
  assert.equal(v.length, 2);
  // Top priority first.
  assert.equal(v[0]!.id, 'b');
  assert.equal(v[1]!.id, 'c');
});

test('sub: visible() with maxLines override', () => {
  const s = SubtitleQueue.create({ maxConcurrent: 5 });
  s.push({ id: 'a', text: 'a', durationMs: 1000, fadeInMs: 0 });
  s.push({ id: 'b', text: 'b', durationMs: 1000, fadeInMs: 0 });
  assert.equal(s.visible(1).length, 1);
});

test('sub: push with same id replaces existing line', () => {
  const s = SubtitleQueue.create();
  s.push({ id: 'a', text: 'first', durationMs: 1000 });
  s.push({ id: 'a', text: 'second', durationMs: 1000 });
  assert.equal(s.count(), 1);
  assert.equal(s.list()[0]!.text, 'second');
});

test('sub: onPush fires per push', () => {
  const seen: string[] = [];
  const s = SubtitleQueue.create({ onPush: (l) => seen.push(l.id) });
  s.push({ id: 'a', text: 'a', durationMs: 100 });
  s.push({ id: 'b', text: 'b', durationMs: 100 });
  assert.deepEqual(seen, ['a', 'b']);
});

test('sub: onRemoved fires expired with reason', () => {
  const events: Array<{ id: string; reason: string }> = [];
  const s = SubtitleQueue.create({
    onRemoved: (l, r) => events.push({ id: l.id, reason: r }),
  });
  s.push({
    id: 'a', text: 'a', durationMs: 50,
    fadeInMs: 0, fadeOutMs: 0,
  });
  s.tick(60); // duration done; fadeOutMs=0 immediately removes
  s.tick(1); // process removal
  assert.equal(events.length, 1);
  assert.equal(events[0]!.reason, 'expired');
});

test('sub: throwing onPush / onRemoved isolated', () => {
  const s = SubtitleQueue.create({
    onPush: () => { throw new Error('p-boom'); },
    onRemoved: () => { throw new Error('r-boom'); },
  });
  s.push({ id: 'a', text: 'a', durationMs: 50, fadeInMs: 0, fadeOutMs: 0 });
  s.tick(60);
  s.tick(1);
  assert.equal(s.count(), 0);
});

test('sub: NaN / negative dt no-op', () => {
  const s = SubtitleQueue.create();
  s.push({ id: 'a', text: 'a', durationMs: 1000, fadeInMs: 0 });
  s.tick(NaN);
  s.tick(-50);
  s.tick(Infinity);
  assert.equal(s.count(), 1);
  assert.equal(s.list()[0]!.ageMs, 0);
});

test('sub: forEach iterates visible (priority-sorted, capped)', () => {
  const s = SubtitleQueue.create({ maxConcurrent: 2 });
  s.push({ id: 'a', text: 'a', durationMs: 1000, priority: 0, fadeInMs: 0 });
  s.push({ id: 'b', text: 'b', durationMs: 1000, priority: 5, fadeInMs: 0 });
  s.push({ id: 'c', text: 'c', durationMs: 1000, priority: 10, fadeInMs: 0 });
  const seen: string[] = [];
  s.forEach((l) => seen.push(l.id));
  assert.deepEqual(seen, ['c', 'b']);
});

test('sub: dispose locks ops', () => {
  const s = SubtitleQueue.create();
  s.push({ id: 'a', text: 'a', durationMs: 100 });
  s.dispose();
  assert.equal(s.push({ id: 'b', text: 'b', durationMs: 100 }), false);
  assert.equal(s.count(), 0);
});

test('sub: realistic example - dialog + caption mix', () => {
  const s = SubtitleQueue.create({ maxConcurrent: 2 });
  s.push({
    id: 'mira_001', text: 'You came back. I was waiting.',
    speakerId: 'mira', durationMs: 3000, fadeInMs: 100,
  });
  s.push({
    id: 'sfx_caption_door',
    text: '[door creaks]',
    speakerId: 'sfx_caption',
    durationMs: 1000, priority: 5, fadeInMs: 0,
  });
  // Caption (priority 5) shows above dialog (priority 0).
  const v = s.visible();
  assert.equal(v[0]!.id, 'sfx_caption_door');
  assert.equal(v[1]!.id, 'mira_001');
});
