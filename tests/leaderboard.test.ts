// Phase 0.78.0 - Leaderboard tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  Leaderboard,
  RESOURCE_LEADERBOARD,
  type ScoreEntry,
} from '../src/index.js';

test('leaderboard: RESOURCE_LEADERBOARD is the stable string', () => {
  assert.equal(RESOURCE_LEADERBOARD, 'leaderboard');
});

test('leaderboard: submit adds entries', () => {
  const lb = Leaderboard.create();
  assert.ok(lb.submit({ id: 'a', name: 'Alice', score: 100 }));
  assert.equal(lb.size(), 1);
  assert.equal(lb.byIdEntry('a')!.score, 100);
});

test('leaderboard: invalid submissions rejected', () => {
  const lb = Leaderboard.create();
  assert.equal(lb.submit({ id: '', name: 'x', score: 100 }), false);
  assert.equal(lb.submit({ id: 'x', name: 'x', score: NaN }), false);
  assert.equal(lb.submit({ id: 'x', name: 'x', score: Infinity }), false);
});

test('leaderboard: duplicate id keeps best (desc default)', () => {
  const lb = Leaderboard.create();
  lb.submit({ id: 'a', name: 'Alice', score: 100 });
  assert.ok(lb.submit({ id: 'a', name: 'Alice', score: 150 })); // accepted
  assert.equal(lb.byIdEntry('a')!.score, 150);
  assert.equal(lb.submit({ id: 'a', name: 'Alice', score: 50 }), false); // rejected
  assert.equal(lb.byIdEntry('a')!.score, 150);
});

test('leaderboard: order asc keeps lowest', () => {
  const lb = Leaderboard.create({ order: 'asc' });
  lb.submit({ id: 'a', name: 'Alice', score: 100 });
  assert.ok(lb.submit({ id: 'a', name: 'Alice', score: 50 })); // accepted
  assert.equal(lb.byIdEntry('a')!.score, 50);
  assert.equal(lb.submit({ id: 'a', name: 'Alice', score: 200 }), false); // rejected
});

test('leaderboard: top(n) returns highest first (desc) with rank assigned', () => {
  const lb = Leaderboard.create();
  lb.submit({ id: 'a', name: 'A', score: 50 });
  lb.submit({ id: 'b', name: 'B', score: 100 });
  lb.submit({ id: 'c', name: 'C', score: 75 });
  const top = lb.top(2);
  assert.equal(top.length, 2);
  assert.equal(top[0]!.id, 'b');
  assert.equal(top[0]!.rank, 1);
  assert.equal(top[1]!.id, 'c');
  assert.equal(top[1]!.rank, 2);
});

test('leaderboard: ascending order top(n) returns lowest first', () => {
  const lb = Leaderboard.create({ order: 'asc' });
  lb.submit({ id: 'a', name: 'A', score: 50 });
  lb.submit({ id: 'b', name: 'B', score: 100 });
  lb.submit({ id: 'c', name: 'C', score: 75 });
  const top = lb.top(3);
  assert.deepEqual(top.map((e) => e.id), ['a', 'c', 'b']);
});

test('leaderboard: tied scores - earlier submitter ranks higher', () => {
  const lb = Leaderboard.create();
  lb.submit({ id: 'a', name: 'A', score: 100 });
  lb.submit({ id: 'b', name: 'B', score: 100 });
  const top = lb.top(2);
  assert.equal(top[0]!.id, 'a'); // submitted first
  assert.equal(top[1]!.id, 'b');
});

test('leaderboard: rankOf returns 1-based; 0 if absent', () => {
  const lb = Leaderboard.create();
  lb.submit({ id: 'a', name: 'A', score: 50 });
  lb.submit({ id: 'b', name: 'B', score: 100 });
  assert.equal(lb.rankOf('b'), 1);
  assert.equal(lb.rankOf('a'), 2);
  assert.equal(lb.rankOf('ghost'), 0);
});

test('leaderboard: around returns window across rank', () => {
  const lb = Leaderboard.create();
  for (let i = 1; i <= 10; i++) {
    lb.submit({ id: 'p' + i, name: 'P' + i, score: 1000 - i * 10 });
  }
  // p5 has rank 5 (score 950 in desc).
  const window = lb.around('p5', 2, 2);
  assert.deepEqual(window.map((e) => e.id), ['p3', 'p4', 'p5', 'p6', 'p7']);
  assert.equal(window[0]!.rank, 3);
  assert.equal(window[2]!.rank, 5);
});

test('leaderboard: around at boundaries clamps', () => {
  const lb = Leaderboard.create();
  for (let i = 1; i <= 5; i++) {
    lb.submit({ id: 'p' + i, name: 'P' + i, score: 100 - i * 10 });
  }
  // p1 is rank 1.
  const top = lb.around('p1', 5, 1);
  assert.equal(top[0]!.id, 'p1');
  assert.equal(top.length, 2);
});

test('leaderboard: capacity evicts lowest score', () => {
  const lb = Leaderboard.create({ capacity: 3 });
  lb.submit({ id: 'a', name: 'A', score: 50 });
  lb.submit({ id: 'b', name: 'B', score: 25 });
  lb.submit({ id: 'c', name: 'C', score: 75 });
  lb.submit({ id: 'd', name: 'D', score: 100 });
  assert.equal(lb.size(), 3);
  assert.equal(lb.byIdEntry('b'), null); // worst (25) evicted
  assert.notEqual(lb.byIdEntry('a'), null);
  assert.notEqual(lb.byIdEntry('c'), null);
  assert.notEqual(lb.byIdEntry('d'), null);
});

test('leaderboard: remove drops + clear empties', () => {
  const lb = Leaderboard.create();
  lb.submit({ id: 'a', name: 'A', score: 50 });
  lb.submit({ id: 'b', name: 'B', score: 100 });
  assert.ok(lb.remove('a'));
  assert.equal(lb.byIdEntry('a'), null);
  lb.clear();
  assert.equal(lb.size(), 0);
});

test('leaderboard: list returns full sorted with ranks; defensive copy', () => {
  const lb = Leaderboard.create();
  lb.submit({ id: 'a', name: 'A', score: 50 });
  lb.submit({ id: 'b', name: 'B', score: 100 });
  const arr = lb.list();
  assert.equal(arr.length, 2);
  assert.equal(arr[0]!.id, 'b');
  assert.equal(arr[0]!.rank, 1);
  // Mutating defensive copy doesn't affect state.
  arr[0]!.score = 99999;
  assert.equal(lb.byIdEntry('b')!.score, 100);
});

test('leaderboard: byIdEntry returns rank too', () => {
  const lb = Leaderboard.create();
  lb.submit({ id: 'a', name: 'A', score: 50 });
  lb.submit({ id: 'b', name: 'B', score: 100 });
  assert.equal(lb.byIdEntry('a')!.rank, 2);
});

test('leaderboard: data passthrough preserved', () => {
  const lb = Leaderboard.create();
  lb.submit({ id: 'a', name: 'A', score: 50, data: { class: 'mage', level: 30 } });
  assert.deepEqual(lb.byIdEntry('a')!.data, { class: 'mage', level: 30 });
});

test('leaderboard: saveLocal + loadLocal roundtrip via persist adapter', () => {
  let stored: ScoreEntry[] = [];
  const lb = Leaderboard.create({
    persist: {
      save: (e) => { stored = JSON.parse(JSON.stringify(e)); },
      load: () => stored,
    },
  });
  lb.submit({ id: 'a', name: 'A', score: 50 });
  lb.submit({ id: 'b', name: 'B', score: 100 });
  lb.saveLocal();
  // Fresh leaderboard loads the persisted state.
  const lb2 = Leaderboard.create({
    persist: {
      save: () => {},
      load: () => stored,
    },
  });
  lb2.loadLocal();
  assert.equal(lb2.size(), 2);
  assert.equal(lb2.byIdEntry('b')!.score, 100);
});

test('leaderboard: loadLocal recovers tie-break submission order', () => {
  let stored: ScoreEntry[] = [];
  const lb = Leaderboard.create({
    persist: {
      save: (e) => { stored = JSON.parse(JSON.stringify(e)); },
      load: () => stored,
    },
  });
  lb.submit({ id: 'a', name: 'A', score: 100 });
  lb.submit({ id: 'b', name: 'B', score: 100 });
  lb.saveLocal();
  const lb2 = Leaderboard.create({
    persist: { save: () => {}, load: () => stored },
  });
  lb2.loadLocal();
  // Submitting a third tied entry should get a higher submittedAt
  // than the loaded ones (so rank below).
  lb2.submit({ id: 'c', name: 'C', score: 100 });
  const top = lb2.top(3);
  assert.deepEqual(top.map((e) => e.id), ['a', 'b', 'c']);
});

test('leaderboard: uploadRemote calls remote.submit', async () => {
  const submitted: ScoreEntry[] = [];
  const lb = Leaderboard.create({
    remote: {
      submit: (entry) => { submitted.push(entry); return Promise.resolve(); },
    },
  });
  lb.submit({ id: 'a', name: 'A', score: 50 });
  await lb.uploadRemote('a');
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]!.id, 'a');
  assert.equal(submitted[0]!.score, 50);
});

test('leaderboard: syncRemote pulls + merges', async () => {
  const lb = Leaderboard.create({
    remote: {
      fetch: () => Promise.resolve([
        { id: 'a', name: 'A', score: 50, submittedAt: 0 },
        { id: 'b', name: 'B', score: 100, submittedAt: 0 },
      ]),
    },
  });
  await lb.syncRemote();
  assert.equal(lb.size(), 2);
  assert.equal(lb.byIdEntry('b')!.score, 100);
});

test('leaderboard: missing persist / remote tolerated (no-op)', async () => {
  const lb = Leaderboard.create();
  // Should not throw.
  lb.saveLocal();
  lb.loadLocal();
  await lb.uploadRemote('any');
  await lb.syncRemote();
  assert.equal(lb.size(), 0);
});

test('leaderboard: dispose locks ops', () => {
  const lb = Leaderboard.create();
  lb.submit({ id: 'a', name: 'A', score: 50 });
  lb.dispose();
  assert.equal(lb.submit({ id: 'b', name: 'B', score: 100 }), false);
  assert.equal(lb.byIdEntry('a'), null);
  assert.equal(lb.size(), 0);
});

test('leaderboard: setOrder updates + ignores invalid', () => {
  const lb = Leaderboard.create();
  assert.equal(lb.getOrder(), 'desc');
  lb.setOrder('asc');
  assert.equal(lb.getOrder(), 'asc');
  lb.setOrder('huh' as 'desc');
  assert.equal(lb.getOrder(), 'asc'); // unchanged
});

test('leaderboard: realistic 50-player board with top10 + around-me', () => {
  const lb = Leaderboard.create();
  for (let i = 1; i <= 50; i++) {
    lb.submit({ id: 'p' + i, name: 'Player' + i, score: 1000 - i * 5 });
  }
  // Top 10.
  const top10 = lb.top(10);
  assert.equal(top10.length, 10);
  assert.equal(top10[0]!.id, 'p1'); // 995
  assert.equal(top10[9]!.id, 'p10');
  // Around me (p25, rank 25): 5 above, 5 below.
  const window = lb.around('p25', 5, 5);
  assert.equal(window.length, 11);
  assert.equal(window[5]!.id, 'p25');
  assert.equal(window[5]!.rank, 25);
});
