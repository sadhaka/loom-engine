// AudioBus - simple Web Audio mixer for the Loom Engine.
//
// Architecture:
//   master (GainNode, output -> destination)
//     |- 'sfx'   sub-bus
//     |- 'music' sub-bus
//     |- 'voice' sub-bus
//     |- 'ui'    sub-bus
//
// Sub-buses are GainNodes that route into master. Sound-source code
// connects an AudioNode to bus.input(name) and the bus handles routing
// + per-bus gain + per-bus mute. New named buses can be created via
// addBus(name, opts).
//
// Lazy unlock: browsers block AudioContext until the first user
// gesture. AudioBus.create() does NOT auto-resume the context;
// callers must call unlock() inside a click / touchstart / keydown
// handler or use a UI prompt. Calling play* before unlock returns
// silently with no error - production builds want a single warning
// in the console; v1 keeps it quiet to avoid spam.
//
// VE-budget gating per LOOM-ENGINE-SPEC.md Section 3 / Phase 5: the
// caller passes the VeilBudget audioBudget into setMasterAudioBudget
// each tick (or on Director updates). When the budget drops below
// the priority floor for a bus, that bus mutes. Default tier order:
//   essential (always plays):    sfx, voice
//   ambient (mutes under load):  music, ui
//
// Inspirations (per PRIOR-ART.md):
//   Web Audio API W3C spec - public technique, no patent IP
//   Gain bus pattern - canonical (FMOD, Wwise, Web Audio docs)
//   Priority-tiered ducking - common in game audio engines, not
//   patented as a pattern; Loom-specific is the VE-budget driver
const DEFAULT_BUSES = [
    { name: 'sfx', opts: { initialGain: 1.0, priority: 'essential' } },
    { name: 'music', opts: { initialGain: 0.6, priority: 'ambient' } },
    { name: 'voice', opts: { initialGain: 1.0, priority: 'essential' } },
    { name: 'ui', opts: { initialGain: 0.8, priority: 'ambient' } },
];
// Budget thresholds. When VeilBudget.audioBudget drops below the
// 'ambient' threshold, ambient buses mute. When it drops below
// 'essential', everything mutes (engine still runs in silence).
// These are arbitrary scalars; the Director's budget value should be
// in [0, 1] where 1 is "all good".
export const AUDIO_BUDGET_AMBIENT_FLOOR = 0.25;
export const AUDIO_BUDGET_ESSENTIAL_FLOOR = 0.05;
export class AudioBus {
    ctx;
    master;
    buses = new Map();
    masterGain = 1;
    currentBudget = 1.0;
    suspended = true;
    constructor(ctx) {
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = this.masterGain;
        this.master.connect(ctx.destination);
        for (const def of DEFAULT_BUSES) {
            this.addBus(def.name, def.opts);
        }
    }
    // Construct from an existing AudioContext (tests pass mocks) or
    // let the bus create one. Browser autoplay policy means the new
    // context starts suspended.
    static create(ctx) {
        if (ctx) {
            return new AudioBus(ctx);
        }
        if (typeof AudioContext === 'undefined') {
            throw new Error('AudioBus.create: AudioContext is unavailable in this environment');
        }
        return new AudioBus(new AudioContext());
    }
    // Resume the AudioContext after a user gesture. Returns a promise
    // that settles when the context is running. Calling more than once
    // is safe.
    async unlock() {
        if (this.ctx.state === 'running') {
            this.suspended = false;
            return;
        }
        try {
            await this.ctx.resume();
            this.suspended = this.ctx.state !== 'running';
        }
        catch {
            // Already-suspended contexts that fail resume are usually a
            // policy issue; nothing the engine can do beyond surface it.
            this.suspended = true;
        }
    }
    isUnlocked() {
        return !this.suspended && this.ctx.state === 'running';
    }
    // Public: a node a sound source connects to so the bus routes its
    // output through master. Returns the bus's input GainNode; users
    // call audioSource.connect(bus.input('sfx')).
    input(name) {
        const entry = this.buses.get(name);
        if (!entry) {
            throw new Error('AudioBus.input: unknown bus "' + name + '"');
        }
        return entry.node;
    }
    hasBus(name) {
        return this.buses.has(name);
    }
    // Enumerate registered bus names. Stable insertion order via Map.
    // Added in 0.35.0 so AudioMixer can snapshot all buses without
    // tracking them externally; existing AudioBus consumers ignored it.
    listBuses() {
        return Array.from(this.buses.keys());
    }
    addBus(name, opts = {}) {
        if (this.buses.has(name))
            return; // idempotent
        const node = this.ctx.createGain();
        const initial = opts.initialGain ?? 1.0;
        node.gain.value = initial;
        node.connect(this.master);
        this.buses.set(name, {
            node,
            baseGain: initial,
            muted: false,
            priority: opts.priority ?? 'ambient',
        });
        this.applyBudgetToBus(name);
    }
    removeBus(name) {
        const entry = this.buses.get(name);
        if (!entry)
            return;
        entry.node.disconnect();
        this.buses.delete(name);
    }
    setMasterGain(gain) {
        this.masterGain = Math.max(0, gain);
        this.master.gain.value = this.masterGain;
    }
    getMasterGain() {
        return this.masterGain;
    }
    setBusGain(name, gain) {
        const entry = this.buses.get(name);
        if (!entry)
            return;
        entry.baseGain = Math.max(0, gain);
        this.applyBudgetToBus(name);
    }
    getBusGain(name) {
        return this.buses.get(name)?.baseGain ?? 0;
    }
    setBusMuted(name, muted) {
        const entry = this.buses.get(name);
        if (!entry)
            return;
        entry.muted = muted;
        this.applyBudgetToBus(name);
    }
    isBusMuted(name) {
        return this.buses.get(name)?.muted ?? false;
    }
    // Apply the latest VeilBudget audioBudget. Caller pushes this from
    // the resource each tick (or on Director updates). Idempotent;
    // re-apply with the same value is cheap.
    setAudioBudget(budget) {
        if (Number.isNaN(budget) || budget < 0)
            budget = 0;
        if (budget > 1)
            budget = 1;
        if (budget === this.currentBudget)
            return;
        this.currentBudget = budget;
        for (const name of this.buses.keys()) {
            this.applyBudgetToBus(name);
        }
    }
    getAudioBudget() {
        return this.currentBudget;
    }
    applyBudgetToBus(name) {
        const entry = this.buses.get(name);
        if (!entry)
            return;
        let effective = entry.baseGain;
        if (entry.muted)
            effective = 0;
        if (this.currentBudget < AUDIO_BUDGET_ESSENTIAL_FLOOR) {
            effective = 0;
        }
        else if (entry.priority === 'ambient' &&
            this.currentBudget < AUDIO_BUDGET_AMBIENT_FLOOR) {
            effective = 0;
        }
        entry.node.gain.value = effective;
    }
    // Convenience: play a one-shot AudioBuffer through a named bus.
    // Returns the AudioBufferSourceNode so callers can stop / track it.
    // Returns null if the bus or context isn't ready.
    playOneShot(busName, buffer, options = {}) {
        const entry = this.buses.get(busName);
        if (!entry)
            return null;
        if (!this.isUnlocked())
            return null;
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = options.rate ?? 1;
        if (options.gain !== undefined) {
            const g = this.ctx.createGain();
            g.gain.value = options.gain;
            src.connect(g).connect(entry.node);
        }
        else {
            src.connect(entry.node);
        }
        src.start();
        return src;
    }
    // Convenience: short tone via OscillatorNode. Useful for code-only
    // demos and UI feedback when no sound assets are loaded yet.
    playTone(busName, freq, durationMs, options = {}) {
        const entry = this.buses.get(busName);
        if (!entry)
            return;
        if (!this.isUnlocked())
            return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = options.type ?? 'sine';
        osc.frequency.value = freq;
        const peakGain = options.gain ?? 0.2;
        // Tiny attack / release envelope so the tone doesn't click.
        const now = this.ctx.currentTime;
        const dur = Math.max(0.01, durationMs / 1000);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(peakGain, now + 0.005);
        gain.gain.linearRampToValueAtTime(peakGain, now + dur - 0.02);
        gain.gain.linearRampToValueAtTime(0, now + dur);
        osc.connect(gain).connect(entry.node);
        osc.start(now);
        osc.stop(now + dur + 0.05);
    }
    // Tear down. Useful in tests; production demo lives the lifetime of
    // the page.
    dispose() {
        for (const entry of this.buses.values()) {
            try {
                entry.node.disconnect();
            }
            catch { /* ignore */ }
        }
        this.buses.clear();
        try {
            this.master.disconnect();
        }
        catch { /* ignore */ }
    }
}
// Resource key for the world's resource registry. Engine.create
// registers an AudioBus instance under this key.
export const RESOURCE_AUDIO_BUS = 'audio_bus';
//# sourceMappingURL=audio-bus.js.map