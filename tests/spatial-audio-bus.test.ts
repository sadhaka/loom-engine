// Loom Engine - Phase 17 Track A: SpatialAudioBus tests.
//
// Verifies the new spatial sub-bus is added to the underlying
// AudioBus, that PannerNodes are constructed + reused via
// handle.setPosition, falloff fields propagate, and the play
// methods return null under the documented unmet-prereq cases
// (context suspended, bus muted by VE budget).
//
// Web Audio is mocked (Node has no native Web Audio); the existing
// audio-input.test.ts FakeAudioContext doesn't expose PannerNode +
// AudioParam-style listener, so we extend the shape here.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  AudioBus,
  AUDIO_BUDGET_AMBIENT_FLOOR,
  AUDIO_BUDGET_ESSENTIAL_FLOOR,
  SpatialAudioBus,
  SPATIAL_BUS_NAME,
} from '../src/index.js';

// ---------- Mock Web Audio ----------

interface FakeAudioParam {
  value: number;
  setValueAtTime(v: number, _t: number): void;
  linearRampToValueAtTime(v: number, _t: number): void;
}

function makeParam(initial: number): FakeAudioParam {
  return {
    value: initial,
    setValueAtTime(v: number) { this.value = v; },
    linearRampToValueAtTime(v: number) { this.value = v; },
  };
}

interface FakeNode {
  connections: FakeNode[];
  disconnected: boolean;
  connect(target: FakeNode): FakeNode;
  disconnect(): void;
}

function makeNode(): FakeNode {
  var n: FakeNode = {
    connections: [],
    disconnected: false,
    connect(target: FakeNode): FakeNode {
      this.connections.push(target);
      return target;
    },
    disconnect(): void {
      this.disconnected = true;
      this.connections.length = 0;
    },
  };
  return n;
}

interface FakeGainNode extends FakeNode {
  gain: FakeAudioParam;
}

function makeGain(): FakeGainNode {
  var n = makeNode() as FakeGainNode;
  n.gain = makeParam(1);
  return n;
}

interface FakePannerNode extends FakeNode {
  positionX: FakeAudioParam;
  positionY: FakeAudioParam;
  positionZ: FakeAudioParam;
  panningModel: PanningModelType;
  distanceModel: DistanceModelType;
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
}

function makePanner(): FakePannerNode {
  var n = makeNode() as FakePannerNode;
  n.positionX = makeParam(0);
  n.positionY = makeParam(0);
  n.positionZ = makeParam(0);
  n.panningModel = 'equalpower';
  n.distanceModel = 'inverse';
  n.refDistance = 1;
  n.maxDistance = 10000;
  n.rolloffFactor = 1;
  return n;
}

interface FakeBufferSourceNode extends FakeNode {
  buffer: AudioBuffer | null;
  playbackRate: FakeAudioParam;
  loop: boolean;
  startCount: number;
  stopCount: number;
  onended: ((this: AudioScheduledSourceNode, ev: Event) => unknown) | null;
  start(t?: number): void;
  stop(t?: number): void;
}

function makeBufferSource(): FakeBufferSourceNode {
  var n = makeNode() as FakeBufferSourceNode;
  n.buffer = null;
  n.playbackRate = makeParam(1);
  n.loop = false;
  n.startCount = 0;
  n.stopCount = 0;
  n.onended = null;
  n.start = function () { this.startCount++; };
  n.stop = function () { this.stopCount++; };
  return n;
}

interface FakeOscillatorNode extends FakeNode {
  type: OscillatorType;
  frequency: FakeAudioParam;
  startCount: number;
  stopCount: number;
  start(t?: number): void;
  stop(t?: number): void;
}

function makeOscillator(): FakeOscillatorNode {
  var n = makeNode() as FakeOscillatorNode;
  n.type = 'sine';
  n.frequency = makeParam(0);
  n.startCount = 0;
  n.stopCount = 0;
  n.start = function () { this.startCount++; };
  n.stop = function () { this.stopCount++; };
  return n;
}

interface FakeListener {
  positionX: FakeAudioParam;
  positionY: FakeAudioParam;
  positionZ: FakeAudioParam;
  forwardX: FakeAudioParam;
  forwardY: FakeAudioParam;
  forwardZ: FakeAudioParam;
  upX: FakeAudioParam;
  upY: FakeAudioParam;
  upZ: FakeAudioParam;
}

function makeListener(): FakeListener {
  return {
    positionX: makeParam(0),
    positionY: makeParam(0),
    positionZ: makeParam(0),
    forwardX: makeParam(0),
    forwardY: makeParam(0),
    forwardZ: makeParam(-1),
    upX: makeParam(0),
    upY: makeParam(1),
    upZ: makeParam(0),
  };
}

class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  destination = makeNode();
  currentTime = 0;
  listener = makeListener();
  createGainCount = 0;
  createPannerCount = 0;
  createBufferSourceCount = 0;
  createOscillatorCount = 0;
  lastPanner: FakePannerNode | null = null;
  lastGain: FakeGainNode | null = null;
  lastBufferSource: FakeBufferSourceNode | null = null;
  lastOscillator: FakeOscillatorNode | null = null;

  createGain(): FakeGainNode {
    this.createGainCount++;
    var g = makeGain();
    this.lastGain = g;
    return g;
  }
  createPanner(): FakePannerNode {
    this.createPannerCount++;
    var p = makePanner();
    this.lastPanner = p;
    return p;
  }
  createBufferSource(): FakeBufferSourceNode {
    this.createBufferSourceCount++;
    var s = makeBufferSource();
    this.lastBufferSource = s;
    return s;
  }
  createOscillator(): FakeOscillatorNode {
    this.createOscillatorCount++;
    var o = makeOscillator();
    this.lastOscillator = o;
    return o;
  }
  async resume(): Promise<void> { this.state = 'running'; }
  async close(): Promise<void> { this.state = 'closed'; }
}

function makeBuffer(): AudioBuffer {
  return { duration: 0.5, length: 22050, numberOfChannels: 1, sampleRate: 44100 } as unknown as AudioBuffer;
}

async function setupRunningBus(): Promise<{ ctx: FakeAudioContext; bus: AudioBus; spatial: SpatialAudioBus }> {
  var ctx = new FakeAudioContext();
  var bus = AudioBus.create(ctx as unknown as AudioContext);
  await bus.unlock();
  var spatial = SpatialAudioBus.create(bus);
  return { ctx, bus, spatial };
}

// ---------- Tests ----------

test('spatial-audio-bus: create adds a "spatial" sub-bus to the underlying AudioBus', async () => {
  var { bus, spatial } = await setupRunningBus();
  assert.equal(bus.hasBus(SPATIAL_BUS_NAME), true);
  assert.equal(spatial.getAudioBus(), bus);
});

test('spatial-audio-bus: create is idempotent if "spatial" bus already exists', () => {
  var ctx = new FakeAudioContext();
  var bus = AudioBus.create(ctx as unknown as AudioContext);
  bus.addBus(SPATIAL_BUS_NAME, { initialGain: 0.42, priority: 'ambient' });
  assert.equal(bus.getBusGain(SPATIAL_BUS_NAME), 0.42);
  // Constructing on top of a bus that already has a spatial bus must
  // not clobber the gain we set.
  SpatialAudioBus.create(bus);
  assert.equal(bus.getBusGain(SPATIAL_BUS_NAME), 0.42);
});

test('spatial-audio-bus: playPositional builds source -> gain -> panner -> spatial chain', async () => {
  var { ctx, bus, spatial } = await setupRunningBus();
  var handle = spatial.playPositional(makeBuffer(), { x: 5, y: 6 });
  assert.ok(handle, 'handle returned when context running and bus unmuted');
  assert.equal(ctx.createBufferSourceCount, 1);
  assert.equal(ctx.createPannerCount, 1);
  // gain count = AudioBus default 5 sub-buses (sfx/music/voice/ui/spatial)
  // + master + 1 per-source. Verify the last gain we created was per-source.
  var src = ctx.lastBufferSource!;
  var gain = ctx.lastGain!;
  var panner = ctx.lastPanner!;
  // src -> gain -> panner -> spatial-bus input
  assert.deepEqual(src.connections, [gain]);
  assert.deepEqual(gain.connections, [panner]);
  assert.equal(panner.connections.length, 1);
  // The spatial-bus input is the GainNode AudioBus added; the panner
  // connects directly into it.
  var spatialInput = bus.input(SPATIAL_BUS_NAME) as unknown as FakeNode;
  assert.equal(panner.connections[0], spatialInput);
});

test('spatial-audio-bus: playPositional sets PannerNode position', async () => {
  var { ctx, spatial } = await setupRunningBus();
  spatial.playPositional(makeBuffer(), { x: 12, y: -3, z: 4 });
  var p = ctx.lastPanner!;
  assert.equal(p.positionX.value, 12);
  assert.equal(p.positionY.value, -3);
  assert.equal(p.positionZ.value, 4);
});

test('spatial-audio-bus: playPositional applies distanceModel/refDistance/maxDistance/rolloffFactor', async () => {
  var { ctx, spatial } = await setupRunningBus();
  spatial.playPositional(makeBuffer(), {
    x: 0, y: 0,
    distanceModel: 'linear',
    refDistance: 2,
    maxDistance: 24,
    rolloffFactor: 0.7,
  });
  var p = ctx.lastPanner!;
  assert.equal(p.distanceModel, 'linear');
  assert.equal(p.refDistance, 2);
  assert.equal(p.maxDistance, 24);
  assert.equal(p.rolloffFactor, 0.7);
  assert.equal(p.panningModel, 'HRTF');
});

test('spatial-audio-bus: playPositional defaults match spec (inverse model, ref=1, max=32, rolloff=1)', async () => {
  var { ctx, spatial } = await setupRunningBus();
  spatial.playPositional(makeBuffer(), { x: 0, y: 0 });
  var p = ctx.lastPanner!;
  assert.equal(p.distanceModel, 'inverse');
  assert.equal(p.refDistance, 1);
  assert.equal(p.maxDistance, 32);
  assert.equal(p.rolloffFactor, 1);
});

test('spatial-audio-bus: handle.setPosition reuses the same PannerNode (no realloc)', async () => {
  var { ctx, spatial } = await setupRunningBus();
  var handle = spatial.playPositional(makeBuffer(), { x: 0, y: 0 });
  assert.ok(handle);
  var pannerCountBefore = ctx.createPannerCount;
  handle!.setPosition(10, 20, 0);
  // No new panner allocated.
  assert.equal(ctx.createPannerCount, pannerCountBefore);
  var p = ctx.lastPanner!;
  assert.equal(p.positionX.value, 10);
  assert.equal(p.positionY.value, 20);
});

test('spatial-audio-bus: handle.stop is idempotent and disconnects nodes', async () => {
  var { ctx, spatial } = await setupRunningBus();
  var handle = spatial.playPositional(makeBuffer(), { x: 0, y: 0 });
  assert.ok(handle);
  assert.equal(handle!.isPlaying(), true);
  handle!.stop();
  assert.equal(handle!.isPlaying(), false);
  // Calling stop again must not throw and stopCount must not double.
  var src = ctx.lastBufferSource!;
  var stopCountAfterFirst = src.stopCount;
  handle!.stop();
  assert.equal(src.stopCount, stopCountAfterFirst);
  // Nodes were disconnected.
  assert.equal(src.disconnected, true);
  assert.equal(ctx.lastGain!.disconnected, true);
  assert.equal(ctx.lastPanner!.disconnected, true);
});

test('spatial-audio-bus: handle.fadeOut resolves after duration and stops the source', async () => {
  var { ctx, spatial } = await setupRunningBus();
  var handle = spatial.playPositional(makeBuffer(), { x: 0, y: 0 });
  assert.ok(handle);
  var startMs = Date.now();
  await handle!.fadeOut(20);
  var elapsedMs = Date.now() - startMs;
  // Generous lower bound (Node setTimeout is best-effort).
  assert.ok(elapsedMs >= 15, 'fadeOut waited at least ~15ms; got ' + elapsedMs);
  assert.equal(handle!.isPlaying(), false);
  assert.equal(ctx.lastBufferSource!.disconnected, true);
});

test('spatial-audio-bus: returns null when AudioContext is suspended (locked)', () => {
  var ctx = new FakeAudioContext();
  var bus = AudioBus.create(ctx as unknown as AudioContext);
  // Did NOT call bus.unlock().
  var spatial = SpatialAudioBus.create(bus);
  var handle = spatial.playPositional(makeBuffer(), { x: 0, y: 0 });
  assert.equal(handle, null);
  // No nodes built for a locked context.
  assert.equal(ctx.createBufferSourceCount, 0);
  assert.equal(ctx.createPannerCount, 0);
});

test('spatial-audio-bus: returns null when spatial bus muted by VE budget below ambient floor', async () => {
  var { ctx, bus, spatial } = await setupRunningBus();
  bus.setAudioBudget(AUDIO_BUDGET_AMBIENT_FLOOR - 0.01);
  var handle = spatial.playPositional(makeBuffer(), { x: 0, y: 0 });
  assert.equal(handle, null);
  assert.equal(ctx.createBufferSourceCount, 0);
});

test('spatial-audio-bus: returns null when spatial bus explicitly muted', async () => {
  var { ctx, bus, spatial } = await setupRunningBus();
  bus.setBusMuted(SPATIAL_BUS_NAME, true);
  var handle = spatial.playPositional(makeBuffer(), { x: 0, y: 0 });
  assert.equal(handle, null);
  assert.equal(ctx.createBufferSourceCount, 0);
  // Unmute and we should be able to play again.
  bus.setBusMuted(SPATIAL_BUS_NAME, false);
  var h2 = spatial.playPositional(makeBuffer(), { x: 0, y: 0 });
  assert.ok(h2);
});

test('spatial-audio-bus: returns null under essential-floor budget (catastrophic cut)', async () => {
  var { spatial, bus } = await setupRunningBus();
  bus.setAudioBudget(AUDIO_BUDGET_ESSENTIAL_FLOOR - 0.001);
  var h = spatial.playPositional(makeBuffer(), { x: 0, y: 0 });
  assert.equal(h, null);
});

test('spatial-audio-bus: setListener writes AudioContext.listener pose', async () => {
  var { ctx, spatial } = await setupRunningBus();
  spatial.setListener({ x: 7, y: 8, z: 9 });
  assert.equal(ctx.listener.positionX.value, 7);
  assert.equal(ctx.listener.positionY.value, 8);
  assert.equal(ctx.listener.positionZ.value, 9);
  // Default forward + up applied.
  assert.equal(ctx.listener.forwardZ.value, -1);
  assert.equal(ctx.listener.upY.value, 1);
});

test('spatial-audio-bus: setListener honours custom forward/up vectors', async () => {
  var { ctx, spatial } = await setupRunningBus();
  spatial.setListener({
    x: 0, y: 0, z: 0,
    forward: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 0, z: 1 },
  });
  assert.equal(ctx.listener.forwardX.value, 1);
  assert.equal(ctx.listener.forwardY.value, 0);
  assert.equal(ctx.listener.forwardZ.value, 0);
  assert.equal(ctx.listener.upX.value, 0);
  assert.equal(ctx.listener.upY.value, 0);
  assert.equal(ctx.listener.upZ.value, 1);
});

test('spatial-audio-bus: playPositionalTone wires oscillator -> gain -> panner -> spatial', async () => {
  var { ctx, bus, spatial } = await setupRunningBus();
  var handle = spatial.playPositionalTone(440, 200, { x: 0, y: 0, type: 'square' });
  assert.ok(handle);
  assert.equal(ctx.createOscillatorCount, 1);
  assert.equal(ctx.createPannerCount, 1);
  var osc = ctx.lastOscillator!;
  var gain = ctx.lastGain!;
  var panner = ctx.lastPanner!;
  assert.equal(osc.type, 'square');
  assert.equal(osc.frequency.value, 440);
  assert.deepEqual(osc.connections, [gain]);
  assert.deepEqual(gain.connections, [panner]);
  var spatialInput = bus.input(SPATIAL_BUS_NAME) as unknown as FakeNode;
  assert.equal(panner.connections[0], spatialInput);
});

test('spatial-audio-bus: dispose() stops every active source', async () => {
  var { ctx, spatial } = await setupRunningBus();
  var h1 = spatial.playPositional(makeBuffer(), { x: 0, y: 0 });
  // Snapshot the buffer source we just made because the next play
  // call overwrites ctx.lastBufferSource.
  var src1 = ctx.lastBufferSource!;
  var h2 = spatial.playPositional(makeBuffer(), { x: 1, y: 1 });
  var src2 = ctx.lastBufferSource!;
  assert.ok(h1 && h2);
  spatial.dispose();
  assert.equal(h1!.isPlaying(), false);
  assert.equal(h2!.isPlaying(), false);
  assert.equal(src1.disconnected, true);
  assert.equal(src2.disconnected, true);
});

test('spatial-audio-bus: getListenerPose returns the most recently set pose', async () => {
  var { spatial } = await setupRunningBus();
  spatial.setListener({ x: 100, y: 200 });
  var pose = spatial.getListenerPose();
  assert.equal(pose.x, 100);
  assert.equal(pose.y, 200);
});

test('spatial-audio-bus: gain option is applied to per-source gain node', async () => {
  var { ctx, spatial } = await setupRunningBus();
  spatial.playPositional(makeBuffer(), { x: 0, y: 0, gain: 0.3 });
  // Per-source gain is the most recently created GainNode.
  assert.equal(ctx.lastGain!.gain.value, 0.3);
});

test('spatial-audio-bus: rate option is applied to AudioBufferSourceNode.playbackRate', async () => {
  var { ctx, spatial } = await setupRunningBus();
  spatial.playPositional(makeBuffer(), { x: 0, y: 0, rate: 1.5 });
  assert.equal(ctx.lastBufferSource!.playbackRate.value, 1.5);
});

test('spatial-audio-bus: loop option is applied to AudioBufferSourceNode.loop', async () => {
  var { ctx, spatial } = await setupRunningBus();
  spatial.playPositional(makeBuffer(), { x: 0, y: 0, loop: true });
  assert.equal(ctx.lastBufferSource!.loop, true);
});
