// Phase 0.65.0 - ToastQueue tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  ToastQueue,
  RESOURCE_TOAST_QUEUE,
  type Toast,
} from '../src/index.js';

test('toast: RESOURCE_TOAST_QUEUE is the stable string', () => {
  assert.equal(RESOURCE_TOAST_QUEUE, 'toast_queue');
});

test('toast: starts empty', () => {
  const q = ToastQueue.create();
  assert.equal(q.count(), 0);
});

test('toast: post returns id and adds toast', () => {
  const q = ToastQueue.create();
  const id = q.post('info', 'Hello');
  assert.ok(id > 0);
  assert.equal(q.count(), 1);
});

test('toast: severity helpers', () => {
  const q = ToastQueue.create();
  q.info('a');
  q.success('b');
  q.warn('c');
  q.error('d');
  q.critical('e');
  assert.equal(q.count(), 5);
});

test('toast: tick decrements remaining and expires', () => {
  const q = ToastQueue.create({
    defaultLifetimeMs: { info: 100 },
  });
  q.info('a');
  q.tick(50);
  assert.equal(q.count(), 1);
  q.tick(60);
  assert.equal(q.count(), 0);
});

test('toast: critical default = sticky (no expire)', () => {
  const q = ToastQueue.create();
  q.critical('disconnected');
  q.tick(60000); // 60 seconds
  assert.equal(q.count(), 1);
});

test('toast: explicit lifetimeMs overrides default', () => {
  const q = ToastQueue.create();
  q.info('a', { lifetimeMs: 50 });
  q.tick(60);
  assert.equal(q.count(), 0);
});

test('toast: lifetimeMs < 0 makes a toast sticky', () => {
  const q = ToastQueue.create();
  q.warn('persist', { lifetimeMs: -1 });
  q.tick(60000);
  assert.equal(q.count(), 1);
});

test('toast: dismiss removes by id', () => {
  const q = ToastQueue.create();
  const id = q.info('a');
  assert.equal(q.dismiss(id), true);
  assert.equal(q.count(), 0);
});

test('toast: dismiss with unknown id returns false', () => {
  const q = ToastQueue.create();
  assert.equal(q.dismiss(999), false);
});

test('toast: clear removes all + fires onRemoved', () => {
  const removed: Toast[] = [];
  const q = ToastQueue.create({ onRemoved: (t) => removed.push(t) });
  q.info('a');
  q.warn('b');
  q.clear();
  assert.equal(q.count(), 0);
  assert.equal(removed.length, 2);
});

test('toast: capacity caps the queue (oldest lowest-severity evicts)', () => {
  const q = ToastQueue.create({ capacity: 3 });
  q.info('a');
  q.info('b');
  q.warn('c');
  q.info('d'); // evicts a (lowest-severity oldest)
  // Capacity is 3; we should still have 3 toasts.
  assert.equal(q.count(), 3);
  const list = q.list();
  const messages = list.map((t) => t.message);
  assert.equal(messages.indexOf('a'), -1);
  // b, c, d should still be present.
});

test('toast: evicted onRemoved fires with eviction reason', () => {
  const events: Array<{ msg: string; reason: string }> = [];
  const q = ToastQueue.create({
    capacity: 2,
    onRemoved: (t, r) => events.push({ msg: t.message, reason: r }),
  });
  q.info('a');
  q.info('b');
  q.info('c'); // evicts a
  assert.equal(events.length, 1);
  assert.equal(events[0]!.reason, 'evicted');
});

test('toast: evicted prefers lower severity to drop', () => {
  const q = ToastQueue.create({ capacity: 3 });
  q.info('low1');
  q.error('high');
  q.info('low2');
  q.warn('mid'); // capacity hit; low1 drops (lowest-severity oldest)
  const list = q.list();
  const messages = list.map((t) => t.message);
  assert.equal(messages.indexOf('low1'), -1);
  assert.ok(messages.indexOf('high') >= 0);
});

test('toast: onPost fires for every accepted toast', () => {
  const seen: string[] = [];
  const q = ToastQueue.create({ onPost: (t) => seen.push(t.message) });
  q.info('a');
  q.warn('b');
  assert.deepEqual(seen, ['a', 'b']);
});

test('toast: throwing onPost / onRemoved isolated', () => {
  const q = ToastQueue.create({
    onPost: () => { throw new Error('post-boom'); },
    onRemoved: () => { throw new Error('rm-boom'); },
  });
  q.info('a');
  q.dismiss(1);
  // Should not throw.
  assert.equal(q.count(), 0);
});

test('toast: forEach iterates in post order', () => {
  const q = ToastQueue.create();
  q.info('a');
  q.warn('b');
  q.error('c');
  const seen: string[] = [];
  q.forEach((t) => seen.push(t.message));
  assert.deepEqual(seen, ['a', 'b', 'c']);
});

test('toast: list returns defensive copies', () => {
  const q = ToastQueue.create();
  q.info('a', { data: { id: 42 } });
  const list = q.list();
  list[0]!.message = 'mutated';
  const list2 = q.list();
  assert.equal(list2[0]!.message, 'a');
});

test('toast: data payload preserved', () => {
  const q = ToastQueue.create();
  q.warn('boss', { data: { id: 7, hp: 1000 } });
  const list = q.list();
  assert.deepEqual(list[0]!.data, { id: 7, hp: 1000 });
});

test('toast: ageMs accumulates', () => {
  const q = ToastQueue.create({ defaultLifetimeMs: { info: 1000 } });
  q.info('a');
  q.tick(100);
  q.tick(200);
  const list = q.list();
  assert.equal(list[0]!.ageMs, 300);
});

test('toast: invalid severity rejected', () => {
  const q = ToastQueue.create();
  // @ts-expect-error - testing runtime guard
  const id = q.post('xyz', 'msg');
  assert.equal(id, 0);
  assert.equal(q.count(), 0);
});

test('toast: NaN / negative dt ignored', () => {
  const q = ToastQueue.create({ defaultLifetimeMs: { info: 100 } });
  q.info('a');
  q.tick(NaN);
  q.tick(-5);
  assert.equal(q.count(), 1);
});

test('toast: dispose locks ops', () => {
  const q = ToastQueue.create();
  q.info('a');
  q.dispose();
  const id = q.info('b');
  assert.equal(id, 0);
  assert.equal(q.count(), 0);
});

test('toast: realistic example - mixed severity flow', () => {
  const q = ToastQueue.create({ capacity: 5 });
  q.info('+50 gold');
  q.success('quest accepted');
  q.warn('low health');
  q.error('connection lost');
  q.critical('boss spawned');
  assert.equal(q.count(), 5);
  q.tick(3500); // info + success expire (default 3000ms)
  // warn (5000), error (8000), critical (sticky) survive.
  const list = q.list();
  const sevs = list.map((t) => t.severity).sort();
  assert.deepEqual(sevs, ['critical', 'error', 'warn']);
});
