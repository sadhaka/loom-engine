// IAIPlugin - server-side plugin SPI for the Director.
//
// Per LOOM-DIRECTOR-PROTOCOL-V2 Section 5: the engine no longer
// hardcodes a single Anthropic flow. Consumers register any number of
// IAIPlugin implementations against the AIPluginRegistry, and the
// runtime dispatches lifecycle hooks (tick, peer join/leave, zone
// enter, player action). Each hook returns EmittedEvents - either
// per-character v1 envelopes, v2 zone events, or both.
//
// This module is server-only. The browser bundle never imports it.
// It is exposed only via the `@sadhaka/loom-engine/server` entry
// point so consumers can wire LLM-backed plugins (Anthropic, OpenAI,
// local models, deterministic state machines, ...) on the Node side
// while the browser engine stays small.
//
// `ZoneEvent` (LOOM-DIRECTOR-PROTOCOL-V2 §3) is defined in
// `src/director/zone/zone-event-envelope.ts` (Track A, merged into
// 0.14.0 alongside this module). The registry carries zone events
// opaquely - it never dereferences fields beyond the discriminated
// union - so the only consumer of the strict type is plugin authors
// constructing ZoneEvent values in their hook returns.
//
// Spec invariants preserved:
//   - All hooks are async; they return EmittedEvents.
//   - Hooks not implemented by a plugin are simply omitted; the
//     registry checks `typeof plugin.onX === 'function'` before call.
//   - Plugins are pure-ish: given a context, they return events.
//     State mutation is the engine's job (open question 8.2 resolved).
//   - Plugin-direct event emission outside its returned EmittedEvents
//     is not supported; the registry is the single funnel.
export {};
//# sourceMappingURL=plugin.js.map