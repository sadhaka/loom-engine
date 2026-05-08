// Phase 0.60.0 - ReplayRecorder tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  ReplayRecorder,
  RESOURCE_REPLAY_RECORDER,
} from '../src/index.js';

test('replay-recorder: RESOURCE_REPLAY_RECORDER is the stable string', () => {
  assert.equal(RESOURCE_REPLAY_RECORDER, 'replay_recorder');
});

test('replay-recorder: starts idle', () => {
  const r = ReplayRecorder.create();
  assert.equal(r.getMode(), 'idle');
  assert.equal(r.stepCount(), 0);
});

test('replay-recorder: stamps initial seed + engine version', () => {
  const r = ReplayRecorder.create({ initialSeed: 42, engineVersion: '0.60.0' });
  assert.equal(r.getInitialSeed(), 42);
  assert.equal(r.getEngineVersion(), '0.60.0');
});

test('replay-recorder: startRecording -> mode = recording', () => {
  const r = ReplayRecorder.create();
  r.startRecording();
  assert.equal(r.getMode(), 'recording');
});

test('replay-recorder: cannot startRecording from playback mode', () => {
  const r = ReplayRecorder.create();
  r.startRecording();
  r.recordTick(16);
  r.stopRecording();
  r.startPlayback();
  assert.throws(() => r.startRecording(), /cannot start/);
});

test('replay-recorder: recordTick captures dt + advances step count', () => {
  const r = ReplayRecorder.create();
  r.startRecording();
  r.recordTick(16);
  r.recordTick(17);
  r.recordTick(16);
  assert.equal(r.stepCount(), 3);
});

test('replay-recorder: recordEvent buffers until next recordTick', () => {
  const r = ReplayRecorder.create();
  r.startRecording();
  r.recordEvent('keydown', 'KeyW');
  r.recordEvent('keydown', 'KeyA');
  const step = r.recordTick(16);
  assert.ok(step !== null);
  assert.equal(step!.events.length, 2);
  assert.equal(step!.events[0]!.type, 'keydown');
  assert.equal(step!.events[0]!.key, 'KeyW');
});

test('replay-recorder: events without recordTick stay buffered', () => {
  const r = ReplayRecorder.create();
  r.startRecording();
  r.recordEvent('a');
  r.recordEvent('b');
  // No tick yet -> step count still 0.
  assert.equal(r.stepCount(), 0);
  // Next tick should attach both.
  const step = r.recordTick(16);
  assert.equal(step!.events.length, 2);
});

test('replay-recorder: recordEvent ignores empty type', () => {
  const r = ReplayRecorder.create();
  r.startRecording();
  r.recordEvent('');
  const step = r.recordTick(16);
  assert.equal(step!.events.length, 0);
});

test('replay-recorder: recordEvent before startRecording is a no-op', () => {
  const r = ReplayRecorder.create();
  r.recordEvent('kd', 'W');
  r.startRecording();
  const step = r.recordTick(16);
  assert.equal(step!.events.length, 0);
});

test('replay-recorder: recordTick before startRecording returns null', () => {
  const r = ReplayRecorder.create();
  const step = r.recordTick(16);
  assert.equal(step, null);
});

test('replay-recorder: maxSteps caps the recording at the latest N', () => {
  const r = ReplayRecorder.create({ maxSteps: 3 });
  r.startRecording();
  for (var i = 0; i < 10; i++) r.recordTick(i + 1);
  // Only the last 3 steps retained.
  assert.equal(r.stepCount(), 3);
});

test('replay-recorder: stopRecording transitions to finished', () => {
  const r = ReplayRecorder.create();
  r.startRecording();
  r.recordTick(16);
  r.stopRecording();
  assert.equal(r.getMode(), 'finished');
});

// ---------- Playback ----------

test('replay-recorder: startPlayback resets cursor to 0', () => {
  const r = ReplayRecorder.create();
  r.startRecording();
  r.recordTick(16);
  r.recordTick(17);
  r.stopRecording();
  r.startPlayback();
  assert.equal(r.getMode(), 'playback');
  assert.equal(r.hasNextStep(), true);
});

test('replay-recorder: nextStep yields steps in order', () => {
  const r = ReplayRecorder.create();
  r.startRecording();
  r.recordEvent('a');
  r.recordTick(16);
  r.recordEvent('b');
  r.recordTick(17);
  r.stopRecording();
  r.startPlayback();
  const s1 = r.nextStep();
  const s2 = r.nextStep();
  assert.equal(s1!.dtMs, 16);
  assert.equal(s1!.events[0]!.type, 'a');
  assert.equal(s2!.dtMs, 17);
  assert.equal(s2!.events[0]!.type, 'b');
});

test('replay-recorder: nextStep returns null at end of trace', () => {
  const r = ReplayRecorder.create();
  r.startRecording();
  r.recordTick(16);
  r.stopRecording();
  r.startPlayback();
  r.nextStep();
  assert.equal(r.nextStep(), null);
  // Mode transitions to 'finished'.
  assert.equal(r.getMode(), 'finished');
});

test('replay-recorder: hasNextStep reflects state', () => {
  const r = ReplayRecorder.create();
  r.startRecording();
  r.recordTick(16);
  r.recordTick(17);
  r.stopRecording();
  // Idle / finished -> false.
  assert.equal(r.hasNextStep(), false);
  r.startPlayback();
  assert.equal(r.hasNextStep(), true);
  r.nextStep();
  assert.equal(r.hasNextStep(), true);
  r.nextStep();
  assert.equal(r.hasNextStep(), false);
});

test('replay-recorder: rewind resets the playback cursor', () => {
  const r = ReplayRecorder.create();
  r.startRecording();
  r.recordTick(16);
  r.recordTick(17);
  r.stopRecording();
  r.startPlayback();
  r.nextStep();
  r.rewind();
  // First nextStep again.
  const s = r.nextStep();
  assert.equal(s!.dtMs, 16);
});

test('replay-recorder: rewind no-op outside playback mode', () => {
  const r = ReplayRecorder.create();
  r.rewind();  // idle
  // Just shouldn't throw.
  assert.equal(r.getMode(), 'idle');
});

test('replay-recorder: stopPlayback transitions to finished', () => {
  const r = ReplayRecorder.create();
  r.startRecording();
  r.recordTick(16);
  r.stopRecording();
  r.startPlayback();
  r.stopPlayback();
  assert.equal(r.getMode(), 'finished');
});

test('replay-recorder: cannot startPlayback while recording', () => {
  const r = ReplayRecorder.create();
  r.startRecording();
  assert.throws(() => r.startPlayback(), /stop recording first/);
});

// ---------- Serialization ----------

test('replay-recorder: toTrace produces JSON-safe envelope', () => {
  const r = ReplayRecorder.create({ initialSeed: 42, engineVersion: '0.60.0' });
  r.startRecording();
  r.recordEvent('keydown', 'KeyW', { repeat: false });
  r.recordTick(16);
  r.stopRecording();
  const trace = r.toTrace();
  assert.equal(trace.version, 1);
  assert.equal(trace.engineVersion, '0.60.0');
  assert.equal(trace.initialSeed, 42);
  assert.equal(trace.steps.length, 1);
  assert.equal(trace.steps[0]!.events[0]!.key, 'KeyW');
  // Round-trip through JSON.
  const json = JSON.stringify(trace);
  const back = JSON.parse(json);
  assert.equal(back.steps[0].events[0].data.repeat, false);
});

test('replay-recorder: fromTrace + nextStep reproduces the recording', () => {
  const r = ReplayRecorder.create({ initialSeed: 1234 });
  r.startRecording();
  r.recordEvent('keydown', 'KeyW');
  r.recordTick(16);
  r.recordEvent('keyup', 'KeyW');
  r.recordTick(17);
  r.recordTick(16);
  r.stopRecording();
  const trace = r.toTrace();
  const r2 = ReplayRecorder.fromTrace(trace);
  assert.equal(r2.getInitialSeed(), 1234);
  assert.equal(r2.stepCount(), 3);
  r2.startPlayback();
  const s1 = r2.nextStep();
  const s2 = r2.nextStep();
  const s3 = r2.nextStep();
  assert.equal(s1!.dtMs, 16);
  assert.equal(s1!.events[0]!.type, 'keydown');
  assert.equal(s2!.dtMs, 17);
  assert.equal(s2!.events[0]!.type, 'keyup');
  assert.equal(s3!.dtMs, 16);
  assert.equal(s3!.events.length, 0);
});

test('replay-recorder: attachInitialSnapshot survives toTrace + fromTrace', () => {
  const r = ReplayRecorder.create();
  r.attachInitialSnapshot({ schemaVersion: 1, world: 'frozen' });
  r.startRecording();
  r.recordTick(16);
  r.stopRecording();
  const trace = r.toTrace();
  const back = ReplayRecorder.fromTrace(trace);
  assert.deepEqual(back.getInitialSnapshot(), { schemaVersion: 1, world: 'frozen' });
});

test('replay-recorder: nextStep returns defensive copies of events', () => {
  const r = ReplayRecorder.create();
  r.startRecording();
  r.recordEvent('a', 'k', { x: 1 });
  r.recordTick(16);
  r.stopRecording();
  r.startPlayback();
  const s = r.nextStep()!;
  s.events[0]!.type = 'mutated';
  // Original step in recorder unchanged.
  r.rewind();
  const s2 = r.nextStep()!;
  assert.equal(s2.events[0]!.type, 'a');
});

test('replay-recorder: realistic example - record + replay an input session', () => {
  const r = ReplayRecorder.create({ initialSeed: 100 });
  r.attachInitialSnapshot({ hp: 100, x: 0, y: 0 });
  r.startRecording();
  // Simulate a 5-frame session with 3 inputs.
  r.recordEvent('keydown', 'KeyD');
  r.recordTick(16);
  r.recordTick(16);
  r.recordEvent('keyup', 'KeyD');
  r.recordEvent('keydown', 'Space');
  r.recordTick(16);
  r.recordTick(16);
  r.recordEvent('keyup', 'Space');
  r.recordTick(16);
  r.stopRecording();
  // 5 steps recorded.
  assert.equal(r.stepCount(), 5);
  // Replay.
  r.startPlayback();
  let totalDt = 0;
  let totalEvents = 0;
  while (r.hasNextStep()) {
    const step = r.nextStep()!;
    totalDt += step.dtMs;
    totalEvents += step.events.length;
  }
  assert.equal(totalDt, 16 * 5);
  assert.equal(totalEvents, 4); // keydown KeyD, keyup+keydown, keyup
});
