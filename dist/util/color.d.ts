export interface ColorRGBA {
    r: number;
    g: number;
    b: number;
    a: number;
}
export declare function rgba(r: number, g: number, b: number, a: number): ColorRGBA;
export declare const COLOR_WHITE: Readonly<ColorRGBA>;
export declare const COLOR_BLACK: Readonly<ColorRGBA>;
export declare const COLOR_TRANSPARENT: Readonly<ColorRGBA>;
export declare const COLOR_KNOT_STR: Readonly<ColorRGBA>;
export declare const COLOR_KNOT_DEX: Readonly<ColorRGBA>;
export declare const COLOR_KNOT_INT: Readonly<ColorRGBA>;
export declare const COLOR_KNOT_CENTER: Readonly<ColorRGBA>;
export declare function hexToRgba(hex: number, alpha?: number): ColorRGBA;
export declare function rgbaToHexString(c: ColorRGBA): string;
export declare function rgbaToCssString(c: ColorRGBA): string;
export declare function colorLerp(a: ColorRGBA, b: ColorRGBA, t: number, out: ColorRGBA): ColorRGBA;
export declare function clamp01(v: number): number;
export declare function parseHex(str: string): ColorRGBA | null;
export declare function toHexString(c: ColorRGBA): string;
export declare function colorBlend(over: ColorRGBA, under: ColorRGBA): ColorRGBA;
export declare function adjustHsl(c: ColorRGBA, dh: number, ds: number, dl: number): ColorRGBA;
export declare function pack32(r: number, g: number, b: number, a?: number): number;
export declare function unpack32(packed: number): ColorRGBA;
//# sourceMappingURL=color.d.ts.map