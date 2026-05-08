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

import type { WorldSnapshot } from './world-snapshot.js';

export interface IStorageBackend {
  // Returns the stored string under `key`, or null if missing.
  get(key: string): Promise<string | null>;
  // Persist a string under `key`. Overwrites any prior value.
  set(key: string, value: string): Promise<void>;
  // Remove a key. No-op if the key doesn't exist.
  remove(key: string): Promise<void>;
  // Enumerate every key managed by this backend. Order is backend-
  // defined.
  keys(): Promise<string[]>;
  // Drop every key from this backend (within whatever scope the
  // backend defines - the in-memory backend clears its Map; the
  // localStorage backend clears its prefix scope).
  clear(): Promise<void>;
}

// In-memory backend. Tests, SSR, and the fallback path when no
// browser storage is available. Backed by a plain Map.
export class MemoryStorageBackend implements IStorageBackend {
  private store: Map<string, string> = new Map();

  async get(key: string): Promise<string | null> {
    var v = this.store.get(key);
    return v === undefined ? null : v;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.store.keys());
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

// Browser localStorage backend. Wraps the synchronous DOM API with
// promises so it composes cleanly with async IndexedDB / network
// backends. All operations are synchronous under the hood; quota
// failures surface as rejected promises.
//
// Optionally scoped by `prefix`: keys are stored as `<prefix><key>`,
// and keys() / clear() only enumerate / clear keys with that prefix.
// This makes multiple PersistentStorage instances safe in the same
// page.
export interface LocalStorageBackendOptions {
  // Storage object. Defaults to window.localStorage (browser) or a
  // newly-allocated MemoryStorageBackend if window is absent.
  storage?: Storage;
  // Per-instance prefix. Defaults to '' (no isolation).
  prefix?: string;
}

export class LocalStorageBackend implements IStorageBackend {
  private storage: Storage | null;
  private prefix: string;
  private fallback: MemoryStorageBackend | null;

  constructor(opts: LocalStorageBackendOptions = {}) {
    this.prefix = opts.prefix ?? '';
    if (opts.storage) {
      this.storage = opts.storage;
      this.fallback = null;
    } else if (typeof globalThis !== 'undefined'
        && typeof (globalThis as { localStorage?: Storage }).localStorage === 'object'
        && (globalThis as { localStorage?: Storage }).localStorage) {
      this.storage = (globalThis as { localStorage: Storage }).localStorage;
      this.fallback = null;
    } else {
      this.storage = null;
      this.fallback = new MemoryStorageBackend();
    }
  }

  // True if this backend is operating against a real Storage; false
  // if it fell back to in-memory because no localStorage was found.
  isLive(): boolean {
    return this.storage !== null;
  }

  private k(key: string): string {
    return this.prefix + key;
  }

  async get(key: string): Promise<string | null> {
    if (!this.storage) return this.fallback!.get(key);
    try {
      var v = this.storage.getItem(this.k(key));
      return v;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.storage) return this.fallback!.set(key, value);
    this.storage.setItem(this.k(key), value);
  }

  async remove(key: string): Promise<void> {
    if (!this.storage) return this.fallback!.remove(key);
    try {
      this.storage.removeItem(this.k(key));
    } catch {
      // ignore
    }
  }

  async keys(): Promise<string[]> {
    if (!this.storage) return this.fallback!.keys();
    var out: string[] = [];
    var n = this.storage.length;
    for (var i = 0; i < n; i++) {
      var k = this.storage.key(i);
      if (k === null) continue;
      if (this.prefix === '' || k.indexOf(this.prefix) === 0) {
        out.push(k.substring(this.prefix.length));
      }
    }
    return out;
  }

  async clear(): Promise<void> {
    if (!this.storage) return this.fallback!.clear();
    if (this.prefix === '') {
      this.storage.clear();
      return;
    }
    // Prefix-scoped clear: enumerate then remove. Avoid mutating
    // during enumeration by collecting keys first.
    var toRemove: string[] = [];
    var n = this.storage.length;
    for (var i = 0; i < n; i++) {
      var k = this.storage.key(i);
      if (k === null) continue;
      if (k.indexOf(this.prefix) === 0) toRemove.push(k);
    }
    for (var j = 0; j < toRemove.length; j++) {
      var rk = toRemove[j] as string;
      try { this.storage.removeItem(rk); } catch { /* ignore */ }
    }
  }
}

export interface PersistentStorageOptions {
  // Required: the backend to write through. MemoryStorageBackend
  // for tests; LocalStorageBackend for browser.
  backend: IStorageBackend;
  // Optional namespace prepended to every key the facade reads /
  // writes. Different from the backend's own prefix - useful when
  // sharing one localStorage with multiple subsystems.
  namespace?: string;
}

// High-level facade. Adds JSON encoding, namespacing, and typed
// WorldSnapshot helpers on top of the raw key/value backend.
export class PersistentStorage {
  private backend: IStorageBackend;
  private namespace: string;
  private disposed: boolean = false;

  private constructor(opts: PersistentStorageOptions) {
    this.backend = opts.backend;
    this.namespace = opts.namespace ?? '';
  }

  static create(opts: PersistentStorageOptions): PersistentStorage {
    return new PersistentStorage(opts);
  }

  // Persist arbitrary JSON-safe data under `key`. The data is
  // JSON.stringified before write. Returns when the backend resolves.
  async save(key: string, data: unknown): Promise<void> {
    if (this.disposed) return;
    var json: string;
    try {
      json = JSON.stringify(data);
    } catch (e) {
      // Re-throw as a plain Error with the key context so callers
      // can locate the bad payload.
      throw new Error('PersistentStorage.save: JSON.stringify failed for "'
        + key + '": ' + (e instanceof Error ? e.message : String(e)));
    }
    return this.backend.set(this.k(key), json);
  }

  // Load + JSON.parse the value at `key`. Returns null if the key
  // is missing OR the stored value isn't valid JSON.
  async load(key: string): Promise<unknown | null> {
    if (this.disposed) return null;
    var raw = await this.backend.get(this.k(key));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    if (this.disposed) return;
    return this.backend.remove(this.k(key));
  }

  async hasKey(key: string): Promise<boolean> {
    if (this.disposed) return false;
    var v = await this.backend.get(this.k(key));
    return v !== null;
  }

  // Enumerate every facade-managed key (namespace stripped).
  async listKeys(): Promise<string[]> {
    if (this.disposed) return [];
    var allKeys = await this.backend.keys();
    if (this.namespace === '') return allKeys;
    var out: string[] = [];
    for (var i = 0; i < allKeys.length; i++) {
      var k = allKeys[i] as string;
      if (k.indexOf(this.namespace) === 0) {
        out.push(k.substring(this.namespace.length));
      }
    }
    return out;
  }

  // Drop every facade-managed key. Backend-level keys outside the
  // namespace are untouched.
  async clearAll(): Promise<void> {
    if (this.disposed) return;
    if (this.namespace === '') {
      return this.backend.clear();
    }
    var keys = await this.listKeys();
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i] as string;
      await this.backend.remove(this.k(k));
    }
  }

  // Typed convenience: store a WorldSnapshot envelope.
  saveSnapshot(key: string, snap: WorldSnapshot): Promise<void> {
    return this.save(key, snap);
  }

  // Typed convenience: load a WorldSnapshot envelope. Returns null
  // if missing OR if the parsed payload doesn't have the snapshot
  // shape (defensive: corrupted localStorage shouldn't crash boot).
  async loadSnapshot(key: string): Promise<WorldSnapshot | null> {
    var data = await this.load(key);
    if (!data || typeof data !== 'object') return null;
    var d = data as Partial<WorldSnapshot>;
    if (typeof d.schemaVersion !== 'number') return null;
    if (typeof d.engineVersion !== 'string') return null;
    if (typeof d.capturedAtMs !== 'number') return null;
    if (!d.resources || typeof d.resources !== 'object') return null;
    return d as WorldSnapshot;
  }

  // After dispose, all save/load methods become no-ops or null
  // returns. The underlying backend is NOT disposed - the consumer
  // owns its lifetime.
  dispose(): void {
    this.disposed = true;
  }

  // ---------- private ----------

  private k(key: string): string {
    return this.namespace + key;
  }
}

// Resource key for the world's resource registry. Engine consumers
// register a PersistentStorage instance under this key.
export const RESOURCE_PERSISTENT_STORAGE = 'persistent_storage';
