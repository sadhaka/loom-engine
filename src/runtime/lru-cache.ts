// LRUCache - generic least-recently-used cache.
//
// 0.53.0 enabling primitive. Decoded sprite atlases, expensive
// computation memos, last-N tile chunks, plugin-context lookups -
// all share the "keep up to N hot entries; evict the one I haven't
// touched recently" pattern. The standard JS Map is FIFO (insertion
// order); LRUCache adds the access-order semantics.
//
// Implementation: backed by a Map. On get(), the entry is deleted
// and re-inserted to move it to the end (most-recently-used). On
// set() over capacity, the iterator's first entry (oldest) is
// evicted.
//
// Code style: var-only in browser source.

export interface LRUCacheOptions<V> {
  // Cap on retained entries. Defaults to 128. Must be > 0.
  capacity?: number;
  // Optional callback fired when a key is evicted (capacity hit).
  // Receives (key, value). Throwing isolated. Useful for cleanup
  // hooks (e.g. release the GPU texture).
  onEvict?: (key: string, value: V) => void;
}

const DEFAULT_CAPACITY = 128;

export class LRUCache<V = unknown> {
  private map: Map<string, V> = new Map();
  private capacityNum: number;
  private onEvict: ((key: string, value: V) => void) | null;
  private hitCount: number = 0;
  private missCount: number = 0;
  private evictionCount: number = 0;
  private disposed: boolean = false;

  private constructor(opts: LRUCacheOptions<V>) {
    this.capacityNum = opts.capacity !== undefined && opts.capacity > 0
      ? Math.floor(opts.capacity) : DEFAULT_CAPACITY;
    this.onEvict = opts.onEvict ?? null;
  }

  static create<V = unknown>(opts: LRUCacheOptions<V> = {}): LRUCache<V> {
    return new LRUCache<V>(opts);
  }

  // Read a key. On hit, marks it as most-recently-used. Returns
  // undefined on miss.
  get(key: string): V | undefined {
    if (this.disposed) return undefined;
    if (!this.map.has(key)) {
      this.missCount++;
      return undefined;
    }
    var v = this.map.get(key) as V;
    // Move to end of insertion order (most-recently-used).
    this.map.delete(key);
    this.map.set(key, v);
    this.hitCount++;
    return v;
  }

  // Write a key. If capacity is exceeded, evicts the least-recently-
  // used entry (first in iteration order). Returns the evicted
  // entry on overflow, undefined otherwise.
  set(key: string, value: V): { key: string; value: V } | undefined {
    if (this.disposed) return undefined;
    if (this.map.has(key)) {
      // Update in place + move to end.
      this.map.delete(key);
      this.map.set(key, value);
      return undefined;
    }
    var evicted: { key: string; value: V } | undefined;
    if (this.map.size >= this.capacityNum) {
      // Evict oldest (first key in iteration order).
      var firstKey = this.map.keys().next().value as string | undefined;
      if (firstKey !== undefined) {
        var firstVal = this.map.get(firstKey) as V;
        this.map.delete(firstKey);
        this.evictionCount++;
        evicted = { key: firstKey, value: firstVal };
        if (this.onEvict) {
          try { this.onEvict(firstKey, firstVal); } catch {
            // Best-effort.
          }
        }
      }
    }
    this.map.set(key, value);
    return evicted;
  }

  // Read WITHOUT touching access order. Useful for diagnostics or
  // for "is this still cached?" checks that should not influence
  // eviction.
  peek(key: string): V | undefined {
    if (this.disposed) return undefined;
    return this.map.get(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  // Drop a key. Returns true if removed; false if absent. Does NOT
  // fire onEvict (that's reserved for capacity-driven eviction).
  delete(key: string): boolean {
    if (this.disposed) return false;
    return this.map.delete(key);
  }

  // Drop every entry. Does NOT fire onEvict.
  clear(): void {
    if (this.disposed) return;
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }

  capacity(): number {
    return this.capacityNum;
  }

  // Resize the cap. If the new cap is smaller than current size,
  // the oldest entries are evicted (firing onEvict for each).
  setCapacity(newCapacity: number): void {
    if (this.disposed) return;
    if (newCapacity <= 0) return;
    this.capacityNum = Math.floor(newCapacity);
    while (this.map.size > this.capacityNum) {
      var firstKey = this.map.keys().next().value as string | undefined;
      if (firstKey === undefined) break;
      var firstVal = this.map.get(firstKey) as V;
      this.map.delete(firstKey);
      this.evictionCount++;
      if (this.onEvict) {
        try { this.onEvict(firstKey, firstVal); } catch { /* ignore */ }
      }
    }
  }

  // Keys in eviction order (oldest first).
  keys(): string[] {
    return Array.from(this.map.keys());
  }

  // Values in eviction order (oldest first).
  values(): V[] {
    return Array.from(this.map.values());
  }

  // Diagnostics.
  stats(): { size: number; capacity: number; hits: number; misses: number; evictions: number } {
    return {
      size: this.map.size,
      capacity: this.capacityNum,
      hits: this.hitCount,
      misses: this.missCount,
      evictions: this.evictionCount,
    };
  }

  dispose(): void {
    this.map.clear();
    this.onEvict = null;
    this.disposed = true;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_LRU_CACHE = 'lru_cache';
