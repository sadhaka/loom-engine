// Phase 0.48.0 - TimerScheduler tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  TimerScheduler,
  RESOURCE_TIMER_SCHEDULER,
} from '../src/index.js';

test('timer-scheduler: RESOURCE_TIMER_SCHEDULER is the stable string', () => {
  assert.equal(RESOURCE_TIMER_SCHEDULER, 'timer_scheduler');
});

test('timer-scheduler: starts with no pending timers', () => {
  const ts = TimerScheduler.create();
  assert.equal(ts.pendingCount(), 0);
});

// ---------- setTimeout (one-shot) ----------

test('setTimeout: fires once after the delay elapses', () => {
  const ts = TimerScheduler.create();
  let fires = 0;
  ts.setTimeout(() => { fires++; }, 100);
  ts.tick(50);
  assert.equal(fires, 0);
  ts.tick(60);
  assert.equal(fires, 1);
  ts.tick(1000); // never re-fires
  assert.equal(fires, 1);
});

test('setTimeout: fires exactly once even if dt overshoots delay', () => {
  const ts = TimerScheduler.create();
  let fires = 0;
  ts.setTimeout(() => { fires++; }, 100);
  ts.tick(500);
  assert.equal(fires, 1);
});

test('setTimeout: returns handle that can be cancelled', () => {
  const ts = TimerScheduler.create();
  let fires = 0;
  const h = ts.setTimeout(() => { fires++; }, 100);
  assert.equal(h.isActive(), true);
  h.cancel();
  assert.equal(h.isActive(), false);
  ts.tick(500);
  assert.equal(fires, 0);
});

test('setTimeout: clearTimeout via handle works', () => {
  const ts = TimerScheduler.create();
  let fires = 0;
  const h = ts.setTimeout(() => { fires++; }, 100);
  ts.clearTimeout(h);
  ts.tick(500);
  assert.equal(fires, 0);
});

test('setTimeout: clearTimeout via id works', () => {
  const ts = TimerScheduler.create();
  let fires = 0;
  const h = ts.setTimeout(() => { fires++; }, 100);
  ts.clearTimeout(h.id);
  ts.tick(500);
  assert.equal(fires, 0);
});

test('setTimeout: clearTimeout on null / undefined is a safe no-op', () => {
  const ts = TimerScheduler.create();
  ts.clearTimeout(null);
  ts.clearTimeout(undefined);
  // Just shouldn't throw.
  assert.equal(ts.pendingCount(), 0);
});

test('setTimeout: clearTimeout after fire is a safe no-op', () => {
  const ts = TimerScheduler.create();
  const h = ts.setTimeout(() => {}, 100);
  ts.tick(200);
  ts.clearTimeout(h);
  assert.equal(h.isActive(), false);
});

test('setTimeout: delayMs <= 0 fires on next tick', () => {
  const ts = TimerScheduler.create();
  let fires = 0;
  ts.setTimeout(() => { fires++; }, 0);
  ts.tick(1);
  assert.equal(fires, 1);
});

// ---------- setInterval ----------

test('setInterval: fires every delayMs of accumulated tick time', () => {
  const ts = TimerScheduler.create();
  let fires = 0;
  ts.setInterval(() => { fires++; }, 100);
  ts.tick(50);
  assert.equal(fires, 0);
  ts.tick(60); // total 110 - first fire
  assert.equal(fires, 1);
  ts.tick(100); // total 210 - second fire
  assert.equal(fires, 2);
  ts.tick(200); // total 410 - third + fourth fires
  assert.equal(fires, 4);
});

test('setInterval: maintains steady cadence under variable dt', () => {
  const ts = TimerScheduler.create();
  let fires = 0;
  ts.setInterval(() => { fires++; }, 100);
  ts.tick(150); // first fire at 100; remainingMs becomes -50 + 100 = 50
  assert.equal(fires, 1);
  ts.tick(50); // second fire at 200
  assert.equal(fires, 2);
});

test('setInterval: maxFiresPerTick caps burst on huge dt', () => {
  const ts = TimerScheduler.create({ maxFiresPerTick: 5 });
  let fires = 0;
  ts.setInterval(() => { fires++; }, 10);
  ts.tick(10000); // would fire 1000 times without cap
  assert.equal(fires, 5);
});

test('setInterval: maxFiresPerTick=0 disables the cap', () => {
  const ts = TimerScheduler.create({ maxFiresPerTick: 0 });
  let fires = 0;
  ts.setInterval(() => { fires++; }, 10);
  ts.tick(100); // exactly 10 fires
  assert.equal(fires, 10);
});

test('setInterval: clearInterval stops further fires', () => {
  const ts = TimerScheduler.create();
  let fires = 0;
  const h = ts.setInterval(() => { fires++; }, 50);
  ts.tick(150); // fires=3
  assert.equal(fires, 3);
  ts.clearInterval(h);
  ts.tick(500);
  assert.equal(fires, 3);
});

test('setInterval: delayMs=0 is dropped to avoid infinite loop', () => {
  const ts = TimerScheduler.create();
  let fires = 0;
  ts.setInterval(() => { fires++; }, 0);
  ts.tick(100);
  // Fires once, then drops itself.
  assert.equal(fires, 1);
});

// ---------- shared semantics ----------

test('multiple timers: independent firing per timer', () => {
  const ts = TimerScheduler.create();
  let fastFires = 0;
  let slowFires = 0;
  ts.setInterval(() => { fastFires++; }, 50);
  ts.setInterval(() => { slowFires++; }, 200);
  ts.tick(400);
  // fast: 8 fires; slow: 2 fires.
  assert.equal(fastFires, 8);
  assert.equal(slowFires, 2);
});

test('cancelAll cancels every active timer', () => {
  const ts = TimerScheduler.create();
  let fires = 0;
  ts.setInterval(() => { fires++; }, 50);
  ts.setTimeout(() => { fires++; }, 25);
  ts.cancelAll();
  ts.tick(500);
  assert.equal(fires, 0);
});

test('newly-scheduled timer from inside callback does NOT fire in same tick', () => {
  const ts = TimerScheduler.create();
  let outerFires = 0;
  let innerFires = 0;
  ts.setTimeout(() => {
    outerFires++;
    ts.setTimeout(() => { innerFires++; }, 0);
  }, 50);
  ts.tick(100); // outer fires; inner is scheduled but does not fire
  assert.equal(outerFires, 1);
  assert.equal(innerFires, 0);
  ts.tick(1); // inner fires now
  assert.equal(innerFires, 1);
});

test('throwing callback isolated; subsequent timers still fire', () => {
  const ts = TimerScheduler.create();
  let cleanFires = 0;
  ts.setTimeout(() => { throw new Error('boom'); }, 10);
  ts.setTimeout(() => { cleanFires++; }, 10);
  ts.tick(100);
  assert.equal(cleanFires, 1);
});

test('NaN dt is ignored', () => {
  const ts = TimerScheduler.create();
  let fires = 0;
  ts.setTimeout(() => { fires++; }, 100);
  ts.tick(NaN);
  ts.tick(50);
  ts.tick(60);
  assert.equal(fires, 1);
});

test('negative dt is ignored', () => {
  const ts = TimerScheduler.create();
  let fires = 0;
  ts.setTimeout(() => { fires++; }, 100);
  ts.tick(-50);
  assert.equal(fires, 0);
});

test('pendingCount tracks active timers', () => {
  const ts = TimerScheduler.create();
  ts.setTimeout(() => {}, 100);
  ts.setInterval(() => {}, 100);
  assert.equal(ts.pendingCount(), 2);
  ts.tick(150);
  // One-shot fired (gone); interval still pending.
  assert.equal(ts.pendingCount(), 1);
});

test('has(id) reflects timer existence', () => {
  const ts = TimerScheduler.create();
  const h = ts.setTimeout(() => {}, 100);
  assert.equal(ts.has(h.id), true);
  ts.tick(200);
  assert.equal(ts.has(h.id), false);
});

test('stats counts fires and cancellations', () => {
  const ts = TimerScheduler.create();
  ts.setTimeout(() => {}, 50);
  const h = ts.setTimeout(() => {}, 200);
  ts.tick(100); // only the 50ms one fires
  h.cancel();   // cancel before its fire window
  const s = ts.stats();
  assert.equal(s.fired, 1);
  assert.equal(s.cancelled, 1);
});

test('dispose makes scheduling no-op', () => {
  const ts = TimerScheduler.create();
  ts.dispose();
  let fires = 0;
  const h = ts.setTimeout(() => { fires++; }, 10);
  // Disposed scheduler returns a no-op handle.
  assert.equal(h.isActive(), false);
  ts.tick(100);
  assert.equal(fires, 0);
});

test('id is unique across timers', () => {
  const ts = TimerScheduler.create();
  const ids = new Set<number>();
  for (var i = 0; i < 100; i++) {
    ids.add(ts.setTimeout(() => {}, 10).id);
  }
  assert.equal(ids.size, 100);
});

test('setTimeout: handle.isActive returns false after fire', () => {
  const ts = TimerScheduler.create();
  const h = ts.setTimeout(() => {}, 100);
  ts.tick(150);
  assert.equal(h.isActive(), false);
});

test('setInterval: handle.isActive remains true while firing repeatedly', () => {
  const ts = TimerScheduler.create();
  const h = ts.setInterval(() => {}, 100);
  ts.tick(250);
  assert.equal(h.isActive(), true);
});

test('determinism: same dt sequence produces identical fire counts', () => {
  // Run two schedulers with identical setup and identical dt sequences.
  // Both should fire identically - that's the "replay determinism" promise.
  const dts = [16, 16, 17, 16, 16, 17, 16];
  function run(): number {
    const ts = TimerScheduler.create();
    let fires = 0;
    ts.setInterval(() => { fires++; }, 50);
    for (var i = 0; i < dts.length; i++) ts.tick(dts[i] as number);
    return fires;
  }
  const a = run();
  const b = run();
  assert.equal(a, b);
});
