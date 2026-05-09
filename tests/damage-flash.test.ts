// Phase 0.93.0 - DamageFlash tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  DamageFlash,
  RESOURCE_DAMAGE_FLASH,
  type DamageFlashRenderState,
} from '../src/index.js';

test('damage-flash: RESOURCE_DAMAGE_FLASH stable string', () => {
  assert.equal(RESOURCE_DAMAGE_FLASH, 'damage_flash');
});

test('damage-flash: defaults', () => {
  const f = DamageFlash.create();
  assert.equal(f.activeCount(), 0);
  assert.equal(f.capacity(), 64);
});

test('damage-flash: flash adds + has', () => {
  const f = DamageFlash.create();
  assert.ok(f.flash({ entityId: 'm1' }));
  assert.ok(f.has('m1'));
  assert.equal(f.activeCount(), 1);
});

test('damage-flash: flash invalid spawn rejected', () => {
  const f = DamageFlash.create();
  assert.equal(f.flash({ entityId: '' }), false);
});

test('damage-flash: flash on existing entity overwrites + resets age', () => {
  const f = DamageFlash.create();
  f.flash({ entityId: 'm1', durationMs: 200, color: 0xff0000 });
  f.tick(100);
  let state: DamageFlashRenderState | null = null;
  f.forEach((s) => { state = s; });
  assert.equal(state!.ageMs, 100);
  assert.equal(state!.color, 0xff0000);
  // Re-flash with new color: age resets.
  f.flash({ entityId: 'm1', durationMs: 200, color: 0x0000ff });
  f.forEach((s) => { state = s; });
  assert.equal(state!.ageMs, 0);
  assert.equal(state!.color, 0x0000ff);
  assert.equal(f.activeCount(), 1);
});

test('damage-flash: capacity full rejects new entities', () => {
  const f = DamageFlash.create({ capacity: 2 });
  f.flash({ entityId: 'a' });
  f.flash({ entityId: 'b' });
  assert.equal(f.flash({ entityId: 'c' }), false);
  // But existing entity can be re-flashed.
  assert.ok(f.flash({ entityId: 'a' }));
});

test('damage-flash: tick advances age + auto-removes when expired', () => {
  const f = DamageFlash.create({ defaultDurationMs: 100 });
  f.flash({ entityId: 'm1' });
  f.tick(50);
  assert.ok(f.has('m1'));
  f.tick(60); // total 110 > 100
  assert.equal(f.has('m1'), false);
});

test('damage-flash: alpha decays linearly with age', () => {
  const f = DamageFlash.create({ defaultDurationMs: 100 });
  f.flash({ entityId: 'm1', intensity: 1 });
  let state: DamageFlashRenderState | null = null;
  f.forEach((s) => { state = s; });
  // age 0 -> alpha = 1 * (1 - 0) = 1
  assert.equal(state!.alpha, 1);
  f.tick(50);
  f.forEach((s) => { state = s; });
  // age 50 / 100 = 0.5 -> alpha = 0.5
  assert.ok(Math.abs(state!.alpha - 0.5) < 1e-6);
});

test('damage-flash: intensity option scales peak alpha', () => {
  const f = DamageFlash.create({ defaultDurationMs: 100 });
  f.flash({ entityId: 'm1', intensity: 0.5 });
  let state: DamageFlashRenderState | null = null;
  f.forEach((s) => { state = s; });
  assert.equal(state!.alpha, 0.5); // 0.5 * (1 - 0)
  assert.equal(state!.intensity, 0.5);
});

test('damage-flash: intensity clamped to [0, 1]', () => {
  const f = DamageFlash.create();
  f.flash({ entityId: 'm1', intensity: 99 });
  let state: DamageFlashRenderState | null = null;
  f.forEach((s) => { state = s; });
  assert.equal(state!.intensity, 1);
  f.flash({ entityId: 'm2', intensity: -5 });
  f.forEach((s) => { if (s.entityId === 'm2') state = s; });
  assert.equal(state!.intensity, 0);
});

test('damage-flash: invalid duration falls back to default', () => {
  const f = DamageFlash.create({ defaultDurationMs: 200 });
  f.flash({ entityId: 'm1', durationMs: -1 });
  let state: DamageFlashRenderState | null = null;
  f.forEach((s) => { state = s; });
  assert.equal(state!.durationMs, 200);
});

test('damage-flash: remove drops manually', () => {
  const f = DamageFlash.create();
  f.flash({ entityId: 'm1' });
  assert.ok(f.remove('m1'));
  assert.equal(f.has('m1'), false);
  assert.equal(f.remove('m1'), false);
});

test('damage-flash: clearAll empties', () => {
  const f = DamageFlash.create();
  for (let i = 0; i < 5; i++) f.flash({ entityId: 'm' + i });
  f.clearAll();
  assert.equal(f.activeCount(), 0);
});

test('damage-flash: forEach iterates all active flashes', () => {
  const f = DamageFlash.create();
  f.flash({ entityId: 'a' });
  f.flash({ entityId: 'b' });
  f.flash({ entityId: 'c' });
  const seen: string[] = [];
  f.forEach((s) => seen.push(s.entityId));
  assert.deepEqual(seen.sort(), ['a', 'b', 'c']);
});

test('damage-flash: forEach with throwing cb is isolated', () => {
  const f = DamageFlash.create();
  f.flash({ entityId: 'a' });
  f.flash({ entityId: 'b' });
  let count = 0;
  f.forEach(() => { count++; throw new Error('boom'); });
  assert.equal(count, 2);
});

test('damage-flash: NaN / negative dt no-op', () => {
  const f = DamageFlash.create({ defaultDurationMs: 100 });
  f.flash({ entityId: 'm1' });
  f.tick(NaN);
  f.tick(-50);
  let state: DamageFlashRenderState | null = null;
  f.forEach((s) => { state = s; });
  assert.equal(state!.ageMs, 0);
});

test('damage-flash: dispose locks ops', () => {
  const f = DamageFlash.create();
  f.flash({ entityId: 'm1' });
  f.dispose();
  assert.equal(f.flash({ entityId: 'm2' }), false);
  let visited = 0;
  f.forEach(() => { visited++; });
  assert.equal(visited, 0);
  assert.equal(f.activeCount(), 0);
});

test('damage-flash: realistic boss hit reaction', () => {
  const f = DamageFlash.create({
    defaultColor: 0xff4040,
    defaultDurationMs: 120,
  });
  // Player hits boss.
  assert.ok(f.flash({ entityId: 'boss_1' }));
  let alphas: number[] = [];
  for (let t = 0; t < 4; t++) {
    f.forEach((s) => alphas.push(s.alpha));
    f.tick(30);
  }
  // Alpha should be monotonically decreasing.
  for (let i = 0; i < alphas.length - 1; i++) {
    assert.ok(alphas[i]! > alphas[i + 1]!,
              'alpha should decrease: ' + JSON.stringify(alphas));
  }
});

test('damage-flash: defaults applied on omitted fields', () => {
  const f = DamageFlash.create({
    defaultColor: 0x123456,
    defaultDurationMs: 75,
  });
  f.flash({ entityId: 'm1' });
  let state: DamageFlashRenderState | null = null;
  f.forEach((s) => { state = s; });
  assert.equal(state!.color, 0x123456);
  assert.equal(state!.durationMs, 75);
  assert.equal(state!.intensity, 1);
});

test('damage-flash: state shape carries entityId / age / duration / intensity', () => {
  const f = DamageFlash.create({ defaultDurationMs: 100 });
  f.flash({ entityId: 'm1', color: 0xabcdef });
  f.tick(40);
  let state: DamageFlashRenderState | null = null;
  f.forEach((s) => { state = s; });
  assert.equal(state!.entityId, 'm1');
  assert.equal(state!.color, 0xabcdef);
  assert.equal(state!.ageMs, 40);
  assert.equal(state!.durationMs, 100);
  assert.equal(state!.intensity, 1);
});

test('damage-flash: many simultaneous flashes within capacity', () => {
  const f = DamageFlash.create({ capacity: 100 });
  for (let i = 0; i < 100; i++) {
    assert.ok(f.flash({ entityId: 'mob' + i }));
  }
  assert.equal(f.activeCount(), 100);
  // 101st rejected.
  assert.equal(f.flash({ entityId: 'mob100' }), false);
});
