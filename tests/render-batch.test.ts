// Phase 0.23.0 - RenderBatch tests.
//
// Coverage: submit groups by (layer, atlas reference equality);
// non-adjacent same-atlas submissions land in separate groups
// (painter order preserved); flushTo iterates layer-ascending then
// submission order and clears after; tint pass-through; stats.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  RenderBatch,
  RENDER_LAYER_TERRAIN,
  RENDER_LAYER_ENTITIES,
  RENDER_LAYER_HUD,
} from '../src/renderer/render-batch.js';

interface CbCall {
  layer: number;
  atlas: unknown;
  count: number;
  firstFrame: number;
  lastFrame: number;
}

function flushAll(batch: RenderBatch): CbCall[] {
  var calls: CbCall[] = [];
  batch.flushTo({}, function (layer, atlas, entries) {
    calls.push({
      layer: layer,
      atlas: atlas,
      count: entries.length,
      firstFrame: entries[0]?.frame ?? -1,
      lastFrame: entries[entries.length - 1]?.frame ?? -1,
    });
  });
  return calls;
}


test('render-batch: empty flush is a no-op', function () {
  var batch = new RenderBatch();
  var calls = flushAll(batch);
  assert.equal(calls.length, 0);
  assert.equal(batch.stats().flushes, 1);
});

test('render-batch: consecutive same-atlas submits merge into one group', function () {
  var batch = new RenderBatch();
  var atlas = { name: 'sprites' };
  batch.submit(RENDER_LAYER_ENTITIES, atlas, 0, 0, 0, 0);
  batch.submit(RENDER_LAYER_ENTITIES, atlas, 1, 1, 1, 1);
  batch.submit(RENDER_LAYER_ENTITIES, atlas, 2, 2, 2, 2);
  var calls = flushAll(batch);
  assert.equal(calls.length, 1);
  var first = calls[0]!;
  assert.equal(first.count, 3);
  assert.equal(first.atlas, atlas);
});

test('render-batch: non-adjacent same-atlas submits land in separate groups (painter order)', function () {
  var batch = new RenderBatch();
  var atlasA = { name: 'a' };
  var atlasB = { name: 'b' };
  batch.submit(RENDER_LAYER_ENTITIES, atlasA, 0, 0, 0, 0);
  batch.submit(RENDER_LAYER_ENTITIES, atlasB, 1, 0, 0, 0);
  batch.submit(RENDER_LAYER_ENTITIES, atlasA, 2, 0, 0, 0);  // same atlas as #1, but B in between
  var calls = flushAll(batch);
  // A, B, A (order preserved; A's first + last submission don't merge).
  assert.equal(calls.length, 3);
  assert.equal(calls[0]!.atlas, atlasA);
  assert.equal(calls[0]!.firstFrame, 0);
  assert.equal(calls[1]!.atlas, atlasB);
  assert.equal(calls[2]!.atlas, atlasA);
  assert.equal(calls[2]!.firstFrame, 2);
});

test('render-batch: layers iterate ascending regardless of submit order', function () {
  var batch = new RenderBatch();
  var atlas = { name: 's' };
  batch.submit(RENDER_LAYER_HUD, atlas, 0, 0, 0, 0);
  batch.submit(RENDER_LAYER_TERRAIN, atlas, 1, 0, 0, 0);
  batch.submit(RENDER_LAYER_ENTITIES, atlas, 2, 0, 0, 0);
  var calls = flushAll(batch);
  // Expect terrain (0) -> entities (100) -> hud (1000).
  assert.deepEqual(calls.map(function (c) { return c.layer; }),
    [RENDER_LAYER_TERRAIN, RENDER_LAYER_ENTITIES, RENDER_LAYER_HUD]);
});

test('render-batch: tint pass-through round-trips', function () {
  var batch = new RenderBatch();
  var atlas = { name: 's' };
  batch.submit(RENDER_LAYER_ENTITIES, atlas, 0, 0, 0, 0,
    { r: 0.5, g: 0.6, b: 0.7, a: 0.8 });
  batch.submit(RENDER_LAYER_ENTITIES, atlas, 1, 0, 0, 0);  // no tint
  var seen: Array<{ hasTint: boolean; r: number }> = [];
  batch.flushTo({}, function (_layer, _atlas, entries) {
    for (var i = 0; i < entries.length; i++) {
      seen.push({ hasTint: entries[i]!.hasTint, r: entries[i]!.tintR });
    }
  });
  assert.equal(seen.length, 2);
  assert.equal(seen[0]!.hasTint, true);
  assert.ok(Math.abs(seen[0]!.r - 0.5) < 1e-6);
  assert.equal(seen[1]!.hasTint, false);
  assert.equal(seen[1]!.r, 1);  // default
});

test('render-batch: flush clears the queue', function () {
  var batch = new RenderBatch();
  var atlas = { name: 's' };
  batch.submit(RENDER_LAYER_ENTITIES, atlas, 0, 0, 0, 0);
  flushAll(batch);
  // Second flush should be empty.
  var second = flushAll(batch);
  assert.equal(second.length, 0);
  assert.equal(batch.stats().flushes, 2);
});

test('render-batch: clear() drops queue without flushing', function () {
  var batch = new RenderBatch();
  var atlas = { name: 's' };
  batch.submit(RENDER_LAYER_ENTITIES, atlas, 0, 0, 0, 0);
  batch.submit(RENDER_LAYER_ENTITIES, atlas, 1, 0, 0, 0);
  assert.equal(batch.stats().entriesQueued, 2);
  batch.clear();
  assert.equal(batch.stats().entriesQueued, 0);
  assert.equal(batch.stats().flushes, 0);
  // Subsequent flush is empty.
  var calls = flushAll(batch);
  assert.equal(calls.length, 0);
});

test('render-batch: stats track submits + groups + entries', function () {
  var batch = new RenderBatch();
  var atlasA = { name: 'a' };
  var atlasB = { name: 'b' };
  batch.submit(RENDER_LAYER_ENTITIES, atlasA, 0, 0, 0, 0);
  batch.submit(RENDER_LAYER_ENTITIES, atlasA, 1, 0, 0, 0);  // merges with prev
  batch.submit(RENDER_LAYER_ENTITIES, atlasB, 2, 0, 0, 0);  // new group
  batch.submit(RENDER_LAYER_HUD, atlasA, 3, 0, 0, 0);       // new layer
  var stats = batch.stats();
  assert.equal(stats.submits, 4);
  assert.equal(stats.layersQueued, 2);
  assert.equal(stats.groupsQueued, 3);
  assert.equal(stats.entriesQueued, 4);
});

test('render-batch: layers with same number coalesce into one bucket', function () {
  var batch = new RenderBatch();
  var atlas = { name: 's' };
  batch.submit(50, atlas, 0, 0, 0, 0);
  batch.submit(50, atlas, 1, 0, 0, 0);
  var stats = batch.stats();
  assert.equal(stats.layersQueued, 1);
});
