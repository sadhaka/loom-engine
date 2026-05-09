// Phase 1.3.2 - EmotionState tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  EmotionState,
  RESOURCE_EMOTION_STATE,
} from '../src/index.js';

test('emo: RESOURCE_EMOTION_STATE is the stable string', () => {
  assert.equal(RESOURCE_EMOTION_STATE, 'emotion_state');
});

test('emo: starts empty', () => {
  const e = EmotionState.create();
  assert.equal(e.entryCount(), 0);
  assert.equal(e.emotionCount(), 0);
});

test('emo: defineEmotion + hasEmotion + emotionIds', () => {
  const e = EmotionState.create();
  e.defineEmotion({ id: 'fear', decayHalfLifeMs: 4000 });
  e.defineEmotion({ id: 'joy' });
  assert.equal(e.hasEmotion('fear'), true);
  assert.deepEqual(e.emotionIds().sort(), ['fear', 'joy']);
});

test('emo: defineEmotion rejects empty id', () => {
  const e = EmotionState.create();
  assert.equal(e.defineEmotion({ id: '' }), false);
});

test('emo: pulse adds delta + clamps to [-1, 1]', () => {
  const e = EmotionState.create();
  e.pulse('mira', 'fear', 0.3);
  e.pulse('mira', 'fear', 0.4);
  assert.ok(Math.abs(e.getValue('mira', 'fear') - 0.7) < 1e-6);
  e.pulse('mira', 'fear', 5);
  assert.equal(e.getValue('mira', 'fear'), 1);
});

test('emo: pulse auto-defines emotion spec', () => {
  const e = EmotionState.create();
  e.pulse('mira', 'newemo', 0.5);
  assert.equal(e.hasEmotion('newemo'), true);
});

test('emo: pulse rejects empty / NaN args', () => {
  const e = EmotionState.create();
  assert.equal(e.pulse('', 'fear', 0.5), null);
  assert.equal(e.pulse('mira', '', 0.5), null);
  assert.equal(e.pulse('mira', 'fear', NaN), null);
});

test('emo: set replaces value', () => {
  const e = EmotionState.create();
  e.pulse('mira', 'fear', 0.5);
  e.set('mira', 'fear', 0.9);
  assert.ok(Math.abs(e.getValue('mira', 'fear') - 0.9) < 1e-6);
});

test('emo: get returns snapshot with peak', () => {
  const e = EmotionState.create();
  e.pulse('mira', 'fear', 0.7);
  e.pulse('mira', 'fear', -0.5);
  const snap = e.get('mira', 'fear');
  assert.ok(snap);
  assert.ok(Math.abs(snap!.peakValue - 0.7) < 1e-6);
});

test('emo: peak tracks absolute max not just current', () => {
  const e = EmotionState.create();
  e.pulse('mira', 'anger', 0.8);
  e.pulse('mira', 'anger', -1.5); // raw = -0.7, clamped = -0.7
  // Peak = max(0.8, |-0.7|) = 0.8.
  assert.ok(Math.abs(e.get('mira', 'anger')!.peakValue - 0.8) < 1e-6);
});

test('emo: resetPeaks clears peak tracking', () => {
  const e = EmotionState.create();
  e.pulse('mira', 'fear', 0.9);
  assert.ok(Math.abs(e.get('mira', 'fear')!.peakValue - 0.9) < 1e-6);
  e.resetPeaks('mira');
  // Peak resets to current absolute value.
  const snap = e.get('mira', 'fear');
  assert.ok(Math.abs(snap!.peakValue - Math.abs(snap!.value)) < 1e-6);
});

test('emo: tick decays toward baseline', () => {
  const e = EmotionState.create();
  e.defineEmotion({ id: 'fear', baseline: 0, decayHalfLifeMs: 1000 });
  e.pulse('mira', 'fear', 0.8);
  e.tick(1000); // one half-life
  const v = e.getValue('mira', 'fear');
  assert.ok(Math.abs(v - 0.4) < 0.01);
});

test('emo: tick with decayHalfLifeMs=0 no decay', () => {
  const e = EmotionState.create();
  e.defineEmotion({ id: 'fear', decayHalfLifeMs: 0 });
  e.pulse('mira', 'fear', 0.8);
  e.tick(60000);
  assert.equal(e.getValue('mira', 'fear'), 0.8);
});

test('emo: tick decays toward non-zero baseline', () => {
  const e = EmotionState.create();
  e.defineEmotion({ id: 'mood', baseline: 0.3, decayHalfLifeMs: 1000 });
  e.pulse('mira', 'mood', 0.7); // raw = 0.3 (baseline init) + 0.7 = 1.0, clamped = 1
  e.tick(1000); // halfway from raw 1 toward 0.3 = 0.65
  const v = e.getValue('mira', 'mood');
  assert.ok(Math.abs(v - 0.65) < 0.01);
});

test('emo: thresholds fire on upward cross', () => {
  let crossed = 0;
  const e = EmotionState.create();
  e.defineEmotion({
    id: 'anger', decayHalfLifeMs: 0,
    thresholds: [{ id: 'rage', level: 0.8, onCross: () => { crossed++; } }],
  });
  e.pulse('mira', 'anger', 0.5);
  assert.equal(crossed, 0);
  e.pulse('mira', 'anger', 0.4); // total 0.9, crosses 0.8
  assert.equal(crossed, 1);
});

test('emo: thresholds re-arm after falling below', () => {
  let crossed = 0;
  const e = EmotionState.create();
  e.defineEmotion({
    id: 'anger', baseline: 0, decayHalfLifeMs: 1000,
    thresholds: [{ level: 0.7, onCross: () => { crossed++; } }],
  });
  e.pulse('mira', 'anger', 0.9); // crosses up
  assert.equal(crossed, 1);
  // No re-fire on subsequent pulses while still above.
  e.pulse('mira', 'anger', 0.05);
  assert.equal(crossed, 1);
  // Decay below threshold, then pulse back up.
  e.tick(2000); // value drops below 0.7
  e.pulse('mira', 'anger', 0.5); // crosses up again
  assert.equal(crossed, 2);
});

test('emo: throwing threshold callback isolated', () => {
  const e = EmotionState.create();
  e.defineEmotion({
    id: 'anger', decayHalfLifeMs: 0,
    thresholds: [{ level: 0.5, onCross: () => { throw new Error('boom'); } }],
  });
  e.pulse('mira', 'anger', 0.6); // should not throw
  assert.equal(e.has('mira', 'anger'), true);
});

test('emo: forCharacter returns all emotions for one character', () => {
  const e = EmotionState.create();
  e.pulse('mira', 'fear', 0.5);
  e.pulse('mira', 'joy', 0.3);
  e.pulse('thane', 'fear', 0.8);
  const list = e.forCharacter('mira');
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((x) => x.emotionId).sort(), ['fear', 'joy']);
});

test('emo: dominant picks emotion with highest absolute value', () => {
  const e = EmotionState.create();
  e.pulse('mira', 'fear', 0.4);
  e.pulse('mira', 'anger', 0.7);
  e.pulse('mira', 'joy', 0.3);
  const dom = e.dominant('mira');
  assert.equal(dom!.emotionId, 'anger');
});

test('emo: dominant picks negative-signed emotion if larger magnitude', () => {
  const e = EmotionState.create();
  e.pulse('mira', 'fear', 0.4);
  e.pulse('mira', 'anger', -0.9);
  const dom = e.dominant('mira');
  assert.equal(dom!.emotionId, 'anger');
  assert.ok(dom!.value < 0);
});

test('emo: dominant returns null when no emotions', () => {
  const e = EmotionState.create();
  assert.equal(e.dominant('mira'), null);
});

test('emo: isAbove / isBelow', () => {
  const e = EmotionState.create();
  e.pulse('mira', 'fear', 0.6);
  assert.equal(e.isAbove('mira', 'fear', 0.5), true);
  assert.equal(e.isAbove('mira', 'fear', 0.7), false);
  assert.equal(e.isBelow('mira', 'fear', 0.7), true);
});

test('emo: removeEmotion drops spec + all entries', () => {
  const e = EmotionState.create();
  e.pulse('mira', 'fear', 0.5);
  e.pulse('thane', 'fear', 0.7);
  e.pulse('mira', 'joy', 0.3);
  e.removeEmotion('fear');
  assert.equal(e.has('mira', 'fear'), false);
  assert.equal(e.has('thane', 'fear'), false);
  assert.equal(e.has('mira', 'joy'), true);
});

test('emo: onChange fires on pulse / set / decay', () => {
  let count = 0;
  const e = EmotionState.create({ onChange: () => { count++; } });
  e.defineEmotion({ id: 'fear', decayHalfLifeMs: 1000 });
  e.pulse('mira', 'fear', 0.5);
  e.set('mira', 'fear', 0.7);
  e.tick(500);
  assert.ok(count >= 3);
});

test('emo: throwing onChange isolated', () => {
  const e = EmotionState.create({
    onChange: () => { throw new Error('boom'); },
  });
  e.pulse('mira', 'fear', 0.5); // should not throw
  assert.equal(e.has('mira', 'fear'), true);
});

test('emo: NaN / negative dt no-op', () => {
  const e = EmotionState.create();
  e.defineEmotion({ id: 'fear', decayHalfLifeMs: 1000 });
  e.pulse('mira', 'fear', 0.8);
  e.tick(NaN);
  e.tick(-50);
  e.tick(Infinity);
  assert.equal(e.getValue('mira', 'fear'), 0.8);
});

test('emo: clear empties everything', () => {
  const e = EmotionState.create();
  e.defineEmotion({ id: 'fear' });
  e.pulse('mira', 'fear', 0.5);
  e.clear();
  assert.equal(e.entryCount(), 0);
  assert.equal(e.emotionCount(), 0);
});

test('emo: dispose locks ops', () => {
  const e = EmotionState.create();
  e.pulse('mira', 'fear', 0.5);
  e.dispose();
  assert.equal(e.pulse('thane', 'joy', 0.5), null);
  assert.equal(e.entryCount(), 0);
});

test('emo: realistic example - panic state with rage threshold', () => {
  let panicTriggered = false;
  const e = EmotionState.create();
  e.defineEmotion({
    id: 'fear', baseline: 0, decayHalfLifeMs: 4000,
    thresholds: [{
      id: 'panic', level: 0.85,
      onCross: () => { panicTriggered = true; },
    }],
  });
  e.defineEmotion({ id: 'joy', decayHalfLifeMs: 8000 });

  // Mira sees a wolf: small fear pulse.
  e.pulse('mira', 'fear', 0.3);
  assert.equal(panicTriggered, false);

  // Wolf charges: fear spikes.
  e.pulse('mira', 'fear', 0.6); // total 0.9, crosses 0.85
  assert.equal(panicTriggered, true);

  // Dominant emotion = fear.
  const dom = e.dominant('mira');
  assert.equal(dom!.emotionId, 'fear');

  // After 8s, fear has decayed; pulse joy on rescue.
  e.tick(8000);
  e.pulse('mira', 'joy', 0.5);
  const dom2 = e.dominant('mira');
  assert.equal(dom2!.emotionId, 'joy');
});
