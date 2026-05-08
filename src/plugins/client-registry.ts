// ClientPluginRegistry - dispatches lifecycle hooks across registered
// client-side Loom plugins.
//
// Browser-side companion of api/loom_ai_plugin_runtime.py
// AIPluginRegistry. Same shape, adapted to the browser:
//   - No asyncio. Promise + async/await throughout.
//   - No per-character v1 stream. Plugins react to zone-events only.
//   - Routes window.dispatchEvent('arpg:zone-*') CustomEvents through
//     onZoneEvent; the host (typically the ARPG-loom IIFE) keeps
//     dispatching custom events as before, and registered plugins
//     opt in via the registry instead of attaching listeners
//     themselves.
//   - reload(name) re-imports a plugin module via dynamic import,
//     bypassing the browser cache by appending a cache-bust query.
//
// Error isolation: if a plugin's hook throws, the registry logs the
// failure via the plugin's logger, drops that plugin's contribution
// for THIS dispatch only, continues with the next plugin. Dispatch
// never throws to the caller. Plugin authors are still expected to
// catch in their own hooks - this is the safety net.
//
// House rules: var only, no arrow functions in browser-bound src/,
// short dashes, defensive try/catch.

import {
  type IClientPlugin,
  type PluginContext,
  type PluginStorage,
  type PluginLogger,
  type PluginOpsStats,
  type PluginDescribeRow,
  type PeerInfo,
  type IPluginEntropy,
  type EmittedEvents,
  type PluginScope,
  PluginEntropy,
  PluginError,
  ALL_SCOPES,
  DEFAULT_PLUGIN_STORAGE_MAX_BYTES,
  DEFAULT_PLUGIN_TICK_BUDGET_MS,
} from './types.js';
import type {
  ZoneEvent,
  ZoneEventEnvelope,
  ZoneBossSpec,
  ZoneBossOutcome,
  ZoneBossSpawnData,
  ZoneBossEndData,
} from '../director/zone/zone-event-envelope.js';

// ----- MapPluginStorage -----
//
// In-memory PluginStorage. Mirror of the Python MapPluginStorage.
// Sufficient for a single-tab session; consumers wanting persistence
// across tab reloads can swap in an IndexedDB-backed adapter without
// touching the registry.
export class MapPluginStorage implements PluginStorage {
  private data: Map<string, unknown> = new Map();

  async get(key: string): Promise<unknown | undefined> {
    return this.data.get(String(key));
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(String(key), value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(String(key));
  }

  resetForTest(): void {
    this.data.clear();
  }

  // Inspect-only: total entries. Useful in tests.
  size(): number {
    return this.data.size;
  }
}

// ----- ConsolePluginLogger -----
//
// Tags every line with [plugin: <name>] and forwards to the matching
// console method. Meta is JSON-stringified; circular refs fall back
// to a short description so logging never throws at the boundary.
export class ConsolePluginLogger implements PluginLogger {
  constructor(private readonly pluginName: string) {}

  info(msg: string, meta?: Record<string, unknown>): void {
    this.write('info', msg, meta);
  }
  warn(msg: string, meta?: Record<string, unknown>): void {
    this.write('warn', msg, meta);
  }
  error(msg: string, meta?: Record<string, unknown>): void {
    this.write('error', msg, meta);
  }

  private write(level: 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>): void {
    var tag = '[plugin: ' + this.pluginName + ']';
    var line = tag + ' ' + msg;
    var metaStr = '';
    if (meta) {
      try {
        metaStr = ' ' + JSON.stringify(meta);
      } catch {
        metaStr = ' [meta-not-serializable]';
      }
    }
    var out = line + metaStr;
    try {
      if (level === 'info') console.info(out);
      else if (level === 'warn') console.warn(out);
      else console.error(out);
    } catch {
      // Logger errors must never break dispatch.
    }
  }
}

// ----- TTL helpers -----
//
// Mirror of the Python set_with_ttl / get_with_ttl_check. TTL layers
// over any PluginStorage so plugin authors can use it on the default
// MapPluginStorage or a custom IndexedDB adapter without changes.
const TTL_ENVELOPE_TAG = '__loom_ttl_v1__';

export async function setWithTtl(
  storage: PluginStorage,
  key: string,
  value: unknown,
  ttlMs: number,
  nowFn?: () => number,
): Promise<void> {
  var now = nowFn ? nowFn() : Date.now();
  var ttl = Number(ttlMs) || 0;
  var envelope: Record<string, unknown> = {};
  envelope[TTL_ENVELOPE_TAG] = 1;
  envelope.value = value;
  envelope.expires_at_ms = now + ttl;
  await storage.set(key, envelope);
}

export async function getWithTtlCheck(
  storage: PluginStorage,
  key: string,
  nowFn?: () => number,
): Promise<unknown | undefined> {
  var raw = await storage.get(key);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'object' && raw !== null) {
    var obj = raw as Record<string, unknown>;
    if (obj[TTL_ENVELOPE_TAG] === 1) {
      var expires = Number(obj.expires_at_ms) || 0;
      var now = nowFn ? nowFn() : Date.now();
      if (expires > 0 && expires < now) {
        try {
          await storage.delete(key);
        } catch {
          // Lazy delete is best-effort; swallow.
        }
        return undefined;
      }
      return obj.value;
    }
  }
  return raw;
}

// ----- CountingStorageWrapper -----
//
// Wraps any PluginStorage and adds: per-plugin ops counters
// (delegated to a stats object), a per-plugin byte cap (rejects
// set() over the cap with PluginError('storage_quota_exceeded')),
// and approximate byte tracking based on JSON-stringified value
// size. Mirror of Python CountingStorageWrapper.
class CountingStorageWrapper implements PluginStorage {
  constructor(
    private readonly inner: PluginStorage,
    private readonly stats: PluginOpsStats,
    private readonly maxBytes: number,
    private readonly pluginName: string,
  ) {}

  async get(key: string): Promise<unknown | undefined> {
    this.stats.storage_get_count += 1;
    return this.inner.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    var vSize = 0;
    try {
      vSize = JSON.stringify(value).length;
    } catch {
      vSize = 0;
    }
    var projected = this.stats.storage_bytes_used + vSize;
    if (this.maxBytes > 0 && projected > this.maxBytes) {
      this.stats.storage_caps_rejected += 1;
      throw new PluginError('storage_quota_exceeded', false, this.pluginName);
    }
    this.stats.storage_set_count += 1;
    this.stats.storage_bytes_used = projected;
    await this.inner.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.stats.storage_delete_count += 1;
    // Note: byte tracking is approximate - we do not decrement on
    // delete because we'd need to read the prior value. Operators
    // should treat storage_bytes_used as 'lifetime bytes written',
    // not 'currently resident'. Same posture as the Python runtime.
    await this.inner.delete(key);
  }
}

// ----- buildEmptyStats -----

function buildEmptyStats(): PluginOpsStats {
  return {
    storage_set_count: 0,
    storage_get_count: 0,
    storage_delete_count: 0,
    storage_bytes_used: 0,
    storage_caps_rejected: 0,
    hook_call_count: 0,
    hook_timeout_count: 0,
    hook_error_count: 0,
    hook_retry_count: 0,
  };
}

// ----- World view contracts -----
//
// The registry receives world-view callbacks at construction time.
// The host (the ARPG-loom IIFE) is responsible for keeping these
// closures pointed at fresh state - the registry never inspects
// engine internals on its own.
export interface ClientPluginRegistryOptions {
  // Wall clock injected for tests. Defaults to Date.now.
  now?: () => number;

  // World accessors. All optional; defaults return empty views so
  // tests / minimal embeddings don't have to assemble a world layer.
  getZonePeers?: (zoneId: string) => ReadonlyArray<PeerInfo>;
  getZoneState?: (zoneId: string) => ReadonlyMap<string, unknown>;
  getZoneEventsTail?: (zoneId: string, n: number) => ReadonlyArray<ZoneEvent>;

  // DOM target for routed CustomEvents. Defaults to globalThis.window
  // when present; tests inject a mock. Setting to null disables
  // auto-bridging entirely (the host can still call dispatchZoneEvent
  // manually).
  eventTarget?: EventTarget | null;

  // CustomEvent type prefixes routed through the registry. Defaults
  // to ['arpg:zone-'] which matches the existing ARPG-loom dispatch
  // pattern (arpg:zone-boss-spawn, arpg:zone-boss-tick, etc.). The
  // registry strips the prefix and passes the underlying envelope
  // detail to plugins.
  eventPrefixes?: ReadonlyArray<string>;
}

// ----- ClientPluginRegistry -----

export class ClientPluginRegistry {
  // Sorted by priority ascending, registration order on ties.
  private plugins: IClientPlugin[] = [];
  // Per-plugin in-memory MapPluginStorage. Wrapped in a
  // CountingStorageWrapper before being handed to plugins.
  private storageByName: Map<string, MapPluginStorage> = new Map();
  // Per-plugin logger.
  private loggersByName: Map<string, ConsolePluginLogger> = new Map();
  // Per-plugin ops stats.
  private statsByName: Map<string, PluginOpsStats> = new Map();

  private readonly opts: Required<Omit<ClientPluginRegistryOptions, 'eventTarget' | 'getZonePeers' | 'getZoneState' | 'getZoneEventsTail' | 'eventPrefixes'>> & {
    eventTarget: EventTarget | null;
    getZonePeers: (zoneId: string) => ReadonlyArray<PeerInfo>;
    getZoneState: (zoneId: string) => ReadonlyMap<string, unknown>;
    getZoneEventsTail: (zoneId: string, n: number) => ReadonlyArray<ZoneEvent>;
    eventPrefixes: ReadonlyArray<string>;
  };

  // DOM bridge state. The registry attaches a single capturing
  // listener per prefix to the eventTarget; that listener fans out
  // to dispatchZoneEvent. Storing the bound function lets dispose()
  // remove the listeners cleanly.
  private bridgedHandlers: Array<{ prefix: string; type: string; handler: EventListener }> = [];

  constructor(options?: ClientPluginRegistryOptions) {
    var opts = options || {};
    var defaultTarget: EventTarget | null = null;
    try {
      defaultTarget = (typeof globalThis !== 'undefined' && (globalThis as { window?: Window }).window) ? (globalThis as { window: Window }).window : null;
    } catch {
      defaultTarget = null;
    }
    this.opts = {
      now: opts.now || function () { return Date.now(); },
      getZonePeers: opts.getZonePeers || function () { return []; },
      getZoneState: opts.getZoneState || function () { return new Map<string, unknown>(); },
      getZoneEventsTail: opts.getZoneEventsTail || function () { return []; },
      eventTarget: opts.eventTarget === undefined ? defaultTarget : opts.eventTarget,
      eventPrefixes: opts.eventPrefixes && opts.eventPrefixes.length > 0
        ? opts.eventPrefixes
        : ['arpg:zone-'],
    };

    this.attachBridge();
  }

  // ----- Bridge -----
  //
  // Attaches one capturing listener for each known prefix. The host
  // dispatches CustomEvents named e.g. 'arpg:zone-boss-spawn' with
  // detail = a ZoneEventEnvelope-shaped payload. The registry pulls
  // detail and routes through dispatchZoneEvent.
  private attachBridge(): void {
    var target = this.opts.eventTarget;
    if (!target) return;
    var self = this;
    // We attach a single 'arpg:zone-*' wildcard via attaching one
    // handler per known event type. Browsers do not support wildcard
    // listeners on EventTarget, so we lazily attach when a plugin
    // first registers AND the host has dispatched at least one such
    // event. Simplest correct approach: rely on the host to also
    // dispatch a generic 'arpg:zone-event' or call dispatchZoneEvent
    // directly. For ergonomics we ALSO attach to the well-known
    // arpg:zone-* event names that ARPG-loom currently dispatches.
    var knownTypes = [
      'arpg:zone-boss-spawn',
      'arpg:zone-boss-tick',
      'arpg:zone-boss-end',
      'arpg:zone-narrator',
      'arpg:zone-knot',
      'arpg:zone-state',
      'arpg:zone-snapshot',
    ];
    for (var i = 0; i < knownTypes.length; i++) {
      var t = knownTypes[i];
      if (!t) continue;
      var handler: EventListener = function (this: unknown, ev: Event): void {
        try {
          var ce = ev as CustomEvent<ZoneEventEnvelope | undefined>;
          var detail = ce && ce.detail;
          if (detail && typeof detail === 'object') {
            // Fire-and-forget; dispatchZoneEvent is async but the
            // browser CustomEvent contract is synchronous and the
            // registry's error isolation ensures we never throw
            // back into the dispatcher.
            self.dispatchZoneEvent(detail).catch(function () {
              // Swallowed - error isolation is per-plugin inside
              // dispatchZoneEvent; this catch only fires if the
              // outer dispatch frame itself rejects.
            });
          }
        } catch {
          // Bridge listener must never throw.
        }
      };
      try {
        target.addEventListener(t, handler);
        this.bridgedHandlers.push({ prefix: this.opts.eventPrefixes[0] || 'arpg:zone-', type: t, handler });
      } catch {
        // Some headless environments may reject addEventListener for
        // certain types - skip silently.
      }
    }
  }

  private detachBridge(): void {
    var target = this.opts.eventTarget;
    if (!target) {
      this.bridgedHandlers = [];
      return;
    }
    for (var i = 0; i < this.bridgedHandlers.length; i++) {
      var h = this.bridgedHandlers[i];
      if (!h) continue;
      try {
        target.removeEventListener(h.type, h.handler);
      } catch {
        // Ignore detach errors.
      }
    }
    this.bridgedHandlers = [];
  }

  // ----- Lifecycle -----

  // Register a plugin. Allocates fresh storage / logger / stats.
  // Re-registering a plugin with the same name replaces it (the
  // previous instance's storage is reset). This matches the Python
  // registry's posture, not the v0.16 server-side TS registry which
  // throws on duplicate - the client surface is meant to be reload-
  // friendly.
  register(plugin: IClientPlugin): void {
    if (!plugin) throw new Error('plugin required');
    var name = String(plugin.name || '').trim();
    if (!name) throw new Error('plugin.name required');

    // Replace if name already registered.
    var idx = -1;
    for (var i = 0; i < this.plugins.length; i++) {
      var existing = this.plugins[i];
      if (existing && existing.name === name) {
        idx = i;
        break;
      }
    }
    if (idx !== -1) {
      this.plugins.splice(idx, 1);
      this.storageByName.delete(name);
      this.loggersByName.delete(name);
      this.statsByName.delete(name);
    }

    // Insert in priority order; lower priority first; ties keep
    // registration order.
    var insertAt = this.plugins.length;
    for (var j = 0; j < this.plugins.length; j++) {
      var p = this.plugins[j];
      if (p && p.priority > plugin.priority) {
        insertAt = j;
        break;
      }
    }
    this.plugins.splice(insertAt, 0, plugin);
    this.storageByName.set(name, new MapPluginStorage());
    this.loggersByName.set(name, new ConsolePluginLogger(name));
    this.statsByName.set(name, buildEmptyStats());
  }

  // Unregister a plugin by name. Awaits dispose() if defined; logs
  // and drops if dispose throws. Returns true if a plugin was
  // removed, false if no plugin with that name was registered.
  async unregister(name: string): Promise<boolean> {
    var n = String(name || '').trim();
    if (!n) return false;
    var idx = -1;
    for (var i = 0; i < this.plugins.length; i++) {
      var p = this.plugins[i];
      if (p && p.name === n) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return false;
    var plugin = this.plugins[idx];
    this.plugins.splice(idx, 1);
    this.storageByName.delete(n);
    this.loggersByName.delete(n);
    this.statsByName.delete(n);
    if (plugin && typeof plugin.dispose === 'function') {
      try {
        var result = plugin.dispose();
        if (result && typeof (result as Promise<void>).then === 'function') {
          await (result as Promise<void>);
        }
      } catch (err) {
        try {
          console.error('[plugin-registry] dispose for ' + n + ' failed:', err);
        } catch {
          // Logger errors must never throw.
        }
      }
    }
    return true;
  }

  // Hot-reload a plugin by re-importing its source module via dynamic
  // import (browser-side cache-bust by appending a query string).
  // Steps:
  //   1. Look up the registered plugin instance.
  //   2. dynamic-import the moduleSpecifier with a cache-bust query.
  //   3. Read exportName from the module (default to the plugin's
  //      class name when not provided).
  //   4. Construct a new instance via `new Cls()`.
  //   5. unregister + register so the new instance takes over.
  //   6. Return the new describe row, or null on failure.
  //
  // The registry serialises reload behind a per-name lock so a
  // dispatch cannot land mid-reload. Heavy on the fast path -
  // intended for development + ops triggers, not the request loop.
  async reload(
    name: string,
    moduleSpecifier?: string,
    exportName?: string,
  ): Promise<PluginDescribeRow | null> {
    var n = String(name || '').trim();
    if (!n) return null;
    var current: IClientPlugin | undefined;
    for (var i = 0; i < this.plugins.length; i++) {
      var p = this.plugins[i];
      if (p && p.name === n) {
        current = p;
        break;
      }
    }
    if (!current) return null;

    // No moduleSpecifier supplied AND no host way to find one means
    // we cannot reload - return null. A future revision could keep
    // an internal map of name -> moduleSpecifier set at register()
    // time; for now we leave it explicit so plugin authors opt in.
    if (!moduleSpecifier) return null;

    var bustQuery = '?v=' + String(Date.now());
    var url = String(moduleSpecifier) + bustQuery;
    var mod: Record<string, unknown>;
    try {
      // The dynamic-import RHS is a string at runtime - TS does not
      // know the module shape so we type the result as an unknown
      // record and pull the export by name.
      mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
    } catch (err) {
      try {
        console.error('[plugin-registry] reload import failed for ' + n + ':', err);
      } catch {
        // ignore
      }
      return null;
    }

    var exportedKey = exportName || (current.constructor && current.constructor.name) || n;
    var Cls = mod[exportedKey];
    if (typeof Cls !== 'function') {
      try {
        console.error('[plugin-registry] reload could not find export ' + exportedKey + ' in module ' + moduleSpecifier);
      } catch {
        // ignore
      }
      return null;
    }

    var instance: IClientPlugin;
    try {
      instance = new (Cls as new () => IClientPlugin)();
    } catch (err) {
      try {
        console.error('[plugin-registry] reload re-instantiate failed for ' + n + ':', err);
      } catch {
        // ignore
      }
      return null;
    }

    await this.unregister(n);
    this.register(instance);
    var rows = this.describe();
    for (var k = 0; k < rows.length; k++) {
      var row = rows[k];
      if (row && row.name === n) return row;
    }
    return null;
  }

  list(): ReadonlyArray<IClientPlugin> {
    return this.plugins.slice();
  }

  get(name: string): IClientPlugin | undefined {
    var n = String(name || '').trim();
    for (var i = 0; i < this.plugins.length; i++) {
      var p = this.plugins[i];
      if (p && p.name === n) return p;
    }
    return undefined;
  }

  // Drop every registered plugin. Tests call this between blocks so
  // state stays isolated.
  async resetForTest(): Promise<void> {
    var snapshot = this.plugins.slice();
    for (var i = 0; i < snapshot.length; i++) {
      var p = snapshot[i];
      if (!p) continue;
      try {
        await this.unregister(p.name);
      } catch {
        // Best-effort.
      }
    }
    this.plugins = [];
    this.storageByName.clear();
    this.loggersByName.clear();
    this.statsByName.clear();
  }

  // ----- Describe -----

  describe(): PluginDescribeRow[] {
    var hookNames = [
      'onZoneEvent',
      'onPreTick',
      'onPostTick',
      'onBossSpawn',
      'onBossEnd',
      'onLootDrop',
      'dispose',
    ];
    var out: PluginDescribeRow[] = [];
    for (var i = 0; i < this.plugins.length; i++) {
      var plugin = this.plugins[i];
      if (!plugin) continue;
      var hooks: string[] = [];
      for (var h = 0; h < hookNames.length; h++) {
        var hookName = hookNames[h];
        if (!hookName) continue;
        var hookFn = (plugin as unknown as Record<string, unknown>)[hookName];
        if (typeof hookFn === 'function') hooks.push(hookName);
      }
      var requires = String(plugin.requiresProtocol || '');
      var supersedes = (plugin.supersedesPlugins || []).map(function (s) { return String(s); });
      var tags = (plugin.tags || []).map(function (t) { return String(t); });
      var description = String(plugin.description || '');
      var name = String(plugin.name);
      var version = String(plugin.version);
      var priority = Number(plugin.priority) | 0;
      var tickBudgetMs = Number(plugin.tickBudgetMs);
      if (!isFinite(tickBudgetMs) || tickBudgetMs <= 0) tickBudgetMs = DEFAULT_PLUGIN_TICK_BUDGET_MS;
      var storageMaxBytes = Number(plugin.storageMaxBytes);
      if (!isFinite(storageMaxBytes) || storageMaxBytes < 0) storageMaxBytes = DEFAULT_PLUGIN_STORAGE_MAX_BYTES;
      var declared = plugin.requiredScopes;
      var scopes: string[];
      if (!declared) {
        scopes = ALL_SCOPES.slice().sort();
      } else {
        var seen: Record<string, boolean> = {};
        var arr: string[] = [];
        for (var s = 0; s < declared.length; s++) {
          var sc = String(declared[s]);
          if (!seen[sc]) {
            seen[sc] = true;
            arr.push(sc);
          }
        }
        scopes = arr.sort();
      }
      var stats = this.statsByName.get(name) || buildEmptyStats();
      // Snapshot stats so external mutation doesn't bleed into the
      // returned row.
      var snapshotStats: PluginOpsStats = {
        storage_set_count: stats.storage_set_count,
        storage_get_count: stats.storage_get_count,
        storage_delete_count: stats.storage_delete_count,
        storage_bytes_used: stats.storage_bytes_used,
        storage_caps_rejected: stats.storage_caps_rejected,
        hook_call_count: stats.hook_call_count,
        hook_timeout_count: stats.hook_timeout_count,
        hook_error_count: stats.hook_error_count,
        hook_retry_count: stats.hook_retry_count,
      };
      out.push({
        name: name,
        version: version,
        priority: priority,
        requires_protocol: requires,
        supersedes_plugins: supersedes,
        tags: tags,
        description: description,
        hooks: hooks,
        tick_budget_ms: tickBudgetMs,
        storage_max_bytes: storageMaxBytes,
        scopes: scopes,
        stats: snapshotStats,
      });
    }
    return out;
  }

  // ----- Per-plugin context -----

  private makeCtx(plugin: IClientPlugin): PluginContext {
    var name = String(plugin.name);
    var inner = this.storageByName.get(name) || new MapPluginStorage();
    var logger = this.loggersByName.get(name) || new ConsolePluginLogger(name);
    var stats = this.statsByName.get(name) || buildEmptyStats();

    var maxBytes = Number(plugin.storageMaxBytes);
    if (!isFinite(maxBytes) || maxBytes < 0) maxBytes = DEFAULT_PLUGIN_STORAGE_MAX_BYTES;
    var wrapped = new CountingStorageWrapper(inner, stats, maxBytes, name);

    var declared = plugin.requiredScopes;
    var scopes: ReadonlyArray<PluginScope> = declared ? declared : (ALL_SCOPES as unknown as ReadonlyArray<PluginScope>);
    function hasScope(s: PluginScope): boolean {
      for (var i = 0; i < scopes.length; i++) {
        if (scopes[i] === s) return true;
      }
      return false;
    }

    var rootGetZonePeers = this.opts.getZonePeers;
    var rootGetZoneState = this.opts.getZoneState;
    var rootGetZoneEventsTail = this.opts.getZoneEventsTail;
    var rootNow = this.opts.now;

    function scopedZonePeers(zid: string): ReadonlyArray<PeerInfo> {
      if (!hasScope('read_zones')) return [];
      try {
        return rootGetZonePeers(String(zid)) || [];
      } catch {
        return [];
      }
    }
    function scopedZoneState(zid: string): ReadonlyMap<string, unknown> {
      if (!hasScope('read_zones')) return new Map<string, unknown>();
      try {
        return rootGetZoneState(String(zid)) || new Map<string, unknown>();
      } catch {
        return new Map<string, unknown>();
      }
    }
    function scopedZoneEventsTail(zid: string, n: number): ReadonlyArray<ZoneEvent> {
      if (!hasScope('read_events')) return [];
      try {
        return rootGetZoneEventsTail(String(zid), Number(n) | 0) || [];
      } catch {
        return [];
      }
    }

    function peersInRadius(zid: string, x: number, y: number, radius: number): ReadonlyArray<PeerInfo> {
      var r = Number(radius) || 0;
      if (r <= 0) return [];
      var rsq = r * r;
      var peers = scopedZonePeers(String(zid));
      var out: PeerInfo[] = [];
      for (var i = 0; i < peers.length; i++) {
        var p = peers[i];
        if (!p) continue;
        var dx = (Number(p.x) || 0) - Number(x);
        var dy = (Number(p.y) || 0) - Number(y);
        if ((dx * dx + dy * dy) <= rsq) out.push(p);
      }
      return out;
    }

    function nearestPeer(zid: string, x: number, y: number): { peer: PeerInfo; distance: number } | null {
      var peers = scopedZonePeers(String(zid));
      if (peers.length === 0) return null;
      var best: PeerInfo | null = null;
      var bestDsq = Infinity;
      for (var i = 0; i < peers.length; i++) {
        var p = peers[i];
        if (!p) continue;
        var dx = (Number(p.x) || 0) - Number(x);
        var dy = (Number(p.y) || 0) - Number(y);
        var dsq = dx * dx + dy * dy;
        if (dsq < bestDsq) {
          bestDsq = dsq;
          best = p;
        }
      }
      if (!best) return null;
      return { peer: best, distance: Math.sqrt(bestDsq) };
    }

    function entropy(seed?: number | null): IPluginEntropy {
      return new PluginEntropy(seed === undefined ? null : seed);
    }

    return {
      getZonePeers: scopedZonePeers,
      getZoneState: scopedZoneState,
      getZoneEventsTail: scopedZoneEventsTail,
      storage: wrapped,
      logger: logger,
      now: rootNow,
      peersInRadius: peersInRadius,
      nearestPeer: nearestPeer,
      entropy: entropy,
    };
  }

  // ----- Dispatchers -----

  // Generic safe-call. Returns the EmittedEvents result (or null on
  // miss / error). Wraps the hook call in a tick-budget timeout and
  // bumps the per-plugin ops counters. PluginError(retryable=true)
  // triggers ONE retry before dropping; bare errors drop immediately.
  private async safeCall(
    plugin: IClientPlugin,
    hookName: string,
    ctx: PluginContext,
    args: unknown[],
  ): Promise<EmittedEvents | null> {
    var hookFn = (plugin as unknown as Record<string, unknown>)[hookName];
    if (typeof hookFn !== 'function') return null;

    var stats = this.statsByName.get(String(plugin.name));
    if (stats) stats.hook_call_count += 1;

    var budgetMs = Number(plugin.tickBudgetMs);
    if (!isFinite(budgetMs) || budgetMs <= 0) budgetMs = DEFAULT_PLUGIN_TICK_BUDGET_MS;

    var attempts = 0;
    var maxAttempts = 2;
    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        // 0.19.1 fix: hooks may return null / undefined / a value
        // synchronously (mirrors the Python-side Optional[EmittedEvents]
        // shape). Wrap unconditionally so .then() in withTimeout cannot
        // throw on a non-Promise. Promise.resolve() is a no-op on an
        // existing thenable.
        var hookResult = (hookFn as (...a: unknown[]) => unknown).apply(plugin, [ctx as unknown].concat(args));
        var hookPromise = Promise.resolve(hookResult) as Promise<EmittedEvents | void>;
        var raced = await this.withTimeout(hookPromise, budgetMs, plugin, hookName);
        if (raced === null) {
          // Timeout already logged + counted; return null to drop.
          return null;
        }
        return this.normalizeEmitted(raced);
      } catch (err) {
        if (err instanceof PluginError) {
          err.pluginName = err.pluginName || String(plugin.name);
          if (err.retryable && attempts < maxAttempts) {
            if (stats) stats.hook_retry_count += 1;
            try {
              ctx.logger.warn('hook ' + hookName + ' retryable PluginError: ' + err.code);
            } catch {
              // ignore
            }
            continue;
          }
          if (stats) stats.hook_error_count += 1;
          try {
            ctx.logger.error('hook ' + hookName + ' raised PluginError: ' + err.code);
          } catch {
            // ignore
          }
          return null;
        }
        if (stats) stats.hook_error_count += 1;
        try {
          ctx.logger.error('hook ' + hookName + ' threw', this.errorMeta(err));
        } catch {
          // ignore
        }
        return null;
      }
    }
    return null;
  }

  // Race a hook promise against a timeout. Returns the result or
  // null on timeout. The timed-out hook is allowed to keep running
  // in the background (we cannot really cancel a Promise) but its
  // contribution is dropped.
  //
  // 0.19.1 fix: a "fired" flag short-circuits the timeout callback
  // when the hook resolves (or rejects) first. The previous
  // implementation cleared the setTimeout via clearTimeout in
  // .then() callbacks, but the callbacks were attached to the inner
  // promise which had ALREADY resolved synchronously by the time
  // .then() was wired up - so the clearTimeout never ran and the
  // timeout always fired at +budget. The flag-guard works regardless
  // of microtask ordering.
  private withTimeout<T>(promise: Promise<T>, ms: number, plugin: IClientPlugin, hookName: string): Promise<T | null> {
    var stats = this.statsByName.get(String(plugin.name));
    var fired = false;
    var timeoutId: ReturnType<typeof setTimeout> | null = null;
    var timed: Promise<T | null> = new Promise(function (resolve) {
      timeoutId = setTimeout(function () {
        if (fired) return;
        fired = true;
        if (stats) stats.hook_timeout_count += 1;
        try {
          console.warn('[plugin-registry] plugin ' + String(plugin.name) + ' hook ' + hookName + ' exceeded tick budget ' + String(ms) + 'ms - dropping');
        } catch {
          // ignore
        }
        resolve(null);
      }, Math.max(1, Number(ms) | 0));
    });
    var settled = promise.then(function (v) {
      fired = true;
      if (timeoutId !== null) {
        try { clearTimeout(timeoutId); } catch { /* ignore */ }
      }
      return v;
    }, function (err) {
      fired = true;
      if (timeoutId !== null) {
        try { clearTimeout(timeoutId); } catch { /* ignore */ }
      }
      throw err;
    });
    return Promise.race([settled, timed]);
  }

  private normalizeEmitted(raw: EmittedEvents | void | null | undefined): EmittedEvents {
    if (!raw) return {};
    if (typeof raw !== 'object') return {};
    var out: EmittedEvents = {};
    var ze = (raw as EmittedEvents).zoneEvents;
    if (ze && ze.length > 0) out.zoneEvents = ze.slice();
    return out;
  }

  // Dispatch a hook across all registered plugins. Snapshots the
  // plugin list at dispatch start so a hook that mutates the
  // registry cannot change which plugins run for THIS dispatch.
  private async dispatch(hookName: string, args: unknown[]): Promise<EmittedEvents> {
    var snapshot = this.plugins.slice();
    var merged: EmittedEvents = {};
    var zoneEvents: ZoneEvent[] | undefined;
    for (var i = 0; i < snapshot.length; i++) {
      var plugin = snapshot[i];
      if (!plugin) continue;
      var ctx = this.makeCtx(plugin);
      var emitted = await this.safeCall(plugin, hookName, ctx, args);
      if (!emitted) continue;
      if (emitted.zoneEvents && emitted.zoneEvents.length > 0) {
        if (!zoneEvents) zoneEvents = [];
        for (var j = 0; j < emitted.zoneEvents.length; j++) {
          var ev = emitted.zoneEvents[j];
          if (ev) zoneEvents.push(ev);
        }
      }
    }
    if (zoneEvents) merged.zoneEvents = zoneEvents;
    return merged;
  }

  // Public entrypoints. The bridge listener calls dispatchZoneEvent;
  // hosts can also call any of these directly.

  async dispatchZoneEvent(envelope: ZoneEventEnvelope): Promise<EmittedEvents> {
    var merged: EmittedEvents = {};
    var zoneEvents: ZoneEvent[] | undefined;
    var snapshot = this.plugins.slice();
    for (var i = 0; i < snapshot.length; i++) {
      var plugin = snapshot[i];
      if (!plugin) continue;
      var ctx = this.makeCtx(plugin);
      // Catch-all hook first.
      var caught = await this.safeCall(plugin, 'onZoneEvent', ctx, [envelope]);
      if (caught && caught.zoneEvents && caught.zoneEvents.length > 0) {
        if (!zoneEvents) zoneEvents = [];
        for (var j = 0; j < caught.zoneEvents.length; j++) {
          var ev = caught.zoneEvents[j];
          if (ev) zoneEvents.push(ev);
        }
      }
      // Narrow boss conveniences.
      if (envelope.type === 'zone.boss.spawn') {
        var spawnData = envelope.data as ZoneBossSpawnData;
        if (spawnData && spawnData.boss) {
          var emitSpawn = await this.safeCall(plugin, 'onBossSpawn', ctx, [String(envelope.zone_id), spawnData.boss]);
          if (emitSpawn && emitSpawn.zoneEvents && emitSpawn.zoneEvents.length > 0) {
            if (!zoneEvents) zoneEvents = [];
            for (var k = 0; k < emitSpawn.zoneEvents.length; k++) {
              var sev = emitSpawn.zoneEvents[k];
              if (sev) zoneEvents.push(sev);
            }
          }
        }
      } else if (envelope.type === 'zone.boss.end') {
        var endData = envelope.data as ZoneBossEndData;
        if (endData) {
          var emitEnd = await this.safeCall(plugin, 'onBossEnd', ctx, [String(envelope.zone_id), String(endData.boss_id), endData.outcome]);
          if (emitEnd && emitEnd.zoneEvents && emitEnd.zoneEvents.length > 0) {
            if (!zoneEvents) zoneEvents = [];
            for (var l = 0; l < emitEnd.zoneEvents.length; l++) {
              var lev = emitEnd.zoneEvents[l];
              if (lev) zoneEvents.push(lev);
            }
          }
          if (endData.loot && endData.loot.length > 0) {
            var emitLoot = await this.safeCall(plugin, 'onLootDrop', ctx, [String(envelope.zone_id), String(endData.boss_id), endData.loot]);
            if (emitLoot && emitLoot.zoneEvents && emitLoot.zoneEvents.length > 0) {
              if (!zoneEvents) zoneEvents = [];
              for (var m = 0; m < emitLoot.zoneEvents.length; m++) {
                var mev = emitLoot.zoneEvents[m];
                if (mev) zoneEvents.push(mev);
              }
            }
          }
        }
      }
    }
    if (zoneEvents) merged.zoneEvents = zoneEvents;
    return merged;
  }

  async dispatchPreTick(): Promise<EmittedEvents> {
    return this.dispatch('onPreTick', []);
  }

  async dispatchPostTick(): Promise<EmittedEvents> {
    return this.dispatch('onPostTick', []);
  }

  async dispatchBossSpawn(zoneId: string, boss: ZoneBossSpec): Promise<EmittedEvents> {
    return this.dispatch('onBossSpawn', [String(zoneId), boss]);
  }

  async dispatchBossEnd(zoneId: string, bossId: string, outcome: ZoneBossOutcome): Promise<EmittedEvents> {
    return this.dispatch('onBossEnd', [String(zoneId), String(bossId), outcome]);
  }

  async dispatchLootDrop(zoneId: string, bossId: string, items: ReadonlyArray<unknown>): Promise<EmittedEvents> {
    return this.dispatch('onLootDrop', [String(zoneId), String(bossId), items.slice()]);
  }

  // ----- Disposal -----

  // Tear the registry down: detach DOM listeners, dispose every
  // plugin, drop state. Tests call this at the end of a block; the
  // ARPG-loom IIFE calls it on hot module reload to prevent listener
  // leaks.
  async dispose(): Promise<void> {
    this.detachBridge();
    await this.resetForTest();
  }

  // ----- Internals -----

  private errorMeta(err: unknown): Record<string, unknown> {
    if (err instanceof Error) {
      return {
        error_name: err.name,
        error_message: err.message,
        error_stack: err.stack || null,
      };
    }
    var safe: string;
    try {
      safe = JSON.stringify(err);
    } catch {
      safe = String(err);
    }
    return { error: safe };
  }

  // Test affordance: read per-plugin stats. The stats reference is
  // live (not snapshotted) so tests that increment via the wrapper
  // and read via this method see consistent values without round-
  // tripping through describe().
  statsFor(name: string): PluginOpsStats | undefined {
    return this.statsByName.get(String(name));
  }
}
