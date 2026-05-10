// MatchmakingPool - skill-based pairing with widening windows.
//
// 1.7.2 networking primitive (Wave 1.7 networking depth widens).
// "Find me N players close to my skill, soon." Players queue with
// a skill rating + desired party size; on each tick the pool tries
// to assemble matches by sliding a skill window across the queue.
// Window starts tight (initialSkillRange) and EXPANDS the longer a
// player waits, so rare-skill / low-traffic queues still resolve
// instead of starving forever.
//
//   var mm = MatchmakingPool.create({
//     partySize: 2,
//     initialSkillRange: 100,
//     expansionPerSec: 20,
//     maxSkillRange: 600,
//   });
//
//   mm.queue('alice', { skill: 1500 }, 1000);
//   mm.queue('bob',   { skill: 1520 }, 1000);
//   var matches = mm.tick(1100);
//   // matches[0].ids = ['alice', 'bob']
//
// Pure in-memory. Consumer wires transport (HTTP queue requests,
// WebSocket match notifications). Pairs with PresenceTracker (1.7.0)
// for liveness checks before honoring matches; with LobbyState (1.7.1)
// to spin up a lobby per match; with ChatChannel (1.7.5) for in-match
// communication.
//
// Skill rating semantics are consumer-defined. ELO (1000-3000),
// Glicko, MMR, custom - the pool only sees a number to range-match.
//
// Code style: var-only in browser source.

export interface QueueEntry<T = Record<string, unknown>> {
  id: string;
  skill: number;
  partySize: number;
  enqueuedAt: number;
  // Optional consumer-provided metadata (region, faction, role, etc).
  data?: T;
}

export interface QueueOptions<T = Record<string, unknown>> {
  // Override the default party size for this entry.
  partySize?: number;
  // Override the default skill rating for this entry. If omitted,
  // skill MUST be provided in the call signature.
  data?: T;
}

export interface Match<T = Record<string, unknown>> {
  // Player ids in the matched party. Length === partySize.
  ids: string[];
  // Skill spread (max - min) of the party. Always <= currentRange
  // at the moment of match.
  skillSpread: number;
  // Time the match was finalized (the tick now value).
  matchedAt: number;
  // Per-id queue entries (snapshots). Same order as ids.
  entries: QueueEntry<T>[];
}

export interface MatchmakingOptions {
  // Default party size when queue() doesn't override. Default 2.
  partySize?: number;
  // Initial skill window (max - min) considered a match. Default 100.
  initialSkillRange?: number;
  // Skill range expansion per second of wait. Default 20 / sec.
  expansionPerSec?: number;
  // Hard cap on the expanded skill range. Default 1000.
  maxSkillRange?: number;
  // Maximum entries retained. Older entries evicted on insert when
  // exceeded. Default Infinity.
  maxEntries?: number;
}

export class MatchmakingPool<T = Record<string, unknown>> {
  private entries: Map<string, QueueEntry<T>> = new Map();
  private defaultPartySize: number;
  private initialSkillRange: number;
  private expansionPerSec: number;
  private maxSkillRange: number;
  private maxEntries: number;

  private constructor(opts: MatchmakingOptions) {
    this.defaultPartySize = (typeof opts.partySize === 'number' && opts.partySize >= 1)
      ? Math.floor(opts.partySize) : 2;
    this.initialSkillRange = (typeof opts.initialSkillRange === 'number' && opts.initialSkillRange > 0)
      ? opts.initialSkillRange : 100;
    this.expansionPerSec = (typeof opts.expansionPerSec === 'number' && opts.expansionPerSec >= 0)
      ? opts.expansionPerSec : 20;
    this.maxSkillRange = (typeof opts.maxSkillRange === 'number' && opts.maxSkillRange > 0)
      ? opts.maxSkillRange : 1000;
    this.maxEntries = (typeof opts.maxEntries === 'number' && opts.maxEntries > 0)
      ? Math.floor(opts.maxEntries) : Infinity;
  }

  static create<T = Record<string, unknown>>(
    opts: MatchmakingOptions = {}): MatchmakingPool<T> {
    return new MatchmakingPool<T>(opts);
  }

  // Add `id` to the matchmaking queue with skill rating. Returns the
  // queue entry snapshot, or null if input invalid. If id already
  // queued, REPLACES the entry (re-queue with new skill / party size).
  queue(id: string, skill: number, now: number, opts?: QueueOptions<T>): QueueEntry<T> | null {
    if (typeof id !== 'string' || id.length === 0) return null;
    if (typeof skill !== 'number' || !isFinite(skill)) return null;
    if (typeof now !== 'number' || !isFinite(now)) return null;
    var partySize = opts && typeof opts.partySize === 'number' && opts.partySize >= 1
      ? Math.floor(opts.partySize) : this.defaultPartySize;
    if (!this.entries.has(id) && this.entries.size >= this.maxEntries) {
      this.evictOldest();
    }
    var entry: QueueEntry<T> = {
      id: id,
      skill: skill,
      partySize: partySize,
      enqueuedAt: now,
    };
    if (opts && opts.data !== undefined) entry.data = opts.data;
    this.entries.set(id, entry);
    return this.snapshot(entry);
  }

  // Remove `id` from the queue. Returns true if it was queued.
  cancel(id: string): boolean {
    return this.entries.delete(id);
  }

  // Try to assemble matches at time `now`. Walks queue (sorted by
  // skill) and greedily groups players whose skill spread fits the
  // CURRENT (per-player) widened range. Returns the array of finalized
  // matches; matched ids are removed from the queue.
  tick(now: number): Match<T>[] {
    if (typeof now !== 'number' || !isFinite(now)) return [];
    if (this.entries.size === 0) return [];
    // Group queue entries by required partySize so 2-player queues
    // can't accidentally fill a 4-player request.
    var bySize: Map<number, QueueEntry<T>[]> = new Map();
    var iter = this.entries.values();
    var v = iter.next();
    while (!v.done) {
      var e = v.value;
      var bucket = bySize.get(e.partySize);
      if (!bucket) {
        bucket = [];
        bySize.set(e.partySize, bucket);
      }
      bucket.push(e);
      v = iter.next();
    }

    var matches: Match<T>[] = [];
    var matched: Set<string> = new Set();

    var sizeIter = bySize.entries();
    var sv = sizeIter.next();
    while (!sv.done) {
      var size = sv.value[0];
      var bucket2 = sv.value[1];
      // Skip buckets that can't possibly fill (single-player queues
      // always match instantly; that's allowed).
      if (size < 1 || bucket2.length < size) {
        sv = sizeIter.next();
        continue;
      }
      // Sort by skill ascending; greedy slide a window.
      bucket2.sort(function (a, b) { return a.skill - b.skill; });
      // Tight inner loop: slide a window of `size` over the sorted
      // bucket. For each position, check if all members are within
      // their (own widened) range of the leader. This favors the
      // longest-waiting players (their range is widest).
      for (var i = 0; i + size <= bucket2.length; i++) {
        // Skip if any candidate is already matched in this tick
        var skip = false;
        for (var k = 0; k < size; k++) {
          var cand = bucket2[i + k] as QueueEntry<T>;
          if (matched.has(cand.id)) { skip = true; break; }
        }
        if (skip) continue;
        var first = bucket2[i] as QueueEntry<T>;
        var last  = bucket2[i + size - 1] as QueueEntry<T>;
        var spread = last.skill - first.skill;
        // Each candidate has its OWN widened range; the match is valid
        // if the spread fits the SMALLEST range across the party.
        var minRange = Infinity;
        for (var j = 0; j < size; j++) {
          var member = bucket2[i + j] as QueueEntry<T>;
          var r = this.currentRange(member, now);
          if (r < minRange) minRange = r;
        }
        if (spread <= minRange) {
          var ids: string[] = [];
          var snaps: QueueEntry<T>[] = [];
          for (var m = 0; m < size; m++) {
            var member2 = bucket2[i + m] as QueueEntry<T>;
            ids.push(member2.id);
            snaps.push(this.snapshot(member2));
            matched.add(member2.id);
          }
          matches.push({ ids: ids, skillSpread: spread, matchedAt: now, entries: snaps });
          // Skip past matched indices
          i += size - 1;
        }
      }
      sv = sizeIter.next();
    }

    // Remove matched ids from the queue
    var matchedIter = matched.values();
    var mv = matchedIter.next();
    while (!mv.done) {
      this.entries.delete(mv.value);
      mv = matchedIter.next();
    }
    return matches;
  }

  // Read-only inspection.
  has(id: string): boolean { return this.entries.has(id); }
  get(id: string): QueueEntry<T> | null {
    var e = this.entries.get(id);
    return e ? this.snapshot(e) : null;
  }
  count(): number { return this.entries.size; }
  list(): QueueEntry<T>[] {
    var out: QueueEntry<T>[] = [];
    var iter = this.entries.values();
    var v = iter.next();
    while (!v.done) {
      out.push(this.snapshot(v.value));
      v = iter.next();
    }
    return out;
  }

  // Compute the per-entry skill range right now. Grows from
  // initialSkillRange by expansionPerSec * waitSeconds, capped at
  // maxSkillRange. Public so consumers can show wait UI.
  currentRange(entry: QueueEntry<T>, now: number): number {
    if (typeof now !== 'number' || !isFinite(now)) return this.initialSkillRange;
    var waitSec = Math.max(0, (now - entry.enqueuedAt) / 1000);
    var widened = this.initialSkillRange + waitSec * this.expansionPerSec;
    if (widened > this.maxSkillRange) widened = this.maxSkillRange;
    return widened;
  }

  // Wait time in ms for `id`. Useful for queue UI.
  waitMs(id: string, now: number): number {
    var e = this.entries.get(id);
    if (!e) return 0;
    return Math.max(0, now - e.enqueuedAt);
  }

  // Diagnostics getters - for cockpit/dashboard surfaces.
  getDefaultPartySize(): number   { return this.defaultPartySize; }
  getInitialSkillRange(): number   { return this.initialSkillRange; }
  getExpansionPerSec(): number     { return this.expansionPerSec; }
  getMaxSkillRange(): number       { return this.maxSkillRange; }

  clear(): void { this.entries.clear(); }

  // ---------- private ----------

  private snapshot(e: QueueEntry<T>): QueueEntry<T> {
    var out: QueueEntry<T> = {
      id: e.id,
      skill: e.skill,
      partySize: e.partySize,
      enqueuedAt: e.enqueuedAt,
    };
    if (e.data !== undefined) out.data = e.data;
    return out;
  }

  private evictOldest(): void {
    var oldestId: string | null = null;
    var oldestAt = Infinity;
    var iter = this.entries.entries();
    var v = iter.next();
    while (!v.done) {
      var pair = v.value;
      if (pair[1].enqueuedAt < oldestAt) {
        oldestAt = pair[1].enqueuedAt;
        oldestId = pair[0];
      }
      v = iter.next();
    }
    if (oldestId !== null) this.entries.delete(oldestId);
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_MATCHMAKING_POOL = 'matchmaking_pool';
