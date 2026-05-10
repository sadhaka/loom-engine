// AuthorityHandoff - host election + handoff on disconnect.
//
// 1.7.3 networking primitive (Wave 1.7 networking depth).
// "Who is the authority right now? When the host drops, who takes
// over?" Tracks a current host across a peer set; on heartbeat
// expiry of the host, promotes the next candidate via deterministic
// election. Combined with PresenceTracker (1.7.0) heartbeats, this
// gives a host-failover primitive that any peer-zone game can wire.
//
//   var ah = AuthorityHandoff.create({
//     hostId: 'alice',
//     timeoutMs: 8000,
//     electionStrategy: 'oldest',  // or 'lowest-id' or custom fn
//   });
//
//   ah.heartbeat('alice', 1000);    // host pings
//   ah.heartbeat('bob',   1000);    // peer pings
//   ah.heartbeat('carol', 1000);    // peer pings
//
//   // 9 sec later (host stops pinging):
//   var change = ah.tick(10000);
//   // change = { kind: 'handoff', oldHostId: 'alice', newHostId: 'bob' }
//
// Election strategies:
//   'oldest'    - peer with the EARLIEST firstSeenAt wins (most stable)
//   'lowest-id' - peer with lowest lexicographic id wins (deterministic
//                 across peers without coordination)
//   custom function: (peers) => string | null
//
// Pure in-memory. Consumer wires transport: heartbeats arrive via
// WebSocket/SSE/HTTP, handoff events are broadcast to peers so they
// agree on the new authority.
//
// Code style: var-only in browser source.

export interface AuthorityPeer {
  id: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

export type ElectionStrategy =
  | 'oldest'
  | 'lowest-id'
  | ((peers: AuthorityPeer[]) => string | null);

export interface AuthorityChange {
  kind: 'handoff' | 'host-leave' | 'no-host' | 'reclaim';
  oldHostId: string | null;
  newHostId: string | null;
  at: number;
}

export interface AuthorityOptions {
  // Initial host (optional). May be set/replaced via setHost(id, now).
  hostId?: string;
  // ms without a heartbeat before a peer is considered dropped.
  // Default 8000.
  timeoutMs?: number;
  // How to pick the next host when the current one drops.
  // Default 'oldest'.
  electionStrategy?: ElectionStrategy;
}

export class AuthorityHandoff {
  private peers: Map<string, AuthorityPeer> = new Map();
  private hostId: string | null;
  private timeoutMs: number;
  private strategy: ElectionStrategy;

  private constructor(opts: AuthorityOptions) {
    this.hostId = (typeof opts.hostId === 'string' && opts.hostId.length > 0)
      ? opts.hostId : null;
    this.timeoutMs = (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0)
      ? opts.timeoutMs : 8000;
    this.strategy = opts.electionStrategy || 'oldest';
  }

  static create(opts: AuthorityOptions = {}): AuthorityHandoff {
    return new AuthorityHandoff(opts);
  }

  // Record a heartbeat for `id` at time `now`. Adds the peer if it
  // doesn't exist; updates lastSeenAt otherwise.
  heartbeat(id: string, now: number): void {
    if (typeof id !== 'string' || id.length === 0) return;
    if (typeof now !== 'number' || !isFinite(now)) return;
    var existing = this.peers.get(id);
    if (existing) {
      existing.lastSeenAt = now;
      return;
    }
    this.peers.set(id, { id: id, firstSeenAt: now, lastSeenAt: now });
  }

  // Force-set the current host. Used for explicit handover (host
  // intentionally passes the baton). If newHost is not a known peer,
  // adds them with `now` as firstSeenAt.
  setHost(newHost: string | null, now: number): AuthorityChange {
    var oldHost = this.hostId;
    if (newHost === null) {
      this.hostId = null;
      return { kind: 'no-host', oldHostId: oldHost, newHostId: null, at: now };
    }
    if (!this.peers.has(newHost)) {
      this.peers.set(newHost, { id: newHost, firstSeenAt: now, lastSeenAt: now });
    }
    this.hostId = newHost;
    if (oldHost === newHost) {
      return { kind: 'reclaim', oldHostId: oldHost, newHostId: newHost, at: now };
    }
    return { kind: 'handoff', oldHostId: oldHost, newHostId: newHost, at: now };
  }

  // Force-remove a peer (clean disconnect). If they were the host,
  // immediately elects a new host using the configured strategy.
  removePeer(id: string, now: number): AuthorityChange | null {
    if (!this.peers.has(id)) return null;
    var wasHost = (this.hostId === id);
    this.peers.delete(id);
    if (wasHost) {
      var newHost = this.elect();
      this.hostId = newHost;
      if (newHost === null) {
        return { kind: 'no-host', oldHostId: id, newHostId: null, at: now };
      }
      return { kind: 'host-leave', oldHostId: id, newHostId: newHost, at: now };
    }
    return null;
  }

  // Sweep timed-out peers. If the current host timed out, elect a new
  // one. Returns AuthorityChange iff a handoff happened.
  tick(now: number): AuthorityChange | null {
    if (typeof now !== 'number' || !isFinite(now)) return null;
    var timeoutMs = this.timeoutMs;
    var dropped: string[] = [];
    var iter = this.peers.entries();
    var v = iter.next();
    while (!v.done) {
      var pair = v.value;
      if ((now - pair[1].lastSeenAt) > timeoutMs) {
        dropped.push(pair[0]);
      }
      v = iter.next();
    }
    var hostDropped = false;
    for (var i = 0; i < dropped.length; i++) {
      var id = dropped[i] as string;
      this.peers.delete(id);
      if (this.hostId === id) hostDropped = true;
    }
    if (!hostDropped) return null;
    var oldHost = this.hostId;
    var newHost = this.elect();
    this.hostId = newHost;
    if (newHost === null) {
      return { kind: 'no-host', oldHostId: oldHost, newHostId: null, at: now };
    }
    return { kind: 'handoff', oldHostId: oldHost, newHostId: newHost, at: now };
  }

  // Run the configured election among current peers. Returns the
  // chosen id or null if no peers remain.
  elect(): string | null {
    if (this.peers.size === 0) return null;
    if (typeof this.strategy === 'function') {
      var custom = this.strategy(this.list());
      return (typeof custom === 'string' && this.peers.has(custom)) ? custom : null;
    }
    if (this.strategy === 'lowest-id') {
      var minId: string | null = null;
      var iter2 = this.peers.keys();
      var v2 = iter2.next();
      while (!v2.done) {
        if (minId === null || (v2.value as string) < minId) minId = v2.value;
        v2 = iter2.next();
      }
      return minId;
    }
    // 'oldest' default
    var oldestId: string | null = null;
    var oldestAt = Infinity;
    var iter3 = this.peers.entries();
    var v3 = iter3.next();
    while (!v3.done) {
      var pair2 = v3.value;
      if (pair2[1].firstSeenAt < oldestAt) {
        oldestAt = pair2[1].firstSeenAt;
        oldestId = pair2[0];
      }
      v3 = iter3.next();
    }
    return oldestId;
  }

  // Read-only inspection.
  getHostId(): string | null { return this.hostId; }
  hasPeer(id: string): boolean { return this.peers.has(id); }
  peerCount(): number { return this.peers.size; }
  list(): AuthorityPeer[] {
    var out: AuthorityPeer[] = [];
    var iter = this.peers.values();
    var v = iter.next();
    while (!v.done) {
      out.push({
        id: v.value.id,
        firstSeenAt: v.value.firstSeenAt,
        lastSeenAt: v.value.lastSeenAt,
      });
      v = iter.next();
    }
    return out;
  }
  getTimeoutMs(): number { return this.timeoutMs; }
  setTimeoutMs(ms: number): void {
    if (typeof ms === 'number' && ms > 0) this.timeoutMs = ms;
  }

  clear(): void {
    this.peers.clear();
    this.hostId = null;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_AUTHORITY_HANDOFF = 'authority_handoff';
