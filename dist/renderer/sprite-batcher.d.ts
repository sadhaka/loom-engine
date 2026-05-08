import type { TextureAtlas } from './texture-atlas.js';
export type BlendMode = 'alpha' | 'add';
export declare const FLOATS_PER_INSTANCE: number;
export type FlushHandler = (atlas: TextureAtlas, blendMode: BlendMode, data: Float32Array, count: number) => void;
export declare class SpriteBatcher {
    private buffer;
    private capacity;
    private count;
    private currentAtlas;
    private currentBlend;
    private flushCount;
    private instanceTotal;
    private readonly flushHandler;
    constructor(flushHandler: FlushHandler, initialCapacity?: number);
    beginFrame(): void;
    submit(atlas: TextureAtlas, blendMode: BlendMode, originX: number, originY: number, sizeX: number, sizeY: number, u0: number, v0: number, u1: number, v1: number, tintR: number, tintG: number, tintB: number, tintA: number): void;
    flush(): void;
    endFrame(): void;
    getStats(out: {
        flushCount: number;
        instanceTotal: number;
        capacity: number;
    }): void;
    _peekCount(): number;
    _peekCurrentAtlas(): TextureAtlas | null;
    _peekCurrentBlend(): BlendMode;
    _peekBuffer(): Float32Array;
    private grow;
}
//# sourceMappingURL=sprite-batcher.d.ts.map