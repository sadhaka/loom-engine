// Phase 1.4.1 - AudioDuck tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  AudioDuck,
  RESOURCE_AUDIO_DUCK,
} from '../src/index.js';

test('duck: RESOURCE_AUDIO_DUCK is the stable string', () => {
  assert.equal(RESOURCE_AUDIO_DUCK, 'audio_duck');
});

test('duck: starts empty', () => {
  const d = AudioDuck.create();
  assert.equal(d.channelCount(), 0);
  assert.equal(d.eventCount(), 0);
});

test('duck: registerChannel + hasChannel', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'music', baseVolume: 0.8 });
  assert.equal(d.hasChannel('music'), true);
  const ch = d.getChannel('music');
  assert.equal(ch!.baseVolume, 0.8);
});

test('duck: registerChannel rejects empty id', () => {
  const d = AudioDuck.create();
  assert.equal(d.registerChannel({ id: '' }), false);
});

test('duck: registerChannel clamps baseVolume', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'a', baseVolume: 5 });
  d.registerChannel({ id: 'b', baseVolume: -1 });
  assert.equal(d.getChannel('a')!.baseVolume, 1);
  assert.equal(d.getChannel('b')!.baseVolume, 0);
});

test('duck: setBaseVolume updates', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'music', baseVolume: 1 });
  d.setBaseVolume('music', 0.5);
  assert.equal(d.getChannel('music')!.baseVolume, 0.5);
});

test('duck: triggerDuck rejects empty id', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'music' });
  assert.equal(d.triggerDuck({ id: '' }), false);
});

test('duck: triggerDuck rejects when no channels exist', () => {
  const d = AudioDuck.create();
  assert.equal(d.triggerDuck({ id: 'roar' }), false);
});

test('duck: triggerDuck duplicate id rejected', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'music' });
  d.triggerDuck({ id: 'roar' });
  assert.equal(d.triggerDuck({ id: 'roar' }), false);
});

test('duck: attack ramps multiplier 1 -> duckTo', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'music', baseVolume: 1 });
  d.triggerDuck({
    id: 'roar', durationMs: 1000,
    attackMs: 100, releaseMs: 500, duckTo: 0.2,
  });
  // Just triggered, attack just starting -> volume near 1.
  assert.ok(d.getChannel('music')!.volume > 0.9);
  d.tick(50); // halfway through attack
  const half = d.getChannel('music')!.volume;
  assert.ok(half > 0.5 && half < 0.7); // around 0.6
  d.tick(50); // attack complete
  assert.ok(Math.abs(d.getChannel('music')!.volume - 0.2) < 0.05);
});

test('duck: hold phase keeps multiplier at duckTo', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'music', baseVolume: 1 });
  d.triggerDuck({
    id: 'roar', durationMs: 1000,
    attackMs: 100, releaseMs: 100, duckTo: 0.3,
  });
  d.tick(100); // attack done
  d.tick(500); // mid-hold
  assert.ok(Math.abs(d.getChannel('music')!.volume - 0.3) < 0.05);
});

test('duck: release ramps multiplier duckTo -> 1', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'music', baseVolume: 1 });
  d.triggerDuck({
    id: 'roar', durationMs: 100,
    attackMs: 100, releaseMs: 200, duckTo: 0.2,
  });
  d.tick(100); // attack done
  d.tick(100); // hold done
  d.tick(100); // halfway through release
  const half = d.getChannel('music')!.volume;
  assert.ok(half > 0.4 && half < 0.8); // around 0.6
  d.tick(100); // release complete
  assert.ok(d.getChannel('music')!.volume > 0.95);
});

test('duck: multiplier applied to baseVolume', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'music', baseVolume: 0.5 });
  d.triggerDuck({
    id: 'roar', durationMs: 1000,
    attackMs: 0, releaseMs: 500, duckTo: 0.4,
  });
  d.tick(0); // shouldn't tick anything but values still computed
  // Actually NaN/0 dt is a no-op, so let's tick a tiny amount.
  d.tick(1);
  // duckTo=0.4 multiplier on 0.5 base = 0.2.
  const ch = d.getChannel('music');
  assert.ok(Math.abs(ch!.volume - 0.2) < 0.05);
  assert.equal(ch!.baseVolume, 0.5);
});

test('duck: cancelDuck transitions to release', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'music', baseVolume: 1 });
  d.triggerDuck({
    id: 'roar', durationMs: 10000,
    attackMs: 100, releaseMs: 100, duckTo: 0.2,
  });
  d.tick(150); // attack + into hold
  d.cancelDuck('roar');
  d.tick(150); // release complete
  assert.ok(d.getChannel('music')!.volume > 0.95);
});

test('duck: cancelDuck unknown id returns false', () => {
  const d = AudioDuck.create();
  assert.equal(d.cancelDuck('nope'), false);
});

test('duck: durationMs=0 means manual-cancel only', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'music', baseVolume: 1 });
  d.triggerDuck({
    id: 'roar', durationMs: 0,
    attackMs: 100, releaseMs: 100, duckTo: 0.2,
  });
  d.tick(100); // attack done -> hold (with duration 0, holds forever)
  d.tick(5000);
  assert.ok(d.getChannel('music')!.volume < 0.3); // still ducked
  d.cancelDuck('roar');
  d.tick(150); // release
  assert.ok(d.getChannel('music')!.volume > 0.95);
});

test('duck: multiple ducks on same channel - deepest wins', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'music', baseVolume: 1 });
  d.triggerDuck({
    id: 'soft', durationMs: 5000, attackMs: 0, releaseMs: 500, duckTo: 0.6,
  });
  d.triggerDuck({
    id: 'loud', durationMs: 5000, attackMs: 0, releaseMs: 500, duckTo: 0.2,
  });
  d.tick(50);
  // Deepest (loud, 0.2) wins.
  assert.ok(d.getChannel('music')!.volume < 0.3);
});

test('duck: duck affects only specified channels', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'music', baseVolume: 1 });
  d.registerChannel({ id: 'ambient', baseVolume: 1 });
  d.triggerDuck({
    id: 'roar', durationMs: 1000, attackMs: 0, releaseMs: 500,
    duckTo: 0.2, channels: ['music'],
  });
  d.tick(50);
  assert.ok(d.getChannel('music')!.volume < 0.3);
  assert.ok(d.getChannel('ambient')!.volume > 0.95);
});

test('duck: duck without explicit channels affects all', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'music' });
  d.registerChannel({ id: 'ambient' });
  d.triggerDuck({
    id: 'roar', durationMs: 1000, attackMs: 0, releaseMs: 500, duckTo: 0.3,
  });
  d.tick(50);
  assert.ok(d.getChannel('music')!.volume < 0.4);
  assert.ok(d.getChannel('ambient')!.volume < 0.4);
});

test('duck: event auto-removes after release completes', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'music', baseVolume: 1 });
  d.triggerDuck({
    id: 'roar', durationMs: 100, attackMs: 100, releaseMs: 100, duckTo: 0.2,
  });
  d.tick(100); // attack
  d.tick(100); // hold
  d.tick(100); // release
  d.tick(50); // event finalized + removed
  assert.equal(d.hasEvent('roar'), false);
});

test('duck: NaN / negative dt no-op', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'music', baseVolume: 1 });
  d.triggerDuck({
    id: 'roar', durationMs: 1000, attackMs: 100, releaseMs: 500, duckTo: 0.2,
  });
  d.tick(NaN);
  d.tick(-50);
  d.tick(Infinity);
  // Still in attack phase, mostly unducked.
  assert.ok(d.getChannel('music')!.volume > 0.95);
});

test('duck: throwing forEach callback isolated', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'a' });
  d.forEach(() => { throw new Error('boom'); });
  assert.equal(d.channelCount(), 1);
});

test('duck: clear empties + dispose locks', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'music' });
  d.triggerDuck({ id: 'roar' });
  d.clear();
  assert.equal(d.channelCount(), 0);
  d.dispose();
  assert.equal(d.registerChannel({ id: 'b' }), false);
});

test('duck: realistic example - boss roar ducks music + ambient', () => {
  const d = AudioDuck.create();
  d.registerChannel({ id: 'music', baseVolume: 1 });
  d.registerChannel({ id: 'ambient', baseVolume: 0.7 });
  d.registerChannel({ id: 'sfx', baseVolume: 1 }); // not ducked
  d.triggerDuck({
    id: 'boss_roar',
    durationMs: 2000, attackMs: 100, releaseMs: 800, duckTo: 0.25,
    channels: ['music', 'ambient'],
  });
  d.tick(100); // attack done
  // music: 1 * 0.25 = 0.25, ambient: 0.7 * 0.25 = 0.175.
  assert.ok(Math.abs(d.getChannel('music')!.volume - 0.25) < 0.05);
  assert.ok(Math.abs(d.getChannel('ambient')!.volume - 0.175) < 0.05);
  assert.equal(d.getChannel('sfx')!.volume, 1);
  // Hold then release.
  d.tick(2000);
  d.tick(800);
  d.tick(50);
  assert.equal(d.hasEvent('boss_roar'), false);
});
