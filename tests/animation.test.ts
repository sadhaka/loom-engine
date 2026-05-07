// Loom Engine - Phase 3 animation system tests.
//
// Pure-logic tests for AnimationClip helpers + AnimationStatePool +
// AnimationSystem end-to-end via the same FakeDevice approach used
// in tests/world.test.ts.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  // Animation surface
  AnimationStatePool,
  AnimationSystem,
  ANIMATION_FLAG_ACTIVE,
  ANIMATION_FLAG_FINISHED,
  POOL_ANIMATION,
  synthesizeDefaultClip,
  clipDurationMs,
  frameInClipAt,
  manifestFrameIndex,
  type AnimationClip,
  type SpriteSheetManifest,
  // Re-used surface
  POOL_TRANSFORM,
  POOL_SPRITE,
  TransformPool,
  SpritePool,
  SYSTEM_PHASE_ANIMATION,
  approxEq,
  entityIndex,
} from '../src/index.js';

// ---------- AnimationClip helpers ----------

test('animation: synthesizeDefaultClip walks all frames + loops', () => {
  const clip = synthesizeDefaultClip(4);
  assert.equal(clip.name, 'default');
  assert.deepEqual([...clip.frames], [0, 1, 2, 3]);
  assert.equal(clip.loop, true);
});

test('animation: clipDurationMs honors per-frame durations over fps', () => {
  const clip: AnimationClip = {
    name: 'walk',
    frames: [0, 1, 2, 3],
    durations_ms: [100, 200, 100, 200],
    loop: true,
  };
  assert.equal(clipDurationMs(clip, 60), 600);   // ignored fps
});

test('animation: clipDurationMs falls back to clip.fps when no durations', () => {
  const clip: AnimationClip = {
    name: 'walk',
    frames: [0, 1, 2, 3],
    fps: 4,
    loop: true,
  };
  assert.equal(clipDurationMs(clip, 60), 1000);   // 4 frames at 4fps = 1s
});

test('animation: clipDurationMs uses manifest fps when clip has no fps', () => {
  const clip: AnimationClip = { name: 'walk', frames: [0, 1, 2, 3], loop: true };
  assert.equal(clipDurationMs(clip, 8), 500);   // 4 frames at 8fps = 500ms
});

test('animation: frameInClipAt loops uniform-fps clips', () => {
  const clip: AnimationClip = { name: 'w', frames: [0, 1, 2, 3], loop: true };
  // 4 frames at 8fps = 125ms each, total 500ms cycle
  assert.equal(frameInClipAt(clip, 0, 8), 0);
  assert.equal(frameInClipAt(clip, 124, 8), 0);
  assert.equal(frameInClipAt(clip, 125, 8), 1);
  assert.equal(frameInClipAt(clip, 510, 8), 0);   // wraps
});

test('animation: frameInClipAt holds last frame on non-loop past duration', () => {
  const clip: AnimationClip = { name: 'attack', frames: [10, 11, 12], loop: false, fps: 10 };
  // 3 frames at 10fps = 100ms each, total 300ms.
  assert.equal(frameInClipAt(clip, 50, 60), 0);    // manifest fps ignored when clip.fps set
  assert.equal(frameInClipAt(clip, 150, 60), 1);
  assert.equal(frameInClipAt(clip, 250, 60), 2);
  assert.equal(frameInClipAt(clip, 999, 60), 2);   // held
});

test('animation: frameInClipAt walks per-frame durations', () => {
  const clip: AnimationClip = {
    name: 'idle',
    frames: [0, 1],
    durations_ms: [100, 500],
    loop: true,
  };
  assert.equal(frameInClipAt(clip, 50, 8), 0);
  assert.equal(frameInClipAt(clip, 150, 8), 1);
  assert.equal(frameInClipAt(clip, 599, 8), 1);
  assert.equal(frameInClipAt(clip, 601, 8), 0);   // 600ms cycle wraps
});

test('animation: manifestFrameIndex resolves clip index to manifest index', () => {
  const clip: AnimationClip = { name: 'attack', frames: [10, 11, 12], loop: false };
  assert.equal(manifestFrameIndex(clip, 0), 10);
  assert.equal(manifestFrameIndex(clip, 1), 11);
  assert.equal(manifestFrameIndex(clip, 2), 12);
  // Out-of-range returns 0 (safety, not throw - render loop must
  // never throw)
  assert.equal(manifestFrameIndex(clip, 99), 0);
});

// ---------- AnimationStatePool ----------

function makeManifest(): SpriteSheetManifest {
  return {
    name: 'test',
    image: 't.png',
    frames: [
      { x: 0, y: 0, w: 16, h: 16 },
      { x: 16, y: 0, w: 16, h: 16 },
      { x: 32, y: 0, w: 16, h: 16 },
      { x: 48, y: 0, w: 16, h: 16 },
    ],
    anchor: { x: 8, y: 16 },
    fps: 8,
    clips: [
      { name: 'walk', frames: [0, 1, 2, 3], loop: true },
      { name: 'attack', frames: [0, 1], loop: false, fps: 10 },
    ],
  };
}

test('animation pool: play sets ACTIVE + clears FINISHED + resets time', () => {
  const pool = new AnimationStatePool();
  const e = 1;
  const m = makeManifest();
  pool.play(e, m, 'walk');
  assert.ok(pool.isActive(e));
  assert.ok(!pool.isFinished(e));
  assert.equal(pool.elapsedMs[entityIndex(e)], 0);
  assert.equal(pool.getClipName(e), 'walk');
  assert.equal(pool.getManifest(e), m);
});

test('animation pool: play with startMs offset', () => {
  const pool = new AnimationStatePool();
  pool.play(1, makeManifest(), 'walk', { startMs: 250 });
  assert.equal(pool.elapsedMs[entityIndex(1)], 250);
});

test('animation pool: stop clears ACTIVE + manifest + clipName', () => {
  const pool = new AnimationStatePool();
  pool.play(1, makeManifest(), 'walk');
  pool.stop(1);
  assert.ok(!pool.isActive(1));
  assert.equal(pool.getClipName(1), '');
  assert.equal(pool.getManifest(1), null);
});

// ---------- AnimationSystem end-to-end ----------
//
// Tests build a minimal World by hand (no Canvas2DDevice) since
// AnimationSystem only touches pools + the time resource.

test('animation system: writes frame index to SpritePool each tick', async () => {
  // Build a World by hand (no Canvas2DDevice; the AnimationSystem
  // doesn't touch the device or camera).
  const { World } = await import('../src/world.js');
  const { createTimeResource, RESOURCE_TIME } = await import('../src/resources.js');
  const w = new World();
  const transforms = new TransformPool();
  const sprites = new SpritePool();
  const animations = new AnimationStatePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_SPRITE, sprites);
  w.registerPool(POOL_ANIMATION, animations);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  const e = w.createEntity();
  transforms.attach(e, 0, 0, 0);
  sprites.attach(e, 0, 0);
  animations.play(e, makeManifest(), 'walk');

  w.addSystem(new AnimationSystem(), SYSTEM_PHASE_ANIMATION);

  // 4 frames at 8fps = 125ms per frame. After 0.13s, frame should be 1.
  w.update(0.13);   // dt = 130ms
  assert.equal(sprites.frame[entityIndex(e)], 1, 'after 130ms expect frame 1');

  // After another 0.13s (total 260ms), expect frame 2.
  w.update(0.13);
  assert.equal(sprites.frame[entityIndex(e)], 2, 'after 260ms expect frame 2');

  // After another 0.26s (total 520ms = past one cycle of 500ms), expect frame 0 (wrapped).
  w.update(0.26);
  assert.equal(sprites.frame[entityIndex(e)], 0, 'after wrap expect frame 0');
});

test('animation system: non-looping clip sets FINISHED past total duration', async () => {
  const { World } = await import('../src/world.js');
  const { createTimeResource, RESOURCE_TIME } = await import('../src/resources.js');
  const w = new World();
  const transforms = new TransformPool();
  const sprites = new SpritePool();
  const animations = new AnimationStatePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_SPRITE, sprites);
  w.registerPool(POOL_ANIMATION, animations);
  w.resources.set(RESOURCE_TIME, createTimeResource());

  const e = w.createEntity();
  transforms.attach(e, 0, 0, 0);
  sprites.attach(e, 0, 0);
  animations.play(e, makeManifest(), 'attack');   // 2 frames at 10fps = 200ms
  w.addSystem(new AnimationSystem(), SYSTEM_PHASE_ANIMATION);

  w.update(0.05);
  assert.ok(!animations.isFinished(e), 'before duration not finished');
  w.update(0.5);   // well past 200ms
  assert.ok(animations.isFinished(e), 'past duration finished');
  // Should be holding on the last frame.
  assert.equal(sprites.frame[entityIndex(e)], 1);
});

test('animation system: ignores entities without active state', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const transforms = new TransformPool();
  const sprites = new SpritePool();
  const animations = new AnimationStatePool();
  w.registerPool(POOL_TRANSFORM, transforms);
  w.registerPool(POOL_SPRITE, sprites);
  w.registerPool(POOL_ANIMATION, animations);

  // Entity with sprite but no animation.
  const e = w.createEntity();
  transforms.attach(e, 0, 0, 0);
  sprites.attach(e, 0, 7);   // explicitly frame 7
  // No animations.play - no-op for this entity.
  w.addSystem(new AnimationSystem(), SYSTEM_PHASE_ANIMATION);

  w.update(1);
  assert.equal(sprites.frame[entityIndex(e)], 7, 'frame untouched without active animation');
});

test('animation pool: getClipName + getManifest + isActive bounds-check', () => {
  const pool = new AnimationStatePool();
  // Out-of-range entity index: all accessors return safe defaults.
  const ghost = 99999;
  assert.equal(pool.isActive(ghost), false);
  assert.equal(pool.isFinished(ghost), false);
  assert.equal(pool.getClipName(ghost), '');
  assert.equal(pool.getManifest(ghost), null);
});

test('animation: approxEq sanity (precision used in test math)', () => {
  // The animation test math sometimes hits Float32 precision via
  // pool.elapsedMs. Sanity-check approxEq is actually exported.
  assert.ok(approxEq(0.1 + 0.2, 0.3));
});
