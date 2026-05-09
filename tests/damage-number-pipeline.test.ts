// Phase 0.72.0 - DamageNumberPipeline tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  DamageNumberPipeline,
  RESOURCE_DAMAGE_NUMBER_PIPELINE,
  type AttackerStats,
  type DefenderStats,
  type DamageResult,
  type FloatingTextSpawn,
} from '../src/index.js';

// Capture spawns into a recording emitter so we can assert each one.
interface Recorder {
  spawns: FloatingTextSpawn[];
  emit: (s: FloatingTextSpawn) => number;
}

function makeRecorder(returnIndex: number = 1): Recorder {
  var spawns: FloatingTextSpawn[] = [];
  return {
    spawns: spawns,
    emit: (s: FloatingTextSpawn) => {
      spawns.push(s);
      return returnIndex;
    },
  };
}

const baseAtk: AttackerStats = { attackPower: 100 };
const baseDef: DefenderStats = { armor: 0 };

test('damage-number-pipeline: RESOURCE_DAMAGE_NUMBER_PIPELINE is the stable string', () => {
  assert.equal(RESOURCE_DAMAGE_NUMBER_PIPELINE, 'damage_number_pipeline');
});

test('damage-number-pipeline: publish computes damage and emits floating text', () => {
  const rec = makeRecorder();
  const pipeline = DamageNumberPipeline.create({ floatingText: rec });
  // Deterministic compute via opts.rng (no crit).
  const result = pipeline.publish(baseAtk, baseDef, 50, 30, { rng: () => 0.99 });
  assert.equal(rec.spawns.length, 1);
  assert.equal(rec.spawns[0]!.x, 50);
  assert.equal(rec.spawns[0]!.y, 30);
  assert.equal(rec.spawns[0]!.text, String(Math.round(result.final)));
  assert.equal(rec.spawns[0]!.color, 0xffffff);
  assert.equal(rec.spawns[0]!.scale, 1);
});

test('damage-number-pipeline: crit hit uses critColor + critScale + suffix', () => {
  const rec = makeRecorder();
  const pipeline = DamageNumberPipeline.create({ floatingText: rec });
  const atk: AttackerStats = { attackPower: 100, critChance: 1, critMultiplier: 2 };
  pipeline.publish(atk, baseDef, 0, 0, { rng: () => 0 }); // forced crit
  const s = rec.spawns[0]!;
  assert.equal(s.color, 0xffd560);
  assert.equal(s.scale, 1.4);
  assert.ok(s.text.endsWith('!'));
  // The pre-suffix portion is an integer string.
  assert.ok(/^\d+!$/.test(s.text!), 'crit text should match /^\\d+!$/, got ' + s.text);
});

test('damage-number-pipeline: blocked hit uses blockedColor when final <= blockedAtOrBelow', () => {
  const rec = makeRecorder();
  const pipeline = DamageNumberPipeline.create({
    floatingText: rec,
    blockedAtOrBelow: 1, // 1-damage hits show as blocked
  });
  // attackPower 1 + huge armor + minDamage 1 = final = 1
  const atk: AttackerStats = { attackPower: 1 };
  const def: DefenderStats = { armor: 1_000_000 };
  pipeline.publish(atk, def, 0, 0, { rng: () => 0.99, minDamage: 1 });
  assert.equal(rec.spawns[0]!.color, 0x808080);
});

test('damage-number-pipeline: publishResult skips compute step', () => {
  let computed = 0;
  const rec = makeRecorder();
  const pipeline = DamageNumberPipeline.create({
    floatingText: rec,
    compute: () => {
      computed++;
      return { final: 0, raw: 0, mitigated: 0, isCrit: false, mitigationPct: 0, varianceRoll: 0 };
    },
  });
  const fakeResult: DamageResult = {
    final: 25,
    raw: 25,
    mitigated: 25,
    isCrit: false,
    mitigationPct: 0,
    varianceRoll: 0,
  };
  pipeline.publishResult(fakeResult, 10, 20);
  assert.equal(computed, 0); // compute was NOT called
  assert.equal(rec.spawns.length, 1);
  assert.equal(rec.spawns[0]!.text, '25');
});

test('damage-number-pipeline: custom compute override is used', () => {
  let calls = 0;
  const rec = makeRecorder();
  const pipeline = DamageNumberPipeline.create({
    floatingText: rec,
    compute: () => {
      calls++;
      return { final: 999, raw: 999, mitigated: 999, isCrit: true, mitigationPct: 0, varianceRoll: 0 };
    },
  });
  const r = pipeline.publish(baseAtk, baseDef, 0, 0);
  assert.equal(calls, 1);
  assert.equal(r.final, 999);
  assert.equal(rec.spawns[0]!.text, '999!');
});

test('damage-number-pipeline: custom formatText override is used', () => {
  const rec = makeRecorder();
  const pipeline = DamageNumberPipeline.create({
    floatingText: rec,
    formatText: (r) => 'DMG=' + r.final.toFixed(1),
  });
  pipeline.publishResult({
    final: 12.345, raw: 12, mitigated: 12, isCrit: false, mitigationPct: 0, varianceRoll: 0,
  }, 0, 0);
  assert.equal(rec.spawns[0]!.text, 'DMG=12.3');
});

test('damage-number-pipeline: setStyle updates color / scale + propagates to default formatText critSuffix', () => {
  const rec = makeRecorder();
  const pipeline = DamageNumberPipeline.create({ floatingText: rec });
  pipeline.setStyle({ critColor: 0xff0000, critScale: 2, critSuffix: '!!!' });
  pipeline.publishResult({
    final: 50, raw: 50, mitigated: 50, isCrit: true, mitigationPct: 0, varianceRoll: 0,
  }, 0, 0);
  const s = rec.spawns[0]!;
  assert.equal(s.color, 0xff0000);
  assert.equal(s.scale, 2);
  assert.equal(s.text, '50!!!');
});

test('damage-number-pipeline: setStyle does not clobber a user-provided formatText', () => {
  const rec = makeRecorder();
  const pipeline = DamageNumberPipeline.create({
    floatingText: rec,
    formatText: () => 'CUSTOM',
  });
  pipeline.setStyle({ critSuffix: '###' });
  pipeline.publishResult({
    final: 10, raw: 10, mitigated: 10, isCrit: true, mitigationPct: 0, varianceRoll: 0,
  }, 0, 0);
  // User formatText still active despite critSuffix update.
  assert.equal(rec.spawns[0]!.text, 'CUSTOM');
});

test('damage-number-pipeline: getStyle returns defensive copy', () => {
  const rec = makeRecorder();
  const pipeline = DamageNumberPipeline.create({
    floatingText: rec,
    style: { normalColor: 0x111111, critColor: 0x222222 },
  });
  const a = pipeline.getStyle();
  a.normalColor = 0xdeadbe;
  const b = pipeline.getStyle();
  assert.equal(b.normalColor, 0x111111);
});

test('damage-number-pipeline: partial style overrides only specified fields', () => {
  const rec = makeRecorder();
  const pipeline = DamageNumberPipeline.create({
    floatingText: rec,
    style: { critColor: 0xabcdef },
  });
  const s = pipeline.getStyle();
  assert.equal(s.critColor, 0xabcdef);
  // Defaults intact for the others.
  assert.equal(s.normalColor, 0xffffff);
  assert.equal(s.blockedColor, 0x808080);
  assert.equal(s.normalScale, 1);
  assert.equal(s.critScale, 1.4);
  assert.equal(s.critSuffix, '!');
});

test('damage-number-pipeline: pool full (emit returns -1) does not throw; result still returned', () => {
  const fullPool = {
    spawns: [] as FloatingTextSpawn[],
    emit: (s: FloatingTextSpawn) => { fullPool.spawns.push(s); return -1; },
  };
  const pipeline = DamageNumberPipeline.create({ floatingText: fullPool });
  const r = pipeline.publish(baseAtk, baseDef, 5, 5, { rng: () => 0.99 });
  // Spawn was attempted (we still recorded); emit returned -1 but
  // pipeline didn't throw and returned the result.
  assert.ok(r.final > 0);
  assert.equal(fullPool.spawns.length, 1);
});

test('damage-number-pipeline: lifetime style override propagated to spawn', () => {
  const rec = makeRecorder();
  const pipeline = DamageNumberPipeline.create({
    floatingText: rec,
    style: { lifetimeMs: 1500 },
  });
  pipeline.publishResult({
    final: 10, raw: 10, mitigated: 10, isCrit: false, mitigationPct: 0, varianceRoll: 0,
  }, 0, 0);
  assert.equal(rec.spawns[0]!.lifetimeMs, 1500);
});

test('damage-number-pipeline: lifetime undefined leaves spawn.lifetimeMs absent', () => {
  const rec = makeRecorder();
  const pipeline = DamageNumberPipeline.create({ floatingText: rec });
  pipeline.publishResult({
    final: 10, raw: 10, mitigated: 10, isCrit: false, mitigationPct: 0, varianceRoll: 0,
  }, 0, 0);
  assert.equal(rec.spawns[0]!.lifetimeMs, undefined);
});

test('damage-number-pipeline: dispose locks publish (no spawn)', () => {
  const rec = makeRecorder();
  const pipeline = DamageNumberPipeline.create({ floatingText: rec });
  pipeline.dispose();
  const r = pipeline.publish(baseAtk, baseDef, 0, 0, { rng: () => 0.99 });
  // compute still ran (publish returned a result), but spawn was skipped.
  assert.ok(r.final > 0);
  assert.equal(rec.spawns.length, 0);
});

test('damage-number-pipeline: dispose locks publishResult', () => {
  const rec = makeRecorder();
  const pipeline = DamageNumberPipeline.create({ floatingText: rec });
  pipeline.dispose();
  pipeline.publishResult({
    final: 10, raw: 10, mitigated: 10, isCrit: false, mitigationPct: 0, varianceRoll: 0,
  }, 0, 0);
  assert.equal(rec.spawns.length, 0);
});

test('damage-number-pipeline: dispose locks setStyle', () => {
  const rec = makeRecorder();
  const pipeline = DamageNumberPipeline.create({ floatingText: rec });
  const before = pipeline.getStyle();
  pipeline.dispose();
  pipeline.setStyle({ normalColor: 0xdeadbe });
  const after = pipeline.getStyle();
  assert.equal(after.normalColor, before.normalColor);
});

test('damage-number-pipeline: text formatter rounds DamageResult.final to integer by default', () => {
  const rec = makeRecorder();
  const pipeline = DamageNumberPipeline.create({ floatingText: rec });
  pipeline.publishResult({
    final: 17.6, raw: 17.6, mitigated: 17.6, isCrit: false, mitigationPct: 0, varianceRoll: 0,
  }, 0, 0);
  assert.equal(rec.spawns[0]!.text, '18');
});

test('damage-number-pipeline: realistic miss / hit / crit / block flow', () => {
  const rec = makeRecorder();
  const pipeline = DamageNumberPipeline.create({
    floatingText: rec,
    blockedAtOrBelow: 1,
  });
  // 1: normal hit.
  pipeline.publishResult({
    final: 25, raw: 25, mitigated: 25, isCrit: false, mitigationPct: 0, varianceRoll: 0,
  }, 0, 0);
  // 2: crit.
  pipeline.publishResult({
    final: 99, raw: 99, mitigated: 99, isCrit: true, mitigationPct: 0, varianceRoll: 0,
  }, 0, 0);
  // 3: blocked.
  pipeline.publishResult({
    final: 1, raw: 50, mitigated: 1, isCrit: false, mitigationPct: 0.98, varianceRoll: 0,
  }, 0, 0);
  assert.equal(rec.spawns.length, 3);
  assert.equal(rec.spawns[0]!.color, 0xffffff); // normal
  assert.equal(rec.spawns[1]!.color, 0xffd560); // crit
  assert.equal(rec.spawns[2]!.color, 0x808080); // blocked
  assert.equal(rec.spawns[0]!.text, '25');
  assert.equal(rec.spawns[1]!.text, '99!');
  assert.equal(rec.spawns[2]!.text, '1');
});

test('damage-number-pipeline: blockedAtOrBelow defaults to 0 (1-damage hits show as normal)', () => {
  const rec = makeRecorder();
  const pipeline = DamageNumberPipeline.create({ floatingText: rec });
  pipeline.publishResult({
    final: 1, raw: 50, mitigated: 1, isCrit: false, mitigationPct: 0.98, varianceRoll: 0,
  }, 0, 0);
  // 1 > 0 = use normalColor.
  assert.equal(rec.spawns[0]!.color, 0xffffff);
});
