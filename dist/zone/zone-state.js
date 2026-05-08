// ZoneState - resource tracking the active zone + transition state.
//
// Per LOOM-CLASS-SYSTEM-SPEC Section 3 the v1 ARPG ships with 7
// knot zones plus the Lastlight Plaza hub. The renderer holds one
// ZoneState resource that names the current zone and any in-progress
// transition. ZoneSystem applies scene.transition events from the
// Director (or local triggers in the demo) to mutate this resource.
//
// Render systems read activeZoneId to pick the appropriate tile
// atlas / palette / ambient audio. The Director-bridge populates
// scene.transition events when the player crosses portals.
export function createZoneState(initial = 'lastlight_plaza') {
    return {
        activeZoneId: initial,
        transition: null,
    };
}
// Begin a zone transition. Idempotent against the current zone (no-
// op if the from and to are the same).
export function beginTransition(state, toZoneId, kind, durationMs, nowMs) {
    if (state.activeZoneId === toZoneId)
        return false;
    state.transition = {
        fromZoneId: state.activeZoneId,
        toZoneId,
        kind,
        startMs: nowMs,
        durationMs: Math.max(1, durationMs),
    };
    return true;
}
// Tick the active transition. When the duration elapses, set
// activeZoneId to the target and clear the transition. Returns the
// transition progress in [0, 1] for renderer fades, or -1 if no
// transition is active.
export function tickTransition(state, nowMs) {
    if (!state.transition)
        return -1;
    const t = state.transition;
    const elapsed = nowMs - t.startMs;
    if (elapsed >= t.durationMs) {
        state.activeZoneId = t.toZoneId;
        state.transition = null;
        return 1;
    }
    return Math.max(0, elapsed / t.durationMs);
}
export function isTransitioning(state) {
    return state.transition !== null;
}
export const RESOURCE_ZONE_STATE = 'zone_state';
//# sourceMappingURL=zone-state.js.map