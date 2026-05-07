// DirectorEncounterSystem - subscribes to encounter.spawn events
// from the DirectorEventLog and spawns mobs into the world.
//
// Works in tandem with DirectorSystem:
//   1. DirectorSystem (PHASE_INPUT) drains the bridge and applies
//      events to KnotContext / VeilBudget / DirectorEventLog
//   2. DirectorEncounterSystem (PHASE_LOGIC) re-reads the most
//      recent events from the log, spawns mobs from any new
//      encounter.spawn event, and tracks handled encounter ids so
//      replay / duplicate events don't double-spawn
//
// Per spec §3.1 the encounter.spawn payload includes:
//   - mobs: ReadonlyArray<MobSpec> with type, position_hint, etc.
//   - boss: BossSpec | null
//   - knot, level, zone_id, narrator_line
//
// The renderer never decides composition (spec §5.1, §6.5). It just
// applies what the Director said.
//
// Mob type mapping: the spec's `type` field is a string the Director
// chose. We map known strings to MobArchetype values; unknown strings
// fall back to 'skel_warrior' so the encounter still produces
// something visible.

import type { System } from '../system.js';
import type { World } from '../world.js';
import {
  RESOURCE_DIRECTOR_LOG,
  type DirectorEventLog,
} from './director-system.js';
import type { DirectorEvent, EncounterSpawnData, MobSpec } from './event-envelope.js';
import {
  spawnMob,
  type MobArchetype,
  MOB_CATALOG,
} from '../combat/mob-catalog.js';
import type { AtlasHandle } from '../renderer/graphics-device.js';
import type { EntityId } from '../entity.js';

// String -> MobArchetype map. The Director can emit any string in
// the type field (spec doesn't enumerate); the engine validates +
// falls back. New mob types added in subsequent phases just extend
// this map.
const TYPE_MAP: Record<string, MobArchetype> = {
  skel_warrior: 'skel_warrior',
  skel_archer: 'skel_archer',
  skel_caster: 'skel_caster',
  // Aliases / legacy names from the existing Survivor that map to
  // catalog archetypes.
  skeleton_iron: 'skel_warrior',
  skeleton_warrior: 'skel_warrior',
  skeleton_archer: 'skel_archer',
  skeleton_caster: 'skel_caster',
};

function resolveMobArchetype(typeStr: string): MobArchetype {
  return TYPE_MAP[typeStr] ?? 'skel_warrior';
}

export interface DirectorEncounterSystemOptions {
  // The player entity new mobs should target.
  player: EntityId;
  // The atlas handle for mob sprites. The system passes this to
  // spawnMob. A real game ships per-mob-archetype atlases; this
  // single-atlas v1 reuses the demo's procedural enemy sprite for
  // all archetypes, with the catalog's tint differentiating them.
  mobAtlas: AtlasHandle;
  // Optional callback fired after each successful encounter spawn.
  // Useful for HUD updates ("Encounter: Iron Skeleton x3"), audio
  // cues, narrator-line display.
  onEncounterStarted?: (encounterId: string, mobCount: number, narratorLine: string | null) => void;
}

export class DirectorEncounterSystem implements System {
  readonly name: string = 'director-encounter';

  // Set of encounter_ids we've already spawned. Prevents duplicate
  // spawn on event replay (spec §9.3 dual-delivery dedupe).
  private handled: Set<string> = new Set();
  private opts: DirectorEncounterSystemOptions;

  constructor(opts: DirectorEncounterSystemOptions) {
    this.opts = opts;
  }

  update(world: World, _dt: number): void {
    const log = world.resources.get<DirectorEventLog>(RESOURCE_DIRECTOR_LOG);
    if (!log) return;

    // Walk recent events from the log. recent is newest-first and
    // capped at 32 (per DirectorSystem ring buffer). Iterate from
    // oldest-to-newest so multi-encounter ticks spawn in order.
    for (let i = log.recent.length - 1; i >= 0; i--) {
      const ev = log.recent[i];
      if (!ev || ev.type !== 'encounter.spawn') continue;
      const spawn = ev as DirectorEvent & { data: EncounterSpawnData };
      const id = spawn.data.encounter_id;
      if (!id || this.handled.has(id)) continue;
      this.spawnEncounter(world, spawn.data);
      this.handled.add(id);
    }

    // On encounter.end events, free up the encounter id so a future
    // re-emission (e.g. retry) can spawn again.
    for (let i = log.recent.length - 1; i >= 0; i--) {
      const ev = log.recent[i];
      if (!ev || ev.type !== 'encounter.end') continue;
      const id = (ev as DirectorEvent).encounter_id;
      if (id) this.handled.delete(id);
    }
  }

  private spawnEncounter(world: World, data: EncounterSpawnData): void {
    let totalSpawned = 0;
    for (const mob of data.mobs) {
      totalSpawned += this.spawnOne(world, mob);
    }
    // Boss spawn (if present).
    if (data.boss) {
      // Bosses use the same spawnMob factory in v1; future work
      // adds a spawnBoss with bigger HP / unique behaviour.
      const archetype = resolveMobArchetype(data.boss.type);
      // Verify the catalog has the entry before spawning - prevents
      // a typo on the Director side from crashing the renderer.
      if (MOB_CATALOG[archetype]) {
        spawnMob(
          world,
          archetype,
          data.boss.position_hint.x,
          data.boss.position_hint.y,
          this.opts.player,
          this.opts.mobAtlas,
        );
        totalSpawned++;
      }
    }
    if (this.opts.onEncounterStarted) {
      this.opts.onEncounterStarted(data.encounter_id, totalSpawned, data.narrator_line);
    }
  }

  private spawnOne(world: World, mob: MobSpec): number {
    const archetype = resolveMobArchetype(mob.type);
    if (!MOB_CATALOG[archetype]) return 0;
    const baseX = mob.position_hint.x;
    const baseY = mob.position_hint.y;
    // count > 1 spawns multiple instances at slightly varied
    // positions (small radius around the position_hint).
    for (let i = 0; i < mob.count; i++) {
      const angle = (i / Math.max(1, mob.count)) * Math.PI * 2;
      const spread = mob.count > 1 ? 0.5 : 0;
      spawnMob(
        world,
        archetype,
        baseX + Math.cos(angle) * spread,
        baseY + Math.sin(angle) * spread,
        this.opts.player,
        this.opts.mobAtlas,
      );
    }
    return mob.count;
  }

  // Test / debug helper: clear the handled-id cache. Used by demo
  // code when transitioning zones so a fresh encounter.spawn for a
  // re-entered zone re-spawns mobs.
  clearHandled(): void {
    this.handled.clear();
  }

  hasHandled(encounterId: string): boolean {
    return this.handled.has(encounterId);
  }
}
