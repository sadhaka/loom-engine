// Leaderboard - local + remote leaderboard primitive.
//
// 0.78.0 enabling primitive. Score boards, time trials, "fastest
// clear" rankings - all share a sorted-by-score map of player
// entries with top-N + around-me queries. Leaderboard owns the
// data structure plus optional adapter hooks for local
// persistence (PersistentStorage) and remote sync (any async
// transport).
//
//   var lb = Leaderboard.create({
//     order: 'desc',
//     capacity: 1000,
//     persist: {
//       save: (e) => storage.set('lb', JSON.stringify(e)),
//       load: () => JSON.parse(storage.get('lb') || '[]'),
//     },
//   });
//   lb.submit({ id: 'p1', name: 'Alice', score: 1500 });
//   var top10 = lb.top(10);
//   var window = lb.around('p1', 3, 3);
//
// Submission semantics: duplicate id keeps the BEST score (per
// `order`). Submitting a worse-than-current entry is a no-op and
// returns false.
//
// Persistence is sync (in-memory wrapper around PersistentStorage's
// localStorage backend, for instance); remote sync is async and
// returns Promises so consumers can await + handle errors.
//
// Pairs with PersistentStorage (0.38).
//
// Code style: var-only in browser source.

export type LeaderboardOrder = 'desc' | 'asc';

export interface ScoreEntry {
  id: string;
  name: string;
  score: number;
  // Monotonic submission counter (replay-deterministic). Lower =
  // submitted earlier. Used to break score ties (earlier wins).
  submittedAt: number;
  // Computed on query; undefined on stored entries.
  rank?: number;
  data?: Record<string, unknown>;
}

export interface LeaderboardSubmission {
  id: string;
  name: string;
  score: number;
  data?: Record<string, unknown>;
}

export interface LeaderboardPersistAdapter {
  save: (entries: ScoreEntry[]) => void;
  load: () => ScoreEntry[];
}

export interface LeaderboardRemoteAdapter {
  submit?: (entry: ScoreEntry) => Promise<void>;
  fetch?: () => Promise<ScoreEntry[]>;
}

export interface LeaderboardOptions {
  // Higher = better rank ('desc') or lower = better ('asc'). Default 'desc'.
  order?: LeaderboardOrder;
  // Max entries kept. When over, the worst-scoring entry is evicted.
  // Default 1000.
  capacity?: number;
  persist?: LeaderboardPersistAdapter;
  remote?: LeaderboardRemoteAdapter;
}

const DEFAULT_CAPACITY = 1000;

export class Leaderboard {
  private byId: Map<string, ScoreEntry> = new Map();
  private order: LeaderboardOrder;
  private capacityNum: number;
  private persist: LeaderboardPersistAdapter | null;
  private remote: LeaderboardRemoteAdapter | null;
  private submitSeq: number = 0;
  private disposed: boolean = false;

  private constructor(opts: LeaderboardOptions) {
    this.order = opts.order === 'asc' ? 'asc' : 'desc';
    this.capacityNum = opts.capacity !== undefined && isFinite(opts.capacity) && opts.capacity > 0
      ? Math.floor(opts.capacity) : DEFAULT_CAPACITY;
    this.persist = opts.persist ?? null;
    this.remote = opts.remote ?? null;
  }

  static create(opts: LeaderboardOptions = {}): Leaderboard {
    return new Leaderboard(opts);
  }

  // Submit (or update) a score. Updates only if the new score
  // beats the existing one (per order). Returns true if accepted.
  submit(entry: LeaderboardSubmission): boolean {
    if (this.disposed) return false;
    if (!entry || typeof entry.id !== 'string' || entry.id.length === 0) return false;
    if (typeof entry.name !== 'string') return false;
    if (typeof entry.score !== 'number' || !isFinite(entry.score)) return false;
    var existing = this.byId.get(entry.id);
    if (existing && !this.beats(entry.score, existing.score)) return false;
    this.submitSeq += 1;
    var stored: ScoreEntry = {
      id: entry.id,
      name: entry.name,
      score: entry.score,
      submittedAt: this.submitSeq,
    };
    if (entry.data) stored.data = entry.data;
    this.byId.set(entry.id, stored);
    this.evictIfFull();
    return true;
  }

  remove(id: string): boolean {
    if (this.disposed) return false;
    return this.byId.delete(id);
  }

  clear(): void {
    if (this.disposed) return;
    this.byId.clear();
  }

  size(): number {
    return this.byId.size;
  }

  byIdEntry(id: string): ScoreEntry | null {
    var e = this.byId.get(id);
    if (!e) return null;
    var copy: ScoreEntry = {
      id: e.id,
      name: e.name,
      score: e.score,
      submittedAt: e.submittedAt,
      rank: this.rankOf(id),
    };
    if (e.data) copy.data = e.data;
    return copy;
  }

  // 1-based rank; 0 if not present.
  rankOf(id: string): number {
    if (!this.byId.has(id)) return 0;
    var sorted = this.sortedEntries();
    for (var i = 0; i < sorted.length; i++) {
      if ((sorted[i] as ScoreEntry).id === id) return i + 1;
    }
    return 0;
  }

  // Top N entries (with rank assigned).
  top(n: number): ScoreEntry[] {
    if (!isFinite(n) || n <= 0) return [];
    var sorted = this.sortedEntries();
    var slice = sorted.slice(0, Math.floor(n));
    return slice.map((e, i) => this.withRank(e, i + 1));
  }

  // Window around `id`'s rank: `before` entries above, `after` below.
  around(id: string, before: number, after: number): ScoreEntry[] {
    if (!this.byId.has(id)) return [];
    var sorted = this.sortedEntries();
    var idx = -1;
    for (var i = 0; i < sorted.length; i++) {
      if ((sorted[i] as ScoreEntry).id === id) { idx = i; break; }
    }
    if (idx < 0) return [];
    var lo = Math.max(0, idx - Math.max(0, Math.floor(before)));
    var hi = Math.min(sorted.length, idx + Math.max(0, Math.floor(after)) + 1);
    var slice = sorted.slice(lo, hi);
    return slice.map((e, i) => this.withRank(e, lo + i + 1));
  }

  // Full sorted list, defensive copy + ranks assigned.
  list(): ScoreEntry[] {
    var sorted = this.sortedEntries();
    return sorted.map((e, i) => this.withRank(e, i + 1));
  }

  saveLocal(): void {
    if (this.disposed || !this.persist) return;
    try { this.persist.save(this.sortedEntries().map(cloneStored)); } catch { /* ignore */ }
  }

  loadLocal(): void {
    if (this.disposed || !this.persist) return;
    var loaded: ScoreEntry[];
    try { loaded = this.persist.load(); } catch { return; }
    if (!Array.isArray(loaded)) return;
    this.byId.clear();
    var maxSeq = 0;
    for (var i = 0; i < loaded.length; i++) {
      var raw = loaded[i];
      if (!raw || typeof raw !== 'object') continue;
      if (typeof raw.id !== 'string' || raw.id.length === 0) continue;
      if (typeof raw.score !== 'number' || !isFinite(raw.score)) continue;
      var stored: ScoreEntry = {
        id: raw.id,
        name: typeof raw.name === 'string' ? raw.name : '',
        score: raw.score,
        submittedAt: typeof raw.submittedAt === 'number' && raw.submittedAt > 0 ? raw.submittedAt : 0,
      };
      if (raw.data) stored.data = raw.data;
      if (stored.submittedAt > maxSeq) maxSeq = stored.submittedAt;
      this.byId.set(stored.id, stored);
    }
    this.submitSeq = maxSeq;
    this.evictIfFull();
  }

  async uploadRemote(id: string): Promise<void> {
    if (this.disposed || !this.remote || !this.remote.submit) return;
    var entry = this.byId.get(id);
    if (!entry) return;
    try { await this.remote.submit(cloneStored(entry)); } catch { /* swallow; consumer wraps */ }
  }

  async syncRemote(): Promise<void> {
    if (this.disposed || !this.remote || !this.remote.fetch) return;
    var fetched: ScoreEntry[];
    try { fetched = await this.remote.fetch(); } catch { return; }
    if (!Array.isArray(fetched)) return;
    for (var i = 0; i < fetched.length; i++) {
      var f = fetched[i];
      if (!f) continue;
      this.submit({
        id: f.id, name: f.name, score: f.score,
        ...(f.data ? { data: f.data } : {}),
      });
    }
  }

  setOrder(order: LeaderboardOrder): void {
    if (this.disposed) return;
    if (order !== 'asc' && order !== 'desc') return;
    this.order = order;
  }

  getOrder(): LeaderboardOrder { return this.order; }

  dispose(): void {
    this.byId.clear();
    this.persist = null;
    this.remote = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private beats(newScore: number, oldScore: number): boolean {
    return this.order === 'desc' ? newScore > oldScore : newScore < oldScore;
  }

  private compareEntries(a: ScoreEntry, b: ScoreEntry): number {
    if (a.score !== b.score) {
      return this.order === 'desc' ? b.score - a.score : a.score - b.score;
    }
    // Tie: earlier submission ranks higher.
    return a.submittedAt - b.submittedAt;
  }

  private sortedEntries(): ScoreEntry[] {
    var arr: ScoreEntry[] = [];
    this.byId.forEach((e) => arr.push(e));
    var self = this;
    arr.sort(function (a, b) { return self.compareEntries(a, b); });
    return arr;
  }

  private evictIfFull(): void {
    if (this.byId.size <= this.capacityNum) return;
    var sorted = this.sortedEntries();
    while (sorted.length > this.capacityNum) {
      var worst = sorted.pop() as ScoreEntry;
      this.byId.delete(worst.id);
    }
  }

  private withRank(e: ScoreEntry, rank: number): ScoreEntry {
    var copy: ScoreEntry = {
      id: e.id,
      name: e.name,
      score: e.score,
      submittedAt: e.submittedAt,
      rank: rank,
    };
    if (e.data) copy.data = e.data;
    return copy;
  }
}

function cloneStored(e: ScoreEntry): ScoreEntry {
  var copy: ScoreEntry = {
    id: e.id,
    name: e.name,
    score: e.score,
    submittedAt: e.submittedAt,
  };
  if (e.data) copy.data = e.data;
  return copy;
}

// Resource key for the world's resource registry.
export const RESOURCE_LEADERBOARD = 'leaderboard';
