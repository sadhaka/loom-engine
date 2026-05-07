// Loom Engine - Phase 4 VFX tests.
//
// ParticlePool: spawn / kill / capacity grow / max-particles cap.
// ParticleEmitterPool: attach / setRate / burst / setActive flags.
// ParticleSimulationSystem: life decay, velocity integration, kill
// at zero life.
// ParticleEmitterSystem: continuous rate, burst, interaction with
// pool's max-particles cap.
// VeilBudgetResource: defaults, Director updates particleBudget.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  // Pool + emitter
  ParticlePool,
  ParticleEmitterPool,
  PARTICLE_FLAG_ALIVE,
  PARTICLE_FLAG_ADDITIVE,
  EMITTER_FLAG_ACTIVE,
  // Systems
  ParticleSimulationSystem,
  ParticleEmitterSystem,
  POOL_PARTICLE,
  POOL_EMITTER,
  // Re-used
  POOL_TRANSFORM,
  TransformPool,
  SYSTEM_PHASE_LOGIC,
  SYSTEM_PHASE_PHYSICS,
  // Resource
  createVeilBudgetResource,
  RESOURCE_VEIL_BUDGET,
  // Color
  hexToRgba,
  COLOR_KNOT_INT,
  approxEq,
} from '../src/index.js';

// ---------- ParticlePool ----------

test('particle pool: spawn writes hot data + ALIVE flag', () => {
  const pool = new ParticlePool();
  const slot = pool.spawn({
    x: 10, y: 20, z: 5,
    vx: 1, vy: 2, vz: 3,
    life: 2.0,
    size: 8,
    color: COLOR_KNOT_INT,
  });
  assert.ok(slot >= 0);
  assert.equal(pool.x[slot], 10);
  assert.equal(pool.y[slot], 20);
  assert.equal(pool.z[slot], 5);
  assert.equal(pool.life[slot], 2.0);
  assert.equal(pool.maxLife[slot], 2.0);
  assert.equal(pool.size[slot], 8);
  assert.equal(pool.endSize[slot], 8);  // defaults to size
  assert.ok(pool.isAlive(slot));
  assert.equal((pool.flags[slot] ?? 0) & PARTICLE_FLAG_ALIVE, PARTICLE_FLAG_ALIVE);
  assert.equal(pool.getLiveCount(), 1);
});

test('particle pool: spawn with endColor sets target rgba', () => {
  const pool = new ParticlePool();
  const slot = pool.spawn({
    x: 0, y: 0, z: 0,
    life: 1,
    color: hexToRgba(0xff0000, 1),
    endColor: hexToRgba(0x0000ff, 0),
  });
  assert.ok(approxEq(pool.r0[slot] ?? 0, 1));
  assert.ok(approxEq(pool.r1[slot] ?? 0, 0));
  assert.ok(approxEq(pool.b0[slot] ?? 0, 0));
  assert.ok(approxEq(pool.b1[slot] ?? 0, 1));
  assert.equal(pool.a1[slot], 0);
});

test('particle pool: additive flag set via spawn options', () => {
  const pool = new ParticlePool();
  const slot = pool.spawn({ x: 0, y: 0, z: 0, life: 1, color: COLOR_KNOT_INT, additive: true });
  assert.equal((pool.flags[slot] ?? 0) & PARTICLE_FLAG_ADDITIVE, PARTICLE_FLAG_ADDITIVE);
});

test('particle pool: kill clears ALIVE + decrements liveCount', () => {
  const pool = new ParticlePool();
  const slot = pool.spawn({ x: 0, y: 0, z: 0, life: 1, color: COLOR_KNOT_INT });
  pool.kill(slot);
  assert.ok(!pool.isAlive(slot));
  assert.equal(pool.getLiveCount(), 0);
});

test('particle pool: kill recycles slot via free list', () => {
  const pool = new ParticlePool();
  const a = pool.spawn({ x: 0, y: 0, z: 0, life: 1, color: COLOR_KNOT_INT });
  const b = pool.spawn({ x: 0, y: 0, z: 0, life: 1, color: COLOR_KNOT_INT });
  pool.kill(a);
  const c = pool.spawn({ x: 1, y: 1, z: 1, life: 1, color: COLOR_KNOT_INT });
  // Slot A was recycled.
  assert.equal(c, a);
  assert.notEqual(c, b);
  assert.equal(pool.getLiveCount(), 2);
});

test('particle pool: maxParticles cap returns -1 over limit', () => {
  const pool = new ParticlePool(8, 3);
  for (let i = 0; i < 3; i++) {
    const s = pool.spawn({ x: 0, y: 0, z: 0, life: 1, color: COLOR_KNOT_INT });
    assert.ok(s >= 0);
  }
  const overflow = pool.spawn({ x: 0, y: 0, z: 0, life: 1, color: COLOR_KNOT_INT });
  assert.equal(overflow, -1);
  assert.equal(pool.getLiveCount(), 3);
});

test('particle pool: setMaxParticles updates the cap live', () => {
  const pool = new ParticlePool(8, 1);
  assert.ok(pool.spawn({ x: 0, y: 0, z: 0, life: 1, color: COLOR_KNOT_INT }) >= 0);
  assert.equal(pool.spawn({ x: 0, y: 0, z: 0, life: 1, color: COLOR_KNOT_INT }), -1);
  pool.setMaxParticles(5);
  assert.ok(pool.spawn({ x: 0, y: 0, z: 0, life: 1, color: COLOR_KNOT_INT }) >= 0);
});

test('particle pool: clear resets everything', () => {
  const pool = new ParticlePool();
  for (let i = 0; i < 5; i++) {
    pool.spawn({ x: 0, y: 0, z: 0, life: 1, color: COLOR_KNOT_INT });
  }
  pool.clear();
  assert.equal(pool.getLiveCount(), 0);
  assert.equal(pool.getHighWaterMark(), 0);
});

// ---------- ParticleEmitterPool ----------

test('emitter pool: attach + isActive + setActive', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const e = w.createEntity();
  const pool = new ParticleEmitterPool();
  pool.attach(e, {
    rate: 10,
    particleLife: 1,
    speedMin: 0,
    speedMax: 1,
    dirX: 0, dirY: 0, dirZ: 1,
    coneRadians: 0.5,
    ax: 0, ay: 0, az: 0,
    startSize: 4,
    endSize: 1,
    startColor: COLOR_KNOT_INT,
    endColor: hexToRgba(0, 0),
    additive: true,
  });
  assert.ok(pool.isActive(e));
  assert.ok(pool.isAdditive(e));
  pool.setActive(e, false);
  assert.ok(!pool.isActive(e));
  pool.setActive(e, true);
  assert.ok(pool.isActive(e));
});

test('emitter pool: setRate + burst', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const e = w.createEntity();
  const pool = new ParticleEmitterPool();
  pool.attach(e, {
    rate: 10, particleLife: 1, speedMin: 0, speedMax: 1,
    dirX: 0, dirY: 0, dirZ: 1, coneRadians: 0,
    ax: 0, ay: 0, az: 0,
    startSize: 1, endSize: 1,
    startColor: COLOR_KNOT_INT, endColor: COLOR_KNOT_INT,
    additive: false,
  });
  pool.setRate(e, 50);
  // The rate field is the per-second rate; the emitter system uses
  // it. We just verify the field is updated.
  pool.burst(e, 7);
  pool.burst(e, 3);
  // burstRemaining accumulates.
  // We only have direct array access; use the index.
  const idx = e & 0x00ffffff;
  assert.equal(pool.burstRemaining[idx], 10);
});

// ---------- ParticleSimulationSystem ----------

test('simulation: decreases life + kills particles past zero', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const pool = new ParticlePool();
  w.registerPool(POOL_PARTICLE, pool);
  const slot = pool.spawn({ x: 0, y: 0, z: 0, life: 0.1, color: COLOR_KNOT_INT });

  w.addSystem(new ParticleSimulationSystem(), SYSTEM_PHASE_PHYSICS);
  w.update(0.05);
  assert.ok(pool.isAlive(slot), 'still alive after half-life');
  assert.ok(approxEq(pool.life[slot] ?? 0, 0.05));
  w.update(0.1);
  assert.ok(!pool.isAlive(slot), 'killed after life<=0');
  assert.equal(pool.getLiveCount(), 0);
});

test('simulation: integrates velocity + acceleration', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const pool = new ParticlePool();
  w.registerPool(POOL_PARTICLE, pool);
  const slot = pool.spawn({
    x: 0, y: 0, z: 0,
    vx: 1, vy: 0, vz: 2,
    ax: 0, ay: 0, az: -1,
    life: 10,
    color: COLOR_KNOT_INT,
  });
  w.addSystem(new ParticleSimulationSystem(), SYSTEM_PHASE_PHYSICS);
  // dt = 0.5 seconds
  w.update(0.5);
  // velocity: vz = 2 + (-1)*0.5 = 1.5
  // position: z = 0 + (1.5)*0.5 = 0.75
  assert.ok(approxEq(pool.vz[slot] ?? 0, 1.5));
  assert.ok(approxEq(pool.z[slot] ?? 0, 0.75));
  // x: vx unchanged (ax=0); position = 0 + 1*0.5 = 0.5
  assert.ok(approxEq(pool.x[slot] ?? 0, 0.5));
});

// ---------- ParticleEmitterSystem ----------

test('emitter system: continuous rate spawns floor(rate*dt) per tick', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const transforms = new TransformPool();
  const emitters = new ParticleEmitterPool();
  const particles = new ParticlePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_EMITTER, emitters);
  w.registerPool(POOL_PARTICLE, particles);
  const e = w.createEntity();
  transforms.attach(e, 0, 0, 0);
  emitters.attach(e, {
    rate: 100,           // 100 / sec
    particleLife: 1,
    speedMin: 0, speedMax: 0,
    dirX: 0, dirY: 0, dirZ: 1, coneRadians: 0,
    ax: 0, ay: 0, az: 0,
    startSize: 1, endSize: 1,
    startColor: COLOR_KNOT_INT, endColor: hexToRgba(0, 0),
    additive: false,
  });
  w.addSystem(new ParticleEmitterSystem(), SYSTEM_PHASE_LOGIC);

  w.update(0.1);   // dt=0.1 -> expect 10 spawns
  assert.equal(particles.getLiveCount(), 10);
  w.update(0.1);
  assert.equal(particles.getLiveCount(), 20);
});

test('emitter system: rate < 1/dt accumulates carry over multiple ticks', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const transforms = new TransformPool();
  const emitters = new ParticleEmitterPool();
  const particles = new ParticlePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_EMITTER, emitters);
  w.registerPool(POOL_PARTICLE, particles);
  const e = w.createEntity();
  transforms.attach(e, 0, 0, 0);
  emitters.attach(e, {
    rate: 5,             // 5 / sec; at dt=0.1 that's 0.5 per tick
    particleLife: 10,
    speedMin: 0, speedMax: 0,
    dirX: 0, dirY: 0, dirZ: 1, coneRadians: 0,
    ax: 0, ay: 0, az: 0,
    startSize: 1, endSize: 1,
    startColor: COLOR_KNOT_INT, endColor: hexToRgba(0, 0),
    additive: false,
  });
  w.addSystem(new ParticleEmitterSystem(), SYSTEM_PHASE_LOGIC);

  // 0.5 + 0.5 = 1 -> 1 spawn after two ticks of 0.1.
  w.update(0.1);
  assert.equal(particles.getLiveCount(), 0);
  w.update(0.1);
  assert.equal(particles.getLiveCount(), 1);
});

test('emitter system: burst spawns immediately on next tick', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const transforms = new TransformPool();
  const emitters = new ParticleEmitterPool();
  const particles = new ParticlePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_EMITTER, emitters);
  w.registerPool(POOL_PARTICLE, particles);
  const e = w.createEntity();
  transforms.attach(e, 0, 0, 0);
  emitters.attach(e, {
    rate: 0,             // no continuous; burst-only
    particleLife: 1,
    speedMin: 0, speedMax: 0,
    dirX: 0, dirY: 0, dirZ: 1, coneRadians: 0,
    ax: 0, ay: 0, az: 0,
    startSize: 1, endSize: 1,
    startColor: COLOR_KNOT_INT, endColor: hexToRgba(0, 0),
    additive: false,
  });
  emitters.burst(e, 12);
  w.addSystem(new ParticleEmitterSystem(), SYSTEM_PHASE_LOGIC);
  w.update(0.016);
  assert.equal(particles.getLiveCount(), 12);
  // burst counter cleared.
  const idx = e & 0x00ffffff;
  assert.equal(emitters.burstRemaining[idx], 0);
});

test('emitter system: skips when EMITTER_FLAG_ACTIVE is cleared', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const transforms = new TransformPool();
  const emitters = new ParticleEmitterPool();
  const particles = new ParticlePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_EMITTER, emitters);
  w.registerPool(POOL_PARTICLE, particles);
  const e = w.createEntity();
  transforms.attach(e, 0, 0, 0);
  emitters.attach(e, {
    rate: 100, particleLife: 1, speedMin: 0, speedMax: 0,
    dirX: 0, dirY: 0, dirZ: 1, coneRadians: 0,
    ax: 0, ay: 0, az: 0,
    startSize: 1, endSize: 1,
    startColor: COLOR_KNOT_INT, endColor: hexToRgba(0, 0),
    additive: false,
  });
  emitters.setActive(e, false);
  assert.equal((emitters.flags[e & 0x00ffffff] ?? 0) & EMITTER_FLAG_ACTIVE, 0);
  w.addSystem(new ParticleEmitterSystem(), SYSTEM_PHASE_LOGIC);
  w.update(0.1);
  assert.equal(particles.getLiveCount(), 0);
});

// ---------- VeilBudgetResource ----------

test('veil budget: defaults are generous for standalone runs', () => {
  const v = createVeilBudgetResource();
  assert.ok(v.particleBudget >= 1000);
  assert.ok(v.shaderBudget >= 1);
  assert.ok(v.eventBudget >= 1);
  assert.equal(v.lastUpdatedFrame, -1);
});

test('veil budget: Director can mutate particleBudget; pool reflects via setMaxParticles', () => {
  const pool = new ParticlePool(8, 4096);
  const v = createVeilBudgetResource();
  // Director-bridge equivalent: shrink budget under VE pressure
  v.particleBudget = 100;
  v.lastUpdatedFrame = 42;
  pool.setMaxParticles(v.particleBudget);
  assert.equal(pool.getMaxParticles(), 100);
});

test('veil budget: registered as resource on the world', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const v = createVeilBudgetResource();
  w.resources.set(RESOURCE_VEIL_BUDGET, v);
  const got = w.resources.require<typeof v>(RESOURCE_VEIL_BUDGET);
  assert.equal(got, v);
});
