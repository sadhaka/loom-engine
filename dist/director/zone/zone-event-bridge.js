// IZoneEventBridge - abstraction over the v2 zone-event source.
//
// Concrete implementations:
//   MockZoneBridge - in-process. enqueueIncoming(event) simulates
//                    server pushes for tests + offline demo.
//   SSEZoneBridge  - multiplexes onto an EXISTING presence
//                    EventSource. Listens for SSE frames whose
//                    `event:` line is `zone.event` (per spec §2.1).
//
// The ZoneEventSystem (PHASE_INPUT, AFTER DirectorSystem and
// PeerPresenceSystem) calls pollEvents() once per tick to drain queued
// events. Bridges buffer events between polls so the system's per-tick
// read is bounded.
//
// Per-zone monotonic id semantics (spec §8.1):
//   - Each zone has its own id sequence starting at 1.
//   - getLastEventId(zone) returns the highest id observed for that
//     zone, or 0 if no events seen.
//   - Out-of-order events are tracked in stats, but bridge-level
//     reorder buffering lives in concrete impls (the contract here is
//     the polled queue is best-effort ordered).
// Resource keys.
export const RESOURCE_ZONE_EVENT_BRIDGE = 'zone_event_bridge';
//# sourceMappingURL=zone-event-bridge.js.map