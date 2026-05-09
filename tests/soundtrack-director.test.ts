// Phase 1.4.5 - SoundtrackDirector tests (Wave 1.4 milestone capstone).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  SoundtrackDirector,
  RESOURCE_SOUNDTRACK_DIRECTOR,
} from '../src/index.js';

test('std: RESOURCE_SOUNDTRACK_DIRECTOR is the stable string', () => {
  assert.equal(RESOURCE_SOUNDTRACK_DIRECTOR, 'soundtrack_director');
});

test('std: starts empty', () => {
  const s = SoundtrackDirector.create();
  assert.equal(s.getCurrentState(), null);
});

test('std: defineState + hasState + stateIds', () => {
  const s = SoundtrackDirector.create();
  s.defineState({ id: 'peace', trackIds: ['a', 'b'] });
  s.defineState({ id: 'combat', trackIds: ['c'] });
  assert.equal(s.hasState('peace'), true);
  assert.deepEqual(s.stateIds().sort(), ['combat', 'peace']);
});

test('std: defineState rejects empty id / non-array tracks', () => {
  const s = SoundtrackDirector.create();
  assert.equal(s.defineState({ id: '', trackIds: [] }), false);
  // @ts-expect-error
  assert.equal(s.defineState({ id: 'a', trackIds: null }), false);
});

test('std: setState unknown returns false', () => {
  const s = SoundtrackDirector.create();
  assert.equal(s.setState('missing'), false);
});

test('std: setState transitions + getCurrentState', () => {
  const s = SoundtrackDirector.create({ seed: 1 });
  s.defineState({ id: 'peace', trackIds: ['a'] });
  s.setState('peace');
  assert.equal(s.getCurrentState(), 'peace');
  assert.equal(s.getSnapshot().currentTrackId, 'a');
});

test('std: setState same state is no-op', () => {
  const s = SoundtrackDirector.create();
  s.defineState({ id: 'peace', trackIds: ['a'] });
  s.setState('peace');
  const before = s.getSnapshot().currentTrackId;
  s.setState('peace');
  assert.equal(s.getSnapshot().currentTrackId, before);
});

test('std: minHoldMs blocks early transition', () => {
  const s = SoundtrackDirector.create();
  s.defineState({ id: 'combat', trackIds: ['a'], minHoldMs: 5000 });
  s.defineState({ id: 'peace', trackIds: ['b'] });
  s.setState('combat');
  s.tick(1000);
  // Less than 5000ms held; transition denied.
  assert.equal(s.setState('peace'), false);
  assert.equal(s.getCurrentState(), 'combat');
});

test('std: minHoldMs respected after sufficient time', () => {
  const s = SoundtrackDirector.create();
  s.defineState({ id: 'combat', trackIds: ['a'], minHoldMs: 1000 });
  s.defineState({ id: 'peace', trackIds: ['b'] });
  s.setState('combat');
  s.tick(1500);
  assert.equal(s.setState('peace'), true);
  assert.equal(s.getCurrentState(), 'peace');
});

test('std: force bypasses minHoldMs', () => {
  const s = SoundtrackDirector.create();
  s.defineState({ id: 'combat', trackIds: ['a'], minHoldMs: 5000 });
  s.defineState({ id: 'peace', trackIds: ['b'] });
  s.setState('combat');
  s.tick(100);
  assert.equal(s.setState('peace', { force: true }), true);
  assert.equal(s.getCurrentState(), 'peace');
});

test('std: defaultFadeMs applied on entry', () => {
  const s = SoundtrackDirector.create();
  s.defineState({ id: 'peace', trackIds: ['a'], defaultFadeMs: 1000 });
  s.setState('peace');
  s.tick(500);
  // Halfway through fade.
  assert.ok(Math.abs(s.getSnapshot().fadeProgress - 0.5) < 0.01);
  s.tick(500);
  assert.equal(s.getSnapshot().fadeProgress, 1);
});

test('std: per-pair transition fadeMs override', () => {
  const s = SoundtrackDirector.create();
  s.defineState({ id: 'peace', trackIds: ['a'] });
  s.defineState({
    id: 'boss', trackIds: ['b'],
    defaultFadeMs: 1000,
    transitions: { peace: { fadeMs: 200 } }, // peace -> boss = 200ms
  });
  s.setState('peace');
  s.tick(1000);
  s.setState('boss');
  s.tick(100);
  // Halfway through 200ms fade.
  assert.ok(Math.abs(s.getSnapshot().fadeProgress - 0.5) < 0.01);
});

test('std: setState fadeMs option overrides everything', () => {
  const s = SoundtrackDirector.create();
  s.defineState({ id: 'peace', trackIds: ['a'], defaultFadeMs: 1000 });
  s.setState('peace', { fadeMs: 0 });
  assert.equal(s.getSnapshot().fadeProgress, 1);
});

test('std: previousState retained during fade', () => {
  const s = SoundtrackDirector.create();
  s.defineState({ id: 'peace', trackIds: ['a'] });
  s.defineState({ id: 'combat', trackIds: ['b'], defaultFadeMs: 1000 });
  s.setState('peace', { fadeMs: 0 });
  s.setState('combat');
  const snap = s.getSnapshot();
  assert.equal(snap.previousState, 'peace');
  s.tick(1000);
  // Fade complete, previous cleared.
  assert.equal(s.getSnapshot().previousState, null);
});

test('std: pickTrack picks from current state', () => {
  const s = SoundtrackDirector.create({ seed: 42 });
  s.defineState({ id: 'peace', trackIds: ['a', 'b', 'c'] });
  s.setState('peace');
  const t = s.pickTrack();
  assert.ok(t === 'a' || t === 'b' || t === 'c');
});

test('std: pickTrack returns null when no state', () => {
  const s = SoundtrackDirector.create();
  assert.equal(s.pickTrack(), null);
});

test('std: empty state trackIds returns null currentTrackId', () => {
  const s = SoundtrackDirector.create();
  s.defineState({ id: 'silence', trackIds: [] });
  s.setState('silence');
  assert.equal(s.getSnapshot().currentTrackId, null);
});

test('std: stinger plays + auto-resumes after duration', () => {
  const s = SoundtrackDirector.create();
  s.defineState({ id: 'peace', trackIds: ['a'] });
  s.setState('peace', { fadeMs: 0 });
  s.playStinger({
    id: 'fanfare', trackId: 'victory', durationMs: 1000, resumeAfter: true,
  });
  assert.equal(s.getSnapshot().stinger!.trackId, 'victory');
  s.tick(1500);
  // Stinger ended; state still peace.
  assert.equal(s.getSnapshot().stinger, null);
  assert.equal(s.getCurrentState(), 'peace');
});

test('std: cancelStinger removes it', () => {
  const s = SoundtrackDirector.create();
  s.defineState({ id: 'peace', trackIds: ['a'] });
  s.setState('peace', { fadeMs: 0 });
  s.playStinger({ id: 'f', trackId: 'a', durationMs: 5000 });
  s.cancelStinger('f');
  assert.equal(s.getSnapshot().stinger, null);
});

test('std: cancelStinger wrong id returns false', () => {
  const s = SoundtrackDirector.create();
  assert.equal(s.cancelStinger('nope'), false);
});

test('std: NaN / negative dt no-op', () => {
  const s = SoundtrackDirector.create();
  s.defineState({ id: 'peace', trackIds: ['a'], defaultFadeMs: 1000 });
  s.setState('peace');
  s.tick(NaN);
  s.tick(-50);
  s.tick(Infinity);
  assert.equal(s.getSnapshot().fadeProgress, 0);
});

test('std: clear empties + dispose locks', () => {
  const s = SoundtrackDirector.create();
  s.defineState({ id: 'a', trackIds: ['t'] });
  s.setState('a');
  s.clear();
  assert.equal(s.getCurrentState(), null);
  s.dispose();
  assert.equal(s.defineState({ id: 'b', trackIds: [] }), false);
});

test('std: realistic example - peace -> combat -> boss with stinger -> resume', () => {
  const s = SoundtrackDirector.create({ seed: 7 });
  s.defineState({ id: 'peace',  trackIds: ['vil_a', 'vil_b'], defaultFadeMs: 3000 });
  s.defineState({ id: 'combat', trackIds: ['fight_a'],         defaultFadeMs: 500, minHoldMs: 2000 });
  s.defineState({
    id: 'boss', trackIds: ['boss_p1'],
    transitions: { combat: { fadeMs: 200 } },
  });

  s.setState('peace', { fadeMs: 0 });
  // Combat starts:
  s.setState('combat');
  assert.equal(s.getCurrentState(), 'combat');
  s.tick(2000); // hold elapsed
  // Boss reveal:
  s.setState('boss');
  assert.equal(s.getCurrentState(), 'boss');
  // Victory stinger:
  s.playStinger({
    id: 'win', trackId: 'victory_fanfare',
    durationMs: 4000, resumeAfter: true,
  });
  assert.equal(s.getSnapshot().stinger!.id, 'win');
  s.tick(4500);
  // Stinger done; state resumed (still boss).
  assert.equal(s.getSnapshot().stinger, null);
  assert.equal(s.getCurrentState(), 'boss');
});
