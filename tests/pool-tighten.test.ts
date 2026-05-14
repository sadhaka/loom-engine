// Loom Engine - pool high-water-mark tightening tests.
//
// detach / kill clear a slot's flags byte but leave highWaterMark
// where it was, so a create/destroy spike makes every future scan
// pay for dead address space. tighten() walks back past the trailing
// dead slots and lowers highWaterMark. TransformPool and
// ParticleEmitterPool carry an explicit ATTACHED flag so a
// hidden-but-attached / paused-but-attached slot is not mistaken for
// a free one.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  HealthPool,
  TransformPool,
  ParticleEmitterPool,
  ParticlePool,
  ProjectilePool,
} from '../src/index.js';

test('tighten: lowers highWaterMark past a trailing run of detached slots', () => {
  const h = new HealthPool();
  for (let e = 1; e <= 5; e++) h.attach(e, 100);
  assert.equal(h.getHighWaterMark(), 6);
  h.detach(4);
  h.detach(5);
  // Detach alone does not move the mark.
  assert.equal(h.getHighWaterMark(), 6);
  h.tighten();
  assert.equal(h.getHighWaterMark(), 4, 'mark drops past detached indices 4 and 5');
});

test('tighten: is a no-op when the top slot is still attached', () => {
  const h = new HealthPool();
  for (let e = 1; e <= 4; e++) h.attach(e, 100);
  h.detach(2);   // a hole in the middle, top still live
  h.tighten();
  assert.equal(h.getHighWaterMark(), 5, 'top slot 4 still attached -> mark unchanged');
});

test('tighten: a fresh attach after tighten re-raises the mark', () => {
  const h = new HealthPool();
  for (let e = 1; e <= 5; e++) h.attach(e, 100);
  h.detach(5);
  h.detach(4);
  h.detach(3);
  h.tighten();
  assert.equal(h.getHighWaterMark(), 3);
  h.attach(7, 50);
  assert.equal(h.getHighWaterMark(), 8, 'attach at index 7 re-raises the mark');
});

test('tighten: TransformPool keeps a hidden-but-attached entity', () => {
  const t = new TransformPool();
  for (let e = 1; e <= 4; e++) t.attach(e, 0, 0, 0);
  // Hide the top entity: setVisible(false) clears VISIBLE, the commit
  // pass clears DIRTY - only the ATTACHED flag is left to keep the
  // slot live for tighten().
  t.setVisible(4, false);
  t.clearDirtyAt(4);
  t.tighten();
  assert.equal(t.getHighWaterMark(), 5,
    'a hidden, committed, still-attached entity is not tightened away');
  // Detaching it does let tighten reclaim the slot.
  t.detach(4);
  t.tighten();
  assert.equal(t.getHighWaterMark(), 4);
});

test('tighten: ParticleEmitterPool keeps a paused-but-attached emitter', () => {
  const em = new ParticleEmitterPool();
  const cfg = {
    rate: 10, particleLife: 1, speedMin: 1, speedMax: 2,
    dirX: 0, dirY: -1, dirZ: 0, coneRadians: 0,
    ax: 0, ay: 0, az: 0, startSize: 4, endSize: 1,
    startColor: { r: 1, g: 1, b: 1, a: 1 },
    endColor: { r: 1, g: 1, b: 1, a: 0 },
    additive: false,
  };
  for (let e = 1; e <= 3; e++) em.attach(e, cfg);
  em.setActive(3, false);   // paused, but still attached
  em.tighten();
  assert.equal(em.getHighWaterMark(), 4,
    'a paused (setActive false) but attached emitter survives tighten');
  em.detach(3);
  em.tighten();
  assert.equal(em.getHighWaterMark(), 3);
});

test('tighten: ParticlePool drops free-list slots above the new mark', () => {
  const p = new ParticlePool();
  const color = { r: 1, g: 1, b: 1, a: 1 };
  // Spawn 6 (slots 0..5), then kill the top 3.
  for (let i = 0; i < 6; i++) p.spawn({ x: i, y: 0, z: 0, life: 1, color });
  p.kill(5);
  p.kill(4);
  p.kill(3);
  assert.equal(p.getHighWaterMark(), 6);
  p.tighten();
  assert.equal(p.getHighWaterMark(), 3, 'mark drops past killed slots 3,4,5');
  // The free list no longer holds 3/4/5; the next spawn must land
  // inside the iteration range, never at a stale out-of-range slot.
  const slot = p.spawn({ x: 0, y: 0, z: 0, life: 1, color });
  assert.equal(slot, 3, 'spawn after tighten lands at the fresh top, not a dropped free slot');
  // liveCount survived: 6 spawned - 3 killed = 3, then +1 = 4.
  assert.equal(p.getLiveCount(), 4);
});

test('tighten: ProjectilePool drops free-list slots above the new mark', () => {
  const pr = new ProjectilePool();
  const color = { r: 1, g: 1, b: 1, a: 1 };
  for (let i = 0; i < 5; i++) {
    pr.spawn({
      x: i, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, damage: 1,
      ownerEntity: 0, size: 1, color,
    });
  }
  pr.kill(4);
  pr.kill(3);
  pr.tighten();
  assert.equal(pr.getHighWaterMark(), 3, 'mark drops past killed slots 3,4');
  const slot = pr.spawn({
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, damage: 1,
    ownerEntity: 0, size: 1, color,
  });
  assert.equal(slot, 3);
  assert.equal(pr.getLiveCount(), 4);
});
