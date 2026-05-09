// Phase 1.2.3 - EncounterTable tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  EncounterTable,
  RESOURCE_ENCOUNTER_TABLE,
} from '../src/index.js';

interface MobPayload { mobs: Array<{ kind: string; count: number }> }

// Deterministic RNG: returns sequential values from an array.
const seqRng = (vals: number[]): () => number => {
  let i = 0;
  return () => vals[i++ % vals.length] as number;
};

test('et: RESOURCE_ENCOUNTER_TABLE is the stable string', () => {
  assert.equal(RESOURCE_ENCOUNTER_TABLE, 'encounter_table');
});

test('et: starts empty', () => {
  const t = EncounterTable.create();
  assert.equal(t.size(), 0);
});

test('et: add + has + size', () => {
  const t = EncounterTable.create<MobPayload>();
  assert.equal(t.add({ id: 'a', payload: { mobs: [{ kind: 'wolf', count: 1 }] } }), true);
  assert.equal(t.has('a'), true);
  assert.equal(t.size(), 1);
});

test('et: add rejects empty / non-string id', () => {
  const t = EncounterTable.create<MobPayload>();
  assert.equal(t.add({ id: '', payload: { mobs: [] } }), false);
  // @ts-expect-error
  assert.equal(t.add({ id: null, payload: { mobs: [] } }), false);
});

test('et: add rejects null payload', () => {
  const t = EncounterTable.create<MobPayload>();
  // @ts-expect-error
  assert.equal(t.add({ id: 'a', payload: null }), false);
});

test('et: remove drops entry', () => {
  const t = EncounterTable.create<MobPayload>();
  t.add({ id: 'a', payload: { mobs: [] } });
  assert.equal(t.remove('a'), true);
  assert.equal(t.has('a'), false);
});

test('et: roll picks any entry when no context filters', () => {
  const t = EncounterTable.create<MobPayload>({ rng: seqRng([0.1]) });
  t.add({ id: 'a', payload: { mobs: [{ kind: 'wolf', count: 1 }] } });
  const result = t.roll();
  assert.ok(result);
  assert.equal(result!.id, 'a');
});

test('et: roll filters by zone', () => {
  const t = EncounterTable.create<MobPayload>({ rng: seqRng([0.1]) });
  t.add({ id: 'forest_wolf', zones: ['forest'], payload: { mobs: [] } });
  t.add({ id: 'desert_lizard', zones: ['desert'], payload: { mobs: [] } });
  const r = t.roll({ zone: 'forest' });
  assert.equal(r!.id, 'forest_wolf');
});

test('et: roll filters by phase', () => {
  const t = EncounterTable.create<MobPayload>({ rng: seqRng([0.1]) });
  t.add({ id: 'day_creature', phases: ['day'], payload: { mobs: [] } });
  t.add({ id: 'night_creature', phases: ['night'], payload: { mobs: [] } });
  const r = t.roll({ phase: 'night' });
  assert.equal(r!.id, 'night_creature');
});

test('et: roll filters by level band', () => {
  const t = EncounterTable.create<MobPayload>({ rng: seqRng([0.1]) });
  t.add({ id: 'easy', minLevel: 1, maxLevel: 5, payload: { mobs: [] } });
  t.add({ id: 'hard', minLevel: 10, maxLevel: 20, payload: { mobs: [] } });
  assert.equal(t.roll({ level: 3 })!.id, 'easy');
  assert.equal(t.roll({ level: 15 })!.id, 'hard');
  assert.equal(t.roll({ level: 7 }), null); // gap
});

test('et: roll filters by tags (any-match)', () => {
  const t = EncounterTable.create<MobPayload>({ rng: seqRng([0.1]) });
  t.add({ id: 'rare', tags: ['rare', 'boss'], payload: { mobs: [] } });
  t.add({ id: 'common', payload: { mobs: [] } });
  assert.equal(t.roll({ tags: ['rare'] })!.id, 'rare');
  // No tag context filter -> common (no tags filter is permissive,
  // tagged entries not picked when ctx.tags missing? Actually our
  // logic: e.tags is null -> no tag filter; e.tags non-null requires
  // ctx.tags overlap. So 'rare' requires ctx.tags overlap with rare/boss).
  assert.equal(t.roll()!.id, 'common');
});

test('et: roll picks weighted', () => {
  // Two entries, weights 1 and 9. With rng=0.5, target=5.0; first
  // accumulator hits 1, second hits 10. 5.0 < 10 -> picks second.
  const t = EncounterTable.create<MobPayload>({ rng: seqRng([0.5]) });
  t.add({ id: 'rare', weight: 1, payload: { mobs: [] } });
  t.add({ id: 'common', weight: 9, payload: { mobs: [] } });
  const r = t.roll();
  assert.equal(r!.id, 'common');
});

test('et: roll picks rare end of weights with low rng', () => {
  const t = EncounterTable.create<MobPayload>({ rng: seqRng([0.05]) });
  t.add({ id: 'rare', weight: 1, payload: { mobs: [] } });
  t.add({ id: 'common', weight: 9, payload: { mobs: [] } });
  // total=10, target=0.5, accumulator hits 1 first -> rare.
  const r = t.roll();
  assert.equal(r!.id, 'rare');
});

test('et: roll returns null with no matches', () => {
  const t = EncounterTable.create<MobPayload>();
  t.add({ id: 'forest_only', zones: ['forest'], payload: { mobs: [] } });
  assert.equal(t.roll({ zone: 'desert' }), null);
});

test('et: filter returns matching entries without rolling', () => {
  const t = EncounterTable.create<MobPayload>();
  t.add({ id: 'a', zones: ['forest'], payload: { mobs: [] } });
  t.add({ id: 'b', zones: ['desert'], payload: { mobs: [] } });
  t.add({ id: 'c', payload: { mobs: [] } });
  const matches = t.filter({ zone: 'forest' });
  assert.equal(matches.length, 2); // a (zone match) + c (no filter)
  assert.deepEqual(matches.map((m) => m.id).sort(), ['a', 'c']);
});

test('et: list returns all entries', () => {
  const t = EncounterTable.create<MobPayload>();
  t.add({ id: 'a', payload: { mobs: [] } });
  t.add({ id: 'b', payload: { mobs: [] } });
  assert.equal(t.list().length, 2);
});

test('et: totalWeightFor sums matching weights', () => {
  const t = EncounterTable.create<MobPayload>();
  t.add({ id: 'a', zones: ['forest'], weight: 3, payload: { mobs: [] } });
  t.add({ id: 'b', zones: ['forest'], weight: 7, payload: { mobs: [] } });
  t.add({ id: 'c', zones: ['desert'], weight: 5, payload: { mobs: [] } });
  assert.equal(t.totalWeightFor({ zone: 'forest' }), 10);
  assert.equal(t.totalWeightFor({ zone: 'desert' }), 5);
});

test('et: throwing rng falls back to Math.random', () => {
  const t = EncounterTable.create<MobPayload>({
    rng: () => { throw new Error('boom'); },
  });
  t.add({ id: 'a', payload: { mobs: [] } });
  // Should not throw.
  const r = t.roll();
  assert.ok(r);
});

test('et: setRng updates the seam', () => {
  const t = EncounterTable.create<MobPayload>({ rng: seqRng([0.05]) });
  t.add({ id: 'a', weight: 1, payload: { mobs: [] } });
  t.add({ id: 'b', weight: 9, payload: { mobs: [] } });
  assert.equal(t.roll()!.id, 'a');
  t.setRng(seqRng([0.95]));
  assert.equal(t.roll()!.id, 'b');
});

test('et: clear empties', () => {
  const t = EncounterTable.create<MobPayload>();
  t.add({ id: 'a', payload: { mobs: [] } });
  t.clear();
  assert.equal(t.size(), 0);
});

test('et: dispose locks ops', () => {
  const t = EncounterTable.create<MobPayload>();
  t.add({ id: 'a', payload: { mobs: [] } });
  t.dispose();
  assert.equal(t.add({ id: 'b', payload: { mobs: [] } }), false);
  assert.equal(t.roll(), null);
});

test('et: realistic example - multi-zone encounter pool', () => {
  const t = EncounterTable.create<MobPayload>({ rng: seqRng([0.5, 0.1, 0.9]) });
  t.add({ id: 'forest_wolf', zones: ['forest'], minLevel: 1, maxLevel: 10,
    weight: 4, payload: { mobs: [{ kind: 'wolf', count: 3 }] } });
  t.add({ id: 'forest_bear', zones: ['forest'], minLevel: 5, maxLevel: 15,
    weight: 1, payload: { mobs: [{ kind: 'bear', count: 1 }] } });
  t.add({ id: 'mountain_giant', zones: ['mountain'], minLevel: 10,
    weight: 2, payload: { mobs: [{ kind: 'giant', count: 1 }] } });
  // forest level 7: both forest entries match (weights 4 + 1 = 5).
  // rng=0.5 -> target=2.5 -> accumulator: 4 (>=2.5) -> wolf.
  assert.equal(t.roll({ zone: 'forest', level: 7 })!.id, 'forest_wolf');
  // mountain level 12: only giant matches.
  assert.equal(t.roll({ zone: 'mountain', level: 12 })!.id, 'mountain_giant');
});
