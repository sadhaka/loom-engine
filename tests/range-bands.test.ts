// v2.3.0 - Range Bands (grid-free relative positioning) tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  bandFromDistanceFt,
  normalizeBand,
  bandWithin,
  compareBands,
  createRangeBandField,
  rangeBandSet,
  rangeBandGet,
  rangeBandIsEngaged,
  rangeBandTargetsWithin,
  rangeBandEngagedWith,
  rangeBandClear,
  rangeBandSnapshot,
  RANGE_BAND_ENGAGED,
  RANGE_BAND_NEAR,
  RANGE_BAND_FAR,
  RESOURCE_RANGE_BANDS,
} from '../src/index.js';

test('range-bands: RESOURCE key is stable', () => {
  assert.equal(RESOURCE_RANGE_BANDS, 'rangeBands');
});

// ---------- bandFromDistanceFt (RAW float threshold) ----------

test('range-bands: distance thresholds classify on the raw float', () => {
  assert.equal(bandFromDistanceFt(0), RANGE_BAND_ENGAGED);
  assert.equal(bandFromDistanceFt(5), RANGE_BAND_ENGAGED);
  assert.equal(bandFromDistanceFt(5.49), RANGE_BAND_NEAR);   // NOT rounded to 5
  assert.equal(bandFromDistanceFt(6), RANGE_BAND_NEAR);
  assert.equal(bandFromDistanceFt(30), RANGE_BAND_NEAR);
  assert.equal(bandFromDistanceFt(30.49), RANGE_BAND_FAR);   // NOT rounded to 30
  assert.equal(bandFromDistanceFt(31), RANGE_BAND_FAR);
  assert.equal(bandFromDistanceFt(Infinity), RANGE_BAND_FAR);
});

test('range-bands: negative / NaN distance -> neutral near (defensive)', () => {
  assert.equal(bandFromDistanceFt(-10), RANGE_BAND_NEAR);
  assert.equal(bandFromDistanceFt(NaN), RANGE_BAND_NEAR);
});

// ---------- normalizeBand / bandWithin / compareBands ----------

test('range-bands: normalizeBand coerces / rejects', () => {
  assert.equal(normalizeBand('engaged'), RANGE_BAND_ENGAGED);
  assert.equal(normalizeBand('far'), RANGE_BAND_FAR);
  assert.equal(normalizeBand('sideways'), null);
});

test('range-bands: bandWithin honors closeness ordering (engaged closest)', () => {
  assert.equal(bandWithin('engaged', 'near'), true);
  assert.equal(bandWithin('near', 'near'), true);
  assert.equal(bandWithin('far', 'near'), false);
  assert.equal(bandWithin('engaged', 'engaged'), true);
  assert.equal(bandWithin('near', 'engaged'), false);
});

test('range-bands: compareBands sorts engaged < near < far', () => {
  const sorted = (['far', 'engaged', 'near'] as const).slice().sort(compareBands);
  assert.deepEqual(sorted, ['engaged', 'near', 'far']);
});

// ---------- RangeBandField ----------

test('range-bands: set writes BOTH directions (symmetric default) + derives from distance', () => {
  const f = createRangeBandField();
  const b = rangeBandSet(f, 'pc', 'goblin', { distanceFeet: 5 });
  assert.equal(b, RANGE_BAND_ENGAGED);
  assert.equal(rangeBandGet(f, 'pc', 'goblin'), RANGE_BAND_ENGAGED);
  assert.equal(rangeBandGet(f, 'goblin', 'pc'), RANGE_BAND_ENGAGED); // symmetric
  assert.equal(rangeBandIsEngaged(f, 'pc', 'goblin'), true);
});

test('range-bands: explicit band wins over distance', () => {
  const f = createRangeBandField();
  assert.equal(rangeBandSet(f, 'pc', 'g2', { band: RANGE_BAND_FAR, distanceFeet: 5 }), RANGE_BAND_FAR);
  assert.equal(rangeBandGet(f, 'pc', 'g2'), RANGE_BAND_FAR);
  assert.equal(rangeBandIsEngaged(f, 'pc', 'g2'), false);
});

test('range-bands: no band + no distance -> near', () => {
  const f = createRangeBandField();
  assert.equal(rangeBandSet(f, 'pc', 'g'), RANGE_BAND_NEAR);
});

test('range-bands: targetsWithin includes closer bands; engagedWith filters', () => {
  const f = createRangeBandField();
  rangeBandSet(f, 'pc', 'goblin', { distanceFeet: 5 });    // engaged
  rangeBandSet(f, 'pc', 'archer', { distanceFeet: 20 });   // near
  rangeBandSet(f, 'pc', 'sniper', { distanceFeet: 60 });   // far
  const within = rangeBandTargetsWithin(f, 'pc', RANGE_BAND_NEAR).slice().sort();
  assert.deepEqual(within, ['archer', 'goblin']);
  assert.deepEqual(rangeBandEngagedWith(f, 'pc'), ['goblin']);
  assert.equal(rangeBandTargetsWithin(f, 'pc', RANGE_BAND_FAR).length, 3);
});

test('range-bands: clear empties; snapshot is deterministic insertion order', () => {
  const f = createRangeBandField();
  rangeBandSet(f, 'pc', 'g', { distanceFeet: 5, symmetric: false });
  const snap = rangeBandSnapshot(f);
  assert.equal(snap.length, 1);
  assert.deepEqual(snap[0], { source: 'pc', target: 'g', band: RANGE_BAND_ENGAGED });
  rangeBandClear(f);
  assert.equal(rangeBandSnapshot(f).length, 0);
});

test('range-bands: asymmetric write + defensive self/empty pairs', () => {
  const f = createRangeBandField();
  rangeBandSet(f, 'pc', 'g', { band: RANGE_BAND_ENGAGED, symmetric: false });
  assert.equal(rangeBandGet(f, 'pc', 'g'), RANGE_BAND_ENGAGED);
  assert.equal(rangeBandGet(f, 'g', 'pc'), null);            // not written
  rangeBandSet(f, 'x', 'x', { band: RANGE_BAND_ENGAGED });   // self-pair no-op
  assert.equal(rangeBandGet(f, 'x', 'x'), null);
  assert.equal(rangeBandGet(f, 'nobody', 'noone'), null);
});
