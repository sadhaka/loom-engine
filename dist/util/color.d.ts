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
//# sourceMappingURL=color.d.ts.map