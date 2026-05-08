import type { ColorRGBA } from '../util/color.js';
import type { KnotMood, KnotPaletteHex } from './event-envelope.js';
export interface KnotPaletteRgba {
    primary: ColorRGBA;
    secondary: ColorRGBA;
    accent: ColorRGBA;
}
export declare class KnotContextResource {
    current: KnotPaletteRgba;
    target: KnotPaletteRgba;
    knot: string;
    mood: KnotMood;
    fadeStartMs: number;
    fadeDurationMs: number;
    fadeFromPalette: KnotPaletteRgba;
    constructor();
    beginFade(targetHex: KnotPaletteHex, fadeMs: number, nowMs: number): void;
    tickFade(nowMs: number): void;
    isFading(): boolean;
    getBloomMultiplier(): number;
    getShakeMultiplier(): number;
    getMusicIntensity(): number;
    hexSnapshot(): KnotPaletteHex;
}
//# sourceMappingURL=knot-context-resource.d.ts.map