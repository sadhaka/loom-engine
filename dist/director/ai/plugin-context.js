// PluginContext concrete implementations.
//
// MapPluginStorage  - in-memory KV backed by a single Map, namespaced
//                     per (pluginName, key). Survives across ticks;
//                     cleared when the registry calls clearPlugin().
// ConsolePluginLogger - tags every line with the plugin name and
//                       writes to console.{info,warn,error}. Suitable
//                       for tests + dev; production consumers can
//                       drop in a structured-log impl.
//
// These are reference implementations. Consumers wiring against
// `@sadhaka/loom-engine/server` may substitute their own
// PluginStorage / PluginLogger impls (e.g. Redis-backed storage,
// pino-backed logger) without changing the SPI surface.
//
// The registry does not assume MapPluginStorage; the SPI is
// the only contract. These exist so a consumer can stand a plugin
// up in five lines without writing a storage adapter first.
// ----- MapPluginStorage -----
//
// In-memory storage shared across all plugins; per-plugin namespace
// is enforced by composing the storage key as `${pluginName}::${key}`.
// `clearPlugin(name)` wipes every entry tagged with that plugin so
// unregister + re-register starts clean.
export class MapPluginStorage {
    store = new Map();
    // Build a per-plugin facade that satisfies the PluginStorage
    // interface; the facade scopes get/set/delete to the plugin's
    // namespace so plugin authors never see the composite key.
    forPlugin(pluginName) {
        var self = this;
        return {
            async get(key) {
                return self.store.get(self.composeKey(pluginName, key));
            },
            async set(key, value) {
                self.store.set(self.composeKey(pluginName, key), value);
            },
            async delete(key) {
                self.store.delete(self.composeKey(pluginName, key));
            },
        };
    }
    // Wipe all entries belonging to a plugin. Called by the registry
    // on unregister(). Iterates once; cost is O(total entries) but
    // unregister is rare.
    clearPlugin(pluginName) {
        var prefix = pluginName + '::';
        var keysToDelete = [];
        var iter = this.store.keys();
        var next = iter.next();
        while (!next.done) {
            var k = next.value;
            if (k.startsWith(prefix)) {
                keysToDelete.push(k);
            }
            next = iter.next();
        }
        for (var i = 0; i < keysToDelete.length; i++) {
            var key = keysToDelete[i];
            if (key !== undefined) {
                this.store.delete(key);
            }
        }
    }
    // Inspect-only: total number of entries across all plugins. Useful
    // in tests when asserting clearPlugin shrinks the store.
    size() {
        return this.store.size;
    }
    composeKey(pluginName, key) {
        return pluginName + '::' + key;
    }
}
// ----- ConsolePluginLogger -----
//
// Tags every line with `[plugin: <name>]` and forwards to the
// matching console method. Meta is JSON-stringified and appended;
// circular refs fall back to a short description so logging never
// throws at the boundary.
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
        if (level === 'info') {
            console.info(out);
        }
        else if (level === 'warn') {
            console.warn(out);
        }
        else {
            console.error(out);
        }
    }
}
export function buildPluginContext(opts) {
    var pluginName = opts.pluginName;
    var logger = opts.logger ?? new ConsolePluginLogger(pluginName);
    var storage = opts.storage.forPlugin(pluginName);
    var getZonePeers = opts.getZonePeers ??
        function () {
            return [];
        };
    var getCharacterState = opts.getCharacterState ??
        function (characterId) {
            return {
                characterId,
                zone: '',
                x: 0,
                y: 0,
                hp_current: 0,
                hp_max: 0,
            };
        };
    var getZoneState = opts.getZoneState ??
        function () {
            return new Map();
        };
    var now = opts.now ?? Date.now;
    return {
        getZonePeers,
        getCharacterState,
        getZoneState,
        storage,
        logger,
        now,
    };
}
//# sourceMappingURL=plugin-context.js.map