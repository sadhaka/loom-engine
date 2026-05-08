// Phase 0.35.0 - AudioMixer tests.
//
// Strategy: real AudioBus over a hand-built FakeAudioContext (same
// shape audio-input.test.ts uses). The mixer pushes to AudioBus.
// setBusGain / setMasterGain, which writes the FakeGainNode's
// gain.value, so tests read that back to verify the animation curve.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  AudioBus,
  AudioMixer,
  RESOURCE_AUDIO_MIXER,
  Easings,
} from '../src/index.js';

class FakeGainNode {
  gain = { value: 1 };
  connections: FakeGainNode[] = [];
  connect(target: FakeGainNode): FakeGainNode {
    this.connections.push(target);
    return target;
  }
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

function busGainValue(bus: AudioBus, name: string): number {
  return (bus.input(name) as unknown as FakeGainNode).gain.value;
}

test('audio-mixer: RESOURCE_AUDIO_MIXER is the stable string', () => {
  assert.equal(RESOURCE_AUDIO_MIXER, 'audio_mixer');
});

test('audio-mixer: create seeds master + bus targets from live AudioBus state', () => {
  const bus = makeBus();
  bus.setMasterGain(0.7);
  bus.setBusGain('sfx', 0.5);
  bus.setBusGain('music', 0.3);
  const mixer = AudioMixer.create({ bus });
  assert.equal(mixer.getMasterTarget(), 0.7);
  assert.equal(mixer.getBusTarget('sfx'), 0.5);
  assert.equal(mixer.getBusTarget('music'), 0.3);
});

test('audio-mixer: fadeBus duration 0 applies immediately + fires onComplete', () => {
  const bus = makeBus();
  const mixer = AudioMixer.create({ bus });
  let fired = false;
  mixer.fadeBus('sfx', 0.25, { durationMs: 0, onComplete: () => { fired = true; } });
  assert.equal(mixer.getBusTarget('sfx'), 0.25);
  assert.equal(busGainValue(bus, 'sfx'), 0.25);
  assert.equal(fired, true);
  assert.equal(mixer.isFading('sfx'), false);
});

test('audio-mixer: fadeBus animates linearly across ticks (default easing)', () => {
  const bus = makeBus();
  bus.setBusGain('sfx', 1);
  const mixer = AudioMixer.create({ bus });
  mixer.fadeBus('sfx', 0, { durationMs: 100 });
  assert.equal(mixer.isFading('sfx'), true);
  // No tick yet -> gain unchanged on the bus side (fade hasn't applied).
  assert.equal(busGainValue(bus, 'sfx'), 1);
  mixer.tick(50);
  // Linear: 1 + (0-1) * 0.5 = 0.5
  const mid = busGainValue(bus, 'sfx');
  assert.ok(Math.abs(mid - 0.5) < 1e-9, `expected ~0.5 got ${mid}`);
  assert.equal(mixer.isFading('sfx'), true);
  mixer.tick(50);
  assert.equal(busGainValue(bus, 'sfx'), 0);
  assert.equal(mixer.isFading('sfx'), false);
});

test('audio-mixer: fadeBus calls onComplete exactly once when fade lands', () => {
  const bus = makeBus();
  const mixer = AudioMixer.create({ bus });
  let count = 0;
  mixer.fadeBus('sfx', 0, { durationMs: 50, onComplete: () => { count++; } });
  mixer.tick(25);
  assert.equal(count, 0);
  mixer.tick(25);
  assert.equal(count, 1);
  // Extra ticks do not re-fire.
  mixer.tick(25);
  assert.equal(count, 1);
});

test('audio-mixer: fadeBus replacing an in-flight fade re-targets from the current value', () => {
  const bus = makeBus();
  bus.setBusGain('sfx', 1);
  const mixer = AudioMixer.create({ bus });
  mixer.fadeBus('sfx', 0, { durationMs: 100 });
  mixer.tick(50);
  // Mid-fade at 0.5. Re-target to 0.8 over 100ms.
  mixer.fadeBus('sfx', 0.8, { durationMs: 100 });
  mixer.tick(50);
  // Linear from 0.5 to 0.8 at 50% = 0.65.
  const mid = busGainValue(bus, 'sfx');
  assert.ok(Math.abs(mid - 0.65) < 1e-9, `expected 0.65 got ${mid}`);
  mixer.tick(50);
  assert.ok(Math.abs(busGainValue(bus, 'sfx') - 0.8) < 1e-9);
});

test('audio-mixer: fadeBus on unknown bus is a no-op', () => {
  const bus = makeBus();
  const mixer = AudioMixer.create({ bus });
  mixer.fadeBus('not_a_bus', 0.5, { durationMs: 100 });
  assert.equal(mixer.isFading('not_a_bus'), false);
});

test('audio-mixer: fadeBus respects easeInOutQuad curve', () => {
  const bus = makeBus();
  bus.setBusGain('sfx', 0);
  const mixer = AudioMixer.create({ bus });
  mixer.fadeBus('sfx', 1, { durationMs: 100, easing: 'easeInOutQuad' });
  mixer.tick(25);
  // easeInOutQuad(0.25) = 2 * 0.25^2 = 0.125 -> gain = 0 + 1*0.125 = 0.125
  const q1 = busGainValue(bus, 'sfx');
  assert.ok(Math.abs(q1 - 0.125) < 1e-9, `easeInOutQuad t=0.25 expected 0.125 got ${q1}`);
  mixer.tick(25);
  // t=0.5 hits midpoint exactly: easeInOutQuad(0.5) = 0.5
  const q2 = busGainValue(bus, 'sfx');
  assert.ok(Math.abs(q2 - 0.5) < 1e-9, `easeInOutQuad t=0.5 expected 0.5 got ${q2}`);
});

test('audio-mixer: fadeBus accepts a custom easing function', () => {
  const bus = makeBus();
  bus.setBusGain('sfx', 0);
  const mixer = AudioMixer.create({ bus });
  // Square root easing: gain(t) = sqrt(t).
  mixer.fadeBus('sfx', 1, {
    durationMs: 100,
    easing: (t: number) => Math.sqrt(t),
  });
  mixer.tick(25);
  // sqrt(0.25) = 0.5
  assert.ok(Math.abs(busGainValue(bus, 'sfx') - 0.5) < 1e-9);
});

test('audio-mixer: fadeMaster animates the master gain', () => {
  const bus = makeBus();
  bus.setMasterGain(1);
  const mixer = AudioMixer.create({ bus });
  mixer.fadeMaster(0, { durationMs: 100 });
  assert.equal(mixer.isMasterFading(), true);
  mixer.tick(50);
  assert.ok(Math.abs(bus.getMasterGain() - 0.5) < 1e-9);
  mixer.tick(50);
  assert.equal(bus.getMasterGain(), 0);
  assert.equal(mixer.isMasterFading(), false);
});

test('audio-mixer: fadeMaster duration 0 applies immediately + fires onComplete', () => {
  const bus = makeBus();
  const mixer = AudioMixer.create({ bus });
  let fired = false;
  mixer.fadeMaster(0.4, { durationMs: 0, onComplete: () => { fired = true; } });
  assert.equal(bus.getMasterGain(), 0.4);
  assert.equal(fired, true);
  assert.equal(mixer.isMasterFading(), false);
});

test('audio-mixer: crossfade animates two buses simultaneously', () => {
  const bus = makeBus();
  bus.setBusGain('music', 1);
  bus.setBusGain('sfx', 0);
  const mixer = AudioMixer.create({ bus });
  mixer.crossfade('music', 'sfx', 0.8, { durationMs: 100 });
  assert.equal(mixer.isFading('music'), true);
  assert.equal(mixer.isFading('sfx'), true);
  mixer.tick(50);
  assert.ok(Math.abs(busGainValue(bus, 'music') - 0.5) < 1e-9);
  assert.ok(Math.abs(busGainValue(bus, 'sfx') - 0.4) < 1e-9);
  mixer.tick(50);
  assert.equal(busGainValue(bus, 'music'), 0);
  assert.ok(Math.abs(busGainValue(bus, 'sfx') - 0.8) < 1e-9);
});

test('audio-mixer: crossfade fires onComplete once at the end', () => {
  const bus = makeBus();
  const mixer = AudioMixer.create({ bus });
  let count = 0;
  mixer.crossfade('music', 'sfx', 1, { durationMs: 50, onComplete: () => { count++; } });
  mixer.tick(25);
  assert.equal(count, 0);
  mixer.tick(25);
  assert.equal(count, 1);
});

test('audio-mixer: snapshot + restore (instant) returns target gains', () => {
  const bus = makeBus();
  bus.setMasterGain(1);
  bus.setBusGain('music', 0.6);
  bus.setBusGain('sfx', 0.5);
  const mixer = AudioMixer.create({ bus });
  mixer.snapshot('clean');
  assert.equal(mixer.hasSnapshot('clean'), true);
  // Mutate the mix.
  mixer.fadeMaster(0.2, { durationMs: 0 });
  mixer.fadeBus('music', 0, { durationMs: 0 });
  mixer.fadeBus('sfx', 1, { durationMs: 0 });
  // Now restore.
  mixer.restore('clean');
  assert.equal(bus.getMasterGain(), 1);
  assert.equal(busGainValue(bus, 'music'), 0.6);
  assert.equal(busGainValue(bus, 'sfx'), 0.5);
});

test('audio-mixer: snapshot + restore (faded) animates back to snapshot targets', () => {
  const bus = makeBus();
  bus.setBusGain('sfx', 1);
  const mixer = AudioMixer.create({ bus });
  mixer.snapshot('a');
  mixer.fadeBus('sfx', 0, { durationMs: 0 });
  assert.equal(busGainValue(bus, 'sfx'), 0);
  mixer.restore('a', { durationMs: 100 });
  assert.equal(mixer.isFading('sfx'), true);
  mixer.tick(50);
  assert.ok(Math.abs(busGainValue(bus, 'sfx') - 0.5) < 1e-9);
  mixer.tick(50);
  assert.equal(busGainValue(bus, 'sfx'), 1);
});

test('audio-mixer: restore with unknown key is a no-op', () => {
  const bus = makeBus();
  bus.setMasterGain(0.5);
  const mixer = AudioMixer.create({ bus });
  mixer.restore('nope');
  assert.equal(bus.getMasterGain(), 0.5);
});

test('audio-mixer: clearSnapshot removes the entry', () => {
  const bus = makeBus();
  const mixer = AudioMixer.create({ bus });
  mixer.snapshot('x');
  assert.equal(mixer.hasSnapshot('x'), true);
  mixer.clearSnapshot('x');
  assert.equal(mixer.hasSnapshot('x'), false);
});

test('audio-mixer: pushDuck with attackMs=0 jumps the multiplier immediately', () => {
  const bus = makeBus();
  bus.setBusGain('music', 1);
  const mixer = AudioMixer.create({ bus });
  mixer.pushDuck('voice', 'music', { scalar: 0.3, attackMs: 0, releaseMs: 0 });
  assert.ok(Math.abs(busGainValue(bus, 'music') - 0.3) < 1e-9);
  assert.equal(mixer.hasDuck('voice'), true);
});

test('audio-mixer: pushDuck attack ramps multiplier 1 -> scalar over attackMs', () => {
  const bus = makeBus();
  bus.setBusGain('music', 1);
  const mixer = AudioMixer.create({ bus });
  mixer.pushDuck('voice', 'music', { scalar: 0, attackMs: 100, releaseMs: 100 });
  // Just pushed -> in 'attacking' state; multiplier still 1.
  // pushDuck applies once with elapsedMs=0 -> easing(0)=0 for linear,
  // so multiplier = 1 + (0-1)*0 = 1. Bus gain still 1.
  assert.equal(busGainValue(bus, 'music'), 1);
  mixer.tick(50);
  // Linear 1 -> 0 at t=0.5: m = 1 + (0-1)*0.5 = 0.5.
  assert.ok(Math.abs(busGainValue(bus, 'music') - 0.5) < 1e-9);
  mixer.tick(50);
  // At end of attack, multiplier = 0 -> bus 0.
  assert.equal(busGainValue(bus, 'music'), 0);
});

test('audio-mixer: releaseDuck releaseMs=0 removes the duck immediately', () => {
  const bus = makeBus();
  bus.setBusGain('music', 1);
  const mixer = AudioMixer.create({ bus });
  mixer.pushDuck('voice', 'music', { scalar: 0.2, attackMs: 0, releaseMs: 0 });
  assert.ok(Math.abs(busGainValue(bus, 'music') - 0.2) < 1e-9);
  mixer.releaseDuck('voice');
  assert.equal(mixer.hasDuck('voice'), false);
  assert.equal(busGainValue(bus, 'music'), 1);
});

test('audio-mixer: releaseDuck ramps multiplier scalar -> 1 then removes', () => {
  const bus = makeBus();
  bus.setBusGain('music', 1);
  const mixer = AudioMixer.create({ bus });
  mixer.pushDuck('voice', 'music', { scalar: 0, attackMs: 0, releaseMs: 100 });
  assert.equal(busGainValue(bus, 'music'), 0);
  mixer.releaseDuck('voice');
  // 'releasing' state, elapsedMs=0 -> multiplier = 0 + (1-0)*0 = 0.
  // The release is applied on the NEXT tick.
  mixer.tick(50);
  // Linear 0 -> 1 at t=0.5: m = 0 + 1*0.5 = 0.5.
  assert.ok(Math.abs(busGainValue(bus, 'music') - 0.5) < 1e-9);
  assert.equal(mixer.hasDuck('voice'), true);
  mixer.tick(50);
  assert.equal(mixer.hasDuck('voice'), false);
  assert.equal(busGainValue(bus, 'music'), 1);
});

test('audio-mixer: multiple ducks on same bus -> lowest scalar wins', () => {
  const bus = makeBus();
  bus.setBusGain('music', 1);
  const mixer = AudioMixer.create({ bus });
  mixer.pushDuck('voice', 'music', { scalar: 0.5, attackMs: 0, releaseMs: 0 });
  mixer.pushDuck('cinematic', 'music', { scalar: 0.2, attackMs: 0, releaseMs: 0 });
  assert.ok(Math.abs(busGainValue(bus, 'music') - 0.2) < 1e-9);
  // Release the more aggressive duck -> falls back to the less
  // aggressive one.
  mixer.releaseDuck('cinematic');
  assert.ok(Math.abs(busGainValue(bus, 'music') - 0.5) < 1e-9);
  mixer.releaseDuck('voice');
  assert.equal(busGainValue(bus, 'music'), 1);
});

test('audio-mixer: duck multiplies on top of a fading bus target', () => {
  const bus = makeBus();
  bus.setBusGain('music', 1);
  const mixer = AudioMixer.create({ bus });
  mixer.pushDuck('voice', 'music', { scalar: 0.5, attackMs: 0, releaseMs: 0 });
  // Bus gain target now multiplied to 0.5.
  assert.ok(Math.abs(busGainValue(bus, 'music') - 0.5) < 1e-9);
  // Fade bus target down to 0 over 100ms while duck still active.
  mixer.fadeBus('music', 0, { durationMs: 100 });
  mixer.tick(50);
  // Target at 0.5 (linear midpoint of 1->0); duck still 0.5 multiplier
  // -> effective 0.25.
  assert.ok(Math.abs(busGainValue(bus, 'music') - 0.25) < 1e-9);
  mixer.tick(50);
  // Target reached 0; duck multiplier irrelevant -> effective 0.
  assert.equal(busGainValue(bus, 'music'), 0);
});

test('audio-mixer: pushDuck on unknown bus is a no-op', () => {
  const bus = makeBus();
  const mixer = AudioMixer.create({ bus });
  mixer.pushDuck('voice', 'not_a_bus', { scalar: 0.3, attackMs: 0, releaseMs: 0 });
  assert.equal(mixer.hasDuck('voice'), false);
});

test('audio-mixer: re-pushing an active duck replaces parameters', () => {
  const bus = makeBus();
  bus.setBusGain('music', 1);
  const mixer = AudioMixer.create({ bus });
  mixer.pushDuck('voice', 'music', { scalar: 0.5, attackMs: 0, releaseMs: 0 });
  assert.ok(Math.abs(busGainValue(bus, 'music') - 0.5) < 1e-9);
  // Re-push with a different scalar; behavior overwrites.
  mixer.pushDuck('voice', 'music', { scalar: 0.1, attackMs: 0, releaseMs: 0 });
  assert.ok(Math.abs(busGainValue(bus, 'music') - 0.1) < 1e-9);
});

test('audio-mixer: tick(0) is a no-op', () => {
  const bus = makeBus();
  bus.setBusGain('sfx', 1);
  const mixer = AudioMixer.create({ bus });
  mixer.fadeBus('sfx', 0, { durationMs: 100 });
  mixer.tick(0);
  // No animation applied yet because tick(0) is a no-op.
  assert.equal(busGainValue(bus, 'sfx'), 1);
});

test('audio-mixer: dispose makes subsequent operations no-op', () => {
  const bus = makeBus();
  bus.setBusGain('sfx', 1);
  const mixer = AudioMixer.create({ bus });
  mixer.dispose();
  mixer.fadeBus('sfx', 0, { durationMs: 100 });
  mixer.tick(50);
  assert.equal(mixer.isFading('sfx'), false);
  assert.equal(busGainValue(bus, 'sfx'), 1);
});

test('audio-mixer: getBusTarget reflects animated value mid-fade', () => {
  const bus = makeBus();
  bus.setBusGain('sfx', 1);
  const mixer = AudioMixer.create({ bus });
  mixer.fadeBus('sfx', 0, { durationMs: 100 });
  mixer.tick(50);
  assert.ok(Math.abs(mixer.getBusTarget('sfx') - 0.5) < 1e-9);
});

test('audio-mixer: Easings module is the same one Tween uses', () => {
  // Sanity: the mixer accepts EasingName from the same set 0.29.0 ships.
  assert.equal(typeof Easings.linear, 'function');
  assert.equal(typeof Easings.easeInOutCubic, 'function');
});

test('audio-mixer: fadeBus negative target clamps to 0', () => {
  const bus = makeBus();
  bus.setBusGain('sfx', 1);
  const mixer = AudioMixer.create({ bus });
  mixer.fadeBus('sfx', -0.5, { durationMs: 0 });
  assert.equal(mixer.getBusTarget('sfx'), 0);
});

test('audio-mixer: snapshot captures a target that mutates after capture', () => {
  const bus = makeBus();
  bus.setBusGain('sfx', 0.7);
  const mixer = AudioMixer.create({ bus });
  mixer.snapshot('original');
  mixer.fadeBus('sfx', 0.1, { durationMs: 0 });
  // Snapshot remembers the original, not the mutated state.
  mixer.restore('original');
  assert.ok(Math.abs(busGainValue(bus, 'sfx') - 0.7) < 1e-9);
});

test('audio-mixer: a release after attack still ramps multiplier back to 1', () => {
  const bus = makeBus();
  bus.setBusGain('music', 1);
  const mixer = AudioMixer.create({ bus });
  mixer.pushDuck('voice', 'music', { scalar: 0.2, attackMs: 50, releaseMs: 50 });
  // Run attack to completion.
  mixer.tick(50);
  assert.ok(Math.abs(busGainValue(bus, 'music') - 0.2) < 1e-9);
  // Release.
  mixer.releaseDuck('voice');
  mixer.tick(25);
  // Release midpoint linear: 0.2 + (1-0.2)*0.5 = 0.6.
  assert.ok(Math.abs(busGainValue(bus, 'music') - 0.6) < 1e-9);
  mixer.tick(25);
  assert.equal(mixer.hasDuck('voice'), false);
  assert.equal(busGainValue(bus, 'music'), 1);
});

test('audio-mixer: AudioBus.listBuses returns the default 4 names', () => {
  const bus = makeBus();
  const names = bus.listBuses();
  assert.deepEqual([...names].sort(), ['music', 'sfx', 'ui', 'voice']);
});
