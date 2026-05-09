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

export type LobbyStatus = 'waiting' | 'started' | 'ended';

export interface LobbyMember<T = Record<string, unknown>> {
  id: string;
  ready: boolean;
  joinedAt: number;
  data?: T;
}

export interface LobbyOptions {
  id: string;
  minSize?: number;   // Default 2
  maxSize?: number;   // Default 8
  hostId?: string;    // Default first joiner
  // ms per-member timeout. After this without a 'touch', auto-kick.
  // Default Infinity (no timeout).
  memberTimeoutMs?: number;
}

interface InternalMember<T> {
  id: string;
  ready: boolean;
  joinedAt: number;
  lastTouchAt: number;
  data?: T;
}

export class LobbyState<T = Record<string, unknown>> {
  private id_: string;
  private minSize: number;
  private maxSize: number;
  private hostId: string | null;
  private status: LobbyStatus = 'waiting';
  private members: Map<string, InternalMember<T>> = new Map();
  private memberTimeoutMs: number;
  private startedAt: number = 0;

  private constructor(opts: LobbyOptions) {
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

  static create<T = Record<string, unknown>>(opts: LobbyOptions): LobbyState<T> {
    return new LobbyState<T>(opts);
  }

  // ---------- membership ----------

  // Add `id` to the lobby. Returns true on success, false if at
  // capacity, lobby already started, or id already a member.
  // Optional `now` updates the lastTouchAt timestamp; defaults 0.
  join(id: string, data?: T, now: number = 0): boolean {
    if (this.status !== 'waiting') return false;
    if (typeof id !== 'string' || id.length === 0) return false;
    if (this.members.has(id)) return false;
    if (this.members.size >= this.maxSize) return false;
    var m: InternalMember<T> = {
      id: id,
      ready: false,
      joinedAt: now,
      lastTouchAt: now,
    };
    if (data !== undefined) m.data = data;
    this.members.set(id, m);
    if (this.hostId === null) this.hostId = id;
    return true;
  }

  // Remove `id` from the lobby. If `id` was host, the next-oldest
  // member becomes host. Returns true if a member was removed.
  leave(id: string): boolean {
    if (!this.members.has(id)) return false;
    this.members.delete(id);
    if (this.hostId === id) {
      this.hostId = this.findOldestId();
    }
    return true;
  }

  // Force-remove a member (kicked by host or by timeout).
  kick(id: string): boolean {
    return this.leave(id);
  }

  // Set ready/not-ready for a member.
  markReady(id: string, ready: boolean): boolean {
    var m = this.members.get(id);
    if (!m) return false;
    m.ready = !!ready;
    return true;
  }

  // Bump the lastTouchAt for `id` so the timeout sweeper doesn't
  // kick them. Use this when their network heartbeat arrives.
  touch(id: string, now: number): boolean {
    var m = this.members.get(id);
    if (!m) return false;
    m.lastTouchAt = now;
    return true;
  }

  // Sweep members past memberTimeoutMs since lastTouchAt. Returns
  // the list of kicked ids.
  tick(now: number): string[] {
    if (!isFinite(this.memberTimeoutMs)) return [];
    var kicked: string[] = [];
    var iter = this.members.entries();
    var v = iter.next();
    while (!v.done) {
      var pair = v.value;
      if ((now - pair[1].lastTouchAt) > this.memberTimeoutMs) {
        kicked.push(pair[0]);
      }
      v = iter.next();
    }
    for (var i = 0; i < kicked.length; i++) this.leave(kicked[i] as string);
    return kicked;
  }

  // ---------- lifecycle ----------

  canStart(): boolean {
    if (this.status !== 'waiting') return false;
    if (this.members.size < this.minSize) return false;
    var iter = this.members.values();
    var v = iter.next();
    while (!v.done) {
      if (!v.value.ready) return false;
      v = iter.next();
    }
    return true;
  }

  start(now: number = 0): boolean {
    if (!this.canStart()) return false;
    this.status = 'started';
    this.startedAt = now;
    return true;
  }

  end(): boolean {
    if (this.status === 'ended') return false;
    this.status = 'ended';
    return true;
  }

  // ---------- queries ----------

  hasMember(id: string): boolean { return this.members.has(id); }

  getMember(id: string): LobbyMember<T> | null {
    var m = this.members.get(id);
    return m ? this.snapshot(m) : null;
  }

  members$(): LobbyMember<T>[] {
    var out: LobbyMember<T>[] = [];
    var iter = this.members.values();
    var v = iter.next();
    while (!v.done) {
      out.push(this.snapshot(v.value));
      v = iter.next();
    }
    return out;
  }

  // Alias - 'members' clashes with the private field; expose as list().
  list(): LobbyMember<T>[] { return this.members$(); }

  count(): number { return this.members.size; }
  isFull(): boolean { return this.members.size >= this.maxSize; }
  getId(): string { return this.id_; }
  getStatus(): LobbyStatus { return this.status; }
  getHostId(): string | null { return this.hostId; }
  getMinSize(): number { return this.minSize; }
  getMaxSize(): number { return this.maxSize; }
  getStartedAt(): number { return this.startedAt; }

  // Reassign host. Only valid while waiting; rejected if newHostId
  // isn't a member.
  setHost(newHostId: string): boolean {
    if (!this.members.has(newHostId)) return false;
    this.hostId = newHostId;
    return true;
  }

  // ---------- private ----------

  private snapshot(m: InternalMember<T>): LobbyMember<T> {
    var out: LobbyMember<T> = {
      id: m.id,
      ready: m.ready,
      joinedAt: m.joinedAt,
    };
    if (m.data !== undefined) out.data = m.data;
    return out;
  }

  private findOldestId(): string | null {
    var oldestId: string | null = null;
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
