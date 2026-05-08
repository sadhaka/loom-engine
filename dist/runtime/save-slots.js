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
const DEFAULT_PREFIX = 'slots/';
const DEFAULT_THUMB_CAP = 262144;
export class SaveSlots {
    storage;
    prefix;
    maxThumbBytes;
    disposed = false;
    constructor(opts) {
        this.storage = opts.storage;
        this.prefix = opts.prefix ?? DEFAULT_PREFIX;
        this.maxThumbBytes = opts.maxThumbnailBytes !== undefined && opts.maxThumbnailBytes > 0
            ? opts.maxThumbnailBytes : DEFAULT_THUMB_CAP;
    }
    static create(opts) {
        return new SaveSlots(opts);
    }
    // Save (or overwrite) a slot. The snapshot's engineVersion stamp
    // is captured into the metadata; the timestamp is captured at
    // call time (Date.now). Returns the resulting metadata.
    async save(id, input, nowFn) {
        if (this.disposed)
            throw new Error('SaveSlots disposed');
        if (typeof id !== 'string' || id.length === 0) {
            throw new Error('SaveSlots.save: id must be a non-empty string');
        }
        if (!input || !input.snapshot) {
            throw new Error('SaveSlots.save: snapshot is required');
        }
        var now = nowFn ? nowFn() : Date.now();
        var meta = {
            id: id,
            savedAtMs: now,
            engineVersion: input.snapshot.engineVersion ?? '',
        };
        if (input.label !== undefined)
            meta.label = input.label;
        if (input.thumbnailDataUrl !== undefined) {
            var thumb = input.thumbnailDataUrl;
            if (typeof thumb === 'string' && this.byteLengthOf(thumb) <= this.maxThumbBytes) {
                meta.thumbnailDataUrl = thumb;
            }
            // else: silently drop (consumer keeps responsibility for the
            // image source if it wants to retry).
        }
        if (input.playtimeSeconds !== undefined)
            meta.playtimeSeconds = input.playtimeSeconds;
        if (input.userMeta !== undefined)
            meta.userMeta = input.userMeta;
        var env = { meta: meta, snapshot: input.snapshot };
        await this.storage.save(this.k(id), env);
        return meta;
    }
    // Load a slot. Returns null if the slot doesn't exist or its
    // payload doesn't match the slot envelope shape.
    async load(id) {
        if (this.disposed)
            return null;
        if (typeof id !== 'string' || id.length === 0)
            return null;
        var raw = await this.storage.load(this.k(id));
        return this.parseEnvelope(raw, id);
    }
    // Read the metadata WITHOUT decoding the full snapshot. Useful
    // for save-game UIs that show every slot's preview/metadata.
    async loadMeta(id) {
        if (this.disposed)
            return null;
        var loaded = await this.load(id);
        return loaded ? loaded.meta : null;
    }
    async delete(id) {
        if (this.disposed)
            return false;
        if (typeof id !== 'string' || id.length === 0)
            return false;
        var existed = await this.storage.hasKey(this.k(id));
        await this.storage.remove(this.k(id));
        return existed;
    }
    async has(id) {
        if (this.disposed)
            return false;
        return this.storage.hasKey(this.k(id));
    }
    // Enumerate every slot id that has data. Order is backend-defined;
    // sort downstream if needed.
    async listIds() {
        if (this.disposed)
            return [];
        var allKeys = await this.storage.listKeys();
        var out = [];
        for (var i = 0; i < allKeys.length; i++) {
            var k = allKeys[i];
            if (k.indexOf(this.prefix) === 0) {
                out.push(k.substring(this.prefix.length));
            }
        }
        return out;
    }
    // Enumerate all slots with their metadata. Sorted by savedAtMs
    // descending (most-recent first); pass 'name' to sort by id asc.
    async listAll(sortBy = 'recent') {
        if (this.disposed)
            return [];
        var ids = await this.listIds();
        var metas = [];
        for (var i = 0; i < ids.length; i++) {
            var meta = await this.loadMeta(ids[i]);
            if (meta)
                metas.push(meta);
        }
        if (sortBy === 'name') {
            metas.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        }
        else {
            metas.sort((a, b) => b.savedAtMs - a.savedAtMs);
        }
        return metas;
    }
    // Rename a slot (id -> newId). The metadata.id is updated to the
    // new id; savedAtMs and engineVersion are preserved. Returns true
    // on success; false if source doesn't exist or destination already
    // exists (no overwrite).
    async rename(id, newId) {
        if (this.disposed)
            return false;
        if (typeof newId !== 'string' || newId.length === 0)
            return false;
        if (id === newId)
            return true;
        var loaded = await this.load(id);
        if (!loaded)
            return false;
        if (await this.has(newId))
            return false;
        var meta = loaded.meta;
        meta.id = newId;
        var env = { meta: meta, snapshot: loaded.snapshot };
        await this.storage.save(this.k(newId), env);
        await this.storage.remove(this.k(id));
        return true;
    }
    // Duplicate a slot. Source must exist; destination must not exist.
    // The new slot's savedAtMs is updated to now (or supplied nowFn).
    async duplicate(id, newId, nowFn) {
        if (this.disposed)
            return false;
        if (typeof newId !== 'string' || newId.length === 0)
            return false;
        if (id === newId)
            return false;
        var loaded = await this.load(id);
        if (!loaded)
            return false;
        if (await this.has(newId))
            return false;
        var now = nowFn ? nowFn() : Date.now();
        var meta = {
            id: newId,
            savedAtMs: now,
            engineVersion: loaded.meta.engineVersion,
        };
        if (loaded.meta.label !== undefined)
            meta.label = loaded.meta.label;
        if (loaded.meta.thumbnailDataUrl !== undefined)
            meta.thumbnailDataUrl = loaded.meta.thumbnailDataUrl;
        if (loaded.meta.playtimeSeconds !== undefined)
            meta.playtimeSeconds = loaded.meta.playtimeSeconds;
        if (loaded.meta.userMeta !== undefined)
            meta.userMeta = loaded.meta.userMeta;
        var env = { meta: meta, snapshot: loaded.snapshot };
        await this.storage.save(this.k(newId), env);
        return true;
    }
    // Delete every slot. Foreign keys outside the slots prefix are
    // untouched.
    async clearAll() {
        if (this.disposed)
            return;
        var ids = await this.listIds();
        for (var i = 0; i < ids.length; i++) {
            await this.storage.remove(this.k(ids[i]));
        }
    }
    dispose() {
        this.disposed = true;
    }
    // ---------- private ----------
    k(id) {
        return this.prefix + id;
    }
    byteLengthOf(s) {
        // Approximate UTF-8 byte length. Roughly 1 byte per ASCII char,
        // 2-3 for multibyte. JSON-encoded thumbnails are typically ASCII
        // (base64) so this is conservative.
        if (typeof TextEncoder !== 'undefined') {
            try {
                return new TextEncoder().encode(s).length;
            }
            catch { /* fallthrough */ }
        }
        return s.length;
    }
    parseEnvelope(raw, id) {
        if (!raw || typeof raw !== 'object')
            return null;
        var env = raw;
        if (!env.meta || !env.snapshot)
            return null;
        if (typeof env.meta !== 'object' || typeof env.snapshot !== 'object')
            return null;
        var meta = env.meta;
        if (typeof meta.savedAtMs !== 'number' || typeof meta.engineVersion !== 'string')
            return null;
        var snap = env.snapshot;
        if (typeof snap.schemaVersion !== 'number' || typeof snap.engineVersion !== 'string')
            return null;
        if (typeof snap.capturedAtMs !== 'number')
            return null;
        if (!snap.resources || typeof snap.resources !== 'object')
            return null;
        // Patch the meta.id with the actual key in case storage was
        // copied from another slot id manually.
        meta.id = id;
        return { meta: meta, snapshot: snap };
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_SAVE_SLOTS = 'save_slots';
//# sourceMappingURL=save-slots.js.map