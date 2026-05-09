// Phase 0.96.0 - ComboCounter tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  ComboCounter,
  RESOURCE_COMBO_COUNTER,
} from '../src/index.js';

test('combo-counter: RESOURCE constant', () => {
  assert.equal(RESOURCE_COMBO_COUNTER, 'combo_counter');
});

test('combo-counter: defaults', () => {
  const c = ComboCounter.create();
  assert.equal(c.getCount(), 0);
  assert.equal(c.getPeak(), 0);
  assert.equal(c.isActive(), false);
});

test('combo-counter: hit bumps count + tracks peak', () => {
  const c = ComboCounter.create();
  assert.equal(c.hit(), 1);
  assert.equal(c.hit(), 2);
  assert.equal(c.hit(), 3);
  assert.equal(c.getPeak(), 3);
});

test('combo-counter: timer resets after timeoutMs', () => {
  const c = ComboCounter.create({ timeoutMs: 500 });
  c.hit();
  assert.ok(c.isActive());
  c.tick(400);
  assert.ok(c.isActive());
  c.tick(200); // total 600 > 500
  assert.equal(c.isActive(), false);
  assert.equal(c.getCount(), 0);
});

test('combo-counter: hit refreshes timer', () => {
  const c = ComboCounter.create({ timeoutMs: 500 });
  c.hit();
  c.tick(400);
  c.hit(); // refresh
  c.tick(400); // 400ms since last hit, well below 500
  assert.ok(c.isActive());
  assert.equal(c.getCount(), 2);
});

test('combo-counter: thresholds fire at boundaries', () => {
  const log: number[] = [];
  const c = ComboCounter.create({
    thresholds: [
      { count: 5, callback: (n) => log.push(n) },
      { count: 10, callback: (n) => log.push(n) },
    ],
  });
  for (let i = 0; i < 4; i++) c.hit();
  assert.deepEqual(log, []);
  c.hit(); // count 5
  assert.deepEqual(log, [5]);
  for (let i = 0; i < 4; i++) c.hit(); // count 9
  assert.deepEqual(log, [5]);
  c.hit(); // count 10
  assert.deepEqual(log, [5, 10]);
});

test('combo-counter: thresholds fire only once per chain', () => {
  let n = 0;
  const c = ComboCounter.create({
    thresholds: [{ count: 3, callback: () => { n++; } }],
  });
  for (let i = 0; i < 10; i++) c.hit();
  assert.equal(n, 1);
});

test('combo-counter: thresholds re-arm after reset', () => {
  let n = 0;
  const c = ComboCounter.create({
    timeoutMs: 100,
    thresholds: [{ count: 3, callback: () => { n++; } }],
  });
  for (let i = 0; i < 5; i++) c.hit();
  assert.equal(n, 1);
  // Time out + new chain.
  c.tick(200);
  assert.equal(c.isActive(), false);
  for (let i = 0; i < 3; i++) c.hit();
  assert.equal(n, 2);
});

test('combo-counter: onChain fires every hit', () => {
  let n = 0;
  const c = ComboCounter.create({ onChain: () => { n++; } });
  c.hit(); c.hit(); c.hit();
  assert.equal(n, 3);
});

test('combo-counter: onReset fires with peak count', () => {
  let resetPeak = -1;
  const c = ComboCounter.create({
    timeoutMs: 100,
    onReset: (peak) => { resetPeak = peak; },
  });
  for (let i = 0; i < 7; i++) c.hit();
  c.tick(200); // timeout
  assert.equal(resetPeak, 7);
});

test('combo-counter: manual reset fires onReset', () => {
  let resetPeak = -1;
  const c = ComboCounter.create({
    onReset: (peak) => { resetPeak = peak; },
  });
  c.hit(); c.hit();
  c.reset();
  assert.equal(resetPeak, 2);
  assert.equal(c.getCount(), 0);
});

test('combo-counter: reset on idle counter does not fire', () => {
  let n = 0;
  const c = ComboCounter.create({ onReset: () => { n++; } });
  c.reset();
  assert.equal(n, 0);
});

test('combo-counter: getRemainingMs reads timer', () => {
  const c = ComboCounter.create({ timeoutMs: 1000 });
  c.hit();
  assert.equal(c.getRemainingMs(), 1000);
  c.tick(300);
  assert.equal(c.getRemainingMs(), 700);
});

test('combo-counter: getRemainingMs 0 when inactive', () => {
  const c = ComboCounter.create();
  assert.equal(c.getRemainingMs(), 0);
});

test('combo-counter: setTimeoutMs runtime tuning', () => {
  const c = ComboCounter.create({ timeoutMs: 1000 });
  c.hit();
  c.setTimeoutMs(200);
  // Already-active timer keeps the OLD remaining; the new value
  // applies to the NEXT hit.
  c.hit(); // refresh with new timeoutMs
  assert.equal(c.getRemainingMs(), 200);
});

test('combo-counter: setTimeoutMs invalid rejected', () => {
  const c = ComboCounter.create({ timeoutMs: 500 });
  c.setTimeoutMs(-1);
  c.setTimeoutMs(NaN);
  c.hit();
  assert.equal(c.getRemainingMs(), 500); // unchanged
});

test('combo-counter: addThreshold runtime', () => {
  let fired = 0;
  const c = ComboCounter.create();
  c.addThreshold({ count: 3, callback: () => { fired++; } });
  c.hit(); c.hit(); c.hit();
  assert.equal(fired, 1);
});

test('combo-counter: addThreshold rejects duplicates / invalid', () => {
  const c = ComboCounter.create();
  c.addThreshold({ count: 5, callback: () => {} });
  assert.equal(c.addThreshold({ count: 5, callback: () => {} }), false);
  assert.equal(c.addThreshold({ count: 0, callback: () => {} }), false);
  assert.equal(c.addThreshold({ count: -1, callback: () => {} }), false);
});

test('combo-counter: removeThreshold drops', () => {
  let fired = 0;
  const c = ComboCounter.create({
    thresholds: [{ count: 3, callback: () => { fired++; } }],
  });
  c.removeThreshold(3);
  c.hit(); c.hit(); c.hit();
  assert.equal(fired, 0);
});

test('combo-counter: throwing callbacks isolated', () => {
  const c = ComboCounter.create({
    timeoutMs: 100,
    onChain: () => { throw new Error('chain'); },
    onReset: () => { throw new Error('reset'); },
    thresholds: [{ count: 2, callback: () => { throw new Error('th'); } }],
  });
  c.hit(); c.hit(); c.hit();
  c.tick(200);
  assert.equal(c.getCount(), 0);
});

test('combo-counter: NaN dt no-op', () => {
  const c = ComboCounter.create({ timeoutMs: 100 });
  c.hit();
  c.tick(NaN);
  c.tick(-50);
  assert.ok(c.isActive());
});

test('combo-counter: dispose locks ops', () => {
  const c = ComboCounter.create();
  c.hit();
  c.dispose();
  assert.equal(c.hit(), 0);
  c.tick(1000);
  assert.equal(c.getCount(), 0);
});

test('combo-counter: realistic ARPG combo flow', () => {
  const callouts: number[] = [];
  let resets = 0;
  const c = ComboCounter.create({
    timeoutMs: 600,
    thresholds: [
      { count: 10, callback: () => callouts.push(10) },
      { count: 25, callback: () => callouts.push(25) },
      { count: 50, callback: () => callouts.push(50) },
    ],
    onReset: () => { resets++; },
  });
  // 30-hit chain.
  for (let i = 0; i < 30; i++) {
    c.hit();
    c.tick(50);
  }
  assert.deepEqual(callouts, [10, 25]);
  assert.equal(c.getCount(), 30);
  // Player misses for >600ms.
  c.tick(700);
  assert.equal(c.getCount(), 0);
  assert.equal(resets, 1);
  // New chain.
  for (let i = 0; i < 12; i++) c.hit();
  assert.deepEqual(callouts, [10, 25, 10]);
});
