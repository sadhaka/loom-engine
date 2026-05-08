import type { ColorRGBA } from '../util/color.js';
import { type IGraphicsDevice, type AtlasHandle, type AtlasDescriptor, type TextStyle } from './graphics-device.js';
import { type CameraView } from './camera.js';
export declare class WebGL2Device implements IGraphicsDevice {
    readonly canvas: HTMLCanvasElement;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    private gl;
    private program;
    private vao;
    private quadVBO;
    private instanceVBO;
    private instanceVBOBytes;
    private atlases;
    private nextAtlasHandle;
    private camera;
    private drawCallCount;
    private batcher;
    private particleAtlas;
    private textCache;
    private contextLost;
    private boundOnLost;
    private boundOnRestored;
    private lastUpload;
    constructor(canvas: HTMLCanvasElement, gl?: WebGL2RenderingContext);
    private initGLResources;
    private compileProgram;
    private handleContextLoss;
    private handleContextRestored;
    beginFrame(): void;
    endFrame(): void;
    setCamera(cam: Readonly<CameraView>): void;
    registerAtlas(desc: AtlasDescriptor): AtlasHandle;
    releaseAtlas(handle: AtlasHandle): void;
    drawSprite(worldX: number, worldY: number, worldZ: number, atlas: AtlasHandle, frame: number, tint?: Readonly<ColorRGBA>): void;
    drawTile(tileX: number, tileY: number, atlas: AtlasHandle, frame: number): void;
    drawText(worldX: number, worldY: number, text: string, style: TextStyle): void;
    drawParticle(worldX: number, worldY: number, worldZ: number, size: number, color: Readonly<ColorRGBA>, additive: boolean): void;
    getDrawCallCount(): number;
    dispose(): void;
    getBatcherStats(): {
        flushCount: number;
        instanceTotal: number;
        capacity: number;
    };
    _peekLastUpload(): {
        count: number;
        floats: number;
    };
    private executeFlush;
    private getOrBakeText;
}
//# sourceMappingURL=webgl2-device.d.ts.map