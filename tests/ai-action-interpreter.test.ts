// Loom Engine - AIActionInterpreter tests.
//
// Covers the constructor power-of-two / bounds validation, the
// line-delimited parse (valid records, malformed-row rejection, blank
// lines, partial final lines, CRLF tolerance, id bounds, u32
// overflow), the bounded-ring drop-when-full behaviour, the
// SoA-write pop contract, FIFO order across a ring wrap, and clear.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { AIActionInterpreter } from '../src/index.js';

test('ai action interpreter: constructor validates queue size and entity bound', () => {
  const ai = new AIActionInterpreter(8, 1000);
  assert.equal(ai.maxQueueSize, 8);
  assert.equal(ai.maxEntityId, 1000);
  assert.equal(ai.capacity, 7, 'usable capacity is maxQueueSize - 1');
  // maxQueueSize must be a power of two >= 2.
  assert.throws(() => new AIActionInterpreter(0, 100), /maxQueueSize/);
  assert.throws(() => new AIActionInterpreter(1, 100), /maxQueueSize/);
  assert.throws(() => new AIActionInterpreter(6, 100), /maxQueueSize/);
  assert.throws(() => new AIActionInterpreter(2.5, 100), /maxQueueSize/);
  assert.throws(() => new AIActionInterpreter(1 << 21, 100), /maxQueueSize/);
  // maxEntityId must be a non-negative u32 integer.
  assert.throws(() => new AIActionInterpreter(8, -1), /maxEntityId/);
  assert.throws(() => new AIActionInterpreter(8, 2.5), /maxEntityId/);
  assert.throws(() => new AIActionInterpreter(8, 0x1_0000_0000), /maxEntityId/);
});

test('ai action interpreter: parses valid lines and pop drains them in order', () => {
  const ai = new AIActionInterpreter(8, 1000);
  const stats = ai.parse('1,2,3\n4,5,6\n');
  assert.deepEqual(stats, { accepted: 2, rejected: 0, dropped: 0 });
  assert.equal(ai.count(), 2);

  const out = new Uint32Array(3);
  assert.equal(ai.pop(out), true);
  assert.deepEqual(Array.from(out), [1, 2, 3]);
  assert.equal(ai.pop(out), true);
  assert.deepEqual(Array.from(out), [4, 5, 6]);
  assert.equal(ai.pop(out), false, 'ring is drained');
});

test('ai action interpreter: rejects malformed rows without throwing', () => {
  const ai = new AIActionInterpreter(64, 1000);
  // Wrong field count, non-digit, whitespace, and empty fields all reject.
  for (const bad of ['1,2\n', '1,2,3,4\n', 'a,2,3\n', '1, 2,3\n', ',2,3\n', '1,,3\n', '1,2,\n']) {
    const stats = ai.parse(bad);
    assert.equal(stats.accepted, 0, 'no record accepted from ' + JSON.stringify(bad));
    assert.equal(stats.rejected, 1, 'one row rejected from ' + JSON.stringify(bad));
  }
  assert.equal(ai.count(), 0);
});

test('ai action interpreter: blank lines are skipped, not counted as rejected', () => {
  const ai = new AIActionInterpreter(8, 1000);
  const stats = ai.parse('\n\n1,2,3\n\n');
  assert.deepEqual(stats, { accepted: 1, rejected: 0, dropped: 0 });
});

test('ai action interpreter: an unterminated partial final line is rejected', () => {
  const ai = new AIActionInterpreter(8, 1000);
  // First line is complete; the trailing "4,5,6" has no newline.
  assert.deepEqual(ai.parse('1,2,3\n4,5,6'), { accepted: 1, rejected: 1, dropped: 0 });
  // No newline at all - the whole thing is a partial final line.
  ai.clear();
  assert.deepEqual(ai.parse('1,2,3'), { accepted: 0, rejected: 1, dropped: 0 });
});

test('ai action interpreter: CRLF line endings are tolerated', () => {
  const ai = new AIActionInterpreter(8, 1000);
  assert.deepEqual(ai.parse('1,2,3\r\n4,5,6\r\n'), { accepted: 2, rejected: 0, dropped: 0 });
  assert.equal(ai.count(), 2);
});

test('ai action interpreter: npcId and targetId are bounds-checked, actionId is not', () => {
  const ai = new AIActionInterpreter(16, 100);
  // npcId / targetId past maxEntityId are rejected.
  assert.equal(ai.parse('200,5,3\n').rejected, 1, 'npcId 200 > maxEntityId 100');
  assert.equal(ai.parse('5,5,200\n').rejected, 1, 'targetId 200 > maxEntityId 100');
  // actionId is a plain u32 - not bounded by maxEntityId (semantic
  // validity is the consumer's job).
  assert.equal(ai.parse('5,99999,3\n').accepted, 1, 'actionId may exceed maxEntityId');
});

test('ai action interpreter: a field overflowing u32 is rejected', () => {
  const ai = new AIActionInterpreter(8, 0xffffffff);
  // 2^32 does not fit u32.
  assert.equal(ai.parse('4294967296,1,2\n').rejected, 1);
  // 2^32 - 1 is the largest valid u32.
  assert.equal(ai.parse('4294967295,1,2\n').accepted, 1);
});

test('ai action interpreter: a full ring drops new records and counts them', () => {
  const ai = new AIActionInterpreter(2, 1000);   // capacity 1
  const stats = ai.parse('1,1,1\n2,2,2\n3,3,3\n');
  assert.deepEqual(stats, { accepted: 1, rejected: 0, dropped: 2 });
  assert.equal(ai.count(), 1);
});

test('ai action interpreter: count / isEmpty / isFull track the ring', () => {
  const ai = new AIActionInterpreter(4, 1000);   // capacity 3
  assert.equal(ai.isEmpty(), true);
  assert.equal(ai.isFull(), false);
  assert.equal(ai.count(), 0);
  ai.parse('1,1,1\n2,2,2\n3,3,3\n');
  assert.equal(ai.count(), 3);
  assert.equal(ai.isFull(), true);
  assert.equal(ai.isEmpty(), false);
  const out = new Uint32Array(3);
  ai.pop(out); ai.pop(out); ai.pop(out);
  assert.equal(ai.isEmpty(), true);
  assert.equal(ai.count(), 0);
});

test('ai action interpreter: pop needs a 3-wide buffer and leaves it untouched when empty', () => {
  const ai = new AIActionInterpreter(8, 1000);
  assert.throws(() => ai.pop(new Uint32Array(2)), /at least 3/);
  const out = new Uint32Array(3).fill(7);
  assert.equal(ai.pop(out), false);
  assert.deepEqual(Array.from(out), [7, 7, 7], 'an empty pop does not write out');
});

test('ai action interpreter: clear empties the ring', () => {
  const ai = new AIActionInterpreter(8, 1000);
  ai.parse('1,2,3\n4,5,6\n');
  ai.clear();
  assert.equal(ai.isEmpty(), true);
  assert.equal(ai.count(), 0);
  assert.equal(ai.pop(new Uint32Array(3)), false);
});

test('ai action interpreter: FIFO order survives a ring wrap', () => {
  const ai = new AIActionInterpreter(4, 1000);   // capacity 3
  ai.parse('10,10,10\n11,11,11\n12,12,12\n');
  const out = new Uint32Array(3);
  ai.pop(out); ai.pop(out);   // drain 10 and 11; head advances past the wrap point
  ai.parse('13,13,13\n14,14,14\n');
  // Remaining, in FIFO order, must be 12 then 13 then 14.
  ai.pop(out);
  assert.deepEqual(Array.from(out), [12, 12, 12]);
  ai.pop(out);
  assert.deepEqual(Array.from(out), [13, 13, 13]);
  ai.pop(out);
  assert.deepEqual(Array.from(out), [14, 14, 14]);
  assert.equal(ai.pop(out), false);
});

test('ai action interpreter: a mixed batch produces exact accepted/rejected/dropped counts', () => {
  const ai = new AIActionInterpreter(4, 100);   // capacity 3
  // 5 valid rows, 2 malformed, 1 blank, 1 partial final line.
  // Capacity is 3, so 2 of the 5 valid rows are dropped.
  const input = '1,1,1\n2,2,2\nbad,row\n\n3,3,3\n4,4,4\n9,9,9999999\n5,5,5\n6,6,6';
  const stats = ai.parse(input);
  assert.equal(stats.accepted, 3, 'ring capacity 3 accepts the first 3 valid rows');
  assert.equal(stats.dropped, 2, 'the remaining 2 valid rows are dropped');
  // 'bad,row' (2 fields), '9,9,9999999' (targetId > maxEntityId 100),
  // and the unterminated '6,6,6' partial line are the 3 rejects.
  assert.equal(stats.rejected, 3);
});
