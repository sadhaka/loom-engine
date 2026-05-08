import type { ColorRGBA } from '../util/color.js';
import { type IGraphicsDevice, type AtlasHandle, type AtlasDescriptor, type TextStyle } from './graphics-device.js';
import { type CameraView } from './camera.js';
export declare class Canvas2DDevice implements IGraphicsDevice {
    readonly canvas: HTMLCanvasElement;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    private ctx;
    private atlases;
    private nextAtlasHandle;
    private camera;
    private drawCallCount;
    private particleDisc;
    constructor(canvas: HTMLCanvasElement);
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
}
//# sourceMappingURL=canvas2d-device.d.ts.map