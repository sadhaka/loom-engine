// Phase 0.70.0 - TimeOfDay tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  TimeOfDay,
  RESOURCE_TIME_OF_DAY,
} from '../src/index.js';

test('time-of-day: RESOURCE_TIME_OF_DAY is the stable string', () => {
  assert.equal(RESOURCE_TIME_OF_DAY, 'time_of_day');
});

test('time-of-day: defaults to hour 8, full real-day length', () => {
  const t = TimeOfDay.create();
  assert.equal(t.getHour(), 8);
  assert.equal(t.getDayCount(), 0);
  assert.equal(t.getDayLengthMs(), 24 * 60 * 60 * 1000);
});

test('time-of-day: initialHour respected', () => {
  const t = TimeOfDay.create({ initialHour: 14 });
  assert.equal(t.getHour(), 14);
});

test('time-of-day: initialHour wraps past 24', () => {
  const t = TimeOfDay.create({ initialHour: 25 });
  assert.equal(t.getHour(), 1);
});

test('time-of-day: tick advances hour proportional to dayLengthMs', () => {
  const t = TimeOfDay.create({
    dayLengthMs: 1000, // 1 second = 1 day
    initialHour: 0,
  });
  t.tick(500); // half a day = 12 hours
  assert.ok(Math.abs(t.getHour() - 12) < 1e-6);
});

test('time-of-day: tick wraps past 24 + increments dayCount', () => {
  const t = TimeOfDay.create({
    dayLengthMs: 1000,
    initialHour: 22,
  });
  t.tick(200); // 200ms = 4.8 hours; 22 + 4.8 = 26.8 -> wraps to 2.8, +1 day
  assert.ok(Math.abs(t.getHour() - 2.8) < 1e-6);
  assert.equal(t.getDayCount(), 1);
});

test('time-of-day: tick over multiple days', () => {
  const t = TimeOfDay.create({
    dayLengthMs: 1000,
    initialHour: 0,
  });
  t.tick(2500); // 2.5 days
  assert.equal(t.getDayCount(), 2);
  // Hour at end: 2.5 days = 60 hours, mod 24 = 12.
  assert.ok(Math.abs(t.getHour() - 12) < 1e-6);
});

test('time-of-day: setHour updates clock + wraps', () => {
  const t = TimeOfDay.create();
  t.setHour(10);
  assert.equal(t.getHour(), 10);
  t.setHour(30);
  assert.equal(t.getHour(), 6);
  t.setHour(-5);
  assert.equal(t.getHour(), 19);
});

test('time-of-day: getPhase returns null when no phases configured', () => {
  const t = TimeOfDay.create({ initialHour: 12 });
  assert.equal(t.getPhase(), null);
});

test('time-of-day: getPhase returns the right phase for hour', () => {
  const t = TimeOfDay.create({
    initialHour: 14,
    phases: [
      { name: 'dawn', startHour: 5 },
      { name: 'day', startHour: 7 },
      { name: 'dusk', startHour: 18 },
      { name: 'night', startHour: 20 },
    ],
  });
  // 14 falls in 'day' (7-18).
  assert.equal(t.getPhase(), 'day');
});

test('time-of-day: pre-dawn hour wraps to last night phase', () => {
  const t = TimeOfDay.create({
    initialHour: 3,
    phases: [
      { name: 'dawn', startHour: 5 },
      { name: 'day', startHour: 7 },
      { name: 'night', startHour: 20 },
    ],
  });
  // 3 has no phase started yet today; wraps to last (night).
  assert.equal(t.getPhase(), 'night');
});

test('time-of-day: onPhaseChanged fires when crossing boundary', () => {
  const phaseLog: Array<{ next: string; prev: string | null }> = [];
  const t = TimeOfDay.create({
    initialHour: 6,
    dayLengthMs: 1000,
    phases: [
      { name: 'dawn', startHour: 5 },
      { name: 'day', startHour: 7 },
    ],
    onPhaseChanged: (n, p) => phaseLog.push({ next: n, prev: p }),
  });
  // Initial phase is 'dawn'; no callback fires at construction.
  assert.equal(t.getPhase(), 'dawn');
  // Tick forward 50ms = 1.2 hours. 6 + 1.2 = 7.2 -> 'day'.
  t.tick(50);
  assert.equal(t.getPhase(), 'day');
  assert.equal(phaseLog.length, 1);
  assert.equal(phaseLog[0]!.next, 'day');
  assert.equal(phaseLog[0]!.prev, 'dawn');
});

test('time-of-day: onPhaseChanged does NOT fire for same-phase tick', () => {
  let fires = 0;
  const t = TimeOfDay.create({
    initialHour: 8,
    dayLengthMs: 1000,
    phases: [
      { name: 'dawn', startHour: 5 },
      { name: 'day', startHour: 7 },
    ],
    onPhaseChanged: () => { fires++; },
  });
  t.tick(50); // 8 + 1.2 = 9.2 - still 'day'
  t.tick(50);
  assert.equal(fires, 0);
});

test('time-of-day: onPhaseChanged fires across day boundary', () => {
  const phaseLog: string[] = [];
  const t = TimeOfDay.create({
    initialHour: 23,
    dayLengthMs: 1000,
    phases: [
      { name: 'dawn', startHour: 5 },
      { name: 'day', startHour: 7 },
      { name: 'night', startHour: 20 },
    ],
    onPhaseChanged: (n) => phaseLog.push(n),
  });
  // 23 -> 'night'.
  assert.equal(t.getPhase(), 'night');
  // Tick forward 300ms = 7.2 hours. 23 + 7.2 = 30.2 -> wraps to 6.2 -> 'dawn'.
  t.tick(300);
  assert.equal(t.getPhase(), 'dawn');
  assert.deepEqual(phaseLog, ['dawn']);
});

test('time-of-day: throwing onPhaseChanged isolated', () => {
  const t = TimeOfDay.create({
    initialHour: 6,
    dayLengthMs: 1000,
    phases: [
      { name: 'dawn', startHour: 5 },
      { name: 'day', startHour: 7 },
    ],
    onPhaseChanged: () => { throw new Error('boom'); },
  });
  // Should not throw.
  t.tick(60);
  assert.equal(t.getPhase(), 'day');
});

test('time-of-day: setHour fires onPhaseChanged on phase change', () => {
  let fired = '';
  const t = TimeOfDay.create({
    initialHour: 6,
    phases: [
      { name: 'dawn', startHour: 5 },
      { name: 'day', startHour: 7 },
    ],
    onPhaseChanged: (n) => { fired = n; },
  });
  t.setHour(15); // -> 'day'
  assert.equal(fired, 'day');
});

test('time-of-day: setDayLengthMs updates acceleration', () => {
  const t = TimeOfDay.create({ dayLengthMs: 1000, initialHour: 0 });
  t.tick(500); // 12 hours at 1000ms/day
  assert.ok(Math.abs(t.getHour() - 12) < 1e-6);
  t.setDayLengthMs(2000); // half speed now
  t.tick(500); // 6 hours
  assert.ok(Math.abs(t.getHour() - 18) < 1e-6);
});

test('time-of-day: NaN / negative dt ignored', () => {
  const t = TimeOfDay.create({ dayLengthMs: 1000, initialHour: 5 });
  t.tick(NaN);
  t.tick(-10);
  assert.equal(t.getHour(), 5);
});

test('time-of-day: phases sorted by startHour internally', () => {
  const t = TimeOfDay.create({
    initialHour: 12,
    phases: [
      // Out of order - should be sorted internally.
      { name: 'night', startHour: 20 },
      { name: 'dawn', startHour: 5 },
      { name: 'day', startHour: 7 },
    ],
  });
  assert.equal(t.getPhase(), 'day');
  // getPhases returns sorted view.
  const list = t.getPhases();
  assert.deepEqual(list.map((p) => p.name), ['dawn', 'day', 'night']);
});

test('time-of-day: dispose locks ops', () => {
  const t = TimeOfDay.create({ dayLengthMs: 1000 });
  t.dispose();
  t.tick(100);
  // After dispose, hour shouldn't have changed.
  assert.equal(t.getHour(), 8);
});

test('time-of-day: realistic example - a full game day cycle', () => {
  const phaseLog: string[] = [];
  const t = TimeOfDay.create({
    initialHour: 0,
    dayLengthMs: 1000,
    phases: [
      { name: 'dawn', startHour: 5 },
      { name: 'day', startHour: 7 },
      { name: 'dusk', startHour: 18 },
      { name: 'night', startHour: 20 },
    ],
    onPhaseChanged: (n) => phaseLog.push(n),
  });
  // Initial phase: 0 < 5, wraps to 'night'.
  assert.equal(t.getPhase(), 'night');
  // Tick to 5h = 5/24 of dayLength = 5/24 * 1000 = 208ms.
  t.tick(208);
  // hour = 4.99 ish; phase still night.
  // Tick a bit more to definitely cross 5h:
  t.tick(2);
  assert.ok(t.getHour() >= 5);
  assert.equal(t.getPhase(), 'dawn');
  // Continue to day -> dusk -> night.
  t.tick(100); // +2.4h -> 7.4h -> 'day'
  t.tick(450); // +10.8h -> 18.2h -> 'dusk'
  t.tick(100); // +2.4h -> 20.6h -> 'night'
  assert.deepEqual(phaseLog, ['dawn', 'day', 'dusk', 'night']);
});
