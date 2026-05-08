// Color types and helpers for the Loom Engine.
//
// Two representations:
// - ColorRGBA: 4 floats in [0,1]. Used in tints, gradients, blending.
// - Hex24: a packed 0xRRGGBB integer. Used in atlas tints and palette
//   storage where memory matters.

export interface ColorRGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function rgba(r: number, g: number, b: number, a: number): ColorRGBA {
  return { r, g, b, a };
}

export const COLOR_WHITE: Readonly<ColorRGBA> = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });
export const COLOR_BLACK: Readonly<ColorRGBA> = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });
export const COLOR_TRANSPARENT: Readonly<ColorRGBA> = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

// Knot palette per LOOM-CLASS-SYSTEM-SPEC Section 4.
export const COLOR_KNOT_STR: Readonly<ColorRGBA> = Object.freeze(hexToRgba(0xb04a24));
export const COLOR_KNOT_DEX: Readonly<ColorRGBA> = Object.freeze(hexToRgba(0x5ac9d6));
export const COLOR_KNOT_INT: Readonly<ColorRGBA> = Object.freeze(hexToRgba(0x9b5de5));
export const COLOR_KNOT_CENTER: Readonly<ColorRGBA> = Object.freeze(hexToRgba(0xffd86a));

export function hexToRgba(hex: number, alpha: number = 1): ColorRGBA {
  return {
    r: ((hex >> 16) & 0xff) / 255,
    g: ((hex >> 8) & 0xff) / 255,
    b: (hex & 0xff) / 255,
    a: alpha,
  };
}

export function rgbaToHexString(c: ColorRGBA): string {
  const r = Math.round(c.r * 255) & 0xff;
  const g = Math.round(c.g * 255) & 0xff;
  const b = Math.round(c.b * 255) & 0xff;
  return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
}

export function rgbaToCssString(c: ColorRGBA): string {
  const r = Math.round(c.r * 255) & 0xff;
  const g = Math.round(c.g * 255) & 0xff;
  const b = Math.round(c.b * 255) & 0xff;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + c.a.toFixed(3) + ')';
}

export function colorLerp(a: ColorRGBA, b: ColorRGBA, t: number, out: ColorRGBA): ColorRGBA {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
  out.a = a.a + (b.a - a.a) * t;
  return out;
}

// ----- 0.33.0 additions -----

// Clamp a value to [0, 1]. NaN / Infinity / -Infinity all return 0.
export function clamp01(v: number): number {
  if (!isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// Parse a hex color STRING (e.g. '#ff8000', '#f80', '#ff800080').
// Accepts 3 / 4 / 6 / 8 hex digits with or without leading '#'.
// Returns null on invalid input.
export function parseHex(str: string): ColorRGBA | null {
  if (typeof str !== 'string') return null;
  let s = str.trim();
  if (s.length > 0 && s.charAt(0) === '#') s = s.substring(1);
  // Expand short forms.
  if (s.length === 3 || s.length === 4) {
    let expanded = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s.charAt(i);
      expanded += ch + ch;
    }
    s = expanded;
  }
  if (s.length !== 6 && s.length !== 8) return null;
  if (!/^[0-9a-fA-F]+$/.test(s)) return null;
  const r = parseInt(s.substring(0, 2), 16) / 255;
  const g = parseInt(s.substring(2, 4), 16) / 255;
  const b = parseInt(s.substring(4, 6), 16) / 255;
  let a = 1;
  if (s.length === 8) {
    a = parseInt(s.substring(6, 8), 16) / 255;
  }
  return { r, g, b, a };
}

// Format a color as a hex string. 6 digits if alpha is 1, else 8.
export function toHexString(c: ColorRGBA): string {
  const r = byteHexC(c.r);
  const g = byteHexC(c.g);
  const b = byteHexC(c.b);
  if (c.a >= 1) return '#' + r + g + b;
  return '#' + r + g + b + byteHexC(c.a);
}

// Alpha-composite `over` on top of `under`. Both straight-alpha;
// output is straight-alpha. Returns a fresh object (no out param;
// blends rarely reach the hot path).
export function colorBlend(over: ColorRGBA, under: ColorRGBA): ColorRGBA {
  const oa = over.a;
  const ua = under.a;
  const outA = oa + ua * (1 - oa);
  if (outA === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (over.r * oa + under.r * ua * (1 - oa)) / outA,
    g: (over.g * oa + under.g * ua * (1 - oa)) / outA,
    b: (over.b * oa + under.b * ua * (1 - oa)) / outA,
    a: outA,
  };
}

// Adjust by hue (degrees), saturation delta, lightness delta.
// All deltas additive in HSL space; result clamped to valid RGB.
export function adjustHsl(c: ColorRGBA, dh: number, ds: number, dl: number): ColorRGBA {
  const hsl = rgbToHsl(c.r, c.g, c.b);
  let h = (hsl.h + dh / 360) % 1;
  if (h < 0) h += 1;
  const s = clamp01(hsl.s + ds);
  const l = clamp01(hsl.l + dl);
  const rgb = hslToRgb(h, s, l);
  return { r: rgb.r, g: rgb.g, b: rgb.b, a: c.a };
}

// Pack RGBA color into a single Uint32 in 0xRRGGBBAA byte order.
// Useful for typed-array storage (particle pools, etc.).
export function pack32(r: number, g: number, b: number, a: number = 1): number {
  const rb = (clamp01(r) * 255 + 0.5) | 0;
  const gb = (clamp01(g) * 255 + 0.5) | 0;
  const bb = (clamp01(b) * 255 + 0.5) | 0;
  const ab = (clamp01(a) * 255 + 0.5) | 0;
  return (((rb << 24) | (gb << 16) | (bb << 8) | ab) >>> 0);
}

// Unpack a Uint32 0xRRGGBBAA into a Color.
export function unpack32(packed: number): ColorRGBA {
  const n = packed >>> 0;
  return {
    r: ((n >>> 24) & 0xff) / 255,
    g: ((n >>> 16) & 0xff) / 255,
    b: ((n >>> 8) & 0xff) / 255,
    a: (n & 0xff) / 255,
  };
}

// ----- 0.33.0 internal helpers -----

function byteHexC(v: number): string {
  const n = (clamp01(v) * 255 + 0.5) | 0;
  const s = n.toString(16);
  return s.length === 1 ? '0' + s : s;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s: number;
  let h: number;
  if (max === min) {
    h = 0;
    s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) {
      h = (g - b) / d + (g < b ? 6 : 0);
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) return { r: l, g: l, b: l };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hueToRgb(p, q, h + 1 / 3),
    g: hueToRgb(p, q, h),
    b: hueToRgb(p, q, h - 1 / 3),
  };
}

function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
