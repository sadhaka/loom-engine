// WorldSnapshot - opt-in serialization for world state.
//
// 0.26.0 enabling primitive. The engine has no built-in save / load
// (entity component pools are SoA Float32Arrays - serializing them
// generally is a separate phase). What CAN be saved cheaply today is
// the registered RESOURCE state: time, knot context, plugin storage
// snapshots, custom consumer resources.
//
// IPersistableResource is opt-in. A resource declares
// `serialize()` returning JSON-safe data and `deserialize(data)`
// applying it. WorldSnapshot walks the registry, collects every
// resource that implements both, and produces / restores a versioned
// envelope.
//
// Resources without persistence methods are silently skipped on save
// AND ignored on restore (their state stays whatever's already
// initialized).
// Schema version of the snapshot envelope. Bump when the envelope
// shape itself changes (not when a resource changes its payload).
export const SNAPSHOT_SCHEMA_VERSION = 1;
// Walk the registry, calling serialize() on every IPersistableResource.
// Resources that don't implement the interface are skipped silently.
// `engineVersion` is stamped on the envelope so a deserializer can
// detect cross-version migration (caller decides what to do).
//
// `registry.keys()` returns iteration order = insertion order; the
// envelope preserves that ordering in the resulting object so
// snapshots from the same world are byte-stable across calls.
export function serializeWorldSnapshot(registry, engineVersion, nowFn = Date.now) {
    var out = {};
    var keys = registry.keys();
    for (var k of keys) {
        var v = registry.get(k);
        if (!v || typeof v.serialize !== 'function')
            continue;
        var persistKey = (typeof v.persistKey === 'string' && v.persistKey)
            ? v.persistKey : k;
        try {
            out[persistKey] = v.serialize();
        }
        catch (e) {
            try {
                console.error('[WorldSnapshot] serialize() for "' + persistKey
                    + '" threw:', e);
            }
            catch { /* ignore */ }
        }
    }
    return {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        engineVersion: String(engineVersion || ''),
        capturedAtMs: nowFn(),
        resources: out,
    };
}
// Apply a snapshot to a registry. For each `resources[k]`, if the
// matching resource implements deserialize(), call it. Resources not
// covered by the snapshot retain their current state.
//
// Returns the count of resources that were actually restored - useful
// for assertions ("did we get everything we expected back?").
//
// Mismatched schemaVersion is the caller's problem. The function
// proceeds optimistically; consumers check `snapshot.schemaVersion`
// against `SNAPSHOT_SCHEMA_VERSION` before calling if they want a
// hard reject.
export function deserializeWorldSnapshot(registry, snapshot) {
    if (!snapshot || typeof snapshot !== 'object')
        return 0;
    var resources = snapshot.resources;
    if (!resources || typeof resources !== 'object')
        return 0;
    var restored = 0;
    // Build a {persistKey -> registry-key} index so we can look up by
    // either the registry key or a custom persistKey.
    var byPersistKey = {};
    var rk = registry.keys();
    for (var k of rk) {
        var v = registry.get(k);
        if (!v)
            continue;
        var persistKey = (typeof v.persistKey === 'string' && v.persistKey)
            ? v.persistKey : k;
        byPersistKey[persistKey] = k;
    }
    // Apply each entry in the envelope.
    var pkeys = Object.keys(resources);
    for (var i = 0; i < pkeys.length; i++) {
        var pk = pkeys[i];
        if (pk === undefined)
            continue;
        var data = resources[pk];
        var rkey = byPersistKey[pk];
        if (!rkey)
            continue;
        var resource = registry.get(rkey);
        if (!resource || typeof resource.deserialize !== 'function')
            continue;
        try {
            resource.deserialize(data);
            restored++;
        }
        catch (e) {
            try {
                console.error('[WorldSnapshot] deserialize() for "' + pk
                    + '" threw:', e);
            }
            catch { /* ignore */ }
        }
    }
    return restored;
}
// Resource key for an attached snapshot facility (e.g. a save-on-tick
// system that auto-snapshots every N seconds).
export const RESOURCE_WORLD_SNAPSHOT = 'loom.world_snapshot';
//# sourceMappingURL=world-snapshot.js.map