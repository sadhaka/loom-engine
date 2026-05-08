// Loom Engine - Phase 17 Track A: SpatialAudioSystem tests.
//
// Verifies the system runs in PHASE_RENDER, pushes the local
// character's transform into the AudioListenerResource each tick,
// no-ops when no character is bound or when the transform is
// missing, and stamps lastUpdateFrame from the TimeResource.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  World,
  POOL_TRANSFORM,
  TransformPool,
  SpatialAudioSystem,
  SpatialAudioBus,
  AudioBus,
  RESOURCE_AUDIO_LISTENER,
  RESOURCE_TIME,
  createAudioListenerResource,
  createTimeResource,
  SYSTEM_PHASE_RENDER,
  type AudioListenerResource,
  type TimeResource,
} from '../src/index.js';

// ---------- Minimal mock AudioContext (only what AudioBus / SpatialAudioBus touch) ----------

interface FakeParam { value: number; setValueAtTime(v: number, _t: number): void; linearRampToValueAtTime(v: number, _t: number): void; }
function makeParam(v: number): FakeParam {
  return { value: v, setValueAtTime(x) { this.value = x; }, linearRampToValueAtTime(x) { this.value = x; } };
}
interface FakeNode { connections: FakeNode[]; connect(t: FakeNode): FakeNode; disconnect(): void; }
function makeNode(): FakeNode {
  return {
    connections: [],
    connect(t) { this.connections.push(t); return t; },
    disconnect() { this.connections.length = 0; },
  };
}
class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  destination = makeNode();
  currentTime = 0;
  listener = {
    positionX: makeParam(0), positionY: makeParam(0), positionZ: makeParam(0),
    forwardX: makeParam(0), forwardY: makeParam(0), forwardZ: makeParam(-1),
    upX: makeParam(0), upY: makeParam(1), upZ: makeParam(0),
  };
  createGain() { var n = makeNode() as FakeNode & { gain: FakeParam }; n.gain = makeParam(1); return n; }
  createPanner() {
    var n = makeNode() as FakeNode & {
      positionX: FakeParam; positionY: FakeParam; positionZ: FakeParam;
      panningModel: PanningModelType; distanceModel: DistanceModelType;
      refDistance: number; maxDistance: number; rolloffFactor: number;
    };
    n.positionX = makeParam(0); n.positionY = makeParam(0); n.positionZ = makeParam(0);
    n.panningModel = 'equalpower'; n.distanceModel = 'inverse';
    n.refDistance = 1; n.maxDistance = 10000; n.rolloffFactor = 1;
    return n;
  }
  createBufferSource() {
    var n = makeNode() as FakeNode & { buffer: AudioBuffer | null; playbackRate: FakeParam; loop: boolean; onended: ((e: Event) => void) | null; start(): void; stop(): void; };
    n.buffer = null; n.playbackRate = makeParam(1); n.loop = false; n.onended = null;
    n.start = function () { /* noop */ }; n.stop = function () { /* noop */ };
    return n;
  }
  createOscillator() {
    var n = makeNode() as FakeNode & { type: OscillatorType; frequency: FakeParam; start(): void; stop(): void; };
    n.type = 'sine'; n.frequency = makeParam(0);
    n.start = function () { /* noop */ }; n.stop = function () { /* noop */ };
    return n;
  }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}

function setupWorld(): { world: World; transforms: TransformPool; time: TimeResource; listener: AudioListenerResource } {
  var world = new World();
  var transforms = new TransformPool();
  world.registerPool(POOL_TRANSFORM, transforms);
  var time = createTimeResource();
  world.resources.set(RESOURCE_TIME, time);
  var listener = createAudioListenerResource();
  world.resources.set(RESOURCE_AUDIO_LISTENER, listener);
  return { world, transforms, time, listener };
}

// ---------- Tests ----------

test('spatial-audio-system: registers in PHASE_RENDER', () => {
  var { world } = setupWorld();
  var sys = new SpatialAudioSystem();
  world.addSystem(sys, SYSTEM_PHASE_RENDER);
  assert.equal(world.countSystemsInPhase(SYSTEM_PHASE_RENDER), 1);
  // Sanity check the canonical name.
  assert.equal(sys.name, 'spatial-audio');
});

test('spatial-audio-system: setLocalCharacterEntity(null) makes update a no-op', () => {
  var { world, listener } = setupWorld();
  var sys = new SpatialAudioSystem();
  world.addSystem(sys, SYSTEM_PHASE_RENDER);
  // Default state: no local character.
  assert.equal(sys.getLocalCharacterEntity(), null);
  world.update(0.016);
  // Listener pose untouched, lastUpdateFrame still 0.
  assert.equal(listener.pose.x, 0);
  assert.equal(listener.pose.y, 0);
  assert.equal(listener.lastUpdateFrame, 0);
});

test('spatial-audio-system: pushes the local character transform into AudioListenerResource each tick', () => {
  var { world, transforms, time, listener } = setupWorld();
  var sys = new SpatialAudioSystem();
  world.addSystem(sys, SYSTEM_PHASE_RENDER);
  var hero = world.createEntity();
  transforms.attach(hero, 100, 50, 5);
  sys.setLocalCharacterEntity(hero);
  // Simulate the engine bumping the frame counter (Engine.tick does
  // this normally; in tests we set it manually).
  time.frame = 7;
  world.update(0.016);
  assert.equal(listener.pose.x, 100);
  assert.equal(listener.pose.y, 50);
  assert.equal(listener.pose.z, 5);
  assert.equal(listener.lastUpdateFrame, 7);
});

test('spatial-audio-system: tolerates a bound entity with no attached transform', () => {
  var { world, time, listener } = setupWorld();
  var sys = new SpatialAudioSystem();
  world.addSystem(sys, SYSTEM_PHASE_RENDER);
  var ghost = world.createEntity();   // never attached to TransformPool
  sys.setLocalCharacterEntity(ghost);
  time.frame = 3;
  // Must NOT throw.
  world.update(0.016);
  // Pose stays at default; lastUpdateFrame untouched.
  assert.equal(listener.pose.x, 0);
  assert.equal(listener.lastUpdateFrame, 0);
});

test('spatial-audio-system: multiple ticks advance lastUpdateFrame', () => {
  var { world, transforms, time, listener } = setupWorld();
  var sys = new SpatialAudioSystem();
  world.addSystem(sys, SYSTEM_PHASE_RENDER);
  var hero = world.createEntity();
  transforms.attach(hero, 0, 0);
  sys.setLocalCharacterEntity(hero);

  time.frame = 1;
  world.update(0.016);
  assert.equal(listener.lastUpdateFrame, 1);

  transforms.setPosition(hero, 10, 20);
  time.frame = 2;
  world.update(0.016);
  assert.equal(listener.lastUpdateFrame, 2);
  assert.equal(listener.pose.x, 10);
  assert.equal(listener.pose.y, 20);

  transforms.setPosition(hero, -5, -5);
  time.frame = 3;
  world.update(0.016);
  assert.equal(listener.lastUpdateFrame, 3);
  assert.equal(listener.pose.x, -5);
});

test('spatial-audio-system: with a SpatialAudioBus attached, also pushes pose into the bus', async () => {
  var { world, transforms, time } = setupWorld();
  var ctx = new FakeAudioContext();
  var bus = AudioBus.create(ctx as unknown as AudioContext);
  await bus.unlock();
  var spatial = SpatialAudioBus.create(bus);
  var sys = new SpatialAudioSystem({ spatialBus: spatial });
  world.addSystem(sys, SYSTEM_PHASE_RENDER);
  var hero = world.createEntity();
  transforms.attach(hero, 11, 22, 3);
  sys.setLocalCharacterEntity(hero);
  time.frame = 1;
  world.update(0.016);
  // AudioContext.listener pose mirrors the transform.
  assert.equal(ctx.listener.positionX.value, 11);
  assert.equal(ctx.listener.positionY.value, 22);
  assert.equal(ctx.listener.positionZ.value, 3);
});

test('spatial-audio-system: setSpatialBus(null) puts system back in resource-only mode', async () => {
  var { world, transforms, time, listener } = setupWorld();
  var ctx = new FakeAudioContext();
  var bus = AudioBus.create(ctx as unknown as AudioContext);
  await bus.unlock();
  var spatial = SpatialAudioBus.create(bus);
  var sys = new SpatialAudioSystem({ spatialBus: spatial });
  var hero = world.createEntity();
  transforms.attach(hero, 5, 5);
  sys.setLocalCharacterEntity(hero);
  world.addSystem(sys, SYSTEM_PHASE_RENDER);

  time.frame = 1;
  world.update(0.016);
  assert.equal(ctx.listener.positionX.value, 5);

  sys.setSpatialBus(null);
  transforms.setPosition(hero, 99, 99);
  time.frame = 2;
  world.update(0.016);
  // Resource still updated; bus listener stays at the prior value
  // because the system no longer pushes to it.
  assert.equal(listener.pose.x, 99);
  assert.equal(ctx.listener.positionX.value, 5);
});

test('spatial-audio-system: tolerates missing AudioListenerResource (silent no-op)', () => {
  var world = new World();
  var transforms = new TransformPool();
  world.registerPool(POOL_TRANSFORM, transforms);
  world.resources.set(RESOURCE_TIME, createTimeResource());
  // Did NOT register RESOURCE_AUDIO_LISTENER.
  var sys = new SpatialAudioSystem();
  var hero = world.createEntity();
  transforms.attach(hero, 0, 0);
  sys.setLocalCharacterEntity(hero);
  world.addSystem(sys, SYSTEM_PHASE_RENDER);
  // Must NOT throw.
  world.update(0.016);
  assert.equal(world.resources.has(RESOURCE_AUDIO_LISTENER), false);
});
