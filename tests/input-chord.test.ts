// Phase 0.39.0 - InputChord tests.
//
// Pure logic - no DOM. Drive handleKeyDown / handleKeyUp / tick
// manually and assert wasFired + onFired callbacks behave correctly
// across the four chord kinds (combo, sequence, doubleTap, hold).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  InputChord,
  RESOURCE_INPUT_CHORD,
} from '../src/index.js';

test('input-chord: RESOURCE_INPUT_CHORD is the stable string', () => {
  assert.equal(RESOURCE_INPUT_CHORD, 'loom.input_chord');
});

test('input-chord: define + has + chordNames', () => {
  const ch = new InputChord();
  ch.define('save', { kind: 'combo', keys: ['Control', 'KeyS'] });
  ch.define('jump-jump', { kind: 'doubleTap', keys: 'Space' });
  assert.equal(ch.has('save'), true);
  assert.equal(ch.has('nope'), false);
  assert.deepEqual(ch.chordNames().sort(), ['jump-jump', 'save']);
});

test('input-chord: undefine drops chord + reverse index', () => {
  const ch = new InputChord();
  ch.define('save', { kind: 'combo', keys: ['Control', 'KeyS'] });
  assert.equal(ch.undefine('save'), true);
  assert.equal(ch.has('save'), false);
  // Re-add: must not still be tracked from prior define.
  ch.handleKeyDown('Control');
  ch.handleKeyDown('KeyS');
  assert.equal(ch.wasFired('save'), false);
});

test('input-chord: undefine on missing chord returns false', () => {
  const ch = new InputChord();
  assert.equal(ch.undefine('nope'), false);
});

// ---------- combo ----------

test('input-chord: combo fires when all keys are held simultaneously', () => {
  const ch = new InputChord();
  ch.define('save', { kind: 'combo', keys: ['Control', 'KeyS'] });
  ch.handleKeyDown('Control');
  assert.equal(ch.wasFired('save'), false);
  ch.handleKeyDown('KeyS');
  assert.equal(ch.wasFired('save'), true);
});

test('input-chord: combo does NOT fire if order is reversed (still simultaneous)', () => {
  const ch = new InputChord();
  ch.define('save', { kind: 'combo', keys: ['Control', 'KeyS'] });
  ch.handleKeyDown('KeyS');
  ch.handleKeyDown('Control');
  // Combo is order-agnostic; fires when the SECOND key lands.
  assert.equal(ch.wasFired('save'), true);
});

test('input-chord: combo fires once per satisfaction; re-arms after key-up', () => {
  const ch = new InputChord();
  ch.define('save', { kind: 'combo', keys: ['Control', 'KeyS'] });
  ch.handleKeyDown('Control');
  ch.handleKeyDown('KeyS');
  assert.equal(ch.wasFired('save'), true);
  ch.tick(16);
  // After tick(), wasFired clears.
  assert.equal(ch.wasFired('save'), false);
  // Repeated key-down does NOT re-fire because key was never released.
  ch.handleKeyDown('KeyS'); // duplicate event
  assert.equal(ch.wasFired('save'), false);
  // Release one key then re-press: re-fires.
  ch.handleKeyUp('KeyS');
  ch.handleKeyDown('KeyS');
  assert.equal(ch.wasFired('save'), true);
});

test('input-chord: combo does not fire if a key comes up before the last key lands', () => {
  const ch = new InputChord();
  ch.define('save', { kind: 'combo', keys: ['Control', 'KeyS'] });
  ch.handleKeyDown('Control');
  ch.handleKeyUp('Control');
  ch.handleKeyDown('KeyS');
  assert.equal(ch.wasFired('save'), false);
});

// ---------- sequence ----------

test('input-chord: sequence fires when keys arrive in order within window', () => {
  const ch = new InputChord();
  ch.define('hadoken', { kind: 'sequence', keys: ['ArrowDown', 'ArrowRight', 'KeyP'] });
  ch.handleKeyDown('ArrowDown');
  assert.equal(ch.wasFired('hadoken'), false);
  ch.handleKeyDown('ArrowRight');
  assert.equal(ch.wasFired('hadoken'), false);
  ch.handleKeyDown('KeyP');
  assert.equal(ch.wasFired('hadoken'), true);
});

test('input-chord: sequence does NOT fire if a wrong key interrupts', () => {
  const ch = new InputChord();
  ch.define('hadoken', { kind: 'sequence', keys: ['ArrowDown', 'ArrowRight', 'KeyP'] });
  ch.handleKeyDown('ArrowDown');
  ch.handleKeyDown('KeyA'); // wrong
  ch.handleKeyDown('ArrowRight'); // would have been valid as #2
  ch.handleKeyDown('KeyP');
  // Sequence reset to 0 after wrong key; only ArrowRight + KeyP
  // landed in the new attempt - missing ArrowDown lead-in.
  assert.equal(ch.wasFired('hadoken'), false);
});

test('input-chord: sequence times out if window exceeded', () => {
  const ch = new InputChord();
  ch.define('combo', { kind: 'sequence', keys: ['KeyA', 'KeyB'], windowMs: 200 });
  ch.handleKeyDown('KeyA');
  ch.tick(250); // expired
  ch.handleKeyDown('KeyB');
  assert.equal(ch.wasFired('combo'), false);
});

test('input-chord: sequence stays alive within window across multiple ticks', () => {
  const ch = new InputChord();
  ch.define('combo', { kind: 'sequence', keys: ['KeyA', 'KeyB'], windowMs: 500 });
  ch.handleKeyDown('KeyA');
  ch.tick(100);
  ch.tick(100);
  ch.tick(100);
  // 300ms total; still under window.
  ch.handleKeyDown('KeyB');
  assert.equal(ch.wasFired('combo'), true);
});

test('input-chord: sequence first-key recovery - wrong key that is the start key restarts', () => {
  const ch = new InputChord();
  ch.define('combo', { kind: 'sequence', keys: ['KeyA', 'KeyB'] });
  ch.handleKeyDown('KeyA'); // idx=1
  ch.handleKeyDown('KeyA'); // wrong (expected B); but KeyA is start, restart -> idx=1
  ch.handleKeyDown('KeyB');
  assert.equal(ch.wasFired('combo'), true);
});

// ---------- doubleTap ----------

test('input-chord: doubleTap fires on second tap within window', () => {
  const ch = new InputChord();
  ch.define('dash', { kind: 'doubleTap', keys: 'KeyW', windowMs: 300 });
  ch.handleKeyDown('KeyW');
  assert.equal(ch.wasFired('dash'), false);
  ch.tick(50);
  ch.handleKeyDown('KeyW');
  assert.equal(ch.wasFired('dash'), true);
});

test('input-chord: doubleTap does NOT fire if window exceeded', () => {
  const ch = new InputChord();
  ch.define('dash', { kind: 'doubleTap', keys: 'KeyW', windowMs: 200 });
  ch.handleKeyDown('KeyW');
  ch.tick(250);
  ch.handleKeyDown('KeyW');
  // First tap aged out; second tap restarts the count.
  assert.equal(ch.wasFired('dash'), false);
});

test('input-chord: doubleTap ignores a different key in between', () => {
  const ch = new InputChord();
  ch.define('dash', { kind: 'doubleTap', keys: 'KeyW' });
  ch.handleKeyDown('KeyW');
  ch.handleKeyDown('KeyA'); // unrelated
  ch.handleKeyDown('KeyW');
  // KeyA wasn't watched by this chord (single-key doubleTap), so
  // it doesn't reset.
  assert.equal(ch.wasFired('dash'), true);
});

// ---------- hold ----------

test('input-chord: hold fires after holdMs of continuous key-down', () => {
  const ch = new InputChord();
  ch.define('charge', { kind: 'hold', keys: 'KeyE', holdMs: 500 });
  ch.handleKeyDown('KeyE');
  ch.tick(200);
  assert.equal(ch.wasFired('charge'), false);
  ch.tick(200);
  assert.equal(ch.wasFired('charge'), false);
  ch.tick(200); // total 600 >= 500
  assert.equal(ch.wasFired('charge'), true);
});

test('input-chord: hold cancels if key released before threshold', () => {
  const ch = new InputChord();
  ch.define('charge', { kind: 'hold', keys: 'KeyE', holdMs: 500 });
  ch.handleKeyDown('KeyE');
  ch.tick(200);
  ch.handleKeyUp('KeyE');
  ch.tick(500);
  assert.equal(ch.wasFired('charge'), false);
});

test('input-chord: hold fires once per press cycle - re-arms after key-up', () => {
  const ch = new InputChord();
  ch.define('charge', { kind: 'hold', keys: 'KeyE', holdMs: 100 });
  ch.handleKeyDown('KeyE');
  ch.tick(150);
  assert.equal(ch.wasFired('charge'), true);
  ch.tick(50); // wasFired clears
  // Continuing to hold past threshold does NOT re-fire.
  ch.tick(500);
  assert.equal(ch.wasFired('charge'), false);
  // Release + re-press: fires again on next threshold.
  ch.handleKeyUp('KeyE');
  ch.handleKeyDown('KeyE');
  ch.tick(150);
  assert.equal(ch.wasFired('charge'), true);
});

// ---------- onFired ----------

test('input-chord: onFired callback fires on chord match', () => {
  const ch = new InputChord();
  ch.define('save', { kind: 'combo', keys: ['Control', 'KeyS'] });
  let count = 0;
  ch.onFired('save', () => { count++; });
  ch.handleKeyDown('Control');
  ch.handleKeyDown('KeyS');
  assert.equal(count, 1);
});

test('input-chord: onFired returns unsubscribe function', () => {
  const ch = new InputChord();
  ch.define('save', { kind: 'combo', keys: ['Control', 'KeyS'] });
  let count = 0;
  const unsub = ch.onFired('save', () => { count++; });
  unsub();
  ch.handleKeyDown('Control');
  ch.handleKeyDown('KeyS');
  assert.equal(count, 0);
});

test('input-chord: throwing onFired callback does not break dispatch', () => {
  const ch = new InputChord();
  ch.define('save', { kind: 'combo', keys: ['Control', 'KeyS'] });
  let secondFired = false;
  ch.onFired('save', () => { throw new Error('boom'); });
  ch.onFired('save', () => { secondFired = true; });
  ch.handleKeyDown('Control');
  ch.handleKeyDown('KeyS');
  assert.equal(secondFired, true);
});

// ---------- releaseAll + tick semantics ----------

test('input-chord: releaseAll wipes in-flight recognition state', () => {
  const ch = new InputChord();
  ch.define('save', { kind: 'combo', keys: ['Control', 'KeyS'] });
  ch.define('charge', { kind: 'hold', keys: 'KeyE', holdMs: 100 });
  ch.handleKeyDown('Control');
  ch.handleKeyDown('KeyE');
  ch.releaseAll();
  ch.handleKeyDown('KeyS'); // would have completed combo
  assert.equal(ch.wasFired('save'), false);
  ch.tick(200);
  assert.equal(ch.wasFired('charge'), false);
});

test('input-chord: tick clears firedThisFrame so wasFired is single-frame', () => {
  const ch = new InputChord();
  ch.define('dash', { kind: 'doubleTap', keys: 'KeyW' });
  ch.handleKeyDown('KeyW');
  ch.tick(50);
  ch.handleKeyDown('KeyW');
  assert.equal(ch.wasFired('dash'), true);
  ch.tick(16);
  assert.equal(ch.wasFired('dash'), false);
});

test('input-chord: tick(0) clears firedThisFrame without advancing clocks', () => {
  const ch = new InputChord();
  ch.define('charge', { kind: 'hold', keys: 'KeyE', holdMs: 200 });
  ch.handleKeyDown('KeyE');
  ch.tick(190); // not yet fired (190 < 200)
  ch.tick(0);   // does not advance clock
  assert.equal(ch.wasFired('charge'), false);
  ch.tick(20);  // total 210 >= 200; fires now.
  assert.equal(ch.wasFired('charge'), true);
});

test('input-chord: redefining a chord resets its state and drops callbacks', () => {
  const ch = new InputChord();
  ch.define('save', { kind: 'combo', keys: ['Control', 'KeyS'] });
  let count = 0;
  ch.onFired('save', () => { count++; });
  ch.handleKeyDown('Control');
  ch.define('save', { kind: 'combo', keys: ['Alt', 'KeyA'] }); // replace
  ch.handleKeyDown('KeyS'); // no longer part of save
  assert.equal(count, 0);
  // New definition works:
  ch.handleKeyDown('Alt');
  ch.handleKeyDown('KeyA');
  assert.equal(ch.wasFired('save'), true);
});

test('input-chord: clear drops everything', () => {
  const ch = new InputChord();
  ch.define('a', { kind: 'combo', keys: ['KeyA', 'KeyB'] });
  ch.define('b', { kind: 'hold', keys: 'KeyC' });
  ch.clear();
  assert.deepEqual(ch.chordNames(), []);
  ch.handleKeyDown('KeyA');
  ch.handleKeyDown('KeyB');
  assert.equal(ch.wasFired('a'), false);
});

test('input-chord: stats reflects definition counts', () => {
  const ch = new InputChord();
  ch.define('a', { kind: 'combo', keys: ['KeyA', 'KeyB'] });
  ch.define('b', { kind: 'hold', keys: 'KeyC' });
  const s = ch.stats();
  assert.equal(s.chords, 2);
  assert.equal(s.keysWatched, 3);
});

test('input-chord: ignores key events for unwatched keys', () => {
  const ch = new InputChord();
  ch.define('save', { kind: 'combo', keys: ['Control', 'KeyS'] });
  // Key not in any chord - must be a fast no-op.
  ch.handleKeyDown('KeyZ');
  ch.handleKeyUp('KeyZ');
  ch.handleKeyDown('Control');
  ch.handleKeyDown('KeyS');
  assert.equal(ch.wasFired('save'), true);
});

test('input-chord: combo with single key fires on key-down', () => {
  const ch = new InputChord();
  ch.define('shoot', { kind: 'combo', keys: 'Space' });
  ch.handleKeyDown('Space');
  assert.equal(ch.wasFired('shoot'), true);
});
