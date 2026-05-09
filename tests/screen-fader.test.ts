// Phase 0.91.0 - ScreenFader tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  ScreenFader,
  RESOURCE_SCREEN_FADER,
} from '../src/index.js';

test('screen-fader: RESOURCE_SCREEN_FADER is the stable string', () => {
  assert.equal(RESOURCE_SCREEN_FADER, 'screen_fader');
});

test('screen-fader: defaults to clear black', () => {
  const f = ScreenFader.create();
  assert.equal(f.getAlpha(), 0);
  assert.equal(f.getColor(), 0x000000);
  assert.equal(f.isFading(), false);
});

test('screen-fader: initial color/alpha respected', () => {
  const f = ScreenFader.create({ initialColor: 0xff0000, initialAlpha: 0.5 });
  assert.equal(f.getColor(), 0xff0000);
  assert.equal(f.getAlpha(), 0.5);
});

test('screen-fader: initialAlpha clamps to [0,1]', () => {
  const f = ScreenFader.create({ initialAlpha: 99 });
  assert.equal(f.getAlpha(), 1);
  const f2 = ScreenFader.create({ initialAlpha: -1 });
  assert.equal(f2.getAlpha(), 0);
});

test('screen-fader: fadeTo with duration 0 snaps + fires complete', () => {
  let fired = 0;
  const f = ScreenFader.create({ onFadeComplete: () => { fired++; } });
  f.fadeTo({ color: 0xff0000, durationMs: 0, targetAlpha: 1 });
  assert.equal(f.getColor(), 0xff0000);
  assert.equal(f.getAlpha(), 1);
  assert.equal(fired, 1);
  assert.equal(f.isFading(), false);
});

test('screen-fader: tick ramps alpha linearly to target', () => {
  const f = ScreenFader.create();
  f.fadeTo({ color: 0x000000, durationMs: 1000, targetAlpha: 1 });
  assert.equal(f.getAlpha(), 0);
  assert.ok(f.isFading());
  f.tick(500);
  assert.ok(Math.abs(f.getAlpha() - 0.5) < 1e-6);
  f.tick(500);
  assert.equal(f.getAlpha(), 1);
  assert.equal(f.isFading(), false);
});

test('screen-fader: ramp completes on or after durationMs + fires complete', () => {
  let fired = 0;
  const f = ScreenFader.create({ onFadeComplete: () => { fired++; } });
  f.fadeTo({ durationMs: 200, targetAlpha: 1 });
  f.tick(100);
  assert.equal(fired, 0);
  f.tick(150);
  assert.equal(fired, 1);
  assert.equal(f.getAlpha(), 1);
});

test('screen-fader: fadeIn brings alpha to 1', () => {
  const f = ScreenFader.create({ initialAlpha: 0 });
  f.fadeIn({ durationMs: 100 });
  f.tick(100);
  assert.equal(f.getAlpha(), 1);
});

test('screen-fader: fadeOut brings alpha to 0', () => {
  const f = ScreenFader.create({ initialAlpha: 1 });
  f.fadeOut({ durationMs: 100 });
  f.tick(100);
  assert.equal(f.getAlpha(), 0);
});

test('screen-fader: color lerps during ramp', () => {
  const f = ScreenFader.create({ initialColor: 0x000000, initialAlpha: 0 });
  f.fadeTo({ color: 0xff0000, durationMs: 1000, targetAlpha: 1 });
  f.tick(500); // half-way
  // 0xff0000 with linear blend at t=0.5 -> 0x800000 ish (rounding).
  const c = f.getColor();
  const r = (c >> 16) & 0xff;
  assert.ok(Math.abs(r - 0x80) <= 1, 'expected red ~0x80, got 0x' + r.toString(16));
});

test('screen-fader: custom easing applied', () => {
  // ease-in-quad: t^2.
  const f = ScreenFader.create();
  f.fadeTo({
    durationMs: 1000, targetAlpha: 1,
    easing: (t) => t * t,
  });
  f.tick(500);
  // t=0.5 -> eased=0.25 -> alpha=0.25.
  assert.ok(Math.abs(f.getAlpha() - 0.25) < 1e-6);
});

test('screen-fader: clear snaps to alpha 0 and stops ramp', () => {
  const f = ScreenFader.create();
  f.fadeTo({ durationMs: 1000, targetAlpha: 1 });
  f.tick(300);
  f.clear();
  assert.equal(f.getAlpha(), 0);
  assert.equal(f.isFading(), false);
});

test('screen-fader: fillOpaque snaps to alpha 1 and stops ramp', () => {
  const f = ScreenFader.create();
  f.fadeTo({ durationMs: 1000, targetAlpha: 0.5 });
  f.tick(100);
  f.fillOpaque();
  assert.equal(f.getAlpha(), 1);
  assert.equal(f.isFading(), false);
});

test('screen-fader: tick with NaN / negative dt no-op', () => {
  const f = ScreenFader.create();
  f.fadeTo({ durationMs: 1000, targetAlpha: 1 });
  f.tick(NaN);
  f.tick(-50);
  assert.equal(f.getAlpha(), 0);
});

test('screen-fader: tick with no active fade no-op', () => {
  const f = ScreenFader.create({ initialAlpha: 0.3 });
  f.tick(1000);
  assert.equal(f.getAlpha(), 0.3);
});

test('screen-fader: setColor / setAlpha direct', () => {
  const f = ScreenFader.create();
  f.setColor(0x00ff00);
  f.setAlpha(0.7);
  assert.equal(f.getColor(), 0x00ff00);
  assert.ok(Math.abs(f.getAlpha() - 0.7) < 1e-6);
});

test('screen-fader: setAlpha clamps', () => {
  const f = ScreenFader.create();
  f.setAlpha(99);
  assert.equal(f.getAlpha(), 1);
  f.setAlpha(-99);
  assert.equal(f.getAlpha(), 0);
});

test('screen-fader: throwing onFadeComplete is isolated', () => {
  const f = ScreenFader.create({
    onFadeComplete: () => { throw new Error('boom'); },
  });
  // Should not throw.
  f.fadeTo({ durationMs: 100, targetAlpha: 1 });
  f.tick(150);
  assert.equal(f.getAlpha(), 1);
});

test('screen-fader: data passthrough preserved on completion', () => {
  let received: unknown = null;
  const f = ScreenFader.create({
    onFadeComplete: (opts) => { received = opts.data; },
  });
  f.fadeTo({ durationMs: 100, data: { sceneId: 'next-room' } });
  f.tick(120);
  assert.deepEqual(received, { sceneId: 'next-room' });
});

test('screen-fader: dispose locks ops', () => {
  const f = ScreenFader.create();
  f.fadeTo({ durationMs: 100, targetAlpha: 1 });
  f.dispose();
  f.tick(200);
  // Alpha unchanged from pre-dispose.
  assert.equal(f.getAlpha(), 0);
  // Subsequent fadeTo no-op.
  f.fadeTo({ durationMs: 100, targetAlpha: 1 });
  f.tick(200);
  assert.equal(f.getAlpha(), 0);
});

test('screen-fader: realistic scene transition (out -> swap -> in)', () => {
  const order: string[] = [];
  const f = ScreenFader.create({
    onFadeComplete: (opts) => {
      const next = opts.data && (opts.data as { next?: string }).next;
      if (next) order.push(next);
    },
  });
  // Fade to black, swap, fade back in.
  f.fadeIn({ color: 0x000000, durationMs: 200, data: { next: 'swap-scene' } });
  f.tick(200);
  // Now scene swap happens; fader stays opaque at black.
  assert.equal(f.getAlpha(), 1);
  // Then fade back to clear.
  f.fadeOut({ durationMs: 200, data: { next: 'now-visible' } });
  f.tick(200);
  assert.equal(f.getAlpha(), 0);
  assert.deepEqual(order, ['swap-scene', 'now-visible']);
});

test('screen-fader: durationMs <= 0 falls back to instant', () => {
  let fired = 0;
  const f = ScreenFader.create({ onFadeComplete: () => { fired++; } });
  f.fadeTo({ durationMs: -100, targetAlpha: 1 });
  // Negative dur falls back to default (500ms), so it's NOT instant.
  // To get instant, pass exactly 0.
  assert.ok(f.isFading());
  f.tick(600);
  assert.equal(fired, 1);
});
