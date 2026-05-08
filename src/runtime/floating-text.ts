// FloatingText - HUD primitive for damage numbers / floating labels.
//
// 0.37.0 enabling primitive. Many engine consumers want short-lived
// numeric / text overlays that pop up at a world position, drift,
// and fade out: damage numbers on hit, "+10 XP" reward popups, miss
// indicators, status confirmations. FloatingText is a renderer-
// agnostic state container with a fixed-capacity pool, kinematic
// integration (initial velocity + gravity), auto-fade over the last
// portion of lifetime, and a forEach iterator for the consumer's
// renderer to draw.
//
// Engine ships ZERO render path - consumers wire forEach to whatever
// their renderer provides:
//   - Canvas2D: ctx.fillText with rgba alpha
//   - WebGL2: SpriteBatcher with a font atlas + alpha tint
//   - DOM: position absolute + transform translate / opacity
//   - HUD overlay element pool
//
// Determinism: tick(dtMs) is the only time source, so floating text
// state replays identically when dtMs is replayed. Random offsets
// (e.g. small lateral kick on crit) are the consumer's call, fed
// through the spawn options.
//
// Code style: var-only in browser source.

export interface FloatingTextSpawn {
  // Anchor position. Coordinate space is up to the consumer (world,
  // screen, or HUD-local).
  x: number;
  y: number;
  // The text to display. Pre-formatted by the consumer (e.g. "42",
  // "MISS", "+10 XP", "CRIT 99!").
  text: string;
  // Initial velocity (units per second). Negative vy moves up in
  // most coordinate conventions. Defaults from system options.
  vx?: number;
  vy?: number;
  // Acceleration (units per second^2). Use a positive ay for a
  // "falling back down" arc, negative for "rises and slows".
  // Defaults from system options.
  ax?: number;
  ay?: number;
  // Total lifetime in ms. Defaults from system options.
  lifetimeMs?: number;
  // Tint color in 0xRRGGBB. Defaults from system options.
  color?: number;
  // Render scale multiplier (e.g. 1.5 for crits). Default 1.
  scale?: number;
}

export interface FloatingTextRenderState {
  text: string;
  x: number;
  y: number;
  // Current alpha in [0, 1]. Auto-fades linearly over the last
  // `fadeFractionEnd` of the lifetime.
  alpha: number;
  color: number;
  scale: number;
  // Convenience for renderers that want to size by remaining life.
  ageMs: number;
  lifetimeMs: number;
}

export interface FloatingTextOptions {
  // Pool size. Defaults to 64. emit() returns -1 when full.
  capacity?: number;
  // Default text lifetime in ms. Default 800.
  defaultLifetimeMs?: number;
  // Default initial vx, vy (units per second). Default vx=0, vy=-60
  // (drifts up).
  defaultVx?: number;
  defaultVy?: number;
  // Default ax, ay (units per second^2). Default ax=0, ay=80 (gentle
  // fall, so the text rises then settles).
  defaultAx?: number;
  defaultAy?: number;
  // Default tint color (0xRRGGBB). Default 0xffffff (white).
  defaultColor?: number;
  // Default render scale multiplier. Default 1.
  defaultScale?: number;
  // Fraction of lifetime over which alpha ramps from 1 to 0 at the
  // tail end. Default 0.3 (last 30%). 0 disables fade entirely.
  fadeFractionEnd?: number;
  // Fraction of lifetime over which alpha ramps from 0 to 1 at the
  // start. Default 0 (no fade-in). Useful for soft-spawn UX.
  fadeFractionStart?: number;
}

const DEFAULT_CAPACITY = 64;
const DEFAULT_LIFETIME_MS = 800;
const DEFAULT_VY = -60;
const DEFAULT_AY = 80;
const DEFAULT_COLOR = 0xffffff;

interface Slot {
  active: boolean;
  text: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  ageMs: number;
  lifetimeMs: number;
  color: number;
  scale: number;
}

export class FloatingText {
  private slots: Slot[];
  private activeIndices: Set<number> = new Set();
  private nextSearch: number = 0;
  private capacityNum: number;
  private defaults: {
    lifetimeMs: number;
    vx: number;
    vy: number;
    ax: number;
    ay: number;
    color: number;
    scale: number;
    fadeStart: number;
    fadeEnd: number;
  };
  private disposed: boolean = false;

  private constructor(opts: FloatingTextOptions) {
    this.capacityNum = opts.capacity !== undefined && opts.capacity > 0
      ? opts.capacity
      : DEFAULT_CAPACITY;
    this.slots = [];
    for (var i = 0; i < this.capacityNum; i++) {
      this.slots.push(makeEmptySlot());
    }
    this.defaults = {
      lifetimeMs: opts.defaultLifetimeMs !== undefined && opts.defaultLifetimeMs > 0
        ? opts.defaultLifetimeMs
        : DEFAULT_LIFETIME_MS,
      vx: opts.defaultVx ?? 0,
      vy: opts.defaultVy ?? DEFAULT_VY,
      ax: opts.defaultAx ?? 0,
      ay: opts.defaultAy ?? DEFAULT_AY,
      color: opts.defaultColor ?? DEFAULT_COLOR,
      scale: opts.defaultScale ?? 1,
      fadeStart: clamp01(opts.fadeFractionStart ?? 0),
      fadeEnd: clamp01(opts.fadeFractionEnd ?? 0.3),
    };
  }

  static create(opts?: FloatingTextOptions): FloatingText {
    return new FloatingText(opts ?? {});
  }

  // Emit a floating text. Returns the slot index (>= 0) on success,
  // -1 if the pool is full or the system is disposed.
  emit(spawn: FloatingTextSpawn): number {
    if (this.disposed) return -1;
    var idx = this.findFreeSlot();
    if (idx < 0) return -1;
    var slot = this.slots[idx] as Slot;
    slot.active = true;
    slot.text = spawn.text;
    slot.x = spawn.x;
    slot.y = spawn.y;
    slot.vx = spawn.vx ?? this.defaults.vx;
    slot.vy = spawn.vy ?? this.defaults.vy;
    slot.ax = spawn.ax ?? this.defaults.ax;
    slot.ay = spawn.ay ?? this.defaults.ay;
    slot.ageMs = 0;
    slot.lifetimeMs = spawn.lifetimeMs !== undefined && spawn.lifetimeMs > 0
      ? spawn.lifetimeMs
      : this.defaults.lifetimeMs;
    slot.color = spawn.color ?? this.defaults.color;
    slot.scale = spawn.scale ?? this.defaults.scale;
    this.activeIndices.add(idx);
    return idx;
  }

  // Advance all active texts by dtMs. Texts whose age exceeds
  // lifetimeMs are deactivated and their slot returned to the pool.
  // Idempotent: tick(0) is a no-op.
  tick(dtMs: number): void {
    if (this.disposed) return;
    if (dtMs <= 0) return;
    var dtSec = dtMs / 1000;
    var doneIndices: number[] = [];
    var iter = this.activeIndices.values();
    var step = iter.next();
    while (!step.done) {
      var i = step.value;
      var slot = this.slots[i] as Slot;
      slot.ageMs += dtMs;
      if (slot.ageMs >= slot.lifetimeMs) {
        doneIndices.push(i);
      } else {
        // Semi-implicit Euler: velocity then position. Predictable
        // for small dt; lifetimes are typically <2s so drift is
        // negligible.
        slot.vx += slot.ax * dtSec;
        slot.vy += slot.ay * dtSec;
        slot.x += slot.vx * dtSec;
        slot.y += slot.vy * dtSec;
      }
      step = iter.next();
    }
    for (var di = 0; di < doneIndices.length; di++) {
      this.deactivate(doneIndices[di] as number);
    }
  }

  // Iterate active texts and call cb with each one's render state.
  // The callback should NOT mutate the system (e.g. emit / clearAll
  // during iteration). The render state is rebuilt each call so the
  // consumer can stash references safely within the callback.
  forEach(cb: (state: FloatingTextRenderState) => void): void {
    if (this.disposed) return;
    var iter = this.activeIndices.values();
    var step = iter.next();
    while (!step.done) {
      var i = step.value;
      var slot = this.slots[i] as Slot;
      var alpha = this.computeAlpha(slot);
      try {
        cb({
          text: slot.text,
          x: slot.x,
          y: slot.y,
          alpha: alpha,
          color: slot.color,
          scale: slot.scale,
          ageMs: slot.ageMs,
          lifetimeMs: slot.lifetimeMs,
        });
      } catch {
        // Best-effort: a misbehaving renderer never takes down the
        // floating-text system. Production builds should wrap their
        // own logger around the cb body.
      }
      step = iter.next();
    }
  }

  activeCount(): number {
    return this.activeIndices.size;
  }

  capacity(): number {
    return this.capacityNum;
  }

  // Remove all active texts immediately. Useful on scene transition
  // or pause-and-clear.
  clearAll(): void {
    if (this.disposed) return;
    var arr = Array.from(this.activeIndices);
    for (var i = 0; i < arr.length; i++) {
      this.deactivate(arr[i] as number);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.activeIndices.clear();
    for (var i = 0; i < this.slots.length; i++) {
      (this.slots[i] as Slot).active = false;
    }
    this.disposed = true;
  }

  // ---------- private ----------

  private findFreeSlot(): number {
    var n = this.capacityNum;
    // Round-robin search starting from nextSearch so we don't keep
    // hitting the head of the array.
    for (var k = 0; k < n; k++) {
      var i = (this.nextSearch + k) % n;
      if (!(this.slots[i] as Slot).active) {
        this.nextSearch = (i + 1) % n;
        return i;
      }
    }
    return -1;
  }

  private deactivate(idx: number): void {
    var slot = this.slots[idx] as Slot;
    slot.active = false;
    this.activeIndices.delete(idx);
  }

  private computeAlpha(slot: Slot): number {
    var t = slot.lifetimeMs > 0 ? slot.ageMs / slot.lifetimeMs : 1;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    var fadeIn = this.defaults.fadeStart;
    var fadeOut = this.defaults.fadeEnd;
    var alpha = 1;
    if (fadeIn > 0 && t < fadeIn) {
      alpha = t / fadeIn;
    } else if (fadeOut > 0 && t > 1 - fadeOut) {
      alpha = (1 - t) / fadeOut;
    }
    if (alpha < 0) alpha = 0;
    if (alpha > 1) alpha = 1;
    return alpha;
  }
}

function makeEmptySlot(): Slot {
  return {
    active: false,
    text: '',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    ax: 0,
    ay: 0,
    ageMs: 0,
    lifetimeMs: 0,
    color: 0,
    scale: 1,
  };
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// Resource key for the world's resource registry. Engine consumers
// register a FloatingText instance under this key alongside their
// HUD layer.
export const RESOURCE_FLOATING_TEXT = 'floating_text';
