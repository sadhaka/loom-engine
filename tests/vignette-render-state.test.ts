// Phase 0.99.0 - VignetteRenderState tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  VignetteRenderState,
  RESOURCE_VIGNETTE_RENDER_STATE,
} from '../src/index.js';

test('vignette: RESOURCE_VIGNETTE_RENDER_STATE is the stable string', () => {
  assert.equal(RESOURCE_VIGNETTE_RENDER_STATE, 'vignette_render_state');
});

test('vignette: starts empty + getState inactive', () => {
  const v = VignetteRenderState.create();
  assert.equal(v.count(), 0);
  const s = v.getState();
  assert.equal(s.active, false);
  assert.equal(s.alpha, 0);
  assert.equal(s.dominantId, '');
});

test('vignette: upsert adds a source', () => {
  const v = VignetteRenderState.create();
  const ok = v.upsert({
    id: 'low_hp',
    color: { r: 200, g: 30, b: 30 },
    intensity: 0.5,
  });
  assert.equal(ok, true);
  assert.equal(v.count(), 1);
  assert.equal(v.has('low_hp'), true);
});

test('vignette: upsert with same id updates existing', () => {
  const v = VignetteRenderState.create();
  v.upsert({ id: 'a', color: { r: 1, g: 2, b: 3 }, intensity: 0.5 });
  v.upsert({ id: 'a', color: { r: 9, g: 9, b: 9 }, intensity: 0.8 });
  assert.equal(v.count(), 1);
  const s = v.getState();
  assert.equal(s.color.r, 9);
  assert.equal(s.alpha, 0.8);
});

test('vignette: upsert rejects empty / non-string id', () => {
  const v = VignetteRenderState.create();
  assert.equal(v.upsert({ id: '', color: { r: 0, g: 0, b: 0 }, intensity: 1 }), false);
  // @ts-expect-error - testing runtime guard
  assert.equal(v.upsert({ id: null, color: { r: 0, g: 0, b: 0 }, intensity: 1 }), false);
  assert.equal(v.count(), 0);
});

test('vignette: upsert rejects missing color', () => {
  const v = VignetteRenderState.create();
  // @ts-expect-error - testing runtime guard
  assert.equal(v.upsert({ id: 'x', color: null, intensity: 1 }), false);
});

test('vignette: capacity caps new sources, allows updates', () => {
  const v = VignetteRenderState.create({ capacity: 2 });
  assert.equal(v.upsert({ id: 'a', color: { r: 0, g: 0, b: 0 }, intensity: 0.1 }), true);
  assert.equal(v.upsert({ id: 'b', color: { r: 0, g: 0, b: 0 }, intensity: 0.1 }), true);
  // 'c' rejected (full).
  assert.equal(v.upsert({ id: 'c', color: { r: 0, g: 0, b: 0 }, intensity: 0.1 }), false);
  // 'a' update accepted (existing).
  assert.equal(v.upsert({ id: 'a', color: { r: 0, g: 0, b: 0 }, intensity: 0.5 }), true);
  assert.equal(v.count(), 2);
});

test('vignette: remove drops a source', () => {
  const v = VignetteRenderState.create();
  v.upsert({ id: 'a', color: { r: 1, g: 2, b: 3 }, intensity: 0.5 });
  assert.equal(v.remove('a'), true);
  assert.equal(v.count(), 0);
  assert.equal(v.has('a'), false);
});

test('vignette: remove unknown id returns false', () => {
  const v = VignetteRenderState.create();
  assert.equal(v.remove('missing'), false);
});

test('vignette: setIntensity updates an existing source', () => {
  const v = VignetteRenderState.create();
  v.upsert({ id: 'a', color: { r: 1, g: 2, b: 3 }, intensity: 0.5 });
  assert.equal(v.setIntensity('a', 0.9), true);
  assert.equal(v.getState().alpha, 0.9);
});

test('vignette: setIntensity unknown id returns false', () => {
  const v = VignetteRenderState.create();
  assert.equal(v.setIntensity('missing', 0.5), false);
});

test('vignette: setIntensity clamps to [0, 1]', () => {
  const v = VignetteRenderState.create();
  v.upsert({ id: 'a', color: { r: 1, g: 2, b: 3 }, intensity: 0.5 });
  v.setIntensity('a', 5);
  assert.equal(v.getState().alpha, 1);
  v.setIntensity('a', -2);
  assert.equal(v.getState().active, false);
});

test('vignette: getState picks highest effective intensity', () => {
  const v = VignetteRenderState.create();
  v.upsert({ id: 'low', color: { r: 1, g: 0, b: 0 }, intensity: 0.3 });
  v.upsert({ id: 'high', color: { r: 0, g: 1, b: 0 }, intensity: 0.8 });
  v.upsert({ id: 'mid', color: { r: 0, g: 0, b: 1 }, intensity: 0.5 });
  const s = v.getState();
  assert.equal(s.dominantId, 'high');
  assert.equal(s.color.g, 1);
  assert.equal(s.alpha, 0.8);
});

test('vignette: minIntensity filters out near-zero sources', () => {
  const v = VignetteRenderState.create({ minIntensity: 0.1 });
  v.upsert({ id: 'a', color: { r: 1, g: 0, b: 0 }, intensity: 0.05 });
  const s = v.getState();
  assert.equal(s.active, false);
});

test('vignette: pulse modulates effective intensity over time', () => {
  const v = VignetteRenderState.create();
  v.upsert({
    id: 'pulser',
    color: { r: 1, g: 0, b: 0 },
    intensity: 0.5,
    pulseHz: 1,    // 1 cycle/sec
    pulseAmp: 0.4, // +/- 40%
  });
  const start = v.getState().alpha;
  // Start pulse phase = 0 -> sin(0) = 0 -> effective = 0.5 * (1 + 0) = 0.5
  assert.ok(Math.abs(start - 0.5) < 1e-6);
  v.tick(250); // quarter cycle: phase = pi/2, sin = 1, eff = 0.5 * 1.4 = 0.7
  const peak = v.getState().alpha;
  assert.ok(peak > start);
  assert.ok(Math.abs(peak - 0.7) < 1e-3);
  v.tick(500); // half cycle from peak: phase = 3pi/2, sin = -1, eff = 0.5 * 0.6 = 0.3
  const trough = v.getState().alpha;
  assert.ok(trough < start);
  assert.ok(Math.abs(trough - 0.3) < 1e-3);
});

test('vignette: zero pulseHz / pulseAmp leaves intensity flat', () => {
  const v = VignetteRenderState.create();
  v.upsert({ id: 'a', color: { r: 0, g: 0, b: 0 }, intensity: 0.5 });
  v.tick(1000);
  assert.equal(v.getState().alpha, 0.5);
});

test('vignette: pulse phase preserved on intensity update', () => {
  const v = VignetteRenderState.create();
  v.upsert({
    id: 'a',
    color: { r: 0, g: 0, b: 0 },
    intensity: 0.5,
    pulseHz: 1,
    pulseAmp: 0.5,
  });
  v.tick(250); // phase = pi/2
  v.setIntensity('a', 0.8);
  // Phase should still be pi/2 -> effective = 0.8 * 1.5 = 1.0 (clamped 1).
  const s = v.getState();
  assert.ok(Math.abs(s.alpha - 1.0) < 1e-3);
});

test('vignette: NaN / negative dt no-op', () => {
  const v = VignetteRenderState.create();
  v.upsert({
    id: 'a',
    color: { r: 0, g: 0, b: 0 },
    intensity: 0.5,
    pulseHz: 1,
    pulseAmp: 0.5,
  });
  const before = v.getState().alpha;
  v.tick(NaN);
  v.tick(-100);
  v.tick(Infinity);
  assert.equal(v.getState().alpha, before);
});

test('vignette: clear removes all sources', () => {
  const v = VignetteRenderState.create();
  v.upsert({ id: 'a', color: { r: 0, g: 0, b: 0 }, intensity: 0.5 });
  v.upsert({ id: 'b', color: { r: 0, g: 0, b: 0 }, intensity: 0.5 });
  v.clear();
  assert.equal(v.count(), 0);
  assert.equal(v.getState().active, false);
});

test('vignette: forEach + list defensive copies', () => {
  const v = VignetteRenderState.create();
  v.upsert({ id: 'a', color: { r: 1, g: 2, b: 3 }, intensity: 0.5, data: { tag: 'x' } });
  const list = v.list();
  list[0]!.color.r = 99;
  list[0]!.intensity = 99;
  const list2 = v.list();
  assert.equal(list2[0]!.color.r, 1);
  assert.equal(list2[0]!.intensity, 0.5);
  assert.deepEqual(list2[0]!.data, { tag: 'x' });
});

test('vignette: forEach iterates each source', () => {
  const v = VignetteRenderState.create();
  v.upsert({ id: 'a', color: { r: 0, g: 0, b: 0 }, intensity: 0.1 });
  v.upsert({ id: 'b', color: { r: 0, g: 0, b: 0 }, intensity: 0.2 });
  v.upsert({ id: 'c', color: { r: 0, g: 0, b: 0 }, intensity: 0.3 });
  const seen: string[] = [];
  v.forEach((s) => seen.push(s.id));
  assert.deepEqual(seen.sort(), ['a', 'b', 'c']);
});

test('vignette: dispose locks ops', () => {
  const v = VignetteRenderState.create();
  v.upsert({ id: 'a', color: { r: 0, g: 0, b: 0 }, intensity: 0.5 });
  v.dispose();
  assert.equal(v.upsert({ id: 'b', color: { r: 0, g: 0, b: 0 }, intensity: 0.5 }), false);
  assert.equal(v.setIntensity('a', 0.9), false);
  assert.equal(v.remove('a'), false);
  assert.equal(v.count(), 0);
  const s = v.getState();
  assert.equal(s.active, false);
});

test('vignette: realistic example - low-HP red pulse + poison green tint', () => {
  const v = VignetteRenderState.create();
  v.upsert({
    id: 'low_hp',
    color: { r: 200, g: 30, b: 30 },
    intensity: 0.7,
    pulseHz: 1.5,
    pulseAmp: 0.3,
  });
  v.upsert({
    id: 'poison',
    color: { r: 60, g: 200, b: 60 },
    intensity: 0.4,
  });
  v.tick(0); // initial: low_hp at 0.7 dominates poison at 0.4
  const s = v.getState();
  assert.equal(s.dominantId, 'low_hp');
  assert.ok(s.alpha >= 0.69 && s.alpha <= 0.71);
  // Poison wears off -> low_hp continues pulsing.
  v.setIntensity('poison', 0);
  const s2 = v.getState();
  assert.equal(s2.dominantId, 'low_hp');
});
