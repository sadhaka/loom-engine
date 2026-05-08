// Phase 0.44.0 - SpatialAudioCurves tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  linearAttenuation,
  inverseAttenuation,
  exponentialAttenuation,
  attenuationByModel,
  AttenuationRegistry,
  RESOURCE_ATTENUATION_REGISTRY,
  type AttenuationFn,
} from '../src/index.js';

test('attenuation: RESOURCE_ATTENUATION_REGISTRY is the stable string', () => {
  assert.equal(RESOURCE_ATTENUATION_REGISTRY, 'attenuation_registry');
});

// ---------- linear ----------

test('linear: gain=1 at distance <= refDistance', () => {
  assert.equal(linearAttenuation(0), 1);
  assert.equal(linearAttenuation(0.5, { refDistance: 1 }), 1);
  assert.equal(linearAttenuation(1, { refDistance: 1 }), 1);
});

test('linear: gain falls linearly between ref and max with default rolloff=1', () => {
  // ref=1, max=11, rolloff=1: at distance=6 (halfway), gain = 1 - 1 * (5/10) = 0.5.
  const g = linearAttenuation(6, { refDistance: 1, maxDistance: 11 });
  assert.ok(Math.abs(g - 0.5) < 1e-9);
});

test('linear: gain=0 at maxDistance with default rolloff=1', () => {
  const g = linearAttenuation(11, { refDistance: 1, maxDistance: 11 });
  assert.equal(g, 0);
});

test('linear: distances past max clamp to floor', () => {
  const g = linearAttenuation(100, { refDistance: 1, maxDistance: 10 });
  assert.equal(g, 0);
});

test('linear: rolloff < 1 leaves residual gain at maxDistance', () => {
  // rolloff=0.5 means at max gain = 1 - 0.5 = 0.5.
  const g = linearAttenuation(11, { refDistance: 1, maxDistance: 11, rolloffFactor: 0.5 });
  assert.ok(Math.abs(g - 0.5) < 1e-9);
});

// ---------- inverse ----------

test('inverse: gain=1 at distance <= refDistance', () => {
  assert.equal(inverseAttenuation(0), 1);
  assert.equal(inverseAttenuation(1, { refDistance: 1 }), 1);
});

test('inverse: classic 1/r curve at default rolloff=1', () => {
  // ref=1, rolloff=1, distance=2: gain = 1 / (1 + 1 * (2 - 1)) = 0.5.
  const g = inverseAttenuation(2, { refDistance: 1, rolloffFactor: 1, maxDistance: 100 });
  assert.ok(Math.abs(g - 0.5) < 1e-9);
});

test('inverse: distance=4 gives gain=1/4 at default ref + rolloff', () => {
  const g = inverseAttenuation(4, { refDistance: 1, rolloffFactor: 1, maxDistance: 100 });
  assert.ok(Math.abs(g - 0.25) < 1e-9);
});

test('inverse: clamped at maxDistance', () => {
  // d=1000 clamps to max=10; gain at 10 = 1 / (1 + 1*(10-1)) = 0.1.
  const g = inverseAttenuation(1000, { refDistance: 1, maxDistance: 10 });
  assert.ok(Math.abs(g - 0.1) < 1e-9);
});

// ---------- exponential ----------

test('exponential: gain=1 at distance <= refDistance', () => {
  assert.equal(exponentialAttenuation(0), 1);
  assert.equal(exponentialAttenuation(1, { refDistance: 1 }), 1);
});

test('exponential: gain falls as power curve at default rolloff=1', () => {
  // ref=1, rolloff=1, distance=2: gain = (2/1)^(-1) = 0.5.
  const g = exponentialAttenuation(2, { refDistance: 1, rolloffFactor: 1, maxDistance: 100 });
  assert.ok(Math.abs(g - 0.5) < 1e-9);
});

test('exponential: rolloff=2 squares the falloff', () => {
  // ref=1, rolloff=2, distance=2: gain = 2^(-2) = 0.25.
  const g = exponentialAttenuation(2, { refDistance: 1, rolloffFactor: 2, maxDistance: 100 });
  assert.ok(Math.abs(g - 0.25) < 1e-9);
});

test('exponential: rolloff=0 returns 1 (no falloff)', () => {
  const g = exponentialAttenuation(100, { refDistance: 1, rolloffFactor: 0, maxDistance: 1000 });
  assert.equal(g, 1);
});

// ---------- shared safety ----------

test('attenuation: negative distance clamps to 0 -> gain=1', () => {
  assert.equal(linearAttenuation(-5), 1);
  assert.equal(inverseAttenuation(-5), 1);
  assert.equal(exponentialAttenuation(-5), 1);
});

test('attenuation: NaN distance treats as 0', () => {
  assert.equal(linearAttenuation(NaN), 1);
  assert.equal(inverseAttenuation(NaN), 1);
});

test('attenuation: infinite distance returns 0 (or floor)', () => {
  assert.equal(linearAttenuation(Infinity), 0);
});

test('attenuation: max <= ref auto-corrects', () => {
  // If user passes max=ref, code falls back to default span.
  const g = linearAttenuation(5, { refDistance: 10, maxDistance: 5 });
  // Distance 5 < ref 10, so gain = 1.
  assert.equal(g, 1);
});

// ---------- attenuationByModel ----------

test('attenuationByModel: dispatches by model name', () => {
  const opts = { refDistance: 1, maxDistance: 10, rolloffFactor: 1 };
  assert.equal(attenuationByModel('linear', 1, opts), 1);
  assert.ok(Math.abs(attenuationByModel('inverse', 2, opts) - 0.5) < 1e-9);
  assert.ok(Math.abs(attenuationByModel('exponential', 2, opts) - 0.5) < 1e-9);
});

// ---------- AttenuationRegistry ----------

test('registry: pre-registers the three standard models', () => {
  const r = new AttenuationRegistry();
  assert.equal(r.has('linear'), true);
  assert.equal(r.has('inverse'), true);
  assert.equal(r.has('exponential'), true);
  assert.deepEqual(r.names().sort(), ['exponential', 'inverse', 'linear']);
});

test('registry: register custom curve + evaluate', () => {
  const r = new AttenuationRegistry();
  // Custom: gain=0.5 always.
  r.register('flat', () => 0.5);
  assert.equal(r.has('flat'), true);
  assert.equal(r.evaluate('flat', 100), 0.5);
});

test('registry: unregister drops the curve', () => {
  const r = new AttenuationRegistry();
  r.register('custom', () => 0.5);
  assert.equal(r.unregister('custom'), true);
  assert.equal(r.has('custom'), false);
});

test('registry: unregister missing returns false', () => {
  const r = new AttenuationRegistry();
  assert.equal(r.unregister('nope'), false);
});

test('registry: evaluate falls back to inverse for unknown name', () => {
  const r = new AttenuationRegistry();
  // distance=2 -> inverse default = 0.5
  const g = r.evaluate('not_a_model', 2, { refDistance: 1, rolloffFactor: 1 });
  assert.ok(Math.abs(g - 0.5) < 1e-9);
});

test('registry: throwing custom curve clamps to 0', () => {
  const r = new AttenuationRegistry();
  r.register('boom', () => { throw new Error('oops'); });
  assert.equal(r.evaluate('boom', 5), 0);
});

test('registry: NaN / Infinity from custom curve clamps to 0', () => {
  const r = new AttenuationRegistry();
  r.register('nan', () => NaN);
  r.register('inf', () => Infinity);
  assert.equal(r.evaluate('nan', 5), 0);
  // Infinity > 1 is clamped down by isFinite check -> 0.
  assert.equal(r.evaluate('inf', 5), 0);
});

test('registry: out-of-range gain clamped to [0, 1]', () => {
  const r = new AttenuationRegistry();
  r.register('over', () => 1.5);
  r.register('under', () => -0.5);
  assert.equal(r.evaluate('over', 5), 1);
  assert.equal(r.evaluate('under', 5), 0);
});

test('registry: register with empty name is ignored', () => {
  const r = new AttenuationRegistry();
  const fn: AttenuationFn = () => 0.5;
  r.register('', fn);
  assert.equal(r.has(''), false);
});

test('registry: register replaces existing curve', () => {
  const r = new AttenuationRegistry();
  r.register('m', () => 0.2);
  r.register('m', () => 0.8);
  assert.equal(r.evaluate('m', 5), 0.8);
});
