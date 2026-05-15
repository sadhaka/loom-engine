// NeuralAnimationSystem - Trinity §23 motion-matching + inertialization tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  NeuralAnimationSystem,
  ANIM_FP_ONE,
  BONE_SLOT_STRIDE,
  FOOT_LEFT,
  ANIM_ENTITY_INVALID,
} from '../src/runtime/neural-animation.js';

function defaultConfig() {
  return {
    maxEntities: 8,
    numClips: 4,
    framesPerClip: 16,
    featureStride: 6,
    boneCount: 4,
    halfLifeFp: ANIM_FP_ONE,
  };
}

test('NeuralAnimation: constructor rejects invalid config (gate 1, 6)', () => {
  assert.throws(() => new NeuralAnimationSystem({ ...defaultConfig(), maxEntities: 0 }), RangeError);
  assert.throws(() => new NeuralAnimationSystem({ ...defaultConfig(), numClips: 0 }), RangeError);
  assert.throws(() => new NeuralAnimationSystem({ ...defaultConfig(), framesPerClip: 0 }), RangeError);
  assert.throws(() => new NeuralAnimationSystem({ ...defaultConfig(), featureStride: 0 }), RangeError);
  assert.throws(() => new NeuralAnimationSystem({ ...defaultConfig(), boneCount: 0 }), RangeError);
  assert.throws(() => new NeuralAnimationSystem({ ...defaultConfig(), halfLifeFp: 0 }), RangeError);
});

test('NeuralAnimation: feature DB length matches expected (gate 1)', () => {
  const a = new NeuralAnimationSystem(defaultConfig());
  assert.equal(a.featureDBLength, 4 * 16 * 6);
  assert.equal(a.poseDBLength, 4 * 16 * 4 * BONE_SLOT_STRIDE);
});

test('NeuralAnimation: loadFeatureFrame validates clip / frame / source size (gates 1, 6)', () => {
  const a = new NeuralAnimationSystem(defaultConfig());
  const data = new Int32Array(6).fill(100);
  assert.equal(a.loadFeatureFrame(0, 0, data), true);
  assert.equal(a.loadFeatureFrame(99, 0, data), false);
  assert.equal(a.loadFeatureFrame(0, 99, data), false);
  const small = new Int32Array(3);
  assert.equal(a.loadFeatureFrame(0, 0, small), false);
});

test('NeuralAnimation: loadPoseFrame round-trips into the visible pose', () => {
  const a = new NeuralAnimationSystem(defaultConfig());
  const pose = new Int32Array(4 * BONE_SLOT_STRIDE);
  for (let i = 0; i < pose.length; i++) pose[i] = (i + 1) * 100;
  a.loadPoseFrame(0, 0, pose);
  const e = a.addEntity(0, 0);
  const out = new Int32Array(BONE_SLOT_STRIDE);
  a.readVisiblePose(e, 2, out);
  // Bone 2's translation x is at slot 2 * BONE_SLOT_STRIDE + 0 = 14, value (14+1)*100 = 1500.
  assert.equal(out[0], 1500);
});

test('NeuralAnimation: addEntity refuses past capacity', () => {
  const a = new NeuralAnimationSystem({ ...defaultConfig(), maxEntities: 2 });
  assert.notEqual(a.addEntity(0, 0), ANIM_ENTITY_INVALID);
  assert.notEqual(a.addEntity(0, 0), ANIM_ENTITY_INVALID);
  assert.equal(a.addEntity(0, 0), ANIM_ENTITY_INVALID);
});

test('NeuralAnimation: updateEntityIntent validates input (gate 2)', () => {
  const a = new NeuralAnimationSystem(defaultConfig());
  const e = a.addEntity(0, 0);
  assert.equal(a.updateEntityIntent(e, 100, 0, 0, ANIM_FP_ONE, 0, 0), true);
  assert.equal(a.updateEntityIntent(99, 0, 0, 0, 0, 0, 0), false);
  assert.equal(a.updateEntityIntent(e, 1.5, 0, 0, 0, 0, 0), false);
});

test('NeuralAnimation: updateEntityFootFlags validates input (gate 2, 4)', () => {
  const a = new NeuralAnimationSystem(defaultConfig());
  const e = a.addEntity(0, 0);
  assert.equal(a.updateEntityFootFlags(e, FOOT_LEFT), true);
  assert.equal(a.updateEntityFootFlags(e, -1), false);
  assert.equal(a.updateEntityFootFlags(e, 256), false);
});

test('NeuralAnimation: searchBestMatch returns the closest feature key (gates 1, 5)', () => {
  const a = new NeuralAnimationSystem(defaultConfig());
  // Load distinct intent vectors at three frames.
  const f1 = new Int32Array([ANIM_FP_ONE, 0, 0, 0, 0, 0]);
  const f2 = new Int32Array([2 * ANIM_FP_ONE, 0, 0, 0, 0, 0]);
  const f3 = new Int32Array([5 * ANIM_FP_ONE, 0, 0, 0, 0, 0]);
  a.loadFeatureFrame(0, 0, f1);
  a.loadFeatureFrame(0, 1, f2);
  a.loadFeatureFrame(0, 2, f3);
  const e = a.addEntity(0, 0);
  // Intent vx near 2 * FP_ONE - best match is frame 1 (key = 1).
  a.updateEntityIntent(e, 2 * ANIM_FP_ONE, 0, 0, 0, 0, 0);
  assert.equal(a.searchBestMatch(e), 1);
  a.updateEntityIntent(e, 5 * ANIM_FP_ONE, 0, 0, 0, 0, 0);
  assert.equal(a.searchBestMatch(e), 2);
});

test('NeuralAnimation: transitionToFrame extracts pose delta and injects into inertOffset (gate 3)', () => {
  const a = new NeuralAnimationSystem(defaultConfig());
  // Pose at clip 0 frame 0: bone 0 tx = 1000.
  const p0 = new Int32Array(4 * BONE_SLOT_STRIDE);
  p0[0] = 1000;
  a.loadPoseFrame(0, 0, p0);
  // Pose at clip 0 frame 1: bone 0 tx = 200.
  const p1 = new Int32Array(4 * BONE_SLOT_STRIDE);
  p1[0] = 200;
  a.loadPoseFrame(0, 1, p1);
  const e = a.addEntity(0, 0);
  // Now transition to frame 1 - delta = oldPose - newPose = 1000 - 200 = 800 injected.
  a.setEntityClip(e, 0, 1);
  const out = new Int32Array(BONE_SLOT_STRIDE);
  a.readInertOffset(e, 0, out);
  assert.equal(out[0], 800);
  // The visible pose = newPose + offset = 200 + 800 = 1000 (the old pose - that's the smoothing intent).
  a.readVisiblePose(e, 0, out);
  assert.equal(out[0], 1000);
});

test('NeuralAnimation: step decays the inertOffset toward zero (gate 4)', () => {
  const a = new NeuralAnimationSystem(defaultConfig());
  const p0 = new Int32Array(4 * BONE_SLOT_STRIDE); p0[0] = 1000;
  const p1 = new Int32Array(4 * BONE_SLOT_STRIDE); p1[0] = 0;
  a.loadPoseFrame(0, 0, p0);
  a.loadPoseFrame(0, 1, p1);
  const e = a.addEntity(0, 0);
  a.setEntityClip(e, 0, 1);
  const out = new Int32Array(BONE_SLOT_STRIDE);
  a.readInertOffset(e, 0, out);
  const initial = out[0] ?? 0;
  // Step a few times - offset should shrink.
  for (let i = 0; i < 5; i++) a.step(ANIM_FP_ONE);
  a.readInertOffset(e, 0, out);
  assert.ok((out[0] ?? 0) < initial, 'inertOffset should decay toward 0');
});

test('NeuralAnimation: foot locking zeroes the bone offset (gate 4)', () => {
  const a = new NeuralAnimationSystem(defaultConfig());
  const p0 = new Int32Array(4 * BONE_SLOT_STRIDE); p0[0] = 5000;     // bone 0 (left foot) tx
  const p1 = new Int32Array(4 * BONE_SLOT_STRIDE); p1[0] = 0;
  a.loadPoseFrame(0, 0, p0);
  a.loadPoseFrame(0, 1, p1);
  const e = a.addEntity(0, 0);
  a.setEntityClip(e, 0, 1);                                          // injects 5000 into bone 0 inertOffset
  a.updateEntityFootFlags(e, FOOT_LEFT);                              // lock left foot
  a.step(ANIM_FP_ONE);
  const out = new Int32Array(BONE_SLOT_STRIDE);
  a.readInertOffset(e, 0, out);
  assert.equal(out[0], 0);                                            // foot-lock zeroes the slot
});

test('NeuralAnimation: deterministic across two independent runs', () => {
  function run(): number[] {
    const a = new NeuralAnimationSystem(defaultConfig());
    for (let c = 0; c < 4; c++) for (let f = 0; f < 16; f++) {
      const data = new Int32Array(6);
      for (let k = 0; k < 6; k++) data[k] = ((c * 16 + f) * 6 + k) * 100;
      a.loadFeatureFrame(c, f, data);
    }
    const e = a.addEntity(0, 0);
    a.updateEntityIntent(e, 1234 * ANIM_FP_ONE, 0, 0, 0, 0, 0);
    return [a.searchBestMatch(e)];
  }
  assert.deepEqual(run(), run());
});

test('NeuralAnimation: clear() resets every pool', () => {
  const a = new NeuralAnimationSystem(defaultConfig());
  const data = new Int32Array(6);
  a.loadFeatureFrame(0, 0, data);
  a.addEntity(0, 0);
  a.clear();
  assert.equal(a.getEntityCount(), 0);
});

test('NeuralAnimation: readVisiblePose validates input', () => {
  const a = new NeuralAnimationSystem(defaultConfig());
  const out = new Int32Array(BONE_SLOT_STRIDE);
  assert.equal(a.readVisiblePose(99, 0, out), false);
  const e = a.addEntity(0, 0);
  assert.equal(a.readVisiblePose(e, 99, out), false);
  const small = new Int32Array(3);
  assert.equal(a.readVisiblePose(e, 0, small), false);
});

test('NeuralAnimation: getFeatureDB / getInertOffsetArray expose SoA arrays for WGSL offload (gate 5)', () => {
  const a = new NeuralAnimationSystem(defaultConfig());
  assert.ok(a.getFeatureDB() instanceof Int32Array);
  assert.equal(a.getFeatureDB().length, a.featureDBLength);
  assert.ok(a.getInertOffsetArray() instanceof Int32Array);
});

test('NeuralAnimation: setEntityClip rejects invalid clip / frame', () => {
  const a = new NeuralAnimationSystem(defaultConfig());
  const e = a.addEntity(0, 0);
  assert.equal(a.setEntityClip(e, 99, 0), false);
  assert.equal(a.setEntityClip(e, 0, 99), false);
  assert.equal(a.setEntityClip(99, 0, 0), false);
});
