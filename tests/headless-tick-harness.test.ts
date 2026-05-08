// Loom Engine - headless tick harness self-test.
//
// Boots the harness, spawns 3 transformed entities, drives 60 ticks
// with a tiny logic system that mutates positions deterministically,
// asserts the resulting state matches a hand-computed expected value.
// This is the smoke test that future trace-replay + fuzzer test files
// rely on; if it fails, neither of them will work.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { createHeadlessTicker } from './headless-tick-harness.js';
import {
  POOL_TRANSFORM,
  TransformPool,
  SYSTEM_PHASE_LOGIC,
  RESOURCE_TIME,
  type TimeResource,
  type World,
  type System,
  entityIndex,
} from '../src/index.js';

test('headless harness: boots with default pools + resources', () => {
  const t = createHeadlessTicker();
  const w = t.getWorld();
  assert.ok(w.getPool(POOL_TRANSFORM), 'transform pool registered');
  assert.equal(w.countEntities(), 0);
  assert.equal(w.countSystems(), 0);
  // TimeResource is wired and starts at zero.
  const time = w.resources.require<TimeResource>(RESOURCE_TIME);
  assert.equal(time.frame, 0);
  assert.equal(time.elapsed, 0);
});

test('headless harness: tick advances time deterministically', () => {
  const t = createHeadlessTicker({ tps: 60 });
  const time = t.getWorld().resources.require<TimeResource>(RESOURCE_TIME);
  t.tick(60);
  assert.equal(time.frame, 60);
  // 60 ticks at 1/60s each = 1.0s. Floating point can drift; allow
  // tiny epsilon.
  assert.ok(Math.abs(time.elapsed - 1.0) < 1e-9, 'elapsed ~= 1.0s');
  assert.equal(t.getFrame(), 60);
});

test('headless harness: spawn 3 entities, run 60 ticks, assert deterministic state', () => {
  const t = createHeadlessTicker({ tps: 60 });
  const w = t.getWorld();
  const transforms = w.getPool<TransformPool>(POOL_TRANSFORM);
  assert.ok(transforms);

  // Spawn 3 entities at staggered positions.
  const e0 = w.createEntity();
  const e1 = w.createEntity();
  const e2 = w.createEntity();
  transforms.attach(e0, 0, 0, 0);
  transforms.attach(e1, 10, 0, 0);
  transforms.attach(e2, 20, 0, 0);

  // Pure-logic mover: each tick, every transform moves +1 on x.
  // Deterministic because dt is fixed and no Math.random() is touched.
  let observedFrames = 0;
  const ids = [e0, e1, e2];
  const mover: System = {
    name: 'test-mover',
    update(world: World, dt: number) {
      observedFrames += 1;
      const tp = world.getPool<TransformPool>(POOL_TRANSFORM);
      if (!tp) return;
      for (let i = 0; i < ids.length; i++) {
        const idx = entityIndex(ids[i]!);
        // 60 * dt yields exactly +1 per tick at tps=60.
        tp.x[idx] = (tp.x[idx] ?? 0) + 60 * dt;
      }
    },
  };
  t.addSystem(mover, SYSTEM_PHASE_LOGIC);

  t.tick(60);

  assert.equal(observedFrames, 60);
  // Hand-computed expected positions: starting + 60*1 = +60.
  assert.equal(transforms.x[entityIndex(e0)], 60);
  assert.equal(transforms.x[entityIndex(e1)], 70);
  assert.equal(transforms.x[entityIndex(e2)], 80);
});

test('headless harness: reset() rebuilds world and re-registers systems', () => {
  const t = createHeadlessTicker({ tps: 30 });
  let frames = 0;
  const counter: System = {
    name: 'counter',
    update() { frames += 1; },
  };
  t.addSystem(counter, SYSTEM_PHASE_LOGIC);

  t.tick(10);
  assert.equal(frames, 10);
  assert.equal(t.getFrame(), 10);

  t.reset();
  // Fresh world, but the system is still registered.
  assert.equal(t.getFrame(), 0);
  assert.equal(t.getWorld().resources.require<TimeResource>(RESOURCE_TIME).frame, 0);

  t.tick(5);
  assert.equal(frames, 15, 'system survived reset and continued counting');
  assert.equal(t.getFrame(), 5);
});

test('headless harness: getDeltaSeconds reflects tps option', () => {
  const a = createHeadlessTicker({ tps: 60 });
  const b = createHeadlessTicker({ tps: 30 });
  assert.ok(Math.abs(a.getDeltaSeconds() - 1 / 60) < 1e-12);
  assert.ok(Math.abs(b.getDeltaSeconds() - 1 / 30) < 1e-12);
});

test('headless harness: tick(0) is safe no-op; tick() default = 1', () => {
  const t = createHeadlessTicker();
  t.tick(0);
  assert.equal(t.getFrame(), 0);
  t.tick();
  assert.equal(t.getFrame(), 1);
});
