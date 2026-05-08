import type { WorldSnapshot } from './world-snapshot.js';
export interface IStorageBackend {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
    keys(): Promise<string[]>;
    clear(): Promise<void>;
}
export declare class MemoryStorageBackend implements IStorageBackend {
    private store;
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
    keys(): Promise<string[]>;
    clear(): Promise<void>;
}
export interface LocalStorageBackendOptions {
    storage?: Storage;
    prefix?: string;
}
export declare class LocalStorageBackend implements IStorageBackend {
    private storage;
    private prefix;
    private fallback;
    constructor(opts?: LocalStorageBackendOptions);
    isLive(): boolean;
    private k;
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
    keys(): Promise<string[]>;
    clear(): Promise<void>;
}
export interface PersistentStorageOptions {
    backend: IStorageBackend;
    namespace?: string;
}
export declare class PersistentStorage {
    private backend;
    private namespace;
    private disposed;
    private constructor();
    static create(opts: PersistentStorageOptions): PersistentStorage;
    save(key: string, data: unknown): Promise<void>;
    load(key: string): Promise<unknown | null>;
    remove(key: string): Promise<void>;
    hasKey(key: string): Promise<boolean>;
    listKeys(): Promise<string[]>;
    clearAll(): Promise<void>;
    saveSnapshot(key: string, snap: WorldSnapshot): Promise<void>;
    loadSnapshot(key: string): Promise<WorldSnapshot | null>;
    dispose(): void;
    private k;
}
export declare const RESOURCE_PERSISTENT_STORAGE = "persistent_storage";
//# sourceMappingURL=persistent-storage.d.ts.map