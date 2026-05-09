// PresenceTracker - online roster with heartbeat + auto-timeout.
//
// 1.7.0 enabling primitive (Wave 1.7 networking depth opens).
// "Who is online right now?" Tracks a per-key last-heartbeat
// timestamp; entries auto-expire after a configurable timeout
// without a heartbeat. Surface for online rosters, peer-zone
// presence, "this NPC is alive in someone's session" tracking.
//
//   var pt = PresenceTracker.create({ timeoutMs: 30000 });
//   pt.heartbeat('user_42', { name: 'Misha', zone: 'plaza' }, now);
//   pt.heartbeat('user_43', { name: 'Sunisa' },                now);
//
//   // 60 seconds later (without further heartbeats):
//   pt.tick(now + 60000);
//   pt.list();   // -> []  (both expired)
//
// Pure in-memory; consumer wires the heartbeat triggers (HTTP
// pings, websocket frames, SSE events). Engine doesn't ship the
// transport.
//
// Pairs with LobbyState (1.7.1, lobby-scoped roster), ChatChannel
// (1.7.5 milestone, presence drives "who can hear this?"),
// AuthorityHandoff (1.7.3, presence drives host election).
//
// Code style: var-only in browser source.
export class PresenceTracker {
    entries = new Map();
    timeoutMs;
    maxEntries;
    constructor(opts) {
        this.timeoutMs = (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0)
            ? opts.timeoutMs : 30000;
        this.maxEntries = (typeof opts.maxEntries === 'number' && opts.maxEntries > 0)
            ? Math.floor(opts.maxEntries) : Infinity;
    }
    static create(opts = {}) {
        return new PresenceTracker(opts);
    }
    // Record a heartbeat for `id` at time `now`. Creates the entry
    // if it doesn't exist; replaces any prior data payload.
    // Returns the updated entry snapshot.
    heartbeat(id, data, now) {
        if (typeof id !== 'string' || id.length === 0)
            return null;
        if (typeof now !== 'number' || !isFinite(now))
            return null;
        var existing = this.entries.get(id);
        if (existing) {
            existing.lastSeenAt = now;
            existing.heartbeatCount++;
            if (data !== undefined)
                existing.data = data;
            return this.snapshot(existing);
        }
        // New entry. Apply max-entries cap.
        if (this.entries.size >= this.maxEntries) {
            this.evictOldest();
        }
        var fresh = {
            id: id,
            lastSeenAt: now,
            firstSeenAt: now,
            heartbeatCount: 1,
        };
        if (data !== undefined)
            fresh.data = data;
        this.entries.set(id, fresh);
        return this.snapshot(fresh);
    }
    // Force-remove `id`. Returns true if it existed.
    remove(id) {
        return this.entries.delete(id);
    }
    // Sweep expired entries (lastSeenAt + timeoutMs <= now).
    // Returns the list of expired ids that were removed.
    tick(now) {
        if (typeof now !== 'number' || !isFinite(now))
            return [];
        var expired = [];
        var iter = this.entries.entries();
        var v = iter.next();
        while (!v.done) {
            var pair = v.value;
            if ((now - pair[1].lastSeenAt) > this.timeoutMs) {
                expired.push(pair[0]);
            }
            v = iter.next();
        }
        for (var i = 0; i < expired.length; i++) {
            this.entries.delete(expired[i]);
        }
        return expired;
    }
    // Look up the current entry for `id`, or null.
    get(id) {
        var e = this.entries.get(id);
        return e ? this.snapshot(e) : null;
    }
    has(id) {
        return this.entries.has(id);
    }
    // Snapshot of all live entries.
    list() {
        var out = [];
        var iter = this.entries.values();
        var v = iter.next();
        while (!v.done) {
            out.push(this.snapshot(v.value));
            v = iter.next();
        }
        return out;
    }
    count() { return this.entries.size; }
    // Number of entries that would expire on tick(now).
    staleCount(now) {
        if (typeof now !== 'number' || !isFinite(now))
            return 0;
        var n = 0;
        var iter = this.entries.values();
        var v = iter.next();
        while (!v.done) {
            if ((now - v.value.lastSeenAt) > this.timeoutMs)
                n++;
            v = iter.next();
        }
        return n;
    }
    // Read-only diagnostics.
    getTimeoutMs() { return this.timeoutMs; }
    setTimeoutMs(ms) {
        if (typeof ms === 'number' && ms > 0)
            this.timeoutMs = ms;
    }
    clear() {
        this.entries.clear();
    }
    // ---------- private ----------
    snapshot(e) {
        var out = {
            id: e.id,
            lastSeenAt: e.lastSeenAt,
            firstSeenAt: e.firstSeenAt,
            heartbeatCount: e.heartbeatCount,
        };
        if (e.data !== undefined)
            out.data = e.data;
        return out;
    }
    evictOldest() {
        var oldestId = null;
        var oldestSeen = Infinity;
        var iter = this.entries.entries();
        var v = iter.next();
        while (!v.done) {
            var pair = v.value;
            if (pair[1].lastSeenAt < oldestSeen) {
                oldestSeen = pair[1].lastSeenAt;
                oldestId = pair[0];
            }
            v = iter.next();
        }
        if (oldestId !== null)
            this.entries.delete(oldestId);
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_PRESENCE_TRACKER = 'presence_tracker';
//# sourceMappingURL=presence-tracker.js.map