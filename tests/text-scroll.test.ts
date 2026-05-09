// Phase 0.79.0 - TextScroll tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  TextScroll,
  RESOURCE_TEXT_SCROLL,
} from '../src/index.js';

test('text-scroll: RESOURCE_TEXT_SCROLL is the stable string', () => {
  assert.equal(RESOURCE_TEXT_SCROLL, 'text_scroll');
});

test('text-scroll: start sets text + visible empty initially', () => {
  const ts = TextScroll.create();
  ts.start('Hello');
  assert.equal(ts.fullText(), 'Hello');
  assert.equal(ts.visibleText(), '');
  assert.equal(ts.revealedCount(), 0);
  assert.equal(ts.totalCount(), 5);
  assert.equal(ts.isComplete(), false);
});

test('text-scroll: tick reveals chars at the configured rate', () => {
  const ts = TextScroll.create({ charsPerSecond: 1000, punctPauseMs: {} });
  ts.start('abcde');
  ts.tick(2); // 2ms / 1ms per char = 2 chars
  assert.equal(ts.visibleText(), 'ab');
  ts.tick(3); // 3 more chars
  assert.equal(ts.visibleText(), 'abcde');
  assert.ok(ts.isComplete());
});

test('text-scroll: punctuation pauses delay reveal', () => {
  const ts = TextScroll.create({
    charsPerSecond: 1000,
    punctPauseMs: { '.': 100 },
  });
  ts.start('a.b');
  ts.tick(1); // reveal 'a'
  assert.equal(ts.visibleText(), 'a');
  ts.tick(1); // reveal '.', triggers 100ms pause
  assert.equal(ts.visibleText(), 'a.');
  ts.tick(50); // partial pause - no more revealed
  assert.equal(ts.visibleText(), 'a.');
  ts.tick(60); // pause finished, then 10ms remainder = 10 chars worth
  assert.equal(ts.visibleText(), 'a.b');
});

test('text-scroll: skip jumps to full + fires onComplete', () => {
  let completes = 0;
  const ts = TextScroll.create({
    onComplete: () => { completes++; },
  });
  ts.start('abc');
  ts.skip();
  assert.equal(ts.visibleText(), 'abc');
  assert.ok(ts.isComplete());
  assert.equal(completes, 1);
});

test('text-scroll: pause / resume', () => {
  const ts = TextScroll.create({ charsPerSecond: 1000, punctPauseMs: {} });
  ts.start('abcde');
  ts.tick(2);
  assert.equal(ts.visibleText(), 'ab');
  ts.pause();
  assert.ok(ts.isPaused());
  ts.tick(1000);
  assert.equal(ts.visibleText(), 'ab'); // unchanged
  ts.resume();
  ts.tick(3);
  assert.equal(ts.visibleText(), 'abcde');
});

test('text-scroll: clear empties everything', () => {
  const ts = TextScroll.create();
  ts.start('hello');
  ts.skip();
  ts.clear();
  assert.equal(ts.fullText(), '');
  assert.equal(ts.visibleText(), '');
  assert.equal(ts.totalCount(), 0);
});

test('text-scroll: onChar fires per revealed character', () => {
  const chars: string[] = [];
  const ts = TextScroll.create({
    charsPerSecond: 1000,
    punctPauseMs: {},
    onChar: (c) => chars.push(c),
  });
  ts.start('abc');
  ts.tick(3);
  assert.deepEqual(chars, ['a', 'b', 'c']);
});

test('text-scroll: onComplete fires once', () => {
  let completes = 0;
  const ts = TextScroll.create({
    charsPerSecond: 1000,
    punctPauseMs: {},
    onComplete: () => { completes++; },
  });
  ts.start('abc');
  ts.tick(3);
  assert.equal(completes, 1);
  ts.tick(100);
  assert.equal(completes, 1); // not re-fired
});

test('text-scroll: append extends mid-scroll without resetting', () => {
  const ts = TextScroll.create({ charsPerSecond: 1000, punctPauseMs: {} });
  ts.start('abc');
  ts.tick(2);
  assert.equal(ts.visibleText(), 'ab');
  ts.append('def');
  ts.tick(4);
  assert.equal(ts.visibleText(), 'abcdef');
});

test('text-scroll: append after complete re-arms onComplete', () => {
  let completes = 0;
  const ts = TextScroll.create({
    charsPerSecond: 1000,
    punctPauseMs: {},
    onComplete: () => { completes++; },
  });
  ts.start('ab');
  ts.tick(2);
  assert.equal(completes, 1);
  ts.append('cd');
  ts.tick(2);
  assert.equal(completes, 2);
});

test('text-scroll: starting new text mid-scroll resets state', () => {
  const ts = TextScroll.create({ charsPerSecond: 1000, punctPauseMs: {} });
  ts.start('abc');
  ts.tick(2);
  assert.equal(ts.visibleText(), 'ab');
  ts.start('xyz');
  assert.equal(ts.visibleText(), '');
  assert.equal(ts.revealedCount(), 0);
});

test('text-scroll: tick with NaN / 0 / negative is no-op', () => {
  const ts = TextScroll.create({ charsPerSecond: 1000 });
  ts.start('abc');
  ts.tick(NaN);
  ts.tick(0);
  ts.tick(-50);
  assert.equal(ts.visibleText(), '');
});

test('text-scroll: unicode multi-byte chars revealed by codepoint', () => {
  const ts = TextScroll.create({ charsPerSecond: 1000, punctPauseMs: {} });
  ts.start('a😀b'); // 3 codepoints (emoji is one)
  assert.equal(ts.totalCount(), 3);
  ts.tick(2);
  assert.equal(ts.visibleText(), 'a😀');
  ts.tick(1);
  assert.equal(ts.visibleText(), 'a😀b');
});

test('text-scroll: setCharsPerSecond updates rate; rejects invalid', () => {
  const ts = TextScroll.create({ charsPerSecond: 100, punctPauseMs: {} });
  ts.start('abc');
  ts.tick(10); // 1 char at 100/s
  assert.equal(ts.visibleText(), 'a');
  ts.setCharsPerSecond(1000);
  ts.tick(2); // now 2 chars
  assert.equal(ts.visibleText(), 'abc');
  ts.start('xyz');
  ts.setCharsPerSecond(0); // invalid - ignored
  ts.setCharsPerSecond(NaN);
  ts.setCharsPerSecond(-50);
  ts.tick(3);
  assert.equal(ts.visibleText(), 'xyz'); // still 1000/s
});

test('text-scroll: dispose locks ops', () => {
  const ts = TextScroll.create();
  ts.start('abc');
  ts.dispose();
  ts.tick(1000);
  ts.start('xyz');
  ts.append('!');
  ts.skip();
  assert.equal(ts.fullText(), '');
  assert.equal(ts.visibleText(), '');
});

test('text-scroll: visibleText vs fullText reflect progress', () => {
  const ts = TextScroll.create({ charsPerSecond: 1000, punctPauseMs: {} });
  ts.start('Hello world');
  ts.tick(5);
  assert.equal(ts.visibleText(), 'Hello');
  assert.equal(ts.fullText(), 'Hello world');
});

test('text-scroll: isComplete reflects state correctly', () => {
  const ts = TextScroll.create({ charsPerSecond: 1000, punctPauseMs: {} });
  ts.start('hi');
  assert.equal(ts.isComplete(), false);
  ts.tick(1);
  assert.equal(ts.isComplete(), false);
  ts.tick(1);
  assert.ok(ts.isComplete());
});

test('text-scroll: throwing onChar is isolated', () => {
  const ts = TextScroll.create({
    charsPerSecond: 1000, punctPauseMs: {},
    onChar: () => { throw new Error('boom'); },
  });
  ts.start('abc');
  // Should not throw.
  ts.tick(3);
  assert.equal(ts.visibleText(), 'abc');
});

test('text-scroll: throwing onComplete is isolated', () => {
  const ts = TextScroll.create({
    charsPerSecond: 1000, punctPauseMs: {},
    onComplete: () => { throw new Error('boom'); },
  });
  ts.start('a');
  // Should not throw.
  ts.tick(2);
  assert.ok(ts.isComplete());
});

test('text-scroll: huge dt reveals all chars in one tick', () => {
  const ts = TextScroll.create({ charsPerSecond: 1, punctPauseMs: {} });
  ts.start('hello');
  ts.tick(10_000_000); // way past the total time
  assert.ok(ts.isComplete());
  assert.equal(ts.visibleText(), 'hello');
});

test('text-scroll: realistic dialog reveal with click-to-skip', () => {
  let completes = 0;
  const ts = TextScroll.create({
    charsPerSecond: 30,
    onComplete: () => { completes++; },
  });
  ts.start('Greetings, traveler. What brings you to Lastlight?');
  // Tick a few frames; not yet done.
  ts.tick(100);
  assert.equal(ts.isComplete(), false);
  // Player clicks - skip to end.
  ts.skip();
  assert.ok(ts.isComplete());
  assert.equal(completes, 1);
  assert.equal(ts.visibleText(), 'Greetings, traveler. What brings you to Lastlight?');
});

test('text-scroll: empty / non-string text handled gracefully', () => {
  const ts = TextScroll.create();
  ts.start('');
  assert.ok(ts.isComplete()); // empty -> instantly complete
  // Non-string fallback to empty.
  ts.start(undefined as unknown as string);
  assert.equal(ts.fullText(), '');
});
