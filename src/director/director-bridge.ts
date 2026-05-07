// IDirectorBridge - abstraction over the event source.
//
// Concrete implementations:
//   MockDirectorBridge  - synthetic event injection. Used in tests +
//                         offline demo. Does not touch the network.
//   SSEDirectorBridge   - real EventSource subscription against the
//                         backend's /api/v1/loom/director/events route.
//                         Browser-only; throws in Node test runs.
//
// The DirectorSystem (PHASE_INPUT) calls pollEvents() once per tick
// to drain queued events. Bridges buffer events between polls so the
// system's per-tick read is bounded.
//
// Connection lifecycle:
//   start()            - begin subscription / open EventSource
//   stop()             - close and stop reconnecting
//   isConnected()      - true when the underlying transport is open
//   getLastEventId()   - highest id observed; used for reconnect Last-Event-ID
//   pollEvents()       - drain and return all queued events since last poll

import type { DirectorEvent } from './event-envelope.js';

export type DirectorBridgeStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'snapshot-required'
  | 'closed';

export interface DirectorBridgeStats {
  // Total events received since start().
  eventsReceived: number;
  // Total reconnect attempts since start().
  reconnects: number;
  // Last event id observed (highest), 0 if no events seen.
  lastEventId: number;
  // Out-of-order events received (gap detection from spec §4.2).
  outOfOrderEvents: number;
  // Last server-reported drop counters from system.heartbeat.
  serverDropsP1: number;
  serverDropsP2: number;
}

export interface IDirectorBridge {
  start(): void;
  stop(): void;
  status(): DirectorBridgeStatus;
  isConnected(): boolean;
  getLastEventId(): number;
  pollEvents(): DirectorEvent[];
  stats(): Readonly<DirectorBridgeStats>;
}

// Resource keys.
export const RESOURCE_DIRECTOR_BRIDGE = 'director_bridge';
export const RESOURCE_KNOT_CONTEXT = 'knot_context';
