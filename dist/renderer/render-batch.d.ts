export type BatchFlushCallback = (layer: number, atlas: unknown, entries: ReadonlyArray<{
    frame: number;
    x: number;
    y: number;
    z: number;
    hasTint: boolean;
    tintR: number;
    tintG: number;
    tintB: number;
    tintA: number;
}>) => void;
export declare class RenderBatch {
    private buckets;
    private layerOrder;
    private submitCount;
    private flushCount;
    submit(layer: number, atlas: unknown, frame: number, x: number, y: number, z: number, tint?: {
        r: number;
        g: number;
        b: number;
        a: number;
    }): void;
    flushTo(_device: unknown, cb: BatchFlushCallback): void;
    clear(): void;
    stats(): {
        submits: number;
        flushes: number;
        layersQueued: number;
        groupsQueued: number;
        entriesQueued: number;
    };
}
export declare const RENDER_LAYER_BACKGROUND = -100;
export declare const RENDER_LAYER_TERRAIN = 0;
export declare const RENDER_LAYER_ENTITIES = 100;
export declare const RENDER_LAYER_FX = 200;
export declare const RENDER_LAYER_HUD = 1000;
export declare const RESOURCE_RENDER_BATCH = "loom.render_batch";
//# sourceMappingURL=render-batch.d.ts.map