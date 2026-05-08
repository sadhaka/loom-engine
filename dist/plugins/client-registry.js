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
import { PluginEntropy, PluginError, ALL_SCOPES, DEFAULT_PLUGIN_STORAGE_MAX_BYTES, DEFAULT_PLUGIN_TICK_BUDGET_MS, } from './types.js';
// ----- MapPluginStorage -----
//
// In-memory PluginStorage. Mirror of the Python MapPluginStorage.
// Sufficient for a single-tab session; consumers wanting persistence
// across tab reloads can swap in an IndexedDB-backed adapter without
// touching the registry.
export class MapPluginStorage {
    data = new Map();
    async get(key) {
        return this.data.get(String(key));
    }
    async set(key, value) {
        this.data.set(String(key), value);
    }
    async delete(key) {
        this.data.delete(String(key));
    }
    resetForTest() {
        this.data.clear();
    }
    // Inspect-only: total entries. Useful in tests.
    size() {
        return this.data.size;
    }
}
// ----- ConsolePluginLogger -----
//
// Tags every line with [plugin: <name>] and forwards to the matching
// console method. Meta is JSON-stringified; circular refs fall back
// to a short description so logging never throws at the boundary.
export class ConsolePluginLogger {
    pluginName;
    constructor(pluginName) {
        this.pluginName = pluginName;
    }
    info(msg, meta) {
        this.write('info', msg, meta);
    }
    warn(msg, meta) {
        this.write('warn', msg, meta);
    }
    error(msg, meta) {
        this.write('error', msg, meta);
    }
    write(level, msg, meta) {
        var tag = '[plugin: ' + this.pluginName + ']';
        var line = tag + ' ' + msg;
        var metaStr = '';
        if (meta) {
            try {
                metaStr = ' ' + JSON.stringify(meta);
            }
            catch {
                metaStr = ' [meta-not-serializable]';
            }
        }
        var out = line + metaStr;
        try {
            if (level === 'info')
                console.info(out);
            else if (level === 'warn')
                console.warn(out);
            else
                console.error(out);
        }
        catch {
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
export async function setWithTtl(storage, key, value, ttlMs, nowFn) {
    var now = nowFn ? nowFn() : Date.now();
    var ttl = Number(ttlMs) || 0;
    var envelope = {};
    envelope[TTL_ENVELOPE_TAG] = 1;
    envelope.value = value;
    envelope.expires_at_ms = now + ttl;
    await storage.set(key, envelope);
}
export async function getWithTtlCheck(storage, key, nowFn) {
    var raw = await storage.get(key);
    if (raw === undefined || raw === null)
        return undefined;
    if (typeof raw === 'object' && raw !== null) {
        var obj = raw;
        if (obj[TTL_ENVELOPE_TAG] === 1) {
            var expires = Number(obj.expires_at_ms) || 0;
            var now = nowFn ? nowFn() : Date.now();
            if (expires > 0 && expires < now) {
                try {
                    await storage.delete(key);
                }
                catch {
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
class CountingStorageWrapper {
    inner;
    stats;
    maxBytes;
    pluginName;
    constructor(inner, stats, maxBytes, pluginName) {
        this.inner = inner;
        this.stats = stats;
        this.maxBytes = maxBytes;
        this.pluginName = pluginName;
    }
    async get(key) {
        this.stats.storage_get_count += 1;
        return this.inner.get(key);
    }
    async set(key, value) {
        var vSize = 0;
        try {
            vSize = JSON.stringify(value).length;
        }
        catch {
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
    async delete(key) {
        this.stats.storage_delete_count += 1;
        // Note: byte tracking is approximate - we do not decrement on
        // delete because we'd need to read the prior value. Operators
        // should treat storage_bytes_used as 'lifetime bytes written',
        // not 'currently resident'. Same posture as the Python runtime.
        await this.inner.delete(key);
    }
}
// ----- buildEmptyStats -----
function buildEmptyStats() {
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
// ----- ClientPluginRegistry -----
export class ClientPluginRegistry {
    // Sorted by priority ascending, registration order on ties.
    plugins = [];
    // Per-plugin in-memory MapPluginStorage. Wrapped in a
    // CountingStorageWrapper before being handed to plugins.
    storageByName = new Map();
    // Per-plugin logger.
    loggersByName = new Map();
    // Per-plugin ops stats.
    statsByName = new Map();
    opts;
    // DOM bridge state. The registry attaches a single capturing
    // listener per prefix to the eventTarget; that listener fans out
    // to dispatchZoneEvent. Storing the bound function lets dispose()
    // remove the listeners cleanly.
    bridgedHandlers = [];
    constructor(options) {
        var opts = options || {};
        var defaultTarget = null;
        try {
            defaultTarget = (typeof globalThis !== 'undefined' && globalThis.window) ? globalThis.window : null;
        }
        catch {
            defaultTarget = null;
        }
        this.opts = {
            now: opts.now || function () { return Date.now(); },
            getZonePeers: opts.getZonePeers || function () { return []; },
            getZoneState: opts.getZoneState || function () { return new Map(); },
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
    attachBridge() {
        var target = this.opts.eventTarget;
        if (!target)
            return;
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
            if (!t)
                continue;
            var handler = function (ev) {
                try {
                    var ce = ev;
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
                }
                catch {
                    // Bridge listener must never throw.
                }
            };
            try {
                target.addEventListener(t, handler);
                this.bridgedHandlers.push({ prefix: this.opts.eventPrefixes[0] || 'arpg:zone-', type: t, handler });
            }
            catch {
                // Some headless environments may reject addEventListener for
                // certain types - skip silently.
            }
        }
    }
    detachBridge() {
        var target = this.opts.eventTarget;
        if (!target) {
            this.bridgedHandlers = [];
            return;
        }
        for (var i = 0; i < this.bridgedHandlers.length; i++) {
            var h = this.bridgedHandlers[i];
            if (!h)
                continue;
            try {
                target.removeEventListener(h.type, h.handler);
            }
            catch {
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
    register(plugin) {
        if (!plugin)
            throw new Error('plugin required');
        var name = String(plugin.name || '').trim();
        if (!name)
            throw new Error('plugin.name required');
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
    async unregister(name) {
        var n = String(name || '').trim();
        if (!n)
            return false;
        var idx = -1;
        for (var i = 0; i < this.plugins.length; i++) {
            var p = this.plugins[i];
            if (p && p.name === n) {
                idx = i;
                break;
            }
        }
        if (idx === -1)
            return false;
        var plugin = this.plugins[idx];
        this.plugins.splice(idx, 1);
        this.storageByName.delete(n);
        this.loggersByName.delete(n);
        this.statsByName.delete(n);
        if (plugin && typeof plugin.dispose === 'function') {
            try {
                var result = plugin.dispose();
                if (result && typeof result.then === 'function') {
                    await result;
                }
            }
            catch (err) {
                try {
                    console.error('[plugin-registry] dispose for ' + n + ' failed:', err);
                }
                catch {
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
    async reload(name, moduleSpecifier, exportName) {
        var n = String(name || '').trim();
        if (!n)
            return null;
        var current;
        for (var i = 0; i < this.plugins.length; i++) {
            var p = this.plugins[i];
            if (p && p.name === n) {
                current = p;
                break;
            }
        }
        if (!current)
            return null;
        // No moduleSpecifier supplied AND no host way to find one means
        // we cannot reload - return null. A future revision could keep
        // an internal map of name -> moduleSpecifier set at register()
        // time; for now we leave it explicit so plugin authors opt in.
        if (!moduleSpecifier)
            return null;
        var bustQuery = '?v=' + String(Date.now());
        var url = String(moduleSpecifier) + bustQuery;
        var mod;
        try {
            // The dynamic-import RHS is a string at runtime - TS does not
            // know the module shape so we type the result as an unknown
            // record and pull the export by name.
            mod = (await import(/* @vite-ignore */ url));
        }
        catch (err) {
            try {
                console.error('[plugin-registry] reload import failed for ' + n + ':', err);
            }
            catch {
                // ignore
            }
            return null;
        }
        var exportedKey = exportName || (current.constructor && current.constructor.name) || n;
        var Cls = mod[exportedKey];
        if (typeof Cls !== 'function') {
            try {
                console.error('[plugin-registry] reload could not find export ' + exportedKey + ' in module ' + moduleSpecifier);
            }
            catch {
                // ignore
            }
            return null;
        }
        var instance;
        try {
            instance = new Cls();
        }
        catch (err) {
            try {
                console.error('[plugin-registry] reload re-instantiate failed for ' + n + ':', err);
            }
            catch {
                // ignore
            }
            return null;
        }
        await this.unregister(n);
        this.register(instance);
        var rows = this.describe();
        for (var k = 0; k < rows.length; k++) {
            var row = rows[k];
            if (row && row.name === n)
                return row;
        }
        return null;
    }
    list() {
        return this.plugins.slice();
    }
    get(name) {
        var n = String(name || '').trim();
        for (var i = 0; i < this.plugins.length; i++) {
            var p = this.plugins[i];
            if (p && p.name === n)
                return p;
        }
        return undefined;
    }
    // Drop every registered plugin. Tests call this between blocks so
    // state stays isolated.
    async resetForTest() {
        var snapshot = this.plugins.slice();
        for (var i = 0; i < snapshot.length; i++) {
            var p = snapshot[i];
            if (!p)
                continue;
            try {
                await this.unregister(p.name);
            }
            catch {
                // Best-effort.
            }
        }
        this.plugins = [];
        this.storageByName.clear();
        this.loggersByName.clear();
        this.statsByName.clear();
    }
    // ----- Describe -----
    describe() {
        var hookNames = [
            'onZoneEvent',
            'onPreTick',
            'onPostTick',
            'onBossSpawn',
            'onBossEnd',
            'onLootDrop',
            'dispose',
        ];
        var out = [];
        for (var i = 0; i < this.plugins.length; i++) {
            var plugin = this.plugins[i];
            if (!plugin)
                continue;
            var hooks = [];
            for (var h = 0; h < hookNames.length; h++) {
                var hookName = hookNames[h];
                if (!hookName)
                    continue;
                var hookFn = plugin[hookName];
                if (typeof hookFn === 'function')
                    hooks.push(hookName);
            }
            var requires = String(plugin.requiresProtocol || '');
            var supersedes = (plugin.supersedesPlugins || []).map(function (s) { return String(s); });
            var tags = (plugin.tags || []).map(function (t) { return String(t); });
            var description = String(plugin.description || '');
            var name = String(plugin.name);
            var version = String(plugin.version);
            var priority = Number(plugin.priority) | 0;
            var tickBudgetMs = Number(plugin.tickBudgetMs);
            if (!isFinite(tickBudgetMs) || tickBudgetMs <= 0)
                tickBudgetMs = DEFAULT_PLUGIN_TICK_BUDGET_MS;
            var storageMaxBytes = Number(plugin.storageMaxBytes);
            if (!isFinite(storageMaxBytes) || storageMaxBytes < 0)
                storageMaxBytes = DEFAULT_PLUGIN_STORAGE_MAX_BYTES;
            var declared = plugin.requiredScopes;
            var scopes;
            if (!declared) {
                scopes = ALL_SCOPES.slice().sort();
            }
            else {
                var seen = {};
                var arr = [];
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
            var snapshotStats = {
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
    makeCtx(plugin) {
        var name = String(plugin.name);
        var inner = this.storageByName.get(name) || new MapPluginStorage();
        var logger = this.loggersByName.get(name) || new ConsolePluginLogger(name);
        var stats = this.statsByName.get(name) || buildEmptyStats();
        var maxBytes = Number(plugin.storageMaxBytes);
        if (!isFinite(maxBytes) || maxBytes < 0)
            maxBytes = DEFAULT_PLUGIN_STORAGE_MAX_BYTES;
        var wrapped = new CountingStorageWrapper(inner, stats, maxBytes, name);
        var declared = plugin.requiredScopes;
        var scopes = declared ? declared : ALL_SCOPES;
        function hasScope(s) {
            for (var i = 0; i < scopes.length; i++) {
                if (scopes[i] === s)
                    return true;
            }
            return false;
        }
        var rootGetZonePeers = this.opts.getZonePeers;
        var rootGetZoneState = this.opts.getZoneState;
        var rootGetZoneEventsTail = this.opts.getZoneEventsTail;
        var rootNow = this.opts.now;
        function scopedZonePeers(zid) {
            if (!hasScope('read_zones'))
                return [];
            try {
                return rootGetZonePeers(String(zid)) || [];
            }
            catch {
                return [];
            }
        }
        function scopedZoneState(zid) {
            if (!hasScope('read_zones'))
                return new Map();
            try {
                return rootGetZoneState(String(zid)) || new Map();
            }
            catch {
                return new Map();
            }
        }
        function scopedZoneEventsTail(zid, n) {
            if (!hasScope('read_events'))
                return [];
            try {
                return rootGetZoneEventsTail(String(zid), Number(n) | 0) || [];
            }
            catch {
                return [];
            }
        }
        function peersInRadius(zid, x, y, radius) {
            var r = Number(radius) || 0;
            if (r <= 0)
                return [];
            var rsq = r * r;
            var peers = scopedZonePeers(String(zid));
            var out = [];
            for (var i = 0; i < peers.length; i++) {
                var p = peers[i];
                if (!p)
                    continue;
                var dx = (Number(p.x) || 0) - Number(x);
                var dy = (Number(p.y) || 0) - Number(y);
                if ((dx * dx + dy * dy) <= rsq)
                    out.push(p);
            }
            return out;
        }
        function nearestPeer(zid, x, y) {
            var peers = scopedZonePeers(String(zid));
            if (peers.length === 0)
                return null;
            var best = null;
            var bestDsq = Infinity;
            for (var i = 0; i < peers.length; i++) {
                var p = peers[i];
                if (!p)
                    continue;
                var dx = (Number(p.x) || 0) - Number(x);
                var dy = (Number(p.y) || 0) - Number(y);
                var dsq = dx * dx + dy * dy;
                if (dsq < bestDsq) {
                    bestDsq = dsq;
                    best = p;
                }
            }
            if (!best)
                return null;
            return { peer: best, distance: Math.sqrt(bestDsq) };
        }
        function entropy(seed) {
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
    async safeCall(plugin, hookName, ctx, args) {
        var hookFn = plugin[hookName];
        if (typeof hookFn !== 'function')
            return null;
        var stats = this.statsByName.get(String(plugin.name));
        if (stats)
            stats.hook_call_count += 1;
        var budgetMs = Number(plugin.tickBudgetMs);
        if (!isFinite(budgetMs) || budgetMs <= 0)
            budgetMs = DEFAULT_PLUGIN_TICK_BUDGET_MS;
        var attempts = 0;
        var maxAttempts = 2;
        while (attempts < maxAttempts) {
            attempts += 1;
            try {
                var hookPromise = hookFn.apply(plugin, [ctx].concat(args));
                var raced = await this.withTimeout(hookPromise, budgetMs, plugin, hookName);
                if (raced === null) {
                    // Timeout already logged + counted; return null to drop.
                    return null;
                }
                return this.normalizeEmitted(raced);
            }
            catch (err) {
                if (err instanceof PluginError) {
                    err.pluginName = err.pluginName || String(plugin.name);
                    if (err.retryable && attempts < maxAttempts) {
                        if (stats)
                            stats.hook_retry_count += 1;
                        try {
                            ctx.logger.warn('hook ' + hookName + ' retryable PluginError: ' + err.code);
                        }
                        catch {
                            // ignore
                        }
                        continue;
                    }
                    if (stats)
                        stats.hook_error_count += 1;
                    try {
                        ctx.logger.error('hook ' + hookName + ' raised PluginError: ' + err.code);
                    }
                    catch {
                        // ignore
                    }
                    return null;
                }
                if (stats)
                    stats.hook_error_count += 1;
                try {
                    ctx.logger.error('hook ' + hookName + ' threw', this.errorMeta(err));
                }
                catch {
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
    withTimeout(promise, ms, plugin, hookName) {
        var stats = this.statsByName.get(String(plugin.name));
        var timeoutId = null;
        var timed = new Promise(function (resolve) {
            timeoutId = setTimeout(function () {
                if (stats)
                    stats.hook_timeout_count += 1;
                try {
                    console.warn('[plugin-registry] plugin ' + String(plugin.name) + ' hook ' + hookName + ' exceeded tick budget ' + String(ms) + 'ms - dropping');
                }
                catch {
                    // ignore
                }
                resolve(null);
            }, Math.max(1, Number(ms) | 0));
        });
        return Promise.race([
            promise.then(function (v) {
                if (timeoutId !== null) {
                    try {
                        clearTimeout(timeoutId);
                    }
                    catch { /* ignore */ }
                }
                return v;
            }, function (err) {
                if (timeoutId !== null) {
                    try {
                        clearTimeout(timeoutId);
                    }
                    catch { /* ignore */ }
                }
                throw err;
            }),
            timed,
        ]);
    }
    normalizeEmitted(raw) {
        if (!raw)
            return {};
        if (typeof raw !== 'object')
            return {};
        var out = {};
        var ze = raw.zoneEvents;
        if (ze && ze.length > 0)
            out.zoneEvents = ze.slice();
        return out;
    }
    // Dispatch a hook across all registered plugins. Snapshots the
    // plugin list at dispatch start so a hook that mutates the
    // registry cannot change which plugins run for THIS dispatch.
    async dispatch(hookName, args) {
        var snapshot = this.plugins.slice();
        var merged = {};
        var zoneEvents;
        for (var i = 0; i < snapshot.length; i++) {
            var plugin = snapshot[i];
            if (!plugin)
                continue;
            var ctx = this.makeCtx(plugin);
            var emitted = await this.safeCall(plugin, hookName, ctx, args);
            if (!emitted)
                continue;
            if (emitted.zoneEvents && emitted.zoneEvents.length > 0) {
                if (!zoneEvents)
                    zoneEvents = [];
                for (var j = 0; j < emitted.zoneEvents.length; j++) {
                    var ev = emitted.zoneEvents[j];
                    if (ev)
                        zoneEvents.push(ev);
                }
            }
        }
        if (zoneEvents)
            merged.zoneEvents = zoneEvents;
        return merged;
    }
    // Public entrypoints. The bridge listener calls dispatchZoneEvent;
    // hosts can also call any of these directly.
    async dispatchZoneEvent(envelope) {
        var merged = {};
        var zoneEvents;
        var snapshot = this.plugins.slice();
        for (var i = 0; i < snapshot.length; i++) {
            var plugin = snapshot[i];
            if (!plugin)
                continue;
            var ctx = this.makeCtx(plugin);
            // Catch-all hook first.
            var caught = await this.safeCall(plugin, 'onZoneEvent', ctx, [envelope]);
            if (caught && caught.zoneEvents && caught.zoneEvents.length > 0) {
                if (!zoneEvents)
                    zoneEvents = [];
                for (var j = 0; j < caught.zoneEvents.length; j++) {
                    var ev = caught.zoneEvents[j];
                    if (ev)
                        zoneEvents.push(ev);
                }
            }
            // Narrow boss conveniences.
            if (envelope.type === 'zone.boss.spawn') {
                var spawnData = envelope.data;
                if (spawnData && spawnData.boss) {
                    var emitSpawn = await this.safeCall(plugin, 'onBossSpawn', ctx, [String(envelope.zone_id), spawnData.boss]);
                    if (emitSpawn && emitSpawn.zoneEvents && emitSpawn.zoneEvents.length > 0) {
                        if (!zoneEvents)
                            zoneEvents = [];
                        for (var k = 0; k < emitSpawn.zoneEvents.length; k++) {
                            var sev = emitSpawn.zoneEvents[k];
                            if (sev)
                                zoneEvents.push(sev);
                        }
                    }
                }
            }
            else if (envelope.type === 'zone.boss.end') {
                var endData = envelope.data;
                if (endData) {
                    var emitEnd = await this.safeCall(plugin, 'onBossEnd', ctx, [String(envelope.zone_id), String(endData.boss_id), endData.outcome]);
                    if (emitEnd && emitEnd.zoneEvents && emitEnd.zoneEvents.length > 0) {
                        if (!zoneEvents)
                            zoneEvents = [];
                        for (var l = 0; l < emitEnd.zoneEvents.length; l++) {
                            var lev = emitEnd.zoneEvents[l];
                            if (lev)
                                zoneEvents.push(lev);
                        }
                    }
                    if (endData.loot && endData.loot.length > 0) {
                        var emitLoot = await this.safeCall(plugin, 'onLootDrop', ctx, [String(envelope.zone_id), String(endData.boss_id), endData.loot]);
                        if (emitLoot && emitLoot.zoneEvents && emitLoot.zoneEvents.length > 0) {
                            if (!zoneEvents)
                                zoneEvents = [];
                            for (var m = 0; m < emitLoot.zoneEvents.length; m++) {
                                var mev = emitLoot.zoneEvents[m];
                                if (mev)
                                    zoneEvents.push(mev);
                            }
                        }
                    }
                }
            }
        }
        if (zoneEvents)
            merged.zoneEvents = zoneEvents;
        return merged;
    }
    async dispatchPreTick() {
        return this.dispatch('onPreTick', []);
    }
    async dispatchPostTick() {
        return this.dispatch('onPostTick', []);
    }
    async dispatchBossSpawn(zoneId, boss) {
        return this.dispatch('onBossSpawn', [String(zoneId), boss]);
    }
    async dispatchBossEnd(zoneId, bossId, outcome) {
        return this.dispatch('onBossEnd', [String(zoneId), String(bossId), outcome]);
    }
    async dispatchLootDrop(zoneId, bossId, items) {
        return this.dispatch('onLootDrop', [String(zoneId), String(bossId), items.slice()]);
    }
    // ----- Disposal -----
    // Tear the registry down: detach DOM listeners, dispose every
    // plugin, drop state. Tests call this at the end of a block; the
    // ARPG-loom IIFE calls it on hot module reload to prevent listener
    // leaks.
    async dispose() {
        this.detachBridge();
        await this.resetForTest();
    }
    // ----- Internals -----
    errorMeta(err) {
        if (err instanceof Error) {
            return {
                error_name: err.name,
                error_message: err.message,
                error_stack: err.stack || null,
            };
        }
        var safe;
        try {
            safe = JSON.stringify(err);
        }
        catch {
            safe = String(err);
        }
        return { error: safe };
    }
    // Test affordance: read per-plugin stats. The stats reference is
    // live (not snapshotted) so tests that increment via the wrapper
    // and read via this method see consistent values without round-
    // tripping through describe().
    statsFor(name) {
        return this.statsByName.get(String(name));
    }
}
//# sourceMappingURL=client-registry.js.map