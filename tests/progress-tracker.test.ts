// Phase 1.5.4 - ProgressTracker tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  ProgressTracker,
  RESOURCE_PROGRESS_TRACKER,
} from '../src/index.js';

const DAY_MS = 86400000;

test('pt: RESOURCE_PROGRESS_TRACKER is the stable string', () => {
  assert.equal(RESOURCE_PROGRESS_TRACKER, 'progress_tracker');
});

test('pt: starts empty', () => {
  const pt = ProgressTracker.create();
  assert.equal(pt.count(), 0);
});

test('pt: defineSkill + hasSkill + getSkill', () => {
  const pt = ProgressTracker.create();
  pt.defineSkill({ id: 's1', name: 'Algebra' });
  assert.equal(pt.hasSkill('s1'), true);
  const skill = pt.getSkill('s1');
  assert.equal(skill!.name, 'Algebra');
  assert.equal(skill!.overallMastery, 0);
});

test('pt: defineSkill rejects empty id / non-string name', () => {
  const pt = ProgressTracker.create();
  assert.equal(pt.defineSkill({ id: '', name: 'a' }), false);
  // @ts-expect-error
  assert.equal(pt.defineSkill({ id: 's', name: null }), false);
});

test('pt: removeSkill drops it', () => {
  const pt = ProgressTracker.create();
  pt.defineSkill({ id: 's1', name: 'a' });
  assert.equal(pt.removeSkill('s1'), true);
  assert.equal(pt.hasSkill('s1'), false);
});

test('pt: recordEvidence updates level via EMA', () => {
  const pt = ProgressTracker.create();
  pt.defineSkill({ id: 's1', name: 'a' });
  pt.recordEvidence('s1', 'remember', 1.0, 1000);
  // First evidence with score 1.0: alpha=0.3, so level moves from 0 → 0.3.
  const skill = pt.getSkill('s1');
  assert.ok(Math.abs(skill!.levels.remember - 0.3) < 0.01);
  assert.equal(skill!.evidenceCount, 1);
  assert.equal(skill!.lastEvidenceAt, 1000);
});

test('pt: multiple evidence smooths toward target', () => {
  const pt = ProgressTracker.create();
  pt.defineSkill({ id: 's1', name: 'a' });
  for (let i = 0; i < 10; i++) {
    pt.recordEvidence('s1', 'remember', 1.0, i * 1000);
  }
  // After many 1.0 scores, level should approach 1.0.
  const skill = pt.getSkill('s1');
  assert.ok(skill!.levels.remember > 0.95);
});

test('pt: invalid level rejected', () => {
  const pt = ProgressTracker.create();
  pt.defineSkill({ id: 's1', name: 'a' });
  // @ts-expect-error
  assert.equal(pt.recordEvidence('s1', 'invalid', 1.0, 0), null);
});

test('pt: invalid score rejected', () => {
  const pt = ProgressTracker.create();
  pt.defineSkill({ id: 's1', name: 'a' });
  assert.equal(pt.recordEvidence('s1', 'remember', NaN, 0), null);
});

test('pt: score clamped to [0, 1]', () => {
  const pt = ProgressTracker.create();
  pt.defineSkill({ id: 's1', name: 'a' });
  pt.recordEvidence('s1', 'remember', 5, 0);
  // 5 clamps to 1; first event moves level by 0.3.
  const skill = pt.getSkill('s1');
  assert.ok(Math.abs(skill!.levels.remember - 0.3) < 0.01);
});

test('pt: overallMastery weights higher Bloom levels more', () => {
  const pt = ProgressTracker.create();
  pt.defineSkill({ id: 's1', name: 'a' });
  // Same EMA-pushed value across two levels.
  for (let i = 0; i < 20; i++) {
    pt.recordEvidence('s1', 'remember', 1.0, i * 1000);
    pt.recordEvidence('s1', 'create', 1.0, i * 1000);
  }
  const skill = pt.getSkill('s1');
  // Both are ~1; overall should also be ~1.
  assert.ok(skill!.overallMastery > 0.95);
});

test('pt: overallMastery is weighted average of levels', () => {
  const pt = ProgressTracker.create();
  pt.defineSkill({
    id: 's1', name: 'a',
    levelWeights: { remember: 1, understand: 0, apply: 0, analyze: 0, evaluate: 0, create: 0 },
  });
  // Drive remember to high; others stay 0.
  for (let i = 0; i < 20; i++) {
    pt.recordEvidence('s1', 'remember', 1.0, i * 1000);
  }
  const skill = pt.getSkill('s1');
  // With only remember weighted, overall = remember level.
  assert.ok(Math.abs(skill!.overallMastery - skill!.levels.remember) < 0.01);
});

test('pt: tick decays mastery for skills with decay > 0', () => {
  let now = 0;
  const pt = ProgressTracker.create({ now: () => now });
  pt.defineSkill({ id: 's1', name: 'a', decayPerDay: 0.5 }); // 50% per day
  // Drive mastery up.
  for (let i = 0; i < 30; i++) {
    pt.recordEvidence('s1', 'remember', 1.0, now);
  }
  const beforeDecay = pt.getSkill('s1')!.levels.remember;
  // Initial tick to set lastTickAt.
  pt.tick();
  // Advance 1 day.
  now = DAY_MS;
  pt.tick();
  const afterDecay = pt.getSkill('s1')!.levels.remember;
  // Should be roughly half.
  assert.ok(afterDecay < beforeDecay);
  assert.ok(Math.abs(afterDecay - beforeDecay * 0.5) < 0.05);
});

test('pt: tick with decayPerDay=0 no decay', () => {
  let now = 0;
  const pt = ProgressTracker.create({ now: () => now });
  pt.defineSkill({ id: 's1', name: 'a', decayPerDay: 0 });
  for (let i = 0; i < 20; i++) pt.recordEvidence('s1', 'remember', 1.0, now);
  const before = pt.getSkill('s1')!.levels.remember;
  pt.tick();
  now = 30 * DAY_MS;
  pt.tick();
  const after = pt.getSkill('s1')!.levels.remember;
  assert.equal(before, after);
});

test('pt: highMastery filters by threshold', () => {
  const pt = ProgressTracker.create();
  pt.defineSkill({ id: 'a', name: 'A' });
  pt.defineSkill({ id: 'b', name: 'B' });
  for (let i = 0; i < 30; i++) pt.recordEvidence('a', 'apply', 1.0, i);
  // 'b' stays at 0.
  const high = pt.highMastery(0.5);
  assert.equal(high.length, 1);
  assert.equal(high[0]!.id, 'a');
});

test('pt: lowMastery filters by threshold', () => {
  const pt = ProgressTracker.create();
  pt.defineSkill({ id: 'a', name: 'A' });
  pt.defineSkill({ id: 'b', name: 'B' });
  for (let i = 0; i < 30; i++) pt.recordEvidence('a', 'apply', 1.0, i);
  const low = pt.lowMastery(0.5);
  assert.equal(low.length, 1);
  assert.equal(low[0]!.id, 'b');
});

test('pt: resetSkill returns to zero', () => {
  const pt = ProgressTracker.create();
  pt.defineSkill({ id: 's1', name: 'a' });
  for (let i = 0; i < 20; i++) pt.recordEvidence('s1', 'apply', 1.0, i);
  pt.resetSkill('s1');
  const skill = pt.getSkill('s1');
  assert.equal(skill!.overallMastery, 0);
  assert.equal(skill!.evidenceCount, 0);
});

test('pt: list returns all skills', () => {
  const pt = ProgressTracker.create();
  pt.defineSkill({ id: 'a', name: 'A' });
  pt.defineSkill({ id: 'b', name: 'B' });
  assert.equal(pt.list().length, 2);
});

test('pt: clear empties + dispose locks', () => {
  const pt = ProgressTracker.create();
  pt.defineSkill({ id: 'a', name: 'A' });
  pt.clear();
  assert.equal(pt.count(), 0);
  pt.dispose();
  assert.equal(pt.defineSkill({ id: 'b', name: 'B' }), false);
});

test('pt: realistic example - adaptive content gating', () => {
  let now = 0;
  const pt = ProgressTracker.create({ now: () => now });
  pt.defineSkill({ id: 'arithmetic_basic', name: 'Basic Arithmetic' });
  pt.defineSkill({ id: 'arithmetic_advanced', name: 'Advanced Arithmetic' });

  // Student practices basic arithmetic.
  for (let i = 0; i < 20; i++) {
    now += 1000;
    pt.recordEvidence('arithmetic_basic', 'remember', 0.8, now);
    pt.recordEvidence('arithmetic_basic', 'apply', 0.7, now);
  }
  // Check mastery for unlocking next topic.
  const basic = pt.getSkill('arithmetic_basic');
  assert.ok(basic!.overallMastery > 0.3);
  // Advanced still locked (no evidence).
  const advanced = pt.getSkill('arithmetic_advanced');
  assert.equal(advanced!.overallMastery, 0);
});
