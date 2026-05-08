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

import type { ZoneEvent } from './zone-event-envelope.js';

export type ZoneEventBridgeStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'snapshot-required'
  | 'closed';

export interface ZoneEventBridgeStats {
  // Total events received since start().
  eventsReceived: number;
  // Total reconnect attempts since start().
  reconnects: number;
  // Out-of-order events received (per-zone gap detection).
  outOfOrderEvents: number;
  // Last server-reported drop counters (P1, P2 from spec §3.1
  // priority drop semantics).
  serverDropsP1: number;
  serverDropsP2: number;
  // Per-zone last-id map snapshot. Allocations cost; called rarely
  // (HUD / debug only).
  lastEventIdByZone: ReadonlyMap<string, number>;
  // 0.20.1 - connection-timing fields. SSEZoneBridge does NOT own the
  // EventSource (presence layer does), so these track the bridge's
  // OBSERVED transitions of the underlying readyState rather than its
  // own retry attempts. Mirrors DirectorBridgeStats for HUD parity.
  lastConnectedAtMs: number;
  lastDisconnectedAtMs: number;
  totalConnectsCount: number;
  totalDisconnectsCount: number;
}

export interface IZoneEventBridge {
  start(): void;
  stop(): void;
  status(): ZoneEventBridgeStatus;
  isConnected(): boolean;
  // Last-seen id for this zone, or 0 if no events seen for it.
  getLastEventId(zone: string): number;
  // Drain and return all queued events since the last poll.
  pollEvents(): ZoneEvent[];
  stats(): Readonly<ZoneEventBridgeStats>;
}

// Resource keys.
export const RESOURCE_ZONE_EVENT_BRIDGE = 'zone_event_bridge';
