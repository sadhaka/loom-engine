// SnapshotRecoveryHelper - the renderer-side counterpart to backend
// Phase 6.5's GET /api/v1/loom/director/state endpoint.
//
// When the SSEDirectorBridge surfaces a `system.snapshot.required`
// event (gap exceeds REPLAY_MAX_EVENTS or oldest retained id older
// than client's last_known_id), the application:
//
//   1. Stops the current bridge.
//   2. Calls SnapshotRecoveryHelper.recover(world).
//   3. Receives the snapshot's tail_id back.
//   4. Constructs a new SSEDirectorBridge with
//      initialLastEventId = tail_id so any replayed events <=
//      tail_id are silently deduped.
//   5. Starts the new bridge; live events resume from > tail_id.
//
// The helper itself is stateless. fetchSnapshot is async (network
// IO); applySnapshot is sync (pure resource mutation). recover is
// the convenience that chains both.
//
// Per LOOM-DIRECTOR-PROTOCOL.md §3.11 + §13 LOCKED invariants, the
// renderer never decides palette / VE tier / zone / encounter -
// the snapshot endpoint is authoritative; the helper simply applies
// what the server returned.

import type { World } from '../world.js';
import type { KnotContextResource } from './knot-context-resource.js';
import { RESOURCE_KNOT_CONTEXT } from './director-bridge.js';
import {
  RESOURCE_VEIL_BUDGET,
  type VeilBudgetResource,
} from '../resources.js';
import {
  RESOURCE_DIRECTOR_LOG,
  type DirectorEventLog,
} from './director-system.js';
import {
  RESOURCE_ZONE_STATE,
  type ZoneStateResource,
  type ZoneId,
  beginTransition,
} from '../zone/zone-state.js';
import type {
  EventEnvelope,
  KnotContextData,
  VeBudgetUpdateData,
  SceneTransitionData,
  EncounterSpawnData,
} from './event-envelope.js';

// Response shape from GET /api/v1/loom/director/state per Phase 6.5.
// Each snapshot field is either a full envelope or null.
export interface SnapshotResponse {
  ok: boolean;
  character_id: string;
  tail_id: number;
  snapshot: {
    knot_context: EventEnvelope<'knot.context'> | null;
    ve_budget: EventEnvelope<'ve.budget.update'> | null;
    scene: EventEnvelope<'scene.transition'> | null;
    active_encounter: EventEnvelope<'encounter.spawn'> | null;
  };
  ts: number;
}

export class SnapshotFetchError extends Error {
  readonly kind: 'network' | 'http' | 'parse' | 'invalid';
  readonly status: number;
  readonly url: string;
  constructor(kind: SnapshotFetchError['kind'], url: string, message: string, status: number = 0) {
    super('SnapshotFetchError[' + kind + '] ' + url + ': ' + message);
    this.name = 'SnapshotFetchError';
    this.kind = kind;
    this.url = url;
    this.status = status;
  }
}

export interface SnapshotRecoveryOptions {
  // Full URL to the /state endpoint, e.g.
  // 'https://theworldtable.ai/api/v1/loom/director/state'.
  baseUrl: string;
  // The character whose state we want.
  characterId: string;
  // Optional fetch impl for tests. Production calls global fetch.
  fetchImpl?: typeof fetch;
}

// Tier-to-scalar table mirrors DirectorSystem so applying a
// snapshot's ve.budget produces the same engine state as a live
// ve.budget.update event would.
const PARTICLE_BUDGET_BASE = 4096;
const SHADER_BUDGET_BASE = 8;
const TIER_SCALARS: Record<'green' | 'amber' | 'red', { particle: number; audio: number; shader: number }> = {
  green: { particle: 1.0,  audio: 1.0, shader: 1.0 },
  amber: { particle: 0.5,  audio: 0.7, shader: 0.5 },
  red:   { particle: 0.05, audio: 0.4, shader: 0.0 },
};

export class SnapshotRecoveryHelper {
  private readonly baseUrl: string;
  private readonly characterId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: SnapshotRecoveryOptions) {
    this.baseUrl = opts.baseUrl;
    this.characterId = opts.characterId;
    if (opts.fetchImpl) {
      this.fetchImpl = opts.fetchImpl;
    } else {
      if (typeof fetch === 'undefined') {
        throw new Error('SnapshotRecoveryHelper: fetch is unavailable. Pass options.fetchImpl in non-DOM contexts.');
      }
      this.fetchImpl = fetch;
    }
  }

  // Fetch + parse the snapshot. Throws SnapshotFetchError on any
  // failure (network, non-2xx HTTP, JSON parse, shape validation).
  async fetchSnapshot(): Promise<SnapshotResponse> {
    const url = this.buildUrl();
    let resp: Response;
    try {
      resp = await this.fetchImpl(url, { credentials: 'include' });
    } catch (err) {
      throw new SnapshotFetchError('network', url, err instanceof Error ? err.message : String(err));
    }
    if (!resp.ok) {
      throw new SnapshotFetchError('http', url, 'HTTP ' + resp.status + ' ' + resp.statusText, resp.status);
    }
    let raw: unknown;
    try {
      raw = await resp.json();
    } catch (err) {
      throw new SnapshotFetchError('parse', url, err instanceof Error ? err.message : String(err));
    }
    return this.validateResponse(raw, url);
  }

  // Apply the snapshot to the world's engine resources. Pure (no
  // network I/O). Idempotent - reapplying the same snapshot is safe.
  applySnapshot(world: World, snapshot: SnapshotResponse): void {
    const knotCtx = world.resources.get<KnotContextResource>(RESOURCE_KNOT_CONTEXT);
    const budget = world.resources.get<VeilBudgetResource>(RESOURCE_VEIL_BUDGET);
    const log = world.resources.get<DirectorEventLog>(RESOURCE_DIRECTOR_LOG);
    const zone = world.resources.get<ZoneStateResource>(RESOURCE_ZONE_STATE);

    const nowMs = typeof performance !== 'undefined' ? performance.now() : 0;

    // knot_context: apply palette + mood with a short fade so the
    // visual snap-in isn't jarring.
    if (knotCtx && snapshot.snapshot.knot_context) {
      const d: KnotContextData = snapshot.snapshot.knot_context.data;
      knotCtx.knot = d.knot;
      knotCtx.mood = d.mood;
      // Use a short fade (200ms) regardless of the original event's
      // fade_ms because we're snapping, not transitioning.
      knotCtx.beginFade(d.palette, 200, nowMs);
      if (log) log.lastKnot = d.knot;
    }

    // ve_budget: apply tier + scalar like DirectorSystem does.
    if (budget && snapshot.snapshot.ve_budget) {
      const d: VeBudgetUpdateData = snapshot.snapshot.ve_budget.data;
      const scalars = TIER_SCALARS[d.tier];
      budget.particleBudget = Math.round(PARTICLE_BUDGET_BASE * scalars.particle);
      budget.audioBudget = scalars.audio;
      budget.shaderBudget = Math.round(SHADER_BUDGET_BASE * scalars.shader);
      budget.eventBudget = d.encounter_budget_ve;
      if (log) log.lastTier = d.tier;
    }

    // scene: apply zone transition. If the snapshot's scene says
    // we're in zone X but our state says Y, snap to X without a
    // long fade.
    if (zone && snapshot.snapshot.scene) {
      const d: SceneTransitionData = snapshot.snapshot.scene.data;
      const target = d.to_zone as ZoneId;
      // 1ms fade = effectively instant; engine clamps to 1 frame.
      beginTransition(zone, target, 'instant', 1, nowMs);
    }

    // active_encounter: set encounter id + narrator line if present.
    if (log && snapshot.snapshot.active_encounter) {
      const d: EncounterSpawnData = snapshot.snapshot.active_encounter.data;
      log.activeEncounterId = d.encounter_id;
      if (d.narrator_line) {
        log.lastNarratorLine = d.narrator_line;
        log.lastNarratorTtlMs = 0;
      }
    } else if (log) {
      // No active encounter in the snapshot - clear if we had one.
      log.activeEncounterId = null;
    }
  }

  // Convenience: fetch + apply + return the tail_id. Application
  // uses the tail_id when constructing the replacement bridge so
  // duplicate replayed events are silently deduped.
  async recover(world: World): Promise<number> {
    const snap = await this.fetchSnapshot();
    this.applySnapshot(world, snap);
    return snap.tail_id;
  }

  // ----- Private helpers -----

  private buildUrl(): string {
    const sep = this.baseUrl.includes('?') ? '&' : '?';
    return this.baseUrl + sep + 'character_id=' + encodeURIComponent(this.characterId);
  }

  private validateResponse(raw: unknown, url: string): SnapshotResponse {
    if (!raw || typeof raw !== 'object') {
      throw new SnapshotFetchError('invalid', url, 'response is not an object');
    }
    const r = raw as Record<string, unknown>;
    if (r['ok'] !== true) {
      throw new SnapshotFetchError('invalid', url, 'response.ok is not true');
    }
    if (typeof r['character_id'] !== 'string') {
      throw new SnapshotFetchError('invalid', url, 'character_id missing or not a string');
    }
    if (typeof r['tail_id'] !== 'number' || r['tail_id'] < 0) {
      throw new SnapshotFetchError('invalid', url, 'tail_id missing or negative');
    }
    if (!r['snapshot'] || typeof r['snapshot'] !== 'object') {
      throw new SnapshotFetchError('invalid', url, 'snapshot field missing');
    }
    // The snapshot.* envelopes are validated lazily on apply; full
    // shape validation here would duplicate parseEnvelope. Trust
    // the server for v1.
    return r as unknown as SnapshotResponse;
  }
}
