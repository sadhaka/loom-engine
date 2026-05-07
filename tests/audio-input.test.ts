// Loom Engine - Phase 5 audio + input tests.
//
// AudioBus tested with a hand-built fake AudioContext (Node has no
// Web Audio API). InputManager exercised via the inject* helpers.
// InputSystem + VeilBudgetSystem run end-to-end against a small
// World.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  AudioBus,
  AUDIO_BUDGET_AMBIENT_FLOOR,
  AUDIO_BUDGET_ESSENTIAL_FLOOR,
  RESOURCE_AUDIO_BUS,
  // Input
  InputManager,
  InputSystem,
  RESOURCE_INPUT_MANAGER,
  RESOURCE_INPUT,
  // Budget
  VeilBudgetSystem,
  createVeilBudgetResource,
  RESOURCE_VEIL_BUDGET,
  // World plumbing
  SYSTEM_PHASE_INPUT,
  type InputSnapshot,
  type VeilBudgetResource,
  // Particle pool for budget propagation check
  ParticlePool,
  POOL_PARTICLE,
} from '../src/index.js';

// ---------- Fake Web Audio context ----------

class FakeGainNode {
  gain = { value: 1 };
  connections: FakeGainNode[] = [];
  connect(target: FakeGainNode): FakeGainNode { this.connections.push(target); return target; }
  disconnect(): void { this.connections.length = 0; }
}

class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  destination = new FakeGainNode();
  currentTime = 0;
  createGain(): FakeGainNode { return new FakeGainNode(); }
  createBufferSource(): {
    buffer: AudioBuffer | null;
    playbackRate: { value: number };
    connect: (t: FakeGainNode) => FakeGainNode;
    start: (t?: number) => void;
    stop: (t?: number) => void;
  } {
    return {
      buffer: null,
      playbackRate: { value: 1 },
      connect: (t: FakeGainNode) => t,
      start: () => {},
      stop: () => {},
    };
  }
  createOscillator(): {
    type: OscillatorType;
    frequency: { value: number };
    connect: (t: FakeGainNode) => FakeGainNode;
    start: (t?: number) => void;
    stop: (t?: number) => void;
  } {
    return {
      type: 'sine',
      frequency: { value: 0 },
      connect: (t: FakeGainNode) => t,
      start: () => {},
      stop: () => {},
    };
  }
  async resume(): Promise<void> { this.state = 'running'; }
  async close(): Promise<void> { this.state = 'closed'; }
}

function makeBus(): AudioBus {
  const ctx = new FakeAudioContext() as unknown as AudioContext;
  return AudioBus.create(ctx);
}

// ---------- AudioBus ----------

test('audio bus: starts suspended, unlocks via resume()', async () => {
  const bus = makeBus();
  assert.equal(bus.isUnlocked(), false);
  await bus.unlock();
  assert.equal(bus.isUnlocked(), true);
});

test('audio bus: default sub-buses exist', () => {
  const bus = makeBus();
  for (const name of ['sfx', 'music', 'voice', 'ui']) {
    assert.equal(bus.hasBus(name), true, name);
  }
});

test('audio bus: setBusGain stores baseGain; budget=1 keeps gain', () => {
  const bus = makeBus();
  bus.setBusGain('sfx', 0.5);
  assert.equal(bus.getBusGain('sfx'), 0.5);
  // Underlying GainNode (input) reflects it because budget = 1 (default).
  const node = bus.input('sfx') as unknown as { gain: { value: number } };
  assert.equal(node.gain.value, 0.5);
});

test('audio bus: budget below ambient floor mutes ambient buses but not essential', () => {
  const bus = makeBus();
  bus.setAudioBudget(AUDIO_BUDGET_AMBIENT_FLOOR - 0.01);
  const sfx = bus.input('sfx') as unknown as { gain: { value: number } };       // essential
  const music = bus.input('music') as unknown as { gain: { value: number } };   // ambient
  assert.ok(sfx.gain.value > 0, 'sfx essential stays audible');
  assert.equal(music.gain.value, 0, 'music ambient muted');
});

test('audio bus: budget below essential floor mutes everything', () => {
  const bus = makeBus();
  bus.setAudioBudget(AUDIO_BUDGET_ESSENTIAL_FLOOR - 0.001);
  for (const name of ['sfx', 'music', 'voice', 'ui']) {
    const node = bus.input(name) as unknown as { gain: { value: number } };
    assert.equal(node.gain.value, 0, name + ' muted');
  }
});

test('audio bus: setBusMuted overrides budget', () => {
  const bus = makeBus();
  bus.setBusMuted('sfx', true);
  const sfx = bus.input('sfx') as unknown as { gain: { value: number } };
  assert.equal(sfx.gain.value, 0);
  bus.setBusMuted('sfx', false);
  assert.ok(sfx.gain.value > 0);
});

test('audio bus: addBus + removeBus lifecycle', () => {
  const bus = makeBus();
  bus.addBus('cue', { initialGain: 0.3, priority: 'essential' });
  assert.equal(bus.hasBus('cue'), true);
  assert.equal(bus.getBusGain('cue'), 0.3);
  bus.removeBus('cue');
  assert.equal(bus.hasBus('cue'), false);
});

test('audio bus: playOneShot returns null when locked', () => {
  const bus = makeBus();
  // Hand-make a minimal AudioBuffer-shaped object - the bus passes
  // it through without inspection in our fake.
  const fakeBuffer = {} as unknown as AudioBuffer;
  const result = bus.playOneShot('sfx', fakeBuffer);
  assert.equal(result, null);   // locked
});

test('audio bus: dispose tears down gain nodes', () => {
  const bus = makeBus();
  bus.dispose();
  assert.equal(bus.hasBus('sfx'), false);
});

// ---------- InputManager ----------

test('input manager: keysHeld + keysPressedThisFrame on key down', () => {
  const m = new InputManager();
  m.injectKeyDown('KeyA');
  assert.equal(m.snapshot().keysHeld.has('KeyA'), true);
  // beginFrame snapshots the pressed accumulator.
  m.beginFrame();
  const s1 = m.snapshot();
  assert.equal(s1.keysPressedThisFrame.has('KeyA'), true);
  assert.equal(s1.keysReleasedThisFrame.has('KeyA'), false);
  // Next frame: pressedThisFrame clears (no new event).
  m.beginFrame();
  const s2 = m.snapshot();
  assert.equal(s2.keysPressedThisFrame.has('KeyA'), false);
  assert.equal(s2.keysHeld.has('KeyA'), true, 'still held until keyup');
});

test('input manager: key up moves key from held to released-this-frame', () => {
  const m = new InputManager();
  m.injectKeyDown('Space');
  m.beginFrame();
  m.injectKeyUp('Space');
  m.beginFrame();
  const s = m.snapshot();
  assert.equal(s.keysHeld.has('Space'), false);
  assert.equal(s.keysReleasedThisFrame.has('Space'), true);
});

test('input manager: pointer pressed-this-frame bitmask', () => {
  const m = new InputManager();
  m.injectPointerMove(100, 200, 0);
  m.injectPointerDown(1);   // primary
  m.beginFrame();
  const s = m.snapshot();
  assert.equal(s.pointer.x, 100);
  assert.equal(s.pointer.y, 200);
  assert.equal(s.pointerPressedThisFrame & 1, 1, 'primary registered');
  // Next frame: cleared.
  m.beginFrame();
  assert.equal(m.snapshot().pointerPressedThisFrame, 0);
});

test('input manager: pointer released-this-frame', () => {
  const m = new InputManager();
  m.injectPointerDown(1);
  m.beginFrame();
  m.injectPointerUp(1);
  m.beginFrame();
  assert.equal(m.snapshot().pointerReleasedThisFrame & 1, 1);
});

test('input manager: holding a key only emits ONE pressedThisFrame', () => {
  const m = new InputManager();
  m.injectKeyDown('KeyW');
  m.injectKeyDown('KeyW');   // duplicate
  m.beginFrame();
  const s = m.snapshot();
  assert.equal(s.keysPressedThisFrame.size, 1);
  assert.equal(s.keysHeld.has('KeyW'), true);
});

// ---------- InputSystem ----------

test('input system: writes snapshot into RESOURCE_INPUT each tick', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const m = new InputManager();
  w.resources.set(RESOURCE_INPUT_MANAGER, m);
  w.addSystem(new InputSystem(), SYSTEM_PHASE_INPUT);

  m.injectKeyDown('KeyA');
  w.update(0.016);
  const s = w.resources.require<InputSnapshot>(RESOURCE_INPUT);
  assert.equal(s.keysHeld.has('KeyA'), true);
  assert.equal(s.keysPressedThisFrame.has('KeyA'), true);

  // Next tick: pressed-this-frame cleared.
  w.update(0.016);
  const s2 = w.resources.require<InputSnapshot>(RESOURCE_INPUT);
  assert.equal(s2.keysPressedThisFrame.has('KeyA'), false);
  assert.equal(s2.keysHeld.has('KeyA'), true);
});

test('input system: tolerates missing manager (engine in headless mode)', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  // No InputManager registered. Should not throw.
  w.addSystem(new InputSystem(), SYSTEM_PHASE_INPUT);
  w.update(0.016);
  assert.equal(w.resources.has(RESOURCE_INPUT), false);
});

// ---------- VeilBudgetSystem ----------

test('veil budget system: propagates audioBudget to AudioBus', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const bus = makeBus();
  const budget: VeilBudgetResource = createVeilBudgetResource();
  w.resources.set(RESOURCE_AUDIO_BUS, bus);
  w.resources.set(RESOURCE_VEIL_BUDGET, budget);
  w.addSystem(new VeilBudgetSystem(), SYSTEM_PHASE_INPUT);

  budget.audioBudget = 0.1;       // below ambient floor
  w.update(0.016);
  const music = bus.input('music') as unknown as { gain: { value: number } };
  assert.equal(music.gain.value, 0, 'music muted under low budget');

  budget.audioBudget = 1;
  w.update(0.016);
  assert.ok(music.gain.value > 0, 'music recovers when budget restored');
});

test('veil budget system: propagates particleBudget to pool maxParticles', async () => {
  const { World } = await import('../src/world.js');
  const w = new World();
  const pool = new ParticlePool();
  const budget: VeilBudgetResource = createVeilBudgetResource();
  w.registerPool(POOL_PARTICLE, pool);
  w.resources.set(RESOURCE_VEIL_BUDGET, budget);
  w.addSystem(new VeilBudgetSystem(), SYSTEM_PHASE_INPUT);

  budget.particleBudget = 32;
  w.update(0.016);
  assert.equal(pool.getMaxParticles(), 32);

  budget.particleBudget = 4096;
  w.update(0.016);
  assert.equal(pool.getMaxParticles(), 4096);
});
