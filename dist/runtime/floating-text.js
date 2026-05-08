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
const DEFAULT_CAPACITY = 64;
const DEFAULT_LIFETIME_MS = 800;
const DEFAULT_VY = -60;
const DEFAULT_AY = 80;
const DEFAULT_COLOR = 0xffffff;
export class FloatingText {
    slots;
    activeIndices = new Set();
    nextSearch = 0;
    capacityNum;
    defaults;
    disposed = false;
    constructor(opts) {
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
    static create(opts) {
        return new FloatingText(opts ?? {});
    }
    // Emit a floating text. Returns the slot index (>= 0) on success,
    // -1 if the pool is full or the system is disposed.
    emit(spawn) {
        if (this.disposed)
            return -1;
        var idx = this.findFreeSlot();
        if (idx < 0)
            return -1;
        var slot = this.slots[idx];
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
    tick(dtMs) {
        if (this.disposed)
            return;
        if (dtMs <= 0)
            return;
        var dtSec = dtMs / 1000;
        var doneIndices = [];
        var iter = this.activeIndices.values();
        var step = iter.next();
        while (!step.done) {
            var i = step.value;
            var slot = this.slots[i];
            slot.ageMs += dtMs;
            if (slot.ageMs >= slot.lifetimeMs) {
                doneIndices.push(i);
            }
            else {
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
            this.deactivate(doneIndices[di]);
        }
    }
    // Iterate active texts and call cb with each one's render state.
    // The callback should NOT mutate the system (e.g. emit / clearAll
    // during iteration). The render state is rebuilt each call so the
    // consumer can stash references safely within the callback.
    forEach(cb) {
        if (this.disposed)
            return;
        var iter = this.activeIndices.values();
        var step = iter.next();
        while (!step.done) {
            var i = step.value;
            var slot = this.slots[i];
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
            }
            catch {
                // Best-effort: a misbehaving renderer never takes down the
                // floating-text system. Production builds should wrap their
                // own logger around the cb body.
            }
            step = iter.next();
        }
    }
    activeCount() {
        return this.activeIndices.size;
    }
    capacity() {
        return this.capacityNum;
    }
    // Remove all active texts immediately. Useful on scene transition
    // or pause-and-clear.
    clearAll() {
        if (this.disposed)
            return;
        var arr = Array.from(this.activeIndices);
        for (var i = 0; i < arr.length; i++) {
            this.deactivate(arr[i]);
        }
    }
    dispose() {
        if (this.disposed)
            return;
        this.activeIndices.clear();
        for (var i = 0; i < this.slots.length; i++) {
            this.slots[i].active = false;
        }
        this.disposed = true;
    }
    // ---------- private ----------
    findFreeSlot() {
        var n = this.capacityNum;
        // Round-robin search starting from nextSearch so we don't keep
        // hitting the head of the array.
        for (var k = 0; k < n; k++) {
            var i = (this.nextSearch + k) % n;
            if (!this.slots[i].active) {
                this.nextSearch = (i + 1) % n;
                return i;
            }
        }
        return -1;
    }
    deactivate(idx) {
        var slot = this.slots[idx];
        slot.active = false;
        this.activeIndices.delete(idx);
    }
    computeAlpha(slot) {
        var t = slot.lifetimeMs > 0 ? slot.ageMs / slot.lifetimeMs : 1;
        if (t < 0)
            t = 0;
        if (t > 1)
            t = 1;
        var fadeIn = this.defaults.fadeStart;
        var fadeOut = this.defaults.fadeEnd;
        var alpha = 1;
        if (fadeIn > 0 && t < fadeIn) {
            alpha = t / fadeIn;
        }
        else if (fadeOut > 0 && t > 1 - fadeOut) {
            alpha = (1 - t) / fadeOut;
        }
        if (alpha < 0)
            alpha = 0;
        if (alpha > 1)
            alpha = 1;
        return alpha;
    }
}
function makeEmptySlot() {
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
function clamp01(v) {
    if (v < 0)
        return 0;
    if (v > 1)
        return 1;
    return v;
}
// Resource key for the world's resource registry. Engine consumers
// register a FloatingText instance under this key alongside their
// HUD layer.
export const RESOURCE_FLOATING_TEXT = 'floating_text';
//# sourceMappingURL=floating-text.js.map