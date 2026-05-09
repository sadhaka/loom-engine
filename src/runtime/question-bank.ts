// QuestionBank - quiz items + SM-2 spaced repetition scheduler.
//
// 1.5.3 enabling primitive (Wave 1.5 educational depth). Used for
// learning apps, in-game tutorials with knowledge checks,
// training simulations, language flashcards. Implements the SM-2
// algorithm (SuperMemo 2): each item has an ease factor, interval
// (days), and repetition count. After each review, the consumer
// passes a 0-5 rating and the algorithm updates state to schedule
// the next review.
//
//   var qb = QuestionBank.create();
//   qb.add({
//     id: 'q1',
//     prompt: 'What is the capital of France?',
//     answers: ['Paris', 'London', 'Berlin'],
//     correct: 0,
//     tags: ['geography', 'europe'],
//   });
//
//   var due = qb.due(Date.now());
//   // ...show prompt, get answer, score 0-5...
//   qb.review('q1', 4, Date.now());  // good answer
//
// Pairs with ProgressTracker (1.5.4 next, mastery levels),
// KnowledgeMap (1.5.5 capstone, prerequisite graph), TimelineLedger
// (1.5.1, review history visualization).
//
// Code style: var-only in browser source.

export interface QuestionItem<T = Record<string, unknown>> {
  id: string;
  prompt: string;
  // Multiple-choice answers (or empty/omitted for open-ended).
  answers?: string[];
  // Correct answer index (when answers present) or string match.
  correct?: number | string;
  tags?: string[];
  // Optional payload for consumer (image url, audio cue, etc).
  data?: T;
}

export interface ReviewState {
  itemId: string;
  // SM-2 ease factor (1.3 minimum, 2.5 starting).
  easeFactor: number;
  // Current interval in days.
  intervalDays: number;
  // Successful repetition count (resets on rating < 3).
  repetitions: number;
  // ms timestamp when next review is due (consumer's clock).
  nextReviewAt: number;
  // ms timestamp of last review (or 0 if never).
  lastReviewAt: number;
  // Total review count.
  totalReviews: number;
  // Last rating given.
  lastRating: number;
}

export interface DueOptions {
  // Reference time. Default 0 (consumer should pass current
  // ms-timestamp).
  now?: number;
  // Max items returned. Default unlimited.
  limit?: number;
  // Optional tag filter.
  tag?: string;
}

export interface QuestionBankOptions {
  // Default time getter for review() / due() calls without
  // explicit `now`. Default returns 0 (consumer should always
  // pass `now`).
  now?: () => number;
  // Initial ease factor for new items. Default 2.5.
  initialEaseFactor?: number;
  // Minimum ease factor. Default 1.3.
  minEaseFactor?: number;
}

const DAY_MS = 86400000;
const DEFAULT_EASE = 2.5;
const DEFAULT_MIN_EASE = 1.3;

interface InternalItem<T> {
  item: QuestionItem<T>;
  state: ReviewState;
}

export class QuestionBank<T = Record<string, unknown>> {
  private items: Map<string, InternalItem<T>> = new Map();
  private nowFn: () => number;
  private initialEase: number;
  private minEase: number;
  private disposed: boolean = false;

  private constructor(opts: QuestionBankOptions) {
    this.nowFn = typeof opts.now === 'function' ? opts.now : function () { return 0; };
    this.initialEase = opts.initialEaseFactor !== undefined
        && isFinite(opts.initialEaseFactor) && opts.initialEaseFactor > 0
      ? opts.initialEaseFactor : DEFAULT_EASE;
    this.minEase = opts.minEaseFactor !== undefined
        && isFinite(opts.minEaseFactor) && opts.minEaseFactor > 0
      ? opts.minEaseFactor : DEFAULT_MIN_EASE;
  }

  static create<T = Record<string, unknown>>(
    opts: QuestionBankOptions = {}): QuestionBank<T> {
    return new QuestionBank<T>(opts);
  }

  // ---------- CRUD ----------

  add(item: QuestionItem<T>): boolean {
    if (this.disposed) return false;
    if (!item || typeof item.id !== 'string' || item.id.length === 0) return false;
    if (typeof item.prompt !== 'string') return false;
    var clone: QuestionItem<T> = {
      id: item.id,
      prompt: item.prompt,
    };
    if (Array.isArray(item.answers) && item.answers.length > 0) {
      clone.answers = item.answers.slice();
    }
    if (item.correct !== undefined) clone.correct = item.correct;
    if (Array.isArray(item.tags) && item.tags.length > 0) clone.tags = item.tags.slice();
    if (item.data !== undefined) clone.data = item.data;
    var state: ReviewState = {
      itemId: item.id,
      easeFactor: this.initialEase,
      intervalDays: 0,
      repetitions: 0,
      nextReviewAt: this.nowFn(),
      lastReviewAt: 0,
      totalReviews: 0,
      lastRating: -1,
    };
    this.items.set(item.id, { item: clone, state: state });
    return true;
  }

  remove(id: string): boolean {
    if (this.disposed) return false;
    return this.items.delete(id);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  get(id: string): QuestionItem<T> | null {
    var entry = this.items.get(id);
    return entry ? this.cloneItem(entry.item) : null;
  }

  reviewState(id: string): ReviewState | null {
    var entry = this.items.get(id);
    return entry ? { ...entry.state } : null;
  }

  count(): number { return this.items.size; }

  // ---------- review flow ----------

  // Items due for review at `now` (or default clock). Sorted by
  // nextReviewAt ascending.
  due(opts: DueOptions = {}): QuestionItem<T>[] {
    var now = opts.now !== undefined && isFinite(opts.now) ? opts.now : this.nowFn();
    var limit = opts.limit !== undefined && isFinite(opts.limit) && opts.limit > 0
      ? Math.floor(opts.limit) : Infinity;
    var tag = typeof opts.tag === 'string' ? opts.tag : null;
    var matches: InternalItem<T>[] = [];
    var iter = this.items.values();
    var v = iter.next();
    while (!v.done) {
      var entry = v.value;
      if (entry.state.nextReviewAt <= now) {
        if (tag === null || (entry.item.tags && entry.item.tags.indexOf(tag) >= 0)) {
          matches.push(entry);
        }
      }
      v = iter.next();
    }
    matches.sort(function (a, b) {
      return a.state.nextReviewAt - b.state.nextReviewAt;
    });
    var out: QuestionItem<T>[] = [];
    for (var i = 0; i < matches.length && out.length < limit; i++) {
      out.push(this.cloneItem((matches[i] as InternalItem<T>).item));
    }
    return out;
  }

  // Record a review: rating 0..5. Updates SRS state per SM-2.
  // Returns the new ReviewState or null if item missing / invalid.
  review(itemId: string, rating: number, now?: number): ReviewState | null {
    if (this.disposed) return null;
    var entry = this.items.get(itemId);
    if (!entry) return null;
    if (!isFinite(rating)) return null;
    var q = Math.max(0, Math.min(5, Math.floor(rating)));
    var refTime = now !== undefined && isFinite(now) ? now : this.nowFn();
    var state = entry.state;
    state.totalReviews++;
    state.lastRating = q;
    state.lastReviewAt = refTime;
    if (q < 3) {
      // Failed: reset interval, keep easeFactor (with adjustment).
      state.repetitions = 0;
      state.intervalDays = 1;
    } else {
      state.repetitions++;
      if (state.repetitions === 1) {
        state.intervalDays = 1;
      } else if (state.repetitions === 2) {
        state.intervalDays = 6;
      } else {
        state.intervalDays = Math.round(state.intervalDays * state.easeFactor);
      }
    }
    // Update ease factor (SM-2 formula): ef' = ef + (0.1 - (5-q)*(0.08 + (5-q)*0.02))
    var qDiff = 5 - q;
    var efDelta = 0.1 - qDiff * (0.08 + qDiff * 0.02);
    state.easeFactor = Math.max(this.minEase, state.easeFactor + efDelta);
    state.nextReviewAt = refTime + state.intervalDays * DAY_MS;
    return { ...state };
  }

  // Mark an item as skipped: pushes review to tomorrow without
  // changing SRS state.
  skip(itemId: string, now?: number): boolean {
    if (this.disposed) return false;
    var entry = this.items.get(itemId);
    if (!entry) return false;
    var refTime = now !== undefined && isFinite(now) ? now : this.nowFn();
    entry.state.nextReviewAt = refTime + DAY_MS;
    return true;
  }

  // Reset SRS state for an item to fresh (as if just added).
  reset(itemId: string, now?: number): boolean {
    if (this.disposed) return false;
    var entry = this.items.get(itemId);
    if (!entry) return false;
    var refTime = now !== undefined && isFinite(now) ? now : this.nowFn();
    entry.state.easeFactor = this.initialEase;
    entry.state.intervalDays = 0;
    entry.state.repetitions = 0;
    entry.state.nextReviewAt = refTime;
    entry.state.lastReviewAt = 0;
    entry.state.totalReviews = 0;
    entry.state.lastRating = -1;
    return true;
  }

  // ---------- queries ----------

  byTag(tag: string): QuestionItem<T>[] {
    var out: QuestionItem<T>[] = [];
    var iter = this.items.values();
    var v = iter.next();
    while (!v.done) {
      var e = v.value;
      if (e.item.tags && e.item.tags.indexOf(tag) >= 0) {
        out.push(this.cloneItem(e.item));
      }
      v = iter.next();
    }
    return out;
  }

  list(): QuestionItem<T>[] {
    var out: QuestionItem<T>[] = [];
    var iter = this.items.values();
    var v = iter.next();
    while (!v.done) {
      out.push(this.cloneItem(v.value.item));
      v = iter.next();
    }
    return out;
  }

  // Aggregate stats.
  totalReviews(): number {
    var total = 0;
    var iter = this.items.values();
    var v = iter.next();
    while (!v.done) {
      total += v.value.state.totalReviews;
      v = iter.next();
    }
    return total;
  }

  // Items the user has never reviewed.
  unreviewed(): QuestionItem<T>[] {
    var out: QuestionItem<T>[] = [];
    var iter = this.items.values();
    var v = iter.next();
    while (!v.done) {
      if (v.value.state.totalReviews === 0) {
        out.push(this.cloneItem(v.value.item));
      }
      v = iter.next();
    }
    return out;
  }

  // ---------- lifecycle ----------

  clear(): void {
    if (this.disposed) return;
    this.items.clear();
  }

  dispose(): void {
    this.items.clear();
    this.disposed = true;
  }

  // ---------- private ----------

  private cloneItem(item: QuestionItem<T>): QuestionItem<T> {
    var out: QuestionItem<T> = {
      id: item.id,
      prompt: item.prompt,
    };
    if (item.answers) out.answers = item.answers.slice();
    if (item.correct !== undefined) out.correct = item.correct;
    if (item.tags) out.tags = item.tags.slice();
    if (item.data !== undefined) out.data = item.data;
    return out;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_QUESTION_BANK = 'question_bank';
