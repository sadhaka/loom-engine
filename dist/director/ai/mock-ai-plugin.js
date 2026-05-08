// MockAIPlugin - deterministic synthetic events for tests + offline demo.
//
// Per LOOM-DIRECTOR-PROTOCOL-V2 Section 5.4: replaces real LLM
// dispatch with a scripted sequence of events keyed by tick number.
// Engine tests can wire this in place of an Anthropic-backed plugin
// to verify registry behavior, dispatch order, and downstream emit
// paths without burning API budget. The offline demo can use it to
// drive a showcase loop with predictable events.
//
// Determinism: the script is consulted on each onTick() call. The
// plugin keeps an internal tick counter that increments every call;
// the constructor's `tickKey` option lets the caller provide a
// counter source instead (e.g. tying it to the engine's frame index
// for cross-process consistency).
//
// Multiple instances: the constructor accepts an optional `name`
// override so a test can register two MockAIPlugins with different
// scripts. Without override, the name is 'mock' and registering two
// instances throws AIPluginDuplicateError (intentional - the spec
// keys plugins by name).
export class MockAIPlugin {
    name;
    version = '0.0.1';
    priority;
    script;
    // Current tick count; increments every onTick() call. The first
    // tick observed is 1 (matches the typical engine convention where
    // tick 0 is "before-first-update").
    tick = 0;
    constructor(opts) {
        this.name = opts.name ?? 'mock';
        this.priority = opts.priority ?? 999;
        this.script = opts.script;
    }
    async onTick(_ctx) {
        this.tick++;
        var characterEvents;
        var zoneEvents;
        for (var i = 0; i < this.script.length; i++) {
            var entry = this.script[i];
            if (!entry)
                continue;
            if (entry.atTick !== this.tick)
                continue;
            if (entry.characterEvents && entry.characterEvents.length > 0) {
                if (!characterEvents)
                    characterEvents = [];
                for (var ci = 0; ci < entry.characterEvents.length; ci++) {
                    var ce = entry.characterEvents[ci];
                    if (ce)
                        characterEvents.push(ce);
                }
            }
            if (entry.zoneEvents && entry.zoneEvents.length > 0) {
                if (!zoneEvents)
                    zoneEvents = [];
                for (var zi = 0; zi < entry.zoneEvents.length; zi++) {
                    var ze = entry.zoneEvents[zi];
                    if (ze)
                        zoneEvents.push(ze);
                }
            }
        }
        var emitted = {};
        if (characterEvents)
            emitted.characterEvents = characterEvents;
        if (zoneEvents)
            emitted.zoneEvents = zoneEvents;
        return emitted;
    }
    // Inspect-only: current tick count. Useful in tests to assert the
    // plugin saw the expected number of dispatches.
    currentTick() {
        return this.tick;
    }
    // Reset the tick counter to 0 so the script can replay from the
    // start. Tests that re-use a single plugin across multiple cases
    // call this between cases.
    resetTick() {
        this.tick = 0;
    }
}
//# sourceMappingURL=mock-ai-plugin.js.map