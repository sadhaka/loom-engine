// QueryCache - memoize ComponentSignature queries.
//
// 0.22.0 enabling primitive. A system that calls
// `cache.query(MASK_TRANSFORM_SPRITE)` more than once per
// (signature.version, mask) pair gets the cached Int32Array back
// instead of re-scanning. The signature's version counter is the
// invalidation trigger - any setBit / clearBit / clearEntity bumps
// it, making every cached entry stale on the next read.
//
// Storage is a Map<mask, {version, indices}>. Cap on entries
// (default 64) prevents long-running games from accumulating an
// unbounded set of one-off queries; eviction is FIFO.

import { ComponentSignature } from './component-signature.js';

interface CacheEntry {
  version: number;
  indices: Int32Array;
}

export class QueryCache {
  private readonly signature: ComponentSignature;
  private readonly cache: Map<number, CacheEntry> = new Map();
  private readonly maxEntries: number;
  // Hits + misses for diagnostic / test assertions.
  private hits: number = 0;
  private misses: number = 0;

  constructor(signature: ComponentSignature, maxEntries: number = 64) {
    this.signature = signature;
    this.maxEntries = Math.max(1, maxEntries | 0);
  }

  // Return entity indices matching `mask`. Cached until the
  // underlying signature's version changes.
  query(mask: number): Int32Array {
    var m = mask >>> 0;
    var ver = this.signature.version();
    var entry = this.cache.get(m);
    if (entry && entry.version === ver) {
      this.hits++;
      return entry.indices;
    }
    this.misses++;
    // FIFO eviction at max capacity. Map preserves insertion order.
    if (this.cache.size >= this.maxEntries) {
      var oldestKey = this.cache.keys().next().value;
      if (typeof oldestKey === 'number') {
        this.cache.delete(oldestKey);
      }
    }
    var matches = this.signature.collectMatching(m);
    this.cache.set(m, { version: ver, indices: matches });
    return matches;
  }

  // Force-clear the cache (test affordance + for explicit lifecycle
  // control if a consumer wants to rebuild from scratch).
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  // Diagnostic counters.
  stats(): { hits: number; misses: number; entries: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.cache.size,
    };
  }
}

// Resource key for the world-attached cache.
export const RESOURCE_QUERY_CACHE = 'loom.query_cache';
