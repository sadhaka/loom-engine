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
// Resource keys.
export const RESOURCE_MULTIPLAYER_BRIDGE = 'multiplayer_bridge';
export const RESOURCE_PEER_POOL = 'peer_pool';
// Engine-side rate limit on broadcastPosition. The wire protocol
// targets 10 Hz; bridges enforce this regardless of how often the
// caller invokes broadcastPosition. Documented in the Multiplayer
// section of README.md.
export const BROADCAST_HZ = 10;
export const BROADCAST_MIN_INTERVAL_MS = 1000 / BROADCAST_HZ;
//# sourceMappingURL=multiplayer-bridge.js.map