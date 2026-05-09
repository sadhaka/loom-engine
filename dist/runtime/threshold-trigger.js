// ThresholdTrigger - value-crossing event emitter.
//
// 0.82.0 enabling primitive. "When HP drops below 25%, emit
// low-health-warning." "When XP crosses level threshold, level up."
// "When server queue exceeds N, throttle." All these patterns share
// a shape: a value over time crosses a threshold in a specified
// direction; emit once per crossing (with hysteresis so a value
// hovering at the line doesn't spam).
//
//   var trig = ThresholdTrigger.create();
//   trig.register({
//     id: 'low-hp',
//     threshold: 25,
//     direction: 'below',
//     hysteresis: 5, // re-arm only after climbing back to 30
//     onTrigger: () => audio.playLowHpAlarm(),
//   });
//   each frame: trig.update('low-hp', currentHpPercent);
//
// Triggers are re-armed automatically when the value moves back
// past `threshold +/- hysteresis` in the opposite direction.
//
// Pairs with EventBus (0.28) for downstream fan-out and StatStack
// (0.59) for per-stat thresholds.
//
// Code style: var-only in browser source.
export class ThresholdTrigger {
    entries = new Map();
    disposed = false;
    constructor() { }
    static create() {
        return new ThresholdTrigger();
    }
    register(spec) {
        if (this.disposed)
            return false;
        if (!spec || typeof spec.id !== 'string' || spec.id.length === 0)
            return false;
        if (typeof spec.threshold !== 'number' || !isFinite(spec.threshold))
            return false;
        if (spec.direction !== 'below' && spec.direction !== 'above')
            return false;
        if (this.entries.has(spec.id))
            return false;
        var copy = {
            id: spec.id,
            threshold: spec.threshold,
            direction: spec.direction,
        };
        if (spec.hysteresis !== undefined && isFinite(spec.hysteresis) && spec.hysteresis >= 0) {
            copy.hysteresis = spec.hysteresis;
        }
        if (spec.onTrigger)
            copy.onTrigger = spec.onTrigger;
        if (spec.onRearm)
            copy.onRearm = spec.onRearm;
        if (spec.data)
            copy.data = spec.data;
        this.entries.set(spec.id, {
            spec: copy,
            armed: true,
            triggered: false,
            lastValue: NaN,
        });
        return true;
    }
    unregister(id) {
        if (this.disposed)
            return false;
        return this.entries.delete(id);
    }
    has(id) { return this.entries.has(id); }
    // Apply a new value. Fires onTrigger if armed and the value
    // crosses the threshold in the configured direction. Fires
    // onRearm when value crosses back past `threshold +/- hysteresis`
    // in the opposite direction.
    update(id, value) {
        if (this.disposed)
            return false;
        var entry = this.entries.get(id);
        if (!entry)
            return false;
        if (typeof value !== 'number' || !isFinite(value))
            return false;
        var spec = entry.spec;
        var hyst = spec.hysteresis !== undefined ? spec.hysteresis : 0;
        var crossedDown = spec.direction === 'below' && value <= spec.threshold;
        var crossedUp = spec.direction === 'above' && value >= spec.threshold;
        var rearmDown = spec.direction === 'below' && value > spec.threshold + hyst;
        var rearmUp = spec.direction === 'above' && value < spec.threshold - hyst;
        entry.lastValue = value;
        if (entry.armed && (crossedDown || crossedUp)) {
            entry.armed = false;
            entry.triggered = true;
            if (spec.onTrigger) {
                try {
                    spec.onTrigger(value);
                }
                catch { /* ignore */ }
            }
        }
        else if (!entry.armed && (rearmDown || rearmUp)) {
            entry.armed = true;
            entry.triggered = false;
            if (spec.onRearm) {
                try {
                    spec.onRearm(value);
                }
                catch { /* ignore */ }
            }
        }
        return true;
    }
    // Force-reset to armed state (clears triggered flag).
    reset(id) {
        if (this.disposed)
            return false;
        var entry = this.entries.get(id);
        if (!entry)
            return false;
        entry.armed = true;
        entry.triggered = false;
        return true;
    }
    isArmed(id) {
        var e = this.entries.get(id);
        return e ? e.armed : false;
    }
    isTriggered(id) {
        var e = this.entries.get(id);
        return e ? e.triggered : false;
    }
    lastValueOf(id) {
        var e = this.entries.get(id);
        return e ? e.lastValue : NaN;
    }
    size() { return this.entries.size; }
    list() {
        var out = [];
        this.entries.forEach((e) => {
            var c = { id: e.spec.id, threshold: e.spec.threshold, direction: e.spec.direction };
            if (e.spec.hysteresis !== undefined)
                c.hysteresis = e.spec.hysteresis;
            if (e.spec.data)
                c.data = e.spec.data;
            out.push(c);
        });
        return out;
    }
    dispose() {
        this.entries.clear();
        this.disposed = true;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_THRESHOLD_TRIGGER = 'threshold_trigger';
//# sourceMappingURL=threshold-trigger.js.map