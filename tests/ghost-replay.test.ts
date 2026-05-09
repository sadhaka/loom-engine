// Phase 1.1.5 - GhostReplay tests (Wave 1.1 capstone milestone).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  GhostReplay,
  RESOURCE_GHOST_REPLAY,
  type Recording,
} from '../src/index.js';

test('ghost: RESOURCE_GHOST_REPLAY is the stable string', () => {
  assert.equal(RESOURCE_GHOST_REPLAY, 'ghost_replay');
});

test('ghost: starts not recording', () => {
  const rep = GhostReplay.create();
  assert.equal(rep.isRecording(), false);
});

test('ghost: startRecording + recordSnapshot + stopRecording', () => {
  const rep = GhostReplay.create();
  rep.startRecording({ sampleRateMs: 100 });
  assert.equal(rep.isRecording(), true);
  rep.recordSnapshot({ x: 0, y: 0 });
  rep.recordSnapshot({ x: 10, y: 0 });
  rep.recordSnapshot({ x: 20, y: 0 });
  const recording = rep.stopRecording();
  assert.ok(recording);
  assert.equal(recording!.frames.length, 3);
  assert.equal(recording!.totalMs, 200); // 0 + 100 + 100
  assert.equal(rep.isRecording(), false);
});

test('ghost: recordSnapshot before startRecording is no-op', () => {
  const rep = GhostReplay.create();
  assert.equal(rep.recordSnapshot({ x: 0, y: 0 }), false);
});

test('ghost: recordSnapshot rejects non-finite x/y', () => {
  const rep = GhostReplay.create();
  rep.startRecording();
  assert.equal(rep.recordSnapshot({ x: NaN, y: 0 }), false);
  assert.equal(rep.recordSnapshot({ x: 0, y: Infinity }), false);
  const r = rep.stopRecording();
  assert.equal(r!.frames.length, 0);
});

test('ghost: recordSnapshot respects maxFrames (drops oldest)', () => {
  const rep = GhostReplay.create();
  rep.startRecording({ sampleRateMs: 10, maxFrames: 3 });
  for (let i = 0; i < 5; i++) {
    rep.recordSnapshot({ x: i, y: 0 });
  }
  const r = rep.stopRecording()!;
  assert.equal(r.frames.length, 3);
  // Last 3 = x=2, x=3, x=4 (rebased to atMs 0, 10, 20).
  assert.equal(r.frames[0]!.x, 2);
  assert.equal(r.frames[0]!.atMs, 0);
  assert.equal(r.frames[2]!.x, 4);
  assert.equal(r.frames[2]!.atMs, 20);
});

test('ghost: stopRecording returns null when not recording', () => {
  const rep = GhostReplay.create();
  assert.equal(rep.stopRecording(), null);
});

test('ghost: cancelRecording discards', () => {
  const rep = GhostReplay.create();
  rep.startRecording();
  rep.recordSnapshot({ x: 0, y: 0 });
  rep.cancelRecording();
  assert.equal(rep.isRecording(), false);
  assert.equal(rep.stopRecording(), null);
});

test('ghost: play creates a ghost', () => {
  const rep = GhostReplay.create();
  const recording: Recording = {
    frames: [
      { atMs: 0, x: 0, y: 0 },
      { atMs: 100, x: 10, y: 0 },
    ],
    totalMs: 100,
  };
  assert.equal(rep.play(recording, { id: 'g1' }), true);
  assert.equal(rep.has('g1'), true);
  assert.equal(rep.count(), 1);
});

test('ghost: play with empty frames returns false', () => {
  const rep = GhostReplay.create();
  assert.equal(rep.play({ frames: [], totalMs: 0 }), false);
});

test('ghost: play uses recording label as default id', () => {
  const rep = GhostReplay.create();
  const recording: Recording = {
    frames: [{ atMs: 0, x: 0, y: 0 }],
    totalMs: 0,
    label: 'best_lap',
  };
  rep.play(recording);
  assert.equal(rep.has('best_lap'), true);
});

test('ghost: getGhost returns interpolated snapshot mid-sequence', () => {
  const rep = GhostReplay.create();
  const recording: Recording = {
    frames: [
      { atMs: 0, x: 0, y: 0 },
      { atMs: 100, x: 100, y: 50 },
    ],
    totalMs: 100,
  };
  rep.play(recording, { id: 'g1' });
  rep.tick(50); // halfway
  const g = rep.getGhost('g1');
  assert.ok(g);
  assert.ok(Math.abs(g!.x - 50) < 1e-6);
  assert.ok(Math.abs(g!.y - 25) < 1e-6);
});

test('ghost: getGhost before first frame returns first', () => {
  const rep = GhostReplay.create();
  const recording: Recording = {
    frames: [
      { atMs: 0, x: 7, y: 8 },
      { atMs: 100, x: 100, y: 200 },
    ],
    totalMs: 100,
  };
  rep.play(recording, { id: 'g1' });
  const g = rep.getGhost('g1')!;
  assert.equal(g.x, 7);
  assert.equal(g.y, 8);
});

test('ghost: getGhost after last frame returns last', () => {
  const rep = GhostReplay.create();
  const recording: Recording = {
    frames: [
      { atMs: 0, x: 0, y: 0 },
      { atMs: 100, x: 50, y: 50 },
    ],
    totalMs: 100,
  };
  rep.play(recording, { id: 'g1' });
  rep.tick(200); // past end
  const g = rep.getGhost('g1')!;
  assert.equal(g.x, 50);
  assert.equal(g.y, 50);
  assert.equal(g.isPlaying, false);
});

test('ghost: loop replays from start', () => {
  const rep = GhostReplay.create();
  const recording: Recording = {
    frames: [
      { atMs: 0, x: 0, y: 0 },
      { atMs: 100, x: 100, y: 0 },
    ],
    totalMs: 100,
  };
  rep.play(recording, { id: 'g1', loop: true });
  rep.tick(150); // wraps; elapsed = 50
  const g = rep.getGhost('g1')!;
  assert.equal(g.isPlaying, true);
  assert.ok(Math.abs(g.x - 50) < 1e-6);
});

test('ghost: onFinish fires once on non-loop play', () => {
  let count = 0;
  const rep = GhostReplay.create();
  const recording: Recording = {
    frames: [{ atMs: 0, x: 0, y: 0 }, { atMs: 100, x: 1, y: 0 }],
    totalMs: 100,
  };
  rep.play(recording, { id: 'g1', onFinish: () => { count++; } });
  rep.tick(150);
  rep.tick(50);
  assert.equal(count, 1);
});

test('ghost: stop removes a specific ghost', () => {
  const rep = GhostReplay.create();
  const r: Recording = { frames: [{ atMs: 0, x: 0, y: 0 }], totalMs: 0 };
  rep.play(r, { id: 'a' });
  rep.play(r, { id: 'b' });
  assert.equal(rep.stop('a'), true);
  assert.equal(rep.has('a'), false);
  assert.equal(rep.has('b'), true);
});

test('ghost: stopAll removes all', () => {
  const rep = GhostReplay.create();
  const r: Recording = { frames: [{ atMs: 0, x: 0, y: 0 }], totalMs: 0 };
  rep.play(r, { id: 'a' });
  rep.play(r, { id: 'b' });
  rep.stopAll();
  assert.equal(rep.count(), 0);
});

test('ghost: pause stops + resume continues', () => {
  const rep = GhostReplay.create();
  const r: Recording = {
    frames: [{ atMs: 0, x: 0, y: 0 }, { atMs: 100, x: 100, y: 0 }],
    totalMs: 100,
  };
  rep.play(r, { id: 'g1' });
  rep.tick(20);
  rep.pause('g1');
  rep.tick(50);
  assert.equal(rep.getGhost('g1')!.elapsedMs, 20);
  rep.resume('g1');
  rep.tick(30);
  assert.equal(rep.getGhost('g1')!.elapsedMs, 50);
});

test('ghost: setSpeed changes playback rate', () => {
  const rep = GhostReplay.create();
  const r: Recording = {
    frames: [{ atMs: 0, x: 0, y: 0 }, { atMs: 100, x: 100, y: 0 }],
    totalMs: 100,
  };
  rep.play(r, { id: 'g1' });
  rep.setSpeed('g1', 2);
  rep.tick(20); // 20 * 2 = 40 elapsed
  assert.equal(rep.getGhost('g1')!.elapsedMs, 40);
});

test('ghost: fadeInMs ramps alpha 0 -> 1 at start', () => {
  const rep = GhostReplay.create();
  const r: Recording = {
    frames: [{ atMs: 0, x: 0, y: 0 }, { atMs: 1000, x: 100, y: 0 }],
    totalMs: 1000,
  };
  rep.play(r, { id: 'g1', fadeInMs: 100 });
  rep.tick(50);
  const g = rep.getGhost('g1')!;
  assert.ok(g.alpha < 1 && g.alpha > 0);
});

test('ghost: fadeOutMs ramps alpha 1 -> 0 at end', () => {
  const rep = GhostReplay.create();
  const r: Recording = {
    frames: [{ atMs: 0, x: 0, y: 0 }, { atMs: 1000, x: 100, y: 0 }],
    totalMs: 1000,
  };
  rep.play(r, { id: 'g1', fadeOutMs: 100 });
  rep.tick(950);
  const g = rep.getGhost('g1')!;
  assert.ok(g.alpha < 1 && g.alpha >= 0);
});

test('ghost: list + forEach iterate active ghosts', () => {
  const rep = GhostReplay.create();
  const r: Recording = { frames: [{ atMs: 0, x: 0, y: 0 }], totalMs: 0 };
  rep.play(r, { id: 'a' });
  rep.play(r, { id: 'b' });
  assert.equal(rep.list().length, 2);
  const seen: string[] = [];
  rep.forEach((g) => seen.push(g.id));
  assert.deepEqual(seen.sort(), ['a', 'b']);
});

test('ghost: exportRecording / importRecording roundtrip', () => {
  const rep = GhostReplay.create();
  const original: Recording = {
    frames: [{ atMs: 0, x: 1, y: 2 }, { atMs: 100, x: 3, y: 4 }],
    totalMs: 100,
    label: 'best_lap',
  };
  const json = rep.exportRecording(original);
  const round = rep.importRecording(json);
  assert.deepEqual(round, original);
});

test('ghost: importRecording invalid string returns null', () => {
  const rep = GhostReplay.create();
  assert.equal(rep.importRecording(''), null);
  assert.equal(rep.importRecording('not-json'), null);
  assert.equal(rep.importRecording('{}'), null);
});

test('ghost: NaN / negative dt no-op', () => {
  const rep = GhostReplay.create();
  const r: Recording = {
    frames: [{ atMs: 0, x: 0, y: 0 }, { atMs: 100, x: 100, y: 0 }],
    totalMs: 100,
  };
  rep.play(r, { id: 'g1' });
  rep.tick(NaN);
  rep.tick(-50);
  rep.tick(Infinity);
  assert.equal(rep.getGhost('g1')!.elapsedMs, 0);
});

test('ghost: throwing onFinish isolated', () => {
  const rep = GhostReplay.create();
  const r: Recording = { frames: [{ atMs: 0, x: 0, y: 0 }, { atMs: 100, x: 1, y: 0 }], totalMs: 100 };
  rep.play(r, { id: 'g1', onFinish: () => { throw new Error('boom'); } });
  rep.tick(150);
  // Should not throw.
  assert.equal(rep.has('g1'), true); // ghost remains, just finished
});

test('ghost: dispose locks ops', () => {
  const rep = GhostReplay.create();
  const r: Recording = { frames: [{ atMs: 0, x: 0, y: 0 }], totalMs: 0 };
  rep.play(r, { id: 'g1' });
  rep.dispose();
  assert.equal(rep.startRecording(), false);
  assert.equal(rep.play(r, { id: 'g2' }), false);
  assert.equal(rep.count(), 0);
});

test('ghost: realistic example - record path then play as ghost', () => {
  const rep = GhostReplay.create();
  // Record.
  rep.startRecording({ sampleRateMs: 50 });
  for (let i = 0; i <= 10; i++) {
    rep.recordSnapshot({
      x: i * 10,
      y: 0,
      rotation: 0,
      animationId: i < 5 ? 'walk' : 'run',
    });
  }
  const recording = rep.stopRecording()!;
  assert.equal(recording.frames.length, 11);
  assert.equal(recording.totalMs, 500);
  // Replay.
  rep.play(recording, { id: 'best', loop: false, fadeInMs: 100 });
  rep.tick(250); // halfway
  const g = rep.getGhost('best')!;
  assert.ok(g.x > 0 && g.x < 100);
  assert.equal(g.id, 'best');
  // Animation id from active frame.
  assert.ok(g.animationId === 'walk' || g.animationId === 'run');
});
