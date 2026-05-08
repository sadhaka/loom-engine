// SaveSlots - multi-slot save manager.
//
// 0.45.0 enabling primitive. PersistentStorage (0.38.0) provides a
// JSON-safe key/value backend; WorldSnapshot (0.26.0) produces a
// versioned envelope of every persistable resource. Most games want
// one more layer on top: NAMED slots ('autosave', 'quicksave',
// 'manual-1' ... 'manual-9') with metadata (slot label, timestamp,
// engine version, optional thumbnail data URL, optional play time)
// alongside the snapshot itself.
//
// SaveSlots is that wrapper. It owns no persistence directly - it
// composes a PersistentStorage instance and adds:
//
//   - Named slot enumeration with metadata.
//   - Auto-saved timestamp, engine version, optional player-supplied
//     label / thumbnail / playtime / arbitrary user data.
//   - List + sort by recency / by name.
//   - Delete + rename + duplicate.
//
// The WorldSnapshot envelope is stored under a derived key, so
// reading from raw PersistentStorage with key='slot.<id>.snap' still
// works (no opaque format).
//
// Code style: var-only in browser source.

import type { PersistentStorage } from './persistent-storage.js';
import type { WorldSnapshot } from './world-snapshot.js';

export interface SlotMetadata {
  // Slot id (the key consumers use to address it). Stable across
  // sessions; e.g. 'autosave', 'quicksave', 'manual-3'.
  id: string;
  // Human-readable label. Optional; defaults to the slot id.
  label?: string;
  // ms since epoch when the slot was last saved.
  savedAtMs: number;
  // Engine version that produced this slot; useful for migration
  // decisions on load.
  engineVersion: string;
  // Optional thumbnail data URL (a small JPEG / PNG snapshot of the
  // game state when saved). Capped at 256kB by default.
  thumbnailDataUrl?: string;
  // Optional accumulated playtime in seconds.
  playtimeSeconds?: number;
  // Arbitrary user-supplied JSON-safe metadata (level name, hero
  // class, last zone, etc.).
  userMeta?: Record<string, unknown>;
}

export interface SaveSlotsOptions {
  // Required: backing PersistentStorage instance. SaveSlots does
  // NOT create or own this; consumer manages its lifecycle.
  storage: PersistentStorage;
  // Optional namespace prefix for slot keys inside the storage.
  // The PersistentStorage may already have a namespace; this stacks
  // on top. Default 'slots/'.
  prefix?: string;
  // Cap on thumbnail data URL size in bytes. Defaults to 262144 (256kB).
  // Setting a thumbnail above the cap silently drops the thumbnail
  // (the slot still saves; metadata.thumbnailDataUrl is omitted).
  maxThumbnailBytes?: number;
}

export interface SaveSlotInput {
  // The world snapshot to persist. Required.
  snapshot: WorldSnapshot;
  // Optional human-readable label.
  label?: string;
  // Optional thumbnail data URL (e.g. canvas.toDataURL).
  thumbnailDataUrl?: string;
  // Optional playtime accumulator.
  playtimeSeconds?: number;
  // Optional user metadata (level / class / zone).
  userMeta?: Record<string, unknown>;
}

export interface LoadedSlot {
  meta: SlotMetadata;
  snapshot: WorldSnapshot;
}

const DEFAULT_PREFIX = 'slots/';
const DEFAULT_THUMB_CAP = 262144;

interface PersistedSlotEnvelope {
  meta: SlotMetadata;
  snapshot: WorldSnapshot;
}

export class SaveSlots {
  private storage: PersistentStorage;
  private prefix: string;
  private maxThumbBytes: number;
  private disposed: boolean = false;

  private constructor(opts: SaveSlotsOptions) {
    this.storage = opts.storage;
    this.prefix = opts.prefix ?? DEFAULT_PREFIX;
    this.maxThumbBytes = opts.maxThumbnailBytes !== undefined && opts.maxThumbnailBytes > 0
      ? opts.maxThumbnailBytes : DEFAULT_THUMB_CAP;
  }

  static create(opts: SaveSlotsOptions): SaveSlots {
    return new SaveSlots(opts);
  }

  // Save (or overwrite) a slot. The snapshot's engineVersion stamp
  // is captured into the metadata; the timestamp is captured at
  // call time (Date.now). Returns the resulting metadata.
  async save(id: string, input: SaveSlotInput, nowFn?: () => number): Promise<SlotMetadata> {
    if (this.disposed) throw new Error('SaveSlots disposed');
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('SaveSlots.save: id must be a non-empty string');
    }
    if (!input || !input.snapshot) {
      throw new Error('SaveSlots.save: snapshot is required');
    }
    var now = nowFn ? nowFn() : Date.now();
    var meta: SlotMetadata = {
      id: id,
      savedAtMs: now,
      engineVersion: input.snapshot.engineVersion ?? '',
    };
    if (input.label !== undefined) meta.label = input.label;
    if (input.thumbnailDataUrl !== undefined) {
      var thumb = input.thumbnailDataUrl;
      if (typeof thumb === 'string' && this.byteLengthOf(thumb) <= this.maxThumbBytes) {
        meta.thumbnailDataUrl = thumb;
      }
      // else: silently drop (consumer keeps responsibility for the
      // image source if it wants to retry).
    }
    if (input.playtimeSeconds !== undefined) meta.playtimeSeconds = input.playtimeSeconds;
    if (input.userMeta !== undefined) meta.userMeta = input.userMeta;
    var env: PersistedSlotEnvelope = { meta: meta, snapshot: input.snapshot };
    await this.storage.save(this.k(id), env);
    return meta;
  }

  // Load a slot. Returns null if the slot doesn't exist or its
  // payload doesn't match the slot envelope shape.
  async load(id: string): Promise<LoadedSlot | null> {
    if (this.disposed) return null;
    if (typeof id !== 'string' || id.length === 0) return null;
    var raw = await this.storage.load(this.k(id));
    return this.parseEnvelope(raw, id);
  }

  // Read the metadata WITHOUT decoding the full snapshot. Useful
  // for save-game UIs that show every slot's preview/metadata.
  async loadMeta(id: string): Promise<SlotMetadata | null> {
    if (this.disposed) return null;
    var loaded = await this.load(id);
    return loaded ? loaded.meta : null;
  }

  async delete(id: string): Promise<boolean> {
    if (this.disposed) return false;
    if (typeof id !== 'string' || id.length === 0) return false;
    var existed = await this.storage.hasKey(this.k(id));
    await this.storage.remove(this.k(id));
    return existed;
  }

  async has(id: string): Promise<boolean> {
    if (this.disposed) return false;
    return this.storage.hasKey(this.k(id));
  }

  // Enumerate every slot id that has data. Order is backend-defined;
  // sort downstream if needed.
  async listIds(): Promise<string[]> {
    if (this.disposed) return [];
    var allKeys = await this.storage.listKeys();
    var out: string[] = [];
    for (var i = 0; i < allKeys.length; i++) {
      var k = allKeys[i] as string;
      if (k.indexOf(this.prefix) === 0) {
        out.push(k.substring(this.prefix.length));
      }
    }
    return out;
  }

  // Enumerate all slots with their metadata. Sorted by savedAtMs
  // descending (most-recent first); pass 'name' to sort by id asc.
  async listAll(sortBy: 'recent' | 'name' = 'recent'): Promise<SlotMetadata[]> {
    if (this.disposed) return [];
    var ids = await this.listIds();
    var metas: SlotMetadata[] = [];
    for (var i = 0; i < ids.length; i++) {
      var meta = await this.loadMeta(ids[i] as string);
      if (meta) metas.push(meta);
    }
    if (sortBy === 'name') {
      metas.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    } else {
      metas.sort((a, b) => b.savedAtMs - a.savedAtMs);
    }
    return metas;
  }

  // Rename a slot (id -> newId). The metadata.id is updated to the
  // new id; savedAtMs and engineVersion are preserved. Returns true
  // on success; false if source doesn't exist or destination already
  // exists (no overwrite).
  async rename(id: string, newId: string): Promise<boolean> {
    if (this.disposed) return false;
    if (typeof newId !== 'string' || newId.length === 0) return false;
    if (id === newId) return true;
    var loaded = await this.load(id);
    if (!loaded) return false;
    if (await this.has(newId)) return false;
    var meta = loaded.meta;
    meta.id = newId;
    var env: PersistedSlotEnvelope = { meta: meta, snapshot: loaded.snapshot };
    await this.storage.save(this.k(newId), env);
    await this.storage.remove(this.k(id));
    return true;
  }

  // Duplicate a slot. Source must exist; destination must not exist.
  // The new slot's savedAtMs is updated to now (or supplied nowFn).
  async duplicate(id: string, newId: string, nowFn?: () => number): Promise<boolean> {
    if (this.disposed) return false;
    if (typeof newId !== 'string' || newId.length === 0) return false;
    if (id === newId) return false;
    var loaded = await this.load(id);
    if (!loaded) return false;
    if (await this.has(newId)) return false;
    var now = nowFn ? nowFn() : Date.now();
    var meta: SlotMetadata = {
      id: newId,
      savedAtMs: now,
      engineVersion: loaded.meta.engineVersion,
    };
    if (loaded.meta.label !== undefined) meta.label = loaded.meta.label;
    if (loaded.meta.thumbnailDataUrl !== undefined) meta.thumbnailDataUrl = loaded.meta.thumbnailDataUrl;
    if (loaded.meta.playtimeSeconds !== undefined) meta.playtimeSeconds = loaded.meta.playtimeSeconds;
    if (loaded.meta.userMeta !== undefined) meta.userMeta = loaded.meta.userMeta;
    var env: PersistedSlotEnvelope = { meta: meta, snapshot: loaded.snapshot };
    await this.storage.save(this.k(newId), env);
    return true;
  }

  // Delete every slot. Foreign keys outside the slots prefix are
  // untouched.
  async clearAll(): Promise<void> {
    if (this.disposed) return;
    var ids = await this.listIds();
    for (var i = 0; i < ids.length; i++) {
      await this.storage.remove(this.k(ids[i] as string));
    }
  }

  dispose(): void {
    this.disposed = true;
  }

  // ---------- private ----------

  private k(id: string): string {
    return this.prefix + id;
  }

  private byteLengthOf(s: string): number {
    // Approximate UTF-8 byte length. Roughly 1 byte per ASCII char,
    // 2-3 for multibyte. JSON-encoded thumbnails are typically ASCII
    // (base64) so this is conservative.
    if (typeof TextEncoder !== 'undefined') {
      try { return new TextEncoder().encode(s).length; } catch { /* fallthrough */ }
    }
    return s.length;
  }

  private parseEnvelope(raw: unknown, id: string): LoadedSlot | null {
    if (!raw || typeof raw !== 'object') return null;
    var env = raw as Partial<PersistedSlotEnvelope>;
    if (!env.meta || !env.snapshot) return null;
    if (typeof env.meta !== 'object' || typeof env.snapshot !== 'object') return null;
    var meta = env.meta as Partial<SlotMetadata>;
    if (typeof meta.savedAtMs !== 'number' || typeof meta.engineVersion !== 'string') return null;
    var snap = env.snapshot as Partial<WorldSnapshot>;
    if (typeof snap.schemaVersion !== 'number' || typeof snap.engineVersion !== 'string') return null;
    if (typeof snap.capturedAtMs !== 'number') return null;
    if (!snap.resources || typeof snap.resources !== 'object') return null;
    // Patch the meta.id with the actual key in case storage was
    // copied from another slot id manually.
    meta.id = id;
    return { meta: meta as SlotMetadata, snapshot: snap as WorldSnapshot };
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_SAVE_SLOTS = 'save_slots';
