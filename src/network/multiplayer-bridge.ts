// MultiplayerBridge - abstraction over the presence transport.
//
// Concrete implementations:
//   MockMultiplayerBridge - in-process transport for tests + offline
//                           dev. enqueueIncoming() simulates server
//                           pushes; broadcastPosition() captures local
//                           sends so tests can assert on them.
//   SSEMultiplayerBridge  - SSE-based implementation parallel to
//                           SSEDirectorBridge. Browser-only; throws in
//                           Node test runs.
//
// The PeerPresenceSystem (PHASE_INPUT) calls pollMessages() once per
// tick to drain queued presence updates, applies them to the PeerPool,
// and advances per-peer interpolation. Bridges buffer messages between
// polls so the system's per-tick read is bounded.
//
// Wire protocol (shared with the server-side Track B implementation):
//   - Server emits SSE 'presence.update'   { character_id, x, y, zone, ts_ms, name? }
//   - Server emits SSE 'presence.depart'   { character_id }
//   - Server emits SSE 'presence.snapshot' { peers: [{ character_id, x, y, zone, ts_ms, name? }, ...] }
//   - Client POSTs   /presence/move        { character_id, x, y, zone, ts_ms }
//
// The bridge layer hides transport details. PeerPresenceSystem and
// PeerPool deal only with strongly-typed PresenceMessage values.

export type MultiplayerBridgeStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed';

export interface MultiplayerBridgeStats {
  // Total messages received since connect().
  messagesReceived: number;
  // Total messages sent (broadcastPosition calls that actually went on
  // the wire - rate-limit drops are NOT counted).
  messagesSent: number;
  // Total broadcastPosition calls that were dropped by the rate
  // limiter without going on the wire.
  rateLimitedDrops: number;
  // Total reconnect attempts since connect().
  reconnects: number;
}

// Presence-update message: a peer is at (x, y) in a zone at ts_ms.
// Carries optional display name. The same shape arrives both from
// snapshots (bulk) and from individual updates.
export interface PresenceUpdate {
  kind: 'update';
  characterId: string;
  x: number;
  y: number;
  zone: string;
  tsMs: number;
  name?: string;
}

// Peer disconnected; the pool should remove their entry.
export interface PresenceDepart {
  kind: 'depart';
  characterId: string;
}

// Bulk state on cold-connect. The pool replaces its entire roster
// with the snapshot's peers (any peer not in the snapshot is dropped).
export interface PresenceSnapshot {
  kind: 'snapshot';
  peers: ReadonlyArray<{
    characterId: string;
    x: number;
    y: number;
    zone: string;
    tsMs: number;
    name?: string;
  }>;
}

export type PresenceMessage = PresenceUpdate | PresenceDepart | PresenceSnapshot;

export interface IMultiplayerBridge {
  // Open the underlying transport. Idempotent: calling connect() while
  // already connected is a no-op.
  connect(): void;
  // Close the transport and stop reconnecting.
  disconnect(): void;
  status(): MultiplayerBridgeStatus;
  // Drain and return all queued messages since the last poll. Empties
  // the internal buffer.
  pollMessages(): PresenceMessage[];
  // Send the local character's position. Bridges rate-limit to at most
  // BROADCAST_HZ calls per second (drops excess silently and increments
  // rateLimitedDrops). Pass tsMs as the wall clock the client was at
  // when this position was true.
  broadcastPosition(x: number, y: number, zone: string, tsMs: number): void;
  stats(): Readonly<MultiplayerBridgeStats>;
}

// Resource keys.
export const RESOURCE_MULTIPLAYER_BRIDGE = 'multiplayer_bridge';
export const RESOURCE_PEER_POOL = 'peer_pool';

// Engine-side rate limit on broadcastPosition. The wire protocol
// targets 10 Hz; bridges enforce this regardless of how often the
// caller invokes broadcastPosition. Documented in the Multiplayer
// section of README.md.
export const BROADCAST_HZ = 10;
export const BROADCAST_MIN_INTERVAL_MS = 1000 / BROADCAST_HZ;
