// AudioAssetCache - in-memory store of decoded AudioBuffers keyed by name.
//
// Per LOOM-AUDIO-SPEC §4.1. The cache is a thin Map<string, AudioBuffer>
// wrapper. AudioAssetLoader writes into it; CueCatalog and MusicDirector
// read from it. Lifetime is the AudioContext's lifetime; clear() is the
// hard reset for tests / scene transitions.
//
// Naming: callers choose name on load(). Defaults to URL basename without
// extension when omitted (the loader handles that derivation; the cache
// just stores whatever name it's handed). Re-loading the same name
// overwrites silently.
export class AudioAssetCache {
    buffers = new Map();
    // Get a previously-loaded buffer. Returns null if not in the cache.
    get(name) {
        return this.buffers.get(name) ?? null;
    }
    // True once a buffer has been placed under name (via the loader's
    // store path; tests can also call set directly through factory init).
    has(name) {
        return this.buffers.has(name);
    }
    // Internal entry point used by AudioAssetLoader after decode resolves.
    // Exposed publicly so consumers can pre-seed buffers from another
    // source (synthesized OfflineAudioContext output, for instance).
    set(name, buffer) {
        this.buffers.set(name, buffer);
    }
    // Remove a single asset. Future get() returns null. The buffer object
    // is GC'd if no live source still references it (any AudioBufferSource
    // already started keeps a reference until it ends).
    drop(name) {
        this.buffers.delete(name);
    }
    // Clear the whole cache. Useful for tests + scene-boundary teardown.
    clear() {
        this.buffers.clear();
    }
    // Active entry names (for debug + tests).
    list() {
        return Array.from(this.buffers.keys());
    }
}
// Resource key for the world's resource registry. Engine consumers
// register an AudioAssetCache instance under this key alongside
// RESOURCE_AUDIO_BUS so cues + music can resolve named assets.
export const RESOURCE_AUDIO_ASSET_CACHE = 'audio_asset_cache';
// Factory mirrors createTimeResource / createVeilBudgetResource so
// engine.create wiring is uniform.
export function createAudioAssetCache() {
    return new AudioAssetCache();
}
//# sourceMappingURL=audio-asset-cache.js.map