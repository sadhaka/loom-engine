// Loom Engine - Phase 17 Track A: AudioListenerResource tests.
//
// Factory shape, default forward/up vectors, lastUpdateFrame initial
// value, and pose mutation via the setter API. The system that writes
// pose updates is tested separately (spatial-audio-system.test.ts).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  createAudioListenerResource,
  RESOURCE_AUDIO_LISTENER,
  DEFAULT_LISTENER_FORWARD,
  DEFAULT_LISTENER_UP,
  type AudioListenerResource,
} from '../src/index.js';

test('audio-listener-resource: factory returns the documented shape', () => {
  var res: AudioListenerResource = createAudioListenerResource();
  assert.ok(res.pose, 'pose object exists');
  assert.equal(res.pose.x, 0);
  assert.equal(res.pose.y, 0);
  assert.equal(res.pose.z, 0);
  assert.ok(res.pose.forward, 'forward vector populated');
  assert.ok(res.pose.up, 'up vector populated');
  assert.equal(typeof res.lastUpdateFrame, 'number');
});

test('audio-listener-resource: lastUpdateFrame starts at 0 (never updated)', () => {
  var res = createAudioListenerResource();
  assert.equal(res.lastUpdateFrame, 0);
});

test('audio-listener-resource: default forward = (0, 0, -1) per spec §8.4', () => {
  var res = createAudioListenerResource();
  assert.equal(res.pose.forward!.x, 0);
  assert.equal(res.pose.forward!.y, 0);
  assert.equal(res.pose.forward!.z, -1);
  // Constants match the resource defaults.
  assert.equal(DEFAULT_LISTENER_FORWARD.x, 0);
  assert.equal(DEFAULT_LISTENER_FORWARD.y, 0);
  assert.equal(DEFAULT_LISTENER_FORWARD.z, -1);
});

test('audio-listener-resource: default up = (0, 1, 0) per spec §8.4', () => {
  var res = createAudioListenerResource();
  assert.equal(res.pose.up!.x, 0);
  assert.equal(res.pose.up!.y, 1);
  assert.equal(res.pose.up!.z, 0);
  assert.equal(DEFAULT_LISTENER_UP.x, 0);
  assert.equal(DEFAULT_LISTENER_UP.y, 1);
  assert.equal(DEFAULT_LISTENER_UP.z, 0);
});

test('audio-listener-resource: pose mutation via direct field write is supported', () => {
  var res = createAudioListenerResource();
  res.pose.x = 42;
  res.pose.y = -3;
  res.pose.z = 1;
  assert.equal(res.pose.x, 42);
  assert.equal(res.pose.y, -3);
  assert.equal(res.pose.z, 1);
});

test('audio-listener-resource: each factory call returns a fresh instance', () => {
  var a = createAudioListenerResource();
  var b = createAudioListenerResource();
  a.pose.x = 99;
  // Mutating one must NOT affect the other (no shared object refs).
  assert.equal(b.pose.x, 0);
  assert.notEqual(a.pose, b.pose);
  assert.notEqual(a.pose.forward, b.pose.forward);
  assert.notEqual(a.pose.up, b.pose.up);
});

test('audio-listener-resource: RESOURCE_AUDIO_LISTENER key is the documented string', () => {
  assert.equal(RESOURCE_AUDIO_LISTENER, 'audio_listener');
});
