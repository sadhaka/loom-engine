// Phase 0.94.0 - AudioCueQueue tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  AudioCueQueue,
  RESOURCE_AUDIO_CUE_QUEUE,
} from '../src/index.js';

test('audio-cue-queue: RESOURCE constant', () => {
  assert.equal(RESOURCE_AUDIO_CUE_QUEUE, 'audio_cue_queue');
});

test('audio-cue-queue: defaults', () => {
  const q = AudioCueQueue.create();
  assert.equal(q.size(), 0);
  assert.equal(q.capacity(), 32);
  assert.equal(q.next(), null);
  assert.equal(q.peek(), null);
});

test('audio-cue-queue: enqueue + next FIFO at same priority', () => {
  const q = AudioCueQueue.create();
  q.enqueue({ id: 'a' });
  q.enqueue({ id: 'b' });
  q.enqueue({ id: 'c' });
  assert.equal(q.next()!.id, 'a');
  assert.equal(q.next()!.id, 'b');
  assert.equal(q.next()!.id, 'c');
  assert.equal(q.next(), null);
});

test('audio-cue-queue: higher priority pulled first', () => {
  const q = AudioCueQueue.create();
  q.enqueue({ id: 'low', priority: 1 });
  q.enqueue({ id: 'high', priority: 10 });
  q.enqueue({ id: 'mid', priority: 5 });
  assert.equal(q.next()!.id, 'high');
  assert.equal(q.next()!.id, 'mid');
  assert.equal(q.next()!.id, 'low');
});

test('audio-cue-queue: enqueue invalid rejected', () => {
  const q = AudioCueQueue.create();
  assert.equal(q.enqueue({ id: '' }), false);
  assert.equal(q.size(), 0);
});

test('audio-cue-queue: peek does NOT consume', () => {
  const q = AudioCueQueue.create();
  q.enqueue({ id: 'a' });
  assert.equal(q.peek()!.id, 'a');
  assert.equal(q.size(), 1);
});

test('audio-cue-queue: peek returns highest priority', () => {
  const q = AudioCueQueue.create();
  q.enqueue({ id: 'low', priority: 1 });
  q.enqueue({ id: 'high', priority: 10 });
  assert.equal(q.peek()!.id, 'high');
  assert.equal(q.size(), 2);
});

test('audio-cue-queue: capacity full drops lowest priority', () => {
  const q = AudioCueQueue.create({ capacity: 3 });
  q.enqueue({ id: 'low_1', priority: 1 });
  q.enqueue({ id: 'mid', priority: 5 });
  q.enqueue({ id: 'low_2', priority: 1 });
  // 4th enqueue: dropping lowest (low_1, oldest at priority 1).
  q.enqueue({ id: 'high', priority: 10 });
  assert.equal(q.size(), 3);
  // Drain - should be high, mid, low_2 (low_1 dropped).
  assert.equal(q.next()!.id, 'high');
  assert.equal(q.next()!.id, 'mid');
  assert.equal(q.next()!.id, 'low_2');
});

test('audio-cue-queue: capacity 1 keeps highest', () => {
  const q = AudioCueQueue.create({ capacity: 1 });
  q.enqueue({ id: 'a', priority: 1 });
  q.enqueue({ id: 'b', priority: 10 });
  assert.equal(q.next()!.id, 'b');
});

test('audio-cue-queue: removeById drops all matching', () => {
  const q = AudioCueQueue.create();
  q.enqueue({ id: 'hit', priority: 1 });
  q.enqueue({ id: 'miss', priority: 1 });
  q.enqueue({ id: 'hit', priority: 5 });
  const dropped = q.removeById('hit');
  assert.equal(dropped, 2);
  assert.equal(q.size(), 1);
  assert.equal(q.next()!.id, 'miss');
});

test('audio-cue-queue: removeById empty id rejected', () => {
  const q = AudioCueQueue.create();
  q.enqueue({ id: 'x' });
  assert.equal(q.removeById(''), 0);
  assert.equal(q.size(), 1);
});

test('audio-cue-queue: clear empties', () => {
  const q = AudioCueQueue.create();
  q.enqueue({ id: 'a' });
  q.enqueue({ id: 'b' });
  q.clear();
  assert.equal(q.size(), 0);
});

test('audio-cue-queue: list defensive snapshot', () => {
  const q = AudioCueQueue.create();
  q.enqueue({ id: 'a' });
  q.enqueue({ id: 'b' });
  const arr = q.list();
  assert.equal(arr.length, 2);
  arr.length = 0;
  assert.equal(q.size(), 2);
});

test('audio-cue-queue: data passthrough preserved', () => {
  const q = AudioCueQueue.create();
  q.enqueue({ id: 'hit', data: { volume: 0.8, pan: 0.2 } });
  const cue = q.next();
  assert.deepEqual(cue!.data, { volume: 0.8, pan: 0.2 });
});

test('audio-cue-queue: NaN priority defaults to 0', () => {
  const q = AudioCueQueue.create();
  q.enqueue({ id: 'a', priority: NaN });
  q.enqueue({ id: 'b', priority: 1 });
  // 'b' priority 1 > 'a' priority 0.
  assert.equal(q.next()!.id, 'b');
  assert.equal(q.next()!.id, 'a');
});

test('audio-cue-queue: dispose locks ops', () => {
  const q = AudioCueQueue.create();
  q.enqueue({ id: 'a' });
  q.dispose();
  assert.equal(q.enqueue({ id: 'b' }), false);
  assert.equal(q.next(), null);
  assert.equal(q.peek(), null);
  assert.equal(q.size(), 0);
});

test('audio-cue-queue: realistic combat burst', () => {
  const q = AudioCueQueue.create({ capacity: 8 });
  // 5 hits in rapid succession.
  for (let i = 0; i < 5; i++) {
    q.enqueue({ id: 'hit_normal', priority: 1 });
  }
  // One crit lands.
  q.enqueue({ id: 'hit_crit', priority: 10 });
  // One UI bleep with priority 0.
  q.enqueue({ id: 'ui_blip', priority: 0 });
  // Drain 3 voices: crit + 2 normal hits.
  assert.equal(q.next()!.id, 'hit_crit');
  assert.equal(q.next()!.id, 'hit_normal');
  assert.equal(q.next()!.id, 'hit_normal');
  // 3 normal + 1 ui_blip remain.
  assert.equal(q.size(), 4);
});

test('audio-cue-queue: capacity overflow keeps highest priority subset', () => {
  const q = AudioCueQueue.create({ capacity: 3 });
  // Fill with 6 cues at priority 1.
  for (let i = 0; i < 6; i++) {
    q.enqueue({ id: 'p1_' + i, priority: 1 });
  }
  // Now enqueue a high-priority cue.
  q.enqueue({ id: 'high', priority: 10 });
  assert.equal(q.size(), 3);
  // Pull: high comes first.
  assert.equal(q.next()!.id, 'high');
});
