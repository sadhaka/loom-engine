// Loom Engine - Phase 0.19 client-side plugin SDK types.
//
// TypeScript companion of api/loom_ai_plugin_runtime.py. Same names,
// same semantics where they apply on the client. The browser version
// scopes plugin contributions to ZONE events only - the per-character
// v1 director stream is server-only, so client plugins never emit
// CharacterEvents.
//
// Plugins authored against this SDK are pure: given a context, react
// to dispatched zone-events (DOM CustomEvents bridged in by the
// ClientPluginRegistry) and optionally write back to plugin-private
// storage. State mutation of the engine world is the engine's job.
//
// Locked invariants (mirroring LOOM-DIRECTOR-PROTOCOL-V3 sec.5):
//   - Plugins are pure - given context, return events / DOM side
//     effects only via their own mounts.
//   - Error isolation: if a plugin's hook throws, the registry logs
//     and drops that plugin's contribution. Other plugins continue.
//   - Priority order: lower runs first.
//   - Hooks not implemented can be omitted; registry checks before
//     calling.
//
// House rules (CLAUDE.md): var only in browser-bound src/, short
// dashes only, defensive try/catch. Plugin authors writing TypeScript
// keep these conventions; tests can use modern JS.

import type { ZoneEvent, ZoneEventEnvelope, ZoneBossSpec, ZoneBossOutcome } from '../director/zone/zone-event-envelope.js';

// Re-export so plugin authors importing from `@sadhaka/loom-engine`
// have one entrypoint for the zone-event types.
export type { ZoneEvent, ZoneEventEnvelope, ZoneBossSpec, ZoneBossOutcome };

// ----- PluginError -----
//
// Plugins signal expected failure modes by throwing PluginError
// instead of a bare Error. The registry catches both, but
// PluginError lets the plugin author tell the registry "this is
// retryable" so a single transient blip does not silently drop one
// dispatch's contribution. Bare Error still gets caught + dropped;
// PluginError is strictly additive.
export class PluginError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public pluginName: string;
  public readonly original: unknown;

  constructor(
    code: string,
    retryable: boolean = false,
    pluginName: string = '',
    original: unknown = null,
  ) {
    super(String(code || 'unknown'));
    this.name = 'PluginError';
    this.code = String(code || 'unknown');
    this.retryable = Boolean(retryable);
    this.pluginName = String(pluginName || '');
    this.original = original;
  }
}

// ----- PluginEntropy -----
//
// Small deterministic-by-default RNG plugins can use instead of the
// browser Math.random(). Defaults to fresh randomness; pass a seed
// for replay determinism. Mirror of api/loom_ai_plugin_runtime.py
// PluginEntropy. Keeps the surface tiny (random / pick / int_range)
// because that is what plugin authors actually reach for.
export interface IPluginEntropy {
  random(): number;
  pick<T>(items: ReadonlyArray<T>): T | null;
  intRange(low: number, highInclusive: number): number;
}

// Mulberry32 - 32-bit seeded RNG. Same family the engine uses in
// runtime/entropy.ts so plugin streams stay reproducible across
// replays without dragging in a heavy PRNG dep.
export class PluginEntropy implements IPluginEntropy {
  private state: number;

  constructor(seed: number | null = null) {
    if (seed === null || seed === undefined) {
      // Fresh seed derived from Date.now alone. The plugin runtime
      // is out-of-tick (driven by SSE event arrivals), so Date.now
      // is acceptable here - the determinism whitelist allows it
      // for the same reason it allows the Python plugin-context
      // default. Plugin authors who need replay-tight streams pass
      // an explicit seed via ctx.entropy(seed).
      this.state = (Date.now() & 0xffffffff) >>> 0;
    } else {
      this.state = (Number(seed) | 0) >>> 0;
    }
  }

  random(): number {
    // Mulberry32 stepping. Always returns in [0.0, 1.0).
    var t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  }

  pick<T>(items: ReadonlyArray<T>): T | null {
    if (!items || items.length === 0) return null;
    var idx = Math.floor(this.random() * items.length);
    if (idx >= items.length) idx = items.length - 1;
    var picked = items[idx];
    return picked === undefined ? null : picked;
  }

  intRange(low: number, highInclusive: number): number {
    var lo = Math.floor(Number(low));
    var hi = Math.floor(Number(highInclusive));
    if (hi < lo) {
      var tmp = lo;
      lo = hi;
      hi = tmp;
    }
    var span = hi - lo + 1;
    return lo + Math.floor(this.random() * span);
  }
}

// ----- PeerInfo -----
//
// Snapshot view of a connected peer. Mirrors PeerInfo in the Python
// runtime + PeerInfo in src/director/ai/plugin.ts, scoped to data
// the client actually sees on the SSE presence channel.
export interface PeerInfo {
  characterId: string;
  userId: string;
  zone: string;
  x: number;
  y: number;
  name: string | null;
}

// ----- EmittedEvents -----
//
// What a plugin's hook may return. Client-side plugins emit ZONE
// events only - the per-character v1 stream is server-side. Empty
// or missing field = "no contribution from this plugin for this
// dispatch".
export interface EmittedEvents {
  zoneEvents?: ZoneEvent[];
}

// ----- PluginStorage -----
//
// Per-plugin private KV. Survives across dispatches; cleared on
// plugin unregister. Async to allow plugin authors to swap in
// IndexedDB / localStorage adapters without changing the SPI.
export interface PluginStorage {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

// ----- PluginLogger -----
//
// Scoped logger that prefixes every line with the plugin's name.
// Client default writes to console.{info, warn, error}.
export interface PluginLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

// ----- PluginContext -----
//
// Read-only world view + scoped storage + scoped logger. Mirrors the
// Python PluginContext, minus get_character_state (the client does
// not own canonical character state - that lives on the server). The
// client surface gets get_zone_events_tail because that is exactly
// the kind of surface a HUD / overlay plugin needs.
//
// All accessor return types are read-only at the SPI surface so a
// plugin cannot accidentally mutate engine state through the context.
export interface PluginContext {
  // World read-only views.
  getZonePeers(zoneId: string): ReadonlyArray<PeerInfo>;
  getZoneState(zoneId: string): ReadonlyMap<string, unknown>;
  getZoneEventsTail(zoneId: string, n: number): ReadonlyArray<ZoneEvent>;

  // Plugin-private KV. Survives across dispatches; cleared on unregister.
  storage: PluginStorage;

  // Logger tagged with the plugin's name.
  logger: PluginLogger;

  // Wall clock. Plugins should use this rather than Date.now() so
  // tests can inject a deterministic clock through the registry.
  now(): number;

  // ----- Phase 25.13 spatial helpers (mirror Python ctx.peers_in_radius
  // and ctx.nearest_peer). Pure reads; no side effects.

  // Live peers in zone within Euclidean radius of (x, y). Returns
  // peers in arbitrary order.
  peersInRadius(zoneId: string, x: number, y: number, radius: number): ReadonlyArray<PeerInfo>;

  // Closest peer in zone + distance. Returns null on empty zone.
  // Distance is Euclidean (not squared) so plugins compare against
  // world-unit thresholds directly.
  nearestPeer(zoneId: string, x: number, y: number): { peer: PeerInfo; distance: number } | null;

  // Return a PluginEntropy. Pass a seed for deterministic plays;
  // omit for fresh randomness.
  entropy(seed?: number | null): IPluginEntropy;
}

// ----- ALL_SCOPES -----
//
// Mirror of the Python ALL_SCOPES frozenset. A plugin declares which
// read accessors it needs via requiredScopes; the registry gates
// accessors not granted. Plugins that omit requiredScopes get the
// full set so existing behaviour is unchanged.
//
// Note: read_characters is a server-only scope; on the client it has
// no accessor. Listed for parity with the Python SDK so plugins can
// be authored against both runtimes - the client registry simply
// ignores read_characters in its scope gates.
export const ALL_SCOPES = ['read_zones', 'read_characters', 'read_events'] as const;
export type PluginScope = typeof ALL_SCOPES[number];

// Default storage cap per plugin (mirror of the Python
// DEFAULT_PLUGIN_STORAGE_MAX_BYTES = 1 MiB).
export const DEFAULT_PLUGIN_STORAGE_MAX_BYTES: number = 1024 * 1024;

// Default per-hook tick budget (mirror of the Python default 1000ms).
export const DEFAULT_PLUGIN_TICK_BUDGET_MS: number = 1000;

// ----- IClientPlugin -----
//
// Stable contract every client plugin implements. All lifecycle hooks
// are optional - a plugin that only paints on boss spawn implements
// just onBossSpawn. Hooks are dispatched in priority order, lower
// priority first.
export interface IClientPlugin {
  // Required identity. Names are the registry key; duplicates replace.
  readonly name: string;
  readonly version: string;
  readonly priority: number;

  // ----- Optional metadata (Phase 25.17 parity) -----
  // Surfaced via ClientPluginRegistry.describe(). Plugins that omit
  // them get sensible defaults; existing plugins do NOT need to migrate.
  readonly requiresProtocol?: string; // e.g. 'loom-director-v3'
  readonly supersedesPlugins?: ReadonlyArray<string>;
  readonly tags?: ReadonlyArray<string>;
  readonly description?: string;

  // ----- Runtime hardening (Phase 25.19/20/21 parity) -----
  // Per-hook async timeout. Default 1000ms.
  readonly tickBudgetMs?: number;
  // Per-plugin storage cap. Default 1 MiB.
  readonly storageMaxBytes?: number;
  // Declared scope set. Plugins that omit this get all scopes; the
  // gate is on accessors, not on hook invocation.
  readonly requiredScopes?: ReadonlyArray<PluginScope>;

  // ----- Lifecycle hooks -----
  // Catch-all zone event hook - fires for every zone event the
  // registry sees, regardless of type. Plugins typically narrow on
  // envelope.type inside the hook. Mirrors how the Python runtime's
  // on_tick / on_zone_state_change family aggregates into one router.
  onZoneEvent?(ctx: PluginContext, envelope: ZoneEventEnvelope): Promise<EmittedEvents | void>;

  // Phase 25.18 priority phases. Pre/post tick run before / after
  // any zone event dispatch in the same round; useful for setup +
  // cleanup that must see / not see in-round events.
  onPreTick?(ctx: PluginContext): Promise<EmittedEvents | void>;
  onPostTick?(ctx: PluginContext): Promise<EmittedEvents | void>;

  // Boss lifecycle conveniences. The registry derives these from
  // routed onZoneEvent envelopes (zone.boss.spawn / zone.boss.end)
  // so plugin authors can write narrow handlers without re-checking
  // envelope.type. Plugins implementing both onZoneEvent AND a
  // narrow hook get both called - the narrow one fires AFTER the
  // catch-all.
  onBossSpawn?(ctx: PluginContext, zoneId: string, boss: ZoneBossSpec): Promise<EmittedEvents | void>;
  onBossEnd?(ctx: PluginContext, zoneId: string, bossId: string, outcome: ZoneBossOutcome): Promise<EmittedEvents | void>;
  onLootDrop?(ctx: PluginContext, zoneId: string, bossId: string, items: ReadonlyArray<unknown>): Promise<EmittedEvents | void>;

  // Optional cleanup on unregister. The registry awaits this inside
  // unregister() so plugins can flush pending work / unmount DOM
  // overlays / close upstream connections.
  dispose?(): Promise<void> | void;
}

// ----- PluginOpsStats -----
//
// Mirror of the Python PluginOpsStats. Per-plugin ops counters,
// monotonically non-decreasing for the lifetime of the registration
// (reset on unregister). Surfaced via describe() so an operator (or
// dev console) can spot a runaway plugin.
export interface PluginOpsStats {
  storage_set_count: number;
  storage_get_count: number;
  storage_delete_count: number;
  storage_bytes_used: number;
  storage_caps_rejected: number;
  hook_call_count: number;
  hook_timeout_count: number;
  hook_error_count: number;
  hook_retry_count: number;
}

// ----- DescribeRow -----
//
// One row of ClientPluginRegistry.describe(). Same shape as the
// Python registry's describe() output so a remote inspection UI can
// render server-side and client-side plugins with the same template.
export interface PluginDescribeRow {
  name: string;
  version: string;
  priority: number;
  requires_protocol: string;
  supersedes_plugins: string[];
  tags: string[];
  description: string;
  hooks: string[];
  tick_budget_ms: number;
  storage_max_bytes: number;
  scopes: string[];
  stats: PluginOpsStats;
}
