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
// Resource keys.
export const RESOURCE_DIRECTOR_BRIDGE = 'director_bridge';
export const RESOURCE_KNOT_CONTEXT = 'knot_context';
//# sourceMappingURL=director-bridge.js.map