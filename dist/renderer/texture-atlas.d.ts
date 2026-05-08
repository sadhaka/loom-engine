import type { AtlasDescriptor } from './graphics-device.js';
export declare class TextureAtlas {
    texture: WebGLTexture | null;
    readonly width: number;
    readonly height: number;
    readonly uvRects: Float32Array;
    readonly frameSizes: Float32Array;
    readonly frameCount: number;
    readonly name: string;
    private sourceImage;
    released: boolean;
    constructor(gl: WebGL2RenderingContext | null, desc: AtlasDescriptor);
    upload(gl: WebGL2RenderingContext): void;
    bind(gl: WebGL2RenderingContext): void;
    handleContextLoss(): void;
    dispose(gl: WebGL2RenderingContext | null): void;
    lookupUVRect(frame: number, out: Float32Array, offset: number): boolean;
    lookupFrameSize(frame: number, out: {
        w: number;
        h: number;
    }): boolean;
}
export declare function makeParticleDiscAtlas(gl: WebGL2RenderingContext | null): TextureAtlas | null;
//# sourceMappingURL=texture-atlas.d.ts.map