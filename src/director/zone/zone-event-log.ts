// ZoneEventLog - per-zone ring buffer parallel to v1's
// DirectorEventLog (LOOM-DIRECTOR-PROTOCOL-V2 §4.4).
//
// Renderer reads from this for UI surfaces (boss HP bar, recent loot
// toast, narrator banner). Per-zone slots so a player who briefly
// stepped through another zone keeps a separate diagnostic trail per
// zone they have observed.
//
// The map is dense by-zone; a zone's slot is created lazily on the
// first event for that zone (avoids preallocating slots for zones the
// player will never enter). The ring buffer per zone caps at
// ZONE_RING_SIZE = 32 entries, newest first - matches v1's
// DirectorEventLog.recent semantics.

import type { ZoneEvent } from './zone-event-envelope.js';

export interface ZoneEventLogEntry {
  // Newest first; clipped to ZONE_RING_SIZE.
  recent: ZoneEvent[];
  // Currently-spawned boss id for this zone, or null if no boss is
  // active. Renderer keys boss HP bar / loot toast off this.
  activeBossId: string | null;
  // Last narrator line written for this zone (zone.narrator OR
  // zone.boss.spawn's narrator_line). Renderer reads for the banner.
  lastNarratorLine: string | null;
  lastNarratorTtlMs: number;
  // Total events applied to this zone's slot since system start.
  // Diagnostic only; not used for replay.
  eventsApplied: number;
}

export interface ZoneEventLog {
  byZone: Map<string, ZoneEventLogEntry>;
}

export const RESOURCE_ZONE_EVENT_LOG = 'zone_event_log';

export const ZONE_RING_SIZE = 32;

export function createZoneEventLog(): ZoneEventLog {
  return { byZone: new Map() };
}

// Get or lazily create the slot for a zone. Used by ZoneEventSystem
// when the first event for a zone arrives. Exported for tests +
// bench.
export function getOrCreateZoneEntry(
  log: ZoneEventLog,
  zoneId: string,
): ZoneEventLogEntry {
  const existing = log.byZone.get(zoneId);
  if (existing) return existing;
  const fresh: ZoneEventLogEntry = {
    recent: [],
    activeBossId: null,
    lastNarratorLine: null,
    lastNarratorTtlMs: 0,
    eventsApplied: 0,
  };
  log.byZone.set(zoneId, fresh);
  return fresh;
}

// Push an event into the per-zone ring buffer (newest first) and
// bump eventsApplied. Pure; does not touch activeBossId / narrator
// state - those are the system's job to set per event type.
export function pushZoneEvent(entry: ZoneEventLogEntry, ev: ZoneEvent): void {
  entry.recent.unshift(ev);
  if (entry.recent.length > ZONE_RING_SIZE) {
    entry.recent.length = ZONE_RING_SIZE;
  }
  entry.eventsApplied++;
}
