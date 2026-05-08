// Phase 0.51.0 - StateMachine tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  StateMachine,
  RESOURCE_STATE_MACHINE,
} from '../src/index.js';

test('state-machine: RESOURCE_STATE_MACHINE is the stable string', () => {
  assert.equal(RESOURCE_STATE_MACHINE, 'state_machine');
});

test('state-machine: requires initial state', () => {
  assert.throws(
    () => StateMachine.create({ initial: '', states: {} }),
    /initial state required/,
  );
});

test('state-machine: initial state must exist in states map', () => {
  assert.throws(
    () => StateMachine.create({ initial: 'nope', states: { a: {} } }),
    /not in states map/,
  );
});

test('state-machine: starts in the initial state', () => {
  const fsm = StateMachine.create({
    initial: 'idle',
    states: { idle: {}, walking: {} },
  });
  assert.equal(fsm.state(), 'idle');
  assert.equal(fsm.is('idle'), true);
  assert.equal(fsm.is('walking'), false);
});

test('state-machine: fireInitialEnter fires onEnter for the initial state', () => {
  let fired: string | null | undefined;
  const fsm = StateMachine.create({
    initial: 'idle',
    states: {
      idle: {
        onEnter: (from) => { fired = from; },
      },
    },
    fireInitialEnter: true,
  });
  assert.ok(fsm.state() === 'idle');
  assert.equal(fired, null);
});

test('state-machine: by default initial onEnter does NOT fire', () => {
  let fired = false;
  StateMachine.create({
    initial: 'idle',
    states: { idle: { onEnter: () => { fired = true; } } },
  });
  assert.equal(fired, false);
});

test('state-machine: transition fires onExit then onEnter', () => {
  const seq: string[] = [];
  const fsm = StateMachine.create({
    initial: 'idle',
    states: {
      idle:    { onExit: (to) => seq.push('idle.exit->' + to) },
      walking: { onEnter: (from) => seq.push('walking.enter<-' + from) },
    },
  });
  assert.equal(fsm.transition('walking'), true);
  assert.equal(fsm.state(), 'walking');
  assert.deepEqual(seq, ['idle.exit->walking', 'walking.enter<-idle']);
});

test('state-machine: transition to unknown state returns false', () => {
  const fsm = StateMachine.create({
    initial: 'a',
    states: { a: {}, b: {} },
  });
  assert.equal(fsm.transition('c'), false);
  assert.equal(fsm.state(), 'a');
});

test('state-machine: transition to current state returns false (no-op)', () => {
  let exitFired = false;
  const fsm = StateMachine.create({
    initial: 'a',
    states: { a: { onExit: () => { exitFired = true; } } },
  });
  assert.equal(fsm.transition('a'), false);
  assert.equal(exitFired, false);
});

test('state-machine: transitions map enforces allowed targets', () => {
  const fsm = StateMachine.create({
    initial: 'idle',
    states: { idle: {}, walking: {}, jumping: {} },
    transitions: {
      idle: ['walking'],          // can only walk from idle (not jump)
      walking: ['idle', 'jumping'],
      jumping: ['idle'],
    },
  });
  assert.equal(fsm.canTransition('walking'), true);
  assert.equal(fsm.canTransition('jumping'), false);
  assert.equal(fsm.transition('jumping'), false);
  assert.equal(fsm.state(), 'idle');
  assert.equal(fsm.transition('walking'), true);
  assert.equal(fsm.transition('jumping'), true);
  assert.equal(fsm.state(), 'jumping');
});

test('state-machine: missing transitions entry allows ALL targets', () => {
  const fsm = StateMachine.create({
    initial: 'a',
    states: { a: {}, b: {}, c: {} },
    transitions: {
      a: ['b'],   // a is restricted
      // b has no entry -> b can go anywhere
    },
  });
  fsm.transition('b');
  assert.equal(fsm.canTransition('a'), true);
  assert.equal(fsm.canTransition('c'), true);
});

test('state-machine: no transitions map at all = unrestricted', () => {
  const fsm = StateMachine.create({
    initial: 'a',
    states: { a: {}, b: {}, c: {} },
  });
  assert.equal(fsm.transition('c'), true);
  assert.equal(fsm.state(), 'c');
});

test('state-machine: onTransition fires after success', () => {
  const log: string[] = [];
  const fsm = StateMachine.create({
    initial: 'a',
    states: { a: {}, b: {} },
    onTransition: (from, to) => log.push(from + '->' + to),
  });
  fsm.transition('b');
  assert.deepEqual(log, ['a->b']);
});

test('state-machine: onTransition does NOT fire on rejected transition', () => {
  const log: string[] = [];
  const fsm = StateMachine.create({
    initial: 'a',
    states: { a: {}, b: {} },
    transitions: { a: ['b'] },
    onTransition: (from, to) => log.push(from + '->' + to),
  });
  // Already rejected: same state.
  fsm.transition('a');
  assert.deepEqual(log, []);
});

test('state-machine: update fires current state onUpdate with dtMs', () => {
  let captured = -1;
  const fsm = StateMachine.create({
    initial: 'a',
    states: { a: { onUpdate: (dt) => { captured = dt; } } },
  });
  fsm.update(16.67);
  assert.equal(captured, 16.67);
});

test('state-machine: update on state without onUpdate is a safe no-op', () => {
  const fsm = StateMachine.create({
    initial: 'a',
    states: { a: {} },
  });
  fsm.update(16);
  // Just shouldn't throw.
  assert.equal(fsm.state(), 'a');
});

test('state-machine: update with NaN / negative dt is ignored', () => {
  let calls = 0;
  const fsm = StateMachine.create({
    initial: 'a',
    states: { a: { onUpdate: () => calls++ } },
  });
  fsm.update(NaN);
  fsm.update(-5);
  assert.equal(calls, 0);
});

test('state-machine: forceState bypasses transitions + onEnter/onExit', () => {
  let exitCount = 0;
  let enterCount = 0;
  const fsm = StateMachine.create({
    initial: 'a',
    states: {
      a: { onExit: () => exitCount++ },
      b: { onEnter: () => enterCount++ },
    },
    transitions: { a: [] },  // a -> b normally rejected
  });
  assert.equal(fsm.transition('b'), false);
  assert.equal(fsm.forceState('b'), true);
  assert.equal(fsm.state(), 'b');
  assert.equal(exitCount, 0);
  assert.equal(enterCount, 0);
});

test('state-machine: forceState rejects unknown state', () => {
  const fsm = StateMachine.create({
    initial: 'a',
    states: { a: {} },
  });
  assert.equal(fsm.forceState('nope'), false);
  assert.equal(fsm.state(), 'a');
});

test('state-machine: throwing onEnter / onExit / onUpdate is isolated', () => {
  const fsm = StateMachine.create({
    initial: 'a',
    states: {
      a: {
        onExit: () => { throw new Error('ax'); },
        onUpdate: () => { throw new Error('au'); },
      },
      b: {
        onEnter: () => { throw new Error('be'); },
      },
    },
  });
  // None of these should propagate.
  fsm.update(1);
  fsm.transition('b');
  assert.equal(fsm.state(), 'b');
});

test('state-machine: stateNames lists all defined states', () => {
  const fsm = StateMachine.create({
    initial: 'a',
    states: { a: {}, b: {}, c: {} },
  });
  assert.deepEqual(fsm.stateNames().sort(), ['a', 'b', 'c']);
});

test('state-machine: dispose makes operations no-op', () => {
  const fsm = StateMachine.create({
    initial: 'a',
    states: { a: {}, b: {} },
  });
  fsm.dispose();
  assert.equal(fsm.transition('b'), false);
  assert.equal(fsm.canTransition('b'), false);
  assert.equal(fsm.forceState('b'), false);
});

test('state-machine: realistic example - boss lifecycle', () => {
  const events: string[] = [];
  const fsm = StateMachine.create({
    initial: 'offline',
    states: {
      offline:  { onEnter: () => events.push('offline') },
      spawning: { onEnter: () => events.push('spawn-cinematic') },
      alive:    { onEnter: () => events.push('combat-start') },
      dying:    { onEnter: () => events.push('death-cinematic') },
      dead:     { onEnter: () => events.push('drops + cleanup') },
    },
    transitions: {
      offline:  ['spawning'],
      spawning: ['alive'],
      alive:    ['dying'],
      dying:    ['dead'],
      dead:     ['offline'],  // respawn
    },
  });
  fsm.transition('spawning');
  fsm.transition('alive');
  fsm.transition('dying');
  fsm.transition('dead');
  fsm.transition('offline');
  assert.deepEqual(events, [
    'spawn-cinematic',
    'combat-start',
    'death-cinematic',
    'drops + cleanup',
    'offline',
  ]);
});
