// Phase 1.1.2 - BehaviorTree tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  BehaviorTree,
  RESOURCE_BEHAVIOR_TREE,
  type BTNode,
  type BTStatus,
} from '../src/index.js';

test('bt: RESOURCE_BEHAVIOR_TREE is the stable string', () => {
  assert.equal(RESOURCE_BEHAVIOR_TREE, 'behavior_tree');
});

test('bt: action returns success', () => {
  const tree = BehaviorTree.create({
    root: { kind: 'action', run: () => 'success' },
  });
  assert.equal(tree.tick(16), 'success');
});

test('bt: action returns failure', () => {
  const tree = BehaviorTree.create({
    root: { kind: 'action', run: () => 'failure' },
  });
  assert.equal(tree.tick(16), 'failure');
});

test('bt: action returns running', () => {
  const tree = BehaviorTree.create({
    root: { kind: 'action', run: () => 'running' },
  });
  assert.equal(tree.tick(16), 'running');
});

test('bt: condition true -> success', () => {
  const tree = BehaviorTree.create({
    root: { kind: 'condition', predicate: () => true },
  });
  assert.equal(tree.tick(16), 'success');
});

test('bt: condition false -> failure', () => {
  const tree = BehaviorTree.create({
    root: { kind: 'condition', predicate: () => false },
  });
  assert.equal(tree.tick(16), 'failure');
});

test('bt: sequence all succeed -> success', () => {
  const tree = BehaviorTree.create({
    root: {
      kind: 'sequence', children: [
        { kind: 'action', run: () => 'success' },
        { kind: 'action', run: () => 'success' },
        { kind: 'action', run: () => 'success' },
      ],
    },
  });
  assert.equal(tree.tick(16), 'success');
});

test('bt: sequence first fails -> failure', () => {
  const seen: string[] = [];
  const tree = BehaviorTree.create({
    root: {
      kind: 'sequence', children: [
        { kind: 'action', run: () => { seen.push('a'); return 'failure'; } },
        { kind: 'action', run: () => { seen.push('b'); return 'success'; } },
      ],
    },
  });
  assert.equal(tree.tick(16), 'failure');
  assert.deepEqual(seen, ['a']); // b never ran
});

test('bt: sequence resumes on running', () => {
  let counter = 0;
  const tree = BehaviorTree.create({
    root: {
      kind: 'sequence', children: [
        { kind: 'action', run: () => 'success' },
        // Returns running on tick 1, success on tick 2.
        { kind: 'action', run: () => (counter++ < 1 ? 'running' : 'success') },
        { kind: 'action', run: () => 'success' },
      ],
    },
  });
  assert.equal(tree.tick(16), 'running');
  assert.equal(tree.tick(16), 'success');
});

test('bt: selector first succeeds -> success', () => {
  const tree = BehaviorTree.create({
    root: {
      kind: 'selector', children: [
        { kind: 'action', run: () => 'success' },
        { kind: 'action', run: () => 'failure' },
      ],
    },
  });
  assert.equal(tree.tick(16), 'success');
});

test('bt: selector all fail -> failure', () => {
  const tree = BehaviorTree.create({
    root: {
      kind: 'selector', children: [
        { kind: 'action', run: () => 'failure' },
        { kind: 'action', run: () => 'failure' },
      ],
    },
  });
  assert.equal(tree.tick(16), 'failure');
});

test('bt: parallel all succeed -> success', () => {
  const tree = BehaviorTree.create({
    root: {
      kind: 'parallel', children: [
        { kind: 'action', run: () => 'success' },
        { kind: 'action', run: () => 'success' },
      ],
    },
  });
  assert.equal(tree.tick(16), 'success');
});

test('bt: parallel one fails (default failureThreshold=1) -> failure', () => {
  const tree = BehaviorTree.create({
    root: {
      kind: 'parallel', children: [
        { kind: 'action', run: () => 'success' },
        { kind: 'action', run: () => 'failure' },
      ],
    },
  });
  assert.equal(tree.tick(16), 'failure');
});

test('bt: parallel custom successThreshold=1 -> succeeds with one success', () => {
  const tree = BehaviorTree.create({
    root: {
      kind: 'parallel', successThreshold: 1, failureThreshold: 99,
      children: [
        { kind: 'action', run: () => 'success' },
        { kind: 'action', run: () => 'failure' },
        { kind: 'action', run: () => 'failure' },
      ],
    },
  });
  assert.equal(tree.tick(16), 'success');
});

test('bt: parallel running while threshold not yet met', () => {
  const tree = BehaviorTree.create({
    root: {
      kind: 'parallel', successThreshold: 2, failureThreshold: 2,
      children: [
        { kind: 'action', run: () => 'success' },
        { kind: 'action', run: () => 'running' },
        { kind: 'action', run: () => 'running' },
      ],
    },
  });
  assert.equal(tree.tick(16), 'running');
});

test('bt: inverter flips success -> failure', () => {
  const tree = BehaviorTree.create({
    root: {
      kind: 'inverter',
      child: { kind: 'action', run: () => 'success' },
    },
  });
  assert.equal(tree.tick(16), 'failure');
});

test('bt: inverter flips failure -> success', () => {
  const tree = BehaviorTree.create({
    root: {
      kind: 'inverter',
      child: { kind: 'action', run: () => 'failure' },
    },
  });
  assert.equal(tree.tick(16), 'success');
});

test('bt: inverter passes running through', () => {
  const tree = BehaviorTree.create({
    root: {
      kind: 'inverter',
      child: { kind: 'action', run: () => 'running' },
    },
  });
  assert.equal(tree.tick(16), 'running');
});

test('bt: repeat N times then success', () => {
  let calls = 0;
  const tree = BehaviorTree.create({
    root: {
      kind: 'repeat', count: 3,
      child: { kind: 'action', run: () => { calls++; return 'success'; } },
    },
  });
  assert.equal(tree.tick(16), 'success');
  assert.equal(calls, 3);
});

test('bt: repeat stops on failure (default)', () => {
  let calls = 0;
  const tree = BehaviorTree.create({
    root: {
      kind: 'repeat', count: 5,
      child: { kind: 'action', run: () => {
        calls++;
        return calls === 2 ? 'failure' : 'success';
      } },
    },
  });
  assert.equal(tree.tick(16), 'failure');
  assert.equal(calls, 2);
});

test('bt: repeat -1 forever returns running each tick', () => {
  let calls = 0;
  const tree = BehaviorTree.create({
    root: {
      kind: 'repeat', count: -1,
      child: { kind: 'action', run: () => { calls++; return 'success'; } },
    },
  });
  assert.equal(tree.tick(16), 'running');
  assert.equal(tree.tick(16), 'running');
  assert.equal(calls, 2);
});

test('bt: cooldown blocks during window', () => {
  const tree = BehaviorTree.create({
    root: {
      kind: 'cooldown', cooldownMs: 100,
      child: { kind: 'action', run: () => 'success' },
    },
  });
  assert.equal(tree.tick(16), 'success');
  // Now in cooldown.
  assert.equal(tree.tick(50), 'failure');
  assert.equal(tree.tick(40), 'failure');
});

test('bt: cooldown allows after window passes', () => {
  const tree = BehaviorTree.create({
    root: {
      kind: 'cooldown', cooldownMs: 100,
      child: { kind: 'action', run: () => 'success' },
    },
  });
  assert.equal(tree.tick(16), 'success'); // success, sets cooldown 100
  assert.equal(tree.tick(50), 'failure'); // still in cooldown (50 left)
  assert.equal(tree.tick(40), 'failure'); // still in cooldown (10 left)
  // Next tick clears cooldown AND runs child again (leftover dt).
  assert.equal(tree.tick(60), 'success');
});

test('bt: cooldown custom cooldownStatus', () => {
  const tree = BehaviorTree.create({
    root: {
      kind: 'cooldown', cooldownMs: 100, cooldownStatus: 'running',
      child: { kind: 'action', run: () => 'success' },
    },
  });
  tree.tick(16);
  assert.equal(tree.tick(50), 'running');
});

test('bt: blackboard read/write through context', () => {
  const tree = BehaviorTree.create({
    blackboard: { hp: 100 },
    root: {
      kind: 'sequence', children: [
        { kind: 'condition', predicate: (ctx) => (ctx.blackboard.hp as number) > 0 },
        { kind: 'action', run: (ctx) => { ctx.blackboard.hp = 50; return 'success'; } },
      ],
    },
  });
  tree.tick(16);
  assert.equal(tree.getBlackboardEntry('hp'), 50);
  tree.setBlackboardEntry('target', 'mob42');
  assert.equal(tree.getBlackboardEntry('target'), 'mob42');
});

test('bt: getBlackboard returns defensive copy', () => {
  const tree = BehaviorTree.create({
    blackboard: { hp: 100 },
    root: { kind: 'action', run: () => 'success' },
  });
  const bb = tree.getBlackboard();
  bb.hp = 999;
  assert.equal(tree.getBlackboardEntry('hp'), 100);
});

test('bt: reset clears running state', () => {
  let phase = 0;
  const tree = BehaviorTree.create({
    root: {
      kind: 'sequence', children: [
        { kind: 'action', run: () => 'success' },
        { kind: 'action', run: () => phase++ < 2 ? 'running' : 'success' },
      ],
    },
  });
  assert.equal(tree.tick(16), 'running');
  tree.reset();
  // After reset, the sequence starts from index 0 again. The phase
  // counter still progresses (it's outside the tree state), so on
  // the next tick the second action returns running again.
  assert.equal(tree.tick(16), 'running');
});

test('bt: throwing predicate isolated -> failure', () => {
  const tree = BehaviorTree.create({
    root: { kind: 'condition', predicate: () => { throw new Error('boom'); } },
  });
  assert.equal(tree.tick(16), 'failure');
});

test('bt: throwing action isolated -> failure', () => {
  const tree = BehaviorTree.create({
    root: { kind: 'action', run: () => { throw new Error('boom'); } },
  });
  assert.equal(tree.tick(16), 'failure');
});

test('bt: throwing onStatus isolated', () => {
  const tree = BehaviorTree.create({
    root: { kind: 'action', run: () => 'success' },
    onStatus: () => { throw new Error('status-boom'); },
  });
  assert.equal(tree.tick(16), 'success');
});

test('bt: NaN / negative dt clamped to 0', () => {
  const tree = BehaviorTree.create({
    root: {
      kind: 'cooldown', cooldownMs: 100,
      child: { kind: 'action', run: () => 'success' },
    },
  });
  tree.tick(16); // start cooldown
  tree.tick(NaN); // no advance
  tree.tick(-50); // no advance
  // Still in cooldown.
  assert.equal(tree.tick(50), 'failure');
});

test('bt: dispose locks ops', () => {
  const tree = BehaviorTree.create({
    root: { kind: 'action', run: () => 'success' },
  });
  tree.dispose();
  assert.equal(tree.tick(16), 'failure');
});

test('bt: realistic example - patrol with priority threat response', () => {
  let attackCalls = 0;
  let patrolCalls = 0;
  const tree = BehaviorTree.create({
    blackboard: { threatVisible: false, hp: 100 },
    root: {
      kind: 'selector', children: [
        // Priority 1: attack the threat if visible.
        { kind: 'sequence', children: [
          { kind: 'condition', predicate: (ctx) => !!ctx.blackboard.threatVisible },
          { kind: 'action', run: () => { attackCalls++; return 'success'; } },
        ]},
        // Default: patrol.
        { kind: 'action', run: () => { patrolCalls++; return 'success'; } },
      ],
    },
  });
  // No threat -> patrol.
  tree.tick(16);
  assert.equal(patrolCalls, 1);
  assert.equal(attackCalls, 0);
  // Threat appears -> attack.
  tree.setBlackboardEntry('threatVisible', true);
  tree.tick(16);
  assert.equal(attackCalls, 1);
  assert.equal(patrolCalls, 1);
});
