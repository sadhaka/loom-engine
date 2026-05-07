// Loom Engine - Phase 7 combat tests.
//
// HealthPool: attach / applyDamage / heal / setInvulnerable / death
// flag.
// PursuePool: attach + setTarget + isActive.
// PursueSystem: walks toward target, stops at stopDistance, deals
// contact damage with cooldown.
// DamageSystem: cleans dead entities (detaches Transform / Sprite /
// Health, destroys entity allocator slot).
// AttackSystem: click-to-damage nearest enemy in range.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  // Combat
  HealthPool,
  PursuePool,
  POOL_HEALTH,
  POOL_PURSUE,
  HEALTH_FLAG_DEAD,
  PursueSystem,
  DamageSystem,
  DeathLog,
  RESOURCE_DEATH_LOG,
  AttackSystem,
  // Re-used surface
  POOL_TRANSFORM,
  POOL_SPRITE,
  TransformPool,
  SpritePool,
  SYSTEM_PHASE_LOGIC,
  RESOURCE_TIME,
  RESOURCE_CAMERA,
  RESOURCE_INPUT,
  createTimeResource,
  createCamera,
  approxEq,
  entityIndex,
  type EntityId,
} from '../src/index.js';

// ---------- HealthPool ----------

test('health pool: attach sets full HP + ACTIVE flag', () => {
  const p = new HealthPool();
  const e: EntityId = 1;
  p.attach(e, 100);
  assert.equal(p.getHp(e), 100);
  assert.equal(p.getMaxHp(e), 100);
  assert.ok(p.isAlive(e));
  assert.ok(!p.isDead(e));
});

test('health pool: applyDamage subtracts HP, sets DEAD at 0', () => {
  const p = new HealthPool();
  const e: EntityId = 1;
  p.attach(e, 50);
  assert.equal(p.applyDamage(e, 20, 0), 20);
  assert.equal(p.getHp(e), 30);
  assert.ok(p.isAlive(e));
  // Overkill clamps at 0 + sets DEAD.
  assert.equal(p.applyDamage(e, 100, 0), 30);
  assert.equal(p.getHp(e), 0);
  assert.ok(p.isDead(e));
  assert.ok(!p.isAlive(e));
});

test('health pool: applyDamage on dead entity returns 0', () => {
  const p = new HealthPool();
  const e: EntityId = 1;
  p.attach(e, 10);
  p.applyDamage(e, 100, 0);
  assert.equal(p.applyDamage(e, 5, 0), 0);
});

test('health pool: invulnerable entities take 0 damage', () => {
  const p = new HealthPool();
  const e: EntityId = 1;
  p.attach(e, 100);
  p.setInvulnerable(e, true);
  assert.equal(p.applyDamage(e, 50, 0), 0);
  assert.equal(p.getHp(e), 100);
  p.setInvulnerable(e, false);
  assert.equal(p.applyDamage(e, 50, 0), 50);
});

test('health pool: heal caps at max', () => {
  const p = new HealthPool();
  const e: EntityId = 1;
  p.attach(e, 100);
  p.applyDamage(e, 60, 0);
  assert.equal(p.heal(e, 30), 30);
  assert.equal(p.getHp(e), 70);
  assert.equal(p.heal(e, 100), 30);   // capped at 100
  assert.equal(p.getHp(e), 100);
});

test('health pool: heal does NOT resurrect a dead entity', () => {
  const p = new HealthPool();
  const e: EntityId = 1;
  p.attach(e, 50);
  p.applyDamage(e, 100, 0);
  assert.equal(p.heal(e, 25), 0);
  assert.equal(p.getHp(e), 0);
  assert.ok(p.isDead(e));
});

test('health pool: lastDamageMs tracks damage timestamps', () => {
  const p = new HealthPool();
  const e: EntityId = 1;
  p.attach(e, 100);
  p.applyDamage(e, 5, 1234);
  const i = entityIndex(e);
  assert.equal(p.lastDamageMs[i], 1234);
});

// ---------- PursuePool ----------

test('pursue pool: attach + setTarget + isActive', () => {
  const p = new PursuePool();
  const enemy: EntityId = 2;
  const target: EntityId = 1;
  p.attach(enemy, target, 1.5, 0.5, 5, 1000);
  assert.ok(p.isActive(enemy));
  assert.equal(p.targetIndex[entityIndex(enemy)], 1);
  p.setTarget(enemy, 5);
  assert.equal(p.targetIndex[entityIndex(enemy)], 5);
});

// ---------- PursueSystem ----------

test('pursue system: walks toward target', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const transforms = new TransformPool();
  const pursuit = new PursuePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_PURSUE, pursuit);

  const player = w.createEntity();
  const enemy = w.createEntity();
  transforms.attach(player, 0, 0, 0);
  transforms.attach(enemy, 5, 0, 0);
  // 1 unit/sec speed, 0.1 stop distance, no contact damage.
  pursuit.attach(enemy, player, 1.0, 0.1, 0, 1000);

  w.addSystem(new PursueSystem(), SYSTEM_PHASE_LOGIC);
  w.update(1.0);   // 1 second of movement

  // Should have moved exactly 1 unit toward player (5 -> 4).
  const i = entityIndex(enemy);
  assert.ok(approxEq(transforms.x[i] ?? 0, 4, 1e-3));
});

test('pursue system: stops at stopDistance', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const transforms = new TransformPool();
  const pursuit = new PursuePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_PURSUE, pursuit);

  const player = w.createEntity();
  const enemy = w.createEntity();
  transforms.attach(player, 0, 0, 0);
  transforms.attach(enemy, 0.5, 0, 0);   // already within stop distance
  pursuit.attach(enemy, player, 10, 1.0, 0, 1000);

  w.addSystem(new PursueSystem(), SYSTEM_PHASE_LOGIC);
  w.update(1.0);
  // Did NOT move - was already in stop range.
  const i = entityIndex(enemy);
  assert.equal(transforms.x[i], 0.5);
});

test('pursue system: deals contact damage when in range with cooldown', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const transforms = new TransformPool();
  const pursuit = new PursuePool();
  const health = new HealthPool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_PURSUE, pursuit);
  w.registerPool(POOL_HEALTH, health);

  const player = w.createEntity();
  const enemy = w.createEntity();
  transforms.attach(player, 0, 0, 0);
  transforms.attach(enemy, 0.5, 0, 0);
  health.attach(player, 100);
  pursuit.attach(enemy, player, 1, 1.0, 7, 200);   // 7 dmg per 200ms

  w.addSystem(new PursueSystem(), SYSTEM_PHASE_LOGIC);

  // First tick - in range, applies 7 dmg.
  w.update(0.016);
  assert.equal(health.getHp(player), 93);

  // Immediate second tick - cooldown not elapsed, no damage.
  w.update(0.016);
  assert.equal(health.getHp(player), 93);
});

test('pursue system: stops pursuing dead target', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const transforms = new TransformPool();
  const pursuit = new PursuePool();
  const health = new HealthPool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_PURSUE, pursuit);
  w.registerPool(POOL_HEALTH, health);

  const player = w.createEntity();
  const enemy = w.createEntity();
  transforms.attach(player, 0, 0, 0);
  transforms.attach(enemy, 5, 0, 0);
  health.attach(player, 50);
  pursuit.attach(enemy, player, 10, 0.1, 0, 1000);

  // Kill the player.
  health.applyDamage(player, 100, 0);
  assert.ok(health.isDead(player));

  w.addSystem(new PursueSystem(), SYSTEM_PHASE_LOGIC);
  w.update(1.0);

  // Enemy did not move (target dead).
  const i = entityIndex(enemy);
  assert.equal(transforms.x[i], 5);
});

// ---------- DamageSystem ----------

test('damage system: cleans dead entities + detaches components', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const transforms = new TransformPool();
  const sprites = new SpritePool();
  const health = new HealthPool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_SPRITE, sprites);
  w.registerPool(POOL_HEALTH, health);
  const deathLog = new DeathLog();
  w.resources.set(RESOURCE_DEATH_LOG, deathLog);

  const e = w.createEntity();
  transforms.attach(e, 0, 0, 0);
  sprites.attach(e, 0, 0);
  health.attach(e, 10);

  // Kill it.
  const i = entityIndex(e);
  health.applyDamage(e, 100, 0);
  assert.ok((health.flags[i] ?? 0) & HEALTH_FLAG_DEAD);

  w.addSystem(new DamageSystem(), SYSTEM_PHASE_LOGIC);
  w.update(0.016);

  // Components detached.
  assert.equal(health.flags[i], 0);
  assert.equal(sprites.atlas[i], -1);
  assert.equal(transforms.flags[i] ?? 0, 0);
  // Death logged.
  assert.equal(deathLog.totalKills, 1);
  assert.equal(deathLog.recent.length, 1);
  // Entity destroyed (allocator state).
  assert.ok(!w.entities.isAlive(e));
});

test('damage system: ignores live entities', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const health = new HealthPool();
  w.registerPool(POOL_HEALTH, health);

  const e = w.createEntity();
  health.attach(e, 100);

  w.addSystem(new DamageSystem(), SYSTEM_PHASE_LOGIC);
  w.update(0.016);

  // Still alive.
  assert.ok(health.isAlive(e));
});

// ---------- AttackSystem ----------

test('attack system: damages nearest enemy on click', async () => {
  const { World } = await import('../src/world.js');
  const { InputManager } = await import('../src/input/input-manager.js');
  const w = new World();
  const transforms = new TransformPool();
  const health = new HealthPool();
  const pursuit = new PursuePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_HEALTH, health);
  w.registerPool(POOL_PURSUE, pursuit);
  const cam = createCamera(640, 400);
  w.resources.set(RESOURCE_CAMERA, cam);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  const player = w.createEntity();
  const enemy = w.createEntity();
  transforms.attach(player, 0, 0, 0);
  // enemy at tile (1, 0)
  transforms.attach(enemy, 1, 0, 0);
  health.attach(enemy, 50);
  pursuit.attach(enemy, player, 1, 0.5, 0, 1000);

  // Synthetic input snapshot: simulate a click at the canvas
  // pixel location that maps to tile (1, 0). Iso projection:
  // tileX=1 -> isoX = 32 (HALF_W=32). Camera centered at (0,0),
  // viewport (640, 400) -> screenX = 32 + 320 = 352.
  // tileY=0 -> isoY = 16. screenY = 16 + 200 = 216.
  const im = new InputManager();
  im.injectPointerMove(352, 216, 0);
  im.injectPointerDown(1);
  im.beginFrame();
  w.resources.set(RESOURCE_INPUT, im.snapshot());

  const attack = new AttackSystem({ damage: 25, range: 1.0, player });
  w.addSystem(attack, SYSTEM_PHASE_LOGIC);
  w.update(0.016);

  // Enemy took damage.
  assert.equal(health.getHp(enemy), 25);
  assert.equal(attack.lastTargetIndex, entityIndex(enemy));
  assert.equal(attack.lastDamageApplied, 25);
});

test('attack system: no-op when click is outside range', async () => {
  const { World } = await import('../src/world.js');
  const { InputManager } = await import('../src/input/input-manager.js');
  const w = new World();
  const transforms = new TransformPool();
  const health = new HealthPool();
  const pursuit = new PursuePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_HEALTH, health);
  w.registerPool(POOL_PURSUE, pursuit);
  const cam = createCamera(640, 400);
  w.resources.set(RESOURCE_CAMERA, cam);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  const player = w.createEntity();
  const enemy = w.createEntity();
  transforms.attach(player, 0, 0, 0);
  // enemy 10 units away from origin
  transforms.attach(enemy, 10, 0, 0);
  health.attach(enemy, 50);
  pursuit.attach(enemy, player, 1, 0.5, 0, 1000);

  // Click at canvas center = world tile origin.
  const im = new InputManager();
  im.injectPointerMove(320, 200, 0);
  im.injectPointerDown(1);
  im.beginFrame();
  w.resources.set(RESOURCE_INPUT, im.snapshot());

  const attack = new AttackSystem({ damage: 25, range: 1.0, player });
  w.addSystem(attack, SYSTEM_PHASE_LOGIC);
  w.update(0.016);

  // Enemy 10 units away is outside 1.0 range; no damage.
  assert.equal(health.getHp(enemy), 50);
  assert.equal(attack.lastTargetIndex, -1);
});

test('attack system: requires fresh click; held button does not retrigger', async () => {
  const { World } = await import('../src/world.js');
  const { InputManager } = await import('../src/input/input-manager.js');
  const w = new World();
  const transforms = new TransformPool();
  const health = new HealthPool();
  const pursuit = new PursuePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_HEALTH, health);
  w.registerPool(POOL_PURSUE, pursuit);
  const cam = createCamera(640, 400);
  w.resources.set(RESOURCE_CAMERA, cam);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  const player = w.createEntity();
  const enemy = w.createEntity();
  transforms.attach(player, 0, 0, 0);
  transforms.attach(enemy, 0.5, 0, 0);
  health.attach(enemy, 100);
  pursuit.attach(enemy, player, 1, 0.1, 0, 1000);

  const im = new InputManager();
  // Click at enemy position.
  im.injectPointerMove(352, 216, 1);
  im.injectPointerDown(1);
  im.beginFrame();
  w.resources.set(RESOURCE_INPUT, im.snapshot());

  const attack = new AttackSystem({ damage: 25, range: 2.0, player });
  w.addSystem(attack, SYSTEM_PHASE_LOGIC);
  w.update(0.016);
  assert.equal(health.getHp(enemy), 75);

  // Next frame: button still held but pointerPressedThisFrame
  // is cleared after beginFrame().
  im.beginFrame();
  w.resources.set(RESOURCE_INPUT, im.snapshot());
  w.update(0.016);
  // No additional damage.
  assert.equal(health.getHp(enemy), 75);
});
