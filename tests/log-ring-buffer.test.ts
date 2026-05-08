// Phase 0.50.0 - LogRingBuffer tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  LogRingBuffer,
  RESOURCE_LOG_RING_BUFFER,
  type LogEntry,
} from '../src/index.js';

test('log-ring: RESOURCE_LOG_RING_BUFFER is the stable string', () => {
  assert.equal(RESOURCE_LOG_RING_BUFFER, 'log_ring_buffer');
});

test('log-ring: starts empty', () => {
  const ring = LogRingBuffer.create();
  assert.equal(ring.count(), 0);
  assert.deepEqual(ring.all(), []);
});

test('log-ring: defaults to capacity 1024 + minLevel debug', () => {
  const ring = LogRingBuffer.create();
  assert.equal(ring.capacity(), 1024);
  assert.equal(ring.getMinLevel(), 'debug');
});

test('log-ring: log + count + retrieve', () => {
  const ring = LogRingBuffer.create();
  ring.info('hello');
  ring.warn('look out');
  assert.equal(ring.count(), 2);
  const entries = ring.all();
  assert.equal(entries.length, 2);
  // Newest first.
  assert.equal(entries[0]!.message, 'look out');
  assert.equal(entries[1]!.message, 'hello');
});

test('log-ring: severity helpers map to correct level', () => {
  const ring = LogRingBuffer.create();
  ring.debug('d');
  ring.info('i');
  ring.warn('w');
  ring.error('e');
  ring.fatal('f');
  const all = ring.all();
  // Newest first.
  assert.deepEqual(all.map((e) => e.level), ['fatal', 'error', 'warn', 'info', 'debug']);
});

test('log-ring: monotonic ids', () => {
  const ring = LogRingBuffer.create();
  const id1 = ring.info('a');
  const id2 = ring.info('b');
  const id3 = ring.info('c');
  assert.ok(id2 > id1);
  assert.ok(id3 > id2);
});

test('log-ring: minLevel filter drops entries below threshold', () => {
  const ring = LogRingBuffer.create({ minLevel: 'warn' });
  ring.debug('d'); // dropped
  ring.info('i');  // dropped
  ring.warn('w');  // kept
  ring.error('e'); // kept
  assert.equal(ring.count(), 2);
});

test('log-ring: setMinLevel adjusts at runtime', () => {
  const ring = LogRingBuffer.create();
  ring.info('i1');
  assert.equal(ring.count(), 1);
  ring.setMinLevel('error');
  ring.info('i2');  // dropped
  ring.error('e1'); // kept
  assert.equal(ring.count(), 2);  // i1 + e1
});

test('log-ring: ring evicts oldest when full', () => {
  const ring = LogRingBuffer.create({ capacity: 3 });
  ring.info('a');
  ring.info('b');
  ring.info('c');
  ring.info('d');
  assert.equal(ring.count(), 3);
  const all = ring.all();
  // Newest first; 'a' evicted.
  assert.deepEqual(all.map((e) => e.message), ['d', 'c', 'b']);
  assert.equal(ring.droppedSinceStart(), 1);
});

test('log-ring: tail(n) returns last n entries newest-first', () => {
  const ring = LogRingBuffer.create();
  for (var i = 1; i <= 10; i++) ring.info('msg-' + i);
  const tail3 = ring.tail(3);
  assert.deepEqual(tail3.map((e) => e.message), ['msg-10', 'msg-9', 'msg-8']);
});

test('log-ring: tail(0) defaults to all retained entries', () => {
  const ring = LogRingBuffer.create();
  ring.info('a');
  ring.info('b');
  // tail(0) treats 0 as "no specific cap, give me all".
  const out = ring.tail(0);
  assert.equal(out.length, 2);
});

test('log-ring: tail(n) with n > size returns all', () => {
  const ring = LogRingBuffer.create();
  ring.info('a');
  ring.info('b');
  const out = ring.tail(100);
  assert.equal(out.length, 2);
});

test('log-ring: filter by minLevel', () => {
  const ring = LogRingBuffer.create();
  ring.debug('d');
  ring.info('i');
  ring.warn('w');
  ring.error('e');
  const errs = ring.filter({ minLevel: 'error' });
  assert.equal(errs.length, 1);
  assert.equal(errs[0]!.level, 'error');
});

test('log-ring: filter by since', () => {
  const ring = LogRingBuffer.create({ now: () => 1000 });
  ring.info('first');
  // Different time for second entry: rebuild buffer with time-progressing now.
  const ring2 = LogRingBuffer.create({ now: () => {
    return Date.now();
  } });
  ring2.info('a');
  // No assertion on absolute time; just verify filter applies.
  const out = ring2.filter({ since: 0 });
  assert.equal(out.length, 1);
  // since in the future filters everything out.
  const empty = ring2.filter({ since: Date.now() + 999999 });
  assert.equal(empty.length, 0);
});

test('log-ring: filter by channel string', () => {
  const ring = LogRingBuffer.create();
  ring.info('combat msg', { channel: 'combat' });
  ring.info('net msg', { channel: 'net' });
  ring.info('no-channel msg');
  const combat = ring.filter({ channel: 'combat' });
  assert.equal(combat.length, 1);
  assert.equal(combat[0]!.message, 'combat msg');
});

test('log-ring: filter by channel array (multi-match)', () => {
  const ring = LogRingBuffer.create();
  ring.info('a', { channel: 'combat' });
  ring.info('b', { channel: 'net' });
  ring.info('c', { channel: 'ai' });
  const out = ring.filter({ channel: ['combat', 'net'] });
  assert.equal(out.length, 2);
});

test('log-ring: structured payload preserved', () => {
  const ring = LogRingBuffer.create();
  ring.warn('boss spawned', {
    channel: 'combat',
    data: { bossId: 42, hp: 1000 },
  });
  const all = ring.all();
  assert.equal(all[0]!.channel, 'combat');
  assert.deepEqual(all[0]!.data, { bossId: 42, hp: 1000 });
});

test('log-ring: sink fires for every accepted entry', () => {
  const seen: string[] = [];
  const ring = LogRingBuffer.create({
    sink: (e) => { seen.push(e.message); },
  });
  ring.info('a');
  ring.info('b');
  ring.info('c');
  assert.deepEqual(seen, ['a', 'b', 'c']);
});

test('log-ring: throwing sink does not break logging', () => {
  const ring = LogRingBuffer.create({
    sink: () => { throw new Error('boom'); },
  });
  ring.info('a');
  ring.info('b');
  assert.equal(ring.count(), 2);
});

test('log-ring: sink receives full entry shape', () => {
  let captured: LogEntry | null = null;
  const ring = LogRingBuffer.create({
    sink: (e) => { captured = e; },
    now: () => 12345,
  });
  ring.warn('hi', { channel: 'test', data: { v: 1 } });
  assert.ok(captured !== null);
  assert.equal((captured as unknown as LogEntry).level, 'warn');
  assert.equal((captured as unknown as LogEntry).message, 'hi');
  assert.equal((captured as unknown as LogEntry).channel, 'test');
  assert.deepEqual((captured as unknown as LogEntry).data, { v: 1 });
  assert.equal((captured as unknown as LogEntry).timestampMs, 12345);
});

test('log-ring: filtered entries do NOT fire the sink', () => {
  let seen = 0;
  const ring = LogRingBuffer.create({
    minLevel: 'warn',
    sink: () => { seen++; },
  });
  ring.debug('d');  // filtered
  ring.info('i');   // filtered
  ring.warn('w');
  assert.equal(seen, 1);
});

test('log-ring: clear empties + droppedSinceStart preserved', () => {
  const ring = LogRingBuffer.create({ capacity: 2 });
  ring.info('a');
  ring.info('b');
  ring.info('c'); // evicts 'a'
  assert.equal(ring.droppedSinceStart(), 1);
  ring.clear();
  assert.equal(ring.count(), 0);
  // dropped count preserved across clear.
  assert.equal(ring.droppedSinceStart(), 1);
});

test('log-ring: dispose makes log a no-op', () => {
  const ring = LogRingBuffer.create();
  ring.dispose();
  const id = ring.info('after dispose');
  assert.equal(id, 0);
  assert.equal(ring.count(), 0);
});

test('log-ring: log returns 0 for filtered entries', () => {
  const ring = LogRingBuffer.create({ minLevel: 'error' });
  const id = ring.info('filtered out');
  assert.equal(id, 0);
});

test('log-ring: log accepts non-string message via String() coercion', () => {
  const ring = LogRingBuffer.create();
  // @ts-expect-error - testing runtime guard
  ring.info(42);
  // @ts-expect-error - testing runtime guard
  ring.info({ foo: 'bar' });
  const all = ring.all();
  assert.equal(all[0]!.message, '[object Object]');
  assert.equal(all[1]!.message, '42');
});

test('log-ring: ring buffer wrap-around order is correct', () => {
  const ring = LogRingBuffer.create({ capacity: 3 });
  // Write 5 entries; ring holds latest 3.
  for (var i = 1; i <= 5; i++) ring.info('m' + i);
  const all = ring.all();
  // Newest first: m5, m4, m3.
  assert.deepEqual(all.map((e) => e.message), ['m5', 'm4', 'm3']);
});

test('log-ring: ids remain monotonic across eviction', () => {
  const ring = LogRingBuffer.create({ capacity: 3 });
  const ids: number[] = [];
  for (var i = 0; i < 5; i++) ids.push(ring.info('m' + i));
  // Sequential ids; not affected by eviction.
  for (var j = 1; j < ids.length; j++) {
    assert.ok(ids[j]! > ids[j - 1]!);
  }
});

test('log-ring: filter with no opts defaults to buffer minLevel', () => {
  const ring = LogRingBuffer.create({ minLevel: 'info' });
  ring.info('i');
  ring.warn('w');
  const out = ring.filter({});
  assert.equal(out.length, 2);
});
