// PersistentStorage - browser/SSR-safe key/value adapter for engine state.
//
// 0.38.0 enabling primitive. WorldSnapshot (0.26.0) produces an
// IPersistableResource envelope; PersistentStorage gives consumers
// a place to put it. Three pieces:
//
//   - IStorageBackend: minimal async key/value contract.
//   - Concrete backends: MemoryStorageBackend (tests / SSR /
//     fallback) and LocalStorageBackend (browser window.localStorage,
//     wrapped in promises so the same code runs against either).
//   - PersistentStorage facade: namespacing, JSON-safe save / load,
//     typed WorldSnapshot helpers (saveSnapshot / loadSnapshot).
//
// Why async-only: IndexedDB (the natural next backend) is async by
// nature and Promise.resolve()-wrapping a sync localStorage call is
// cheap. One API for all backends keeps consumers from branching.
//
// The facade does not own the backend - dispose() clears the facade
// state but the backend is the consumer's resource. This matches
// AudioMixer (0.35.0): the wrapper is a tool, the backing object
// has its own lifecycle.
//
// Code style: var-only in browser source; defensive try/catch around
// every JSON parse / native storage access.
// In-memory backend. Tests, SSR, and the fallback path when no
// browser storage is available. Backed by a plain Map.
export class MemoryStorageBackend {
    store = new Map();
    async get(key) {
        var v = this.store.get(key);
        return v === undefined ? null : v;
    }
    async set(key, value) {
        this.store.set(key, value);
    }
    async remove(key) {
        this.store.delete(key);
    }
    async keys() {
        return Array.from(this.store.keys());
    }
    async clear() {
        this.store.clear();
    }
}
export class LocalStorageBackend {
    storage;
    prefix;
    fallback;
    constructor(opts = {}) {
        this.prefix = opts.prefix ?? '';
        if (opts.storage) {
            this.storage = opts.storage;
            this.fallback = null;
        }
        else if (typeof globalThis !== 'undefined'
            && typeof globalThis.localStorage === 'object'
            && globalThis.localStorage) {
            this.storage = globalThis.localStorage;
            this.fallback = null;
        }
        else {
            this.storage = null;
            this.fallback = new MemoryStorageBackend();
        }
    }
    // True if this backend is operating against a real Storage; false
    // if it fell back to in-memory because no localStorage was found.
    isLive() {
        return this.storage !== null;
    }
    k(key) {
        return this.prefix + key;
    }
    async get(key) {
        if (!this.storage)
            return this.fallback.get(key);
        try {
            var v = this.storage.getItem(this.k(key));
            return v;
        }
        catch {
            return null;
        }
    }
    async set(key, value) {
        if (!this.storage)
            return this.fallback.set(key, value);
        this.storage.setItem(this.k(key), value);
    }
    async remove(key) {
        if (!this.storage)
            return this.fallback.remove(key);
        try {
            this.storage.removeItem(this.k(key));
        }
        catch {
            // ignore
        }
    }
    async keys() {
        if (!this.storage)
            return this.fallback.keys();
        var out = [];
        var n = this.storage.length;
        for (var i = 0; i < n; i++) {
            var k = this.storage.key(i);
            if (k === null)
                continue;
            if (this.prefix === '' || k.indexOf(this.prefix) === 0) {
                out.push(k.substring(this.prefix.length));
            }
        }
        return out;
    }
    async clear() {
        if (!this.storage)
            return this.fallback.clear();
        if (this.prefix === '') {
            this.storage.clear();
            return;
        }
        // Prefix-scoped clear: enumerate then remove. Avoid mutating
        // during enumeration by collecting keys first.
        var toRemove = [];
        var n = this.storage.length;
        for (var i = 0; i < n; i++) {
            var k = this.storage.key(i);
            if (k === null)
                continue;
            if (k.indexOf(this.prefix) === 0)
                toRemove.push(k);
        }
        for (var j = 0; j < toRemove.length; j++) {
            var rk = toRemove[j];
            try {
                this.storage.removeItem(rk);
            }
            catch { /* ignore */ }
        }
    }
}
// High-level facade. Adds JSON encoding, namespacing, and typed
// WorldSnapshot helpers on top of the raw key/value backend.
export class PersistentStorage {
    backend;
    namespace;
    disposed = false;
    constructor(opts) {
        this.backend = opts.backend;
        this.namespace = opts.namespace ?? '';
    }
    static create(opts) {
        return new PersistentStorage(opts);
    }
    // Persist arbitrary JSON-safe data under `key`. The data is
    // JSON.stringified before write. Returns when the backend resolves.
    async save(key, data) {
        if (this.disposed)
            return;
        var json;
        try {
            json = JSON.stringify(data);
        }
        catch (e) {
            // Re-throw as a plain Error with the key context so callers
            // can locate the bad payload.
            throw new Error('PersistentStorage.save: JSON.stringify failed for "'
                + key + '": ' + (e instanceof Error ? e.message : String(e)));
        }
        return this.backend.set(this.k(key), json);
    }
    // Load + JSON.parse the value at `key`. Returns null if the key
    // is missing OR the stored value isn't valid JSON.
    async load(key) {
        if (this.disposed)
            return null;
        var raw = await this.backend.get(this.k(key));
        if (raw === null)
            return null;
        try {
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    async remove(key) {
        if (this.disposed)
            return;
        return this.backend.remove(this.k(key));
    }
    async hasKey(key) {
        if (this.disposed)
            return false;
        var v = await this.backend.get(this.k(key));
        return v !== null;
    }
    // Enumerate every facade-managed key (namespace stripped).
    async listKeys() {
        if (this.disposed)
            return [];
        var allKeys = await this.backend.keys();
        if (this.namespace === '')
            return allKeys;
        var out = [];
        for (var i = 0; i < allKeys.length; i++) {
            var k = allKeys[i];
            if (k.indexOf(this.namespace) === 0) {
                out.push(k.substring(this.namespace.length));
            }
        }
        return out;
    }
    // Drop every facade-managed key. Backend-level keys outside the
    // namespace are untouched.
    async clearAll() {
        if (this.disposed)
            return;
        if (this.namespace === '') {
            return this.backend.clear();
        }
        var keys = await this.listKeys();
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            await this.backend.remove(this.k(k));
        }
    }
    // Typed convenience: store a WorldSnapshot envelope.
    saveSnapshot(key, snap) {
        return this.save(key, snap);
    }
    // Typed convenience: load a WorldSnapshot envelope. Returns null
    // if missing OR if the parsed payload doesn't have the snapshot
    // shape (defensive: corrupted localStorage shouldn't crash boot).
    async loadSnapshot(key) {
        var data = await this.load(key);
        if (!data || typeof data !== 'object')
            return null;
        var d = data;
        if (typeof d.schemaVersion !== 'number')
            return null;
        if (typeof d.engineVersion !== 'string')
            return null;
        if (typeof d.capturedAtMs !== 'number')
            return null;
        if (!d.resources || typeof d.resources !== 'object')
            return null;
        return d;
    }
    // After dispose, all save/load methods become no-ops or null
    // returns. The underlying backend is NOT disposed - the consumer
    // owns its lifetime.
    dispose() {
        this.disposed = true;
    }
    // ---------- private ----------
    k(key) {
        return this.namespace + key;
    }
}
// Resource key for the world's resource registry. Engine consumers
// register a PersistentStorage instance under this key.
export const RESOURCE_PERSISTENT_STORAGE = 'persistent_storage';
//# sourceMappingURL=persistent-storage.js.map