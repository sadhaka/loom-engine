// HealthBar - render-state primitive for entity HP bars.
//
// 0.80.0 enabling primitive (and the M9 0.71-0.80 milestone). Boss
// fights, mob health, party portraits, NPC interaction targeting -
// all want a "what's this entity's HP and where's it floating?"
// render state. HealthBar is the keyed-by-entity ledger that holds
// position + hp/maxHp + a fade timer + a per-damage pulse value.
// The renderer pulls active bars via forEach() each frame and
// draws them in whatever style fits.
//
//   var bars = HealthBar.create({
//     fadeAfterMs: 4000,
//     fadeDurationMs: 1000,
//     pulseMs: 200,
//   });
//   bars.upsert({ entityId: 'mob42', x: 100, y: 50, hp: 30, maxHp: 100 });
//   on hit:        bars.applyDelta('mob42', -8);
//   on move:       bars.setPosition('mob42', newX, newY);
//   each frame:    bars.tick(dtMs);
//                  bars.forEach((s) => renderer.draw(s));
//
// Engine ships ZERO render path - the consumer's renderer reads
// `pct` (0..1 of fullness), `alpha` (post-fade), and `pulse` (0..1
// post-damage flash) and draws accordingly.
//
// Pairs with StatStack (0.59) and DamageFormula (0.66).
//
// Code style: var-only in browser source.

export interface HealthBarSpawn {
  entityId: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface HealthBarRenderState {
  entityId: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  // Fullness in [0, 1].
  pct: number;
  // Visibility in [0, 1] (post-fade).
  alpha: number;
  // Pulse intensity in [0, 1] (post-damage flash, decays).
  pulse: number;
  // Time (ms) since last delta. Useful for renderers that want
  // their own ramp curves.
  msSinceLastDelta: number;
}

export interface HealthBarOptions {
  // Pool capacity. Default 64. upsert returns -1 when full and
  // entity not already present.
  capacity?: number;
  // ms after last delta before alpha begins fading. Default 4000.
  fadeAfterMs?: number;
  // ms over which alpha decays from 1 to 0 once fading starts.
  // Default 1000.
  fadeDurationMs?: number;
  // ms over which the post-delta pulse decays from 1 to 0. Default 200.
  pulseMs?: number;
  // ms after the last delta after which the entry is removed
  // entirely. Default fadeAfterMs + fadeDurationMs.
  removeAfterMs?: number;
}

const DEFAULT_CAPACITY = 64;
const DEFAULT_FADE_AFTER_MS = 4000;
const DEFAULT_FADE_DURATION_MS = 1000;
const DEFAULT_PULSE_MS = 200;

interface InternalEntry {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  msSinceLastDelta: number;
  pulseRemainingMs: number;
}

export class HealthBar {
  private byId: Map<string, InternalEntry> = new Map();
  private capacityNum: number;
  private fadeAfterMs: number;
  private fadeDurationMs: number;
  private pulseMs: number;
  private removeAfterMs: number;
  private disposed: boolean = false;

  private constructor(opts: HealthBarOptions) {
    this.capacityNum = opts.capacity !== undefined && isFinite(opts.capacity) && opts.capacity > 0
      ? Math.floor(opts.capacity) : DEFAULT_CAPACITY;
    this.fadeAfterMs = opts.fadeAfterMs !== undefined && isFinite(opts.fadeAfterMs) && opts.fadeAfterMs > 0
      ? opts.fadeAfterMs : DEFAULT_FADE_AFTER_MS;
    this.fadeDurationMs = opts.fadeDurationMs !== undefined && isFinite(opts.fadeDurationMs) && opts.fadeDurationMs > 0
      ? opts.fadeDurationMs : DEFAULT_FADE_DURATION_MS;
    this.pulseMs = opts.pulseMs !== undefined && isFinite(opts.pulseMs) && opts.pulseMs > 0
      ? opts.pulseMs : DEFAULT_PULSE_MS;
    this.removeAfterMs = opts.removeAfterMs !== undefined && isFinite(opts.removeAfterMs) && opts.removeAfterMs > 0
      ? opts.removeAfterMs : (this.fadeAfterMs + this.fadeDurationMs);
  }

  static create(opts: HealthBarOptions = {}): HealthBar {
    return new HealthBar(opts);
  }

  // Add or update an entity's bar. Existing entity: position + hp
  // updated, fade timer reset. New entity: respects capacity (returns
  // -1 if pool full). Returns 0 (success-existing) or 1 (success-new)
  // or -1 (full).
  upsert(spawn: HealthBarSpawn): number {
    if (this.disposed) return -1;
    if (!spawn || typeof spawn.entityId !== 'string' || spawn.entityId.length === 0) return -1;
    var existing = this.byId.get(spawn.entityId);
    if (existing) {
      existing.x = spawn.x;
      existing.y = spawn.y;
      existing.hp = clamp(spawn.hp, 0, spawn.maxHp);
      existing.maxHp = spawn.maxHp > 0 ? spawn.maxHp : 0;
      existing.msSinceLastDelta = 0;
      return 0;
    }
    if (this.byId.size >= this.capacityNum) return -1;
    this.byId.set(spawn.entityId, {
      x: spawn.x,
      y: spawn.y,
      hp: clamp(spawn.hp, 0, spawn.maxHp),
      maxHp: spawn.maxHp > 0 ? spawn.maxHp : 0,
      msSinceLastDelta: 0,
      pulseRemainingMs: 0,
    });
    return 1;
  }

  // Move the bar without resetting the fade timer (typical
  // movement update).
  setPosition(entityId: string, x: number, y: number): boolean {
    if (this.disposed) return false;
    var entry = this.byId.get(entityId);
    if (!entry) return false;
    entry.x = x;
    entry.y = y;
    return true;
  }

  // Apply hp delta (negative = damage, positive = heal). Resets
  // fade timer and bumps the pulse. Returns false if entity not
  // present.
  applyDelta(entityId: string, hpDelta: number): boolean {
    if (this.disposed) return false;
    if (!isFinite(hpDelta) || hpDelta === 0) return false;
    var entry = this.byId.get(entityId);
    if (!entry) return false;
    entry.hp = clamp(entry.hp + hpDelta, 0, entry.maxHp);
    entry.msSinceLastDelta = 0;
    entry.pulseRemainingMs = this.pulseMs;
    return true;
  }

  remove(entityId: string): boolean {
    if (this.disposed) return false;
    return this.byId.delete(entityId);
  }

  clearAll(): void {
    if (this.disposed) return;
    this.byId.clear();
  }

  has(entityId: string): boolean {
    return this.byId.has(entityId);
  }

  activeCount(): number { return this.byId.size; }

  capacity(): number { return this.capacityNum; }

  // Advance every bar's timers; remove entries past removeAfterMs.
  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    var toRemove: string[] = [];
    var self = this;
    this.byId.forEach((entry, id) => {
      entry.msSinceLastDelta += dt;
      if (entry.pulseRemainingMs > 0) {
        entry.pulseRemainingMs -= dt;
        if (entry.pulseRemainingMs < 0) entry.pulseRemainingMs = 0;
      }
      if (entry.msSinceLastDelta >= self.removeAfterMs) {
        toRemove.push(id);
      }
    });
    for (var i = 0; i < toRemove.length; i++) this.byId.delete(toRemove[i] as string);
  }

  // Iterate active bars with computed render state. cb is wrapped
  // in try/catch so a misbehaving renderer doesn't break iteration.
  forEach(cb: (state: HealthBarRenderState) => void): void {
    if (this.disposed) return;
    var self = this;
    this.byId.forEach((entry, id) => {
      var state = self.makeRenderState(id, entry);
      try { cb(state); } catch { /* ignore */ }
    });
  }

  dispose(): void {
    this.byId.clear();
    this.disposed = true;
  }

  // ---------- private ----------

  private makeRenderState(id: string, e: InternalEntry): HealthBarRenderState {
    var pct = e.maxHp > 0 ? e.hp / e.maxHp : 0;
    if (pct < 0) pct = 0;
    if (pct > 1) pct = 1;
    var alpha = 1;
    if (e.msSinceLastDelta > this.fadeAfterMs) {
      var fadeT = (e.msSinceLastDelta - this.fadeAfterMs) / this.fadeDurationMs;
      if (fadeT < 0) fadeT = 0;
      if (fadeT > 1) fadeT = 1;
      alpha = 1 - fadeT;
    }
    var pulse = this.pulseMs > 0 ? e.pulseRemainingMs / this.pulseMs : 0;
    if (pulse < 0) pulse = 0;
    if (pulse > 1) pulse = 1;
    return {
      entityId: id,
      x: e.x,
      y: e.y,
      hp: e.hp,
      maxHp: e.maxHp,
      pct: pct,
      alpha: alpha,
      pulse: pulse,
      msSinceLastDelta: e.msSinceLastDelta,
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (!isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// Resource key for the world's resource registry.
export const RESOURCE_HEALTH_BAR = 'health_bar';
