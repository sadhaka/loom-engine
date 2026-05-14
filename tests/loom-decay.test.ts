// Loom Engine - LoomDecay (procedural material entropy) tests.
//
// Covers the MaterialHandle helpers, constructor validation, the
// spawn / recycle lifecycle with generation-validated handles, the
// seeded-PRNG chunked decay (determinism, per-chunk isolation,
// inactive-slot skipping, hibernation catch-up, fatigue clamp), the
// transition table with reaction priority, the phase-change command
// buffer (commit, generation-validated rejection of stale commands,
// recycling), and the overflow guard.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  LoomDecay,
  makeMaterialHandle,
  materialSlot,
  materialGeneration,
  createEntropy,
} from '../src/index.js';

test('loom decay: MaterialHandle packs and unpacks slot + generation', () => {
  for (const [slot, gen] of [[0, 0], [5, 1], [12345, 200], [0x00ffffff, 0xff]] as const) {
    const h = makeMaterialHandle(slot, gen);
    assert.equal(materialSlot(h), slot, 'slot ' + slot);
    assert.equal(materialGeneration(h), gen, 'gen ' + gen);
  }
});

test('loom decay: constructor validates chunk dimensions and the transition table', () => {
  const ld = new LoomDecay(2, 4, [{ fromType: 1, fatigueThreshold: 5, toType: 2, priority: 0, recycle: false }]);
  assert.equal(ld.chunkCount, 2);
  assert.equal(ld.chunkSize, 4);
  assert.equal(ld.capacity, 8);
  assert.equal(ld.ruleCount, 1);
  assert.throws(() => new LoomDecay(0, 4, []), /chunkCount/);
  assert.throws(() => new LoomDecay(2, 2.5, []), /chunkSize/);
  assert.throws(() => new LoomDecay(1 << 17, 1 << 4, []), /exceeds the cap/);
  // A malformed rule.
  assert.throws(
    () => new LoomDecay(1, 1, [{ fromType: -1, fatigueThreshold: 5, toType: 2, priority: 0, recycle: false }]),
    /transitionRules\[0\]/,
  );
});

test('loom decay: spawn / isAlive / getType / getFatigue', () => {
  const ld = new LoomDecay(1, 8, []);
  const h = ld.spawn(3, 42);
  assert.equal(ld.isAlive(h), true);
  assert.equal(ld.getType(h), 42);
  assert.equal(ld.getFatigue(h), 0);
  assert.equal(ld.getActiveMaterialCount(), 1);
  // Spawning into an occupied slot throws.
  assert.throws(() => ld.spawn(3, 7), /already active/);
  // A never-spawned handle is not alive; reads return -1.
  const ghost = makeMaterialHandle(5, 0);
  assert.equal(ld.isAlive(ghost), false);
  assert.equal(ld.getType(ghost), -1);
  assert.equal(ld.getFatigue(ghost), -1);
});

test('loom decay: recycle frees the slot and invalidates the old handle', () => {
  const ld = new LoomDecay(1, 8, []);
  const h = ld.spawn(0, 1);
  assert.equal(ld.recycle(h), true);
  assert.equal(ld.isAlive(h), false, 'the recycled handle is dead');
  assert.equal(ld.getActiveMaterialCount(), 0);
  assert.equal(ld.recycle(h), false, 'recycling a dead handle is a no-op');
  // Re-spawning the slot gives a fresh handle; the old one stays dead.
  const h2 = ld.spawn(0, 2);
  assert.notEqual(h2, h, 'generation bumped, so the handle differs');
  assert.equal(ld.isAlive(h2), true);
  assert.equal(ld.isAlive(h), false);
});

test('loom decay: applyDecay advances fatigue under the seeded PRNG', () => {
  const ld = new LoomDecay(1, 4, []);
  const h = ld.spawn(0, 1);
  const entropy = createEntropy(0x1234);
  // factor 0 -> entropy.random() (in [0,1)) is never < 0, no decay.
  let stats = ld.applyDecay(0, 0, 1, entropy);
  assert.equal(stats.decayed, 0);
  assert.equal(ld.getFatigue(h), 0);
  // factor 1 -> entropy.random() is always < 1, every active slot decays.
  stats = ld.applyDecay(0, 1, 2, entropy);
  assert.equal(stats.decayed, 1);
  assert.ok(ld.getFatigue(h) > 0);
});

test('loom decay: applyDecay is deterministic for a given seed', () => {
  function run(): number {
    const ld = new LoomDecay(1, 4, []);
    const h = ld.spawn(0, 1);
    const entropy = createEntropy(0xABCDEF);
    for (let t = 1; t <= 8; t++) ld.applyDecay(0, 0.5, t, entropy);
    return ld.getFatigue(h);
  }
  assert.equal(run(), run(), 'identical seed + sequence produces identical fatigue');
});

test('loom decay: applyDecay only touches the addressed chunk', () => {
  const ld = new LoomDecay(2, 2, []);
  const a = ld.spawn(0, 1);   // chunk 0
  const b = ld.spawn(2, 1);   // chunk 1
  const entropy = createEntropy(1);
  ld.applyDecay(0, 1, 1, entropy);
  assert.ok(ld.getFatigue(a) > 0, 'chunk 0 decayed');
  assert.equal(ld.getFatigue(b), 0, 'chunk 1 untouched');
});

test('loom decay: applyDecay skips inactive slots', () => {
  const ld = new LoomDecay(1, 4, []);
  ld.spawn(0, 1);
  ld.spawn(2, 1);
  // slots 1 and 3 are never spawned.
  const stats = ld.applyDecay(0, 1, 1, createEntropy(2));
  assert.equal(stats.decayed, 2, 'only the 2 active slots decayed');
});

test('loom decay: a hibernated chunk catches up, fatigue clamps at the u16 ceiling', () => {
  const ld = new LoomDecay(1, 1, []);   // no rules - fatigue never transitions away
  const h = ld.spawn(0, 5);
  const entropy = createEntropy(7);
  // currentTick jumps by 100 each call: elapsed 100 -> catch-up capped
  // at 64 decay rolls. Enough calls to overrun the u16 ceiling.
  for (let t = 1; t <= 1100; t++) ld.applyDecay(0, 1, t * 100, entropy);
  assert.equal(ld.getFatigue(h), 0xffff, 'fatigue saturates at 65535, never wraps');
});

test('loom decay: crossing a fatigue threshold queues a phase-change command', () => {
  const ld = new LoomDecay(1, 1, [{ fromType: 1, fatigueThreshold: 5, toType: 2, priority: 0, recycle: false }]);
  const h = ld.spawn(0, 1);
  const entropy = createEntropy(9);
  ld.applyDecay(0, 1, 10, entropy);          // first call: +1 fatigue
  const stats = ld.applyDecay(0, 1, 20, entropy);   // elapsed 10: +10 fatigue -> past threshold 5
  assert.equal(stats.transitioned, 1);
  assert.equal(ld.getCommandCount(), 1, 'queued, not yet applied');
  assert.equal(ld.getType(h), 1, 'type unchanged until commit');
  const commit = ld.commit();
  assert.deepEqual(commit, { applied: 1, rejected: 0 });
  assert.equal(ld.getType(h), 2, 'transitioned on commit');
  assert.equal(ld.getFatigue(h), 0, 'fatigue reset on transition');
  assert.equal(ld.getCommandCount(), 0);
});

test('loom decay: when several rules fire, the highest priority wins', () => {
  const ld = new LoomDecay(1, 1, [
    { fromType: 1, fatigueThreshold: 3, toType: 2, priority: 1, recycle: false },
    { fromType: 1, fatigueThreshold: 3, toType: 99, priority: 5, recycle: false },
  ]);
  const h = ld.spawn(0, 1);
  const entropy = createEntropy(11);
  ld.applyDecay(0, 1, 1, entropy);
  ld.applyDecay(0, 1, 10, entropy);   // elapsed 9 -> well past threshold 3
  ld.commit();
  assert.equal(ld.getType(h), 99, 'priority 5 rule won over priority 1');
});

test('loom decay: a recycle rule frees the material on commit', () => {
  const ld = new LoomDecay(1, 1, [{ fromType: 1, fatigueThreshold: 3, toType: 0, priority: 0, recycle: true }]);
  const h = ld.spawn(0, 1);
  const entropy = createEntropy(13);
  ld.applyDecay(0, 1, 1, entropy);
  ld.applyDecay(0, 1, 10, entropy);
  assert.equal(ld.commit().applied, 1);
  assert.equal(ld.isAlive(h), false, 'the material was recycled');
  assert.equal(ld.getActiveMaterialCount(), 0);
});

test('loom decay: commit rejects a stale command whose slot was recycled', () => {
  const ld = new LoomDecay(1, 1, [{ fromType: 1, fatigueThreshold: 3, toType: 2, priority: 0, recycle: false }]);
  const h = ld.spawn(0, 1);
  const entropy = createEntropy(17);
  ld.applyDecay(0, 1, 1, entropy);
  ld.applyDecay(0, 1, 10, entropy);   // a transition command for (slot 0, gen 0) is queued
  // Recycle the material out from under the queued command, then re-spawn.
  ld.recycle(h);
  const h2 = ld.spawn(0, 8);          // slot 0, generation now bumped
  const commit = ld.commit();
  assert.deepEqual(commit, { applied: 0, rejected: 1 }, 'the stale command is rejected, not applied');
  assert.equal(ld.getType(h2), 8, 'the re-spawned material is untouched');
});

test('loom decay: the phase-change command buffer throws when it overflows', () => {
  // capacity 1: one queued command fills the buffer.
  const ld = new LoomDecay(1, 1, [{ fromType: 1, fatigueThreshold: 1, toType: 2, priority: 0, recycle: false }]);
  ld.spawn(0, 1);
  const entropy = createEntropy(19);
  ld.applyDecay(0, 1, 1, entropy);    // fatigue 1 >= threshold 1 -> 1 command queued
  assert.equal(ld.getCommandCount(), 1);
  // A second decay cycle without commit() would queue a 2nd command.
  assert.throws(() => ld.applyDecay(0, 1, 2, entropy), /command buffer full/);
});

test('loom decay: clear resets the pool, the command buffer, and the counts', () => {
  const ld = new LoomDecay(1, 4, [{ fromType: 1, fatigueThreshold: 3, toType: 2, priority: 0, recycle: false }]);
  const h = ld.spawn(0, 1);
  const entropy = createEntropy(23);
  ld.applyDecay(0, 1, 1, entropy);
  ld.applyDecay(0, 1, 10, entropy);   // queues a command
  ld.clear();
  assert.equal(ld.getActiveMaterialCount(), 0);
  assert.equal(ld.getCommandCount(), 0);
  assert.equal(ld.isAlive(h), false);
  // Fresh use after clear works.
  const h2 = ld.spawn(0, 1);
  assert.equal(ld.isAlive(h2), true);
});
