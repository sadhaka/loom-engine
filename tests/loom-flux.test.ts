// Loom Engine - LoomFlux (Sim-LOD scheduler core) tests.
//
// Covers constructor validation, assign / entityTierOf / tier
// accessors, the wrap-safe tiered tick cadence (including a u32 wrap
// and skipped frames), the frame-boundary migration queue (queued,
// deduped, swap-pop keeps buckets dense), and clear.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { LoomFlux } from '../src/index.js';

test('loom flux: constructor validates tier strides and maxEntities', () => {
  const f = new LoomFlux([1, 5, 10], 100);
  assert.equal(f.tierCount, 3);
  assert.equal(f.maxEntities, 100);
  assert.equal(f.tierStride(0), 1);
  assert.equal(f.tierStride(2), 10);
  // tierStrides: empty, too many, or a non-positive / non-integer stride.
  assert.throws(() => new LoomFlux([], 100), /tierStrides/);
  assert.throws(() => new LoomFlux([1, 1, 1, 1, 1, 1, 1, 1, 1], 100), /tierStrides/);
  assert.throws(() => new LoomFlux([1, 0, 10], 100), /tierStrides\[1\]/);
  assert.throws(() => new LoomFlux([1, 2.5, 10], 100), /tierStrides\[1\]/);
  // maxEntities must be a positive integer within the cap.
  assert.throws(() => new LoomFlux([1], 0), /maxEntities/);
  assert.throws(() => new LoomFlux([1], -5), /maxEntities/);
  assert.throws(() => new LoomFlux([1], 2.5), /maxEntities/);
  assert.throws(() => new LoomFlux([1], (1 << 18) + 1), /maxEntities/);
});

test('loom flux: assign places entities and the tier accessors report them', () => {
  const f = new LoomFlux([1, 5, 10], 100);
  assert.equal(f.entityTierOf(7), -1, 'an unassigned entity is in no tier');
  f.assign(7, 0);
  f.assign(8, 0);
  f.assign(9, 2);
  assert.equal(f.entityTierOf(7), 0);
  assert.equal(f.entityTierOf(9), 2);
  assert.equal(f.getTierCount(0), 2);
  assert.equal(f.getTierCount(1), 0);
  assert.equal(f.getTierCount(2), 1);
  assert.equal(f.entityInTierAt(0, 0), 7);
  assert.equal(f.entityInTierAt(0, 1), 8);
  assert.equal(f.entityInTierAt(2, 0), 9);
  // assign on an already-assigned entity throws - use requestMigration.
  assert.throws(() => f.assign(7, 1), /already assigned/);
});

test('loom flux: the first tick marks every tier due', () => {
  const f = new LoomFlux([1, 5, 10], 100);
  assert.equal(f.tick(0), 0b111, 'all 3 tiers due on the first tick');
});

test('loom flux: subsequent ticks follow the per-tier stride cadence', () => {
  const f = new LoomFlux([1, 5, 10], 100);
  const masks: number[] = [];
  for (let frame = 0; frame <= 10; frame++) masks.push(f.tick(frame));
  // frame 0: all due. T0 (stride 1) every frame; T1 (stride 5) at 5;
  // T2 (stride 10) at 10.
  assert.deepEqual(masks, [0b111, 1, 1, 1, 1, 0b011, 1, 1, 1, 1, 0b111]);
});

test('loom flux: the frame delta is wrap-safe across a u32 boundary', () => {
  const f = new LoomFlux([1, 5, 10], 100);
  f.tick(4294967290);   // first tick - all due, lastProcessed near u32 max
  // The counter wraps to 2: the unsigned delta is (2 - 4294967290) >>> 0 = 8.
  // T0 (>=1) and T1 (>=5) are due; T2 (>=10) is not.
  assert.equal(f.tick(2), 0b011);
});

test('loom flux: a skipped frame still triggers tiers whose stride was crossed', () => {
  const f = new LoomFlux([1, 5, 10], 100);
  f.tick(0);            // first - all due
  // Jump straight to frame 7 (1..6 skipped). Delta 7 crosses T1's
  // stride 5 but not T2's stride 10 - the naive % stride would miss T1.
  assert.equal(f.tick(7), 0b011);
});

test('loom flux: requestMigration is queued and applied on the next tick', () => {
  const f = new LoomFlux([1, 5, 10], 100);
  f.assign(3, 0);
  f.requestMigration(3, 1);
  assert.equal(f.entityTierOf(3), 0, 'not migrated until tick');
  assert.equal(f.pendingMigrationCount(), 1);
  f.tick(0);
  assert.equal(f.entityTierOf(3), 1, 'migration applied at the frame boundary');
  assert.equal(f.pendingMigrationCount(), 0);
  assert.equal(f.getTierCount(0), 0);
  assert.equal(f.getTierCount(1), 1);
});

test('loom flux: requesting a migration twice before a tick collapses to one', () => {
  const f = new LoomFlux([1, 5, 10], 100);
  f.assign(4, 0);
  f.requestMigration(4, 1);
  f.requestMigration(4, 2);   // last target wins
  assert.equal(f.pendingMigrationCount(), 1, 'deduped to a single queued migration');
  f.tick(0);
  assert.equal(f.entityTierOf(4), 2);
});

test('loom flux: migration swap-pops the source bucket to keep it dense', () => {
  const f = new LoomFlux([1, 5, 10], 100);
  f.assign(0, 0);
  f.assign(1, 0);
  f.assign(2, 0);   // T0 bucket: [0, 1, 2]
  f.requestMigration(1, 1);   // pull the middle entity out
  f.tick(0);
  // T0 must still be dense - the last entity (2) was swapped into 1's slot.
  assert.equal(f.getTierCount(0), 2);
  const t0 = [f.entityInTierAt(0, 0), f.entityInTierAt(0, 1)].sort((a, b) => a - b);
  assert.deepEqual(t0, [0, 2]);
  assert.equal(f.getTierCount(1), 1);
  assert.equal(f.entityInTierAt(1, 0), 1);
  // The swapped entity's tier lookup is still correct.
  assert.equal(f.entityTierOf(2), 0);
  assert.equal(f.entityTierOf(1), 1);
});

test('loom flux: requestMigration on an unassigned entity is a deferred assign', () => {
  const f = new LoomFlux([1, 5, 10], 100);
  f.requestMigration(5, 1);   // entity 5 was never assigned
  f.tick(0);
  assert.equal(f.entityTierOf(5), 1);
  assert.equal(f.getTierCount(1), 1);
});

test('loom flux: migrating an entity to its current tier is a no-op', () => {
  const f = new LoomFlux([1, 5, 10], 100);
  f.assign(6, 0);
  f.requestMigration(6, 0);
  f.tick(0);
  assert.equal(f.entityTierOf(6), 0);
  assert.equal(f.getTierCount(0), 1, 'no duplicate slot');
});

test('loom flux: tier and entity accessors are bounds-checked', () => {
  const f = new LoomFlux([1, 5, 10], 8);
  assert.throws(() => f.tierStride(3), /tier/);
  assert.throws(() => f.getTierCount(-1), /tier/);
  assert.throws(() => f.entityInTierAt(0, 0), /index/);   // tier 0 is empty
  assert.throws(() => f.entityTierOf(8), /entityId/);
  assert.throws(() => f.assign(8, 0), /entityId/);
  assert.throws(() => f.assign(0, 3), /tier/);
  assert.throws(() => f.requestMigration(0, 9), /tier/);
  assert.throws(() => f.tick(-1), /globalTick/);
  assert.throws(() => f.tick(4294967296), /globalTick/);
});

test('loom flux: clear resets buckets, migrations, and the tick state', () => {
  const f = new LoomFlux([1, 5, 10], 100);
  f.assign(1, 0);
  f.assign(2, 1);
  f.requestMigration(1, 2);
  f.tick(0);
  f.clear();
  assert.equal(f.getTierCount(0), 0);
  assert.equal(f.getTierCount(1), 0);
  assert.equal(f.getTierCount(2), 0);
  assert.equal(f.entityTierOf(1), -1);
  assert.equal(f.entityTierOf(2), -1);
  assert.equal(f.pendingMigrationCount(), 0);
  // hasTicked is reset, so the next tick again marks every tier due.
  assert.equal(f.tick(50), 0b111);
});
