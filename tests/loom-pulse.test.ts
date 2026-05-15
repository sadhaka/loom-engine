// LoomPulse - Trinity §19 player-vibe inference tests.
//
// Covers: constructor validation (the hysteresis-band check
// deact < activ), every Codex gate (consent kill switch with
// pending-clear, no permanent-reputation surface, EMA + confidence
// decay + hysteresis, double-buffered swap, corroboration-required
// reputation read, audit ring for bias analysis, atmosphere clamp),
// and bit-for-bit determinism across two independent runs.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  LoomPulse,
  PULSE_FP_ONE,
  AUDIT_RECORD_STRIDE,
} from '../src/runtime/loom-pulse.js';

function defaultConfig() {
  return {
    maxVibes: 8,
    smoothing: Math.floor(0.9 * PULSE_FP_ONE),
    valueDecayPerTick: Math.floor(0.01 * PULSE_FP_ONE),
    confidenceDecayPerTick: Math.floor(0.005 * PULSE_FP_ONE),
    confidenceGainPerSignal: Math.floor(0.1 * PULSE_FP_ONE),
    activationThreshold: Math.floor(0.6 * PULSE_FP_ONE),
    deactivationThreshold: Math.floor(0.4 * PULSE_FP_ONE),
    maxAtmosphereImpact: Math.floor(0.5 * PULSE_FP_ONE),
    auditRingSize: 16,
  };
}

test('LoomPulse: constructor rejects out-of-range maxVibes', () => {
  assert.throws(() => new LoomPulse({ ...defaultConfig(), maxVibes: 0 }), RangeError);
  assert.throws(() => new LoomPulse({ ...defaultConfig(), maxVibes: 1 << 20 }), RangeError);
});

test('LoomPulse: constructor rejects deact >= activ (hysteresis band must exist - gate 3)', () => {
  assert.throws(() => new LoomPulse({
    ...defaultConfig(),
    activationThreshold: 100,
    deactivationThreshold: 100,
  }), RangeError);
  assert.throws(() => new LoomPulse({
    ...defaultConfig(),
    activationThreshold: 50,
    deactivationThreshold: 100,
  }), RangeError);
});

test('LoomPulse: constructor rejects out-of-range smoothing/decay/threshold', () => {
  assert.throws(() => new LoomPulse({ ...defaultConfig(), smoothing: -1 }), RangeError);
  assert.throws(() => new LoomPulse({ ...defaultConfig(), smoothing: PULSE_FP_ONE + 1 }), RangeError);
  assert.throws(() => new LoomPulse({ ...defaultConfig(), valueDecayPerTick: -1 }), RangeError);
  assert.throws(() => new LoomPulse({ ...defaultConfig(), maxAtmosphereImpact: -1 }), RangeError);
  assert.throws(() => new LoomPulse({ ...defaultConfig(), auditRingSize: 0 }), RangeError);
});

test('LoomPulse: default consent is FALSE - injectSignal silently dropped (gate 1)', () => {
  const p = new LoomPulse(defaultConfig());
  assert.equal(p.isPlayerConsentEnabled(), false);
  p.injectSignal(0, PULSE_FP_ONE);
  p.tick(1);
  assert.equal(p.getEffectiveVibe(0), 0);    // signal silently dropped
  assert.equal(p.getSampleCount(0), 0);
});

test('LoomPulse: setPlayerConsent(true) enables signal accumulation (gate 1)', () => {
  const p = new LoomPulse(defaultConfig());
  p.setPlayerConsent(true);
  p.injectSignal(0, PULSE_FP_ONE);
  p.tick(1);
  // EMA: back = (0 * 0.9 + FP_ONE * 0.1) / 1 ≈ 0.1 * FP_ONE.
  // Confidence after one signal at 0.1 gain ≈ 0.1 * FP_ONE.
  // Effective = 0.1 * 0.1 = 0.01 * FP_ONE ≈ 655.
  const eff = p.getEffectiveVibe(0);
  assert.ok(eff > 0 && eff < PULSE_FP_ONE * 0.1, 'effective should be small early, got ' + eff);
});

test('LoomPulse: confidence accumulates with repeated signals; effective rises (gate 3)', () => {
  const p = new LoomPulse(defaultConfig());
  p.setPlayerConsent(true);
  let prev = 0;
  for (let i = 0; i < 30; i++) {
    p.injectSignal(0, PULSE_FP_ONE);
    p.tick(i + 1);
    const cur = p.getEffectiveVibe(0);
    assert.ok(cur >= prev - 100, 'effective should rise (modulo small decay), got ' + cur + ' from ' + prev);
    prev = cur;
  }
  // After many high signals, effective should be near max.
  assert.ok(prev > PULSE_FP_ONE / 2, 'effective should saturate, got ' + prev);
});

test('LoomPulse: hysteresis - active flag only flips at activation, only un-flips at deactivation (gate 3)', () => {
  const p = new LoomPulse({
    ...defaultConfig(),
    smoothing: 0,                                // no smoothing - direct pass-through
    confidenceGainPerSignal: PULSE_FP_ONE,        // full confidence on first signal
    activationThreshold: Math.floor(0.7 * PULSE_FP_ONE),
    deactivationThreshold: Math.floor(0.3 * PULSE_FP_ONE),
    valueDecayPerTick: 0,
    confidenceDecayPerTick: 0,
  });
  p.setPlayerConsent(true);
  // Signal at 0.5 - between deact and activ, should NOT activate.
  p.injectSignal(0, Math.floor(0.5 * PULSE_FP_ONE));
  p.tick(1);
  assert.equal(p.getActiveFlag(0), false);
  // Signal at 0.8 - above activation, should activate.
  p.injectSignal(0, Math.floor(0.8 * PULSE_FP_ONE));
  p.tick(2);
  assert.equal(p.getActiveFlag(0), true);
  // Signal back at 0.5 - between thresholds, should STAY active.
  p.injectSignal(0, Math.floor(0.5 * PULSE_FP_ONE));
  p.tick(3);
  assert.equal(p.getActiveFlag(0), true);
  // Signal at 0.2 - below deactivation, should deactivate.
  p.injectSignal(0, Math.floor(0.2 * PULSE_FP_ONE));
  p.tick(4);
  assert.equal(p.getActiveFlag(0), false);
});

test('LoomPulse: tick decays vibeValue + confidence (gate 3)', () => {
  const p = new LoomPulse({
    ...defaultConfig(),
    smoothing: 0,
    confidenceGainPerSignal: PULSE_FP_ONE,
    valueDecayPerTick: Math.floor(0.5 * PULSE_FP_ONE),
    confidenceDecayPerTick: Math.floor(0.5 * PULSE_FP_ONE),
  });
  p.setPlayerConsent(true);
  p.injectSignal(0, PULSE_FP_ONE);
  p.tick(1);
  const e1 = p.getEffectiveVibe(0);
  assert.ok(e1 > 0, 'first tick effective should be high');
  p.tick(2);                                       // no signal, just decay
  const e2 = p.getEffectiveVibe(0);
  assert.ok(e2 < e1, 'effective should decay, got ' + e2 + ' < ' + e1);
  p.tick(3); p.tick(4); p.tick(5);
  const e5 = p.getEffectiveVibe(0);
  assert.ok(e5 < e2 / 2, 'effective should keep decaying, got ' + e5);
});

test('LoomPulse: front/back double buffer - read-during-write race-safe (gate 4)', () => {
  const p = new LoomPulse(defaultConfig());
  p.setPlayerConsent(true);
  // Inject before tick - back filled but front not yet swapped.
  p.injectSignal(0, PULSE_FP_ONE);
  assert.equal(p.getEffectiveVibe(0), 0);          // front still 0
  p.tick(1);
  // Now front carries the swapped value.
  assert.ok(p.getEffectiveVibe(0) > 0, 'front should hold swapped value');
});

test('LoomPulse: setPlayerConsent(false) zeroes back state at next tick (gate 1)', () => {
  const p = new LoomPulse(defaultConfig());
  p.setPlayerConsent(true);
  for (let i = 0; i < 10; i++) {
    p.injectSignal(0, PULSE_FP_ONE);
    p.tick(i + 1);
  }
  assert.ok(p.getEffectiveVibe(0) > 0);
  p.setPlayerConsent(false);
  p.tick(11);                                      // pending consent-clear fires
  assert.equal(p.getEffectiveVibe(0), 0);
  assert.equal(p.getActiveFlag(0), false);
});

test('LoomPulse: getCorroboratedVibe returns 0 below corroboration threshold (gate 2)', () => {
  const p = new LoomPulse(defaultConfig());
  p.setPlayerConsent(true);
  for (let i = 0; i < 10; i++) {
    p.injectSignal(0, PULSE_FP_ONE);
    p.tick(i + 1);
  }
  // No corroboration -> reputation read is 0.
  assert.equal(p.getCorroboratedVibe(0, Math.floor(0.5 * PULSE_FP_ONE)), 0);
  // Add corroboration above threshold -> reputation read is the effective vibe.
  p.corroborateWithGameplay(0, Math.floor(0.6 * PULSE_FP_ONE));
  // Note: corroboration is decayed by valueDecayPerTick AT THE NEXT
  // tick(), so the reading right now (before another tick) is fresh.
  const corroborated = p.getCorroboratedVibe(0, Math.floor(0.5 * PULSE_FP_ONE));
  assert.ok(corroborated > 0, 'corroborated read should be > 0 above threshold');
});

test('LoomPulse: NO direct reputation API exists (gate 2 - structural)', () => {
  const p = new LoomPulse(defaultConfig());
  // Surface check: the kernel exposes only consumer reads (effective /
  // active / corroborated) and producer writes (signal / corroborate).
  // No "writeReputation" / "applyToPermanentState" / "setReputation"
  // method exists. A regression that added one would be visible here.
  const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(p));
  for (const name of proto) {
    assert.equal(/^writeReputation|^applyToPermanent|^setReputation/.test(name), false,
      'forbidden permanent-reputation API found: ' + name);
  }
});

test('LoomPulse: clampAtmosphereImpact caps at maxAtmosphereImpact (gate 7)', () => {
  const p = new LoomPulse({ ...defaultConfig(), maxAtmosphereImpact: 1000 });
  assert.equal(p.clampAtmosphereImpact(500), 500);
  assert.equal(p.clampAtmosphereImpact(2000), 1000);    // capped
  assert.equal(p.clampAtmosphereImpact(0), 0);
  assert.equal(p.clampAtmosphereImpact(-100), 0);       // negative -> 0
});

test('LoomPulse: audit ring records last N raw signals (gate 6)', () => {
  const p = new LoomPulse({ ...defaultConfig(), auditRingSize: 4 });
  p.setPlayerConsent(true);
  for (let i = 0; i < 6; i++) {
    p.injectSignal(0, (i + 1) * 1000);
    p.tick(i + 1);
  }
  assert.equal(p.getSampleCount(0), 6);
  assert.equal(p.getAuditRingCount(0), 4);          // capped at ring size
  // The most recent sample should be intensity=6000 at tick=6.
  // Wait - tick advances AFTER the inject; the injected sample
  // recorded with the tick at injection time. The first inject is
  // at tick=0 (constructor default), so tick column is 0. Let's
  // just check the most recent intensity.
  const out = new Int32Array(AUDIT_RECORD_STRIDE);
  assert.equal(p.readAuditSample(0, 0, out), true);
  assert.equal(out[1], 6000);                       // most recent intensity
  // Read the 3 next-newest as 5000, 4000, 3000.
  p.readAuditSample(0, 1, out); assert.equal(out[1], 5000);
  p.readAuditSample(0, 2, out); assert.equal(out[1], 4000);
  p.readAuditSample(0, 3, out); assert.equal(out[1], 3000);
  // Out-of-range index.
  assert.equal(p.readAuditSample(0, 4, out), false);
});

test('LoomPulse: signals to invalid vibeId are rejected', () => {
  const p = new LoomPulse(defaultConfig());
  p.setPlayerConsent(true);
  assert.equal(p.injectSignal(-1, PULSE_FP_ONE), false);
  assert.equal(p.injectSignal(8, PULSE_FP_ONE), false);   // == maxVibes
  assert.equal(p.injectSignal(1.5, PULSE_FP_ONE), false);
});

test('LoomPulse: signals with invalid intensity are rejected', () => {
  const p = new LoomPulse(defaultConfig());
  p.setPlayerConsent(true);
  assert.equal(p.injectSignal(0, -1), false);
  assert.equal(p.injectSignal(0, PULSE_FP_ONE + 1), false);
  assert.equal(p.injectSignal(0, 1.5), false);
});

test('LoomPulse: corroborateWithGameplay no-ops when consent denied (gate 1, 2)', () => {
  const p = new LoomPulse(defaultConfig());
  // Consent default false.
  p.corroborateWithGameplay(0, PULSE_FP_ONE);
  // Even if we then enable consent, the corroboration was dropped.
  p.setPlayerConsent(true);
  p.injectSignal(0, PULSE_FP_ONE);
  p.tick(1);
  assert.equal(p.getCorroboratedVibe(0, 1), 0);    // no corroboration -> 0
});

test('LoomPulse: deterministic across two independent runs (bit-for-bit)', () => {
  function run(): number[] {
    const p = new LoomPulse(defaultConfig());
    p.setPlayerConsent(true);
    const out: number[] = [];
    for (let i = 0; i < 20; i++) {
      const intensity = ((i * 13) % PULSE_FP_ONE) | 0;
      p.injectSignal(i % 8, intensity);
      p.tick(i + 1);
      out.push(p.getEffectiveVibe(i % 8));
    }
    return out;
  }
  assert.deepEqual(run(), run());
});

test('LoomPulse: tick rejects out-of-range t', () => {
  const p = new LoomPulse(defaultConfig());
  assert.throws(() => p.tick(-1), RangeError);
  assert.throws(() => p.tick(1.5), RangeError);
  assert.throws(() => p.tick(0x100000000), RangeError);
});

test('LoomPulse: clear() resets every vibe / confidence / corroboration / audit ring', () => {
  const p = new LoomPulse(defaultConfig());
  p.setPlayerConsent(true);
  p.injectSignal(0, PULSE_FP_ONE);
  p.corroborateWithGameplay(0, PULSE_FP_ONE);
  p.tick(1);
  p.clear();
  assert.equal(p.getEffectiveVibe(0), 0);
  assert.equal(p.getCorroboratedVibe(0, 0), 0);
  assert.equal(p.getActiveFlag(0), false);
  assert.equal(p.getSampleCount(0), 0);
  assert.equal(p.getAuditRingCount(0), 0);
});

test('LoomPulse: getEffectiveVibe returns 0 for invalid vibeId', () => {
  const p = new LoomPulse(defaultConfig());
  assert.equal(p.getEffectiveVibe(-1), 0);
  assert.equal(p.getEffectiveVibe(99), 0);
  assert.equal(p.getActiveFlag(-1), false);
});

test('LoomPulse: corroboration decays each tick (gate 2 freshness)', () => {
  const p = new LoomPulse({
    ...defaultConfig(),
    valueDecayPerTick: Math.floor(0.5 * PULSE_FP_ONE),     // strong decay
  });
  p.setPlayerConsent(true);
  p.injectSignal(0, PULSE_FP_ONE);
  p.corroborateWithGameplay(0, PULSE_FP_ONE);
  // Tick once - corroboration decays by 50%; vibe value too.
  p.tick(1);
  const c1 = p.getCorroboratedVibe(0, 1);
  // Tick a few more times - corroboration keeps fading.
  for (let i = 2; i < 6; i++) p.tick(i);
  const c5 = p.getCorroboratedVibe(0, 1);
  assert.ok(c5 < c1, 'corroborated read should fade as evidence ages');
});
