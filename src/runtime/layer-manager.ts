// LayerManager - entity layer + intra-layer z-order management.
//
// 0.41.0 enabling primitive. 0.23.0 RenderBatch ships coarse layer
// constants (BACKGROUND / TERRAIN / ENTITIES / FX / HUD); a renderer
// flushes one layer at a time. What's missing: WITHIN a layer, which
// entities render in front of which. For an ARPG hub with mob /
// player / projectile sprites all on RENDER_LAYER_ENTITIES, the
// renderer needs a stable, intentional sort key.
//
// LayerManager is a tiny registry: each entity has (layer, z) and
// the manager yields entries in (layer asc, z asc) order. Insert /
// move / remove are O(1); the sorted iteration is O(n log n) cached
// per dirty cycle so successive forEach calls without mutation are
// O(n) on the cached sort.
//
// Entities are identified by a numeric id (the engine's EntityId
// type works directly). The manager stores no entity data beyond
// (layer, z, id) - it's a sort-key index, not an entity store.
//
// Code style: var-only in browser source.

export interface LayerEntry {
  entityId: number;
  layer: number;
  z: number;
}

export interface LayerManagerOptions {
  // Initial capacity hint - the manager grows past this freely.
  initialCapacity?: number;
}

export class LayerManager {
  private byEntity: Map<number, LayerEntry> = new Map();
  // Cached sorted view of all entries. Rebuilt on next forEach when
  // dirty=true.
  private sorted: LayerEntry[] | null = null;
  private dirty: boolean = false;
  private disposed: boolean = false;

  private constructor(_opts: LayerManagerOptions) {
    // initialCapacity is currently advisory; Map auto-grows.
  }

  static create(opts: LayerManagerOptions = {}): LayerManager {
    return new LayerManager(opts);
  }

  // Insert or update an entity's (layer, z). Idempotent: re-calling
  // with the same id just updates layer / z.
  add(entityId: number, layer: number, z: number = 0): void {
    if (this.disposed) return;
    var existing = this.byEntity.get(entityId);
    if (existing) {
      existing.layer = layer;
      existing.z = z;
    } else {
      this.byEntity.set(entityId, { entityId: entityId, layer: layer, z: z });
    }
    this.dirty = true;
  }

  remove(entityId: number): boolean {
    if (this.disposed) return false;
    var existed = this.byEntity.delete(entityId);
    if (existed) this.dirty = true;
    return existed;
  }

  // Update z without changing layer. No-op if entity unknown.
  setZ(entityId: number, z: number): void {
    if (this.disposed) return;
    var entry = this.byEntity.get(entityId);
    if (!entry) return;
    if (entry.z === z) return;
    entry.z = z;
    this.dirty = true;
  }

  // Update layer without changing z. No-op if entity unknown.
  setLayer(entityId: number, layer: number): void {
    if (this.disposed) return;
    var entry = this.byEntity.get(entityId);
    if (!entry) return;
    if (entry.layer === layer) return;
    entry.layer = layer;
    this.dirty = true;
  }

  has(entityId: number): boolean {
    return this.byEntity.has(entityId);
  }

  getLayer(entityId: number): number | null {
    var entry = this.byEntity.get(entityId);
    return entry ? entry.layer : null;
  }

  getZ(entityId: number): number | null {
    var entry = this.byEntity.get(entityId);
    return entry ? entry.z : null;
  }

  count(): number {
    return this.byEntity.size;
  }

  countOnLayer(layer: number): number {
    var n = 0;
    this.byEntity.forEach(function (entry) {
      if (entry.layer === layer) n++;
    });
    return n;
  }

  // Iterate in (layer asc, z asc) order. The sort cache is reused
  // across calls until something mutates the manager.
  forEach(cb: (entry: LayerEntry) => void): void {
    if (this.disposed) return;
    var sorted = this.ensureSorted();
    for (var i = 0; i < sorted.length; i++) {
      var entry = sorted[i] as LayerEntry;
      try { cb(entry); } catch {
        // Best-effort: a misbehaving renderer never takes down the
        // manager.
      }
    }
  }

  // Iterate entities on a specific layer in z-asc order. Filters
  // the cached sort; O(n) since the sort is monotonic per layer.
  forEachOnLayer(layer: number, cb: (entry: LayerEntry) => void): void {
    if (this.disposed) return;
    var sorted = this.ensureSorted();
    for (var i = 0; i < sorted.length; i++) {
      var entry = sorted[i] as LayerEntry;
      if (entry.layer < layer) continue;
      if (entry.layer > layer) break;
      try { cb(entry); } catch { /* ignore */ }
    }
  }

  // Snapshot the current sort. Returns a fresh array; mutating it
  // does NOT affect the manager. Useful for testing + diagnostics.
  toArray(): LayerEntry[] {
    if (this.disposed) return [];
    var sorted = this.ensureSorted();
    var out: LayerEntry[] = [];
    for (var i = 0; i < sorted.length; i++) {
      var e = sorted[i] as LayerEntry;
      out.push({ entityId: e.entityId, layer: e.layer, z: e.z });
    }
    return out;
  }

  clear(): void {
    if (this.disposed) return;
    this.byEntity.clear();
    this.sorted = null;
    this.dirty = false;
  }

  dispose(): void {
    this.byEntity.clear();
    this.sorted = null;
    this.dirty = false;
    this.disposed = true;
  }

  // ---------- private ----------

  private ensureSorted(): LayerEntry[] {
    if (this.sorted !== null && !this.dirty) return this.sorted;
    var arr: LayerEntry[] = [];
    this.byEntity.forEach(function (entry) { arr.push(entry); });
    arr.sort(function (a, b) {
      if (a.layer !== b.layer) return a.layer - b.layer;
      if (a.z !== b.z) return a.z - b.z;
      // Stable tie-break by entityId so two entries with same
      // (layer, z) render in a predictable order across runs.
      return a.entityId - b.entityId;
    });
    this.sorted = arr;
    this.dirty = false;
    return arr;
  }
}

// Resource key for the world's resource registry. Engine consumers
// register a LayerManager instance under this key for the renderer
// to read each frame.
export const RESOURCE_LAYER_MANAGER = 'layer_manager';
