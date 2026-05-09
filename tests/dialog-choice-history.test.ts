// Phase 0.89.0 - DialogChoiceHistory tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  DialogChoiceHistory,
  RESOURCE_DIALOG_CHOICE_HISTORY,
} from '../src/index.js';

test('dialog-choice-history: RESOURCE constant', () => {
  assert.equal(RESOURCE_DIALOG_CHOICE_HISTORY, 'dialog_choice_history');
});

test('dialog-choice-history: record adds entry', () => {
  const h = DialogChoiceHistory.create();
  assert.ok(h.record('mira', 1, 'Take quest'));
  assert.equal(h.totalCount(), 1);
});

test('dialog-choice-history: record rejects invalid', () => {
  const h = DialogChoiceHistory.create();
  assert.equal(h.record('', 0), false);
  assert.equal(h.record('a', -1), false);
  assert.equal(h.record('a', NaN), false);
});

test('dialog-choice-history: byNode filters', () => {
  const h = DialogChoiceHistory.create();
  h.record('mira', 0);
  h.record('thane', 1);
  h.record('mira', 2);
  const mira = h.byNode('mira');
  assert.equal(mira.length, 2);
  assert.deepEqual(mira.map((r) => r.choiceIndex), [0, 2]);
});

test('dialog-choice-history: lastChoice returns most recent', () => {
  const h = DialogChoiceHistory.create();
  h.record('mira', 0);
  h.record('mira', 1);
  h.record('mira', 2);
  assert.equal(h.lastChoice('mira')!.choiceIndex, 2);
});

test('dialog-choice-history: lastChoice null for unrecorded', () => {
  const h = DialogChoiceHistory.create();
  assert.equal(h.lastChoice('nope'), null);
});

test('dialog-choice-history: has detects past picks', () => {
  const h = DialogChoiceHistory.create();
  h.record('mira', 0);
  h.record('mira', 2);
  assert.ok(h.has('mira', 0));
  assert.ok(h.has('mira', 2));
  assert.equal(h.has('mira', 1), false);
  assert.equal(h.has('thane', 0), false);
});

test('dialog-choice-history: count tallies repeats', () => {
  const h = DialogChoiceHistory.create();
  h.record('mira', 1);
  h.record('mira', 1);
  h.record('mira', 1);
  assert.equal(h.count('mira', 1), 3);
});

test('dialog-choice-history: countByNode tallies all picks at node', () => {
  const h = DialogChoiceHistory.create();
  h.record('mira', 0);
  h.record('mira', 1);
  h.record('thane', 1);
  assert.equal(h.countByNode('mira'), 2);
  assert.equal(h.countByNode('thane'), 1);
});

test('dialog-choice-history: capacity evicts oldest', () => {
  const h = DialogChoiceHistory.create({ capacity: 3 });
  h.record('a', 0);
  h.record('a', 1);
  h.record('a', 2);
  h.record('a', 3);
  assert.equal(h.totalCount(), 3);
  assert.equal(h.has('a', 0), false);
  assert.equal(h.has('a', 3), true);
});

test('dialog-choice-history: clear empties', () => {
  const h = DialogChoiceHistory.create();
  h.record('a', 0);
  h.record('a', 1);
  h.clear();
  assert.equal(h.totalCount(), 0);
});

test('dialog-choice-history: list defensive copy', () => {
  const h = DialogChoiceHistory.create();
  h.record('a', 0);
  const arr = h.list();
  arr.length = 0;
  assert.equal(h.totalCount(), 1);
});

test('dialog-choice-history: byNode entries are defensive copies', () => {
  const h = DialogChoiceHistory.create();
  h.record('a', 0, 'orig');
  const arr = h.byNode('a');
  arr[0]!.choiceLabel = 'mutated';
  assert.equal(h.byNode('a')[0]!.choiceLabel, 'orig');
});

test('dialog-choice-history: choiceLabel optional', () => {
  const h = DialogChoiceHistory.create();
  h.record('a', 0); // no label
  h.record('a', 1, 'with label');
  const arr = h.byNode('a');
  assert.equal(arr[0]!.choiceLabel, undefined);
  assert.equal(arr[1]!.choiceLabel, 'with label');
});

test('dialog-choice-history: monotonic seq numbers', () => {
  const h = DialogChoiceHistory.create();
  h.record('a', 0);
  h.record('a', 1);
  h.record('a', 2);
  const arr = h.list();
  assert.deepEqual(arr.map((r) => r.seq), [1, 2, 3]);
});

test('dialog-choice-history: toSnapshot + fromSnapshot roundtrip', () => {
  const h = DialogChoiceHistory.create();
  h.record('a', 0, 'first');
  h.record('b', 1, 'second');
  const snap = h.toSnapshot();
  const h2 = DialogChoiceHistory.create();
  h2.fromSnapshot(snap);
  assert.equal(h2.totalCount(), 2);
  assert.equal(h2.lastChoice('a')!.choiceLabel, 'first');
  // New records continue numbering past max.
  h2.record('c', 0);
  const fresh = h2.lastChoice('c')!;
  assert.equal(fresh.seq, 3);
});

test('dialog-choice-history: fromSnapshot tolerates malformed entries', () => {
  const h = DialogChoiceHistory.create();
  h.fromSnapshot([
    { nodeId: 'a', choiceIndex: 0, seq: 1 },
    { nodeId: '', choiceIndex: 0, seq: 2 } as never,    // invalid
    { nodeId: 'b', choiceIndex: -1, seq: 3 } as never,  // invalid
    { nodeId: 'c', choiceIndex: 0, seq: 0 } as never,   // invalid seq
    { nodeId: 'd', choiceIndex: 1, seq: 5 },
  ]);
  assert.equal(h.totalCount(), 2);
});

test('dialog-choice-history: fromSnapshot evicts past capacity', () => {
  const h = DialogChoiceHistory.create({ capacity: 2 });
  h.fromSnapshot([
    { nodeId: 'a', choiceIndex: 0, seq: 1 },
    { nodeId: 'a', choiceIndex: 1, seq: 2 },
    { nodeId: 'a', choiceIndex: 2, seq: 3 },
  ]);
  assert.equal(h.totalCount(), 2);
});

test('dialog-choice-history: dispose locks ops', () => {
  const h = DialogChoiceHistory.create();
  h.record('a', 0);
  h.dispose();
  assert.equal(h.record('b', 0), false);
  assert.equal(h.totalCount(), 0);
});

test('dialog-choice-history: realistic branching tree replay', () => {
  const h = DialogChoiceHistory.create();
  // Player meets Mira, takes quest.
  h.record('mira-intro', 1, 'Take quest');
  // Refuses help from Thane.
  h.record('thane-intro', 0, 'Refuse');
  // Returns to Mira.
  h.record('mira-return', 0, 'Report success');
  // Quest gating: only show secret-end if took quest AND refused help.
  const tookQuest = h.has('mira-intro', 1);
  const refusedHelp = h.has('thane-intro', 0);
  assert.ok(tookQuest && refusedHelp);
});

test('dialog-choice-history: capacity defaults sensibly', () => {
  const h = DialogChoiceHistory.create({ capacity: -1 });
  // -1 invalid -> default 10000.
  assert.equal(h.capacity(), 10000);
});

test('dialog-choice-history: choiceIndex floored', () => {
  const h = DialogChoiceHistory.create();
  h.record('a', 1.7);
  assert.equal(h.lastChoice('a')!.choiceIndex, 1);
});

test('dialog-choice-history: countByNode 0 for unknown', () => {
  const h = DialogChoiceHistory.create();
  assert.equal(h.countByNode('ghost'), 0);
  assert.equal(h.count('ghost', 0), 0);
});
