// Phase 0.56.0 - SceneManager tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  SceneManager,
  RESOURCE_SCENE_MANAGER,
} from '../src/index.js';

test('scene-manager: RESOURCE_SCENE_MANAGER is the stable string', () => {
  assert.equal(RESOURCE_SCENE_MANAGER, 'scene_manager');
});

test('scene-manager: starts idle with no current scene', () => {
  const sm = SceneManager.create();
  assert.equal(sm.current(), null);
  assert.equal(sm.getStatus(), 'idle');
});

test('scene-manager: register + has + sceneNames', () => {
  const sm = SceneManager.create();
  sm.register('title', {});
  sm.register('game', {});
  assert.equal(sm.has('title'), true);
  assert.equal(sm.has('missing'), false);
  assert.deepEqual(sm.sceneNames().sort(), ['game', 'title']);
});

test('scene-manager: register ignores empty name + falsy config', () => {
  const sm = SceneManager.create();
  sm.register('', {});
  // @ts-expect-error - testing runtime guard
  sm.register('x', null);
  assert.equal(sm.has(''), false);
  assert.equal(sm.has('x'), false);
});

test('scene-manager: transitionTo activates scene', async () => {
  const sm = SceneManager.create();
  sm.register('title', {});
  await sm.transitionTo('title');
  assert.equal(sm.current(), 'title');
  assert.equal(sm.getStatus(), 'active');
});

test('scene-manager: transitionTo unknown scene rejects', async () => {
  const sm = SceneManager.create();
  await assert.rejects(() => sm.transitionTo('nope'), /unknown scene/);
});

test('scene-manager: same-scene transition is a no-op success', async () => {
  let entered = 0;
  const sm = SceneManager.create();
  sm.register('title', { onEnter: () => { entered++; } });
  await sm.transitionTo('title');
  await sm.transitionTo('title');
  assert.equal(entered, 1);
});

test('scene-manager: onEnter called with params', async () => {
  let captured: unknown = null;
  const sm = SceneManager.create();
  sm.register('game', {
    onEnter: (p) => { captured = p; },
  });
  await sm.transitionTo('game', { difficulty: 'hard' });
  assert.deepEqual(captured, { difficulty: 'hard' });
});

test('scene-manager: async onEnter awaited; status = entering during', async () => {
  let resolveEnter: (() => void) | null = null;
  const sm = SceneManager.create();
  sm.register('loading', {
    onEnter: () => new Promise<void>((resolve) => { resolveEnter = resolve; }),
  });
  const p = sm.transitionTo('loading');
  // Give the event loop a tick so onEnter has been called.
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sm.getStatus(), 'entering');
  assert.equal(sm.isTransitioning(), true);
  if (resolveEnter) (resolveEnter as () => void)();
  await p;
  assert.equal(sm.getStatus(), 'active');
});

test('scene-manager: onExit fires when transitioning away', async () => {
  const events: string[] = [];
  const sm = SceneManager.create();
  sm.register('a', { onExit: () => { events.push('a.exit'); } });
  sm.register('b', { onEnter: () => { events.push('b.enter'); } });
  await sm.transitionTo('a');
  await sm.transitionTo('b');
  assert.deepEqual(events, ['a.exit', 'b.enter']);
});

test('scene-manager: onSceneEntered + onSceneExited callbacks fire', async () => {
  const log: string[] = [];
  const sm = SceneManager.create({
    onSceneEntered: (n) => log.push('entered:' + n),
    onSceneExited: (n) => log.push('exited:' + n),
  });
  sm.register('a', {});
  sm.register('b', {});
  await sm.transitionTo('a');
  await sm.transitionTo('b');
  assert.deepEqual(log, ['entered:a', 'exited:a', 'entered:b']);
});

test('scene-manager: onTransitionStart fires before onEnter resolves', async () => {
  const log: string[] = [];
  const sm = SceneManager.create({
    onTransitionStart: (from, to) => log.push('start:' + from + '->' + to),
  });
  sm.register('a', {});
  sm.register('b', {});
  await sm.transitionTo('a');
  await sm.transitionTo('b');
  assert.deepEqual(log, ['start:null->a', 'start:a->b']);
});

test('scene-manager: failed onEnter rejects + fires onTransitionError', async () => {
  let errSeen: unknown = null;
  const sm = SceneManager.create({
    onTransitionError: (_to, e) => { errSeen = e; },
  });
  sm.register('boom', {
    onEnter: () => { throw new Error('failed-load'); },
  });
  await assert.rejects(() => sm.transitionTo('boom'), /failed-load/);
  assert.equal(sm.current(), null);
  assert.equal(sm.getStatus(), 'idle');
  assert.equal((errSeen as Error).message, 'failed-load');
});

test('scene-manager: throwing onExit does not block transition', async () => {
  const sm = SceneManager.create();
  sm.register('a', { onExit: () => { throw new Error('a-exit'); } });
  sm.register('b', {});
  await sm.transitionTo('a');
  // Should not throw.
  await sm.transitionTo('b');
  assert.equal(sm.current(), 'b');
});

test('scene-manager: concurrent transition rejects with in-flight error', async () => {
  let resolveEnter: (() => void) | null = null;
  const sm = SceneManager.create();
  sm.register('slow', {
    onEnter: () => new Promise<void>((r) => { resolveEnter = r; }),
  });
  sm.register('fast', {});
  const p1 = sm.transitionTo('slow');
  await new Promise((r) => setTimeout(r, 0));
  // While slow is transitioning, fast should reject.
  await assert.rejects(() => sm.transitionTo('fast'), /transition in flight/);
  if (resolveEnter) (resolveEnter as () => void)();
  await p1;
});

test('scene-manager: update calls active scene onUpdate', async () => {
  let calls = 0;
  let lastDt = -1;
  const sm = SceneManager.create();
  sm.register('a', { onUpdate: (dt) => { calls++; lastDt = dt; } });
  await sm.transitionTo('a');
  sm.update(16.67);
  assert.equal(calls, 1);
  assert.equal(lastDt, 16.67);
});

test('scene-manager: update no-op while not active', async () => {
  let calls = 0;
  const sm = SceneManager.create();
  sm.register('a', { onUpdate: () => calls++ });
  // Idle - no update.
  sm.update(16);
  assert.equal(calls, 0);
});

test('scene-manager: NaN / negative dt ignored in update', async () => {
  let calls = 0;
  const sm = SceneManager.create();
  sm.register('a', { onUpdate: () => calls++ });
  await sm.transitionTo('a');
  sm.update(NaN);
  sm.update(-5);
  assert.equal(calls, 0);
});

test('scene-manager: leave returns to idle + fires onExit', async () => {
  let exited = false;
  const sm = SceneManager.create();
  sm.register('a', { onExit: () => { exited = true; } });
  await sm.transitionTo('a');
  await sm.leave();
  assert.equal(sm.current(), null);
  assert.equal(sm.getStatus(), 'idle');
  assert.equal(exited, true);
});

test('scene-manager: leave on idle is a safe no-op', async () => {
  const sm = SceneManager.create();
  await sm.leave();
  assert.equal(sm.current(), null);
});

test('scene-manager: unregister active scene returns to idle without onExit', async () => {
  let exited = false;
  const sm = SceneManager.create();
  sm.register('a', { onExit: () => { exited = true; } });
  await sm.transitionTo('a');
  sm.unregister('a');
  assert.equal(sm.current(), null);
  assert.equal(exited, false); // unregister bypasses onExit
});

test('scene-manager: dispose locks subsequent ops', async () => {
  const sm = SceneManager.create();
  sm.register('a', {});
  await sm.transitionTo('a');
  sm.dispose();
  await assert.rejects(() => sm.transitionTo('a'), /disposed/);
  assert.equal(sm.current(), null);
});

test('scene-manager: realistic example - title -> game -> over', async () => {
  const log: string[] = [];
  const sm = SceneManager.create({
    onSceneEntered: (n) => log.push('+' + n),
    onSceneExited: (n) => log.push('-' + n),
  });
  sm.register('title', {});
  sm.register('game', {});
  sm.register('gameOver', {});
  await sm.transitionTo('title');
  await sm.transitionTo('game');
  await sm.transitionTo('gameOver');
  await sm.leave();
  assert.deepEqual(log, [
    '+title', '-title',
    '+game', '-game',
    '+gameOver', '-gameOver',
  ]);
});

test('scene-manager: re-registering replaces config; next exit uses new config', async () => {
  const log: string[] = [];
  const sm = SceneManager.create();
  sm.register('a', { onExit: () => { log.push('a-v1.exit'); } });
  await sm.transitionTo('a');
  // Replace 'a' with a new config; the manager looks up by name
  // at transition time, so the new onExit fires.
  sm.register('a', { onExit: () => { log.push('a-v2.exit'); } });
  sm.register('b', {});
  await sm.transitionTo('b');
  assert.deepEqual(log, ['a-v2.exit']);
});
