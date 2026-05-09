// Phase 0.80.0 - HealthBar tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  HealthBar,
  RESOURCE_HEALTH_BAR,
  type HealthBarRenderState,
} from '../src/index.js';

test('health-bar: RESOURCE_HEALTH_BAR is the stable string', () => {
  assert.equal(RESOURCE_HEALTH_BAR, 'health_bar');
});

test('health-bar: upsert adds (returns 1) + idempotent update (returns 0)', () => {
  const bars = HealthBar.create();
  assert.equal(bars.upsert({ entityId: 'm1', x: 10, y: 20, hp: 50, maxHp: 100 }), 1);
  assert.equal(bars.activeCount(), 1);
  assert.equal(bars.upsert({ entityId: 'm1', x: 11, y: 21, hp: 30, maxHp: 100 }), 0);
  assert.equal(bars.activeCount(), 1);
});

test('health-bar: invalid spawn rejected (-1)', () => {
  const bars = HealthBar.create();
  assert.equal(bars.upsert({ entityId: '', x: 0, y: 0, hp: 50, maxHp: 100 }), -1);
});

test('health-bar: capacity full returns -1 for new entities', () => {
  const bars = HealthBar.create({ capacity: 2 });
  bars.upsert({ entityId: 'a', x: 0, y: 0, hp: 50, maxHp: 100 });
  bars.upsert({ entityId: 'b', x: 0, y: 0, hp: 50, maxHp: 100 });
  assert.equal(bars.upsert({ entityId: 'c', x: 0, y: 0, hp: 50, maxHp: 100 }), -1);
  // Existing entity update still works.
  assert.equal(bars.upsert({ entityId: 'a', x: 1, y: 1, hp: 49, maxHp: 100 }), 0);
});

test('health-bar: setPosition updates without resetting fade', () => {
  const bars = HealthBar.create();
  bars.upsert({ entityId: 'm1', x: 0, y: 0, hp: 50, maxHp: 100 });
  bars.tick(2000); // some elapsed time
  let state: HealthBarRenderState | null = null;
  bars.forEach((s) => { state = s; });
  const pre = state!.msSinceLastDelta;
  bars.setPosition('m1', 50, 60);
  bars.forEach((s) => { state = s; });
  // Position updated.
  assert.equal(state!.x, 50);
  assert.equal(state!.y, 60);
  // Fade timer NOT reset (msSinceLastDelta > pre - dt).
  assert.ok(state!.msSinceLastDelta >= pre);
});

test('health-bar: setPosition on unknown entity returns false', () => {
  const bars = HealthBar.create();
  assert.equal(bars.setPosition('ghost', 0, 0), false);
});

test('health-bar: applyDelta lowers hp + resets fade + bumps pulse', () => {
  const bars = HealthBar.create({ pulseMs: 500 });
  bars.upsert({ entityId: 'm1', x: 0, y: 0, hp: 50, maxHp: 100 });
  bars.tick(1000); // fade timer running
  bars.applyDelta('m1', -10);
  let state: HealthBarRenderState | null = null;
  bars.forEach((s) => { state = s; });
  assert.equal(state!.hp, 40);
  assert.equal(state!.msSinceLastDelta, 0);
  assert.equal(state!.pulse, 1);
});

test('health-bar: applyDelta heals (positive) + resets fade + bumps pulse', () => {
  const bars = HealthBar.create();
  bars.upsert({ entityId: 'm1', x: 0, y: 0, hp: 30, maxHp: 100 });
  bars.applyDelta('m1', 25);
  let state: HealthBarRenderState | null = null;
  bars.forEach((s) => { state = s; });
  assert.equal(state!.hp, 55);
  assert.equal(state!.pulse, 1);
});

test('health-bar: hp clamped to [0, maxHp]', () => {
  const bars = HealthBar.create();
  bars.upsert({ entityId: 'm1', x: 0, y: 0, hp: 50, maxHp: 100 });
  bars.applyDelta('m1', -100);
  let state: HealthBarRenderState | null = null;
  bars.forEach((s) => { state = s; });
  assert.equal(state!.hp, 0);
  bars.applyDelta('m1', 999);
  bars.forEach((s) => { state = s; });
  assert.equal(state!.hp, 100);
});

test('health-bar: applyDelta on unknown entity returns false', () => {
  const bars = HealthBar.create();
  assert.equal(bars.applyDelta('ghost', -10), false);
});

test('health-bar: tick decays pulse over pulseMs', () => {
  const bars = HealthBar.create({ pulseMs: 200 });
  bars.upsert({ entityId: 'm1', x: 0, y: 0, hp: 50, maxHp: 100 });
  bars.applyDelta('m1', -10);
  let state: HealthBarRenderState | null = null;
  bars.forEach((s) => { state = s; });
  assert.equal(state!.pulse, 1);
  bars.tick(100);
  bars.forEach((s) => { state = s; });
  assert.ok(Math.abs(state!.pulse - 0.5) < 1e-6);
  bars.tick(100);
  bars.forEach((s) => { state = s; });
  assert.equal(state!.pulse, 0);
});

test('health-bar: alpha stays at 1 until fadeAfterMs elapses', () => {
  const bars = HealthBar.create({ fadeAfterMs: 1000, fadeDurationMs: 500 });
  bars.upsert({ entityId: 'm1', x: 0, y: 0, hp: 50, maxHp: 100 });
  bars.tick(900);
  let state: HealthBarRenderState | null = null;
  bars.forEach((s) => { state = s; });
  assert.equal(state!.alpha, 1);
  bars.tick(150); // total 1050 - 50ms into fade
  bars.forEach((s) => { state = s; });
  assert.ok(Math.abs(state!.alpha - 0.9) < 1e-6);
});

test('health-bar: tick removes entry after removeAfterMs', () => {
  const bars = HealthBar.create({
    fadeAfterMs: 100,
    fadeDurationMs: 100,
    removeAfterMs: 200,
  });
  bars.upsert({ entityId: 'm1', x: 0, y: 0, hp: 50, maxHp: 100 });
  bars.tick(150);
  assert.ok(bars.has('m1'));
  bars.tick(60); // total 210 > removeAfterMs 200
  assert.equal(bars.has('m1'), false);
});

test('health-bar: forEach yields render state with computed pct', () => {
  const bars = HealthBar.create();
  bars.upsert({ entityId: 'm1', x: 5, y: 10, hp: 30, maxHp: 60 });
  let state: HealthBarRenderState | null = null;
  bars.forEach((s) => { state = s; });
  assert.equal(state!.pct, 0.5);
  assert.equal(state!.x, 5);
  assert.equal(state!.y, 10);
});

test('health-bar: forEach with throwing cb is isolated', () => {
  const bars = HealthBar.create();
  bars.upsert({ entityId: 'm1', x: 0, y: 0, hp: 50, maxHp: 100 });
  bars.upsert({ entityId: 'm2', x: 0, y: 0, hp: 50, maxHp: 100 });
  let count = 0;
  // Should not throw.
  bars.forEach(() => { count++; throw new Error('boom'); });
  assert.equal(count, 2); // both visited despite throws
});

test('health-bar: remove drops manually', () => {
  const bars = HealthBar.create();
  bars.upsert({ entityId: 'm1', x: 0, y: 0, hp: 50, maxHp: 100 });
  assert.ok(bars.remove('m1'));
  assert.equal(bars.has('m1'), false);
  assert.equal(bars.remove('m1'), false);
});

test('health-bar: clearAll empties everything', () => {
  const bars = HealthBar.create();
  for (let i = 0; i < 5; i++) {
    bars.upsert({ entityId: 'm' + i, x: 0, y: 0, hp: 50, maxHp: 100 });
  }
  bars.clearAll();
  assert.equal(bars.activeCount(), 0);
});

test('health-bar: NaN / negative dt no-op', () => {
  const bars = HealthBar.create();
  bars.upsert({ entityId: 'm1', x: 0, y: 0, hp: 50, maxHp: 100 });
  bars.tick(NaN);
  bars.tick(-100);
  let state: HealthBarRenderState | null = null;
  bars.forEach((s) => { state = s; });
  assert.equal(state!.msSinceLastDelta, 0);
});

test('health-bar: maxHp 0 yields pct 0 (degenerate)', () => {
  const bars = HealthBar.create();
  bars.upsert({ entityId: 'm1', x: 0, y: 0, hp: 0, maxHp: 0 });
  let state: HealthBarRenderState | null = null;
  bars.forEach((s) => { state = s; });
  assert.equal(state!.pct, 0);
});

test('health-bar: dispose locks ops', () => {
  const bars = HealthBar.create();
  bars.upsert({ entityId: 'm1', x: 0, y: 0, hp: 50, maxHp: 100 });
  bars.dispose();
  assert.equal(bars.upsert({ entityId: 'm2', x: 0, y: 0, hp: 50, maxHp: 100 }), -1);
  assert.equal(bars.applyDelta('m1', -10), false);
  bars.tick(1000);
  let visited = 0;
  bars.forEach(() => { visited++; });
  assert.equal(visited, 0);
});

test('health-bar: realistic boss bar with damage + fade', () => {
  const states: HealthBarRenderState[] = [];
  const bars = HealthBar.create({ fadeAfterMs: 1000, fadeDurationMs: 500 });
  bars.upsert({ entityId: 'boss', x: 200, y: 50, hp: 500, maxHp: 500 });
  // Hit twice quickly.
  bars.tick(50);
  bars.applyDelta('boss', -30);
  bars.tick(50);
  bars.applyDelta('boss', -45);
  // Read state.
  bars.forEach((s) => states.push({ ...s }));
  assert.equal(states[0]!.hp, 425);
  assert.equal(states[0]!.pct, 0.85);
  // Fade hasn't started yet.
  assert.equal(states[0]!.alpha, 1);
});

test('health-bar: multiple entities tracked independently', () => {
  const bars = HealthBar.create();
  bars.upsert({ entityId: 'a', x: 0, y: 0, hp: 50, maxHp: 100 });
  bars.upsert({ entityId: 'b', x: 0, y: 0, hp: 25, maxHp: 100 });
  bars.applyDelta('a', -10);
  const states: Record<string, HealthBarRenderState> = {};
  bars.forEach((s) => { states[s.entityId] = s; });
  assert.equal(states['a']!.hp, 40);
  assert.equal(states['b']!.hp, 25);
  // Pulse only on a.
  assert.equal(states['a']!.pulse, 1);
  assert.equal(states['b']!.pulse, 0);
});

test('health-bar: applyDelta with 0 is no-op', () => {
  const bars = HealthBar.create();
  bars.upsert({ entityId: 'm1', x: 0, y: 0, hp: 50, maxHp: 100 });
  bars.tick(500);
  let preState: HealthBarRenderState | null = null;
  bars.forEach((s) => { preState = s; });
  bars.applyDelta('m1', 0);
  let postState: HealthBarRenderState | null = null;
  bars.forEach((s) => { postState = s; });
  // hp unchanged, fade NOT reset (delta = 0 returns false).
  assert.equal(postState!.hp, 50);
  assert.equal(postState!.msSinceLastDelta, preState!.msSinceLastDelta);
});
