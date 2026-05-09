// DamageFlash - per-entity tint reaction on hit.
//
// 0.93.0 enabling primitive. The "white flash" or "red flash" the
// player sees the instant their character (or a boss) takes a hit.
// Standalone from HealthBar (0.80) which renders the bar; this
// renders a per-frame TINT applied to the entity's sprite.
// Renderers consume `forEach` and multiply their sprite color by
// the flash color weighted by alpha.
//
//   var flash = DamageFlash.create({
//     defaultColor:      0xffffff,
//     defaultDurationMs: 120,
//   });
//   on hit: flash.flash({ entityId: 'mob42' });
//   each frame: flash.tick(dtMs);
//               flash.forEach((s) => renderer.tintEntity(
//                 s.entityId, s.color, s.alpha));
//
// Pairs with HealthBar (0.80), DamageNumberPipeline (0.72), and
// DamageFormula (0.66). Like FloatingText (0.37) it ships ZERO
// rendering - the tint application is the consumer's call.
//
// Code style: var-only in browser source.
const DEFAULT_CAPACITY = 64;
const DEFAULT_COLOR = 0xffffff;
const DEFAULT_DURATION_MS = 150;
export class DamageFlash {
    byId = new Map();
    capacityNum;
    defaultColor;
    defaultDurationMs;
    disposed = false;
    constructor(opts) {
        this.capacityNum = opts.capacity !== undefined && isFinite(opts.capacity)
            && opts.capacity > 0
            ? Math.floor(opts.capacity) : DEFAULT_CAPACITY;
        this.defaultColor = opts.defaultColor !== undefined
            ? opts.defaultColor : DEFAULT_COLOR;
        this.defaultDurationMs = opts.defaultDurationMs !== undefined
            && isFinite(opts.defaultDurationMs)
            && opts.defaultDurationMs > 0
            ? opts.defaultDurationMs : DEFAULT_DURATION_MS;
    }
    static create(opts = {}) {
        return new DamageFlash(opts);
    }
    // Trigger or refresh a flash on `entityId`. Re-flashing an entity
    // already flashing OVERWRITES the prior flash (resets age + uses
    // the new color/duration). Returns true on success; false on
    // capacity full (and entity not already in pool).
    flash(spawn) {
        if (this.disposed)
            return false;
        if (!spawn || typeof spawn.entityId !== 'string'
            || spawn.entityId.length === 0)
            return false;
        var existing = this.byId.get(spawn.entityId);
        if (!existing && this.byId.size >= this.capacityNum) {
            return false;
        }
        var color = spawn.color !== undefined ? spawn.color : this.defaultColor;
        var dur;
        if (spawn.durationMs !== undefined && isFinite(spawn.durationMs)
            && spawn.durationMs > 0) {
            dur = spawn.durationMs;
        }
        else {
            dur = this.defaultDurationMs;
        }
        var intensity = spawn.intensity !== undefined
            && isFinite(spawn.intensity)
            ? spawn.intensity : 1;
        if (intensity < 0)
            intensity = 0;
        if (intensity > 1)
            intensity = 1;
        if (existing) {
            existing.color = color;
            existing.durationMs = dur;
            existing.intensity = intensity;
            existing.ageMs = 0;
        }
        else {
            this.byId.set(spawn.entityId, {
                color: color,
                durationMs: dur,
                intensity: intensity,
                ageMs: 0,
            });
        }
        return true;
    }
    // Manually remove an entity's flash.
    remove(entityId) {
        if (this.disposed)
            return false;
        return this.byId.delete(entityId);
    }
    has(entityId) { return this.byId.has(entityId); }
    activeCount() { return this.byId.size; }
    capacity() { return this.capacityNum; }
    // Advance every flash's age by dtMs. Entries whose age >= duration
    // are removed.
    tick(dtMs) {
        if (this.disposed)
            return;
        var dt = +dtMs;
        if (!isFinite(dt) || dt <= 0)
            return;
        var toRemove = [];
        this.byId.forEach((entry, id) => {
            entry.ageMs += dt;
            if (entry.ageMs >= entry.durationMs)
                toRemove.push(id);
        });
        for (var i = 0; i < toRemove.length; i++) {
            this.byId.delete(toRemove[i]);
        }
    }
    // Iterate active flashes with the renderer state. Throwing
    // callbacks are isolated.
    forEach(cb) {
        if (this.disposed)
            return;
        var self = this;
        this.byId.forEach((entry, id) => {
            var alpha = self.computeAlpha(entry);
            var state = {
                entityId: id,
                color: entry.color,
                alpha: alpha,
                intensity: entry.intensity,
                ageMs: entry.ageMs,
                durationMs: entry.durationMs,
            };
            try {
                cb(state);
            }
            catch { /* ignore */ }
        });
    }
    clearAll() {
        if (this.disposed)
            return;
        this.byId.clear();
    }
    dispose() {
        this.byId.clear();
        this.disposed = true;
    }
    // ---------- private ----------
    // Linear falloff: alpha = intensity * (1 - ageMs / durationMs).
    // Renderers wanting custom curves intercept getOffset + their own
    // time read.
    computeAlpha(entry) {
        if (entry.durationMs <= 0)
            return 0;
        var t = entry.ageMs / entry.durationMs;
        if (t < 0)
            t = 0;
        if (t > 1)
            t = 1;
        var a = entry.intensity * (1 - t);
        if (a < 0)
            a = 0;
        if (a > 1)
            a = 1;
        return a;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_DAMAGE_FLASH = 'damage_flash';
//# sourceMappingURL=damage-flash.js.map