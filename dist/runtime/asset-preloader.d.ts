export interface AssetEntry {
    id: string;
    loader: () => Promise<unknown>;
    result: unknown;
}
export interface AssetProgressEvent {
    completed: number;
    total: number;
    fraction: number;
}
export interface AssetLoadedEvent {
    id: string;
    result: unknown;
}
export interface AssetErrorEvent {
    id: string;
    error: unknown;
}
export interface AssetDoneEvent {
    total: number;
    succeeded: number;
    failed: number;
    errors: ReadonlyArray<AssetErrorEvent>;
}
type Listener<T> = (data: T) => void;
export declare class AssetPreloader {
    private entries;
    private started;
    private completed;
    private succeeded;
    private failed;
    private errors;
    private progressListeners;
    private assetListeners;
    private errorListeners;
    private doneListeners;
    add(id: string, loader: () => Promise<unknown>): void;
    on(type: 'progress' | 'asset' | 'error' | 'done', handler: (data: unknown) => void): () => void;
    onProgress(handler: Listener<AssetProgressEvent>): () => void;
    onAsset(handler: Listener<AssetLoadedEvent>): () => void;
    onError(handler: Listener<AssetErrorEvent>): () => void;
    onDone(handler: Listener<AssetDoneEvent>): () => void;
    start(): Promise<AssetDoneEvent>;
    stats(): {
        total: number;
        completed: number;
        succeeded: number;
        failed: number;
        started: boolean;
    };
    get(id: string): unknown;
    private runEntry;
    private tickProgress;
    private buildDone;
    private fireProgress;
    private fireAsset;
    private fireError;
    private fireDone;
}
export declare const RESOURCE_ASSET_PRELOADER = "loom.asset_preloader";
export {};
//# sourceMappingURL=asset-preloader.d.ts.map