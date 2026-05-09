// Phase 0.88.0 - TutorialFlow tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  TutorialFlow,
  RESOURCE_TUTORIAL_FLOW,
  type TutorialStep,
} from '../src/index.js';

function makeBasicSteps(): TutorialStep[] {
  return [
    { id: 'a', anchorId: '#a', message: 'A' },
    { id: 'b', anchorId: '#b', message: 'B' },
    { id: 'c', anchorId: '#c', message: 'C' },
  ];
}

test('tutorial-flow: RESOURCE constant', () => {
  assert.equal(RESOURCE_TUTORIAL_FLOW, 'tutorial_flow');
});

test('tutorial-flow: currentStep returns first step initially', () => {
  const t = TutorialFlow.create({ steps: makeBasicSteps() });
  assert.equal(t.currentStep()!.id, 'a');
});

test('tutorial-flow: advance moves to next', () => {
  const t = TutorialFlow.create({ steps: makeBasicSteps() });
  t.advance();
  assert.equal(t.currentStep()!.id, 'b');
  t.advance();
  assert.equal(t.currentStep()!.id, 'c');
  t.advance();
  assert.equal(t.currentStep(), null);
});

test('tutorial-flow: advance returns false when done', () => {
  const t = TutorialFlow.create({ steps: [{ id: 'a', anchorId: '#a', message: 'A' }] });
  assert.ok(t.advance());
  assert.equal(t.advance(), false);
});

test('tutorial-flow: completeStep marks specific id done', () => {
  const t = TutorialFlow.create({ steps: makeBasicSteps() });
  assert.ok(t.completeStep('b'));
  // Still on a (a is first incomplete).
  assert.equal(t.currentStep()!.id, 'a');
  t.advance();
  // Now skip past b automatically.
  assert.equal(t.currentStep()!.id, 'c');
});

test('tutorial-flow: completeStep on unknown returns false', () => {
  const t = TutorialFlow.create({ steps: makeBasicSteps() });
  assert.equal(t.completeStep('ghost'), false);
});

test('tutorial-flow: skipAll completes everything + fires onFlowComplete', () => {
  let complete = 0;
  const t = TutorialFlow.create({
    steps: makeBasicSteps(),
    onFlowComplete: () => { complete++; },
  });
  t.skipAll();
  assert.ok(t.isComplete());
  assert.equal(complete, 1);
});

test('tutorial-flow: restart clears completion', () => {
  const t = TutorialFlow.create({ steps: makeBasicSteps() });
  t.advance(); t.advance();
  t.restart();
  assert.equal(t.currentStep()!.id, 'a');
  assert.equal(t.isCompleted('a'), false);
});

test('tutorial-flow: condition gates step visibility', () => {
  let allowB = false;
  const t = TutorialFlow.create({
    steps: [
      { id: 'a', anchorId: '#a', message: 'A' },
      { id: 'b', anchorId: '#b', message: 'B', condition: () => allowB },
      { id: 'c', anchorId: '#c', message: 'C' },
    ],
  });
  t.advance(); // mark a complete
  assert.equal(t.currentStep()!.id, 'c'); // b skipped (condition false)
  allowB = true;
  // Now b is visible again. But we haven't marked it complete; it's
  // first incomplete & visible.
  assert.equal(t.currentStep()!.id, 'b');
});

test('tutorial-flow: condition throwing skipped (treated as false)', () => {
  const t = TutorialFlow.create({
    steps: [
      { id: 'a', anchorId: '#a', message: 'A', condition: () => { throw new Error('boom'); } },
      { id: 'b', anchorId: '#b', message: 'B' },
    ],
  });
  // a's condition throws -> skipped; b is current.
  assert.equal(t.currentStep()!.id, 'b');
});

test('tutorial-flow: onStepChanged fires on advance', () => {
  const log: Array<{ next: string | null; prev: string | null }> = [];
  const t = TutorialFlow.create({
    steps: makeBasicSteps(),
    onStepChanged: (next, prev) => log.push({ next: next?.id ?? null, prev: prev?.id ?? null }),
  });
  // Trigger initial pump via currentStep().
  t.currentStep();
  t.advance();
  t.advance();
  t.advance();
  // Initial: null -> a; a -> b; b -> c; c -> null.
  assert.deepEqual(log.map((e) => e.next), ['a', 'b', 'c', null]);
});

test('tutorial-flow: onShow fires once per step', () => {
  const shown: string[] = [];
  const t = TutorialFlow.create({
    steps: [
      { id: 'a', anchorId: '#a', message: 'A', onShow: (s) => shown.push(s.id) },
      { id: 'b', anchorId: '#b', message: 'B', onShow: (s) => shown.push(s.id) },
    ],
  });
  t.currentStep(); // pumps a
  t.currentStep(); // no change, a not re-shown
  t.advance();     // a complete; pump b
  t.currentStep(); // no change again
  assert.deepEqual(shown, ['a', 'b']);
});

test('tutorial-flow: onComplete fires per step', () => {
  const completed: string[] = [];
  const t = TutorialFlow.create({
    steps: [
      { id: 'a', anchorId: '#a', message: 'A', onComplete: (s) => completed.push(s.id) },
      { id: 'b', anchorId: '#b', message: 'B', onComplete: (s) => completed.push(s.id) },
    ],
  });
  t.advance();
  t.advance();
  assert.deepEqual(completed, ['a', 'b']);
});

test('tutorial-flow: completeStep fires onComplete', () => {
  const completed: string[] = [];
  const t = TutorialFlow.create({
    steps: [
      { id: 'a', anchorId: '#a', message: 'A', onComplete: (s) => completed.push(s.id) },
      { id: 'b', anchorId: '#b', message: 'B', onComplete: (s) => completed.push(s.id) },
    ],
  });
  t.completeStep('b');
  assert.deepEqual(completed, ['b']);
});

test('tutorial-flow: completeStep for already-complete is idempotent', () => {
  let n = 0;
  const t = TutorialFlow.create({
    steps: [{ id: 'a', anchorId: '#a', message: 'A', onComplete: () => { n++; } }],
  });
  t.completeStep('a');
  t.completeStep('a');
  assert.equal(n, 1);
});

test('tutorial-flow: persist roundtrip', () => {
  let stored: string[] = [];
  const t = TutorialFlow.create({
    steps: makeBasicSteps(),
    persist: { save: (ids) => { stored = ids.slice(); }, load: () => stored },
  });
  t.advance(); // a complete
  t.saveLocal();
  // Fresh flow loads completion.
  const t2 = TutorialFlow.create({
    steps: makeBasicSteps(),
    persist: { save: () => {}, load: () => stored },
  });
  t2.loadLocal();
  assert.equal(t2.currentStep()!.id, 'b');
  assert.ok(t2.isCompleted('a'));
});

test('tutorial-flow: dispose locks ops', () => {
  const t = TutorialFlow.create({ steps: makeBasicSteps() });
  t.dispose();
  assert.equal(t.advance(), false);
  assert.equal(t.completeStep('a'), false);
  assert.equal(t.currentStep(), null);
});

test('tutorial-flow: throwing onShow / onComplete / onStepChanged / onFlowComplete isolated', () => {
  const t = TutorialFlow.create({
    steps: [
      { id: 'a', anchorId: '#a', message: 'A',
        onShow: () => { throw new Error('s'); },
        onComplete: () => { throw new Error('c'); } },
    ],
    onStepChanged: () => { throw new Error('sc'); },
    onFlowComplete: () => { throw new Error('fc'); },
  });
  // Should not throw.
  t.currentStep();
  t.advance();
  assert.ok(t.isComplete());
});

test('tutorial-flow: empty steps array', () => {
  const t = TutorialFlow.create({ steps: [] });
  assert.equal(t.currentStep(), null);
  // skipAll on empty doesn't fire onFlowComplete (no work).
  let fired = 0;
  const t2 = TutorialFlow.create({
    steps: [], onFlowComplete: () => { fired++; },
  });
  t2.skipAll();
  assert.equal(fired, 0);
});

test('tutorial-flow: completedIds returns ids', () => {
  const t = TutorialFlow.create({ steps: makeBasicSteps() });
  t.advance(); t.advance();
  const ids = t.completedIds();
  assert.deepEqual(ids.sort(), ['a', 'b']);
});

test('tutorial-flow: realistic 3-step onboarding with persistence', () => {
  let stored: string[] = [];
  const log: string[] = [];
  const t = TutorialFlow.create({
    steps: [
      { id: 'open-bag', anchorId: '#bag', message: 'Open your bag.' },
      { id: 'equip', anchorId: '#slot', message: 'Drag here.' },
      { id: 'attack', anchorId: '#atk', message: 'Press to attack.' },
    ],
    persist: { save: (ids) => { stored = ids.slice(); }, load: () => stored },
    onStepChanged: (next) => log.push(next?.id ?? 'done'),
  });
  t.currentStep();
  t.advance();
  t.advance();
  t.saveLocal();
  // Restart session.
  const t2 = TutorialFlow.create({
    steps: [
      { id: 'open-bag', anchorId: '#bag', message: 'Open your bag.' },
      { id: 'equip', anchorId: '#slot', message: 'Drag here.' },
      { id: 'attack', anchorId: '#atk', message: 'Press to attack.' },
    ],
    persist: { save: () => {}, load: () => stored },
  });
  t2.loadLocal();
  assert.equal(t2.currentStep()!.id, 'attack');
  t2.advance();
  assert.ok(t2.isComplete());
});

test('tutorial-flow: missing persist tolerated as no-op', () => {
  const t = TutorialFlow.create({ steps: makeBasicSteps() });
  t.saveLocal();
  t.loadLocal();
  assert.equal(t.currentStep()!.id, 'a');
});
