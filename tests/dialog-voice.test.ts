// Phase 1.3.3 - DialogVoice tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  DialogVoice,
  RESOURCE_DIALOG_VOICE,
  type VoiceMarker,
} from '../src/index.js';

test('dv: RESOURCE_DIALOG_VOICE is the stable string', () => {
  assert.equal(RESOURCE_DIALOG_VOICE, 'dialog_voice');
});

test('dv: starts empty + nothing playing', () => {
  const dv = DialogVoice.create();
  assert.equal(dv.lineCount(), 0);
  assert.equal(dv.isPlaying(), false);
});

test('dv: registerLine + hasLine + getLine', () => {
  const dv = DialogVoice.create();
  dv.registerLine({ nodeId: 'greet', cueId: 'vo_001', durationMs: 1000 });
  assert.equal(dv.hasLine('greet'), true);
  const line = dv.getLine('greet');
  assert.ok(line);
  assert.equal(line!.cueId, 'vo_001');
});

test('dv: registerLine rejects invalid args', () => {
  const dv = DialogVoice.create();
  assert.equal(dv.registerLine({ nodeId: '', cueId: 'a', durationMs: 100 }), false);
  assert.equal(dv.registerLine({ nodeId: 'a', cueId: '', durationMs: 100 }), false);
  assert.equal(dv.registerLine({ nodeId: 'a', cueId: 'b', durationMs: -1 }), false);
});

test('dv: unregisterLine drops it', () => {
  const dv = DialogVoice.create();
  dv.registerLine({ nodeId: 'a', cueId: 'a', durationMs: 100 });
  assert.equal(dv.unregisterLine('a'), true);
  assert.equal(dv.hasLine('a'), false);
});

test('dv: play unknown node returns false', () => {
  const dv = DialogVoice.create();
  assert.equal(dv.play('missing'), false);
});

test('dv: play sets active line + getCurrent reflects state', () => {
  const dv = DialogVoice.create();
  dv.registerLine({ nodeId: 'greet', cueId: 'vo_001', durationMs: 1000 });
  dv.play('greet');
  assert.equal(dv.isPlaying(), true);
  const cur = dv.getCurrent();
  assert.ok(cur);
  assert.equal(cur!.nodeId, 'greet');
  assert.equal(cur!.cueId, 'vo_001');
  assert.equal(cur!.elapsedMs, 0);
});

test('dv: tick advances elapsed', () => {
  const dv = DialogVoice.create();
  dv.registerLine({ nodeId: 'a', cueId: 'a', durationMs: 1000 });
  dv.play('a');
  dv.tick(250);
  assert.equal(dv.getCurrent()!.elapsedMs, 250);
});

test('dv: line ends + onLineEnd fires', () => {
  let ended = false;
  const dv = DialogVoice.create();
  dv.registerLine({ nodeId: 'a', cueId: 'a', durationMs: 100 });
  dv.play('a', { onLineEnd: () => { ended = true; } });
  dv.tick(150);
  assert.equal(ended, true);
  assert.equal(dv.isPlaying(), false);
});

test('dv: markers fire as elapsed crosses atMs', () => {
  const fired: string[] = [];
  const dv = DialogVoice.create();
  dv.registerLine({
    nodeId: 'a', cueId: 'a', durationMs: 1000,
    markers: [
      { atMs: 200, kind: 'phoneme' },
      { atMs: 500, kind: 'gesture' },
      { atMs: 800, kind: 'emote' },
    ],
  });
  dv.play('a', { onMarker: (m) => fired.push(m.kind) });
  dv.tick(300);
  assert.deepEqual(fired, ['phoneme']);
  dv.tick(300); // elapsed 600
  assert.deepEqual(fired, ['phoneme', 'gesture']);
});

test('dv: markers do not re-fire', () => {
  let count = 0;
  const dv = DialogVoice.create();
  dv.registerLine({
    nodeId: 'a', cueId: 'a', durationMs: 1000,
    markers: [{ atMs: 100, kind: 'beat' }],
  });
  dv.play('a', { onMarker: () => { count++; } });
  dv.tick(150);
  dv.tick(150);
  dv.tick(150);
  assert.equal(count, 1);
});

test('dv: markers sorted by atMs at register time', () => {
  const dv = DialogVoice.create();
  dv.registerLine({
    nodeId: 'a', cueId: 'a', durationMs: 1000,
    markers: [
      { atMs: 800, kind: 'late' },
      { atMs: 200, kind: 'early' },
      { atMs: 500, kind: 'mid' },
    ],
  });
  const line = dv.getLine('a');
  assert.deepEqual(line!.markers!.map((m) => m.atMs), [200, 500, 800]);
});

test('dv: interrupt clears active + does not fire onLineEnd', () => {
  let ended = false;
  const dv = DialogVoice.create();
  dv.registerLine({ nodeId: 'a', cueId: 'a', durationMs: 1000 });
  dv.play('a', { onLineEnd: () => { ended = true; } });
  dv.tick(500);
  dv.interrupt();
  assert.equal(dv.isPlaying(), false);
  assert.equal(ended, false);
});

test('dv: pause stops advancement; resume continues', () => {
  const dv = DialogVoice.create();
  dv.registerLine({ nodeId: 'a', cueId: 'a', durationMs: 1000 });
  dv.play('a');
  dv.tick(200);
  dv.pause();
  dv.tick(500);
  assert.equal(dv.getCurrent()!.elapsedMs, 200);
  dv.resume();
  dv.tick(300);
  assert.equal(dv.getCurrent()!.elapsedMs, 500);
});

test('dv: speed multiplier', () => {
  const dv = DialogVoice.create();
  dv.registerLine({ nodeId: 'a', cueId: 'a', durationMs: 1000 });
  dv.play('a', { speed: 2 });
  dv.tick(250);
  assert.equal(dv.getCurrent()!.elapsedMs, 500);
});

test('dv: playQueue plays first + queues rest', () => {
  const ended: string[] = [];
  const dv = DialogVoice.create();
  dv.registerLine({ nodeId: 'a', cueId: 'a', durationMs: 100 });
  dv.registerLine({ nodeId: 'b', cueId: 'b', durationMs: 100 });
  dv.registerLine({ nodeId: 'c', cueId: 'c', durationMs: 100 });
  dv.playQueue({
    nodeIds: ['a', 'b', 'c'],
    onLineEnd: () => { ended.push(dv.getCurrent()?.nodeId ?? 'NONE'); },
  });
  // First line: 'a' is playing.
  assert.equal(dv.getCurrent()!.nodeId, 'a');
  dv.tick(150); // ends a, auto-advances to b
  assert.equal(dv.getCurrent()!.nodeId, 'b');
  dv.tick(150); // ends b, auto-advances to c
  assert.equal(dv.getCurrent()!.nodeId, 'c');
  dv.tick(150); // ends c, queue empty
  assert.equal(dv.isPlaying(), false);
});

test('dv: enqueue adds to queue without interrupting', () => {
  const dv = DialogVoice.create();
  dv.registerLine({ nodeId: 'a', cueId: 'a', durationMs: 100 });
  dv.registerLine({ nodeId: 'b', cueId: 'b', durationMs: 100 });
  dv.play('a');
  dv.enqueue('b');
  assert.equal(dv.queueLength(), 1);
  dv.tick(150);
  assert.equal(dv.getCurrent()!.nodeId, 'b');
});

test('dv: autoAdvance: false stops after current line', () => {
  const dv = DialogVoice.create();
  dv.registerLine({ nodeId: 'a', cueId: 'a', durationMs: 100 });
  dv.registerLine({ nodeId: 'b', cueId: 'b', durationMs: 100 });
  dv.playQueue({ nodeIds: ['a', 'b'], autoAdvance: false });
  dv.tick(150);
  // 'a' ended; queue not consumed.
  assert.equal(dv.isPlaying(), false);
  assert.equal(dv.queueLength(), 1);
});

test('dv: playQueue rejects unknown nodes', () => {
  const dv = DialogVoice.create();
  dv.registerLine({ nodeId: 'a', cueId: 'a', durationMs: 100 });
  assert.equal(dv.playQueue({ nodeIds: ['a', 'missing'] }), false);
  assert.equal(dv.isPlaying(), false);
});

test('dv: throwing onMarker / onLineEnd isolated', () => {
  const dv = DialogVoice.create();
  dv.registerLine({
    nodeId: 'a', cueId: 'a', durationMs: 100,
    markers: [{ atMs: 50, kind: 'boom' }],
  });
  dv.play('a', {
    onMarker: () => { throw new Error('m-boom'); },
    onLineEnd: () => { throw new Error('e-boom'); },
  });
  dv.tick(150);
  // Should not throw.
  assert.equal(dv.isPlaying(), false);
});

test('dv: NaN / negative dt no-op', () => {
  const dv = DialogVoice.create();
  dv.registerLine({ nodeId: 'a', cueId: 'a', durationMs: 1000 });
  dv.play('a');
  dv.tick(NaN);
  dv.tick(-50);
  dv.tick(Infinity);
  assert.equal(dv.getCurrent()!.elapsedMs, 0);
});

test('dv: clear empties + dispose locks', () => {
  const dv = DialogVoice.create();
  dv.registerLine({ nodeId: 'a', cueId: 'a', durationMs: 100 });
  dv.play('a');
  dv.clear();
  assert.equal(dv.lineCount(), 0);
  assert.equal(dv.isPlaying(), false);
  dv.dispose();
  assert.equal(dv.registerLine({ nodeId: 'b', cueId: 'b', durationMs: 100 }), false);
});

test('dv: realistic example - NPC dialog with phoneme markers + auto-advance', () => {
  const phonemes: string[] = [];
  let endCount = 0;
  const dv = DialogVoice.create();
  dv.registerLine({
    nodeId: 'mira_greeting',
    cueId: 'vo_mira_001',
    durationMs: 800,
    markers: [
      { atMs: 100, kind: 'phoneme', payload: { v: 'A' } },
      { atMs: 300, kind: 'phoneme', payload: { v: 'O' } },
      { atMs: 600, kind: 'phoneme', payload: { v: 'I' } },
    ],
  });
  dv.registerLine({
    nodeId: 'mira_followup', cueId: 'vo_mira_002', durationMs: 500,
  });
  dv.playQueue({
    nodeIds: ['mira_greeting', 'mira_followup'],
    onMarker: (m) => phonemes.push((m.payload as { v: string }).v),
    onLineEnd: () => { endCount++; },
  });
  dv.tick(900); // ends mira_greeting, auto-advances to mira_followup
  assert.deepEqual(phonemes, ['A', 'O', 'I']);
  assert.equal(endCount, 1);
  assert.equal(dv.getCurrent()!.nodeId, 'mira_followup');
});
