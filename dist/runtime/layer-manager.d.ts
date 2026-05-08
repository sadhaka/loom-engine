export interface LayerEntry {
    entityId: number;
    layer: number;
    z: number;
}
export interface LayerManagerOptions {
    initialCapacity?: number;
}
export declare class LayerManager {
    private byEntity;
    private sorted;
    private dirty;
    private disposed;
    private constructor();
    static create(opts?: LayerManagerOptions): LayerManager;
    add(entityId: number, layer: number, z?: number): void;
    remove(entityId: number): boolean;
    setZ(entityId: number, z: number): void;
    setLayer(entityId: number, layer: number): void;
    has(entityId: number): boolean;
    getLayer(entityId: number): number | null;
    getZ(entityId: number): number | null;
    count(): number;
    countOnLayer(layer: number): number;
    forEach(cb: (entry: LayerEntry) => void): void;
    forEachOnLayer(layer: number, cb: (entry: LayerEntry) => void): void;
    toArray(): LayerEntry[];
    clear(): void;
    dispose(): void;
    private ensureSorted;
}
export declare const RESOURCE_LAYER_MANAGER = "layer_manager";
//# sourceMappingURL=layer-manager.d.ts.map