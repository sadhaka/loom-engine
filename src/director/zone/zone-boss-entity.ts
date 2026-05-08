// ZoneBossEntity - renderer-agnostic boss entity primitive
// (LOOM-BOSS-RENDER-SPEC §3.1).
//
// Phase 18 Track A. ZoneEventLog already tracks activeBossId per zone -
// this resource lifts that to a richer projection a renderer (Three.js,
// Canvas2D, Pixi, custom) can poll each frame without knowing about the
// underlying SSE protocol.
//
// Sprite-truth tracks event-truth: every field is derived purely from
// the zone event stream (zone.boss.spawn / tick / end / snapshot). No
// side-channel state, no client prediction. The renderer reads the
// current ZoneBossEntity for a zone and projects it into pixels.
//
// v1 supports at most one active boss per zone (matches Phase 16 spec).
// Multi-boss-per-zone is deferred per LOOM-BOSS-RENDER-SPEC §1.2.
//
// recent_hits is a bounded ring of 32 entries for floating-damage-number
// renderers. Older entries fall off; renderers diff against their own
// per-frame snapshot of recent_hits length to detect new hits.

import type {
  ZoneBossSpec,
  ZoneEvent,
  ZoneEventEnvelope,
} from './zone-event-envelope.js';

// ----- Types -----

export interface ZoneBossHitRecord {
  amount: number;
  at_ms: number;
  from_character_id: string;
}

export interface ZoneBossEntity {
  zone_id: string;
  boss_id: string;
  name: string;
  // Catalog key (e.g. 'lastlight_warden'). Renderer can use this to
  // pick a model / palette without parsing the name.
  type: string;
  hp_max: number;
  hp_current: number;
  dmg: number;
  x: number;
  y: number;
  knot_flavor: string;
  // Wall-clock spawn time (envelope ts of zone.boss.spawn). Renderers
  // use this for "spawned recently" effects (intro animation timing).
  spawned_at_ms: number;
  // Envelope ts of the most recent zone.boss.tick. Renderers detect
  // "took a hit since last frame" by snapshotting this value once per
  // frame and comparing the next frame's value.
  last_tick_ms: number;
  // Damage events received since spawn. Bounded ring of 32 entries
  // (RECENT_HITS_RING_SIZE), newest last (push semantics). Each entry
  // carries amount + at_ms + from_character_id. Position is not carried
  // - renderers read the boss's current x/y at draw time.
  recent_hits: ZoneBossHitRecord[];
}

export interface ZoneBossEntityResource {
  // Per-zone active boss (or null when none). v1 supports at most one
  // active boss per zone.
  byZone: Map<string, ZoneBossEntity | null>;
}

export const RESOURCE_ZONE_BOSS_ENTITY = 'zone_boss_entity';

// Bounded ring size for recent_hits. Matches ZONE_RING_SIZE for the
// per-zone event log to keep the two ring buffers in lockstep.
export const RECENT_HITS_RING_SIZE = 32;

// ----- Factory -----

export function createZoneBossEntityResource(): ZoneBossEntityResource {
  return { byZone: new Map() };
}

// ----- Helpers -----

// Build a fresh ZoneBossEntity from a zone.boss.spawn envelope. Used by
// ZoneBossEntitySystem on the spawn dispatch and on zone.snapshot
// replacement (the snapshot's active_boss field carries the same
// ZoneBossSpec shape; we wrap it with the envelope ts as spawned_at_ms).
//
// The envelope is typed as ZoneEvent for caller convenience - the
// function asserts the payload shape and pulls the boss ZoneBossSpec.
// If the envelope is not a zone.boss.spawn (or zone.snapshot whose
// active_boss is non-null), the caller is responsible for pre-checking;
// this helper assumes the dispatch already happened.
export function buildEntityFromSpawn(env: ZoneEvent): ZoneBossEntity {
  if (env.type === 'zone.boss.spawn') {
    const spawnEnv = env as ZoneEventEnvelope<'zone.boss.spawn'>;
    return entityFromSpec(spawnEnv.zone_id, spawnEnv.data.boss, spawnEnv.ts);
  }
  if (env.type === 'zone.snapshot') {
    const snapEnv = env as ZoneEventEnvelope<'zone.snapshot'>;
    const boss = snapEnv.data.active_boss;
    if (!boss) {
      throw new Error('buildEntityFromSpawn: zone.snapshot has no active_boss');
    }
    return entityFromSpec(snapEnv.zone_id, boss, snapEnv.ts);
  }
  throw new Error('buildEntityFromSpawn: unsupported envelope type ' + env.type);
}

function entityFromSpec(zoneId: string, boss: ZoneBossSpec, ts: number): ZoneBossEntity {
  return {
    zone_id: zoneId,
    boss_id: boss.boss_id,
    name: boss.name,
    type: boss.type,
    hp_max: boss.hp_max,
    hp_current: boss.hp_current,
    dmg: boss.dmg,
    x: boss.x,
    y: boss.y,
    knot_flavor: boss.knot_flavor,
    spawned_at_ms: ts,
    last_tick_ms: ts,
    recent_hits: [],
  };
}

// Apply a zone.boss.tick envelope to an existing entity. Caller is
// responsible for boss_id matching - this helper assumes the dispatch
// already verified that ev.data.boss_id === entity.boss_id.
//
// Mutates: hp_current, x, y, last_tick_ms, recent_hits (append + cap).
export function applyTick(entity: ZoneBossEntity, env: ZoneEvent): void {
  if (env.type !== 'zone.boss.tick') {
    throw new Error('applyTick: expected zone.boss.tick, got ' + env.type);
  }
  const tick = env as ZoneEventEnvelope<'zone.boss.tick'>;
  const d = tick.data;
  entity.hp_current = d.hp_current;
  entity.x = d.x;
  entity.y = d.y;
  entity.last_tick_ms = tick.ts;
  // Append each new hit, capped at RECENT_HITS_RING_SIZE.
  for (let i = 0; i < d.recent_hits.length; i++) {
    const h = d.recent_hits[i];
    if (!h) continue;
    entity.recent_hits.push({
      amount: h.amount,
      at_ms: h.ts_ms,
      from_character_id: h.from_character_id,
    });
  }
  // Cap by trimming oldest (front). Drop in a tight loop so the array
  // never grows unbounded under a hit-storm.
  while (entity.recent_hits.length > RECENT_HITS_RING_SIZE) {
    entity.recent_hits.shift();
  }
}
