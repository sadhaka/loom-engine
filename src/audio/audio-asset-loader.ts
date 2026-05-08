// AudioAssetLoader - URL fetch + decode pipeline for audio assets.
//
// Per LOOM-AUDIO-SPEC §4.1. Two responsibilities:
//   1. fetch a URL via the Fetch API, decode the response into an
//      AudioBuffer through audioBus.ctx.decodeAudioData, and store it
//      in the AudioAssetCache under a caller-chosen name (or the URL
//      basename without extension if name omitted).
//   2. preload a manifest of {name -> URL} entries, resolving once all
//      load. Reject on the first load failure (consumer can wrap in
//      Promise.allSettled if they want partial success).
//
// Failure semantics: if fetch or decode rejects, the cache is NOT
// touched - prior values under the same name survive a failed reload.
// Inflight counter increments on fetch start and decrements after the
// decode resolves OR rejects (regardless of cache write outcome) so a
// "still loading" UI can drive off it without sticking on errors.

import type { AudioBus } from './audio-bus.js';
import type { AudioAssetCache } from './audio-asset-cache.js';

export interface AudioAssetManifest {
  // name -> URL. URLs are fetched via fetch() and decoded.
  [name: string]: string;
}

// Derive a fallback asset name from a URL. Strips the query string and
// fragment, keeps the last path segment, then drops a trailing
// extension (.mp3, .ogg, .wav, .aac, .opus, etc.). Returns the URL as-is
// if no segments or no recognizable extension boundary - the cache will
// still accept any string as a key.
function basenameFromUrl(url: string): string {
  // Strip query + hash.
  var clean = url.split('?')[0]!.split('#')[0]!;
  // Take the last path segment.
  var segments = clean.split('/');
  var last = segments[segments.length - 1] ?? clean;
  if (last.length === 0) {
    // Trailing slash; fall back to the whole stripped URL.
    return clean;
  }
  // Drop trailing extension (last dot, if any).
  var dot = last.lastIndexOf('.');
  if (dot > 0) {
    return last.substring(0, dot);
  }
  return last;
}

export class AudioAssetLoader {
  private audioBus: AudioBus;
  private cache: AudioAssetCache;
  private inflight: number = 0;

  private constructor(audioBus: AudioBus, cache: AudioAssetCache) {
    this.audioBus = audioBus;
    this.cache = cache;
  }

  static create(audioBus: AudioBus, cache: AudioAssetCache): AudioAssetLoader {
    return new AudioAssetLoader(audioBus, cache);
  }

  // Fetch + decode one URL. On success, stores the decoded AudioBuffer
  // in the cache under `name` (or basename of URL when name is omitted)
  // and returns the buffer. On failure (fetch reject, non-OK status, or
  // decode reject), the promise rejects and the cache is left untouched.
  async load(url: string, name?: string): Promise<AudioBuffer> {
    var assetName: string = name !== undefined ? name : basenameFromUrl(url);
    this.inflight++;
    try {
      var response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          'AudioAssetLoader.load: fetch failed for "' + url + '": HTTP ' +
          String(response.status),
        );
      }
      var arrayBuf = await response.arrayBuffer();
      // decodeAudioData returns a Promise in modern browsers (deprecated
      // callback signature still works but Promise is canonical).
      var buffer = await this.audioBus.ctx.decodeAudioData(arrayBuf);
      this.cache.set(assetName, buffer);
      return buffer;
    } finally {
      // Always decrement, even on failure - the inflight counter tracks
      // pending operations, not successful outcomes.
      this.inflight--;
    }
  }

  // Bulk preload. Resolves when ALL loads complete; rejects with the
  // first underlying error if any single load rejects. Manifest entries
  // run concurrently (Promise.all). Successfully-loaded entries land in
  // the cache regardless of whether siblings later failed - this matches
  // the "partial success allowed downstream" semantics of fetch+decode.
  async preload(manifest: AudioAssetManifest): Promise<void> {
    var entries = Object.keys(manifest);
    if (entries.length === 0) return;
    var loads: Array<Promise<AudioBuffer>> = [];
    for (var i = 0; i < entries.length; i++) {
      var n = entries[i]!;
      var u = manifest[n]!;
      loads.push(this.load(u, n));
    }
    await Promise.all(loads);
  }

  // Number of load() calls in flight. Useful for "X assets still
  // loading" UI; not a throttle. Increments on fetch start, decrements
  // when the inner pipeline resolves or rejects.
  inflightCount(): number {
    return this.inflight;
  }
}
