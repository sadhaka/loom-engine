// Phase 1.5.3 - QuestionBank tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  QuestionBank,
  RESOURCE_QUESTION_BANK,
} from '../src/index.js';

const DAY_MS = 86400000;

test('qb: RESOURCE_QUESTION_BANK is the stable string', () => {
  assert.equal(RESOURCE_QUESTION_BANK, 'question_bank');
});

test('qb: starts empty', () => {
  const qb = QuestionBank.create();
  assert.equal(qb.count(), 0);
});

test('qb: add + has + get', () => {
  const qb = QuestionBank.create();
  qb.add({ id: 'q1', prompt: '2+2?', answers: ['3', '4', '5'], correct: 1 });
  assert.equal(qb.has('q1'), true);
  const item = qb.get('q1');
  assert.equal(item!.prompt, '2+2?');
  assert.equal(item!.correct, 1);
});

test('qb: add rejects empty / non-string', () => {
  const qb = QuestionBank.create();
  assert.equal(qb.add({ id: '', prompt: 'a' }), false);
  // @ts-expect-error
  assert.equal(qb.add({ id: 'q', prompt: null }), false);
});

test('qb: reviewState returns initial state', () => {
  const qb = QuestionBank.create({ now: () => 1000 });
  qb.add({ id: 'q1', prompt: 'a' });
  const state = qb.reviewState('q1');
  assert.equal(state!.repetitions, 0);
  assert.equal(state!.intervalDays, 0);
  assert.equal(state!.totalReviews, 0);
  assert.equal(state!.nextReviewAt, 1000);
});

test('qb: due returns items at or before now', () => {
  const qb = QuestionBank.create();
  qb.add({ id: 'q1', prompt: 'a' });
  qb.add({ id: 'q2', prompt: 'b' });
  const due = qb.due({ now: 0 });
  assert.equal(due.length, 2);
});

test('qb: due limit caps result', () => {
  const qb = QuestionBank.create();
  for (let i = 0; i < 10; i++) qb.add({ id: 'q' + i, prompt: 'p' + i });
  const due = qb.due({ now: 0, limit: 5 });
  assert.equal(due.length, 5);
});

test('qb: due tag filter', () => {
  const qb = QuestionBank.create();
  qb.add({ id: 'q1', prompt: 'a', tags: ['math'] });
  qb.add({ id: 'q2', prompt: 'b', tags: ['geography'] });
  const due = qb.due({ now: 0, tag: 'math' });
  assert.equal(due.length, 1);
  assert.equal(due[0]!.id, 'q1');
});

test('qb: review with rating 3+ schedules next review', () => {
  const qb = QuestionBank.create();
  qb.add({ id: 'q1', prompt: 'a' });
  qb.review('q1', 4, 0);
  const state = qb.reviewState('q1');
  // First successful: interval = 1 day.
  assert.equal(state!.intervalDays, 1);
  assert.equal(state!.repetitions, 1);
  assert.equal(state!.nextReviewAt, DAY_MS);
});

test('qb: second successful review sets interval=6', () => {
  const qb = QuestionBank.create();
  qb.add({ id: 'q1', prompt: 'a' });
  qb.review('q1', 4, 0);
  qb.review('q1', 4, DAY_MS);
  const state = qb.reviewState('q1');
  assert.equal(state!.intervalDays, 6);
  assert.equal(state!.repetitions, 2);
});

test('qb: third+ review uses easeFactor multiplier', () => {
  const qb = QuestionBank.create();
  qb.add({ id: 'q1', prompt: 'a' });
  qb.review('q1', 5, 0);
  qb.review('q1', 5, DAY_MS);
  qb.review('q1', 5, 7 * DAY_MS);
  const state = qb.reviewState('q1');
  // After two intervals 1 + 6, third = 6 * easeFactor.
  // EaseFactor with rating=5 stays at 2.5 (or rises slightly).
  assert.ok(state!.intervalDays > 6);
  assert.equal(state!.repetitions, 3);
});

test('qb: review with rating < 3 resets interval', () => {
  const qb = QuestionBank.create();
  qb.add({ id: 'q1', prompt: 'a' });
  qb.review('q1', 4, 0);
  qb.review('q1', 4, DAY_MS);
  // Rating 2 = failed.
  qb.review('q1', 2, 7 * DAY_MS);
  const state = qb.reviewState('q1');
  assert.equal(state!.repetitions, 0);
  assert.equal(state!.intervalDays, 1);
});

test('qb: easeFactor adjusts per rating', () => {
  const qb = QuestionBank.create();
  qb.add({ id: 'q1', prompt: 'a' });
  // Rating 5 (perfect): ease should rise.
  qb.review('q1', 5, 0);
  const state5 = qb.reviewState('q1');
  assert.ok(state5!.easeFactor > 2.5);
  // Reset and rate 3 (just passed): ease should drop slightly.
  qb.reset('q1');
  qb.review('q1', 3, 0);
  const state3 = qb.reviewState('q1');
  assert.ok(state3!.easeFactor < 2.5);
});

test('qb: easeFactor clamped to minEase', () => {
  const qb = QuestionBank.create({ minEaseFactor: 1.3 });
  qb.add({ id: 'q1', prompt: 'a' });
  // Many failures should drive ease floor.
  for (let i = 0; i < 20; i++) qb.review('q1', 0, i * DAY_MS);
  const state = qb.reviewState('q1');
  assert.ok(state!.easeFactor >= 1.3);
});

test('qb: review unknown item returns null', () => {
  const qb = QuestionBank.create();
  assert.equal(qb.review('missing', 4, 0), null);
});

test('qb: review with NaN rating returns null', () => {
  const qb = QuestionBank.create();
  qb.add({ id: 'q1', prompt: 'a' });
  assert.equal(qb.review('q1', NaN, 0), null);
});

test('qb: review rating clamped to 0..5', () => {
  const qb = QuestionBank.create();
  qb.add({ id: 'q1', prompt: 'a' });
  qb.review('q1', 99, 0);
  // Treated as 5.
  const state = qb.reviewState('q1');
  assert.equal(state!.lastRating, 5);
});

test('qb: skip pushes nextReviewAt to tomorrow', () => {
  const qb = QuestionBank.create();
  qb.add({ id: 'q1', prompt: 'a' });
  qb.skip('q1', 0);
  const state = qb.reviewState('q1');
  assert.equal(state!.nextReviewAt, DAY_MS);
  // SRS state untouched.
  assert.equal(state!.repetitions, 0);
});

test('qb: reset returns to fresh state', () => {
  const qb = QuestionBank.create();
  qb.add({ id: 'q1', prompt: 'a' });
  qb.review('q1', 4, 0);
  qb.review('q1', 4, DAY_MS);
  qb.reset('q1', 1000);
  const state = qb.reviewState('q1');
  assert.equal(state!.repetitions, 0);
  assert.equal(state!.totalReviews, 0);
  assert.equal(state!.nextReviewAt, 1000);
});

test('qb: byTag returns items with tag', () => {
  const qb = QuestionBank.create();
  qb.add({ id: 'q1', prompt: 'a', tags: ['math', 'algebra'] });
  qb.add({ id: 'q2', prompt: 'b', tags: ['geography'] });
  qb.add({ id: 'q3', prompt: 'c', tags: ['math', 'calculus'] });
  const math = qb.byTag('math');
  assert.equal(math.length, 2);
});

test('qb: totalReviews aggregates across items', () => {
  const qb = QuestionBank.create();
  qb.add({ id: 'q1', prompt: 'a' });
  qb.add({ id: 'q2', prompt: 'b' });
  qb.review('q1', 4, 0);
  qb.review('q2', 3, 0);
  qb.review('q1', 4, DAY_MS);
  assert.equal(qb.totalReviews(), 3);
});

test('qb: unreviewed returns never-reviewed items', () => {
  const qb = QuestionBank.create();
  qb.add({ id: 'q1', prompt: 'a' });
  qb.add({ id: 'q2', prompt: 'b' });
  qb.review('q1', 4, 0);
  const u = qb.unreviewed();
  assert.equal(u.length, 1);
  assert.equal(u[0]!.id, 'q2');
});

test('qb: due excludes items not yet due', () => {
  const qb = QuestionBank.create();
  qb.add({ id: 'q1', prompt: 'a' });
  qb.review('q1', 4, 0); // next review at DAY_MS
  // At time DAY_MS / 2, q1 is not due yet.
  const due = qb.due({ now: DAY_MS / 2 });
  assert.equal(due.length, 0);
});

test('qb: clear empties + dispose locks', () => {
  const qb = QuestionBank.create();
  qb.add({ id: 'q1', prompt: 'a' });
  qb.clear();
  assert.equal(qb.count(), 0);
  qb.dispose();
  assert.equal(qb.add({ id: 'q2', prompt: 'b' }), false);
});

test('qb: realistic example - learning loop with mixed ratings', () => {
  let now = 0;
  const qb = QuestionBank.create({ now: () => now });
  qb.add({ id: 'capital_fr', prompt: 'Capital of France?', tags: ['geo'] });
  qb.add({ id: 'capital_de', prompt: 'Capital of Germany?', tags: ['geo'] });
  qb.add({ id: 'capital_jp', prompt: 'Capital of Japan?', tags: ['geo'] });

  // Day 0: due, review.
  let due = qb.due();
  assert.equal(due.length, 3);
  qb.review('capital_fr', 5, now);
  qb.review('capital_de', 4, now);
  qb.review('capital_jp', 1, now); // forgot

  // Day 1: only capital_jp is due (interval reset to 1 day).
  now = DAY_MS;
  due = qb.due();
  assert.deepEqual(due.map((d) => d.id).sort(), ['capital_de', 'capital_fr', 'capital_jp']);

  // Day 2: capital_jp again due.
  now = 2 * DAY_MS;
  qb.review('capital_jp', 4, now);
  due = qb.due();
  // capital_de scheduled DAY_MS, capital_fr scheduled DAY_MS - both
  // due. capital_jp now scheduled at 3 days away.
  assert.ok(due.length >= 2);
});
