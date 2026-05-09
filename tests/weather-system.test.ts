// Phase 0.71.0 - WeatherSystem tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  WeatherSystem,
  RESOURCE_WEATHER_SYSTEM,
} from '../src/index.js';

test('weather-system: RESOURCE_WEATHER_SYSTEM is the stable string', () => {
  assert.equal(RESOURCE_WEATHER_SYSTEM, 'weather_system');
});

test('weather-system: empty config -> no current weather, intensity 0', () => {
  const w = WeatherSystem.create();
  assert.equal(w.getWeather(), null);
  assert.equal(w.getIntensity(), 0);
  assert.equal(w.isTransitioning(), false);
  assert.deepEqual(w.getStates(), []);
});

test('weather-system: initial state respected, intensity from defaultIntensity', () => {
  const w = WeatherSystem.create({
    states: [
      { name: 'clear', defaultIntensity: 0 },
      { name: 'rain', defaultIntensity: 0.6 },
    ],
    initial: 'rain',
  });
  assert.equal(w.getWeather(), 'rain');
  assert.equal(w.getIntensity(), 0.6);
});

test('weather-system: unknown initial state is ignored (currentName null)', () => {
  const w = WeatherSystem.create({
    states: [{ name: 'clear' }],
    initial: 'storm',
  });
  assert.equal(w.getWeather(), null);
  assert.equal(w.getIntensity(), 0);
});

test('weather-system: explicit initialIntensity overrides state default', () => {
  const w = WeatherSystem.create({
    states: [{ name: 'rain', defaultIntensity: 0.5 }],
    initial: 'rain',
    initialIntensity: 0.9,
  });
  assert.equal(w.getIntensity(), 0.9);
});

test('weather-system: setWeather flips state instantly when no rampMs', () => {
  const log: Array<{ next: string; prev: string | null }> = [];
  const w = WeatherSystem.create({
    states: [
      { name: 'clear', defaultIntensity: 0 },
      { name: 'rain', defaultIntensity: 0.7 },
    ],
    initial: 'clear',
    onWeatherChanged: (n, p) => log.push({ next: n, prev: p }),
  });
  assert.ok(w.setWeather('rain'));
  assert.equal(w.getWeather(), 'rain');
  assert.equal(w.getIntensity(), 0.7);
  assert.equal(log.length, 1);
  assert.equal(log[0]!.next, 'rain');
  assert.equal(log[0]!.prev, 'clear');
  assert.equal(w.isTransitioning(), false);
});

test('weather-system: setWeather to unknown state returns false; no flip, no callback', () => {
  let fires = 0;
  const w = WeatherSystem.create({
    states: [{ name: 'clear' }],
    initial: 'clear',
    onWeatherChanged: () => { fires++; },
  });
  assert.equal(w.setWeather('storm'), false);
  assert.equal(w.getWeather(), 'clear');
  assert.equal(fires, 0);
});

test('weather-system: setWeather with rampMs interpolates intensity over time', () => {
  const w = WeatherSystem.create({
    states: [
      { name: 'clear', defaultIntensity: 0 },
      { name: 'rain', defaultIntensity: 1 },
    ],
    initial: 'clear',
  });
  w.setWeather('rain', { rampMs: 1000 });
  assert.equal(w.getWeather(), 'rain');
  // Intensity has not jumped yet; ramp starts from 0.
  assert.equal(w.getIntensity(), 0);
  assert.equal(w.isTransitioning(), true);
  w.tick(250);
  assert.ok(Math.abs(w.getIntensity() - 0.25) < 1e-6);
  w.tick(250);
  assert.ok(Math.abs(w.getIntensity() - 0.5) < 1e-6);
});

test('weather-system: ramp completes on or after rampMs and fires onIntensitySettled exactly once', () => {
  let settled: Array<{ state: string; intensity: number }> = [];
  const w = WeatherSystem.create({
    states: [
      { name: 'clear', defaultIntensity: 0 },
      { name: 'rain', defaultIntensity: 0.8 },
    ],
    initial: 'clear',
    onIntensitySettled: (s, i) => settled.push({ state: s, intensity: i }),
  });
  // Drop the initial-settle that happens on instant flips by switching
  // from constructor's null->non-null path: constructor itself does
  // not fire callbacks (only setWeather does). Confirm baseline.
  assert.equal(settled.length, 0);
  w.setWeather('rain', { rampMs: 500 });
  // Ramp in flight; no settle yet.
  assert.equal(settled.length, 0);
  w.tick(250);
  assert.equal(settled.length, 0);
  // Crossing the boundary fires settle.
  w.tick(300); // total 550 > 500
  assert.equal(settled.length, 1);
  assert.equal(settled[0]!.state, 'rain');
  assert.ok(Math.abs(settled[0]!.intensity - 0.8) < 1e-6);
  // Subsequent ticks do not re-fire.
  w.tick(100);
  assert.equal(settled.length, 1);
  assert.equal(w.isTransitioning(), false);
});

test('weather-system: setWeather to current state re-targets intensity without firing onWeatherChanged', () => {
  let stateFlips = 0;
  let settled = 0;
  const w = WeatherSystem.create({
    states: [{ name: 'rain', defaultIntensity: 0.3 }],
    initial: 'rain',
    onWeatherChanged: () => { stateFlips++; },
    onIntensitySettled: () => { settled++; },
  });
  // Initially intensity 0.3.
  assert.equal(w.getIntensity(), 0.3);
  assert.ok(w.setWeather('rain', { intensity: 0.9 }));
  assert.equal(w.getWeather(), 'rain');
  assert.equal(w.getIntensity(), 0.9);
  // No state-flip callback; instant ramp does fire settle.
  assert.equal(stateFlips, 0);
  assert.equal(settled, 1);
});

test('weather-system: setWeather with explicit intensity overrides state default', () => {
  const w = WeatherSystem.create({
    states: [
      { name: 'clear' },
      { name: 'rain', defaultIntensity: 1 },
    ],
    initial: 'clear',
  });
  w.setWeather('rain', { intensity: 0.25 });
  assert.equal(w.getIntensity(), 0.25);
});

test('weather-system: intensity clamps to [0, 1]', () => {
  const w = WeatherSystem.create({
    states: [{ name: 'rain', defaultIntensity: 5 }],
    initial: 'rain',
  });
  // defaultIntensity normalized at register time.
  assert.equal(w.getIntensity(), 1);
  w.setWeather('rain', { intensity: -2 });
  assert.equal(w.getIntensity(), 0);
  w.setWeather('rain', { intensity: 99 });
  assert.equal(w.getIntensity(), 1);
});

test('weather-system: tick during ramp does not re-fire onWeatherChanged', () => {
  let fires = 0;
  const w = WeatherSystem.create({
    states: [
      { name: 'clear' },
      { name: 'rain', defaultIntensity: 1 },
    ],
    initial: 'clear',
    onWeatherChanged: () => { fires++; },
  });
  w.setWeather('rain', { rampMs: 500 });
  assert.equal(fires, 1);
  w.tick(100);
  w.tick(100);
  w.tick(100);
  w.tick(500);
  assert.equal(fires, 1);
});

test('weather-system: registerState adds; returns false on duplicate', () => {
  const w = WeatherSystem.create();
  assert.ok(w.registerState({ name: 'fog', defaultIntensity: 0.5 }));
  assert.ok(w.hasState('fog'));
  // Duplicate.
  assert.equal(w.registerState({ name: 'fog' }), false);
  // Empty name.
  assert.equal(w.registerState({ name: '' }), false);
  // Now switchable.
  assert.ok(w.setWeather('fog'));
  assert.equal(w.getWeather(), 'fog');
  assert.equal(w.getIntensity(), 0.5);
});

test('weather-system: getStates returns defensive copy in registration order', () => {
  const w = WeatherSystem.create({
    states: [
      { name: 'clear', defaultIntensity: 0 },
      { name: 'rain', defaultIntensity: 0.5 },
      { name: 'storm', defaultIntensity: 1 },
    ],
  });
  const list = w.getStates();
  assert.deepEqual(list.map((s) => s.name), ['clear', 'rain', 'storm']);
  // Mutating the copy does not affect the registry.
  list[0]!.defaultIntensity = 99;
  const list2 = w.getStates();
  assert.equal(list2[0]!.defaultIntensity, 0);
});

test('weather-system: throwing onWeatherChanged is isolated', () => {
  const w = WeatherSystem.create({
    states: [
      { name: 'clear' },
      { name: 'rain', defaultIntensity: 1 },
    ],
    initial: 'clear',
    onWeatherChanged: () => { throw new Error('boom'); },
  });
  // Should not throw.
  assert.ok(w.setWeather('rain'));
  assert.equal(w.getWeather(), 'rain');
});

test('weather-system: throwing onIntensitySettled is isolated', () => {
  const w = WeatherSystem.create({
    states: [
      { name: 'clear' },
      { name: 'rain', defaultIntensity: 1 },
    ],
    initial: 'clear',
    onIntensitySettled: () => { throw new Error('boom'); },
  });
  w.setWeather('rain', { rampMs: 100 });
  // Should not throw.
  w.tick(150);
  assert.equal(w.getIntensity(), 1);
});

test('weather-system: NaN / negative dt ignored during ramp', () => {
  const w = WeatherSystem.create({
    states: [
      { name: 'clear' },
      { name: 'rain', defaultIntensity: 1 },
    ],
    initial: 'clear',
  });
  w.setWeather('rain', { rampMs: 1000 });
  w.tick(NaN);
  w.tick(-50);
  assert.equal(w.getIntensity(), 0);
  assert.equal(w.isTransitioning(), true);
});

test('weather-system: tick with no ramp is a no-op', () => {
  const w = WeatherSystem.create({
    states: [{ name: 'clear', defaultIntensity: 0 }],
    initial: 'clear',
  });
  w.tick(100);
  w.tick(100);
  assert.equal(w.getIntensity(), 0);
});

test('weather-system: rampMs <= 0 falls back to instant flip', () => {
  const w = WeatherSystem.create({
    states: [
      { name: 'clear' },
      { name: 'rain', defaultIntensity: 0.4 },
    ],
    initial: 'clear',
  });
  w.setWeather('rain', { rampMs: 0 });
  assert.equal(w.getIntensity(), 0.4);
  assert.equal(w.isTransitioning(), false);
  // Negative rampMs treated as instant.
  w.setWeather('clear', { rampMs: -100, intensity: 0 });
  assert.equal(w.getIntensity(), 0);
  assert.equal(w.isTransitioning(), false);
});

test('weather-system: dispose locks ops', () => {
  const w = WeatherSystem.create({
    states: [
      { name: 'clear' },
      { name: 'rain', defaultIntensity: 1 },
    ],
    initial: 'clear',
  });
  w.dispose();
  assert.equal(w.setWeather('rain'), false);
  w.tick(100);
  assert.equal(w.registerState({ name: 'fog' }), false);
  // Snapshot still readable but inert.
  assert.equal(w.getWeather(), 'clear');
});

test('weather-system: realistic chained transitions over a tick loop', () => {
  const log: string[] = [];
  const settled: Array<{ s: string; i: number }> = [];
  const w = WeatherSystem.create({
    states: [
      { name: 'clear', defaultIntensity: 0 },
      { name: 'rain', defaultIntensity: 0.6 },
      { name: 'storm', defaultIntensity: 1 },
    ],
    initial: 'clear',
    onWeatherChanged: (n) => log.push(n),
    onIntensitySettled: (s, i) => settled.push({ s, i }),
  });
  // clear -> rain over 1s -> storm over 0.5s.
  w.setWeather('rain', { rampMs: 1000 });
  for (let t = 0; t < 1100; t += 50) w.tick(50);
  assert.equal(w.getWeather(), 'rain');
  assert.ok(Math.abs(w.getIntensity() - 0.6) < 1e-6);
  w.setWeather('storm', { rampMs: 500 });
  for (let t = 0; t < 600; t += 50) w.tick(50);
  assert.equal(w.getWeather(), 'storm');
  assert.ok(Math.abs(w.getIntensity() - 1) < 1e-6);
  assert.deepEqual(log, ['rain', 'storm']);
  // Two settles fired (once per ramp completion).
  assert.equal(settled.length, 2);
  assert.equal(settled[0]!.s, 'rain');
  assert.equal(settled[1]!.s, 'storm');
});
