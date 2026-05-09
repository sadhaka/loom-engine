// Phase 1.1.0 - InputBuffer tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  InputBuffer,
  RESOURCE_INPUT_BUFFER,
  type BufferedInput,
} from '../src/index.js';

interface AttackInput { kind: string; data?: Record<string, unknown> }

test('inputbuf: RESOURCE_INPUT_BUFFER is the stable string', () => {
  assert.equal(RESOURCE_INPUT_BUFFER, 'input_buffer');
});

test('inputbuf: starts empty', () => {
  const buf = InputBuffer.create();
  assert.equal(buf.count(), 0);
  assert.equal(buf.list().length, 0);
});

test('inputbuf: buffer returns id and adds entry', () => {
  const buf = InputBuffer.create<AttackInput>();
  const id = buf.buffer({ kind: 'attack' });
  assert.ok(id > 0);
  assert.equal(buf.count(), 1);
  assert.equal(buf.has(id), true);
});

test('inputbuf: tick advances ageMs', () => {
  const buf = InputBuffer.create<AttackInput>();
  buf.buffer({ kind: 'attack' });
  buf.tick(50);
  assert.equal(buf.list()[0]!.ageMs, 50);
});

test('inputbuf: tick expires after windowMs', () => {
  const buf = InputBuffer.create<AttackInput>({ defaultWindowMs: 100 });
  buf.buffer({ kind: 'attack' });
  buf.tick(50);
  assert.equal(buf.count(), 1);
  buf.tick(60);
  assert.equal(buf.count(), 0);
});

test('inputbuf: per-input windowMs override', () => {
  const buf = InputBuffer.create<AttackInput>({ defaultWindowMs: 200 });
  buf.buffer({ kind: 'short' }, { windowMs: 50 });
  buf.buffer({ kind: 'long' });
  buf.tick(60);
  assert.equal(buf.count(), 1);
  assert.equal(buf.list()[0]!.value.kind, 'long');
});

test('inputbuf: windowMs=-1 sticky never expires', () => {
  const buf = InputBuffer.create<AttackInput>({ defaultWindowMs: 100 });
  buf.buffer({ kind: 'sticky' }, { windowMs: -1 });
  buf.tick(60000);
  assert.equal(buf.count(), 1);
});

test('inputbuf: consume picks oldest matching + removes it', () => {
  const buf = InputBuffer.create<AttackInput>();
  buf.buffer({ kind: 'attack' });
  buf.buffer({ kind: 'jump' });
  buf.buffer({ kind: 'attack' });
  const consumed = buf.consume((i) => i.value.kind === 'attack');
  assert.ok(consumed);
  assert.equal(consumed!.value.kind, 'attack');
  assert.equal(buf.count(), 2);
  // The remaining entries should be jump + the second attack.
  const kinds = buf.list().map((i) => i.value.kind).sort();
  assert.deepEqual(kinds, ['attack', 'jump']);
});

test('inputbuf: consume with no match returns null', () => {
  const buf = InputBuffer.create<AttackInput>();
  buf.buffer({ kind: 'attack' });
  const consumed = buf.consume((i) => i.value.kind === 'never');
  assert.equal(consumed, null);
  assert.equal(buf.count(), 1);
});

test('inputbuf: peek finds without removing', () => {
  const buf = InputBuffer.create<AttackInput>();
  buf.buffer({ kind: 'attack' });
  const peeked = buf.peek((i) => i.value.kind === 'attack');
  assert.ok(peeked);
  assert.equal(buf.count(), 1);
});

test('inputbuf: consumeOldest grabs oldest + removes', () => {
  const buf = InputBuffer.create<AttackInput>();
  buf.buffer({ kind: 'first' });
  buf.buffer({ kind: 'second' });
  const got = buf.consumeOldest();
  assert.ok(got);
  assert.equal(got!.value.kind, 'first');
  assert.equal(buf.count(), 1);
});

test('inputbuf: consumeOldest on empty returns null', () => {
  const buf = InputBuffer.create();
  assert.equal(buf.consumeOldest(), null);
});

test('inputbuf: removeById removes', () => {
  const buf = InputBuffer.create<AttackInput>();
  const id = buf.buffer({ kind: 'attack' });
  assert.equal(buf.removeById(id), true);
  assert.equal(buf.count(), 0);
});

test('inputbuf: removeById unknown returns false', () => {
  const buf = InputBuffer.create();
  assert.equal(buf.removeById(999), false);
});

test('inputbuf: capacity caps + evicts oldest with reason evicted', () => {
  const events: Array<{ kind: string; reason: string }> = [];
  const buf = InputBuffer.create<AttackInput>({
    capacity: 2,
    onRemoved: (i, r) => events.push({ kind: i.value.kind, reason: r }),
  });
  buf.buffer({ kind: 'a' });
  buf.buffer({ kind: 'b' });
  buf.buffer({ kind: 'c' });
  assert.equal(buf.count(), 2);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.kind, 'a');
  assert.equal(events[0]!.reason, 'evicted');
});

test('inputbuf: clear with onRemoved fires cleared', () => {
  const removed: BufferedInput<AttackInput>[] = [];
  const buf = InputBuffer.create<AttackInput>({
    onRemoved: (i) => removed.push(i),
  });
  buf.buffer({ kind: 'a' });
  buf.buffer({ kind: 'b' });
  buf.clear();
  assert.equal(buf.count(), 0);
  assert.equal(removed.length, 2);
});

test('inputbuf: tick onRemoved expired fires', () => {
  const events: Array<{ kind: string; reason: string }> = [];
  const buf = InputBuffer.create<AttackInput>({
    defaultWindowMs: 50,
    onRemoved: (i, r) => events.push({ kind: i.value.kind, reason: r }),
  });
  buf.buffer({ kind: 'short' });
  buf.tick(60);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.reason, 'expired');
});

test('inputbuf: onBuffer fires on each buffer call', () => {
  const seen: string[] = [];
  const buf = InputBuffer.create<AttackInput>({
    onBuffer: (i) => seen.push(i.value.kind),
  });
  buf.buffer({ kind: 'a' });
  buf.buffer({ kind: 'b' });
  assert.deepEqual(seen, ['a', 'b']);
});

test('inputbuf: throwing predicate isolated, returns null', () => {
  const buf = InputBuffer.create<AttackInput>();
  buf.buffer({ kind: 'attack' });
  const consumed = buf.consume(() => { throw new Error('predicate-boom'); });
  assert.equal(consumed, null);
  assert.equal(buf.count(), 1);
});

test('inputbuf: throwing onBuffer / onRemoved isolated', () => {
  const buf = InputBuffer.create<AttackInput>({
    onBuffer: () => { throw new Error('buf-boom'); },
    onRemoved: () => { throw new Error('rm-boom'); },
  });
  const id = buf.buffer({ kind: 'a' });
  buf.removeById(id);
  buf.buffer({ kind: 'b' });
  buf.clear();
  assert.equal(buf.count(), 0);
});

test('inputbuf: NaN / Infinity / negative dt no-op', () => {
  const buf = InputBuffer.create<AttackInput>({ defaultWindowMs: 100 });
  buf.buffer({ kind: 'a' });
  buf.tick(NaN);
  buf.tick(-50);
  buf.tick(Infinity);
  assert.equal(buf.count(), 1);
  assert.equal(buf.list()[0]!.ageMs, 0);
});

test('inputbuf: list returns defensive copies', () => {
  const buf = InputBuffer.create<AttackInput>();
  buf.buffer({ kind: 'a', data: { combo: 3 } });
  const list = buf.list();
  list[0]!.ageMs = 99;
  list[0]!.value.kind = 'mutated';
  // Mutating snapshot does not affect internal state for primitives;
  // value reference IS shared (it's typed as T, no deep clone), but
  // ageMs / id / remainingMs / overall list are defensive.
  const list2 = buf.list();
  assert.equal(list2[0]!.ageMs, 0);
  assert.equal(list2.length, 1);
});

test('inputbuf: dispose locks ops', () => {
  const buf = InputBuffer.create<AttackInput>();
  buf.buffer({ kind: 'a' });
  buf.dispose();
  assert.equal(buf.buffer({ kind: 'b' }), 0);
  assert.equal(buf.consume(() => true), null);
  assert.equal(buf.consumeOldest(), null);
  assert.equal(buf.count(), 0);
});

test('inputbuf: forEach iterates oldest-first', () => {
  const buf = InputBuffer.create<AttackInput>();
  buf.buffer({ kind: 'a' });
  buf.buffer({ kind: 'b' });
  buf.buffer({ kind: 'c' });
  const seen: string[] = [];
  buf.forEach((i) => seen.push(i.value.kind));
  assert.deepEqual(seen, ['a', 'b', 'c']);
});

test('inputbuf: realistic example - buffer attack pre-anim, consume on anim end', () => {
  const buf = InputBuffer.create<AttackInput>({ defaultWindowMs: 200 });
  // Player presses attack 80ms before the previous attack animation
  // ends. Buffered.
  buf.buffer({ kind: 'attack', data: { combo: 1 } });
  buf.tick(80);
  // Animation ends; gameplay layer pulls the buffered attack.
  const next = buf.consume((i) => i.value.kind === 'attack');
  assert.ok(next);
  assert.deepEqual(next!.value.data, { combo: 1 });
  // After consumption, no buffered inputs remain.
  assert.equal(buf.count(), 0);
});

test('inputbuf: realistic example - input expires if consumed too late', () => {
  const buf = InputBuffer.create<AttackInput>({ defaultWindowMs: 100 });
  buf.buffer({ kind: 'attack' });
  // Player gets distracted; 200ms passes before the gameplay layer
  // checks. Input should be gone.
  buf.tick(200);
  const next = buf.consume((i) => i.value.kind === 'attack');
  assert.equal(next, null);
});
