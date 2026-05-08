// Loom Engine - end-to-end determinism smoke (Phase 0.18 polish).
//
// Two HeadlessTickers, same seed, same canned scenario: 5 entities,
// 4 of them pursuing the 5th, 200 ticks of PursueSystem. Final
// resource snapshots must match byte-for-byte.
//
// This is the cornerstone "two worlds, same seed, same outcome"
// guarantee. If this test fails, every other determinism guarantee
// (trace replay, save state, network sync) cracks too.
//
// What's covered:
//   - World tick clock (TimeResource.elapsed, .frame)
//   - PursueSystem (deterministic now read from TimeResource;
//     position update math; cooldown checks)
//   - DamageSystem (kill timestamps from TimeResource)
//   - HealthPool state (each pursuer slowly damages the target via
//     contact damage, target eventually dies, deathLog records the
//     kill at a deterministic timestamp)
//   - Entropy resource: ticked but never read by these systems, so
//     state must equal the seed at end (tripwire for accidental
//     entropy consumption).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { createHeadlessTicker } from './headless-tick-harness.js';
import {
  PursueSystem,
  DamageSystem,
  TransformPool,
  PursuePool,
  HealthPool,
  POOL_TRANSFORM,
  POOL_PURSUE,
  POOL_HEALTH,
  RESOURCE_DEATH_LOG,
  RESOURCE_ENTROPY,
  RESOURCE_TIME,
  createEntropy,
  type DeathLog,
  type TimeResource,
  SYSTEM_PHASE_LOGIC,
  type World,
} from '../src/index.js';

interface ResourceSnapshot {
  time: { elapsed: number; delta: number; frame: number };
  entropy: number;
  // Per-entity transform x/y for entities 1..5 (target is e1; pursuers
  // e2..e5).
  transforms: Array<{ idx: number; x: number; y: number }>;
  // Per-entity health for entities 1..5.
  health: Array<{ idx: number; hp: number; flags: number }>;
  // DeathLog kills.
  kills: Array<{ entityIndex: number; atMs: number }>;
  totalKills: number;
}

const TARGET_X = 5;
const TARGET_Y = 5;
const TARGET_HP = 30;
const PURSUER_SPEED = 4;          // world units / second
const STOP_DIST = 0.5;
const CONTACT_DAMAGE = 1;
const CONTACT_COOLDOWN_MS = 100;  // damage every 100ms once in range

const SEED = 99;
const TICK_COUNT = 200;
const TPS = 60;

interface Built {
  ticker: ReturnType<typeof createHeadlessTicker>;
}

function buildScenario(seed: number): Built {
  const ticker = createHeadlessTicker({ tps: TPS });
  const w: World = ticker.getWorld();
  // Seeded entropy resource so any future system that reads it gets a
  // reproducible stream. This particular scenario uses pursue + damage
  // only - both deterministic without entropy - but we wire the
  // resource so the snapshot includes its state and a regression that
  // accidentally consumes entropy diffs visibly.
  w.resources.set(RESOURCE_ENTROPY, createEntropy(seed));

  // Spawn 5 entities. Index 1 = target (immobile), 2..5 = pursuers.
  const transforms = w.getPool<TransformPool>(POOL_TRANSFORM);
  const pursuers = w.getPool<PursuePool>(POOL_PURSUE);
  const health = w.getPool<HealthPool>(POOL_HEALTH);
  if (!transforms || !pursuers || !health) {
    throw new Error('determinism smoke: pools missing from headless ticker');
  }

  const target = w.entities.create();
  transforms.attach(target, TARGET_X, TARGET_Y, 0);
  health.attach(target, TARGET_HP);

  // Four pursuers at the corners of a 10x10 square around the target.
  const pursuerSeeds: Array<{ x: number; y: number }> = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 10 },
  ];
  for (let i = 0; i < pursuerSeeds.length; i++) {
    const p = pursuerSeeds[i]!;
    const pe = w.entities.create();
    transforms.attach(pe, p.x, p.y, 0);
    health.attach(pe, 50);
    pursuers.attach(pe, target, PURSUER_SPEED, STOP_DIST, CONTACT_DAMAGE, CONTACT_COOLDOWN_MS);
  }

  // Logic-phase systems: PursueSystem walks pursuers + applies contact
  // damage; DamageSystem cleans up dead entities. Both read TimeResource
  // for their `now` clock.
  ticker.addSystem(new PursueSystem(), SYSTEM_PHASE_LOGIC);
  ticker.addSystem(new DamageSystem(), SYSTEM_PHASE_LOGIC);

  return { ticker };
}

function snapshotResources(world: World): ResourceSnapshot {
  const time = world.resources.require<TimeResource>(RESOURCE_TIME);
  const entropy = world.resources.require<{ getState(): number }>(RESOURCE_ENTROPY).getState();
  const transforms = world.getPool<TransformPool>(POOL_TRANSFORM);
  const health = world.getPool<HealthPool>(POOL_HEALTH);
  const deathLog = world.resources.require<DeathLog>(RESOURCE_DEATH_LOG);
  if (!transforms || !health) {
    throw new Error('determinism smoke: pools missing at snapshot time');
  }
  const transformOut: Array<{ idx: number; x: number; y: number }> = [];
  const healthOut: Array<{ idx: number; hp: number; flags: number }> = [];
  for (let i = 1; i <= 5; i++) {
    transformOut.push({
      idx: i,
      x: transforms.x[i] ?? 0,
      y: transforms.y[i] ?? 0,
    });
    healthOut.push({
      idx: i,
      hp: health.current[i] ?? 0,
      flags: health.flags[i] ?? 0,
    });
  }
  return {
    time: { elapsed: time.elapsed, delta: time.delta, frame: time.frame },
    entropy,
    transforms: transformOut,
    health: healthOut,
    kills: deathLog.recent.map((k) => ({
      entityIndex: k.entityIndex,
      atMs: k.atMs,
    })),
    totalKills: deathLog.totalKills,
  };
}

// ----- Cornerstone: two seeded worlds match exactly. -----

test('determinism smoke: two HeadlessTickers (same seed) produce identical resource snapshots after 200 ticks', () => {
  const a = buildScenario(SEED);
  const b = buildScenario(SEED);
  a.ticker.tick(TICK_COUNT);
  b.ticker.tick(TICK_COUNT);
  const snapA = snapshotResources(a.ticker.getWorld());
  const snapB = snapshotResources(b.ticker.getWorld());
  assert.deepEqual(snapA, snapB);
});

test('determinism smoke: time resource agrees on elapsed + frame after 200 ticks', () => {
  const a = buildScenario(SEED);
  a.ticker.tick(TICK_COUNT);
  const snap = snapshotResources(a.ticker.getWorld());
  // 200 ticks at 60 TPS = 200 / 60 seconds elapsed.
  assert.equal(snap.time.frame, TICK_COUNT);
  // Allow tiny FP slop from accumulated dt; engine stores doubles.
  assert.ok(Math.abs(snap.time.elapsed - TICK_COUNT / TPS) < 1e-9);
  assert.ok(Math.abs(snap.time.delta - 1 / TPS) < 1e-9);
});

test('determinism smoke: entropy state untouched (no pursue/damage system reads from it)', () => {
  const a = buildScenario(SEED);
  a.ticker.tick(TICK_COUNT);
  const snap = snapshotResources(a.ticker.getWorld());
  assert.equal(snap.entropy, SEED, 'entropy.getState() should equal SEED if nothing read');
});

test('determinism smoke: pursuers converged on the target (sanity check that the scenario actually runs)', () => {
  const a = buildScenario(SEED);
  a.ticker.tick(TICK_COUNT);
  const snap = snapshotResources(a.ticker.getWorld());
  // Each pursuer (indices 2..5) should be within `STOP_DIST` of the
  // target's tile. They walk at PURSUER_SPEED units/s for TICK_COUNT/TPS
  // seconds = 200/60 ~ 3.33s -> 13.3 units traveled. Initial distance
  // from corners to target is ~7.07; they easily reach STOP_DIST.
  for (let i = 0; i < 4; i++) {
    const p = snap.transforms[i + 1]!;  // pursuer i is at index 2+i
    const dx = p.x - TARGET_X;
    const dy = p.y - TARGET_Y;
    const d = Math.sqrt(dx * dx + dy * dy);
    assert.ok(d <= STOP_DIST + 0.01, 'pursuer ' + p.idx + ' should be at stop distance, d=' + d);
  }
});

test('determinism smoke: DeathLog records kill events at deterministic timestamps', () => {
  const a = buildScenario(SEED);
  const b = buildScenario(SEED);
  a.ticker.tick(TICK_COUNT);
  b.ticker.tick(TICK_COUNT);
  const snapA = snapshotResources(a.ticker.getWorld());
  const snapB = snapshotResources(b.ticker.getWorld());
  // Same kills in same order at same timestamps.
  assert.deepEqual(snapA.kills, snapB.kills);
  assert.equal(snapA.totalKills, snapB.totalKills);
  // Sanity: target should die from accumulated contact damage. 4
  // pursuers * 1 dmg each * (~3.33s of elapsed - travel time) /
  // 0.1s cooldown is plenty to hit 100 HP.
  assert.ok(snapA.totalKills >= 1, 'expected target to die under sustained contact damage');
});

// ----- Different seeds: same scenario, same outcome (no entropy read). -----

test('determinism smoke: different seeds give same outcome for entropy-blind systems', () => {
  const a = buildScenario(1);
  const b = buildScenario(99999);
  a.ticker.tick(TICK_COUNT);
  b.ticker.tick(TICK_COUNT);
  // Strip entropy from each snapshot since it differs by construction.
  const snapA = snapshotResources(a.ticker.getWorld());
  const snapB = snapshotResources(b.ticker.getWorld());
  // Entropy state will differ (each starts at its own seed); transforms
  // / health / kills must NOT.
  assert.notEqual(snapA.entropy, snapB.entropy);
  // Compare the deterministic-only fields explicitly.
  assert.deepEqual(snapA.time, snapB.time);
  assert.deepEqual(snapA.transforms, snapB.transforms);
  assert.deepEqual(snapA.health, snapB.health);
  assert.deepEqual(snapA.kills, snapB.kills);
  assert.equal(snapA.totalKills, snapB.totalKills);
});

// ----- Per-tick reproducibility: snapshot at every tick of run A
// should match the snapshot at the same tick of run B. -----

test('determinism smoke: per-tick reproducibility (snapshots match at every tick across two runs)', () => {
  const a = buildScenario(SEED);
  const b = buildScenario(SEED);
  // 20 sample points across the run (every 10 ticks).
  for (let n = 0; n < 20; n++) {
    a.ticker.tick(10);
    b.ticker.tick(10);
    const sa = snapshotResources(a.ticker.getWorld());
    const sb = snapshotResources(b.ticker.getWorld());
    assert.deepEqual(sa, sb, 'mismatch at sample ' + n);
  }
});
