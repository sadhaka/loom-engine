// Phase 0.24.0 - DebugHUD tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { DebugHUD } from '../src/debug/debug-hud.js';

// Deterministic clock helper.
function makeClock(): { now: () => number; tick: (ms: number) => void } {
  var t = 0;
  return {
    now: function () { return t; },
    tick: function (ms: number) { t += ms; },
  };
}


test('debug-hud: fps starts at 0 before any frames', function () {
  var hud = new DebugHUD();
  assert.equal(hud.fps(), 0);
  assert.equal(hud.frameCount(), 0);
});

test('debug-hud: beginFrame computes fps from delta', function () {
  var clk = makeClock();
  var hud = new DebugHUD({ nowFn: clk.now });
  hud.beginFrame();    // first frame: no prior sample
  clk.tick(1000 / 60); // ~16.67ms
  hud.beginFrame();
  // One sample at ~60 fps.
  assert.ok(Math.abs(hud.fps() - 60) < 1.5,
    'fps should approximate 60; got ' + hud.fps());
});

test('debug-hud: fps averages over rolling window', function () {
  var clk = makeClock();
  var hud = new DebugHUD({ nowFn: clk.now });
  hud.beginFrame();
  // 5 frames at 60 fps then 5 frames at 30 fps -> avg ~45.
  for (var i = 0; i < 5; i++) {
    clk.tick(1000 / 60);
    hud.beginFrame();
  }
  for (var j = 0; j < 5; j++) {
    clk.tick(1000 / 30);
    hud.beginFrame();
  }
  assert.ok(hud.fps() > 35 && hud.fps() < 55,
    'mixed window should land mid-band; got ' + hud.fps());
});

test('debug-hud: fpsRange reports min + max from window', function () {
  var clk = makeClock();
  var hud = new DebugHUD({ nowFn: clk.now });
  hud.beginFrame();
  clk.tick(1000 / 120); hud.beginFrame();  // 120 fps
  clk.tick(1000 / 30);  hud.beginFrame();  // 30 fps
  var r = hud.fpsRange();
  assert.ok(r.min < r.max);
  assert.ok(r.min < 35);
  assert.ok(r.max > 100);
});

test('debug-hud: frameCount monotonically increments', function () {
  var clk = makeClock();
  var hud = new DebugHUD({ nowFn: clk.now });
  for (var i = 0; i < 10; i++) hud.beginFrame();
  assert.equal(hud.frameCount(), 10);
});

test('debug-hud: addLine + toText round-trip', function () {
  var clk = makeClock();
  var hud = new DebugHUD({ nowFn: clk.now });
  hud.addLine('entities', '42');
  hud.addLine('plugins', function () { return '7'; });
  var text = hud.toText();
  assert.ok(text.includes('entities: 42'));
  assert.ok(text.includes('plugins: 7'));
  assert.ok(text.startsWith('fps: '));
});

test('debug-hud: dynamic value thunk is re-evaluated each render', function () {
  var hud = new DebugHUD();
  var counter = 0;
  hud.addLine('count', function () { counter++; return String(counter); });
  hud.toText();
  hud.toText();
  hud.toText();
  // First call increments to 1; second to 2; third to 3.
  assert.equal(counter, 3);
});

test('debug-hud: clearLines drops custom lines but keeps built-ins', function () {
  var hud = new DebugHUD();
  hud.addLine('a', '1');
  hud.addLine('b', '2');
  assert.equal(hud.lineCount(), 2);
  hud.clearLines();
  assert.equal(hud.lineCount(), 0);
  // Built-in lines (fps, frame, range) still appear.
  var text = hud.toText();
  assert.ok(text.includes('fps:'));
  assert.ok(text.includes('frame:'));
});

test('debug-hud: thunk that throws renders <error>', function () {
  var hud = new DebugHUD();
  hud.addLine('boom', function () { throw new Error('bang'); });
  var text = hud.toText();
  assert.ok(text.includes('boom: <error>'),
    'thrown thunk should render <error>; got ' + text);
});

test('debug-hud: render returns same text as toText', function () {
  var hud = new DebugHUD();
  hud.addLine('x', '1');
  var a = hud.toText();
  var b = hud.render();
  assert.equal(a, b);
});

test('debug-hud: attachToDom requires DOM (headless throws)', function () {
  // Tests run under Node where document is undefined.
  var hud = new DebugHUD();
  assert.throws(function () {
    hud.attachToDom({} as unknown as HTMLElement);
  }, /requires a DOM/);
});
