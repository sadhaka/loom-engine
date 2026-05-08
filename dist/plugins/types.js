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
// ----- PluginError -----
//
// Plugins signal expected failure modes by throwing PluginError
// instead of a bare Error. The registry catches both, but
// PluginError lets the plugin author tell the registry "this is
// retryable" so a single transient blip does not silently drop one
// dispatch's contribution. Bare Error still gets caught + dropped;
// PluginError is strictly additive.
export class PluginError extends Error {
    code;
    retryable;
    pluginName;
    original;
    constructor(code, retryable = false, pluginName = '', original = null) {
        super(String(code || 'unknown'));
        this.name = 'PluginError';
        this.code = String(code || 'unknown');
        this.retryable = Boolean(retryable);
        this.pluginName = String(pluginName || '');
        this.original = original;
    }
}
// Mulberry32 - 32-bit seeded RNG. Same family the engine uses in
// runtime/entropy.ts so plugin streams stay reproducible across
// replays without dragging in a heavy PRNG dep.
export class PluginEntropy {
    state;
    constructor(seed = null) {
        if (seed === null || seed === undefined) {
            // Fresh seed derived from Date.now alone. The plugin runtime
            // is out-of-tick (driven by SSE event arrivals), so Date.now
            // is acceptable here - the determinism whitelist allows it
            // for the same reason it allows the Python plugin-context
            // default. Plugin authors who need replay-tight streams pass
            // an explicit seed via ctx.entropy(seed).
            this.state = (Date.now() & 0xffffffff) >>> 0;
        }
        else {
            this.state = (Number(seed) | 0) >>> 0;
        }
    }
    random() {
        // Mulberry32 stepping. Always returns in [0.0, 1.0).
        var t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
    }
    pick(items) {
        if (!items || items.length === 0)
            return null;
        var idx = Math.floor(this.random() * items.length);
        if (idx >= items.length)
            idx = items.length - 1;
        var picked = items[idx];
        return picked === undefined ? null : picked;
    }
    intRange(low, highInclusive) {
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
export const ALL_SCOPES = ['read_zones', 'read_characters', 'read_events'];
// Default storage cap per plugin (mirror of the Python
// DEFAULT_PLUGIN_STORAGE_MAX_BYTES = 1 MiB).
export const DEFAULT_PLUGIN_STORAGE_MAX_BYTES = 1024 * 1024;
// Default per-hook tick budget (mirror of the Python default 1000ms).
export const DEFAULT_PLUGIN_TICK_BUDGET_MS = 1000;
//# sourceMappingURL=types.js.map