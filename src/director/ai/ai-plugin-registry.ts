// AIPluginRegistry - dispatches lifecycle hooks across registered plugins.
//
// Per LOOM-DIRECTOR-PROTOCOL-V2 Section 5.3: the registry holds N
// plugins, dispatches each hook in priority order (lower runs first),
// and concatenates the EmittedEvents from every plugin into a single
// merged result. The caller (the engine's emit path / TWT's loom_director
// orchestrator) takes the merged events and routes them - character
// events to the v1 stream, zone events to the v2 zone log + presence
// fanout.
//
// Error isolation guarantee (open question 8.3): if a plugin's hook
// throws synchronously OR the returned Promise rejects, the registry
// logs the failure via that plugin's logger, drops that plugin's
// contribution for THIS dispatch only, and continues with the next
// plugin. The dispatch never throws to the caller. Plugin authors
// remain responsible for their own internal try/catch; the registry
// is the safety net of last resort.
//
// Implementation notes:
//   - Plugins are kept in a sorted array; register/unregister keep
//     it sorted so the dispatch hot path is a simple iteration.
//   - The registry never instantiates a PluginContext; the caller
//     supplies one per dispatch (or reuses one and refreshes views).
//     This keeps the registry decoupled from world-state plumbing.
//   - dispose() is awaited inside unregister() so plugins can flush
//     pending work; if dispose throws we log and continue (drop
//     guarantee extends to dispose so the caller never sees plugin
//     errors leak).

import type {
  IAIPlugin,
  EmittedEvents,
  PluginContext,
  PeerInfo,
  PlayerAction,
} from './plugin.js';

export class AIPluginDuplicateError extends Error {
  constructor(public readonly pluginName: string) {
    super('AIPluginDuplicateError: plugin already registered: ' + pluginName);
    this.name = 'AIPluginDuplicateError';
  }
}

export class AIPluginRegistry {
  // Sorted by priority ascending, then by registration order. The
  // registration index is encoded by inserting at the right position
  // on register() rather than re-sorting, which preserves stable
  // ordering for equal priorities.
  private plugins: IAIPlugin[] = [];

  // ----- Lifecycle -----

  // Register a plugin. Throws AIPluginDuplicateError if a plugin with
  // the same name is already registered (names are the registry key).
  // Insertion is O(n) but n is small (typically 1-10 plugins).
  register(plugin: IAIPlugin): void {
    for (var i = 0; i < this.plugins.length; i++) {
      var existing = this.plugins[i];
      if (existing && existing.name === plugin.name) {
        throw new AIPluginDuplicateError(plugin.name);
      }
    }
    // Find the first plugin with strictly higher priority and insert
    // before it. This preserves stable ordering for equal priorities
    // (a later-registered plugin runs after an earlier one with the
    // same priority).
    var insertAt = this.plugins.length;
    for (var j = 0; j < this.plugins.length; j++) {
      var p = this.plugins[j];
      if (p && p.priority > plugin.priority) {
        insertAt = j;
        break;
      }
    }
    this.plugins.splice(insertAt, 0, plugin);
  }

  // Unregister a plugin by name. Awaits the plugin's dispose() if
  // present; logs and drops if dispose throws. Returns true if a
  // plugin was removed, false if no plugin with that name was
  // registered.
  async unregister(name: string): Promise<boolean> {
    var idx = -1;
    for (var i = 0; i < this.plugins.length; i++) {
      var p = this.plugins[i];
      if (p && p.name === name) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return false;
    var plugin = this.plugins[idx];
    this.plugins.splice(idx, 1);
    if (plugin && typeof plugin.dispose === 'function') {
      try {
        await plugin.dispose();
      } catch (err) {
        // Drop guarantee extends to dispose. We can't log via the
        // plugin's logger because we have no PluginContext here;
        // fall back to console with the plugin name tag.
        console.error(
          '[plugin: ' + plugin.name + '] dispose() threw',
          this.errorMeta(err),
        );
      }
    }
    return true;
  }

  // Read-only snapshot of the plugin list, in dispatch order. Returns
  // a fresh array; mutating it does not affect the registry.
  list(): ReadonlyArray<IAIPlugin> {
    return this.plugins.slice();
  }

  // Look up a plugin by name. Returns undefined if no plugin with
  // that name is registered.
  get(name: string): IAIPlugin | undefined {
    for (var i = 0; i < this.plugins.length; i++) {
      var p = this.plugins[i];
      if (p && p.name === name) return p;
    }
    return undefined;
  }

  // ----- Dispatchers -----

  // All five dispatchers share the same shape: iterate plugins in
  // priority order, call the hook if defined, await the result, merge
  // into the running EmittedEvents. Errors are caught per-plugin and
  // logged via the plugin's logger if reachable through ctx; never
  // thrown to the caller.

  async dispatchTick(ctx: PluginContext): Promise<EmittedEvents> {
    return this.dispatch(ctx, 'onTick', function (plugin, ctx) {
      return plugin.onTick!(ctx);
    });
  }

  async dispatchPeerJoin(ctx: PluginContext, peer: PeerInfo): Promise<EmittedEvents> {
    return this.dispatch(ctx, 'onPeerJoin', function (plugin, ctx) {
      return plugin.onPeerJoin!(ctx, peer);
    });
  }

  async dispatchPeerLeave(ctx: PluginContext, peer: PeerInfo): Promise<EmittedEvents> {
    return this.dispatch(ctx, 'onPeerLeave', function (plugin, ctx) {
      return plugin.onPeerLeave!(ctx, peer);
    });
  }

  async dispatchZoneEnter(
    ctx: PluginContext,
    peer: PeerInfo,
    fromZone: string | null,
  ): Promise<EmittedEvents> {
    return this.dispatch(ctx, 'onZoneEnter', function (plugin, ctx) {
      return plugin.onZoneEnter!(ctx, peer, fromZone);
    });
  }

  async dispatchPlayerAction(
    ctx: PluginContext,
    peer: PeerInfo,
    action: PlayerAction,
  ): Promise<EmittedEvents> {
    return this.dispatch(ctx, 'onPlayerAction', function (plugin, ctx) {
      return plugin.onPlayerAction!(ctx, peer, action);
    });
  }

  // ----- Internals -----

  // Generic dispatch helper. `hookName` is the property name we check
  // for definition on each plugin; `invoke` calls the actual hook
  // (the spread of args differs per dispatcher). Per-plugin try/catch
  // around the await isolates failures.
  private async dispatch(
    ctx: PluginContext,
    hookName: keyof IAIPlugin,
    invoke: (plugin: IAIPlugin, ctx: PluginContext) => Promise<EmittedEvents>,
  ): Promise<EmittedEvents> {
    var merged: EmittedEvents = {};
    var characterEvents: EmittedEvents['characterEvents'] = undefined;
    var zoneEvents: EmittedEvents['zoneEvents'] = undefined;
    // Snapshot the plugin list at dispatch start so a mutation during
    // the dispatch (a hook calls registry.register/unregister) cannot
    // change which plugins run for THIS dispatch. Spec doesn't forbid
    // mutation but the predictable behavior is "this dispatch sees
    // the registry as it was at start".
    var snapshot = this.plugins.slice();
    for (var i = 0; i < snapshot.length; i++) {
      var plugin = snapshot[i];
      if (!plugin) continue;
      // Hook not implemented by this plugin? Skip without allocating
      // anything. Use bracket access so the keyof typing carries through.
      var hook = (plugin as unknown as Record<string, unknown>)[hookName as string];
      if (typeof hook !== 'function') continue;
      var emitted: EmittedEvents | undefined;
      try {
        emitted = await invoke(plugin, ctx);
      } catch (err) {
        // Log via the plugin's logger so the failure is tagged with
        // the plugin name. ctx.logger may itself throw; if so, fall
        // back to console (cannot let logger errors break dispatch).
        try {
          ctx.logger.error(
            'plugin hook ' + String(hookName) + ' threw',
            this.errorMeta(err),
          );
        } catch {
          console.error(
            '[plugin: ' + plugin.name + '] hook ' + String(hookName) + ' threw',
            this.errorMeta(err),
          );
        }
        // Drop this plugin's contribution for this dispatch.
        continue;
      }
      if (!emitted) continue;
      if (emitted.characterEvents && emitted.characterEvents.length > 0) {
        if (!characterEvents) characterEvents = [];
        for (var ci = 0; ci < emitted.characterEvents.length; ci++) {
          var ce = emitted.characterEvents[ci];
          if (ce) characterEvents.push(ce);
        }
      }
      if (emitted.zoneEvents && emitted.zoneEvents.length > 0) {
        if (!zoneEvents) zoneEvents = [];
        for (var zi = 0; zi < emitted.zoneEvents.length; zi++) {
          var ze = emitted.zoneEvents[zi];
          if (ze) zoneEvents.push(ze);
        }
      }
    }
    if (characterEvents) merged.characterEvents = characterEvents;
    if (zoneEvents) merged.zoneEvents = zoneEvents;
    return merged;
  }

  // Pull useful fields out of an unknown error for log meta. Avoids
  // throwing on non-Error throws (strings, objects, undefined).
  private errorMeta(err: unknown): Record<string, unknown> {
    if (err instanceof Error) {
      return {
        error_name: err.name,
        error_message: err.message,
        error_stack: err.stack ?? null,
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
}
