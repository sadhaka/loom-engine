// Loom Engine - Phase 7 deeper tests: ProjectilePool +
// ProjectileSystem + RangedAttackPool + RangedAttackSystem +
// MobCatalog spawnMob.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  ProjectilePool,
  ProjectileSystem,
  POOL_PROJECTILE,
  PROJECTILE_FLAG_HOMING,
  RangedAttackPool,
  POOL_RANGED,
  RANGED_FLAG_ACTIVE,
  RangedAttackSystem,
  HealthPool,
  PursuePool,
  POOL_HEALTH,
  POOL_PURSUE,
  TransformPool,
  SpritePool,
  POOL_TRANSFORM,
  POOL_SPRITE,
  MOB_CATALOG,
  spawnMob,
  hexToRgba,
  approxEq,
  entityIndex,
  NULL_ENTITY,
  SYSTEM_PHASE_PHYSICS,
  SYSTEM_PHASE_LOGIC,
  COLOR_KNOT_INT,
  ParticlePool,
  SnapshotWriter,
} from '../src/index.js';

// ---------- ProjectilePool ----------

test('projectile pool: spawn writes hot data + ALIVE flag', () => {
  const pool = new ProjectilePool();
  const slot = pool.spawn({
    x: 0, y: 0, z: 0, vx: 1, vy: 0, vz: 0,
    life: 2,
    damage: 10,
    ownerEntity: 1,
    size: 5,
    color: COLOR_KNOT_INT,
  });
  assert.ok(slot >= 0);
  assert.ok(pool.isAlive(slot));
  assert.equal(pool.damage[slot], 10);
  assert.equal(pool.ownerEntity[slot], 1);
  assert.equal(pool.targetEntity[slot], NULL_ENTITY);
});

test('projectile pool: homing flag sets HOMING bit', () => {
  const pool = new ProjectilePool();
  const slot = pool.spawn({
    x: 0, y: 0, z: 0, vx: 1, vy: 0, vz: 0,
    life: 1, damage: 5, ownerEntity: NULL_ENTITY, size: 5,
    color: COLOR_KNOT_INT, homing: true, targetEntity: 5,
  });
  assert.equal((pool.flags[slot] ?? 0) & PROJECTILE_FLAG_HOMING, PROJECTILE_FLAG_HOMING);
  assert.equal(pool.targetEntity[slot], 5);
});

test('projectile pool: maxProjectiles cap returns -1', () => {
  const pool = new ProjectilePool(8, 2);
  pool.spawn({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, damage: 1, ownerEntity: NULL_ENTITY, size: 1, color: COLOR_KNOT_INT });
  pool.spawn({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, damage: 1, ownerEntity: NULL_ENTITY, size: 1, color: COLOR_KNOT_INT });
  const overflow = pool.spawn({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, damage: 1, ownerEntity: NULL_ENTITY, size: 1, color: COLOR_KNOT_INT });
  assert.equal(overflow, -1);
});

test('projectile pool: kill recycles slot', () => {
  const pool = new ProjectilePool();
  const a = pool.spawn({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, damage: 1, ownerEntity: NULL_ENTITY, size: 1, color: COLOR_KNOT_INT });
  pool.kill(a);
  const b = pool.spawn({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, damage: 1, ownerEntity: NULL_ENTITY, size: 1, color: COLOR_KNOT_INT });
  assert.equal(b, a);
});

// ---------- ProjectileSystem ----------

test('projectile system: integrates position, decreases life, kills on expire', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const transforms = new TransformPool();
  const health = new HealthPool();
  const projectiles = new ProjectilePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_HEALTH, health);
  w.registerPool(POOL_PROJECTILE, projectiles);

  const slot = projectiles.spawn({
    x: 0, y: 0, z: 0, vx: 5, vy: 0, vz: 0,
    life: 0.5, damage: 10, ownerEntity: NULL_ENTITY, size: 3,
    color: COLOR_KNOT_INT,
  });

  w.addSystem(new ProjectileSystem(), SYSTEM_PHASE_PHYSICS);
  w.update(0.1);
  // Position advanced by vx * dt = 5 * 0.1 = 0.5
  assert.ok(approxEq(projectiles.x[slot] ?? 0, 0.5));
  assert.ok(projectiles.isAlive(slot));
  // Run past life expiry.
  w.update(1.0);
  assert.ok(!projectiles.isAlive(slot));
});

test('projectile system: damages a HealthPool entity on contact + kills projectile', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const transforms = new TransformPool();
  const health = new HealthPool();
  const projectiles = new ProjectilePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_HEALTH, health);
  w.registerPool(POOL_PROJECTILE, projectiles);

  const target = w.createEntity();
  transforms.attach(target, 0.2, 0, 0);
  health.attach(target, 100);

  const slot = projectiles.spawn({
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    life: 5, damage: 30, ownerEntity: NULL_ENTITY, size: 5,
    color: COLOR_KNOT_INT,
  });

  w.addSystem(new ProjectileSystem(), SYSTEM_PHASE_PHYSICS);
  w.update(0.016);
  // Target was within hit radius -> took damage.
  assert.equal(health.getHp(target), 70);
  // Projectile killed (no PIERCE).
  assert.ok(!projectiles.isAlive(slot));
});

test('projectile system: never damages owner', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const transforms = new TransformPool();
  const health = new HealthPool();
  const projectiles = new ProjectilePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_HEALTH, health);
  w.registerPool(POOL_PROJECTILE, projectiles);

  const owner = w.createEntity();
  transforms.attach(owner, 0, 0, 0);
  health.attach(owner, 100);

  projectiles.spawn({
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    life: 5, damage: 50, ownerEntity: owner, size: 5,
    color: COLOR_KNOT_INT,
  });

  w.addSystem(new ProjectileSystem(), SYSTEM_PHASE_PHYSICS);
  w.update(0.016);
  assert.equal(health.getHp(owner), 100);
});

// ---------- RangedAttackPool + System ----------

test('ranged attack pool: attach + setTarget + isActive', () => {
  const pool = new RangedAttackPool();
  const e: number = 1;
  pool.attach(e, {
    target: 99,
    range: 5,
    minRange: 1,
    cooldownMs: 1000,
    damage: 10,
    projectileSpeed: 5,
    projectileLife: 2,
    projectileSize: 5,
    projectileColor: hexToRgba(0xffffff),
    homing: true,
  });
  assert.ok(pool.isActive(e));
  assert.equal((pool.flags[entityIndex(e)] ?? 0) & RANGED_FLAG_ACTIVE, RANGED_FLAG_ACTIVE);
  pool.setTarget(e, 42);
  assert.equal(pool.targetEntity[entityIndex(e)], 42);
});

test('ranged attack system: fires projectile when target in range + cooldown elapsed', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const transforms = new TransformPool();
  const health = new HealthPool();
  const ranged = new RangedAttackPool();
  const projectiles = new ProjectilePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_HEALTH, health);
  w.registerPool(POOL_RANGED, ranged);
  w.registerPool(POOL_PROJECTILE, projectiles);

  const player = w.createEntity();
  const archer = w.createEntity();
  transforms.attach(player, 0, 0, 0);
  transforms.attach(archer, 3, 0, 0);
  health.attach(player, 100);
  health.attach(archer, 30);
  ranged.attach(archer, {
    target: player,
    range: 5,
    minRange: 0.5,
    cooldownMs: 1000,
    damage: 6,
    projectileSpeed: 5,
    projectileLife: 2,
    projectileSize: 5,
    projectileColor: hexToRgba(0xffffff),
    homing: false,
  });

  w.addSystem(new RangedAttackSystem(), SYSTEM_PHASE_LOGIC);
  // Distance archer->player = 3, in range, no prior fire -> should shoot.
  w.update(0.016);
  assert.equal(projectiles.getLiveCount(), 1);

  // Same tick, cooldown not elapsed -> no second shot.
  w.update(0.016);
  assert.equal(projectiles.getLiveCount(), 1);
});

test('ranged attack system: skips when target out of range', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const transforms = new TransformPool();
  const health = new HealthPool();
  const ranged = new RangedAttackPool();
  const projectiles = new ProjectilePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_HEALTH, health);
  w.registerPool(POOL_RANGED, ranged);
  w.registerPool(POOL_PROJECTILE, projectiles);

  const player = w.createEntity();
  const archer = w.createEntity();
  transforms.attach(player, 0, 0, 0);
  transforms.attach(archer, 100, 0, 0);    // way out of range
  health.attach(player, 100);
  health.attach(archer, 30);
  ranged.attach(archer, {
    target: player, range: 5, minRange: 0.5, cooldownMs: 1000, damage: 6,
    projectileSpeed: 5, projectileLife: 2, projectileSize: 5,
    projectileColor: hexToRgba(0xffffff), homing: false,
  });

  w.addSystem(new RangedAttackSystem(), SYSTEM_PHASE_LOGIC);
  w.update(0.016);
  assert.equal(projectiles.getLiveCount(), 0);
});

test('ranged attack system: skips dead target', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const transforms = new TransformPool();
  const health = new HealthPool();
  const ranged = new RangedAttackPool();
  const projectiles = new ProjectilePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_HEALTH, health);
  w.registerPool(POOL_RANGED, ranged);
  w.registerPool(POOL_PROJECTILE, projectiles);

  const player = w.createEntity();
  const archer = w.createEntity();
  transforms.attach(player, 0, 0, 0);
  transforms.attach(archer, 3, 0, 0);
  health.attach(player, 100);
  health.attach(archer, 30);
  ranged.attach(archer, {
    target: player, range: 5, minRange: 0.5, cooldownMs: 1000, damage: 6,
    projectileSpeed: 5, projectileLife: 2, projectileSize: 5,
    projectileColor: hexToRgba(0xffffff), homing: false,
  });
  health.applyDamage(player, 200, 0);   // kill the player

  w.addSystem(new RangedAttackSystem(), SYSTEM_PHASE_LOGIC);
  w.update(0.016);
  assert.equal(projectiles.getLiveCount(), 0);
});

// ---------- MobCatalog + spawnMob ----------

test('mob catalog: 3 archetypes defined per Survivor port', () => {
  assert.equal(MOB_CATALOG.skel_warrior.archetype, 'skel_warrior');
  assert.equal(MOB_CATALOG.skel_archer.archetype, 'skel_archer');
  assert.equal(MOB_CATALOG.skel_caster.archetype, 'skel_caster');
  // Warrior is melee-only.
  assert.equal(MOB_CATALOG.skel_warrior.ranged, null);
  // Archer ranged + non-homing.
  assert.ok(MOB_CATALOG.skel_archer.ranged);
  assert.equal(MOB_CATALOG.skel_archer.ranged?.homing, false);
  // Caster ranged + homing.
  assert.ok(MOB_CATALOG.skel_caster.ranged);
  assert.equal(MOB_CATALOG.skel_caster.ranged?.homing, true);
});

test('spawnMob: warrior gets Transform + Sprite + Health + Pursue, no Ranged', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  w.registerPool(POOL_TRANSFORM, new TransformPool());
  w.registerPool(POOL_SPRITE, new SpritePool());
  w.registerPool(POOL_HEALTH, new HealthPool());
  w.registerPool(POOL_PURSUE, new PursuePool());
  w.registerPool(POOL_RANGED, new RangedAttackPool());

  const player = w.createEntity();
  const warrior = spawnMob(w, 'skel_warrior', 5, 5, player, 0);

  const health = w.requirePool<HealthPool>(POOL_HEALTH);
  const pursuit = w.requirePool<PursuePool>(POOL_PURSUE);
  const ranged = w.requirePool<RangedAttackPool>(POOL_RANGED);
  assert.equal(health.getHp(warrior), 50);   // catalog HP
  assert.ok(pursuit.isActive(warrior));
  assert.ok(!ranged.isActive(warrior));
});

test('spawnMob: archer gets Ranged config from catalog', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  w.registerPool(POOL_TRANSFORM, new TransformPool());
  w.registerPool(POOL_SPRITE, new SpritePool());
  w.registerPool(POOL_HEALTH, new HealthPool());
  w.registerPool(POOL_PURSUE, new PursuePool());
  w.registerPool(POOL_RANGED, new RangedAttackPool());

  const player = w.createEntity();
  const archer = spawnMob(w, 'skel_archer', 5, 5, player, 0);

  const ranged = w.requirePool<RangedAttackPool>(POOL_RANGED);
  assert.ok(ranged.isActive(archer));
  const i = entityIndex(archer);
  assert.equal(ranged.range[i], 4.0);
  assert.equal(ranged.damage[i], 6);
  assert.equal((ranged.flags[i] ?? 0) & 2, 0);   // not HOMING for archer
});

test('spawnMob: caster gets HOMING projectile config', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  w.registerPool(POOL_TRANSFORM, new TransformPool());
  w.registerPool(POOL_SPRITE, new SpritePool());
  w.registerPool(POOL_HEALTH, new HealthPool());
  w.registerPool(POOL_PURSUE, new PursuePool());
  w.registerPool(POOL_RANGED, new RangedAttackPool());

  const player = w.createEntity();
  const caster = spawnMob(w, 'skel_caster', 5, 5, player, 0);

  const ranged = w.requirePool<RangedAttackPool>(POOL_RANGED);
  const i = entityIndex(caster);
  assert.equal((ranged.flags[i] ?? 0) & 2, 2);   // HOMING flag set (RANGED_FLAG_HOMING = 1<<1 = 2)
  assert.equal(ranged.damage[i], 12);
});

// ---------- spawnRaw (zero-allocation spawn path) ----------

// Snapshot a pool's columns to canonical bytes - a compact way to
// assert two pools hold byte-identical state across every column.
function poolBytes(pool: { snapshotInto(w: SnapshotWriter): void }): number[] {
  const w = new SnapshotWriter();
  pool.snapshotInto(w);
  return Array.from(w.bytes().slice());
}

test('particle pool: spawnRaw writes the same columns as spawn(obj)', () => {
  const a = new ParticlePool();
  const b = new ParticlePool();
  const color = { r: 0.8, g: 0.4, b: 0.2, a: 1 };
  const endColor = { r: 0.1, g: 0.2, b: 0.3, a: 0 };

  const ia = a.spawnRaw(
    1, 2, 3, 4, 5, 6, 7, 8, 9,
    2.5, 4, 1.5,
    0.8, 0.4, 0.2, 1,
    0.1, 0.2, 0.3, 0,
    true,
  );
  const ib = b.spawn({
    x: 1, y: 2, z: 3, vx: 4, vy: 5, vz: 6, ax: 7, ay: 8, az: 9,
    life: 2.5, size: 4, endSize: 1.5, color, endColor, additive: true,
  });

  assert.equal(ia, ib, 'both spawn into slot 0');
  assert.deepEqual(poolBytes(a), poolBytes(b),
    'spawnRaw and spawn(obj) must write byte-identical pool state');
});

test('projectile pool: spawnRaw writes the same columns as spawn(obj)', () => {
  const a = new ProjectilePool();
  const b = new ProjectilePool();
  const color = { r: 0.3, g: 0.6, b: 0.9, a: 1 };

  const ia = a.spawnRaw(
    1, 2, 3, 4, 5, 6,
    2.0, 15,
    7, 9,
    5,
    0.3, 0.6, 0.9, 1,
    true, false,
  );
  const ib = b.spawn({
    x: 1, y: 2, z: 3, vx: 4, vy: 5, vz: 6,
    life: 2.0, damage: 15,
    ownerEntity: 7, targetEntity: 9,
    size: 5, color, homing: true, pierce: false,
  });

  assert.equal(ia, ib, 'both spawn into slot 0');
  assert.deepEqual(poolBytes(a), poolBytes(b),
    'spawnRaw and spawn(obj) must write byte-identical pool state');
});
