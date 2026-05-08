// Phase 0.27.0 - CameraController tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { createCamera } from '../src/renderer/camera.js';
import {
  CameraController,
} from '../src/renderer/camera-controller.js';


test('camera-controller: snapTo immediate reposition', function () {
  var view = createCamera(800, 600);
  var ctrl = new CameraController(view);
  ctrl.snapTo(100, 200);
  assert.equal(view.centerX, 100);
  assert.equal(view.centerY, 200);
});

test('camera-controller: followTarget lerps toward target each update', function () {
  var view = createCamera(800, 600);
  var ctrl = new CameraController(view, { defaultSmoothing: 0.5 });
  ctrl.followTarget(100, 0);
  // After one update with smoothing=0.5, should close half the gap.
  ctrl.update(0.016);
  assert.ok(view.centerX > 49 && view.centerX < 51,
    'centerX should be ~50 after one update; got ' + view.centerX);
  // After many updates, converges near target.
  for (var i = 0; i < 30; i++) ctrl.update(0.016);
  assert.ok(Math.abs(view.centerX - 100) < 0.1);
});

test('camera-controller: clearFollow stops the lerp', function () {
  var view = createCamera(800, 600);
  var ctrl = new CameraController(view, { defaultSmoothing: 0.5 });
  ctrl.followTarget(100, 0);
  ctrl.update(0.016);
  var afterFirst = view.centerX;
  ctrl.clearFollow();
  // No further movement.
  for (var i = 0; i < 10; i++) ctrl.update(0.016);
  assert.equal(view.centerX, afterFirst);
});

test('camera-controller: shake decays to zero offset', function () {
  var view = createCamera(800, 600);
  // Random returns 0.5 -> 0 offset; we want non-zero so use 1.0.
  var ctrl = new CameraController(view, { randomFn: function () { return 1; } });
  ctrl.snapTo(0, 0);
  ctrl.shake(10, 100);  // amp=10 world units, 100ms duration
  ctrl.update(0.05); // 50ms; ~half decay
  var off = ctrl.getShakeOffset();
  // Random=1 -> (2*1-1)=1, so offset = 1 * (10 * 0.5) = 5.
  assert.ok(Math.abs(off.x - 5) < 0.01,
    'shake offset should be 5 at half-decay; got ' + off.x);
  // Run past total duration; offset should be 0.
  ctrl.update(0.06);
  off = ctrl.getShakeOffset();
  assert.equal(off.x, 0);
  assert.equal(off.y, 0);
});

test('camera-controller: shake replaces an active shake', function () {
  var view = createCamera(800, 600);
  var ctrl = new CameraController(view);
  ctrl.shake(5, 200);
  ctrl.shake(10, 100);  // replace
  // We can't introspect internal state directly; test that after
  // 100ms the shake is fully decayed (the second shake ended).
  ctrl.update(0.1);
  var off = ctrl.getShakeOffset();
  assert.equal(off.x, 0);
});

test('camera-controller: shake with invalid duration cancels', function () {
  var view = createCamera(800, 600);
  var ctrl = new CameraController(view);
  ctrl.shake(5, 100);
  ctrl.shake(5, 0);  // cancels
  ctrl.update(0.016);
  var off = ctrl.getShakeOffset();
  assert.equal(off.x, 0);
});

test('camera-controller: setBounds clamps view center', function () {
  var view = createCamera(200, 200);  // viewport 200x200
  var ctrl = new CameraController(view);
  // Bounds are world rect (0..1000, 0..1000); zoom=1 so halfW=100.
  ctrl.setBounds({ x: 0, y: 0, width: 1000, height: 1000 });
  ctrl.snapTo(50, 500);  // 50 < halfW=100; should clamp to 100.
  assert.equal(view.centerX, 100);
  ctrl.snapTo(950, 500);  // > 1000-100; clamps to 900.
  assert.equal(view.centerX, 900);
  ctrl.snapTo(500, 500);  // inside, no clamp.
  assert.equal(view.centerX, 500);
});

test('camera-controller: setBounds(null) disables clamp', function () {
  var view = createCamera(200, 200);
  var ctrl = new CameraController(view);
  ctrl.setBounds({ x: 0, y: 0, width: 1000, height: 1000 });
  ctrl.snapTo(50, 50);
  assert.equal(view.centerX, 100);  // clamped
  ctrl.setBounds(null);
  ctrl.snapTo(50, 50);
  assert.equal(view.centerX, 50);  // not clamped
});

test('camera-controller: fit centers + zooms to show rect with padding', function () {
  var view = createCamera(800, 600);  // 800x600 viewport
  var ctrl = new CameraController(view);
  // Fit a 200x100 rect at (1000, 500) with 0 padding.
  // zoomX = 800/200 = 4; zoomY = 600/100 = 6; min = 4.
  ctrl.fit({ x: 1000, y: 500, width: 200, height: 100 });
  assert.equal(view.zoom, 4);
  assert.equal(view.centerX, 1100);  // x + width/2
  assert.equal(view.centerY, 550);   // y + height/2
});

test('camera-controller: fit honors padding', function () {
  var view = createCamera(800, 600);
  var ctrl = new CameraController(view);
  // 100px padding shrinks available area to 600x400.
  // Rect 200x100 -> zoom = min(600/200, 400/100) = min(3, 4) = 3.
  ctrl.fit({ x: 0, y: 0, width: 200, height: 100 }, 100);
  assert.equal(view.zoom, 3);
});

test('camera-controller: tiny world centers when bounds smaller than viewport', function () {
  var view = createCamera(400, 400);
  var ctrl = new CameraController(view);
  // Bounds 100x100 - smaller than 400x400 viewport.
  ctrl.setBounds({ x: 50, y: 50, width: 100, height: 100 });
  ctrl.snapTo(0, 0);  // arbitrary
  // Should center on the bounds midpoint.
  assert.equal(view.centerX, 100);
  assert.equal(view.centerY, 100);
});

test('camera-controller: invalid dt rejects (no NaN propagation)', function () {
  var view = createCamera(800, 600);
  var ctrl = new CameraController(view);
  ctrl.snapTo(0, 0);
  ctrl.followTarget(100, 0);
  ctrl.update(NaN);
  assert.ok(isFinite(view.centerX));
});
