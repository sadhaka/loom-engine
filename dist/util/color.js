// Color types and helpers for the Loom Engine.
//
// Two representations:
// - ColorRGBA: 4 floats in [0,1]. Used in tints, gradients, blending.
// - Hex24: a packed 0xRRGGBB integer. Used in atlas tints and palette
//   storage where memory matters.
export function rgba(r, g, b, a) {
    return { r, g, b, a };
}
export const COLOR_WHITE = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });
export const COLOR_BLACK = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });
export const COLOR_TRANSPARENT = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
// Knot palette per LOOM-CLASS-SYSTEM-SPEC Section 4.
export const COLOR_KNOT_STR = Object.freeze(hexToRgba(0xb04a24));
export const COLOR_KNOT_DEX = Object.freeze(hexToRgba(0x5ac9d6));
export const COLOR_KNOT_INT = Object.freeze(hexToRgba(0x9b5de5));
export const COLOR_KNOT_CENTER = Object.freeze(hexToRgba(0xffd86a));
export function hexToRgba(hex, alpha = 1) {
    return {
        r: ((hex >> 16) & 0xff) / 255,
        g: ((hex >> 8) & 0xff) / 255,
        b: (hex & 0xff) / 255,
        a: alpha,
    };
}
export function rgbaToHexString(c) {
    const r = Math.round(c.r * 255) & 0xff;
    const g = Math.round(c.g * 255) & 0xff;
    const b = Math.round(c.b * 255) & 0xff;
    return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
}
export function rgbaToCssString(c) {
    const r = Math.round(c.r * 255) & 0xff;
    const g = Math.round(c.g * 255) & 0xff;
    const b = Math.round(c.b * 255) & 0xff;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + c.a.toFixed(3) + ')';
}
export function colorLerp(a, b, t, out) {
    out.r = a.r + (b.r - a.r) * t;
    out.g = a.g + (b.g - a.g) * t;
    out.b = a.b + (b.b - a.b) * t;
    out.a = a.a + (b.a - a.a) * t;
    return out;
}
//# sourceMappingURL=color.js.map