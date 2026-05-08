// Phase 0.41.0 - LayerManager tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  LayerManager,
  RESOURCE_LAYER_MANAGER,
  RENDER_LAYER_BACKGROUND,
  RENDER_LAYER_TERRAIN,
  RENDER_LAYER_ENTITIES,
  RENDER_LAYER_FX,
  RENDER_LAYER_HUD,
} from '../src/index.js';

test('layer-manager: RESOURCE_LAYER_MANAGER is the stable string', () => {
  assert.equal(RESOURCE_LAYER_MANAGER, 'layer_manager');
});

test('layer-manager: starts empty', () => {
  const lm = LayerManager.create();
  assert.equal(lm.count(), 0);
  assert.deepEqual(lm.toArray(), []);
});

test('layer-manager: add tracks entity layer + z', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_ENTITIES, 5);
  assert.equal(lm.has(1), true);
  assert.equal(lm.getLayer(1), RENDER_LAYER_ENTITIES);
  assert.equal(lm.getZ(1), 5);
  assert.equal(lm.count(), 1);
});

test('layer-manager: add with default z=0', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_ENTITIES);
  assert.equal(lm.getZ(1), 0);
});

test('layer-manager: re-adding an entity updates its layer/z idempotently', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_ENTITIES, 5);
  lm.add(1, RENDER_LAYER_FX, 10);
  assert.equal(lm.count(), 1);
  assert.equal(lm.getLayer(1), RENDER_LAYER_FX);
  assert.equal(lm.getZ(1), 10);
});

test('layer-manager: remove drops the entity', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_ENTITIES, 5);
  assert.equal(lm.remove(1), true);
  assert.equal(lm.has(1), false);
  assert.equal(lm.count(), 0);
});

test('layer-manager: remove on missing entity returns false', () => {
  const lm = LayerManager.create();
  assert.equal(lm.remove(99), false);
});

test('layer-manager: getLayer / getZ return null for unknown entity', () => {
  const lm = LayerManager.create();
  assert.equal(lm.getLayer(99), null);
  assert.equal(lm.getZ(99), null);
});

test('layer-manager: setZ updates z without changing layer', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_ENTITIES, 5);
  lm.setZ(1, 12);
  assert.equal(lm.getLayer(1), RENDER_LAYER_ENTITIES);
  assert.equal(lm.getZ(1), 12);
});

test('layer-manager: setLayer updates layer without changing z', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_ENTITIES, 5);
  lm.setLayer(1, RENDER_LAYER_HUD);
  assert.equal(lm.getLayer(1), RENDER_LAYER_HUD);
  assert.equal(lm.getZ(1), 5);
});

test('layer-manager: setZ / setLayer on unknown entity is a no-op', () => {
  const lm = LayerManager.create();
  lm.setZ(99, 10);
  lm.setLayer(99, RENDER_LAYER_HUD);
  assert.equal(lm.has(99), false);
});

test('layer-manager: forEach yields entries in (layer asc, z asc) order', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_HUD, 0);
  lm.add(2, RENDER_LAYER_ENTITIES, 10);
  lm.add(3, RENDER_LAYER_BACKGROUND, 5);
  lm.add(4, RENDER_LAYER_ENTITIES, 0);
  const order: number[] = [];
  lm.forEach((e) => order.push(e.entityId));
  // Expected:
  //   BACKGROUND/5  -> entity 3
  //   ENTITIES/0    -> entity 4
  //   ENTITIES/10   -> entity 2
  //   HUD/0         -> entity 1
  assert.deepEqual(order, [3, 4, 2, 1]);
});

test('layer-manager: forEach ties break by entityId for deterministic ordering', () => {
  const lm = LayerManager.create();
  // Same layer + same z; different ids.
  lm.add(7, RENDER_LAYER_ENTITIES, 0);
  lm.add(2, RENDER_LAYER_ENTITIES, 0);
  lm.add(5, RENDER_LAYER_ENTITIES, 0);
  const order: number[] = [];
  lm.forEach((e) => order.push(e.entityId));
  assert.deepEqual(order, [2, 5, 7]);
});

test('layer-manager: forEachOnLayer yields only entries on that layer', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_TERRAIN, 0);
  lm.add(2, RENDER_LAYER_ENTITIES, 0);
  lm.add(3, RENDER_LAYER_ENTITIES, 5);
  lm.add(4, RENDER_LAYER_ENTITIES, -2);
  lm.add(5, RENDER_LAYER_HUD, 100);
  const ids: number[] = [];
  lm.forEachOnLayer(RENDER_LAYER_ENTITIES, (e) => ids.push(e.entityId));
  // z-asc: -2 (entity 4), 0 (entity 2), 5 (entity 3).
  assert.deepEqual(ids, [4, 2, 3]);
});

test('layer-manager: forEachOnLayer on layer with no entities does nothing', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_ENTITIES, 0);
  let called = false;
  lm.forEachOnLayer(RENDER_LAYER_HUD, () => { called = true; });
  assert.equal(called, false);
});

test('layer-manager: countOnLayer reflects per-layer count', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_ENTITIES, 0);
  lm.add(2, RENDER_LAYER_ENTITIES, 1);
  lm.add(3, RENDER_LAYER_HUD, 0);
  assert.equal(lm.countOnLayer(RENDER_LAYER_ENTITIES), 2);
  assert.equal(lm.countOnLayer(RENDER_LAYER_HUD), 1);
  assert.equal(lm.countOnLayer(RENDER_LAYER_BACKGROUND), 0);
});

test('layer-manager: changing z reorders within layer', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_ENTITIES, 0);
  lm.add(2, RENDER_LAYER_ENTITIES, 10);
  // Bump 1 above 2.
  lm.setZ(1, 20);
  const ids: number[] = [];
  lm.forEachOnLayer(RENDER_LAYER_ENTITIES, (e) => ids.push(e.entityId));
  assert.deepEqual(ids, [2, 1]);
});

test('layer-manager: changing layer moves entity between layers', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_ENTITIES, 0);
  lm.setLayer(1, RENDER_LAYER_HUD);
  assert.equal(lm.countOnLayer(RENDER_LAYER_ENTITIES), 0);
  assert.equal(lm.countOnLayer(RENDER_LAYER_HUD), 1);
});

test('layer-manager: forEach uses cached sort on repeated calls without mutation', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_ENTITIES, 5);
  lm.add(2, RENDER_LAYER_ENTITIES, 1);
  lm.add(3, RENDER_LAYER_ENTITIES, 9);
  // Two consecutive forEach calls produce the same ordering.
  const a: number[] = [];
  const b: number[] = [];
  lm.forEach((e) => a.push(e.entityId));
  lm.forEach((e) => b.push(e.entityId));
  assert.deepEqual(a, b);
});

test('layer-manager: clear empties the registry', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_ENTITIES, 0);
  lm.add(2, RENDER_LAYER_ENTITIES, 5);
  lm.clear();
  assert.equal(lm.count(), 0);
  assert.equal(lm.has(1), false);
});

test('layer-manager: dispose makes mutations no-ops', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_ENTITIES, 0);
  lm.dispose();
  // count goes to 0 because dispose clears.
  assert.equal(lm.count(), 0);
  lm.add(2, RENDER_LAYER_ENTITIES, 0); // no-op after dispose
  assert.equal(lm.count(), 0);
  let called = false;
  lm.forEach(() => { called = true; });
  assert.equal(called, false);
});

test('layer-manager: forEach swallows callback errors per entry', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_ENTITIES, 0);
  lm.add(2, RENDER_LAYER_ENTITIES, 1);
  lm.add(3, RENDER_LAYER_ENTITIES, 2);
  const seen: number[] = [];
  lm.forEach((e) => {
    seen.push(e.entityId);
    if (e.entityId === 2) throw new Error('boom');
  });
  // Iteration continued past the throw.
  assert.deepEqual(seen, [1, 2, 3]);
});

test('layer-manager: toArray returns a snapshot that does not mutate the manager', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_ENTITIES, 0);
  const snap = lm.toArray();
  snap[0]!.z = 999;
  assert.equal(lm.getZ(1), 0);
});

test('layer-manager: negative z values sort below positive', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_ENTITIES, 5);
  lm.add(2, RENDER_LAYER_ENTITIES, -3);
  lm.add(3, RENDER_LAYER_ENTITIES, 0);
  const ids: number[] = [];
  lm.forEachOnLayer(RENDER_LAYER_ENTITIES, (e) => ids.push(e.entityId));
  assert.deepEqual(ids, [2, 3, 1]);
});

test('layer-manager: removing an entity invalidates the sort cache', () => {
  const lm = LayerManager.create();
  lm.add(1, RENDER_LAYER_ENTITIES, 0);
  lm.add(2, RENDER_LAYER_ENTITIES, 1);
  // Build the cache.
  lm.forEach(() => {});
  // Remove and re-iterate.
  lm.remove(1);
  const ids: number[] = [];
  lm.forEach((e) => ids.push(e.entityId));
  assert.deepEqual(ids, [2]);
});
