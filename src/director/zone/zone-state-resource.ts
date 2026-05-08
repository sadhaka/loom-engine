// DirectorZoneStateResource - generic key-value store per zone
// mutated by zone.state events and replaced wholesale by
// zone.snapshot (LOOM-DIRECTOR-PROTOCOL-V2 §4.5).
//
// Naming note: the existing Phase 8 ZoneStateResource in
// src/zone/zone-state.ts tracks the LOCAL player's active zone +
// transition state. This is a distinct concern: the Director-driven
// per-zone key/value bag (door open, fire lit, knot pulse counter,
// etc.). To avoid a name collision we expose this as
// DirectorZoneStateResource at the symbol level. The spec's
// ZoneStateResource interface name from §4.5 is satisfied by the
// type alias `ZoneDirectorState` we re-export below; the engine's
// public surface uses the disambiguated name.
//
// The Director and the consumer agree on key naming offline. The
// engine treats values as `unknown` and never inspects them - it just
// ferries deltas + snapshots between event stream and the resource.

export interface DirectorZoneStateResource {
  // Generic key-value store per zone. Mutated by zone.state events
  // and replaced wholesale by zone.snapshot.
  byZone: Map<string, Map<string, unknown>>;
}

export const RESOURCE_DIRECTOR_ZONE_STATE = 'director_zone_state';

export function createDirectorZoneStateResource(): DirectorZoneStateResource {
  return { byZone: new Map() };
}

// Get or lazily create the per-zone Map. Used by ZoneEventSystem on
// the first state event for a zone.
export function getOrCreateZoneStateMap(
  res: DirectorZoneStateResource,
  zoneId: string,
): Map<string, unknown> {
  const existing = res.byZone.get(zoneId);
  if (existing) return existing;
  const fresh: Map<string, unknown> = new Map();
  res.byZone.set(zoneId, fresh);
  return fresh;
}

// Apply a delta of (key, value) changes into the zone's map.
// Handler for zone.state. Iterates without allocations on the hot
// path beyond the underlying Map.set.
export function applyZoneStateChanges(
  res: DirectorZoneStateResource,
  zoneId: string,
  changes: ReadonlyArray<{ key: string; value: unknown }>,
): void {
  if (changes.length === 0) return;
  const map = getOrCreateZoneStateMap(res, zoneId);
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    if (!c) continue;
    map.set(c.key, c.value);
  }
}

// Replace the zone's map wholesale with the snapshot's contents.
// Handler for zone.snapshot. Drops any local key not present in the
// snapshot (per spec §4.3 "Replace local ZoneStateResource for this
// zone wholesale").
export function replaceZoneStateFromSnapshot(
  res: DirectorZoneStateResource,
  zoneId: string,
  state: ReadonlyArray<{ key: string; value: unknown }>,
): void {
  const fresh: Map<string, unknown> = new Map();
  for (let i = 0; i < state.length; i++) {
    const c = state[i];
    if (!c) continue;
    fresh.set(c.key, c.value);
  }
  res.byZone.set(zoneId, fresh);
}
