// CueCatalog - named sound events with predefined wiring.
//
// Per LOOM-AUDIO-SPEC §4.2. Gameplay code calls cues.play('boss_spawn',
// {x, y}) and the catalog handles AudioBus / SpatialAudioBus routing,
// asset lookup, gain/rate defaults, and per-cue cooldowns. Spatial cues
// route through SpatialAudioBus.playPositional and require x + y in
// the play options; non-spatial cues route through AudioBus.playOneShot
// on the named bus (default 'sfx').
//
// Cooldown enforcement: each cue tracks its last-play timestamp; play()
// invocations within cooldownMs of the prior play return null without
// touching the audio graph. Useful for "boss_hit" so rapid-fire hits
// don't stack into clipping.
//
// stopAll(name): for spatial cues that loop (boss combat ambience), the
// catalog tracks live SpatialSourceHandles per cue name and exposes
// stopAll to kill them on a single command (e.g. "boss died, stop the
// loop"). Non-spatial one-shots are not tracked - they end on their own.

import type { AudioBus } from './audio-bus.js';
import type { AudioAssetCache } from './audio-asset-cache.js';
import type {
  PositionalPlayOptions,
  SpatialAudioBus,
  SpatialSourceHandle,
} from './spatial-audio-bus.js';

// Re-export so consumers importing from cue-catalog still see the
// canonical Phase 17 audio types without reaching into the spatial
// module directly. The runtime types come from spatial-audio-bus.ts
// (Track A) - cue-catalog only borrows them for routing.
export type {
  PositionalPlayOptions,
  SpatialAudioBus,
  SpatialSourceHandle,
};

export interface CueDefinition {
  // The asset name registered in the AudioAssetCache.
  asset: string;
  // Which bus the cue routes through. Defaults to 'sfx'.
  bus?: 'sfx' | 'music' | 'voice' | 'ui' | string;
  // If true, the cue plays through SpatialAudioBus.playPositional and
  // requires { x, y } in the play options. If false (default), plays
  // through AudioBus.playOneShot on the named bus.
  spatial?: boolean;
  // Default play options. play() options merge over these.
  defaults?: Partial<PositionalPlayOptions> & { gain?: number; rate?: number };
  // Optional cooldown in ms; play() within cooldown returns null.
  cooldownMs?: number;
}

export type CuePlayOptions =
  Partial<PositionalPlayOptions>
  & { gain?: number; rate?: number; x?: number; y?: number };

// Time source. Real implementation uses performance.now(); tests can
// inject a deterministic clock by overriding this through the public
// constructor seam later. v1 uses the global clock for simplicity.
function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

interface CooldownEntry {
  // Last successful play timestamp in ms. -Infinity means "never".
  lastPlayMs: number;
}

export class CueCatalog {
  private audioBus: AudioBus;
  private spatialBus: SpatialAudioBus;
  private cache: AudioAssetCache;
  private cues: Map<string, CueDefinition> = new Map();
  private cooldowns: Map<string, CooldownEntry> = new Map();
  // Live spatial source handles per cue name. Cleared on stopAll(name).
  // Non-spatial one-shots are NOT tracked - they end naturally.
  private liveHandles: Map<string, Set<SpatialSourceHandle>> = new Map();

  private constructor(audioBus: AudioBus, spatialBus: SpatialAudioBus, cache: AudioAssetCache) {
    this.audioBus = audioBus;
    this.spatialBus = spatialBus;
    this.cache = cache;
  }

  static create(
    audioBus: AudioBus,
    spatialBus: SpatialAudioBus,
    cache: AudioAssetCache,
  ): CueCatalog {
    return new CueCatalog(audioBus, spatialBus, cache);
  }

  register(name: string, def: CueDefinition): void {
    this.cues.set(name, def);
    // Re-registering resets cooldown state so a fresh definition starts
    // from a clean slate (avoids stale lastPlay timestamps on overwrite).
    this.cooldowns.set(name, { lastPlayMs: -Infinity });
  }

  unregister(name: string): void {
    this.cues.delete(name);
    this.cooldowns.delete(name);
    // Stop any live handles for this cue so they don't outlive the
    // definition.
    this.stopAll(name);
    this.liveHandles.delete(name);
  }

  has(name: string): boolean {
    return this.cues.has(name);
  }

  list(): ReadonlyArray<string> {
    return Array.from(this.cues.keys());
  }

  // Play a registered cue. Spatial cues require x + y in options.
  // Returns a handle for spatial cues; null for non-spatial cues, for
  // unknown cues, for cues whose asset is not in the cache, or when
  // cooldown is active.
  play(name: string, options?: CuePlayOptions): SpatialSourceHandle | null {
    var def = this.cues.get(name);
    if (!def) return null;

    // Cooldown gate. Suppress play and leave lastPlay untouched if too
    // soon after the prior successful play.
    if (def.cooldownMs !== undefined && def.cooldownMs > 0) {
      var entry = this.cooldowns.get(name) ?? { lastPlayMs: -Infinity };
      var t = nowMs();
      if (t - entry.lastPlayMs < def.cooldownMs) {
        return null;
      }
    }

    // Asset must be in cache.
    var buffer = this.cache.get(def.asset);
    if (!buffer) return null;

    // Merge defaults under the explicit options. The intent is "options
    // override defaults"; we copy each key path explicitly for the
    // strict-mode-friendly subset the spec uses.
    var merged: CuePlayOptions = {};
    if (def.defaults) {
      for (var k in def.defaults) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as Record<string, unknown>)[k] = (def.defaults as Record<string, unknown>)[k];
      }
    }
    if (options) {
      for (var k2 in options) {
        var v = (options as Record<string, unknown>)[k2];
        if (v !== undefined) {
          (merged as Record<string, unknown>)[k2] = v;
        }
      }
    }

    var spatial = def.spatial === true;

    if (spatial) {
      if (typeof merged.x !== 'number' || typeof merged.y !== 'number') {
        // Spatial cue requires position. Drop silently rather than throwing -
        // matches "Returns null for ... failure" contract.
        return null;
      }
      // Build a complete PositionalPlayOptions. We carry all merged
      // fields into the spatial bus call.
      var posOpts: PositionalPlayOptions = {
        x: merged.x,
        y: merged.y,
      };
      if (typeof merged.z === 'number') posOpts.z = merged.z;
      if (merged.distanceModel !== undefined) posOpts.distanceModel = merged.distanceModel;
      if (typeof merged.refDistance === 'number') posOpts.refDistance = merged.refDistance;
      if (typeof merged.maxDistance === 'number') posOpts.maxDistance = merged.maxDistance;
      if (typeof merged.rolloffFactor === 'number') posOpts.rolloffFactor = merged.rolloffFactor;
      if (typeof merged.gain === 'number') posOpts.gain = merged.gain;
      if (typeof merged.rate === 'number') posOpts.rate = merged.rate;
      if (typeof merged.loop === 'boolean') posOpts.loop = merged.loop;

      var handle = this.spatialBus.playPositional(buffer, posOpts);
      if (!handle) return null;

      // Track for stopAll. We DO NOT auto-cleanup non-loop one-shots
      // here - the SpatialAudioBus is the source of truth on lifetime.
      // stopAll is the primary cleanup path; if a cue is a one-shot the
      // tracked handle just becomes a no-op stop later.
      var setForName = this.liveHandles.get(name);
      if (!setForName) {
        setForName = new Set<SpatialSourceHandle>();
        this.liveHandles.set(name, setForName);
      }
      setForName.add(handle);

      this.markPlayed(name);
      return handle;
    }

    // Non-spatial: route through AudioBus.playOneShot on the named bus.
    var busName = def.bus ?? 'sfx';
    var oneShotOpts: { rate?: number; gain?: number } = {};
    if (typeof merged.rate === 'number') oneShotOpts.rate = merged.rate;
    if (typeof merged.gain === 'number') oneShotOpts.gain = merged.gain;
    this.audioBus.playOneShot(busName, buffer, oneShotOpts);
    this.markPlayed(name);
    return null;
  }

  // Stop all live spatial sources for this cue. Non-spatial one-shots
  // are not tracked; this is a no-op for cues that have never produced
  // a spatial handle.
  stopAll(name: string): void {
    var setForName = this.liveHandles.get(name);
    if (!setForName) return;
    setForName.forEach(function (h) {
      try {
        h.stop();
      } catch {
        // Best-effort cleanup; never let a misbehaving handle take down
        // sibling cues.
      }
    });
    setForName.clear();
  }

  private markPlayed(name: string): void {
    this.cooldowns.set(name, { lastPlayMs: nowMs() });
  }
}

// Resource key for the world's resource registry. Engine consumers
// register a CueCatalog instance under this key alongside the audio
// bus + spatial bus + cache.
export const RESOURCE_CUE_CATALOG = 'cue_catalog';
