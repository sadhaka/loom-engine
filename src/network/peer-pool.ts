// PeerPool - tracks all known remote peers and their interpolated
// world position.
//
// Each peer keeps the last two known positions (prev, current) with
// timestamps. At frame time the system asks the pool for the
// interpolated (x, y) per peer, which is computed as
//   factor = clamp01((nowMs - prevTsMs) / (currentTsMs - prevTsMs))
//   x      = lerp(prevX, currentX, factor)
//   y      = lerp(prevY, currentY, factor)
//
// When a new presence.update arrives, prev <- current, current <- new.
// The factor saturates at 1 once nowMs passes currentTsMs, so a peer
// who stops sending updates simply freezes at their last known
// position rather than extrapolating off into the distance.
//
// "Acceptable lag" per the phase 15.1 spec is ~150ms (one update
// interval at the 10Hz wire rate), which is imperceptible at
// walk-speed. No CRDT, no client-side prediction beyond the
// straight-line lerp - those are deferred until shared state extends
// past raw position.
//
// Self-filter: the local character's own character_id should NOT
// appear among the rendered peers (we don't render ourselves as a
// ghost). The PeerPresenceSystem owns this filter via
// setLocalCharacterId(); peers with that id are silently skipped on
// upsert and removed if already present.

export interface PeerEntry {
  characterId: string;
  zone: string;
  name: string | null;
  // Two most recent positions. prev is what we lerp from; current is
  // what we lerp to.
  prevX: number;
  prevY: number;
  prevTsMs: number;
  currentX: number;
  currentY: number;
  currentTsMs: number;
  // Last frame the pool surfaced a render position for this peer.
  // Convenient for systems that want to gate effects on staleness.
  lastRenderedFrame: number;
}

// Snapshot returned by getRenderedPosition - cheap to copy, holds
// only the values a render system needs. The pool returns a shared
// scratch object on each call to avoid allocation; consumers must
// not retain the reference past the call.
export interface RenderedPeerView {
  characterId: string;
  x: number;
  y: number;
  zone: string;
  name: string | null;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

export class PeerPool {
  private peers: Map<string, PeerEntry> = new Map();
  private localCharacterId: string | null = null;

  // Reused on every getRenderedPosition / forEachRendered call so the
  // hot per-frame path is allocation-free.
  private scratchView: RenderedPeerView = {
    characterId: '',
    x: 0,
    y: 0,
    zone: '',
    name: null,
  };

  setLocalCharacterId(id: string | null): void {
    this.localCharacterId = id;
    if (id !== null && this.peers.has(id)) {
      this.peers.delete(id);
    }
  }

  getLocalCharacterId(): string | null {
    return this.localCharacterId;
  }

  // Apply a new presence update for a peer. If the peer is the local
  // character, the update is ignored (self-filter). If this is the
  // first update for the peer, prev = current = the new position so
  // the lerp factor immediately saturates and the peer renders at the
  // sent position.
  upsert(characterId: string, x: number, y: number, zone: string, tsMs: number, name?: string): void {
    if (this.localCharacterId !== null && characterId === this.localCharacterId) {
      return;
    }
    const existing = this.peers.get(characterId);
    if (!existing) {
      this.peers.set(characterId, {
        characterId,
        zone,
        name: name ?? null,
        prevX: x,
        prevY: y,
        prevTsMs: tsMs,
        currentX: x,
        currentY: y,
        currentTsMs: tsMs,
        lastRenderedFrame: -1,
      });
      return;
    }
    // Out-of-order: drop messages older than current. Wire protocol
    // is monotonic per character_id, but reorder buffers + reconnect
    // replays can deliver an older ts after a newer one.
    if (tsMs < existing.currentTsMs) {
      return;
    }
    existing.prevX = existing.currentX;
    existing.prevY = existing.currentY;
    existing.prevTsMs = existing.currentTsMs;
    existing.currentX = x;
    existing.currentY = y;
    existing.currentTsMs = tsMs;
    existing.zone = zone;
    if (name !== undefined) {
      existing.name = name;
    }
  }

  // Replace the entire roster with a snapshot. Peers not present in
  // the snapshot are dropped; peers in the snapshot but not yet
  // tracked are inserted (with prev = current so they render at the
  // sent position immediately).
  applySnapshot(
    peers: ReadonlyArray<{
      characterId: string;
      x: number;
      y: number;
      zone: string;
      tsMs: number;
      name?: string;
    }>,
  ): void {
    const seen: Set<string> = new Set();
    for (let i = 0; i < peers.length; i++) {
      const p = peers[i];
      if (!p) continue;
      if (this.localCharacterId !== null && p.characterId === this.localCharacterId) {
        continue;
      }
      seen.add(p.characterId);
      this.upsert(p.characterId, p.x, p.y, p.zone, p.tsMs, p.name);
    }
    // Drop anyone not in the snapshot. Iterate keys snapshot first
    // because Map.delete during iteration is fine but copying makes
    // intent obvious.
    const toRemove: string[] = [];
    this.peers.forEach((_v, k) => {
      if (!seen.has(k)) toRemove.push(k);
    });
    for (let i = 0; i < toRemove.length; i++) {
      const k = toRemove[i];
      if (k) this.peers.delete(k);
    }
  }

  remove(characterId: string): boolean {
    return this.peers.delete(characterId);
  }

  has(characterId: string): boolean {
    return this.peers.has(characterId);
  }

  size(): number {
    return this.peers.size;
  }

  get(characterId: string): Readonly<PeerEntry> | undefined {
    return this.peers.get(characterId);
  }

  // Iterate every tracked peer with their interpolated world
  // position at nowMs. The view object is reused; consumers must
  // copy any field they want to retain past the callback.
  forEachRendered(nowMs: number, frame: number, fn: (view: Readonly<RenderedPeerView>) => void): void {
    this.peers.forEach((entry) => {
      const v = this.scratchView;
      v.characterId = entry.characterId;
      v.zone = entry.zone;
      v.name = entry.name;
      const dt = entry.currentTsMs - entry.prevTsMs;
      if (dt <= 0) {
        v.x = entry.currentX;
        v.y = entry.currentY;
      } else {
        const t = clamp01((nowMs - entry.prevTsMs) / dt);
        v.x = lerp(entry.prevX, entry.currentX, t);
        v.y = lerp(entry.prevY, entry.currentY, t);
      }
      entry.lastRenderedFrame = frame;
      fn(v);
    });
  }

  // Single-peer query for tests + the rare ad-hoc lookup. Hot paths
  // use forEachRendered to avoid map lookups.
  getRenderedPosition(characterId: string, nowMs: number): { x: number; y: number } | null {
    const entry = this.peers.get(characterId);
    if (!entry) return null;
    const dt = entry.currentTsMs - entry.prevTsMs;
    if (dt <= 0) {
      return { x: entry.currentX, y: entry.currentY };
    }
    const t = clamp01((nowMs - entry.prevTsMs) / dt);
    return {
      x: lerp(entry.prevX, entry.currentX, t),
      y: lerp(entry.prevY, entry.currentY, t),
    };
  }

  clear(): void {
    this.peers.clear();
  }
}
