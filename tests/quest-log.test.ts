// Phase 0.63.0 - QuestLog tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  QuestLog,
  RESOURCE_QUEST_LOG,
} from '../src/index.js';

test('quest: RESOURCE_QUEST_LOG is the stable string', () => {
  assert.equal(RESOURCE_QUEST_LOG, 'quest_log');
});

test('quest: starts empty', () => {
  const q = QuestLog.create();
  assert.equal(q.count(), 0);
});

test('quest: offer adds to log in offered state', () => {
  const q = QuestLog.create({ now: () => 100 });
  assert.equal(q.offer('q1', { objectives: [{ id: 'o1', required: 5 }] }), true);
  assert.equal(q.has('q1'), true);
  assert.equal(q.getState('q1'), 'offered');
  assert.equal(q.count('offered'), 1);
});

test('quest: offer is idempotent (no double-add)', () => {
  const q = QuestLog.create();
  q.offer('q1', { objectives: [] });
  assert.equal(q.offer('q1', { objectives: [] }), false);
  assert.equal(q.count(), 1);
});

test('quest: offer ignores empty id', () => {
  const q = QuestLog.create();
  assert.equal(q.offer('', { objectives: [] }), false);
});

test('quest: accept transitions offered -> active', () => {
  const transitions: Array<[string, string, string]> = [];
  const q = QuestLog.create({
    onStateChanged: (id, p, n) => transitions.push([id, p, n]),
  });
  q.offer('q1', { objectives: [{ id: 'o1', required: 1 }] });
  q.accept('q1');
  assert.equal(q.getState('q1'), 'active');
  // offered -> accepted -> active.
  assert.deepEqual(transitions, [
    ['q1', 'offered', 'accepted'],
    ['q1', 'accepted', 'active'],
  ]);
});

test('quest: accept on non-offered returns false', () => {
  const q = QuestLog.create();
  q.offer('q1', { objectives: [{ id: 'o1', required: 1 }] });
  q.accept('q1');
  assert.equal(q.accept('q1'), false);  // already active
  assert.equal(q.accept('missing'), false);
});

test('quest: decline removes the quest', () => {
  const q = QuestLog.create();
  q.offer('q1', { objectives: [] });
  q.decline('q1');
  assert.equal(q.has('q1'), false);
});

test('quest: decline only works on offered', () => {
  const q = QuestLog.create();
  q.offer('q1', { objectives: [{ id: 'o1', required: 1 }] });
  q.accept('q1');
  assert.equal(q.decline('q1'), false);
  assert.equal(q.has('q1'), true);
});

test('quest: addProgress updates objective progress', () => {
  const q = QuestLog.create();
  q.offer('q1', { objectives: [{ id: 'o1', required: 5 }] });
  q.accept('q1');
  q.addProgress('q1', 'o1', 2);
  const e = q.get('q1')!;
  assert.equal(e.objectives[0]!.progress, 2);
  assert.equal(e.objectives[0]!.done, false);
});

test('quest: addProgress caps at required + marks done', () => {
  const q = QuestLog.create();
  q.offer('q1', { objectives: [{ id: 'o1', required: 5 }] });
  q.accept('q1');
  q.addProgress('q1', 'o1', 100);
  const e = q.get('q1')!;
  assert.equal(e.objectives[0]!.progress, 5);
  assert.equal(e.objectives[0]!.done, true);
});

test('quest: completing all objectives auto-completes the quest', () => {
  const q = QuestLog.create();
  q.offer('q1', {
    objectives: [
      { id: 'a', required: 2 },
      { id: 'b', required: 3 },
    ],
  });
  q.accept('q1');
  q.addProgress('q1', 'a', 2);
  // Still active - b not done.
  assert.equal(q.getState('q1'), 'active');
  q.addProgress('q1', 'b', 3);
  // Now both done -> auto-complete.
  assert.equal(q.getState('q1'), 'complete');
});

test('quest: addProgress on non-active quest returns false', () => {
  const q = QuestLog.create();
  q.offer('q1', { objectives: [{ id: 'o1', required: 1 }] });
  // not yet accepted
  assert.equal(q.addProgress('q1', 'o1', 1), false);
});

test('quest: addProgress with missing objective returns false', () => {
  const q = QuestLog.create();
  q.offer('q1', { objectives: [{ id: 'o1', required: 1 }] });
  q.accept('q1');
  assert.equal(q.addProgress('q1', 'missing', 1), false);
});

test('quest: addProgress with 0 / negative returns false', () => {
  const q = QuestLog.create();
  q.offer('q1', { objectives: [{ id: 'o1', required: 5 }] });
  q.accept('q1');
  assert.equal(q.addProgress('q1', 'o1', 0), false);
  assert.equal(q.addProgress('q1', 'o1', -3), false);
});

test('quest: addProgress on done objective returns false', () => {
  const q = QuestLog.create();
  q.offer('q1', { objectives: [{ id: 'o1', required: 1 }] });
  q.accept('q1');
  q.addProgress('q1', 'o1', 1); // done
  assert.equal(q.addProgress('q1', 'o1', 1), false);
});

test('quest: onObjectiveProgress fires with current progress + required', () => {
  const log: Array<[string, number, number]> = [];
  const q = QuestLog.create({
    onObjectiveProgress: (qid, oid, p, r) => log.push([oid, p, r]),
  });
  q.offer('q1', { objectives: [{ id: 'o1', required: 3 }] });
  q.accept('q1');
  q.addProgress('q1', 'o1', 1);
  q.addProgress('q1', 'o1', 1);
  q.addProgress('q1', 'o1', 1);
  assert.deepEqual(log, [['o1', 1, 3], ['o1', 2, 3], ['o1', 3, 3]]);
});

test('quest: fail transitions accepted/active -> failed', () => {
  const q = QuestLog.create();
  q.offer('q1', { objectives: [{ id: 'o', required: 1 }] });
  q.accept('q1');
  assert.equal(q.fail('q1'), true);
  assert.equal(q.getState('q1'), 'failed');
});

test('quest: fail on offered/complete/failed returns false', () => {
  const q = QuestLog.create();
  q.offer('q1', { objectives: [] });
  assert.equal(q.fail('q1'), false);  // offered
  q.accept('q1');
  q.fail('q1');
  assert.equal(q.fail('q1'), false);  // already failed
});

test('quest: complete force-completes from active state', () => {
  const q = QuestLog.create();
  q.offer('q1', { objectives: [{ id: 'a', required: 5 }] });
  q.accept('q1');
  q.addProgress('q1', 'a', 1);
  assert.equal(q.complete('q1'), true);
  assert.equal(q.getState('q1'), 'complete');
  // Objective got force-marked done.
  const e = q.get('q1')!;
  assert.equal(e.objectives[0]!.done, true);
  assert.equal(e.objectives[0]!.progress, 5);
});

test('quest: complete only works on active', () => {
  const q = QuestLog.create();
  q.offer('q1', { objectives: [] });
  assert.equal(q.complete('q1'), false);  // offered
});

test('quest: list filters by state', () => {
  const q = QuestLog.create();
  q.offer('a', { objectives: [{ id: 'x', required: 1 }] });
  q.offer('b', { objectives: [{ id: 'x', required: 1 }] });
  q.accept('a');
  assert.deepEqual(q.listIds('offered').sort(), ['b']);
  assert.deepEqual(q.listIds('active').sort(), ['a']);
  assert.deepEqual(q.listIds().sort(), ['a', 'b']);
});

test('quest: count filters by state', () => {
  const q = QuestLog.create();
  q.offer('a', { objectives: [{ id: 'x', required: 1 }] });
  q.offer('b', { objectives: [{ id: 'x', required: 1 }] });
  q.accept('a');
  assert.equal(q.count(), 2);
  assert.equal(q.count('offered'), 1);
  assert.equal(q.count('active'), 1);
});

test('quest: get returns a defensive copy', () => {
  const q = QuestLog.create();
  q.offer('q1', { objectives: [{ id: 'o1', required: 5 }] });
  const e1 = q.get('q1')!;
  e1.objectives[0]!.progress = 999;
  const e2 = q.get('q1')!;
  assert.equal(e2.objectives[0]!.progress, 0);
});

test('quest: snapshot + fromSnapshot roundtrip', () => {
  const q = QuestLog.create();
  q.offer('a', { objectives: [{ id: 'x', required: 5 }] });
  q.accept('a');
  q.addProgress('a', 'x', 3);
  const snap = q.toSnapshot();
  const q2 = QuestLog.create();
  q2.fromSnapshot(snap);
  assert.equal(q2.getState('a'), 'active');
  assert.equal(q2.get('a')!.objectives[0]!.progress, 3);
});

test('quest: dispose locks ops', () => {
  const q = QuestLog.create();
  q.offer('q1', { objectives: [{ id: 'a', required: 1 }] });
  q.dispose();
  assert.equal(q.offer('q2', { objectives: [] }), false);
  assert.equal(q.addProgress('q1', 'a', 1), false);
});

test('quest: throwing onStateChanged isolated', () => {
  const q = QuestLog.create({
    onStateChanged: () => { throw new Error('boom'); },
  });
  q.offer('q1', { objectives: [{ id: 'a', required: 1 }] });
  q.accept('q1');
  assert.equal(q.getState('q1'), 'active');
});
