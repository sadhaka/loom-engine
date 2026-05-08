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

import type {
  PluginContext,
  PluginLogger,
  PluginStorage,
  PeerInfo,
  CharacterState,
} from './plugin.js';

// ----- MapPluginStorage -----
//
// In-memory storage shared across all plugins; per-plugin namespace
// is enforced by composing the storage key as `${pluginName}::${key}`.
// `clearPlugin(name)` wipes every entry tagged with that plugin so
// unregister + re-register starts clean.
export class MapPluginStorage {
  private readonly store = new Map<string, unknown>();

  // Build a per-plugin facade that satisfies the PluginStorage
  // interface; the facade scopes get/set/delete to the plugin's
  // namespace so plugin authors never see the composite key.
  forPlugin(pluginName: string): PluginStorage {
    var self = this;
    return {
      async get(key: string): Promise<unknown | undefined> {
        return self.store.get(self.composeKey(pluginName, key));
      },
      async set(key: string, value: unknown): Promise<void> {
        self.store.set(self.composeKey(pluginName, key), value);
      },
      async delete(key: string): Promise<void> {
        self.store.delete(self.composeKey(pluginName, key));
      },
    };
  }

  // Wipe all entries belonging to a plugin. Called by the registry
  // on unregister(). Iterates once; cost is O(total entries) but
  // unregister is rare.
  clearPlugin(pluginName: string): void {
    var prefix = pluginName + '::';
    var keysToDelete: string[] = [];
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
  size(): number {
    return this.store.size;
  }

  private composeKey(pluginName: string, key: string): string {
    return pluginName + '::' + key;
  }
}

// ----- ConsolePluginLogger -----
//
// Tags every line with `[plugin: <name>]` and forwards to the
// matching console method. Meta is JSON-stringified and appended;
// circular refs fall back to a short description so logging never
// throws at the boundary.
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

  private write(
    level: 'info' | 'warn' | 'error',
    msg: string,
    meta?: Record<string, unknown>,
  ): void {
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
    if (level === 'info') {
      console.info(out);
    } else if (level === 'warn') {
      console.warn(out);
    } else {
      console.error(out);
    }
  }
}

// ----- buildPluginContext -----
//
// Convenience factory for tests and simple consumers: wires a
// MapPluginStorage + ConsolePluginLogger + caller-supplied world
// views into a PluginContext that satisfies the IAIPlugin contract.
//
// Production consumers typically construct their own context per
// dispatch with state pulled from authoritative game state - this
// helper exists so a smoke test does not have to assemble five
// objects to call a single hook.
export interface BuildPluginContextOptions {
  pluginName: string;
  storage: MapPluginStorage;
  // Optional logger override; defaults to ConsolePluginLogger(pluginName).
  logger?: PluginLogger;
  // World-view callbacks. Defaults return empty views so unit tests
  // that don't care about world state can omit them.
  getZonePeers?: (zoneId: string) => ReadonlyArray<PeerInfo>;
  getCharacterState?: (characterId: string) => Readonly<CharacterState>;
  getZoneState?: (zoneId: string) => ReadonlyMap<string, unknown>;
  // Wall-clock override; defaults to Date.now.
  now?: () => number;
}

export function buildPluginContext(opts: BuildPluginContextOptions): PluginContext {
  var pluginName = opts.pluginName;
  var logger = opts.logger ?? new ConsolePluginLogger(pluginName);
  var storage = opts.storage.forPlugin(pluginName);
  var getZonePeers =
    opts.getZonePeers ??
    function () {
      return [];
    };
  var getCharacterState =
    opts.getCharacterState ??
    function (characterId: string): Readonly<CharacterState> {
      return {
        characterId,
        zone: '',
        x: 0,
        y: 0,
        hp_current: 0,
        hp_max: 0,
      };
    };
  var getZoneState =
    opts.getZoneState ??
    function () {
      return new Map<string, unknown>();
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
