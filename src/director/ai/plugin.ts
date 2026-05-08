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

import type { DirectorEvent } from '../event-envelope.js';
import type { ZoneEvent } from '../zone/zone-event-envelope.js';

// Re-export so plugin authors importing from `@sadhaka/loom-engine/server`
// can construct strongly-typed ZoneEvent values without reaching into
// the engine internals.
export type { ZoneEvent };

// ----- EmittedEvents -----
//
// Aggregate result of one plugin hook invocation. Either field may
// be undefined or an empty array; the registry treats both as "no
// contribution from this plugin for this dispatch".
export interface EmittedEvents {
  // Append to the per-character v1 stream (LOOM-DIRECTOR-PROTOCOL.md
  // Section 3). Filtered to character_id by the consumer's emit path.
  characterEvents?: DirectorEvent[];
  // Append to a zone's v2 stream and fan out via presence SSE
  // (LOOM-DIRECTOR-PROTOCOL-V2 Section 2 + 3). Zone-id carried in
  // each ZoneEvent envelope; the registry does not infer or rewrite.
  zoneEvents?: ZoneEvent[];
}

// ----- PeerInfo -----
//
// Snapshot view of a connected peer at the moment a hook fires.
// Plugins should treat this as immutable; the engine constructs a
// fresh PeerInfo per dispatch from authoritative server state.
export interface PeerInfo {
  characterId: string;
  userId: string;
  zone: string;
  x: number;
  y: number;
  // Display name; null when the consumer chooses not to expose one
  // (e.g. anonymous spectator, pre-handshake).
  name: string | null;
}

// ----- PlayerAction -----
//
// Free-form action descriptor. The engine carries this opaquely; the
// `kind` discriminator and `payload` shape are coordinated between
// the consumer's gameplay layer and the plugin author. The lowercased
// canonical kinds are listed for IDE autocomplete; any string is legal
// so consumers can extend without engine edits.
export interface PlayerAction {
  kind: 'damage' | 'interact' | 'speak' | 'use_item' | (string & {});
  payload: Record<string, unknown>;
}

// ----- CharacterState -----
//
// Minimum shape the SPI guarantees the plugin sees. Engine consumers
// extend at their own layer (e.g. inventory, class talents); plugins
// that need extended state must downcast and own the type contract.
// The base shape covers identity, position, and health - enough for
// most lifecycle decisions (spawn-on-low-hp, etc.).
export interface CharacterState {
  characterId: string;
  zone: string;
  x: number;
  y: number;
  hp_current: number;
  hp_max: number;
}

// ----- PluginStorage -----
//
// Per-plugin KV store. The registry namespaces by plugin.name so two
// plugins setting the same key never collide. Async to allow
// implementations backed by Redis / SQLite / a remote KV without
// changing the SPI surface. Cleared when a plugin is unregistered
// (so plugin authors should treat reads as may-be-empty after a
// hot-reload).
export interface PluginStorage {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

// ----- PluginLogger -----
//
// Scoped logger that prefixes every line with the plugin's name. The
// concrete ConsolePluginLogger writes to console.{info,warn,error};
// production consumers can drop in a structured-log impl (pino,
// bunyan, tracing context) by implementing the same three methods.
export interface PluginLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

// ----- PluginContext -----
//
// Read-only world view + scoped storage + scoped logger. The engine
// constructs a context per dispatch (or, more efficiently, reuses one
// configured up-front and refreshes the views on each hook call - the
// SPI does not mandate an allocation per invocation).
export interface PluginContext {
  // World state read-only views. Implementations draw from server-side
  // game state; plugins must not cache references across awaits since
  // the underlying state can change between hooks.
  getZonePeers(zoneId: string): ReadonlyArray<PeerInfo>;
  getCharacterState(characterId: string): Readonly<CharacterState>;
  getZoneState(zoneId: string): ReadonlyMap<string, unknown>;

  // Plugin-private KV store. Survives across ticks; cleared on
  // plugin unregister.
  storage: PluginStorage;

  // Logger tagged with the plugin's name.
  logger: PluginLogger;

  // Wall clock. Plugins should use this rather than Date.now() so
  // tests can inject a deterministic clock through the registry.
  now: () => number;
}

// ----- IAIPlugin -----
//
// Stable contract every plugin implements. All lifecycle hooks are
// optional - a registry-only plugin (e.g. one that emits on tick but
// ignores peer joins) implements just `onTick`. Hooks are dispatched
// in plugin priority order, lower priority value first (so e.g. a
// priority-0 "infrastructure" plugin runs before a priority-100
// "narrative" plugin).
export interface IAIPlugin {
  // Unique stable id; used as registry key. Plugins with duplicate
  // names cannot both register; the second register() throws.
  readonly name: string;
  // Semver string. Informational; the registry does not enforce.
  readonly version: string;
  // Dispatch order. LOWER priority runs FIRST. Two plugins with the
  // same priority resolve in registration order.
  readonly priority: number;

  // Lifecycle hooks. All are optional; registry checks before calling.
  onTick?(ctx: PluginContext): Promise<EmittedEvents>;
  onPeerJoin?(ctx: PluginContext, peer: PeerInfo): Promise<EmittedEvents>;
  onPeerLeave?(ctx: PluginContext, peer: PeerInfo): Promise<EmittedEvents>;
  onZoneEnter?(
    ctx: PluginContext,
    peer: PeerInfo,
    fromZone: string | null,
  ): Promise<EmittedEvents>;
  onPlayerAction?(
    ctx: PluginContext,
    peer: PeerInfo,
    action: PlayerAction,
  ): Promise<EmittedEvents>;

  // Optional cleanup on unregister or process shutdown. Async; the
  // registry awaits dispose() inside unregister() so plugins can flush
  // pending work, close upstream connections, etc.
  dispose?(): Promise<void>;
}
