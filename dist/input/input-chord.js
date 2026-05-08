// InputChord - combo / sequence / double-tap / hold pattern recognition.
//
// 0.39.0 enabling primitive. InputActions (0.31.0) covers the
// "single key triggers an action" case. Chord adds the four common
// patterns InputActions can not express:
//
//   - 'combo'      — all keys held simultaneously (Ctrl+S, Shift+W).
//                    Fires once when the last key in the set comes
//                    down; re-arms after any key in the set comes up.
//   - 'sequence'   — keys pressed in order, each within `windowMs`
//                    of the prior. Fires once when the final key in
//                    the list lands. Timing-out resets to position 0.
//                    (Down-down-up street-fighter style is built on
//                    this; consumers can mix in direction-down keys.)
//   - 'doubleTap'  — the same key pressed twice within `windowMs`.
//                    Fires on the second key-down.
//   - 'hold'       — a single key held continuously for `holdMs`.
//                    Fires once when the threshold is reached;
//                    re-arms after key-up.
//
// Driving model matches InputActions: consumers wire `handleKeyDown`
// and `handleKeyUp` to whatever event source they have (DOM listener,
// gamepad poll, virtual dpad, etc.), call `tick(dtMs)` once per
// frame, and read `wasFired(name)` / subscribe via `onFired(name, cb)`.
//
// Code style: var-only in browser source.
const DEFAULT_WINDOW_MS = 500;
const DEFAULT_HOLD_MS = 500;
function safeFire(cb) {
    try {
        cb();
    }
    catch {
        // Best-effort: a misbehaving callback never takes down the
        // chord recognizer.
    }
}
export class InputChord {
    chords = new Map();
    // Reverse index: keyName -> set of chord names that watch it.
    // Speeds up handleKeyDown / handleKeyUp dispatch.
    keyToChords = new Map();
    // Define (or replace) a chord. Replacing resets all per-chord
    // recognition state.
    define(name, def) {
        var key = String(name);
        var existing = this.chords.get(key);
        if (existing) {
            // Drop reverse-index entries for the old definition.
            for (var i = 0; i < existing.keysArr.length; i++) {
                var ek = existing.keysArr[i];
                var revs = this.keyToChords.get(ek);
                if (revs) {
                    revs.delete(key);
                    if (revs.size === 0)
                        this.keyToChords.delete(ek);
                }
            }
        }
        var keysArr = Array.isArray(def.keys)
            ? def.keys.slice().filter(function (k) { return typeof k === 'string' && k.length > 0; })
            : (typeof def.keys === 'string' && def.keys.length > 0 ? [def.keys] : []);
        var entry = {
            def: def,
            keysArr: keysArr,
            windowMs: def.windowMs !== undefined && def.windowMs > 0 ? def.windowMs : DEFAULT_WINDOW_MS,
            holdMs: def.holdMs !== undefined && def.holdMs > 0 ? def.holdMs : DEFAULT_HOLD_MS,
            comboHeld: new Set(),
            comboSatisfied: false,
            sequenceIdx: 0,
            sequenceClockMs: 0,
            holdKey: null,
            holdClockMs: 0,
            holdFiredOnThisHeld: false,
            firedThisFrame: false,
            callbacks: new Set(),
        };
        this.chords.set(key, entry);
        // Add reverse-index entries.
        for (var j = 0; j < keysArr.length; j++) {
            var k2 = keysArr[j];
            var revs2 = this.keyToChords.get(k2);
            if (!revs2) {
                revs2 = new Set();
                this.keyToChords.set(k2, revs2);
            }
            revs2.add(key);
        }
    }
    undefine(name) {
        var key = String(name);
        var entry = this.chords.get(key);
        if (!entry)
            return false;
        for (var i = 0; i < entry.keysArr.length; i++) {
            var k = entry.keysArr[i];
            var revs = this.keyToChords.get(k);
            if (revs) {
                revs.delete(key);
                if (revs.size === 0)
                    this.keyToChords.delete(k);
            }
        }
        this.chords.delete(key);
        return true;
    }
    has(name) {
        return this.chords.has(String(name));
    }
    // Subscribe to a chord's firings. Returns an unsubscribe function.
    // Subscribing before the chord is defined is allowed; the
    // subscription survives `define` replacing the chord. (Actually
    // no — we keep callbacks on the entry. If you replace, callbacks
    // are dropped along with the entry. Document that.)
    onFired(name, cb) {
        var entry = this.chords.get(String(name));
        if (!entry)
            return function () { };
        entry.callbacks.add(cb);
        return () => {
            var e = this.chords.get(String(name));
            if (e)
                e.callbacks.delete(cb);
        };
    }
    handleKeyDown(key) {
        var k = String(key);
        // Combo + hold + doubleTap: dispatch via reverse index (only
        // chords watching THIS specific key need updating).
        var revs = this.keyToChords.get(k);
        if (revs) {
            revs.forEach((name) => {
                var entry = this.chords.get(name);
                if (!entry)
                    return;
                var def = entry.def;
                if (def.kind === 'combo') {
                    if (entry.comboHeld.has(k))
                        return;
                    entry.comboHeld.add(k);
                    if (entry.comboHeld.size === entry.keysArr.length && !entry.comboSatisfied) {
                        entry.comboSatisfied = true;
                        this.fire(entry);
                    }
                }
                else if (def.kind === 'doubleTap') {
                    var dtKey = entry.keysArr[0];
                    if (k !== dtKey)
                        return;
                    if (entry.sequenceIdx === 1 && entry.sequenceClockMs <= entry.windowMs) {
                        entry.sequenceIdx = 0;
                        entry.sequenceClockMs = 0;
                        this.fire(entry);
                    }
                    else {
                        entry.sequenceIdx = 1;
                        entry.sequenceClockMs = 0;
                    }
                }
                else if (def.kind === 'hold') {
                    var holdK = entry.keysArr[0];
                    if (k !== holdK)
                        return;
                    if (entry.holdKey === null) {
                        entry.holdKey = k;
                        entry.holdClockMs = 0;
                        entry.holdFiredOnThisHeld = false;
                    }
                }
            });
        }
        // Sequences need a full scan: any wrong key (watched OR unwatched)
        // resets the sequence. This is what distinguishes 'sequence' from
        // doubleTap (which tolerates unrelated keys in between).
        this.chords.forEach((entry) => {
            if (entry.def.kind !== 'sequence')
                return;
            var expected = entry.keysArr[entry.sequenceIdx];
            if (k === expected) {
                entry.sequenceIdx++;
                entry.sequenceClockMs = 0;
                if (entry.sequenceIdx >= entry.keysArr.length) {
                    entry.sequenceIdx = 0;
                    this.fire(entry);
                }
            }
            else {
                // Mismatch: reset; if the wrong key is the FIRST key of the
                // sequence, count it as the start of a fresh attempt.
                entry.sequenceIdx = 0;
                entry.sequenceClockMs = 0;
                if (k === entry.keysArr[0]) {
                    entry.sequenceIdx = 1;
                    if (entry.sequenceIdx >= entry.keysArr.length) {
                        entry.sequenceIdx = 0;
                        this.fire(entry);
                    }
                }
            }
        });
    }
    handleKeyUp(key) {
        var k = String(key);
        var revs = this.keyToChords.get(k);
        if (!revs)
            return;
        revs.forEach((name) => {
            var entry = this.chords.get(name);
            if (!entry)
                return;
            var def = entry.def;
            if (def.kind === 'combo') {
                if (entry.comboHeld.has(k)) {
                    entry.comboHeld.delete(k);
                    // Re-arm: any key release resets the satisfied flag so the
                    // chord can fire again next time all keys are held.
                    entry.comboSatisfied = false;
                }
            }
            else if (def.kind === 'hold') {
                if (entry.holdKey === k) {
                    entry.holdKey = null;
                    entry.holdClockMs = 0;
                    entry.holdFiredOnThisHeld = false;
                }
            }
            // Sequences + double-tap don't track key-up; they fire on
            // key-down only.
        });
    }
    // Drop all held state. Useful on window blur. Does NOT undefine
    // chords; only clears in-flight recognition state.
    releaseAll() {
        this.chords.forEach((entry) => {
            entry.comboHeld.clear();
            entry.comboSatisfied = false;
            entry.sequenceIdx = 0;
            entry.sequenceClockMs = 0;
            entry.holdKey = null;
            entry.holdClockMs = 0;
            entry.holdFiredOnThisHeld = false;
        });
    }
    // Per-frame tick. Clears `firedThisFrame` from the PRIOR frame
    // first, then advances hold + sequence clocks (which may set
    // `firedThisFrame` again if a hold reaches threshold during this
    // tick). The freshly-set flag stays true until the NEXT tick().
    tick(dtMs) {
        // Always clear at the start so previous-frame fires age out.
        this.chords.forEach((entry) => { entry.firedThisFrame = false; });
        if (dtMs <= 0)
            return;
        this.chords.forEach((entry) => {
            var def = entry.def;
            // Hold: advance clock if a hold key is down; fire when threshold
            // reached (once per held cycle).
            if (def.kind === 'hold' && entry.holdKey !== null) {
                entry.holdClockMs += dtMs;
                if (!entry.holdFiredOnThisHeld && entry.holdClockMs >= entry.holdMs) {
                    entry.holdFiredOnThisHeld = true;
                    this.fire(entry);
                }
            }
            // Sequence + doubleTap: age the window clock; reset if expired.
            if ((def.kind === 'sequence' || def.kind === 'doubleTap') && entry.sequenceIdx > 0) {
                entry.sequenceClockMs += dtMs;
                if (entry.sequenceClockMs > entry.windowMs) {
                    entry.sequenceIdx = 0;
                    entry.sequenceClockMs = 0;
                }
            }
        });
    }
    // True if `name` fired during the current frame. Reset by tick().
    wasFired(name) {
        var entry = this.chords.get(String(name));
        return entry ? entry.firedThisFrame : false;
    }
    chordNames() {
        var out = [];
        this.chords.forEach((_e, name) => out.push(name));
        return out;
    }
    // Drop all chord definitions. Same effect as undefine() on each.
    clear() {
        this.chords.clear();
        this.keyToChords.clear();
    }
    stats() {
        return {
            chords: this.chords.size,
            keysWatched: this.keyToChords.size,
        };
    }
    // ---------- private ----------
    fire(entry) {
        entry.firedThisFrame = true;
        entry.callbacks.forEach(safeFire);
    }
}
// Resource key for the world-attached input chord recognizer.
export const RESOURCE_INPUT_CHORD = 'loom.input_chord';
//# sourceMappingURL=input-chord.js.map