// Phase 1.7.2 - MatchmakingPool tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  MatchmakingPool,
  RESOURCE_MATCHMAKING_POOL,
} from '../src/index.js';

test('mm: RESOURCE_MATCHMAKING_POOL is the stable string', () => {
  assert.equal(RESOURCE_MATCHMAKING_POOL, 'matchmaking_pool');
});

test('mm: starts empty', () => {
  const mm = MatchmakingPool.create();
  assert.equal(mm.count(), 0);
  assert.deepEqual(mm.list(), []);
});

test('mm: queue creates an entry with snapshot', () => {
  const mm = MatchmakingPool.create();
  const e = mm.queue('alice', 1500, 1000);
  assert.ok(e);
  assert.equal(e!.id, 'alice');
  assert.equal(e!.skill, 1500);
  assert.equal(e!.partySize, 2);
  assert.equal(e!.enqueuedAt, 1000);
  assert.equal(mm.count(), 1);
});

test('mm: queue with custom partySize + data', () => {
  const mm = MatchmakingPool.create();
  const e = mm.queue('alice', 1500, 1000, { partySize: 4, data: { region: 'apac' } });
  assert.equal(e!.partySize, 4);
  assert.equal((e!.data as { region: string }).region, 'apac');
});

test('mm: queue rejects invalid input', () => {
  const mm = MatchmakingPool.create();
  assert.equal(mm.queue('', 1500, 1000), null);
  assert.equal(mm.queue('a', NaN, 1000), null);
  assert.equal(mm.queue('a', 1500, NaN), null);
  // @ts-expect-error
  assert.equal(mm.queue('a', 'nope', 1000), null);
});

test('mm: re-queue replaces entry', () => {
  const mm = MatchmakingPool.create();
  mm.queue('alice', 1500, 1000);
  mm.queue('alice', 1700, 2000);
  assert.equal(mm.count(), 1);
  const e = mm.get('alice');
  assert.equal(e!.skill, 1700);
  assert.equal(e!.enqueuedAt, 2000);
});

test('mm: cancel removes entry', () => {
  const mm = MatchmakingPool.create();
  mm.queue('alice', 1500, 1000);
  assert.equal(mm.cancel('alice'), true);
  assert.equal(mm.cancel('alice'), false);
  assert.equal(mm.count(), 0);
});

test('mm: tick matches two players within initial range', () => {
  const mm = MatchmakingPool.create({ partySize: 2, initialSkillRange: 100 });
  mm.queue('alice', 1500, 1000);
  mm.queue('bob',   1520, 1000);
  const matches = mm.tick(1100);
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0]!.ids.sort(), ['alice', 'bob']);
  assert.equal(matches[0]!.skillSpread, 20);
  assert.equal(matches[0]!.matchedAt, 1100);
  assert.equal(mm.count(), 0);
});

test('mm: tick does not match outside initial range', () => {
  const mm = MatchmakingPool.create({
    partySize: 2,
    initialSkillRange: 50,
    expansionPerSec: 0,  // no expansion
  });
  mm.queue('alice', 1500, 1000);
  mm.queue('bob',   1700, 1000);  // spread 200 > 50
  const matches = mm.tick(1010);
  assert.equal(matches.length, 0);
  assert.equal(mm.count(), 2);  // both still queued
});

test('mm: tick matches after range widens', () => {
  const mm = MatchmakingPool.create({
    partySize: 2,
    initialSkillRange: 50,
    expansionPerSec: 100,  // +100 per sec
  });
  mm.queue('alice', 1500, 0);
  mm.queue('bob',   1700, 0);   // spread 200
  // After 1 sec, range = 50 + 100 = 150 (still < 200)
  assert.equal(mm.tick(1000).length, 0);
  // After 2 sec, range = 50 + 200 = 250 (>= 200)
  assert.equal(mm.tick(2000).length, 1);
});

test('mm: range capped at maxSkillRange', () => {
  const mm = MatchmakingPool.create({
    initialSkillRange: 100,
    expansionPerSec: 1000,
    maxSkillRange: 300,
  });
  const e = mm.queue('alice', 1500, 0)!;
  // 10 sec: would be 100 + 10000 = 10100; capped at 300
  assert.equal(mm.currentRange(e, 10000), 300);
});

test('mm: tick respects partySize buckets independently', () => {
  const mm = MatchmakingPool.create({ initialSkillRange: 100 });
  // 2-player bucket
  mm.queue('a', 1500, 1000, { partySize: 2 });
  mm.queue('b', 1510, 1000, { partySize: 2 });
  // 4-player bucket - only 3 queued (won't fill)
  mm.queue('c', 1500, 1000, { partySize: 4 });
  mm.queue('d', 1510, 1000, { partySize: 4 });
  mm.queue('e', 1520, 1000, { partySize: 4 });
  const matches = mm.tick(1100);
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0]!.ids.sort(), ['a', 'b']);
  // c, d, e still queued (need 4)
  assert.equal(mm.count(), 3);
});

test('mm: tick matches multiple parties at once', () => {
  const mm = MatchmakingPool.create({ partySize: 2, initialSkillRange: 50 });
  mm.queue('a', 1000, 0);
  mm.queue('b', 1010, 0);
  mm.queue('c', 2000, 0);
  mm.queue('d', 2020, 0);
  const matches = mm.tick(100);
  assert.equal(matches.length, 2);
  // After greedy match by skill ASC: (a,b) then (c,d)
  const allIds = matches.flatMap(m => m.ids).sort();
  assert.deepEqual(allIds, ['a', 'b', 'c', 'd']);
  assert.equal(mm.count(), 0);
});

test('mm: tick matches a single player when partySize=1', () => {
  const mm = MatchmakingPool.create({ partySize: 1 });
  mm.queue('solo', 1500, 1000);
  const matches = mm.tick(1100);
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0]!.ids, ['solo']);
});

test('mm: longest-waiting player drives the match window (smallest range wins)', () => {
  // alice waited longer => widest range; bob just queued => tightest.
  // Match valid only if spread <= MIN(ranges) = bob's range.
  const mm = MatchmakingPool.create({
    partySize: 2,
    initialSkillRange: 50,
    expansionPerSec: 100,  // +100/sec
  });
  mm.queue('alice', 1500, 0);
  // 5 sec later, bob joins
  mm.queue('bob', 1700, 5000);  // spread 200
  // At t=5000, alice range = 50 + 500 = 550; bob = 50. min = 50 < 200 -> no match
  assert.equal(mm.tick(5000).length, 0);
  // At t=6000, alice = 650; bob = 50 + 100 = 150. min = 150 < 200 -> no match
  assert.equal(mm.tick(6000).length, 0);
  // At t=6500, alice = 700; bob = 50 + 150 = 200. min = 200 == 200 -> match!
  assert.equal(mm.tick(6500).length, 1);
});

test('mm: tick rejects invalid now', () => {
  const mm = MatchmakingPool.create();
  mm.queue('a', 1500, 1000);
  assert.deepEqual(mm.tick(NaN), []);
  // @ts-expect-error
  assert.deepEqual(mm.tick('nope'), []);
});

test('mm: maxEntries evicts oldest on overflow', () => {
  const mm = MatchmakingPool.create({ maxEntries: 3 });
  mm.queue('a', 1500, 1000);
  mm.queue('b', 1500, 2000);
  mm.queue('c', 1500, 3000);
  mm.queue('d', 1500, 4000);  // a (oldest) evicted
  assert.equal(mm.count(), 3);
  assert.equal(mm.has('a'), false);
  assert.equal(mm.has('d'), true);
});

test('mm: waitMs returns elapsed wait', () => {
  const mm = MatchmakingPool.create();
  mm.queue('alice', 1500, 1000);
  assert.equal(mm.waitMs('alice', 3500), 2500);
  assert.equal(mm.waitMs('nobody', 3500), 0);
});

test('mm: clear empties the pool', () => {
  const mm = MatchmakingPool.create();
  mm.queue('a', 1500, 0);
  mm.queue('b', 1500, 0);
  mm.clear();
  assert.equal(mm.count(), 0);
});

test('mm: diagnostics getters return configured values', () => {
  const mm = MatchmakingPool.create({
    partySize: 4,
    initialSkillRange: 80,
    expansionPerSec: 25,
    maxSkillRange: 500,
  });
  assert.equal(mm.getDefaultPartySize(), 4);
  assert.equal(mm.getInitialSkillRange(), 80);
  assert.equal(mm.getExpansionPerSec(), 25);
  assert.equal(mm.getMaxSkillRange(), 500);
});

test('mm: snapshot returned from get is immutable to caller', () => {
  const mm = MatchmakingPool.create();
  mm.queue('a', 1500, 1000, { data: { count: 1 } as Record<string, unknown> });
  const e1 = mm.get('a')!;
  // Mutating the snapshot does not affect the internal entry.
  (e1.data as { count: number }).count = 999;
  e1.skill = 9999;
  const e2 = mm.get('a')!;
  // Note: data is shared reference (consumer responsibility), but
  // primitive fields like skill are not affected.
  assert.equal(e2.skill, 1500);
});

test('mm: matched players removed from queue', () => {
  const mm = MatchmakingPool.create({ partySize: 2 });
  mm.queue('a', 1500, 0);
  mm.queue('b', 1510, 0);
  mm.queue('c', 1520, 0);  // odd one out
  mm.tick(100);
  // Only c should remain
  assert.equal(mm.count(), 1);
  assert.equal(mm.has('c'), true);
});
