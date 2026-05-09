// Phase 1.4.3 - VoiceLineQueue tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  VoiceLineQueue,
  RESOURCE_VOICE_LINE_QUEUE,
} from '../src/index.js';

test('vlq: RESOURCE_VOICE_LINE_QUEUE is the stable string', () => {
  assert.equal(RESOURCE_VOICE_LINE_QUEUE, 'voice_line_queue');
});

test('vlq: starts not playing', () => {
  const q = VoiceLineQueue.create();
  assert.equal(q.isPlaying(), false);
});

test('vlq: enqueue + getActive', () => {
  const q = VoiceLineQueue.create();
  q.enqueue({ id: 'a', cueId: 'a', durationMs: 1000 });
  const active = q.getActive('default');
  assert.ok(active);
  assert.equal(active!.id, 'a');
  assert.equal(active!.channel, 'default');
});

test('vlq: enqueue rejects empty / invalid args', () => {
  const q = VoiceLineQueue.create();
  assert.equal(q.enqueue({ id: '', cueId: 'a', durationMs: 100 }), false);
  assert.equal(q.enqueue({ id: 'a', cueId: '', durationMs: 100 }), false);
  assert.equal(q.enqueue({ id: 'a', cueId: 'a', durationMs: -1 }), false);
});

test('vlq: enqueue rejects when disposed', () => {
  const q = VoiceLineQueue.create();
  q.dispose();
  assert.equal(q.enqueue({ id: 'a', cueId: 'a', durationMs: 100 }), false);
});

test('vlq: tick advances + completes line', () => {
  let ended = false;
  const q = VoiceLineQueue.create({ onEnd: () => { ended = true; } });
  q.enqueue({ id: 'a', cueId: 'a', durationMs: 100 });
  q.tick(50);
  assert.equal(q.isPlaying('default'), true);
  q.tick(60);
  assert.equal(ended, true);
  assert.equal(q.getActive('default'), null);
});

test('vlq: queue advances to next line on end', () => {
  const q = VoiceLineQueue.create();
  q.enqueue({ id: 'a', cueId: 'a', durationMs: 100 });
  q.enqueue({ id: 'b', cueId: 'b', durationMs: 100 });
  q.tick(150); // 'a' ends, 'b' starts
  assert.equal(q.getActive('default')!.id, 'b');
});

test('vlq: lower-priority line queued behind active', () => {
  const q = VoiceLineQueue.create();
  q.enqueue({ id: 'high', cueId: 'a', durationMs: 1000, priority: 10 });
  q.enqueue({ id: 'low', cueId: 'b', durationMs: 1000, priority: 0 });
  assert.equal(q.getActive('default')!.id, 'high');
  assert.equal(q.queueLength('default'), 1);
});

test('vlq: higher priority interrupts active', () => {
  let interrupted = false;
  const q = VoiceLineQueue.create({
    onInterrupt: () => { interrupted = true; },
  });
  q.enqueue({ id: 'low', cueId: 'a', durationMs: 1000, priority: 0 });
  q.enqueue({ id: 'high', cueId: 'b', durationMs: 1000, priority: 10 });
  assert.equal(q.getActive('default')!.id, 'high');
  assert.equal(interrupted, true);
});

test('vlq: resumeOnInterrupt re-queues interrupted line', () => {
  const q = VoiceLineQueue.create();
  q.enqueue({
    id: 'low', cueId: 'a', durationMs: 1000, priority: 0,
    resumeOnInterrupt: true,
  });
  q.tick(300); // 'low' has 700 remaining
  q.enqueue({ id: 'high', cueId: 'b', durationMs: 500, priority: 10 });
  // High plays now; low is queued at front to resume.
  assert.equal(q.getActive('default')!.id, 'high');
  assert.equal(q.queueLength('default'), 1);
  q.tick(550); // high ends, low resumes
  assert.equal(q.getActive('default')!.id, 'low');
  // Low's elapsedMs should be preserved at 300.
  assert.equal(q.getActive('default')!.elapsedMs, 300);
});

test('vlq: without resumeOnInterrupt, interrupted line dropped', () => {
  const q = VoiceLineQueue.create();
  q.enqueue({ id: 'low', cueId: 'a', durationMs: 1000, priority: 0 });
  q.enqueue({ id: 'high', cueId: 'b', durationMs: 100, priority: 10 });
  q.tick(150); // high ends; queue was empty (low was dropped)
  assert.equal(q.getActive('default'), null);
});

test('vlq: cancelLine on active advances to next', () => {
  const q = VoiceLineQueue.create();
  q.enqueue({ id: 'a', cueId: 'a', durationMs: 1000 });
  q.enqueue({ id: 'b', cueId: 'b', durationMs: 1000 });
  q.cancelLine('a');
  assert.equal(q.getActive('default')!.id, 'b');
});

test('vlq: cancelLine on queued removes from queue', () => {
  const q = VoiceLineQueue.create();
  q.enqueue({ id: 'a', cueId: 'a', durationMs: 1000 });
  q.enqueue({ id: 'b', cueId: 'b', durationMs: 1000 });
  q.cancelLine('b');
  assert.equal(q.queueLength('default'), 0);
});

test('vlq: cancelChannel clears active + queue', () => {
  const q = VoiceLineQueue.create();
  q.enqueue({ id: 'a', cueId: 'a', durationMs: 1000 });
  q.enqueue({ id: 'b', cueId: 'b', durationMs: 1000 });
  q.cancelChannel('default');
  assert.equal(q.getActive('default'), null);
  assert.equal(q.queueLength('default'), 0);
});

test('vlq: pauseChannel stops tick advancement', () => {
  const q = VoiceLineQueue.create();
  q.enqueue({ id: 'a', cueId: 'a', durationMs: 1000 });
  q.tick(200);
  q.pauseChannel('default');
  q.tick(500);
  assert.equal(q.getActive('default'), null); // paused channel hides active
  q.resumeChannel('default');
  // After resume, active comes back; elapsed should still be 200.
  const a = q.getActive('default');
  assert.equal(a!.elapsedMs, 200);
});

test('vlq: setChannelMute hides active without affecting queue', () => {
  const q = VoiceLineQueue.create();
  q.enqueue({ id: 'a', cueId: 'a', durationMs: 1000 });
  q.setChannelMute('default', true);
  assert.equal(q.getActive('default'), null);
  assert.equal(q.isMuted('default'), true);
  q.setChannelMute('default', false);
  assert.ok(q.getActive('default'));
});

test('vlq: independent channels play simultaneously', () => {
  const q = VoiceLineQueue.create();
  q.enqueue({ id: 'a', cueId: 'a', durationMs: 1000, channel: 'narrator' });
  q.enqueue({ id: 'b', cueId: 'b', durationMs: 1000, channel: 'system' });
  assert.equal(q.activeChannels().length, 2);
  assert.equal(q.isPlaying('narrator'), true);
  assert.equal(q.isPlaying('system'), true);
});

test('vlq: enqueuing on different channels does not interrupt', () => {
  let interrupted = false;
  const q = VoiceLineQueue.create({ onInterrupt: () => { interrupted = true; } });
  q.enqueue({ id: 'a', cueId: 'a', durationMs: 1000, channel: 'narrator' });
  q.enqueue({ id: 'b', cueId: 'b', durationMs: 1000, channel: 'system', priority: 100 });
  assert.equal(interrupted, false);
});

test('vlq: onStart fires on initial + advance + interrupt', () => {
  const starts: string[] = [];
  const q = VoiceLineQueue.create({ onStart: (l) => starts.push(l.id) });
  q.enqueue({ id: 'a', cueId: 'a', durationMs: 100 });
  q.enqueue({ id: 'b', cueId: 'b', durationMs: 100 });
  q.tick(150); // a ends, b starts
  assert.deepEqual(starts, ['a', 'b']);
});

test('vlq: throwing callbacks isolated', () => {
  const q = VoiceLineQueue.create({
    onStart: () => { throw new Error('s-boom'); },
    onEnd: () => { throw new Error('e-boom'); },
    onInterrupt: () => { throw new Error('i-boom'); },
  });
  q.enqueue({ id: 'a', cueId: 'a', durationMs: 100, priority: 0 });
  q.enqueue({ id: 'b', cueId: 'b', durationMs: 100, priority: 10 });
  q.tick(150);
  // Should not throw. b ends.
  assert.equal(q.getActive('default'), null);
});

test('vlq: NaN / negative dt no-op', () => {
  const q = VoiceLineQueue.create();
  q.enqueue({ id: 'a', cueId: 'a', durationMs: 1000 });
  q.tick(NaN);
  q.tick(-50);
  q.tick(Infinity);
  assert.equal(q.getActive('default')!.elapsedMs, 0);
});

test('vlq: dispose locks ops', () => {
  const q = VoiceLineQueue.create();
  q.enqueue({ id: 'a', cueId: 'a', durationMs: 100 });
  q.dispose();
  assert.equal(q.enqueue({ id: 'b', cueId: 'b', durationMs: 100 }), false);
  assert.equal(q.getActive('default'), null);
});

test('vlq: realistic example - boss interrupts narrator with resume', () => {
  const q = VoiceLineQueue.create();
  q.enqueue({
    id: 'narrator_intro', cueId: 'vo_intro', durationMs: 4000,
    channel: 'narrator', priority: 0, resumeOnInterrupt: true,
  });
  q.tick(1500); // narrator at 1500ms
  q.enqueue({
    id: 'boss_taunt', cueId: 'vo_boss', durationMs: 2000,
    channel: 'narrator', priority: 50,
  });
  // Boss interrupts; narrator queued for resume.
  assert.equal(q.getActive('narrator')!.id, 'boss_taunt');
  assert.equal(q.queueLength('narrator'), 1);
  q.tick(2050); // boss ends, narrator resumes
  const narrator = q.getActive('narrator');
  assert.equal(narrator!.id, 'narrator_intro');
  assert.equal(narrator!.elapsedMs, 1500); // resumed where it left off
});
