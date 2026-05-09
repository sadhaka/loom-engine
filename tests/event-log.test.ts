// Phase 0.83.0 - EventLog tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  EventLog,
  RESOURCE_EVENT_LOG,
} from '../src/index.js';

interface LootDrop { itemId: string; x: number; y: number; }

test('event-log: RESOURCE constant', () => {
  assert.equal(RESOURCE_EVENT_LOG, 'event_log');
});

test('event-log: append assigns monotonic seq', () => {
  const log = EventLog.create<LootDrop>();
  assert.equal(log.append('drop', { itemId: 'a', x: 0, y: 0 }), 1);
  assert.equal(log.append('drop', { itemId: 'b', x: 0, y: 0 }), 2);
  assert.equal(log.append('drop', { itemId: 'c', x: 0, y: 0 }), 3);
});

test('event-log: rejects empty type', () => {
  const log = EventLog.create();
  assert.equal(log.append('', {}), 0);
});

test('event-log: bySeq finds record', () => {
  const log = EventLog.create<LootDrop>();
  log.append('drop', { itemId: 'a', x: 0, y: 0 });
  log.append('drop', { itemId: 'b', x: 0, y: 0 });
  const r = log.bySeq(2);
  assert.equal(r!.payload.itemId, 'b');
});

test('event-log: bySeq returns null for unknown', () => {
  const log = EventLog.create();
  assert.equal(log.bySeq(99), null);
  assert.equal(log.bySeq(0), null);
  assert.equal(log.bySeq(NaN), null);
});

test('event-log: byType filters', () => {
  const log = EventLog.create();
  log.append('a', 1);
  log.append('b', 2);
  log.append('a', 3);
  const as = log.byType('a');
  assert.equal(as.length, 2);
  assert.deepEqual(as.map((r) => r.payload), [1, 3]);
});

test('event-log: filter applies predicate', () => {
  const log = EventLog.create<number>();
  for (let i = 0; i < 10; i++) log.append('n', i);
  const evens = log.filter((r) => (r.payload as number) % 2 === 0);
  assert.equal(evens.length, 5);
});

test('event-log: filter ignores predicate errors', () => {
  const log = EventLog.create();
  log.append('a', 1);
  log.append('a', 2);
  const out = log.filter(() => { throw new Error('boom'); });
  assert.equal(out.length, 0);
});

test('event-log: list defensive copy', () => {
  const log = EventLog.create<{ v: number }>();
  log.append('x', { v: 1 });
  const arr = log.list();
  arr.push({} as never);
  assert.equal(log.size(), 1);
});

test('event-log: forEach iterates', () => {
  const log = EventLog.create();
  log.append('a', 1);
  log.append('a', 2);
  log.append('a', 3);
  let sum = 0;
  log.forEach((r) => { sum += r.payload as number; });
  assert.equal(sum, 6);
});

test('event-log: forEach with throwing cb is isolated', () => {
  const log = EventLog.create();
  log.append('a', 1);
  log.append('a', 2);
  let n = 0;
  log.forEach(() => { n++; throw new Error('boom'); });
  assert.equal(n, 2);
});

test('event-log: capacity evicts oldest', () => {
  const log = EventLog.create({ capacity: 3 });
  log.append('a', 1);
  log.append('a', 2);
  log.append('a', 3);
  log.append('a', 4);
  assert.equal(log.size(), 3);
  // bySeq still finds latest 3, oldest evicted.
  assert.equal(log.bySeq(1), null);
  assert.equal(log.bySeq(4)!.payload, 4);
});

test('event-log: clear empties', () => {
  const log = EventLog.create();
  log.append('a', 1);
  log.append('a', 2);
  log.clear();
  assert.equal(log.size(), 0);
});

test('event-log: highWaterMark tracks max seq', () => {
  const log = EventLog.create({ capacity: 2 });
  log.append('a', 1);
  log.append('a', 2);
  log.append('a', 3); // evicts seq=1
  assert.equal(log.highWaterMark(), 3);
});

test('event-log: toSnapshot + fromSnapshot roundtrip', () => {
  const log = EventLog.create<LootDrop>();
  log.append('drop', { itemId: 'a', x: 1, y: 1 });
  log.append('boss', { itemId: 'boss', x: 0, y: 0 });
  const snap = log.toSnapshot();
  const log2 = EventLog.create<LootDrop>();
  log2.fromSnapshot(snap);
  assert.equal(log2.size(), 2);
  // Continue numbering past restored max.
  const seq = log2.append('drop', { itemId: 'c', x: 5, y: 5 });
  assert.equal(seq, 3);
});

test('event-log: fromSnapshot tolerates malformed entries', () => {
  const log = EventLog.create();
  log.fromSnapshot([
    { seq: 1, type: 'a', payload: 1 },
    { seq: 0, type: 'bad', payload: null } as never, // seq invalid
    { seq: 2, type: '', payload: null } as never,    // type invalid
    null as never,                                   // null
    { seq: 3, type: 'b', payload: 'ok' },
  ]);
  assert.equal(log.size(), 2);
});

test('event-log: fromSnapshot evicts past capacity', () => {
  const log = EventLog.create({ capacity: 2 });
  log.fromSnapshot([
    { seq: 1, type: 'a', payload: 1 },
    { seq: 2, type: 'a', payload: 2 },
    { seq: 3, type: 'a', payload: 3 },
  ]);
  assert.equal(log.size(), 2);
});

test('event-log: dispose locks ops', () => {
  const log = EventLog.create();
  log.append('a', 1);
  log.dispose();
  assert.equal(log.append('b', 2), 0);
  assert.equal(log.size(), 0);
  log.fromSnapshot([{ seq: 1, type: 'x', payload: 1 }]);
  assert.equal(log.size(), 0);
});

test('event-log: payload preserved verbatim', () => {
  const log = EventLog.create<{ a: number; b: string[] }>();
  const payload = { a: 42, b: ['hello', 'world'] };
  log.append('complex', payload);
  const r = log.bySeq(1);
  assert.deepEqual(r!.payload, { a: 42, b: ['hello', 'world'] });
});

test('event-log: realistic loot/boss timeline replay', () => {
  const log = EventLog.create<{ name: string }>();
  log.append('boss.spawn', { name: 'Hydra' });
  log.append('loot.drop', { name: 'sword' });
  log.append('loot.drop', { name: 'shield' });
  log.append('boss.end', { name: 'Hydra' });
  const lootCount = log.byType('loot.drop').length;
  assert.equal(lootCount, 2);
  const bossEvents = log.filter((r) => r.type.startsWith('boss.'));
  assert.equal(bossEvents.length, 2);
});

test('event-log: capacity default tolerates non-finite/<=0', () => {
  const log = EventLog.create({ capacity: -1 });
  // Falls back to default 10000.
  assert.equal(log.capacity(), 10000);
});

test('event-log: size + list count match', () => {
  const log = EventLog.create();
  for (let i = 0; i < 5; i++) log.append('e', i);
  assert.equal(log.size(), 5);
  assert.equal(log.list().length, 5);
});
