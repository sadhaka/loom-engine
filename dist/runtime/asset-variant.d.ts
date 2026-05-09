export interface AssetVariantSpec {
    id: string;
    variants: Record<string, string>;
}
export interface AssetVariantOptions {
    variants: string[];
}
export declare class AssetVariant {
    private byId;
    private chain;
    private disposed;
    private constructor();
    static create(opts: AssetVariantOptions): AssetVariant;
    registerAsset(spec: AssetVariantSpec): boolean;
    unregisterAsset(id: string): boolean;
    has(id: string): boolean;
    size(): number;
    resolve(id: string): string | null;
    resolveWith(id: string, variants: string[]): string | null;
    setVariants(variants: string[]): void;
    getVariants(): string[];
    list(): AssetVariantSpec[];
    variantsOf(id: string): string[];
    clear(): void;
    dispose(): void;
}
export declare const RESOURCE_ASSET_VARIANT = "asset_variant";
//# sourceMappingURL=asset-variant.d.ts.map