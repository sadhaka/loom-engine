// KnotContextResource - the renderer's current palette + mood state.
//
// Per LOOM-DIRECTOR-PROTOCOL.md Section 5: Director picks the active
// knot, the renderer applies the palette it is told to apply. This
// resource holds:
//   - current palette + mood (what's rendered right now)
//   - target palette + mood (what we're crossfading toward)
//   - fade timing for the active transition
//
// DirectorSystem mutates `target` and `fadeStartMs` on knot.context
// events. A small per-tick interpolation (also inside DirectorSystem)
// advances `current` toward `target` over fade_ms. A fade_ms of 0 is
// rendered as a 1-frame fade so animation systems do not skip a beat
// (Section 5.3).
//
// Mood multipliers (Section 5.4) are exposed as derived getters on
// the resource. Render systems read them when computing bloom + shake
// + music intensity.

import type { ColorRGBA } from '../util/color.js';
import { hexToRgba, rgbaToHexString } from '../util/color.js';
import type { KnotMood, KnotPaletteHex } from './event-envelope.js';

export interface KnotPaletteRgba {
  primary: ColorRGBA;
  secondary: ColorRGBA;
  accent: ColorRGBA;
}

// Default palette - Strknot per LOOM-CLASS-SYSTEM-SPEC Section 4.
// Used until the first knot.context event lands.
const DEFAULT_PALETTE_HEX: KnotPaletteHex = {
  primary:   '#b04a24',
  secondary: '#5ac9d6',
  accent:    '#ffd86a',
};

export class KnotContextResource {
  // Active palette currently in use by render systems. Interpolates
  // toward `target` over the fade window.
  current: KnotPaletteRgba;
  // Target palette the active fade is moving toward. Equals `current`
  // when no fade is active.
  target: KnotPaletteRgba;

  // Currently displayed knot id (e.g. 'str', 'dex', 'int', 'center').
  knot: string = 'str';
  // Currently active mood. Updated immediately on knot.context (no
  // mood crossfade in v1; mood is a hint, not a continuous param).
  mood: KnotMood = 'tense';

  // Crossfade timing (ms-based; uses performance.now() coordinates).
  // -1 means no fade is in progress.
  fadeStartMs: number = -1;
  fadeDurationMs: number = 0;
  // Snapshot of `current` at the moment the fade started, so each
  // tick can interpolate from a stable origin.
  fadeFromPalette: KnotPaletteRgba;

  constructor() {
    this.current = paletteFromHex(DEFAULT_PALETTE_HEX);
    this.target = paletteFromHex(DEFAULT_PALETTE_HEX);
    this.fadeFromPalette = paletteFromHex(DEFAULT_PALETTE_HEX);
  }

  // Begin a crossfade to a new palette. Called by DirectorSystem on
  // knot.context. fade_ms = 0 is treated as 16ms (one frame at 60fps)
  // so animation systems always observe at least one frame of fade.
  beginFade(targetHex: KnotPaletteHex, fadeMs: number, nowMs: number): void {
    this.fadeFromPalette = clonePalette(this.current);
    this.target = paletteFromHex(targetHex);
    this.fadeStartMs = nowMs;
    this.fadeDurationMs = fadeMs <= 0 ? 16 : fadeMs;
  }

  // Per-tick interpolation. Call from DirectorSystem.update each tick
  // with performance.now(). Updates `current` toward `target` based
  // on elapsed fade time. Idempotent if no fade is active.
  tickFade(nowMs: number): void {
    if (this.fadeStartMs < 0) return;
    const elapsed = nowMs - this.fadeStartMs;
    const t = Math.min(1, Math.max(0, elapsed / this.fadeDurationMs));
    interpolatePaletteInto(this.fadeFromPalette, this.target, t, this.current);
    if (t >= 1) {
      this.fadeStartMs = -1;
    }
  }

  isFading(): boolean {
    return this.fadeStartMs >= 0;
  }

  // Mood multipliers per Section 5.4.
  getBloomMultiplier(): number {
    return moodBloomMult(this.mood);
  }

  getShakeMultiplier(): number {
    return moodShakeMult(this.mood);
  }

  getMusicIntensity(): number {
    return moodMusicMult(this.mood);
  }

  // Snapshot in hex form. Useful for debug HUD / serialization.
  hexSnapshot(): KnotPaletteHex {
    return {
      primary: rgbaToHexString(this.current.primary),
      secondary: rgbaToHexString(this.current.secondary),
      accent: rgbaToHexString(this.current.accent),
    };
  }
}

// ----- Helpers -----

function paletteFromHex(p: KnotPaletteHex): KnotPaletteRgba {
  return {
    primary: hexToRgba(parseHex(p.primary)),
    secondary: hexToRgba(parseHex(p.secondary)),
    accent: hexToRgba(parseHex(p.accent)),
  };
}

function clonePalette(p: KnotPaletteRgba): KnotPaletteRgba {
  return {
    primary: { ...p.primary },
    secondary: { ...p.secondary },
    accent: { ...p.accent },
  };
}

function interpolatePaletteInto(
  from: KnotPaletteRgba,
  to: KnotPaletteRgba,
  t: number,
  out: KnotPaletteRgba,
): void {
  out.primary.r = from.primary.r + (to.primary.r - from.primary.r) * t;
  out.primary.g = from.primary.g + (to.primary.g - from.primary.g) * t;
  out.primary.b = from.primary.b + (to.primary.b - from.primary.b) * t;
  out.primary.a = from.primary.a + (to.primary.a - from.primary.a) * t;
  out.secondary.r = from.secondary.r + (to.secondary.r - from.secondary.r) * t;
  out.secondary.g = from.secondary.g + (to.secondary.g - from.secondary.g) * t;
  out.secondary.b = from.secondary.b + (to.secondary.b - from.secondary.b) * t;
  out.secondary.a = from.secondary.a + (to.secondary.a - from.secondary.a) * t;
  out.accent.r = from.accent.r + (to.accent.r - from.accent.r) * t;
  out.accent.g = from.accent.g + (to.accent.g - from.accent.g) * t;
  out.accent.b = from.accent.b + (to.accent.b - from.accent.b) * t;
  out.accent.a = from.accent.a + (to.accent.a - from.accent.a) * t;
}

function parseHex(hex: string): number {
  if (!hex || typeof hex !== 'string') return 0xffffff;
  const trimmed = hex.startsWith('#') ? hex.slice(1) : hex;
  const n = parseInt(trimmed, 16);
  return Number.isFinite(n) ? n : 0xffffff;
}

function moodBloomMult(mood: KnotMood): number {
  if (mood === 'calm') return 0.6;
  if (mood === 'climactic') return 1.4;
  return 1.0;   // tense or unknown
}

function moodShakeMult(mood: KnotMood): number {
  if (mood === 'calm') return 0.5;
  if (mood === 'climactic') return 1.5;
  return 1.0;
}

function moodMusicMult(mood: KnotMood): number {
  if (mood === 'calm') return 0.5;
  if (mood === 'climactic') return 1.4;
  return 1.0;
}
