// PathfindingCache - memoization layer for A* path queries.
//
// 1.2.0 enabling primitive (Wave 1.2 world / economy depth opens).
// Pathfinder (0.55) does the actual A* search. PathfindingCache
// is the layer above: 50 mobs all pathing to the player every tick
// is 50 A* invocations per second. Most of those searches share
// the same start cell (mob group clumping) or the same goal cell
// (one player). Cache them.
//
//   var cache = PathfindingCache.create({ capacity: 256, ttlMs: 2000 });
//
//   // Each frame, for each AI agent:
//   var path = cache.getOrCompute(mob.x, mob.y, player.x, player.y, () => {
//     return findPath(mob.x, mob.y, player.x, player.y, isWalkable);
//   });
//
//   // Terrain changed (door opened, wall blown up):
//   cache.bumpGridVersion();
//
//   // Or smart-invalidate: only drop entries crossing a specific cell.
//   cache.invalidateAt(brokenWallX, brokenWallY);
//
// Pairs with Pathfinder (0.55, the A* function), Quadtree (0.81,
// spatial queries that often FEED pathfinding goals), TileMap (0.56).
//
// Code style: var-only in browser source.

export interface CachedPathPoint {
  x: number;
  y: number;
}

export interface CachedPathResult {
  // The path as a sequence of cells. null = unreachable result was
  // cached (so we don't keep retrying the same impossible search).
  path: CachedPathPoint[] | null;
  cost: number;
  nodesExpanded: number;
}

export interface CacheEntry {
  result: CachedPathResult;
  // Wall-clock ms (per the consumer's tick clock) when this entry
  // was inserted.
  insertedAtMs: number;
  // ms since insertion, advanced via tick().
  ageMs: number;
  hitCount: number;
}

export interface PathfindingCacheOptions {
  // Max entries. LRU evict on overflow. Default 128.
  capacity?: number;
  // ms TTL. 0 = no TTL. Default 0.
  ttlMs?: number;
  // Initial grid version. Bumped on bumpGridVersion(). Default 0.
  gridVersion?: number;
}

const DEFAULT_CAPACITY = 128;

interface InternalEntry {
  key: string;
  result: CachedPathResult;
  insertedAtMs: number;
  ageMs: number;
  hitCount: number;
  gridVersion: number;
  // For LRU: incremented on every access; map ordering by lastAccessTick.
  lastAccessTick: number;
}

function makeKey(sx: number, sy: number, gx: number, gy: number): string {
  return Math.floor(sx) + ',' + Math.floor(sy) + '->' + Math.floor(gx) + ',' + Math.floor(gy);
}

export class PathfindingCache {
  private entries: Map<string, InternalEntry> = new Map();
  private capacity: number;
  private ttlMs: number;
  private gridVersion: number;
  private elapsedMs: number = 0;
  private accessTick: number = 0;
  private hitCount: number = 0;
  private missCount: number = 0;
  private disposed: boolean = false;

  private constructor(opts: PathfindingCacheOptions) {
    this.capacity = opts.capacity !== undefined && opts.capacity > 0
      ? Math.floor(opts.capacity) : DEFAULT_CAPACITY;
    this.ttlMs = opts.ttlMs !== undefined && isFinite(opts.ttlMs)
        && opts.ttlMs > 0 ? Math.floor(opts.ttlMs) : 0;
    this.gridVersion = opts.gridVersion !== undefined
        && isFinite(opts.gridVersion) ? Math.floor(opts.gridVersion) : 0;
  }

  static create(opts: PathfindingCacheOptions = {}): PathfindingCache {
    return new PathfindingCache(opts);
  }

  // Look up a cached path. Returns the cached result, or undefined
  // on miss / stale (version mismatch).
  get(startX: number, startY: number, goalX: number, goalY: number): CachedPathResult | undefined {
    if (this.disposed) return undefined;
    if (!isFinite(startX) || !isFinite(startY) || !isFinite(goalX) || !isFinite(goalY)) {
      return undefined;
    }
    var key = makeKey(startX, startY, goalX, goalY);
    var entry = this.entries.get(key);
    if (!entry) {
      this.missCount++;
      return undefined;
    }
    if (entry.gridVersion !== this.gridVersion) {
      this.entries.delete(key);
      this.missCount++;
      return undefined;
    }
    entry.hitCount++;
    entry.lastAccessTick = ++this.accessTick;
    this.hitCount++;
    return entry.result;
  }

  // Insert / replace a cached path.
  set(startX: number, startY: number, goalX: number, goalY: number,
      result: CachedPathResult): void {
    if (this.disposed) return;
    if (!isFinite(startX) || !isFinite(startY) || !isFinite(goalX) || !isFinite(goalY)) {
      return;
    }
    var key = makeKey(startX, startY, goalX, goalY);
    if (!this.entries.has(key) && this.entries.size >= this.capacity) {
      this.evictLRU();
    }
    this.entries.set(key, {
      key: key,
      result: result,
      insertedAtMs: this.elapsedMs,
      ageMs: 0,
      hitCount: 0,
      gridVersion: this.gridVersion,
      lastAccessTick: ++this.accessTick,
    });
  }

  // Get or compute. computeFn is invoked only on cache miss; its
  // return value is cached. Throwing computeFn returns null and
  // does NOT cache.
  getOrCompute(startX: number, startY: number, goalX: number, goalY: number,
               computeFn: () => CachedPathResult): CachedPathResult | null {
    if (this.disposed) return null;
    var hit = this.get(startX, startY, goalX, goalY);
    if (hit !== undefined) return hit;
    var result: CachedPathResult;
    try { result = computeFn(); } catch { return null; }
    if (!result) return null;
    this.set(startX, startY, goalX, goalY, result);
    return result;
  }

  // Bump the grid version. Existing entries become stale on next
  // get (lazy invalidation; entries are dropped only when looked up).
  // For eager invalidation, follow with invalidateAll() or wait for
  // tick() to GC.
  bumpGridVersion(): number {
    if (this.disposed) return this.gridVersion;
    this.gridVersion++;
    return this.gridVersion;
  }

  // Drop every cached entry.
  invalidateAll(): number {
    if (this.disposed) return 0;
    var n = this.entries.size;
    this.entries.clear();
    return n;
  }

  // Drop entries whose path crosses (x, y). Useful when a single
  // tile becomes blocked (door closed) without a full grid version
  // bump. Returns the number of entries removed.
  invalidateAt(x: number, y: number): number {
    if (this.disposed) return 0;
    if (!isFinite(x) || !isFinite(y)) return 0;
    var fx = Math.floor(x);
    var fy = Math.floor(y);
    var toRemove: string[] = [];
    var values = this.entries.values();
    var v = values.next();
    while (!v.done) {
      var e = v.value;
      var path = e.result.path;
      if (path) {
        for (var i = 0; i < path.length; i++) {
          var p = path[i] as CachedPathPoint;
          if (p.x === fx && p.y === fy) {
            toRemove.push(e.key);
            break;
          }
        }
      }
      v = values.next();
    }
    for (var k = 0; k < toRemove.length; k++) {
      this.entries.delete(toRemove[k] as string);
    }
    return toRemove.length;
  }

  // Drop entries with a given start cell (e.g. when a single agent
  // moves and you want to forget its old paths).
  invalidateBySource(x: number, y: number): number {
    if (this.disposed) return 0;
    var fx = Math.floor(x);
    var fy = Math.floor(y);
    var prefix = fx + ',' + fy + '->';
    var toRemove: string[] = [];
    var keys = this.entries.keys();
    var k = keys.next();
    while (!k.done) {
      if (k.value.indexOf(prefix) === 0) toRemove.push(k.value);
      k = keys.next();
    }
    for (var i = 0; i < toRemove.length; i++) {
      this.entries.delete(toRemove[i] as string);
    }
    return toRemove.length;
  }

  // Drop entries with a given goal cell.
  invalidateByGoal(x: number, y: number): number {
    if (this.disposed) return 0;
    var fx = Math.floor(x);
    var fy = Math.floor(y);
    var suffix = '->' + fx + ',' + fy;
    var toRemove: string[] = [];
    var keys = this.entries.keys();
    var k = keys.next();
    while (!k.done) {
      var key = k.value;
      if (key.length >= suffix.length
          && key.substring(key.length - suffix.length) === suffix) {
        toRemove.push(key);
      }
      k = keys.next();
    }
    for (var i = 0; i < toRemove.length; i++) {
      this.entries.delete(toRemove[i] as string);
    }
    return toRemove.length;
  }

  size(): number { return this.entries.size; }

  hits(): number { return this.hitCount; }
  misses(): number { return this.missCount; }

  hitRate(): number {
    var total = this.hitCount + this.missCount;
    return total > 0 ? this.hitCount / total : 0;
  }

  getGridVersion(): number { return this.gridVersion; }

  // Reset hit / miss counters without clearing entries.
  resetStats(): void {
    this.hitCount = 0;
    this.missCount = 0;
  }

  // Advance internal clock; expire entries past TTL if configured.
  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    this.elapsedMs += dt;
    if (this.ttlMs <= 0) return;
    var toRemove: string[] = [];
    var values = this.entries.values();
    var v = values.next();
    while (!v.done) {
      var e = v.value;
      e.ageMs += dt;
      if (e.ageMs >= this.ttlMs) toRemove.push(e.key);
      v = values.next();
    }
    for (var i = 0; i < toRemove.length; i++) {
      this.entries.delete(toRemove[i] as string);
    }
  }

  dispose(): void {
    this.entries.clear();
    this.disposed = true;
  }

  // ---------- private ----------

  private evictLRU(): void {
    if (this.entries.size === 0) return;
    var oldestKey: string | null = null;
    var oldestTick = Infinity;
    var values = this.entries.values();
    var v = values.next();
    while (!v.done) {
      var e = v.value;
      if (e.lastAccessTick < oldestTick) {
        oldestTick = e.lastAccessTick;
        oldestKey = e.key;
      }
      v = values.next();
    }
    if (oldestKey !== null) this.entries.delete(oldestKey);
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_PATHFINDING_CACHE = 'pathfinding_cache';
