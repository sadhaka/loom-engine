// Phase 1.1.4 - CutsceneSequencer tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  CutsceneSequencer,
  RESOURCE_CUTSCENE_SEQUENCER,
  type Cue,
} from '../src/index.js';

test('cutscene: RESOURCE_CUTSCENE_SEQUENCER is the stable string', () => {
  assert.equal(RESOURCE_CUTSCENE_SEQUENCER, 'cutscene_sequencer');
});

test('cutscene: starts not playing', () => {
  const seq = CutsceneSequencer.create();
  const s = seq.getState();
  assert.equal(s.isPlaying, false);
  assert.equal(s.elapsedMs, 0);
});

test('cutscene: play with empty cues returns false', () => {
  const seq = CutsceneSequencer.create();
  assert.equal(seq.play({ cues: [] }), false);
  assert.equal(seq.isPlaying(), false);
});

test('cutscene: play sets isPlaying + fires cues at atMs=0', () => {
  const fired: string[] = [];
  const seq = CutsceneSequencer.create();
  seq.play({
    cues: [{ atMs: 0, kind: 'audio', payload: { id: 'horn' } }],
    onCue: (c) => fired.push(c.kind),
  });
  assert.equal(seq.isPlaying(), true);
  assert.deepEqual(fired, ['audio']);
});

test('cutscene: tick fires cues in atMs order', () => {
  const fired: number[] = [];
  const seq = CutsceneSequencer.create();
  seq.play({
    cues: [
      { atMs: 100, kind: 'a' },
      { atMs: 50, kind: 'b' },
      { atMs: 200, kind: 'c' },
    ],
    onCue: (c) => fired.push(c.atMs),
  });
  // After play: nothing fired (none at 0).
  assert.deepEqual(fired, []);
  seq.tick(150);
  // 50 and 100 fired, in order.
  assert.deepEqual(fired, [50, 100]);
  seq.tick(100);
  assert.deepEqual(fired, [50, 100, 200]);
});

test('cutscene: multiple cues at same atMs all fire', () => {
  const fired: string[] = [];
  const seq = CutsceneSequencer.create();
  seq.play({
    cues: [
      { atMs: 100, kind: 'a' },
      { atMs: 100, kind: 'b' },
      { atMs: 100, kind: 'c' },
    ],
    onCue: (c) => fired.push(c.kind),
  });
  seq.tick(150);
  assert.equal(fired.length, 3);
  assert.deepEqual(fired.sort(), ['a', 'b', 'c']);
});

test('cutscene: totalMs defaults to last cue atMs', () => {
  const seq = CutsceneSequencer.create();
  seq.play({
    cues: [{ atMs: 100, kind: 'a' }, { atMs: 500, kind: 'b' }],
  });
  assert.equal(seq.getState().totalMs, 500);
});

test('cutscene: explicit totalMs adds tail time', () => {
  const seq = CutsceneSequencer.create();
  seq.play({
    cues: [{ atMs: 100, kind: 'a' }],
    totalMs: 1000,
  });
  assert.equal(seq.getState().totalMs, 1000);
});

test('cutscene: onFinish fires when sequence ends', () => {
  let finished = false;
  const seq = CutsceneSequencer.create();
  seq.play({
    cues: [{ atMs: 100, kind: 'a' }],
    onFinish: () => { finished = true; },
  });
  seq.tick(50);
  assert.equal(finished, false);
  seq.tick(60); // total elapsed 110 > totalMs 100
  assert.equal(finished, true);
  assert.equal(seq.isPlaying(), false);
});

test('cutscene: onFinish fires only once per play', () => {
  let count = 0;
  const seq = CutsceneSequencer.create();
  seq.play({
    cues: [{ atMs: 100, kind: 'a' }],
    onFinish: () => { count++; },
  });
  seq.tick(150);
  seq.tick(50);
  assert.equal(count, 1);
});

test('cutscene: pause stops + resume continues', () => {
  const fired: string[] = [];
  const seq = CutsceneSequencer.create();
  seq.play({
    cues: [
      { atMs: 100, kind: 'a' },
      { atMs: 300, kind: 'b' },
    ],
    onCue: (c) => fired.push(c.kind),
  });
  seq.tick(150);
  assert.deepEqual(fired, ['a']);
  seq.pause();
  seq.tick(500);
  assert.deepEqual(fired, ['a']);
  seq.resume();
  seq.tick(200);
  assert.deepEqual(fired, ['a', 'b']);
});

test('cutscene: setSpeed multiplies dt', () => {
  const fired: string[] = [];
  const seq = CutsceneSequencer.create();
  seq.play({
    cues: [{ atMs: 1000, kind: 'a' }],
    onCue: (c) => fired.push(c.kind),
  });
  seq.setSpeed(2);
  seq.tick(500); // 500*2 = 1000 elapsed
  assert.deepEqual(fired, ['a']);
});

test('cutscene: stop returns to start, no onFinish', () => {
  let finished = false;
  const seq = CutsceneSequencer.create();
  seq.play({
    cues: [{ atMs: 100, kind: 'a' }, { atMs: 500, kind: 'b' }],
    onFinish: () => { finished = true; },
  });
  seq.tick(200);
  seq.stop();
  assert.equal(seq.isPlaying(), false);
  assert.equal(finished, false);
  assert.equal(seq.getState().elapsedMs, 0);
});

test('cutscene: jumpTo forward fires intervening cues', () => {
  const fired: string[] = [];
  const seq = CutsceneSequencer.create();
  seq.play({
    cues: [
      { atMs: 100, kind: 'a' },
      { atMs: 500, kind: 'b' },
      { atMs: 900, kind: 'c' },
    ],
    onCue: (c) => fired.push(c.kind),
  });
  seq.jumpTo(800);
  assert.deepEqual(fired, ['a', 'b']);
});

test('cutscene: jumpTo backward does not re-fire', () => {
  const fired: string[] = [];
  const seq = CutsceneSequencer.create();
  seq.play({
    cues: [{ atMs: 100, kind: 'a' }, { atMs: 500, kind: 'b' }],
    onCue: (c) => fired.push(c.kind),
  });
  seq.tick(600);
  assert.deepEqual(fired, ['a', 'b']);
  seq.jumpTo(0);
  // No extra fires.
  assert.deepEqual(fired, ['a', 'b']);
});

test('cutscene: jumpTo clamps to [0, totalMs]', () => {
  const seq = CutsceneSequencer.create();
  seq.play({
    cues: [{ atMs: 100, kind: 'a' }],
    totalMs: 500,
  });
  seq.jumpTo(99999);
  assert.equal(seq.getState().elapsedMs, 500);
  seq.jumpTo(-100);
  assert.equal(seq.getState().elapsedMs, 0);
});

test('cutscene: throwing onCue isolated', () => {
  const seq = CutsceneSequencer.create();
  seq.play({
    cues: [{ atMs: 100, kind: 'boom' }],
    onCue: () => { throw new Error('boom'); },
  });
  seq.tick(150);
  // Should not throw.
  assert.equal(seq.isPlaying(), false);
});

test('cutscene: throwing onFinish isolated', () => {
  const seq = CutsceneSequencer.create();
  seq.play({
    cues: [{ atMs: 100, kind: 'a' }],
    onFinish: () => { throw new Error('end-boom'); },
  });
  seq.tick(150);
  assert.equal(seq.isPlaying(), false);
});

test('cutscene: NaN / negative dt no-op', () => {
  const seq = CutsceneSequencer.create();
  seq.play({ cues: [{ atMs: 100, kind: 'a' }] });
  seq.tick(NaN);
  seq.tick(-50);
  seq.tick(Infinity);
  assert.equal(seq.getState().elapsedMs, 0);
});

test('cutscene: progress reports 0..1', () => {
  const seq = CutsceneSequencer.create();
  seq.play({ cues: [{ atMs: 1000, kind: 'a' }] });
  seq.tick(250);
  assert.ok(Math.abs(seq.getState().progress - 0.25) < 1e-6);
});

test('cutscene: firedCount increments', () => {
  const seq = CutsceneSequencer.create();
  seq.play({
    cues: [
      { atMs: 100, kind: 'a' },
      { atMs: 200, kind: 'b' },
      { atMs: 300, kind: 'c' },
    ],
  });
  seq.tick(250);
  assert.equal(seq.getState().firedCount, 2);
});

test('cutscene: dispose locks ops', () => {
  const seq = CutsceneSequencer.create();
  seq.play({ cues: [{ atMs: 100, kind: 'a' }] });
  seq.dispose();
  assert.equal(seq.play({ cues: [{ atMs: 100, kind: 'b' }] }), false);
  seq.tick(50);
  assert.equal(seq.isPlaying(), false);
});

test('cutscene: realistic example - boss intro orchestration', () => {
  const dispatched: Array<{ kind: string; id: unknown }> = [];
  const seq = CutsceneSequencer.create();
  seq.play({
    totalMs: 4000,
    cues: [
      { atMs: 0,    kind: 'camera', payload: { sequence: 'boss_reveal' } },
      { atMs: 200,  kind: 'audio',  payload: { id: 'boss_horn' } },
      { atMs: 1500, kind: 'dialog', payload: { lineId: 'boss_taunt' } },
      { atMs: 3500, kind: 'emit',   payload: { event: 'boss_active' } },
    ],
    onCue: (c) => dispatched.push({
      kind: c.kind,
      id: c.payload?.id ?? c.payload?.lineId ?? c.payload?.event ?? c.payload?.sequence,
    }),
  });
  seq.tick(4500);
  assert.equal(dispatched.length, 4);
  assert.equal(dispatched[0]!.kind, 'camera');
  assert.equal(dispatched[1]!.kind, 'audio');
  assert.equal(dispatched[2]!.kind, 'dialog');
  assert.equal(dispatched[3]!.kind, 'emit');
});

test('cutscene: cues are sorted by atMs even when passed unordered', () => {
  const fired: number[] = [];
  const seq = CutsceneSequencer.create();
  seq.play({
    cues: [
      { atMs: 300, kind: 'c' },
      { atMs: 100, kind: 'a' },
      { atMs: 200, kind: 'b' },
    ],
    onCue: (c) => fired.push(c.atMs),
  });
  seq.tick(400);
  assert.deepEqual(fired, [100, 200, 300]);
});
