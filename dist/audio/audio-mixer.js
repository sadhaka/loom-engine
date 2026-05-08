// AudioMixer - engine-side animation layer on top of AudioBus.
//
// 0.35.0 enabling primitive. AudioBus (Phase 5) already exposes
// master gain + per-bus gain + mute + VE-budget priority floors,
// and MusicDirector (Phase 17) does fade/crossfade for the music
// channel only. AudioMixer fills the rest of the gap:
//
//   - fadeBus / fadeMaster: animate any bus / master to a target
//     gain over time with an easing curve.
//   - crossfade: simultaneously fade one bus down and another up.
//   - snapshot / restore: capture the current bus + master gains
//     under a name, switch to a different mix, restore later (with
//     or without fade).
//   - pushDuck / releaseDuck: named, attack-and-release multipliers
//     applied to a target bus. Lowest scalar wins when multiple
//     ducks stack on the same bus. Useful for "duck music while
//     voice plays" without coupling the systems together.
//
// Why engine-side animation (driven by tick(dt)) instead of Web
// Audio AudioParam ramps:
//   - Tests can run against the same FakeAudioContext mocks the
//     rest of the audio module uses; no need to schedule on a
//     real audio clock.
//   - Behavior is deterministic against the engine clock, so future
//     EngineClock pause / timeScale (0.25.0) propagates for free
//     once consumers tick the mixer through that clock.
//   - Snapshot semantics are clean: snapshot captures the *target*
//     gains, never the in-flight value.
//
// AudioBus is the only thing that talks to Web Audio. AudioMixer
// computes the effective gain per tick (target * lowest duck
// multiplier) and pushes it via AudioBus.setBusGain / setMasterGain.
// Consumers should let the mixer be the only writer to bus gains
// while it is in use; direct setBusGain calls will be overwritten
// on the next tick.
//
// Code style: var-only in browser source, matches cue-catalog.ts.
import { Easings } from '../runtime/tween.js';
function resolveEasing(easing) {
    if (typeof easing === 'function')
        return easing;
    if (typeof easing === 'string') {
        var fn = Easings[easing];
        if (fn)
            return fn;
    }
    return Easings.linear;
}
function safeFire(cb) {
    if (!cb)
        return;
    try {
        cb();
    }
    catch {
        // Best-effort: a misbehaving callback never takes down the mixer.
    }
}
export class AudioMixer {
    bus;
    busFades = new Map();
    masterFade = null;
    busTargets = new Map();
    masterTarget;
    snapshots = new Map();
    ducks = new Map();
    disposed = false;
    constructor(opts) {
        this.bus = opts.bus;
        this.masterTarget = opts.bus.getMasterGain();
        // Seed targets from the live bus state. listBuses (added 0.35.0)
        // gives the canonical insertion order.
        var names = opts.bus.listBuses();
        for (var i = 0; i < names.length; i++) {
            var n = names[i];
            this.busTargets.set(n, opts.bus.getBusGain(n));
        }
    }
    static create(opts) {
        return new AudioMixer(opts);
    }
    // Animate a bus toward `target` over `opts.durationMs`. Cancels any
    // in-flight fade on the same bus (re-targeting from the current
    // value). No-op if the bus does not exist on the underlying AudioBus.
    fadeBus(name, target, opts) {
        if (this.disposed)
            return;
        if (!this.bus.hasBus(name))
            return;
        var clamped = target > 0 ? target : 0;
        var current = this.getEffectiveBusTarget(name);
        if (opts.durationMs <= 0) {
            this.busFades.delete(name);
            this.busTargets.set(name, clamped);
            this.applyBus(name);
            safeFire(opts.onComplete);
            return;
        }
        this.busFades.set(name, {
            startGain: current,
            targetGain: clamped,
            durationMs: opts.durationMs,
            elapsedMs: 0,
            easing: resolveEasing(opts.easing),
            onComplete: opts.onComplete,
        });
    }
    // Animate the master gain toward `target` over `opts.durationMs`.
    fadeMaster(target, opts) {
        if (this.disposed)
            return;
        var clamped = target > 0 ? target : 0;
        if (opts.durationMs <= 0) {
            this.masterFade = null;
            this.masterTarget = clamped;
            this.bus.setMasterGain(clamped);
            safeFire(opts.onComplete);
            return;
        }
        var current = this.masterTarget;
        this.masterFade = {
            startGain: current,
            targetGain: clamped,
            durationMs: opts.durationMs,
            elapsedMs: 0,
            easing: resolveEasing(opts.easing),
            onComplete: opts.onComplete,
        };
    }
    // Fade `fromBus` to 0 and `toBus` to `toTarget` simultaneously. Both
    // fades use `opts.durationMs` and `opts.easing`. The onComplete (if
    // any) fires once after the toBus side reaches its target.
    crossfade(fromBus, toBus, toTarget, opts) {
        if (this.disposed)
            return;
        // Build options without undefined fields so exactOptionalPropertyTypes
        // accepts them.
        var fromOpts = { durationMs: opts.durationMs };
        var toOpts = { durationMs: opts.durationMs };
        if (opts.easing !== undefined) {
            fromOpts.easing = opts.easing;
            toOpts.easing = opts.easing;
        }
        if (opts.onComplete !== undefined) {
            toOpts.onComplete = opts.onComplete;
        }
        this.fadeBus(fromBus, 0, fromOpts);
        this.fadeBus(toBus, toTarget, toOpts);
    }
    // Capture the current target gains under `key`. Subsequent restore
    // calls replay these targets.
    snapshot(key) {
        if (this.disposed)
            return;
        var buses = {};
        var names = this.bus.listBuses();
        for (var i = 0; i < names.length; i++) {
            var n = names[i];
            buses[n] = this.getEffectiveBusTarget(n);
        }
        this.snapshots.set(key, {
            master: this.masterTarget,
            buses: buses,
        });
    }
    hasSnapshot(key) {
        return this.snapshots.has(key);
    }
    // Restore a previously captured snapshot. Without `opts` the gains
    // jump immediately. With `opts.durationMs > 0` every bus + master
    // animates back to its snapshotted target. No-op if the snapshot
    // does not exist.
    restore(key, opts) {
        if (this.disposed)
            return;
        var snap = this.snapshots.get(key);
        if (!snap)
            return;
        var fadeMs = opts && opts.durationMs > 0 ? opts.durationMs : 0;
        var easing = opts ? opts.easing : undefined;
        if (fadeMs > 0) {
            var masterOpts = { durationMs: fadeMs };
            if (easing !== undefined)
                masterOpts.easing = easing;
            this.fadeMaster(snap.master, masterOpts);
            var entries = Object.keys(snap.buses);
            for (var i = 0; i < entries.length; i++) {
                var n = entries[i];
                var v = snap.buses[n] ?? 0;
                var busOpts = { durationMs: fadeMs };
                if (easing !== undefined)
                    busOpts.easing = easing;
                this.fadeBus(n, v, busOpts);
            }
            return;
        }
        // Instant.
        this.masterFade = null;
        this.masterTarget = snap.master;
        this.bus.setMasterGain(snap.master);
        var keys = Object.keys(snap.buses);
        for (var j = 0; j < keys.length; j++) {
            var nm = keys[j];
            var v2 = snap.buses[nm] ?? 0;
            this.busFades.delete(nm);
            this.busTargets.set(nm, v2);
            this.applyBus(nm);
        }
    }
    clearSnapshot(key) {
        this.snapshots.delete(key);
    }
    // Apply a named duck to `busName`. Multiple ducks can stack on the
    // same bus; the lowest current multiplier wins. Re-pushing under
    // an existing key replaces that duck's parameters and resets state.
    pushDuck(key, busName, opts) {
        if (this.disposed)
            return;
        if (!this.bus.hasBus(busName))
            return;
        var attack = opts.attackMs > 0 ? opts.attackMs : 0;
        var release = opts.releaseMs > 0 ? opts.releaseMs : 0;
        var sc = opts.scalar > 0 ? opts.scalar : 0;
        this.ducks.set(key, {
            busName: busName,
            scalar: sc,
            attackMs: attack,
            releaseMs: release,
            easing: resolveEasing(opts.easing),
            state: attack > 0 ? 'attacking' : 'held',
            elapsedMs: 0,
        });
        this.applyBus(busName);
    }
    // Begin the release ramp on the named duck. Once the release ramp
    // completes the duck is removed. No-op if the duck doesn't exist.
    releaseDuck(key) {
        if (this.disposed)
            return;
        var d = this.ducks.get(key);
        if (!d)
            return;
        if (d.releaseMs <= 0) {
            this.ducks.delete(key);
            this.applyBus(d.busName);
            return;
        }
        d.state = 'releasing';
        d.elapsedMs = 0;
    }
    hasDuck(key) {
        return this.ducks.has(key);
    }
    // True iff the bus has an active fade animation.
    isFading(name) {
        return this.busFades.has(name);
    }
    isMasterFading() {
        return this.masterFade !== null;
    }
    // Read the bus's current target gain (the value the mixer is
    // animating toward, or already at). Useful for tests + debug HUD.
    getBusTarget(name) {
        return this.busTargets.get(name) ?? this.bus.getBusGain(name);
    }
    getMasterTarget() {
        return this.masterTarget;
    }
    // Advance all in-flight fades and ducks by `dtMs` milliseconds and
    // push the resulting effective gain to AudioBus. Idempotent: tick(0)
    // is a no-op.
    tick(dtMs) {
        if (this.disposed)
            return;
        if (dtMs <= 0)
            return;
        // 1. Advance bus fades; collect completion + affected names.
        var doneNames = [];
        var doneCallbacks = [];
        var inFlightNames = [];
        var fadeIter = this.busFades.entries();
        var step = fadeIter.next();
        while (!step.done) {
            var entry = step.value;
            var name = entry[0];
            var fade = entry[1];
            fade.elapsedMs += dtMs;
            if (fade.elapsedMs >= fade.durationMs) {
                this.busTargets.set(name, fade.targetGain);
                doneNames.push(name);
                if (fade.onComplete)
                    doneCallbacks.push(fade.onComplete);
            }
            else {
                var t = fade.elapsedMs / fade.durationMs;
                var eased = fade.easing(t);
                var v = fade.startGain + (fade.targetGain - fade.startGain) * eased;
                this.busTargets.set(name, v);
                inFlightNames.push(name);
            }
            step = fadeIter.next();
        }
        for (var i = 0; i < doneNames.length; i++) {
            this.busFades.delete(doneNames[i]);
        }
        // 2. Advance master fade.
        var masterDone = null;
        if (this.masterFade) {
            var mf = this.masterFade;
            mf.elapsedMs += dtMs;
            if (mf.elapsedMs >= mf.durationMs) {
                this.masterTarget = mf.targetGain;
                this.bus.setMasterGain(mf.targetGain);
                masterDone = mf.onComplete ?? null;
                this.masterFade = null;
            }
            else {
                var mt = mf.elapsedMs / mf.durationMs;
                var mEased = mf.easing(mt);
                var mv = mf.startGain + (mf.targetGain - mf.startGain) * mEased;
                this.masterTarget = mv;
                this.bus.setMasterGain(mv);
            }
        }
        // 3. Advance ducks; collect any whose release completed.
        var doneDuckKeys = [];
        var duckedBuses = new Set();
        var duckIter = this.ducks.entries();
        var dStep = duckIter.next();
        while (!dStep.done) {
            var dEntry = dStep.value;
            var dKey = dEntry[0];
            var duck = dEntry[1];
            duck.elapsedMs += dtMs;
            if (duck.state === 'attacking' && duck.elapsedMs >= duck.attackMs) {
                duck.state = 'held';
                duck.elapsedMs = 0;
            }
            else if (duck.state === 'releasing' && duck.elapsedMs >= duck.releaseMs) {
                doneDuckKeys.push(dKey);
            }
            duckedBuses.add(duck.busName);
            dStep = duckIter.next();
        }
        for (var di = 0; di < doneDuckKeys.length; di++) {
            this.ducks.delete(doneDuckKeys[di]);
        }
        // 4. Apply all affected buses (in-flight fades, just-completed
        //    fades, and any bus with an active duck whose multiplier may
        //    have shifted this tick).
        var affected = new Set();
        for (var ai = 0; ai < inFlightNames.length; ai++) {
            affected.add(inFlightNames[ai]);
        }
        for (var aj = 0; aj < doneNames.length; aj++) {
            affected.add(doneNames[aj]);
        }
        duckedBuses.forEach(function (n) { affected.add(n); });
        affected.forEach((n) => { this.applyBus(n); });
        // 5. Fire fade-completion callbacks now that the bus state has
        //    settled. Master callback fires after master gain was set.
        for (var ci = 0; ci < doneCallbacks.length; ci++) {
            safeFire(doneCallbacks[ci]);
        }
        if (masterDone)
            safeFire(masterDone);
    }
    // Tear down. Clears all in-flight fades, ducks, and snapshots; the
    // underlying AudioBus is NOT disposed (the mixer does not own it).
    // After dispose, all mutating methods become no-ops.
    dispose() {
        this.busFades.clear();
        this.masterFade = null;
        this.snapshots.clear();
        this.ducks.clear();
        this.disposed = true;
    }
    // ---------- private ----------
    getEffectiveBusTarget(name) {
        var t = this.busTargets.get(name);
        if (t !== undefined)
            return t;
        return this.bus.getBusGain(name);
    }
    applyBus(name) {
        if (!this.bus.hasBus(name))
            return;
        var target = this.getEffectiveBusTarget(name);
        var multiplier = this.computeDuckMultiplier(name);
        var effective = target * multiplier;
        if (effective < 0)
            effective = 0;
        this.bus.setBusGain(name, effective);
    }
    computeDuckMultiplier(busName) {
        var minMul = 1;
        var iter = this.ducks.values();
        var step = iter.next();
        while (!step.done) {
            var duck = step.value;
            if (duck.busName === busName) {
                var m = 1;
                if (duck.state === 'attacking') {
                    var t = duck.attackMs > 0
                        ? Math.min(1, duck.elapsedMs / duck.attackMs)
                        : 1;
                    m = 1 + (duck.scalar - 1) * duck.easing(t);
                }
                else if (duck.state === 'held') {
                    m = duck.scalar;
                }
                else {
                    // releasing: scalar -> 1.
                    var rt = duck.releaseMs > 0
                        ? Math.min(1, duck.elapsedMs / duck.releaseMs)
                        : 1;
                    m = duck.scalar + (1 - duck.scalar) * duck.easing(rt);
                }
                if (m < minMul)
                    minMul = m;
            }
            step = iter.next();
        }
        return minMul;
    }
}
// Resource key for the world's resource registry. Engine consumers
// register an AudioMixer instance under this key alongside the bus.
export const RESOURCE_AUDIO_MIXER = 'audio_mixer';
//# sourceMappingURL=audio-mixer.js.map