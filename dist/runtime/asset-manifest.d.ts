export interface AssetEntry {
    id: string;
    type: string;
    url: string;
    deps?: string[];
    data?: Record<string, unknown>;
}
export interface AssetManifestOptions {
    entries?: AssetEntry[];
}
export type ResolveResult = {
    ok: true;
    order: string[];
} | {
    ok: false;
    reason: 'cycle' | 'missing_dep' | 'unknown_id';
    offenders: string[];
};
export declare class AssetManifest {
    private byId;
    private disposed;
    private constructor();
    static create(opts?: AssetManifestOptions): AssetManifest;
    add(entry: AssetEntry): boolean;
    remove(id: string): boolean;
    has(id: string): boolean;
    get(id: string): AssetEntry | null;
    size(): number;
    list(): AssetEntry[];
    clear(): void;
    resolve(): ResolveResult;
    resolveFor(id: string): ResolveResult;
    dispose(): void;
    private topoSort;
}
export declare const RESOURCE_ASSET_MANIFEST = "asset_manifest";
//# sourceMappingURL=asset-manifest.d.ts.map