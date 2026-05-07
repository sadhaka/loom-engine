// DirectorSystem - drains the IDirectorBridge each tick, applies
// each event to the world's resources, and ticks the knot palette
// crossfade.
//
// Runs in PHASE_INPUT, AFTER InputSystem and VeilBudgetSystem so:
//   1. Input snapshot is fresh first
//   2. Any prior frame's VeilBudget propagation has already applied
//   3. THIS system overlays Director events on top, mutating
//      VeilBudget + KnotContext + others as the events stream in
//   4. VeilBudgetSystem next frame picks up the new budget and
//      pushes it to AudioBus + ParticlePool
//
// Per spec invariants:
//   - Section 5.1: renderer never decides palette logic. We just
//     apply what the Director sends.
//   - Section 6.5: renderer never computes VE tier. Just receives.
//   - Section 4.2: gap detection is the bridge's job, not ours.
//     This system trusts the bridge has already reordered / dropped.
//
// What this system does for each event type:
//
//   knot.context        -> KnotContextResource.beginFade(palette,
//                          fade_ms, now)
//   ve.budget.update    -> mutate VeilBudgetResource (ve fields, tier)
//                          into engine-internal scalar (audioBudget,
//                          particleBudget) per Section 6.2 tier table.
//                          VeilBudgetSystem picks up next frame.
//   encounter.spawn     -> log + push narrator-line to a new
//                          NarratorEvent queue (consumer-defined; v1
//                          just exposes the latest event)
//   encounter.tick      -> log; v1 doesn't react to mid-fight ticks
//   encounter.end       -> log + clear current encounter state
//   encounter.loot      -> log + push loot data
//   scene.transition    -> log + emit scene change marker
//   narrator.line       -> push to narrator queue
//   system.heartbeat    -> stats only; bridge already extracted drops
//   system.replay.*     -> log only
//   system.snapshot.*   -> log + bridge has already closed; consumer
//                          must reconnect
//
// Lightweight-by-design: most events are just logged + appended to
// a recent-events ring buffer that gameplay code can read. Heavy
// state mutation (combat state machines, world graph, NPC dialog
// queues) lives in higher-level systems that read from this resource.

import type { System } from '../system.js';
import type { World } from '../world.js';
import {
  type IDirectorBridge,
  RESOURCE_DIRECTOR_BRIDGE,
  RESOURCE_KNOT_CONTEXT,
} from './director-bridge.js';
import { KnotContextResource } from './knot-context-resource.js';
import {
  RESOURCE_VEIL_BUDGET,
  type VeilBudgetResource,
  type TimeResource,
  RESOURCE_TIME,
} from '../resources.js';
import type {
  DirectorEvent,
  VeilTier,
} from './event-envelope.js';

// Most-recent events ring buffer the rest of the engine can read.
export interface DirectorEventLog {
  // Newest first; clipped to RING_SIZE.
  recent: DirectorEvent[];
  // Last narrator line that arrived (any source). Renderer UI reads this.
  lastNarratorLine: string | null;
  lastNarratorTtlMs: number;
  // Last knot we applied (separate from KnotContextResource which
  // tracks visual state - this tracks the canonical event-driven knot).
  lastKnot: string | null;
  // Current encounter id, or null if no encounter is active.
  activeEncounterId: string | null;
  // Last-seen tier (from ve.budget.update). Convenient for HUD.
  lastTier: VeilTier;
  // Total events applied since system start.
  eventsApplied: number;
}

export const RESOURCE_DIRECTOR_LOG = 'director_log';

const RING_SIZE = 32;

export function createDirectorEventLog(): DirectorEventLog {
  return {
    recent: [],
    lastNarratorLine: null,
    lastNarratorTtlMs: 0,
    lastKnot: null,
    activeEncounterId: null,
    lastTier: 'green',
    eventsApplied: 0,
  };
}

// Section 6.2 tier-to-multiplier table. Renderer-internal scalars
// that tune the engine subsystems each tick.
//
// particleBudget: max simultaneous particles (was 4096 default; we
//                 multiply by tier scalar)
// audioBudget:    [0, 1] passed to AudioBus.setAudioBudget (Section 6.2
//                 amber drops ambient stages, red minimal)
// shaderBudget:   passes through; downstream VFX gates on this when
//                 Phase 6+ shader effects land
//
// These scalars are applied multiplicatively to the engine's standalone
// defaults so demos / standalone runs (no Director) keep their generous
// settings, while connected runs scale down under load.
const TIER_SCALARS: Record<VeilTier, { particle: number; audio: number; shader: number }> = {
  green: { particle: 1.0,  audio: 1.0, shader: 1.0 },
  amber: { particle: 0.5,  audio: 0.7, shader: 0.5 },
  red:   { particle: 0.05, audio: 0.4, shader: 0.0 },
};

const PARTICLE_BUDGET_BASE = 4096;
const SHADER_BUDGET_BASE = 8;

export class DirectorSystem implements System {
  readonly name: string = 'director';

  update(world: World, _dt: number): void {
    const bridge = world.resources.get<IDirectorBridge>(RESOURCE_DIRECTOR_BRIDGE);
    const knotCtx = world.resources.get<KnotContextResource>(RESOURCE_KNOT_CONTEXT);
    const log = world.resources.get<DirectorEventLog>(RESOURCE_DIRECTOR_LOG);
    const time = world.resources.get<TimeResource>(RESOURCE_TIME);
    if (!bridge || !knotCtx || !log) return;

    const nowMs = (time ? time.elapsed * 1000 : 0) + (typeof performance !== 'undefined' ? performance.now() : 0);

    // 1. Drain queued events.
    const events = bridge.pollEvents();
    if (events.length > 0) {
      const budget = world.resources.get<VeilBudgetResource>(RESOURCE_VEIL_BUDGET);
      const frameNow = time ? time.frame : -1;
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (!ev) continue;
        applyEvent(ev, knotCtx, log, budget ?? null, nowMs, frameNow);
      }
    }

    // 2. Tick the palette crossfade (idempotent if no fade active).
    knotCtx.tickFade(nowMs);
  }
}

// applyEvent mutates KnotContextResource + DirectorEventLog +
// optionally VeilBudgetResource. Pure: no I/O, no allocation beyond
// the ring buffer push.
function applyEvent(
  ev: DirectorEvent,
  knotCtx: KnotContextResource,
  log: DirectorEventLog,
  budget: VeilBudgetResource | null,
  nowMs: number,
  frameNow: number,
): void {
  // Append to ring buffer (newest first).
  log.recent.unshift(ev);
  if (log.recent.length > RING_SIZE) {
    log.recent.length = RING_SIZE;
  }
  log.eventsApplied++;

  switch (ev.type) {
    case 'knot.context': {
      const d = ev.data;
      knotCtx.knot = d.knot;
      knotCtx.mood = d.mood;
      knotCtx.beginFade(d.palette, d.fade_ms, nowMs);
      log.lastKnot = d.knot;
      break;
    }
    case 've.budget.update': {
      const d = ev.data;
      log.lastTier = d.tier;
      if (budget) {
        const scalars = TIER_SCALARS[d.tier];
        budget.particleBudget = Math.round(PARTICLE_BUDGET_BASE * scalars.particle);
        budget.audioBudget = scalars.audio;
        budget.shaderBudget = Math.round(SHADER_BUDGET_BASE * scalars.shader);
        budget.eventBudget = d.encounter_budget_ve;
        if (frameNow >= 0) budget.lastUpdatedFrame = frameNow;
      }
      break;
    }
    case 'encounter.spawn': {
      log.activeEncounterId = ev.data.encounter_id;
      if (ev.data.narrator_line) {
        log.lastNarratorLine = ev.data.narrator_line;
        log.lastNarratorTtlMs = 0;
      }
      break;
    }
    case 'encounter.tick': {
      if (ev.data.narrator_line) {
        log.lastNarratorLine = ev.data.narrator_line;
        log.lastNarratorTtlMs = 0;
      }
      break;
    }
    case 'encounter.end': {
      log.activeEncounterId = null;
      break;
    }
    case 'encounter.loot': {
      if (ev.data.narrator_line) {
        log.lastNarratorLine = ev.data.narrator_line;
        log.lastNarratorTtlMs = 0;
      }
      break;
    }
    case 'narrator.line': {
      log.lastNarratorLine = ev.data.line;
      log.lastNarratorTtlMs = ev.data.ttl_ms;
      break;
    }
    case 'scene.transition':
    case 'system.heartbeat':
    case 'system.replay.complete':
    case 'system.snapshot.required':
      // Logged only via the ring buffer above. Specialized systems
      // (scene loader, telemetry) read from log.recent.
      break;
  }
}
