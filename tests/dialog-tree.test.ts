// Phase 0.61.0 - DialogTree tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  DialogTree,
  RESOURCE_DIALOG_TREE,
} from '../src/index.js';

test('dialog: RESOURCE_DIALOG_TREE is the stable string', () => {
  assert.equal(RESOURCE_DIALOG_TREE, 'dialog_tree');
});

test('dialog: requires start + matching node', () => {
  assert.throws(() => DialogTree.create({ start: '', nodes: {} }), /start node required/);
  assert.throws(
    () => DialogTree.create({ start: 'x', nodes: { y: { text: '', choices: [] } } }),
    /not in nodes/,
  );
});

test('dialog: starts inactive; start() activates start node', () => {
  const tree = DialogTree.create({
    start: 'a',
    nodes: { a: { text: 'hi', choices: [] } },
  });
  assert.equal(tree.isActive(), false);
  assert.equal(tree.current(), null);
  tree.start();
  assert.equal(tree.isActive(), true);
  assert.equal(tree.currentId(), 'a');
  assert.equal(tree.current()!.text, 'hi');
});

test('dialog: visibleChoices returns all when no predicates', () => {
  const tree = DialogTree.create({
    start: 'a',
    nodes: {
      a: {
        text: '?',
        choices: [
          { label: 'X', next: 'a' },
          { label: 'Y', next: 'a' },
        ],
      },
    },
  });
  tree.start();
  assert.equal(tree.visibleChoices().length, 2);
});

test('dialog: predicate filters hide choices', () => {
  const tree = DialogTree.create({
    start: 'a',
    nodes: {
      a: {
        text: '?',
        choices: [
          { label: 'always', next: 'a' },
          { label: 'never',  next: 'a', if: 'never' },
          { label: 'maybe',  next: 'a', if: 'maybe' },
        ],
      },
    },
    predicates: {
      never: () => false,
      maybe: () => true,
    },
  });
  tree.start();
  const visible = tree.visibleChoices().map((c) => c.label);
  assert.deepEqual(visible, ['always', 'maybe']);
});

test('dialog: missing predicate hides the choice', () => {
  const tree = DialogTree.create({
    start: 'a',
    nodes: {
      a: { text: '?', choices: [{ label: 'X', next: 'a', if: 'unregistered' }] },
    },
  });
  tree.start();
  assert.equal(tree.visibleChoices().length, 0);
});

test('dialog: throwing predicate hides the choice', () => {
  const tree = DialogTree.create({
    start: 'a',
    nodes: {
      a: { text: '?', choices: [{ label: 'X', next: 'a', if: 'boom' }] },
    },
    predicates: { boom: () => { throw new Error('x'); } },
  });
  tree.start();
  assert.equal(tree.visibleChoices().length, 0);
});

test('dialog: choose advances to next node', () => {
  const tree = DialogTree.create({
    start: 'a',
    nodes: {
      a: { text: 'a', choices: [{ label: 'go', next: 'b' }] },
      b: { text: 'b', choices: [] },
    },
  });
  tree.start();
  assert.equal(tree.choose(0), true);
  assert.equal(tree.currentId(), 'b');
});

test('dialog: choose fires the choice action with data', () => {
  let captured: unknown = null;
  const tree = DialogTree.create({
    start: 'a',
    nodes: {
      a: {
        text: 'a',
        choices: [
          { label: 'p', next: 'b', do: 'pick', data: { id: 42 } },
        ],
      },
      b: { text: 'b', choices: [] },
    },
    actions: {
      pick: (d) => { captured = d; },
    },
  });
  tree.start();
  tree.choose(0);
  assert.deepEqual(captured, { id: 42 });
});

test('dialog: throwing action does not block transition', () => {
  const tree = DialogTree.create({
    start: 'a',
    nodes: {
      a: { text: 'a', choices: [{ label: 'X', next: 'b', do: 'boom' }] },
      b: { text: 'b', choices: [] },
    },
    actions: { boom: () => { throw new Error('x'); } },
  });
  tree.start();
  tree.choose(0);
  // Transition still happened.
  assert.equal(tree.currentId(), 'b');
});

test('dialog: choose to unknown next ends the dialog', () => {
  let ended = false;
  const tree = DialogTree.create({
    start: 'a',
    nodes: { a: { text: 'a', choices: [{ label: 'bye', next: 'end' }] } },
    onEnd: () => { ended = true; },
  });
  tree.start();
  tree.choose(0);
  assert.equal(tree.isActive(), false);
  assert.equal(ended, true);
});

test('dialog: choose with bad index returns false', () => {
  const tree = DialogTree.create({
    start: 'a',
    nodes: { a: { text: 'a', choices: [{ label: 'X', next: 'a' }] } },
  });
  tree.start();
  assert.equal(tree.choose(-1), false);
  assert.equal(tree.choose(99), false);
});

test('dialog: choose before start returns false', () => {
  const tree = DialogTree.create({
    start: 'a',
    nodes: { a: { text: 'a', choices: [{ label: 'X', next: 'a' }] } },
  });
  assert.equal(tree.choose(0), false);
});

test('dialog: onEnter fires when entering a node', () => {
  const log: string[] = [];
  const tree = DialogTree.create({
    start: 'a',
    nodes: {
      a: { text: 'a', onEnter: 'enterA', choices: [{ label: 'go', next: 'b' }] },
      b: { text: 'b', onEnter: 'enterB', choices: [] },
    },
    actions: {
      enterA: () => log.push('A'),
      enterB: () => log.push('B'),
    },
  });
  tree.start();
  tree.choose(0);
  assert.deepEqual(log, ['A', 'B']);
});

test('dialog: setPredicate / setAction at runtime works', () => {
  const tree = DialogTree.create({
    start: 'a',
    nodes: {
      a: {
        text: 'a',
        choices: [
          { label: 'X', next: 'b', if: 'late', do: 'lateAct' },
        ],
      },
      b: { text: 'b', choices: [] },
    },
  });
  tree.setPredicate('late', () => true);
  let actionFired = false;
  tree.setAction('lateAct', () => { actionFired = true; });
  tree.start();
  tree.choose(0);
  assert.equal(tree.currentId(), 'b');
  assert.equal(actionFired, true);
});

test('dialog: end() terminates without firing action', () => {
  let endCount = 0;
  const tree = DialogTree.create({
    start: 'a',
    nodes: { a: { text: 'a', choices: [] } },
    onEnd: () => { endCount++; },
  });
  tree.start();
  tree.end();
  assert.equal(tree.isActive(), false);
  assert.equal(endCount, 1);
  // end again is a no-op.
  tree.end();
  assert.equal(endCount, 1);
});

test('dialog: dispose locks subsequent ops', () => {
  const tree = DialogTree.create({
    start: 'a',
    nodes: { a: { text: 'a', choices: [{ label: 'X', next: 'a' }] } },
  });
  tree.dispose();
  tree.start();
  assert.equal(tree.isActive(), false);
});

test('dialog: realistic example - quest offer', () => {
  let questAccepted = false;
  let level = 4;
  const tree = DialogTree.create({
    start: 'greet',
    nodes: {
      greet: {
        text: 'Hello!',
        choices: [
          { label: 'Got quests?', next: 'offer', if: 'isLvl5+' },
          { label: 'Nope.',       next: 'farewell' },
        ],
      },
      offer: {
        text: 'Slay the boss.',
        choices: [
          { label: 'Accept', next: 'farewell', do: 'acceptQuest', data: { id: 'q1' } },
          { label: 'Decline', next: 'farewell' },
        ],
      },
      farewell: { text: 'Bye!', choices: [] },
    },
    predicates: { 'isLvl5+': () => level >= 5 },
    actions: { acceptQuest: () => { questAccepted = true; } },
  });
  // Level 4: quest hidden.
  tree.start();
  assert.equal(tree.visibleChoices().length, 1);
  assert.equal(tree.visibleChoices()[0]!.label, 'Nope.');
  tree.end();
  // Level up to 5: quest visible.
  level = 5;
  tree.start();
  assert.equal(tree.visibleChoices().length, 2);
  tree.choose(0);  // Got quests
  tree.choose(0);  // Accept
  assert.equal(questAccepted, true);
  assert.equal(tree.currentId(), 'farewell');
});
