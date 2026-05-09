// Phase 0.68.0 - Coroutine tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  Coroutine,
  waitMs,
  waitUntil,
  waitFrames,
  RESOURCE_COROUTINE,
} from '../src/index.js';

test('coroutine: RESOURCE_COROUTINE is the stable string', () => {
  assert.equal(RESOURCE_COROUTINE, 'coroutine');
});

test('coroutine: starts empty', () => {
  const c = Coroutine.create();
  assert.equal(c.activeCount(), 0);
});

test('coroutine: instant routine completes immediately on tick', () => {
  const c = Coroutine.create();
  let ran = false;
  c.start(function* () {
    ran = true;
  });
  // Routine completed synchronously on start; first tick removes it.
  c.tick(16);
  assert.equal(ran, true);
  assert.equal(c.activeCount(), 0);
});

test('coroutine: waitMs pauses for the requested duration', () => {
  const c = Coroutine.create();
  let phase = 'idle';
  c.start(function* () {
    phase = 'before';
    yield waitMs(100);
    phase = 'after';
  });
  // Routine yielded at waitMs.
  assert.equal(phase, 'before');
  c.tick(50);
  assert.equal(phase, 'before');
  c.tick(60); // total 110 -> resume
  assert.equal(phase, 'after');
});

test('coroutine: waitFrames decrements per tick regardless of dt', () => {
  const c = Coroutine.create();
  let progressed = false;
  c.start(function* () {
    yield waitFrames(3);
    progressed = true;
  });
  c.tick(1);
  assert.equal(progressed, false);
  c.tick(1);
  assert.equal(progressed, false);
  c.tick(1);
  assert.equal(progressed, true);
});

test('coroutine: waitUntil resumes when predicate flips true', () => {
  const c = Coroutine.create();
  let condition = false;
  let resumed = false;
  c.start(function* () {
    yield waitUntil(() => condition);
    resumed = true;
  });
  c.tick(16);
  assert.equal(resumed, false);
  c.tick(16);
  assert.equal(resumed, false);
  condition = true;
  c.tick(16);
  assert.equal(resumed, true);
});

test('coroutine: chained yields advance through stages', () => {
  const c = Coroutine.create();
  const stages: string[] = [];
  c.start(function* () {
    stages.push('a');
    yield waitMs(100);
    stages.push('b');
    yield waitMs(100);
    stages.push('c');
  });
  c.tick(50);
  assert.deepEqual(stages, ['a']);
  c.tick(60);
  assert.deepEqual(stages, ['a', 'b']);
  c.tick(50);
  assert.deepEqual(stages, ['a', 'b']);
  c.tick(60);
  assert.deepEqual(stages, ['a', 'b', 'c']);
});

test('coroutine: cancel removes a running routine', () => {
  const c = Coroutine.create();
  let resumed = false;
  const id = c.start(function* () {
    yield waitMs(100);
    resumed = true;
  });
  c.tick(50);
  assert.equal(c.cancel(id), true);
  c.tick(200);
  assert.equal(resumed, false);
});

test('coroutine: cancel on missing returns false', () => {
  const c = Coroutine.create();
  assert.equal(c.cancel(999), false);
});

test('coroutine: onDone fires on routine completion', () => {
  const c = Coroutine.create();
  let doneFired = 0;
  c.start(function* () {
    yield waitMs(50);
  }, { onDone: () => { doneFired++; } });
  c.tick(60);
  assert.equal(doneFired, 1);
});

test('coroutine: onCompleted (option) fires for every completed routine', () => {
  const completed: number[] = [];
  const c = Coroutine.create({
    onCompleted: (id) => completed.push(id),
  });
  const a = c.start(function* () { yield waitMs(50); });
  const b = c.start(function* () { yield waitMs(100); });
  c.tick(60);
  assert.deepEqual(completed, [a]);
  c.tick(60);
  assert.deepEqual(completed, [a, b]);
});

test('coroutine: throwing generator fires onError', () => {
  const c = Coroutine.create();
  let errSeen: unknown = null;
  c.start(function* () {
    yield waitMs(50);
    throw new Error('boom');
  }, {
    onError: (err) => { errSeen = err; },
  });
  c.tick(60);
  assert.ok(errSeen instanceof Error);
  assert.equal(c.activeCount(), 0);
});

test('coroutine: synchronous throw at start fires onError', () => {
  const c = Coroutine.create();
  let errSeen: unknown = null;
  c.start(() => { throw new Error('oops'); }, {
    onError: (err) => { errSeen = err; },
  });
  assert.ok(errSeen instanceof Error);
});

test('coroutine: cancelAll wipes every routine', () => {
  const c = Coroutine.create();
  c.start(function* () { yield waitMs(100); });
  c.start(function* () { yield waitMs(200); });
  c.cancelAll();
  assert.equal(c.activeCount(), 0);
});

test('coroutine: NaN / negative dt clamped to 0 (waits unchanged)', () => {
  const c = Coroutine.create();
  let resumed = false;
  c.start(function* () {
    yield waitMs(50);
    resumed = true;
  });
  c.tick(NaN);
  c.tick(-100);
  assert.equal(resumed, false);
  c.tick(60);
  assert.equal(resumed, true);
});

test('coroutine: yield without wait runs again next tick (cooperative)', () => {
  const c = Coroutine.create();
  let count = 0;
  c.start(function* () {
    while (count < 3) {
      count++;
      yield;  // cooperative yield - same as null
    }
  });
  // Each tick advances one step.
  c.tick(1);
  c.tick(1);
  c.tick(1);
  assert.equal(count, 3);
});

test('coroutine: large dt completes a multi-stage routine in one tick', () => {
  const c = Coroutine.create();
  let final = false;
  c.start(function* () {
    yield waitMs(50);
    yield waitMs(50);
    yield waitMs(50);
    final = true;
  });
  // dt big enough to drain all 3 waits in one tick.
  c.tick(200);
  assert.equal(final, true);
});

test('coroutine: throwing waitUntil predicate is treated as not-yet', () => {
  const c = Coroutine.create();
  let resumed = false;
  let calls = 0;
  c.start(function* () {
    yield waitUntil(() => {
      calls++;
      if (calls < 3) throw new Error('not ready');
      return true;
    });
    resumed = true;
  });
  c.tick(16);
  c.tick(16);
  // First two predicates threw -> still not resumed.
  assert.equal(resumed, false);
  c.tick(16);
  assert.equal(resumed, true);
});

test('coroutine: dispose locks subsequent ops', () => {
  const c = Coroutine.create();
  c.start(function* () { yield waitMs(50); });
  c.dispose();
  const id = c.start(function* () { yield waitMs(50); });
  assert.equal(id, 0);
  c.tick(100);
  assert.equal(c.activeCount(), 0);
});

test('coroutine: realistic example - boss spawn cinematic', () => {
  const c = Coroutine.create();
  const events: string[] = [];
  let bossLoaded = false;
  c.start(function* () {
    events.push('cinematic-start');
    yield waitMs(500);
    events.push('roar');
    yield waitFrames(2);
    events.push('camera-shake');
    yield waitUntil(() => bossLoaded);
    events.push('boss-revealed');
  });
  c.tick(500);
  assert.deepEqual(events, ['cinematic-start', 'roar']);
  c.tick(16);
  assert.deepEqual(events, ['cinematic-start', 'roar']);
  c.tick(16);
  assert.deepEqual(events, ['cinematic-start', 'roar', 'camera-shake']);
  bossLoaded = true;
  c.tick(16);
  assert.deepEqual(events, ['cinematic-start', 'roar', 'camera-shake', 'boss-revealed']);
});
