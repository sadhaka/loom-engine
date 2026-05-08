import type { AtlasDescriptor } from '../renderer/graphics-device.js';
import type { AnimationClip } from '../animation/animation-clip.js';
export interface SpriteFrame {
    x: number;
    y: number;
    w: number;
    h: number;
    name?: string;
    duration_ms?: number;
}
export interface SpriteAnchor {
    x: number;
    y: number;
}
export interface SpriteSheetManifest {
    name: string;
    image: string;
    frames: ReadonlyArray<SpriteFrame>;
    anchor: SpriteAnchor;
    fps: number;
    clips: ReadonlyArray<AnimationClip>;
}
export interface LoadedSpriteSheet {
    manifest: SpriteSheetManifest;
    image: HTMLImageElement;
    atlas: AtlasDescriptor;
}
export declare class SpriteSheetLoadError extends Error {
    readonly kind: 'fetch-manifest' | 'parse-manifest' | 'invalid-manifest' | 'fetch-image' | 'decode-image';
    readonly url: string;
    constructor(kind: SpriteSheetLoadError['kind'], url: string, message: string, options?: {
        cause?: unknown;
    });
}
export interface LoaderOptions {
    fetchImpl?: typeof fetch;
    decodeImage?: (bytes: ArrayBuffer, url: string) => Promise<HTMLImageElement>;
}
export declare function loadSpriteSheet(manifestUrl: string, options?: LoaderOptions): Promise<LoadedSpriteSheet>;
export declare function computeFrameIndex(manifest: SpriteSheetManifest, now: number, start: number): number;
//# sourceMappingURL=sprite-sheet-loader.d.ts.map