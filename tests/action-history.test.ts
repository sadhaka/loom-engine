// Phase 0.67.0 - ActionHistory tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  ActionHistory,
  RESOURCE_ACTION_HISTORY,
} from '../src/index.js';

// Helper: a simple counter action.
function counterAction(state: { value: number }, delta: number): {
  label?: string;
  apply: () => void;
  undo: () => void;
} {
  return {
    label: 'add ' + delta,
    apply: () => { state.value += delta; },
    undo: () => { state.value -= delta; },
  };
}

test('history: RESOURCE_ACTION_HISTORY is the stable string', () => {
  assert.equal(RESOURCE_ACTION_HISTORY, 'action_history');
});

test('history: starts empty', () => {
  const h = ActionHistory.create();
  assert.equal(h.canUndo(), false);
  assert.equal(h.canRedo(), false);
  assert.equal(h.undoSize(), 0);
  assert.equal(h.redoSize(), 0);
});

test('history: push applies the action', () => {
  const state = { value: 0 };
  const h = ActionHistory.create();
  h.push(counterAction(state, 5));
  assert.equal(state.value, 5);
});

test('history: push enables undo', () => {
  const state = { value: 0 };
  const h = ActionHistory.create();
  h.push(counterAction(state, 5));
  assert.equal(h.canUndo(), true);
});

test('history: undo reverses the action', () => {
  const state = { value: 0 };
  const h = ActionHistory.create();
  h.push(counterAction(state, 5));
  h.push(counterAction(state, 3));
  assert.equal(state.value, 8);
  h.undo();
  assert.equal(state.value, 5);
  h.undo();
  assert.equal(state.value, 0);
});

test('history: undo on empty returns false', () => {
  const h = ActionHistory.create();
  assert.equal(h.undo(), false);
});

test('history: redo re-applies', () => {
  const state = { value: 0 };
  const h = ActionHistory.create();
  h.push(counterAction(state, 5));
  h.undo();
  assert.equal(state.value, 0);
  h.redo();
  assert.equal(state.value, 5);
});

test('history: redo on empty returns false', () => {
  const h = ActionHistory.create();
  assert.equal(h.redo(), false);
});

test('history: new push clears redo stack (new branch)', () => {
  const state = { value: 0 };
  const h = ActionHistory.create();
  h.push(counterAction(state, 5));
  h.undo();
  assert.equal(h.canRedo(), true);
  h.push(counterAction(state, 3));
  assert.equal(h.canRedo(), false);
});

test('history: capacity caps undo stack', () => {
  const state = { value: 0 };
  const h = ActionHistory.create({ capacity: 2 });
  h.push(counterAction(state, 1));
  h.push(counterAction(state, 1));
  h.push(counterAction(state, 1));
  assert.equal(h.undoSize(), 2);
});

test('history: capacity 0 = unbounded', () => {
  const state = { value: 0 };
  const h = ActionHistory.create({ capacity: 0 });
  for (var i = 0; i < 200; i++) h.push(counterAction(state, 1));
  assert.equal(h.undoSize(), 200);
});

test('history: peekUndo / peekRedo return topmost action', () => {
  const state = { value: 0 };
  const h = ActionHistory.create();
  h.push(counterAction(state, 5));
  h.push(counterAction(state, 3));
  assert.equal(h.peekUndo()!.label, 'add 3');
  h.undo();
  assert.equal(h.peekUndo()!.label, 'add 5');
  assert.equal(h.peekRedo()!.label, 'add 3');
});

test('history: peek on empty returns null', () => {
  const h = ActionHistory.create();
  assert.equal(h.peekUndo(), null);
  assert.equal(h.peekRedo(), null);
});

test('history: throwing apply does NOT push to stack', () => {
  const h = ActionHistory.create();
  h.push({
    apply: () => { throw new Error('boom'); },
    undo: () => {},
  });
  assert.equal(h.canUndo(), false);
});

test('history: throwing undo re-pushes action', () => {
  const h = ActionHistory.create();
  let applyCalls = 0;
  h.push({
    apply: () => { applyCalls++; },
    undo: () => { throw new Error('boom'); },
  });
  // applyCalls should be 1 from the push.
  assert.equal(applyCalls, 1);
  // Undo throws -> action remains on undo stack.
  assert.equal(h.undo(), false);
  assert.equal(h.canUndo(), true);
});

test('history: throwing redo re-pushes to redo stack', () => {
  const h = ActionHistory.create();
  let undoCalls = 0;
  let applyCalls = 0;
  h.push({
    apply: () => { applyCalls++; if (applyCalls > 1) throw new Error('boom'); },
    undo: () => { undoCalls++; },
  });
  h.undo();
  assert.equal(h.redo(), false);
  // Action stays on redo stack.
  assert.equal(h.canRedo(), true);
});

test('history: clear empties both stacks', () => {
  const state = { value: 0 };
  const h = ActionHistory.create();
  h.push(counterAction(state, 1));
  h.push(counterAction(state, 1));
  h.undo();
  h.clear();
  assert.equal(h.canUndo(), false);
  assert.equal(h.canRedo(), false);
});

test('history: invalid action (no apply / no undo) is rejected', () => {
  const h = ActionHistory.create();
  // @ts-expect-error - testing runtime guard
  h.push(null);
  // @ts-expect-error - testing runtime guard
  h.push({});
  // @ts-expect-error - testing runtime guard
  h.push({ apply: () => {} });
  assert.equal(h.canUndo(), false);
});

test('history: onApplied / onUndone callbacks fire', () => {
  const log: string[] = [];
  const state = { value: 0 };
  const h = ActionHistory.create({
    onApplied: (a) => log.push('apply:' + a.label),
    onUndone: (a) => log.push('undo:' + a.label),
  });
  h.push(counterAction(state, 5));
  h.undo();
  h.redo();
  assert.deepEqual(log, ['apply:add 5', 'undo:add 5', 'apply:add 5']);
});

test('history: throwing callback isolated', () => {
  const state = { value: 0 };
  const h = ActionHistory.create({
    onApplied: () => { throw new Error('boom'); },
    onUndone: () => { throw new Error('boom'); },
  });
  h.push(counterAction(state, 1));
  h.undo();
  // No throw propagated.
  assert.equal(state.value, 0);
});

test('history: dispose locks ops', () => {
  const state = { value: 0 };
  const h = ActionHistory.create();
  h.push(counterAction(state, 5));
  h.dispose();
  h.push(counterAction(state, 3));  // no-op
  assert.equal(state.value, 5);  // still 5
  assert.equal(h.undo(), false);
});

test('history: realistic example - undo/redo a sequence of edits', () => {
  const state = { value: 0 };
  const h = ActionHistory.create();
  h.push(counterAction(state, 10));  // 10
  h.push(counterAction(state, 5));   // 15
  h.push(counterAction(state, 100)); // 115
  h.undo();                           // 15
  h.undo();                           // 10
  h.redo();                           // 15
  h.push(counterAction(state, -3));  // 12 (clears redo)
  assert.equal(state.value, 12);
  assert.equal(h.canRedo(), false);
});
