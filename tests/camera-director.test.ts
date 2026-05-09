// Phase 1.1.3 - CameraDirector tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  CameraDirector,
  RESOURCE_CAMERA_DIRECTOR,
} from '../src/index.js';

test('camdir: RESOURCE_CAMERA_DIRECTOR is the stable string', () => {
  assert.equal(RESOURCE_CAMERA_DIRECTOR, 'camera_director');
});

test('camdir: starts not playing + at initial state', () => {
  const dir = CameraDirector.create({ initial: { x: 5, y: 7, zoom: 2 } });
  const s = dir.getState();
  assert.equal(s.isPlaying, false);
  assert.equal(s.x, 5);
  assert.equal(s.y, 7);
  assert.equal(s.zoom, 2);
});

test('camdir: play with empty keyframes returns false', () => {
  const dir = CameraDirector.create();
  assert.equal(dir.play({ keyframes: [] }), false);
  assert.equal(dir.isPlaying(), false);
});

test('camdir: play sets isPlaying + snaps to first keyframe', () => {
  const dir = CameraDirector.create();
  const ok = dir.play({
    keyframes: [
      { atMs: 0, x: 100, y: 50, zoom: 1 },
      { atMs: 1000, x: 200, y: 100, zoom: 2 },
    ],
  });
  assert.equal(ok, true);
  const s = dir.getState();
  assert.equal(s.isPlaying, true);
  assert.equal(s.x, 100);
  assert.equal(s.y, 50);
});

test('camdir: tick advances elapsed', () => {
  const dir = CameraDirector.create();
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1 },
      { atMs: 1000, x: 100, y: 100, zoom: 2 },
    ],
  });
  dir.tick(250);
  const s = dir.getState();
  assert.equal(s.elapsedMs, 250);
});

test('camdir: linear interpolation produces midpoint', () => {
  const dir = CameraDirector.create();
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1 },
      { atMs: 1000, x: 100, y: 50, zoom: 3, easing: 'linear' },
    ],
  });
  dir.tick(500);
  const s = dir.getState();
  assert.ok(Math.abs(s.x - 50) < 1e-6);
  assert.ok(Math.abs(s.y - 25) < 1e-6);
  assert.ok(Math.abs(s.zoom - 2) < 1e-6);
});

test('camdir: easeInOut symmetric at t=0.5', () => {
  const dir = CameraDirector.create();
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1 },
      { atMs: 1000, x: 100, y: 0, zoom: 1, easing: 'easeInOut' },
    ],
  });
  dir.tick(500);
  const s = dir.getState();
  // easeInOut at t=0.5 = 0.5.
  assert.ok(Math.abs(s.x - 50) < 1e-6);
});

test('camdir: easeIn at t=0.5 < linear midpoint', () => {
  const dir = CameraDirector.create();
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1 },
      { atMs: 1000, x: 100, y: 0, zoom: 1, easing: 'easeIn' },
    ],
  });
  dir.tick(500);
  const s = dir.getState();
  // easeIn t=0.5 -> t*t = 0.25. x = 0 + 100*0.25 = 25.
  assert.ok(Math.abs(s.x - 25) < 1e-6);
});

test('camdir: easeOut at t=0.5 > linear midpoint', () => {
  const dir = CameraDirector.create();
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1 },
      { atMs: 1000, x: 100, y: 0, zoom: 1, easing: 'easeOut' },
    ],
  });
  dir.tick(500);
  const s = dir.getState();
  // easeOut t=0.5 -> 1-(0.5)^2 = 0.75. x = 75.
  assert.ok(Math.abs(s.x - 75) < 1e-6);
});

test('camdir: step easing snaps until t=1', () => {
  const dir = CameraDirector.create();
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1 },
      { atMs: 1000, x: 100, y: 0, zoom: 1, easing: 'step' },
    ],
  });
  dir.tick(999);
  // Step easing: t < 1 -> stay at from value (0).
  assert.ok(Math.abs(dir.getState().x - 0) < 1e-6);
  dir.tick(1); // reaches the end (lastAt), triggers natural finish.
  // After natural completion, state snaps to final keyframe (100).
  assert.ok(Math.abs(dir.getState().x - 100) < 1e-6);
});

test('camdir: rotation interpolates', () => {
  const dir = CameraDirector.create();
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1, rotation: 0 },
      { atMs: 1000, x: 0, y: 0, zoom: 1, rotation: Math.PI },
    ],
  });
  dir.tick(500);
  const s = dir.getState();
  assert.ok(Math.abs(s.rotation - Math.PI / 2) < 1e-6);
});

test('camdir: multi-keyframe sequence transitions correctly', () => {
  const dir = CameraDirector.create();
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1 },
      { atMs: 500, x: 100, y: 0, zoom: 1 },
      { atMs: 1000, x: 100, y: 0, zoom: 3 }, // hold position, zoom in
    ],
  });
  // Mid first segment.
  dir.tick(250);
  let s = dir.getState();
  assert.ok(Math.abs(s.x - 50) < 1e-6);
  // Mid second segment.
  dir.tick(500); // total 750
  s = dir.getState();
  assert.ok(Math.abs(s.x - 100) < 1e-6); // position held
  assert.ok(Math.abs(s.zoom - 2) < 1e-6); // zoom interp
});

test('camdir: onFinish fires when sequence ends', () => {
  let finished = false;
  const dir = CameraDirector.create();
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1 },
      { atMs: 100, x: 100, y: 0, zoom: 1 },
    ],
    onFinish: () => { finished = true; },
  });
  dir.tick(50);
  assert.equal(finished, false);
  dir.tick(60); // crosses 100
  assert.equal(finished, true);
  assert.equal(dir.isPlaying(), false);
});

test('camdir: pause stops advancement; resume continues', () => {
  const dir = CameraDirector.create();
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1 },
      { atMs: 1000, x: 100, y: 0, zoom: 1 },
    ],
  });
  dir.tick(200);
  dir.pause();
  assert.equal(dir.isPaused(), true);
  dir.tick(500);
  // No advancement during pause.
  assert.equal(dir.getState().elapsedMs, 200);
  dir.resume();
  dir.tick(300);
  assert.equal(dir.getState().elapsedMs, 500);
});

test('camdir: stop returns to initial + does not fire onFinish', () => {
  let finished = false;
  const dir = CameraDirector.create({ initial: { x: 5, y: 5, zoom: 1 } });
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1 },
      { atMs: 1000, x: 100, y: 0, zoom: 1 },
    ],
    onFinish: () => { finished = true; },
  });
  dir.tick(500);
  dir.stop();
  assert.equal(dir.isPlaying(), false);
  assert.equal(finished, false);
  const s = dir.getState();
  assert.equal(s.x, 5);
  assert.equal(s.y, 5);
});

test('camdir: setSpeed multiplies dt', () => {
  const dir = CameraDirector.create();
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1 },
      { atMs: 1000, x: 100, y: 0, zoom: 1 },
    ],
  });
  dir.setSpeed(2);
  dir.tick(250);
  // 250ms * 2 = 500ms elapsed.
  assert.equal(dir.getState().elapsedMs, 500);
});

test('camdir: jumpTo scrubs to specific time', () => {
  const dir = CameraDirector.create();
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1 },
      { atMs: 1000, x: 100, y: 0, zoom: 1 },
    ],
  });
  dir.jumpTo(750);
  const s = dir.getState();
  assert.equal(s.elapsedMs, 750);
  assert.ok(Math.abs(s.x - 75) < 1e-6);
});

test('camdir: jumpTo clamps to range', () => {
  const dir = CameraDirector.create();
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1 },
      { atMs: 1000, x: 100, y: 0, zoom: 1 },
    ],
  });
  dir.jumpTo(-100);
  assert.equal(dir.getState().elapsedMs, 0);
  dir.jumpTo(99999);
  assert.equal(dir.getState().elapsedMs, 1000);
});

test('camdir: progress reports 0..1', () => {
  const dir = CameraDirector.create();
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1 },
      { atMs: 1000, x: 100, y: 0, zoom: 1 },
    ],
  });
  dir.tick(250);
  assert.ok(Math.abs(dir.getState().progress - 0.25) < 1e-6);
});

test('camdir: NaN / negative / Infinity dt no-op', () => {
  const dir = CameraDirector.create();
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1 },
      { atMs: 1000, x: 100, y: 0, zoom: 1 },
    ],
  });
  dir.tick(NaN);
  dir.tick(-50);
  dir.tick(Infinity);
  assert.equal(dir.getState().elapsedMs, 0);
});

test('camdir: throwing onFinish isolated', () => {
  const dir = CameraDirector.create();
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1 },
      { atMs: 100, x: 100, y: 0, zoom: 1 },
    ],
    onFinish: () => { throw new Error('boom'); },
  });
  dir.tick(150);
  // Should not throw.
  assert.equal(dir.isPlaying(), false);
});

test('camdir: play replaces previous sequence', () => {
  const dir = CameraDirector.create();
  let first = false;
  let second = false;
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1 },
      { atMs: 1000, x: 100, y: 0, zoom: 1 },
    ],
    onFinish: () => { first = true; },
  });
  dir.tick(200);
  dir.play({
    keyframes: [
      { atMs: 0, x: 50, y: 50, zoom: 2 },
      { atMs: 100, x: 60, y: 60, zoom: 2 },
    ],
    onFinish: () => { second = true; },
  });
  dir.tick(150);
  assert.equal(first, false);
  assert.equal(second, true);
});

test('camdir: dispose locks ops', () => {
  const dir = CameraDirector.create();
  dir.play({
    keyframes: [{ atMs: 0, x: 0, y: 0, zoom: 1 }, { atMs: 100, x: 1, y: 0, zoom: 1 }],
  });
  dir.dispose();
  assert.equal(dir.play({ keyframes: [{ atMs: 0, x: 0, y: 0, zoom: 1 }] }), false);
  dir.tick(50);
  assert.equal(dir.isPlaying(), false);
});

test('camdir: realistic example - boss reveal sequence', () => {
  const dir = CameraDirector.create({ initial: { x: 0, y: 0, zoom: 1 } });
  let done = false;
  dir.play({
    keyframes: [
      { atMs: 0, x: 0, y: 0, zoom: 1 },
      { atMs: 800, x: 200, y: 100, zoom: 2.5, easing: 'easeInOut' },
      { atMs: 1500, x: 200, y: 100, zoom: 2.5 }, // hold
      { atMs: 2000, x: 0, y: 0, zoom: 1, easing: 'easeInOut' },
    ],
    onFinish: () => { done = true; },
  });
  // Drive the sequence to completion.
  dir.tick(2100);
  assert.equal(done, true);
  // Camera back at initial.
  const s = dir.getState();
  assert.equal(s.x, 0);
  assert.equal(s.y, 0);
  assert.equal(s.zoom, 1);
});
