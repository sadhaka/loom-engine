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
const DEFAULT_CAPACITY = 1000;
export class Leaderboard {
    byId = new Map();
    order;
    capacityNum;
    persist;
    remote;
    submitSeq = 0;
    disposed = false;
    constructor(opts) {
        this.order = opts.order === 'asc' ? 'asc' : 'desc';
        this.capacityNum = opts.capacity !== undefined && isFinite(opts.capacity) && opts.capacity > 0
            ? Math.floor(opts.capacity) : DEFAULT_CAPACITY;
        this.persist = opts.persist ?? null;
        this.remote = opts.remote ?? null;
    }
    static create(opts = {}) {
        return new Leaderboard(opts);
    }
    // Submit (or update) a score. Updates only if the new score
    // beats the existing one (per order). Returns true if accepted.
    submit(entry) {
        if (this.disposed)
            return false;
        if (!entry || typeof entry.id !== 'string' || entry.id.length === 0)
            return false;
        if (typeof entry.name !== 'string')
            return false;
        if (typeof entry.score !== 'number' || !isFinite(entry.score))
            return false;
        var existing = this.byId.get(entry.id);
        if (existing && !this.beats(entry.score, existing.score))
            return false;
        this.submitSeq += 1;
        var stored = {
            id: entry.id,
            name: entry.name,
            score: entry.score,
            submittedAt: this.submitSeq,
        };
        if (entry.data)
            stored.data = entry.data;
        this.byId.set(entry.id, stored);
        this.evictIfFull();
        return true;
    }
    remove(id) {
        if (this.disposed)
            return false;
        return this.byId.delete(id);
    }
    clear() {
        if (this.disposed)
            return;
        this.byId.clear();
    }
    size() {
        return this.byId.size;
    }
    byIdEntry(id) {
        var e = this.byId.get(id);
        if (!e)
            return null;
        var copy = {
            id: e.id,
            name: e.name,
            score: e.score,
            submittedAt: e.submittedAt,
            rank: this.rankOf(id),
        };
        if (e.data)
            copy.data = e.data;
        return copy;
    }
    // 1-based rank; 0 if not present.
    rankOf(id) {
        if (!this.byId.has(id))
            return 0;
        var sorted = this.sortedEntries();
        for (var i = 0; i < sorted.length; i++) {
            if (sorted[i].id === id)
                return i + 1;
        }
        return 0;
    }
    // Top N entries (with rank assigned).
    top(n) {
        if (!isFinite(n) || n <= 0)
            return [];
        var sorted = this.sortedEntries();
        var slice = sorted.slice(0, Math.floor(n));
        return slice.map((e, i) => this.withRank(e, i + 1));
    }
    // Window around `id`'s rank: `before` entries above, `after` below.
    around(id, before, after) {
        if (!this.byId.has(id))
            return [];
        var sorted = this.sortedEntries();
        var idx = -1;
        for (var i = 0; i < sorted.length; i++) {
            if (sorted[i].id === id) {
                idx = i;
                break;
            }
        }
        if (idx < 0)
            return [];
        var lo = Math.max(0, idx - Math.max(0, Math.floor(before)));
        var hi = Math.min(sorted.length, idx + Math.max(0, Math.floor(after)) + 1);
        var slice = sorted.slice(lo, hi);
        return slice.map((e, i) => this.withRank(e, lo + i + 1));
    }
    // Full sorted list, defensive copy + ranks assigned.
    list() {
        var sorted = this.sortedEntries();
        return sorted.map((e, i) => this.withRank(e, i + 1));
    }
    saveLocal() {
        if (this.disposed || !this.persist)
            return;
        try {
            this.persist.save(this.sortedEntries().map(cloneStored));
        }
        catch { /* ignore */ }
    }
    loadLocal() {
        if (this.disposed || !this.persist)
            return;
        var loaded;
        try {
            loaded = this.persist.load();
        }
        catch {
            return;
        }
        if (!Array.isArray(loaded))
            return;
        this.byId.clear();
        var maxSeq = 0;
        for (var i = 0; i < loaded.length; i++) {
            var raw = loaded[i];
            if (!raw || typeof raw !== 'object')
                continue;
            if (typeof raw.id !== 'string' || raw.id.length === 0)
                continue;
            if (typeof raw.score !== 'number' || !isFinite(raw.score))
                continue;
            var stored = {
                id: raw.id,
                name: typeof raw.name === 'string' ? raw.name : '',
                score: raw.score,
                submittedAt: typeof raw.submittedAt === 'number' && raw.submittedAt > 0 ? raw.submittedAt : 0,
            };
            if (raw.data)
                stored.data = raw.data;
            if (stored.submittedAt > maxSeq)
                maxSeq = stored.submittedAt;
            this.byId.set(stored.id, stored);
        }
        this.submitSeq = maxSeq;
        this.evictIfFull();
    }
    async uploadRemote(id) {
        if (this.disposed || !this.remote || !this.remote.submit)
            return;
        var entry = this.byId.get(id);
        if (!entry)
            return;
        try {
            await this.remote.submit(cloneStored(entry));
        }
        catch { /* swallow; consumer wraps */ }
    }
    async syncRemote() {
        if (this.disposed || !this.remote || !this.remote.fetch)
            return;
        var fetched;
        try {
            fetched = await this.remote.fetch();
        }
        catch {
            return;
        }
        if (!Array.isArray(fetched))
            return;
        for (var i = 0; i < fetched.length; i++) {
            var f = fetched[i];
            if (!f)
                continue;
            this.submit({
                id: f.id, name: f.name, score: f.score,
                ...(f.data ? { data: f.data } : {}),
            });
        }
    }
    setOrder(order) {
        if (this.disposed)
            return;
        if (order !== 'asc' && order !== 'desc')
            return;
        this.order = order;
    }
    getOrder() { return this.order; }
    dispose() {
        this.byId.clear();
        this.persist = null;
        this.remote = null;
        this.disposed = true;
    }
    // ---------- private ----------
    beats(newScore, oldScore) {
        return this.order === 'desc' ? newScore > oldScore : newScore < oldScore;
    }
    compareEntries(a, b) {
        if (a.score !== b.score) {
            return this.order === 'desc' ? b.score - a.score : a.score - b.score;
        }
        // Tie: earlier submission ranks higher.
        return a.submittedAt - b.submittedAt;
    }
    sortedEntries() {
        var arr = [];
        this.byId.forEach((e) => arr.push(e));
        var self = this;
        arr.sort(function (a, b) { return self.compareEntries(a, b); });
        return arr;
    }
    evictIfFull() {
        if (this.byId.size <= this.capacityNum)
            return;
        var sorted = this.sortedEntries();
        while (sorted.length > this.capacityNum) {
            var worst = sorted.pop();
            this.byId.delete(worst.id);
        }
    }
    withRank(e, rank) {
        var copy = {
            id: e.id,
            name: e.name,
            score: e.score,
            submittedAt: e.submittedAt,
            rank: rank,
        };
        if (e.data)
            copy.data = e.data;
        return copy;
    }
}
function cloneStored(e) {
    var copy = {
        id: e.id,
        name: e.name,
        score: e.score,
        submittedAt: e.submittedAt,
    };
    if (e.data)
        copy.data = e.data;
    return copy;
}
// Resource key for the world's resource registry.
export const RESOURCE_LEADERBOARD = 'leaderboard';
//# sourceMappingURL=leaderboard.js.map