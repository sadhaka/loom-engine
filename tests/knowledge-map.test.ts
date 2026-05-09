// Phase 1.5.5 - KnowledgeMap tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  KnowledgeMap,
  ProgressTracker,
  RESOURCE_KNOWLEDGE_MAP,
} from '../src/index.js';

test('km: RESOURCE_KNOWLEDGE_MAP is the stable string', () => {
  assert.equal(RESOURCE_KNOWLEDGE_MAP, 'knowledge_map');
});

test('km: starts empty', () => {
  const km = KnowledgeMap.create();
  assert.equal(km.count(), 0);
  assert.equal(km.list().length, 0);
});

test('km: addTopic + hasTopic + getTopic', () => {
  const km = KnowledgeMap.create();
  assert.equal(km.addTopic({ id: 't1', name: 'Topic 1' }), true);
  assert.equal(km.hasTopic('t1'), true);
  const t = km.getTopic('t1');
  assert.equal(t!.id, 't1');
  assert.equal(t!.name, 'Topic 1');
  assert.equal(t!.prerequisites.length, 0);
});

test('km: addTopic rejects empty id / duplicate / bad name', () => {
  const km = KnowledgeMap.create();
  assert.equal(km.addTopic({ id: '', name: 'a' }), false);
  // @ts-expect-error
  assert.equal(km.addTopic({ id: 't', name: null }), false);
  km.addTopic({ id: 't1', name: 'a' });
  assert.equal(km.addTopic({ id: 't1', name: 'b' }), false);
});

test('km: removeTopic drops it + cleans edges', () => {
  const km = KnowledgeMap.create();
  km.addTopic({ id: 'a', name: 'A' });
  km.addTopic({ id: 'b', name: 'B' });
  km.addPrerequisite('a', 'b');
  assert.equal(km.removeTopic('a'), true);
  assert.equal(km.hasTopic('a'), false);
  // 'b' should no longer have any incoming edges from a.
  assert.equal(km.getTopic('b')!.prerequisites.length, 0);
});

test('km: addPrerequisite directs the edge correctly', () => {
  const km = KnowledgeMap.create();
  km.addTopic({ id: 'a', name: 'A' });
  km.addTopic({ id: 'b', name: 'B' });
  assert.equal(km.addPrerequisite('a', 'b'), true);
  // 'b' has 'a' as a prereq.
  assert.equal(km.prerequisitesOf('b').length, 1);
  assert.equal(km.prerequisitesOf('b')[0]!.prerequisiteId, 'a');
  // 'a' has 'b' as a dependent.
  assert.equal(km.dependentsOf('a').length, 1);
  assert.equal(km.dependentsOf('a')[0], 'b');
});

test('km: addPrerequisite rejects self / missing / duplicate', () => {
  const km = KnowledgeMap.create();
  km.addTopic({ id: 'a', name: 'A' });
  km.addTopic({ id: 'b', name: 'B' });
  assert.equal(km.addPrerequisite('a', 'a'), false, 'self-loop rejected');
  assert.equal(km.addPrerequisite('a', 'missing'), false, 'missing target rejected');
  assert.equal(km.addPrerequisite('missing', 'b'), false, 'missing source rejected');
  km.addPrerequisite('a', 'b');
  assert.equal(km.addPrerequisite('a', 'b'), false, 'duplicate edge rejected');
});

test('km: addPrerequisite rejects cycle', () => {
  const km = KnowledgeMap.create();
  km.addTopic({ id: 'a', name: 'A' });
  km.addTopic({ id: 'b', name: 'B' });
  km.addTopic({ id: 'c', name: 'C' });
  km.addPrerequisite('a', 'b');
  km.addPrerequisite('b', 'c');
  // Adding c -> a would close the cycle.
  assert.equal(km.addPrerequisite('c', 'a'), false);
});

test('km: addPrerequisite custom threshold honored', () => {
  const km = KnowledgeMap.create();
  km.addTopic({ id: 'a', name: 'A' });
  km.addTopic({ id: 'b', name: 'B' });
  km.addPrerequisite('a', 'b', 0.5);
  assert.equal(km.prerequisitesOf('b')[0]!.threshold, 0.5);
});

test('km: default threshold from options', () => {
  const km = KnowledgeMap.create({ minMasteryThreshold: 0.4 });
  km.addTopic({ id: 'a', name: 'A' });
  km.addTopic({ id: 'b', name: 'B' });
  km.addPrerequisite('a', 'b');
  assert.equal(km.prerequisitesOf('b')[0]!.threshold, 0.4);
});

test('km: removePrerequisite drops the edge', () => {
  const km = KnowledgeMap.create();
  km.addTopic({ id: 'a', name: 'A' });
  km.addTopic({ id: 'b', name: 'B' });
  km.addPrerequisite('a', 'b');
  assert.equal(km.removePrerequisite('a', 'b'), true);
  assert.equal(km.prerequisitesOf('b').length, 0);
  assert.equal(km.dependentsOf('a').length, 0);
});

test('km: isUnlocked - no prereqs => unlocked', () => {
  const km = KnowledgeMap.create();
  km.addTopic({ id: 'a', name: 'A' });
  const stub = stubMastery({});
  assert.equal(km.isUnlocked('a', stub), true);
});

test('km: isUnlocked - prereq mastery below threshold => locked', () => {
  const km = KnowledgeMap.create({ minMasteryThreshold: 0.7 });
  km.addTopic({ id: 'a', name: 'A', masterySkillId: 's_a' });
  km.addTopic({ id: 'b', name: 'B' });
  km.addPrerequisite('a', 'b');
  const stub = stubMastery({ s_a: 0.4 });
  assert.equal(km.isUnlocked('b', stub), false);
});

test('km: isUnlocked - prereq mastery at threshold => unlocked', () => {
  const km = KnowledgeMap.create({ minMasteryThreshold: 0.7 });
  km.addTopic({ id: 'a', name: 'A', masterySkillId: 's_a' });
  km.addTopic({ id: 'b', name: 'B' });
  km.addPrerequisite('a', 'b');
  const stub = stubMastery({ s_a: 0.7 });
  assert.equal(km.isUnlocked('b', stub), true);
});

test('km: isUnlocked - missing skill on prereq => locked', () => {
  const km = KnowledgeMap.create();
  km.addTopic({ id: 'a', name: 'A', masterySkillId: 'missing_skill' });
  km.addTopic({ id: 'b', name: 'B' });
  km.addPrerequisite('a', 'b');
  const stub = stubMastery({});
  assert.equal(km.isUnlocked('b', stub), false);
});

test('km: isUnlocked - prereq with no skill linked => locked', () => {
  const km = KnowledgeMap.create();
  km.addTopic({ id: 'a', name: 'A' }); // no masterySkillId
  km.addTopic({ id: 'b', name: 'B' });
  km.addPrerequisite('a', 'b');
  const stub = stubMastery({});
  assert.equal(km.isUnlocked('b', stub), false, 'no skill = mastery 0 = below threshold');
});

test('km: unlocked() returns matching ids', () => {
  const km = KnowledgeMap.create({ minMasteryThreshold: 0.5 });
  km.addTopic({ id: 'a', name: 'A', masterySkillId: 's_a' });
  km.addTopic({ id: 'b', name: 'B' });
  km.addTopic({ id: 'c', name: 'C' });
  km.addPrerequisite('a', 'b');
  km.addPrerequisite('a', 'c');
  const stub = stubMastery({ s_a: 0.6 });
  const u = km.unlocked(stub);
  // a (no prereqs) + b + c are all unlocked
  assert.equal(u.length, 3);
});

test('km: locked() complements unlocked()', () => {
  const km = KnowledgeMap.create({ minMasteryThreshold: 0.5 });
  km.addTopic({ id: 'a', name: 'A', masterySkillId: 's_a' });
  km.addTopic({ id: 'b', name: 'B' });
  km.addPrerequisite('a', 'b');
  const stub = stubMastery({ s_a: 0.2 });
  // a unlocked (no prereqs), b locked (s_a too low)
  assert.deepEqual(km.unlocked(stub).sort(), ['a']);
  assert.deepEqual(km.locked(stub), ['b']);
});

test('km: getMastery reads from supplied source', () => {
  const km = KnowledgeMap.create();
  km.addTopic({ id: 't', name: 'T', masterySkillId: 's_x' });
  const stub = stubMastery({ s_x: 0.42 });
  assert.equal(km.getMastery('t', stub), 0.42);
});

test('km: getMastery - missing topic / source returns 0', () => {
  const km = KnowledgeMap.create();
  const stub = stubMastery({});
  assert.equal(km.getMastery('missing', stub), 0);
  km.addTopic({ id: 't', name: 'T' }); // no skill id
  assert.equal(km.getMastery('t', stub), 0);
});

test('km: learningPath linear chain', () => {
  const km = KnowledgeMap.create();
  km.addTopic({ id: 'a', name: 'A' });
  km.addTopic({ id: 'b', name: 'B' });
  km.addTopic({ id: 'c', name: 'C' });
  km.addPrerequisite('a', 'b');
  km.addPrerequisite('b', 'c');
  const path = km.learningPath('c');
  assert.deepEqual(path, ['a', 'b', 'c']);
});

test('km: learningPath diamond', () => {
  const km = KnowledgeMap.create();
  km.addTopic({ id: 'a', name: 'A' });
  km.addTopic({ id: 'b', name: 'B' });
  km.addTopic({ id: 'c', name: 'C' });
  km.addTopic({ id: 'd', name: 'D' });
  km.addPrerequisite('a', 'b');
  km.addPrerequisite('a', 'c');
  km.addPrerequisite('b', 'd');
  km.addPrerequisite('c', 'd');
  const path = km.learningPath('d');
  assert.ok(path !== null);
  // 'a' must come first; 'd' last; b and c between in some order.
  assert.equal(path![0], 'a');
  assert.equal(path![path!.length - 1], 'd');
  assert.equal(path!.length, 4);
});

test('km: learningPath - missing target returns null', () => {
  const km = KnowledgeMap.create();
  km.addTopic({ id: 'a', name: 'A' });
  assert.equal(km.learningPath('nope'), null);
});

test('km: learningPath - target with no prereqs returns just itself', () => {
  const km = KnowledgeMap.create();
  km.addTopic({ id: 'a', name: 'A' });
  assert.deepEqual(km.learningPath('a'), ['a']);
});

test('km: integrates with ProgressTracker as the mastery source', () => {
  const pt = ProgressTracker.create();
  pt.defineSkill({ id: 's_basic',     name: 'Basic' });
  pt.defineSkill({ id: 's_advanced',  name: 'Advanced' });

  const km = KnowledgeMap.create({ minMasteryThreshold: 0.5 });
  km.addTopic({ id: 't_basic',    name: 'Basic',    masterySkillId: 's_basic' });
  km.addTopic({ id: 't_advanced', name: 'Advanced', masterySkillId: 's_advanced' });
  km.addPrerequisite('t_basic', 't_advanced');

  // Initially advanced is locked.
  assert.equal(km.isUnlocked('t_advanced', pt), false);
  // Drive basic mastery up.
  for (let i = 0; i < 30; i++) pt.recordEvidence('s_basic', 'apply', 1.0, i * 1000);
  assert.equal(km.isUnlocked('t_advanced', pt), true);
});

test('km: clear empties + dispose locks', () => {
  const km = KnowledgeMap.create();
  km.addTopic({ id: 'a', name: 'A' });
  km.clear();
  assert.equal(km.count(), 0);
  km.dispose();
  assert.equal(km.addTopic({ id: 'b', name: 'B' }), false);
});

test('km: list returns all topics', () => {
  const km = KnowledgeMap.create();
  km.addTopic({ id: 'a', name: 'A' });
  km.addTopic({ id: 'b', name: 'B' });
  assert.equal(km.list().length, 2);
});

// ----- helpers -----

function stubMastery(masteryById: Record<string, number>): {
  getSkill(id: string): { overallMastery: number } | null;
} {
  return {
    getSkill: function (id: string) {
      if (masteryById[id] !== undefined) {
        return { overallMastery: masteryById[id]! };
      }
      return null;
    }
  };
}
