// AudioListenerResource - the world's snapshot of where the player is
// hearing from.
//
// SpatialAudioBus.setListener writes the AudioContext.listener
// directly, but engine consumers also want a queryable resource so a
// secondary system (minimap, debug HUD, deterministic recording) can
// read the same pose without round-tripping through the AudioContext
// (which is synchronous in Web Audio but opaque in Node tests).
//
// SpatialAudioSystem (PHASE_RENDER) updates this each tick from the
// local character's transform and pushes the same pose into
// SpatialAudioBus.setListener. Renderer code that needs to gate work
// on "did the listener move this frame?" can compare lastUpdateFrame
// against the TimeResource frame counter.
//
// Default orientation per LOOM-AUDIO-SPEC.md §8.4:
//   forward = (0, 0, -1)  - camera looks down -Z (top-down 2D)
//   up      = (0, 1, 0)
// These are fixed in v1; only position changes per frame.
//
// Re-exports the AudioListenerPose type from spatial-audio-bus.ts for
// import convenience so consumers wiring just the resource don't need
// to pull in the bus module too.
// Default forward / up vectors per spec §8.4. Exported for tests and
// for consumers that want to compare against the canonical defaults.
export const DEFAULT_LISTENER_FORWARD = {
    x: 0, y: 0, z: -1,
};
export const DEFAULT_LISTENER_UP = {
    x: 0, y: 1, z: 0,
};
// Factory: returns a fresh AudioListenerResource at the world origin
// with the canonical default orientation. The resource is the same
// shape used by SpatialAudioBus.setListener, so engine consumers can
// pipe it straight through:
//   var listener = createAudioListenerResource();
//   spatialBus.setListener(listener.pose);
//
// lastUpdateFrame starts at 0 (never updated yet); SpatialAudioSystem
// stamps it on the first tick.
export function createAudioListenerResource() {
    return {
        pose: {
            x: 0,
            y: 0,
            z: 0,
            forward: { x: DEFAULT_LISTENER_FORWARD.x, y: DEFAULT_LISTENER_FORWARD.y, z: DEFAULT_LISTENER_FORWARD.z },
            up: { x: DEFAULT_LISTENER_UP.x, y: DEFAULT_LISTENER_UP.y, z: DEFAULT_LISTENER_UP.z },
        },
        lastUpdateFrame: 0,
    };
}
// Resource key for the world's resource registry. Engine consumers
// register an AudioListenerResource under this key; SpatialAudioSystem
// reads + writes it.
export const RESOURCE_AUDIO_LISTENER = 'audio_listener';
//# sourceMappingURL=audio-listener-resource.js.map