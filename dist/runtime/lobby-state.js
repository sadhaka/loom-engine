// LobbyState - pre-game waiting room with ready states.
//
// 1.7.1 enabling primitive (Wave 1.7 networking depth). Players
// join a lobby, mark themselves ready, leave, get kicked. Lobby
// auto-starts when minSize is met AND every member is ready.
// Pure state container; consumer wires the network transport.
//
//   var lb = LobbyState.create({ id: 'crypt-co-op',
//                                  minSize: 2, maxSize: 4,
//                                  hostId: 'user_42' });
//   lb.join('user_42', { name: 'Misha' });
//   lb.join('user_43', { name: 'Sunisa' });
//   lb.markReady('user_42', true);
//   lb.markReady('user_43', true);
//   lb.canStart();         // true (>= minSize, all ready)
//   lb.start();            // status -> 'started'
//
// Pairs with PresenceTracker (1.7.0, drop members on heartbeat
// timeout), MatchmakingPool (1.7.2 next, populates lobby state
// from skill-matched candidates), AuthorityHandoff (1.7.3, host
// migration on disconnect).
//
// Code style: var-only in browser source.
export class LobbyState {
    id_;
    minSize;
    maxSize;
    hostId;
    status = 'waiting';
    members = new Map();
    memberTimeoutMs;
    startedAt = 0;
    constructor(opts) {
        if (!opts || typeof opts.id !== 'string' || opts.id.length === 0) {
            throw new Error('LobbyState: id required');
        }
        this.id_ = opts.id;
        this.minSize = (typeof opts.minSize === 'number' && opts.minSize > 0)
            ? Math.floor(opts.minSize) : 2;
        this.maxSize = (typeof opts.maxSize === 'number' && opts.maxSize >= this.minSize)
            ? Math.floor(opts.maxSize) : 8;
        this.hostId = (typeof opts.hostId === 'string' && opts.hostId.length > 0)
            ? opts.hostId : null;
        this.memberTimeoutMs = (typeof opts.memberTimeoutMs === 'number' && opts.memberTimeoutMs > 0)
            ? opts.memberTimeoutMs : Infinity;
    }
    static create(opts) {
        return new LobbyState(opts);
    }
    // ---------- membership ----------
    // Add `id` to the lobby. Returns true on success, false if at
    // capacity, lobby already started, or id already a member.
    // Optional `now` updates the lastTouchAt timestamp; defaults 0.
    join(id, data, now = 0) {
        if (this.status !== 'waiting')
            return false;
        if (typeof id !== 'string' || id.length === 0)
            return false;
        if (this.members.has(id))
            return false;
        if (this.members.size >= this.maxSize)
            return false;
        var m = {
            id: id,
            ready: false,
            joinedAt: now,
            lastTouchAt: now,
        };
        if (data !== undefined)
            m.data = data;
        this.members.set(id, m);
        if (this.hostId === null)
            this.hostId = id;
        return true;
    }
    // Remove `id` from the lobby. If `id` was host, the next-oldest
    // member becomes host. Returns true if a member was removed.
    leave(id) {
        if (!this.members.has(id))
            return false;
        this.members.delete(id);
        if (this.hostId === id) {
            this.hostId = this.findOldestId();
        }
        return true;
    }
    // Force-remove a member (kicked by host or by timeout).
    kick(id) {
        return this.leave(id);
    }
    // Set ready/not-ready for a member.
    markReady(id, ready) {
        var m = this.members.get(id);
        if (!m)
            return false;
        m.ready = !!ready;
        return true;
    }
    // Bump the lastTouchAt for `id` so the timeout sweeper doesn't
    // kick them. Use this when their network heartbeat arrives.
    touch(id, now) {
        var m = this.members.get(id);
        if (!m)
            return false;
        m.lastTouchAt = now;
        return true;
    }
    // Sweep members past memberTimeoutMs since lastTouchAt. Returns
    // the list of kicked ids.
    tick(now) {
        if (!isFinite(this.memberTimeoutMs))
            return [];
        var kicked = [];
        var iter = this.members.entries();
        var v = iter.next();
        while (!v.done) {
            var pair = v.value;
            if ((now - pair[1].lastTouchAt) > this.memberTimeoutMs) {
                kicked.push(pair[0]);
            }
            v = iter.next();
        }
        for (var i = 0; i < kicked.length; i++)
            this.leave(kicked[i]);
        return kicked;
    }
    // ---------- lifecycle ----------
    canStart() {
        if (this.status !== 'waiting')
            return false;
        if (this.members.size < this.minSize)
            return false;
        var iter = this.members.values();
        var v = iter.next();
        while (!v.done) {
            if (!v.value.ready)
                return false;
            v = iter.next();
        }
        return true;
    }
    start(now = 0) {
        if (!this.canStart())
            return false;
        this.status = 'started';
        this.startedAt = now;
        return true;
    }
    end() {
        if (this.status === 'ended')
            return false;
        this.status = 'ended';
        return true;
    }
    // ---------- queries ----------
    hasMember(id) { return this.members.has(id); }
    getMember(id) {
        var m = this.members.get(id);
        return m ? this.snapshot(m) : null;
    }
    members$() {
        var out = [];
        var iter = this.members.values();
        var v = iter.next();
        while (!v.done) {
            out.push(this.snapshot(v.value));
            v = iter.next();
        }
        return out;
    }
    // Alias - 'members' clashes with the private field; expose as list().
    list() { return this.members$(); }
    count() { return this.members.size; }
    isFull() { return this.members.size >= this.maxSize; }
    getId() { return this.id_; }
    getStatus() { return this.status; }
    getHostId() { return this.hostId; }
    getMinSize() { return this.minSize; }
    getMaxSize() { return this.maxSize; }
    getStartedAt() { return this.startedAt; }
    // Reassign host. Only valid while waiting; rejected if newHostId
    // isn't a member.
    setHost(newHostId) {
        if (!this.members.has(newHostId))
            return false;
        this.hostId = newHostId;
        return true;
    }
    // ---------- private ----------
    snapshot(m) {
        var out = {
            id: m.id,
            ready: m.ready,
            joinedAt: m.joinedAt,
        };
        if (m.data !== undefined)
            out.data = m.data;
        return out;
    }
    findOldestId() {
        var oldestId = null;
        var oldestJoined = Infinity;
        var iter = this.members.values();
        var v = iter.next();
        while (!v.done) {
            if (v.value.joinedAt < oldestJoined) {
                oldestJoined = v.value.joinedAt;
                oldestId = v.value.id;
            }
            v = iter.next();
        }
        return oldestId;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_LOBBY_STATE = 'lobby_state';
//# sourceMappingURL=lobby-state.js.map