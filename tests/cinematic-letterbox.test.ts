// Phase 1.4.4 - CinematicLetterbox tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  CinematicLetterbox,
  RESOURCE_CINEMATIC_LETTERBOX,
} from '../src/index.js';

test('lb: RESOURCE_CINEMATIC_LETTERBOX is the stable string', () => {
  assert.equal(RESOURCE_CINEMATIC_LETTERBOX, 'cinematic_letterbox');
});

test('lb: starts open', () => {
  const lb = CinematicLetterbox.create();
  const s = lb.getState();
  assert.equal(s.current, 0);
  assert.equal(s.target, 0);
  assert.equal(s.topBarPct, 0);
  assert.equal(s.bottomBarPct, 0);
  assert.equal(lb.isOpen(), true);
  assert.equal(lb.isAnimating(), false);
});

test('lb: close animates target -> 1', () => {
  const lb = CinematicLetterbox.create({ defaultBarPct: 0.1, defaultFadeMs: 1000 });
  lb.close();
  assert.equal(lb.getState().target, 1);
  lb.tick(500);
  // Halfway: current = 0.5, topBarPct = 0.5 * 0.1 = 0.05.
  const s = lb.getState();
  assert.ok(Math.abs(s.current - 0.5) < 0.01);
  assert.ok(Math.abs(s.topBarPct - 0.05) < 0.01);
  lb.tick(500);
  assert.equal(lb.isClosed(), true);
});

test('lb: open animates target -> 0', () => {
  const lb = CinematicLetterbox.create({ defaultFadeMs: 500 });
  lb.close({ fadeMs: 0 }); // snap closed
  assert.equal(lb.isClosed(), true);
  lb.open();
  lb.tick(500);
  assert.equal(lb.isOpen(), true);
});

test('lb: close fadeMs=0 snaps immediately', () => {
  const lb = CinematicLetterbox.create({ defaultBarPct: 0.15 });
  lb.close({ fadeMs: 0 });
  assert.equal(lb.isClosed(), true);
  assert.equal(lb.getState().topBarPct, 0.15);
});

test('lb: close with custom barPct overrides default', () => {
  const lb = CinematicLetterbox.create({ defaultBarPct: 0.1 });
  lb.close({ barPct: 0.2, fadeMs: 0 });
  assert.equal(lb.getState().topBarPct, 0.2);
});

test('lb: setTarget manual control', () => {
  const lb = CinematicLetterbox.create({ defaultBarPct: 0.1, defaultFadeMs: 0 });
  lb.setTarget(0.5);
  assert.equal(lb.getState().current, 0.5);
  assert.ok(Math.abs(lb.getState().topBarPct - 0.05) < 1e-6);
});

test('lb: setTarget clamps to [0, 1]', () => {
  const lb = CinematicLetterbox.create({ defaultFadeMs: 0 });
  lb.setTarget(5);
  assert.equal(lb.getState().current, 1);
  lb.setTarget(-1);
  assert.equal(lb.getState().current, 0);
});

test('lb: toggle flips between open / closed', () => {
  const lb = CinematicLetterbox.create({ defaultFadeMs: 0 });
  lb.toggle();
  assert.equal(lb.isClosed(), true);
  lb.toggle();
  assert.equal(lb.isOpen(), true);
});

test('lb: pulse closes, holds, then opens', () => {
  const lb = CinematicLetterbox.create({ defaultBarPct: 0.1 });
  let completed = false;
  lb.pulse({ holdMs: 500, fadeMs: 200, onComplete: () => { completed = true; } });
  // Closing phase.
  lb.tick(200); // close complete
  assert.ok(lb.getState().current > 0.99);
  // Hold.
  lb.tick(250);
  assert.ok(lb.getState().current > 0.99);
  // Hold ends + opening starts.
  lb.tick(250); // hold ends, opening starts
  // Opening phase complete after another 200ms.
  lb.tick(200);
  // Pulse complete.
  assert.equal(completed, true);
  assert.equal(lb.isOpen(), true);
});

test('lb: pulse with custom barPct', () => {
  const lb = CinematicLetterbox.create({ defaultBarPct: 0.1 });
  lb.pulse({ barPct: 0.3, holdMs: 100, fadeMs: 100 });
  lb.tick(100); // close
  assert.ok(Math.abs(lb.getState().topBarPct - 0.3) < 0.01);
});

test('lb: isAnimating during fade', () => {
  const lb = CinematicLetterbox.create({ defaultFadeMs: 500 });
  assert.equal(lb.isAnimating(), false);
  lb.close();
  assert.equal(lb.isAnimating(), true);
  lb.tick(500);
  assert.equal(lb.isAnimating(), false);
});

test('lb: NaN / negative dt no-op', () => {
  const lb = CinematicLetterbox.create();
  lb.close();
  lb.tick(NaN);
  lb.tick(-50);
  lb.tick(Infinity);
  assert.equal(lb.getState().current, 0); // didn't advance
});

test('lb: throwing onComplete isolated', () => {
  const lb = CinematicLetterbox.create();
  lb.pulse({
    holdMs: 0, fadeMs: 0,
    onComplete: () => { throw new Error('boom'); },
  });
  lb.tick(1); // close
  lb.tick(1); // hold (0)
  lb.tick(1); // open
  // Should not throw.
  assert.equal(lb.isOpen(), true);
});

test('lb: dispose locks ops', () => {
  const lb = CinematicLetterbox.create();
  lb.close();
  lb.dispose();
  lb.tick(500);
  // Should be at rest.
  assert.equal(lb.isOpen(), true);
});

test('lb: realistic example - boss reveal cinematic', () => {
  let revealed = false;
  const lb = CinematicLetterbox.create({
    defaultBarPct: 0.15, defaultFadeMs: 600,
  });
  // Boss reveal: pulse for 4 seconds.
  lb.pulse({
    holdMs: 4000, fadeMs: 600,
    onComplete: () => { revealed = true; },
  });
  // Closing.
  lb.tick(600);
  assert.ok(lb.getState().topBarPct > 0.14);
  // Hold for 4s.
  lb.tick(4000);
  // Open phase.
  lb.tick(600);
  assert.equal(revealed, true);
  assert.equal(lb.isOpen(), true);
});
