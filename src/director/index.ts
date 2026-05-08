// Director module barrel - re-exports the v1 (Phase 6) surface plus
// the v2 (Phase 16) zone-event surface.
//
// v1 lives at the top level of src/director/. v2 lives under
// src/director/zone/. Track B's AI Plugin SPI lives under
// src/director/ai/ and is re-exported via @sadhaka/loom-engine/server,
// not from here. We do not pull AI plugin types into this barrel so
// the browser bundle stays small.
//
// Engine-level public re-exports happen in ../index.ts. Internal
// callers can import from this barrel for convenience.

// ===== v1 (Phase 6) - LOCKED =====
export type {
  EventEnvelope,
  DirectorEvent,
  DirectorEventType,
  DirectorEventDataMap,
  EventPriority,
  EncounterSpawnData,
  EncounterTickData,
  EncounterEndData,
  EncounterLootData,
  KnotContextData,
  KnotPaletteHex,
  KnotMood,
  VeBudgetUpdateData,
  VeilTier,
  SceneTransitionData,
  SceneTransitionKind,
  NarratorLineData,
  NarratorVoice,
  SystemHeartbeatData,
  SystemReplayCompleteData,
  SystemSnapshotRequiredData,
  MobSpec,
  BossSpec,
  DropSpec,
} from './event-envelope.js';
export {
  parseEnvelope,
  parseEnvelopeJson,
  priorityFor,
  EventEnvelopeParseError,
} from './event-envelope.js';
export type {
  IDirectorBridge,
  DirectorBridgeStatus,
  DirectorBridgeStats,
} from './director-bridge.js';
export {
  RESOURCE_DIRECTOR_BRIDGE,
  RESOURCE_KNOT_CONTEXT,
} from './director-bridge.js';
export { MockDirectorBridge } from './mock-director-bridge.js';
export type { SSEDirectorBridgeOptions } from './sse-director-bridge.js';
export { SSEDirectorBridge } from './sse-director-bridge.js';
export type { KnotPaletteRgba } from './knot-context-resource.js';
export { KnotContextResource } from './knot-context-resource.js';
export type { DirectorEventLog } from './director-system.js';
export {
  DirectorSystem,
  RESOURCE_DIRECTOR_LOG,
  createDirectorEventLog,
} from './director-system.js';
export type { DirectorEncounterSystemOptions } from './director-encounter-system.js';
export { DirectorEncounterSystem } from './director-encounter-system.js';

// ===== v2 (Phase 16) - zone-scoped event surface =====
export type {
  ZoneEventEnvelope,
  ZoneEvent,
  ZoneEventType,
  ZoneEventDataMap,
  ZoneBossSpec,
  ZoneBossSpawnData,
  ZoneBossTickData,
  ZoneBossEndData,
  ZoneBossOutcome,
  ZoneBossHit,
  ZoneNarratorData,
  ZoneKnotData,
  ZoneStateData,
  ZoneSnapshotData,
  ZoneStateChange,
} from './zone/zone-event-envelope.js';
export {
  parseZoneEnvelope,
  parseZoneEnvelopeJson,
  priorityFor as zonePriorityFor,
  ZoneEventEnvelopeParseError,
} from './zone/zone-event-envelope.js';
export type {
  IZoneEventBridge,
  ZoneEventBridgeStatus,
  ZoneEventBridgeStats,
} from './zone/zone-event-bridge.js';
export { RESOURCE_ZONE_EVENT_BRIDGE } from './zone/zone-event-bridge.js';
export { MockZoneBridge } from './zone/mock-zone-bridge.js';
export type {
  SSEZoneBridgeOptions,
  SSEZoneBridgeEventSource,
} from './zone/sse-zone-bridge.js';
export { SSEZoneBridge } from './zone/sse-zone-bridge.js';
export type {
  ZoneEventLog,
  ZoneEventLogEntry,
} from './zone/zone-event-log.js';
export {
  RESOURCE_ZONE_EVENT_LOG,
  ZONE_RING_SIZE,
  createZoneEventLog,
  getOrCreateZoneEntry,
  pushZoneEvent,
} from './zone/zone-event-log.js';
export type { DirectorZoneStateResource } from './zone/zone-state-resource.js';
export {
  RESOURCE_DIRECTOR_ZONE_STATE,
  createDirectorZoneStateResource,
  getOrCreateZoneStateMap,
  applyZoneStateChanges,
  replaceZoneStateFromSnapshot,
} from './zone/zone-state-resource.js';
export type { ZoneEventSystemOptions } from './zone/zone-event-system.js';
export { ZoneEventSystem } from './zone/zone-event-system.js';
