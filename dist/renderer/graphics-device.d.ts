import type { ColorRGBA } from '../util/color.js';
import type { CameraView } from './camera.js';
export type AtlasHandle = number;
export interface AtlasDescriptor {
    image: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
    frames: ReadonlyArray<{
        x: number;
        y: number;
        w: number;
        h: number;
    }>;
    name?: string;
}
export interface TextStyle {
    font: string;
    fill: ColorRGBA;
    align?: 'left' | 'center' | 'right';
    baseline?: 'top' | 'middle' | 'bottom' | 'alphabetic';
}
export interface IGraphicsDevice {
    readonly canvas: HTMLCanvasElement;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
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
export type DeviceBackend = 'canvas2d' | 'webgl2';
//# sourceMappingURL=graphics-device.d.ts.map