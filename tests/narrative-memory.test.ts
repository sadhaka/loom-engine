// Phase 1.3.5 - NarrativeMemory tests (Wave 1.3 milestone capstone).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  NarrativeMemory,
  RESOURCE_NARRATIVE_MEMORY,
  type MemoryFact,
} from '../src/index.js';

const baseFact = (id: string, opts: Partial<MemoryFact> = {}): MemoryFact => ({
  id: id,
  characterId: opts.characterId ?? 'mira',
  subjectId: opts.subjectId ?? 'player',
  kind: opts.kind ?? 'event',
  content: opts.content ?? 'something happened',
  recordedAt: opts.recordedAt ?? 0,
  salience: opts.salience ?? 0.5,
  ...(opts.tags !== undefined ? { tags: opts.tags } : {}),
  ...(opts.data !== undefined ? { data: opts.data } : {}),
});

test('nm: RESOURCE_NARRATIVE_MEMORY is the stable string', () => {
  assert.equal(RESOURCE_NARRATIVE_MEMORY, 'narrative_memory');
});

test('nm: starts empty', () => {
  const nm = NarrativeMemory.create();
  assert.equal(nm.size(), 0);
});

test('nm: defineKind + hasKind + kindIds', () => {
  const nm = NarrativeMemory.create();
  nm.defineKind({ id: 'trauma', decayHalfLifeMs: 0 });
  nm.defineKind({ id: 'rumor', decayHalfLifeMs: 3600000 });
  assert.equal(nm.hasKind('trauma'), true);
  assert.deepEqual(nm.kindIds().sort(), ['rumor', 'trauma']);
});

test('nm: remember stores fact + has + get', () => {
  const nm = NarrativeMemory.create();
  nm.remember(baseFact('f1'));
  assert.equal(nm.has('f1'), true);
  const f = nm.get('f1');
  assert.equal(f!.content, 'something happened');
});

test('nm: remember auto-defines unknown kind', () => {
  const nm = NarrativeMemory.create();
  nm.remember(baseFact('f1', { kind: 'newkind' }));
  assert.equal(nm.hasKind('newkind'), true);
});

test('nm: remember rejects invalid args', () => {
  const nm = NarrativeMemory.create();
  assert.equal(nm.remember(baseFact('', {})), false);
  assert.equal(nm.remember(baseFact('a', { characterId: '' })), false);
  assert.equal(nm.remember(baseFact('a', { subjectId: '' })), false);
  assert.equal(nm.remember(baseFact('a', { kind: '' })), false);
  assert.equal(nm.remember(baseFact('a', { recordedAt: NaN })), false);
});

test('nm: remember clamps salience to [0, 1]', () => {
  const nm = NarrativeMemory.create();
  nm.remember(baseFact('hi', { salience: 5 }));
  nm.remember(baseFact('lo', { salience: -1 }));
  assert.equal(nm.get('hi')!.salience, 1);
  assert.equal(nm.get('lo')!.salience, 0);
});

test('nm: forget drops fact', () => {
  const nm = NarrativeMemory.create();
  nm.remember(baseFact('f1'));
  assert.equal(nm.forget('f1'), true);
  assert.equal(nm.has('f1'), false);
});

test('nm: forgetAbout drops all (character, subject) pair', () => {
  const nm = NarrativeMemory.create();
  nm.remember(baseFact('a', { characterId: 'mira', subjectId: 'player' }));
  nm.remember(baseFact('b', { characterId: 'mira', subjectId: 'player' }));
  nm.remember(baseFact('c', { characterId: 'mira', subjectId: 'thane' }));
  assert.equal(nm.forgetAbout('mira', 'player'), 2);
  assert.equal(nm.size(), 1);
});

test('nm: adjustSalience adds delta + clamps', () => {
  const nm = NarrativeMemory.create();
  nm.remember(baseFact('f1', { salience: 0.5 }));
  const v = nm.adjustSalience('f1', 0.3);
  assert.ok(Math.abs((v as number) - 0.8) < 1e-6);
  nm.adjustSalience('f1', 5);
  assert.equal(nm.get('f1')!.salience, 1);
});

test('nm: factsAbout returns (character, subject) pairs', () => {
  const nm = NarrativeMemory.create();
  nm.remember(baseFact('a', { characterId: 'mira', subjectId: 'player' }));
  nm.remember(baseFact('b', { characterId: 'mira', subjectId: 'thane' }));
  nm.remember(baseFact('c', { characterId: 'thane', subjectId: 'player' }));
  const f = nm.factsAbout('mira', 'player');
  assert.equal(f.length, 1);
  assert.equal(f[0]!.id, 'a');
});

test('nm: factsBy returns all by character', () => {
  const nm = NarrativeMemory.create();
  nm.remember(baseFact('a', { characterId: 'mira' }));
  nm.remember(baseFact('b', { characterId: 'mira' }));
  nm.remember(baseFact('c', { characterId: 'thane' }));
  assert.equal(nm.factsBy('mira').length, 2);
});

test('nm: factsAboutSubject returns all about subject', () => {
  const nm = NarrativeMemory.create();
  nm.remember(baseFact('a', { subjectId: 'player' }));
  nm.remember(baseFact('b', { subjectId: 'player' }));
  nm.remember(baseFact('c', { subjectId: 'thane' }));
  assert.equal(nm.factsAboutSubject('player').length, 2);
});

test('nm: recall ranks by salience + recency', () => {
  const nm = NarrativeMemory.create();
  nm.remember(baseFact('old_strong', {
    recordedAt: 0, salience: 0.9,
  }));
  nm.remember(baseFact('new_weak', {
    recordedAt: 100000, salience: 0.3,
  }));
  // With heavy salience weighting, old_strong wins.
  const r = nm.recall('mira', 'player', {
    salienceWeight: 0.9, recencyWeight: 0.1,
  });
  assert.equal(r[0]!.id, 'old_strong');
  // With heavy recency weighting + short half-life, new_weak wins.
  const r2 = nm.recall('mira', 'player', {
    salienceWeight: 0.1, recencyWeight: 0.9,
    recencyHalfLifeMs: 50000,
  });
  assert.equal(r2[0]!.id, 'new_weak');
});

test('nm: recall filters by tags (any-overlap)', () => {
  const nm = NarrativeMemory.create();
  nm.remember(baseFact('theft', { salience: 0.9, tags: ['theft', 'witnessed'] }));
  nm.remember(baseFact('chat', { salience: 0.5, tags: ['friendly'] }));
  const r = nm.recall('mira', 'player', { tags: ['theft'] });
  assert.equal(r.length, 1);
  assert.equal(r[0]!.id, 'theft');
});

test('nm: recall filters by kind', () => {
  const nm = NarrativeMemory.create();
  nm.remember(baseFact('a', { kind: 'event' }));
  nm.remember(baseFact('b', { kind: 'rumor' }));
  const r = nm.recall('mira', 'player', { kind: 'event' });
  assert.equal(r.length, 1);
  assert.equal(r[0]!.id, 'a');
});

test('nm: recall filters by minSalience', () => {
  const nm = NarrativeMemory.create();
  nm.remember(baseFact('lo', { salience: 0.1 }));
  nm.remember(baseFact('hi', { salience: 0.9 }));
  const r = nm.recall('mira', 'player', { minSalience: 0.5 });
  assert.equal(r.length, 1);
  assert.equal(r[0]!.id, 'hi');
});

test('nm: recall limit caps result count', () => {
  const nm = NarrativeMemory.create();
  for (let i = 0; i < 20; i++) {
    nm.remember(baseFact('f' + i, { salience: 0.5 }));
  }
  const r = nm.recall('mira', 'player', { limit: 5 });
  assert.equal(r.length, 5);
});

test('nm: topMemory returns highest-ranked', () => {
  const nm = NarrativeMemory.create();
  nm.remember(baseFact('low', { salience: 0.2 }));
  nm.remember(baseFact('high', { salience: 0.95 }));
  const top = nm.topMemory('mira', 'player');
  assert.equal(top!.id, 'high');
});

test('nm: tick decays salience per kind', () => {
  const nm = NarrativeMemory.create();
  nm.defineKind({ id: 'rumor', decayHalfLifeMs: 1000, autoPurgeBelow: 0 });
  nm.remember(baseFact('r1', { kind: 'rumor', salience: 0.8 }));
  nm.tick(1000); // one half-life
  assert.ok(Math.abs(nm.get('r1')!.salience - 0.4) < 0.01);
});

test('nm: tick auto-purges facts below threshold', () => {
  let purged = 0;
  const nm = NarrativeMemory.create({
    onForget: (_f, r) => { if (r === 'purge') purged++; },
  });
  nm.defineKind({ id: 'rumor', decayHalfLifeMs: 100, autoPurgeBelow: 0.1 });
  nm.remember(baseFact('r1', { kind: 'rumor', salience: 0.4 }));
  nm.tick(500); // many half-lives, salience drops well below 0.1
  assert.equal(nm.size(), 0);
  assert.equal(purged, 1);
});

test('nm: kind with decayHalfLifeMs=0 never decays (trauma)', () => {
  const nm = NarrativeMemory.create();
  nm.defineKind({ id: 'trauma', decayHalfLifeMs: 0 });
  nm.remember(baseFact('big', { kind: 'trauma', salience: 0.9 }));
  nm.tick(86400000 * 365); // a year
  assert.equal(nm.get('big')!.salience, 0.9);
});

test('nm: onRemember + onForget callbacks fire', () => {
  const events: Array<{ id: string; kind: string }> = [];
  const nm = NarrativeMemory.create({
    onRemember: (f) => events.push({ id: f.id, kind: 'remember' }),
    onForget: (f) => events.push({ id: f.id, kind: 'forget' }),
  });
  nm.remember(baseFact('f1'));
  nm.forget('f1');
  assert.equal(events.length, 2);
});

test('nm: throwing onRemember / onForget isolated', () => {
  const nm = NarrativeMemory.create({
    onRemember: () => { throw new Error('r-boom'); },
    onForget: () => { throw new Error('f-boom'); },
  });
  nm.remember(baseFact('f1'));
  nm.forget('f1');
  assert.equal(nm.size(), 0);
});

test('nm: NaN / negative dt no-op', () => {
  const nm = NarrativeMemory.create();
  nm.defineKind({ id: 'rumor', decayHalfLifeMs: 1000, autoPurgeBelow: 0 });
  nm.remember(baseFact('r1', { kind: 'rumor', salience: 0.8 }));
  nm.tick(NaN);
  nm.tick(-50);
  nm.tick(Infinity);
  assert.equal(nm.get('r1')!.salience, 0.8);
});

test('nm: exportSession / importSession roundtrip', () => {
  const nm1 = NarrativeMemory.create();
  nm1.defineKind({ id: 'event', decayHalfLifeMs: 86400000 });
  nm1.remember(baseFact('a', { kind: 'event', tags: ['t1'] }));
  nm1.remember(baseFact('b', { kind: 'event' }));
  const json = nm1.exportSession();

  const nm2 = NarrativeMemory.create();
  assert.equal(nm2.importSession(json), true);
  assert.equal(nm2.size(), 2);
  assert.equal(nm2.get('a')!.tags?.[0], 't1');
});

test('nm: exportSession with characterId filter', () => {
  const nm = NarrativeMemory.create();
  nm.remember(baseFact('a', { characterId: 'mira' }));
  nm.remember(baseFact('b', { characterId: 'thane' }));
  const json = nm.exportSession('mira');
  const parsed = JSON.parse(json);
  assert.equal(parsed.facts.length, 1);
  assert.equal(parsed.facts[0].id, 'a');
});

test('nm: importSession invalid string returns false', () => {
  const nm = NarrativeMemory.create();
  assert.equal(nm.importSession(''), false);
  assert.equal(nm.importSession('not-json'), false);
});

test('nm: clear empties + dispose locks', () => {
  const nm = NarrativeMemory.create();
  nm.remember(baseFact('f1'));
  nm.clear();
  assert.equal(nm.size(), 0);
  nm.dispose();
  assert.equal(nm.remember(baseFact('f2')), false);
});

test('nm: realistic example - cross-session player memory', () => {
  const nm = NarrativeMemory.create();
  nm.defineKind({ id: 'trauma', decayHalfLifeMs: 0 });
  nm.defineKind({ id: 'event', decayHalfLifeMs: 86400000 });
  nm.defineKind({ id: 'rumor', decayHalfLifeMs: 3600000 });

  // Session 1: player commits theft, NPC sees.
  nm.remember({
    id: 'theft_witness',
    characterId: 'mira',
    subjectId: 'player_1',
    kind: 'trauma',
    content: 'I saw them take the gold from the chest.',
    recordedAt: 1000,
    salience: 0.95,
    tags: ['theft', 'witnessed'],
  });
  nm.remember({
    id: 'casual_chat',
    characterId: 'mira',
    subjectId: 'player_1',
    kind: 'rumor',
    content: 'They mentioned the weather.',
    recordedAt: 1500,
    salience: 0.3,
    tags: ['conversation'],
  });

  // Save session.
  const json = nm.exportSession('mira');

  // Session 2: load + tick a long time forward.
  const nm2 = NarrativeMemory.create();
  nm2.importSession(json);
  nm2.tick(86400000 * 7); // 7 days

  // Trauma persists (no decay), rumor purged.
  assert.equal(nm2.has('theft_witness'), true);
  assert.ok(nm2.get('theft_witness')!.salience > 0.9);
  // Rumor decayed below default purge threshold (0.05).
  // 7 days = 168 half-lives. 0.3 * 0.5^168 ≈ 0.
  assert.equal(nm2.has('casual_chat'), false);

  // Player encounters Mira: she remembers the theft.
  const top = nm2.topMemory('mira', 'player_1', { tags: ['theft'] });
  assert.equal(top!.id, 'theft_witness');
});
