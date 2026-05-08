// Phase 0.25.0 - EngineClock tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { EngineClock } from '../src/runtime/engine-clock.js';


test('engine-clock: tick passes through dt at scale=1, no pause', function () {
  var clock = new EngineClock();
  var dt = clock.tick(16.67);
  assert.ok(Math.abs(dt - 16.67) < 1e-6);
  assert.ok(Math.abs(clock.totalSimulatedMs() - 16.67) < 1e-6);
  assert.ok(Math.abs(clock.totalRealMs() - 16.67) < 1e-6);
});

test('engine-clock: pause makes tick return 0; resume restores', function () {
  var clock = new EngineClock();
  clock.pause();
  assert.equal(clock.isPaused(), true);
  var dt = clock.tick(100);
  assert.equal(dt, 0);
  // Real ms still advances; simulated does not.
  assert.equal(clock.totalRealMs(), 100);
  assert.equal(clock.totalSimulatedMs(), 0);

  clock.resume();
  assert.equal(clock.isPaused(), false);
  dt = clock.tick(50);
  assert.equal(dt, 50);
  assert.equal(clock.totalSimulatedMs(), 50);
});

test('engine-clock: timeScale multiplies sim dt', function () {
  var clock = new EngineClock({ timeScale: 0.5 });
  var dt = clock.tick(100);
  assert.equal(dt, 50);
  clock.setTimeScale(2.0);
  dt = clock.tick(100);
  assert.equal(dt, 200);
});

test('engine-clock: setTimeScale clamps negative + invalid to 0', function () {
  var clock = new EngineClock();
  clock.setTimeScale(-1);
  assert.equal(clock.timeScale(), 0);
  clock.setTimeScale(NaN);
  assert.equal(clock.timeScale(), 0);
  clock.setTimeScale(Infinity);
  // Infinity is finite-fail too -> clamp to 0.
  assert.equal(clock.timeScale(), 0);
  clock.setTimeScale(1.5);
  assert.equal(clock.timeScale(), 1.5);
});

test('engine-clock: timeScale=0 makes tick return 0 like pause', function () {
  var clock = new EngineClock({ timeScale: 0 });
  var dt = clock.tick(100);
  assert.equal(dt, 0);
  // Real time still accumulates.
  assert.equal(clock.totalRealMs(), 100);
});

test('engine-clock: step() emits dt even while paused', function () {
  var clock = new EngineClock({ defaultStepMs: 16 });
  clock.pause();
  var dt1 = clock.step();
  assert.equal(dt1, 16);
  var dt2 = clock.step(33);
  assert.equal(dt2, 33);
  assert.equal(clock.totalSteps(), 2);
  assert.equal(clock.totalSimulatedMs(), 49);
});

test('engine-clock: step ignores invalid stepMs (uses default)', function () {
  var clock = new EngineClock({ defaultStepMs: 20 });
  assert.equal(clock.step(undefined), 20);
  assert.equal(clock.step(0), 20);
  assert.equal(clock.step(-5), 20);
});

test('engine-clock: tick rejects invalid realDtMs (treats as 0)', function () {
  var clock = new EngineClock();
  assert.equal(clock.tick(NaN), 0);
  assert.equal(clock.tick(-100), 0);
  assert.equal(clock.totalRealMs(), 0);
});

test('engine-clock: defaultStepMs reflects constructor option', function () {
  var clock = new EngineClock({ defaultStepMs: 25 });
  assert.equal(clock.defaultStepMs(), 25);
  // Invalid values fall back to 16.67.
  var clock2 = new EngineClock({ defaultStepMs: -1 });
  assert.ok(Math.abs(clock2.defaultStepMs() - 16.6667) < 0.001);
});

test('engine-clock: resetCounters wipes timing but preserves pause + scale', function () {
  var clock = new EngineClock({ timeScale: 2 });
  clock.tick(100);
  clock.step();
  clock.pause();
  assert.ok(clock.totalSimulatedMs() > 0);
  assert.ok(clock.totalRealMs() > 0);
  assert.equal(clock.totalSteps(), 1);

  clock.resetCounters();
  assert.equal(clock.totalSimulatedMs(), 0);
  assert.equal(clock.totalRealMs(), 0);
  assert.equal(clock.totalSteps(), 0);
  // Pause + scale survive.
  assert.equal(clock.isPaused(), true);
  assert.equal(clock.timeScale(), 2);
});

test('engine-clock: pause does not block step()', function () {
  // Step is the explicit "I want to advance one frame while paused"
  // affordance. Test confirms it bypasses the pause gate.
  var clock = new EngineClock();
  clock.pause();
  clock.step();
  assert.equal(clock.totalSteps(), 1);
  assert.ok(clock.totalSimulatedMs() > 0);
});
