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
import { RESOURCE_KNOT_CONTEXT } from './director-bridge.js';
import { RESOURCE_VEIL_BUDGET, } from '../resources.js';
import { RESOURCE_DIRECTOR_LOG, } from './director-system.js';
import { RESOURCE_ZONE_STATE, beginTransition, } from '../zone/zone-state.js';
export class SnapshotFetchError extends Error {
    kind;
    status;
    url;
    constructor(kind, url, message, status = 0) {
        super('SnapshotFetchError[' + kind + '] ' + url + ': ' + message);
        this.name = 'SnapshotFetchError';
        this.kind = kind;
        this.url = url;
        this.status = status;
    }
}
// Tier-to-scalar table mirrors DirectorSystem so applying a
// snapshot's ve.budget produces the same engine state as a live
// ve.budget.update event would.
const PARTICLE_BUDGET_BASE = 4096;
const SHADER_BUDGET_BASE = 8;
const TIER_SCALARS = {
    green: { particle: 1.0, audio: 1.0, shader: 1.0 },
    amber: { particle: 0.5, audio: 0.7, shader: 0.5 },
    red: { particle: 0.05, audio: 0.4, shader: 0.0 },
};
export class SnapshotRecoveryHelper {
    baseUrl;
    characterId;
    fetchImpl;
    constructor(opts) {
        this.baseUrl = opts.baseUrl;
        this.characterId = opts.characterId;
        if (opts.fetchImpl) {
            this.fetchImpl = opts.fetchImpl;
        }
        else {
            if (typeof fetch === 'undefined') {
                throw new Error('SnapshotRecoveryHelper: fetch is unavailable. Pass options.fetchImpl in non-DOM contexts.');
            }
            this.fetchImpl = fetch;
        }
    }
    // Fetch + parse the snapshot. Throws SnapshotFetchError on any
    // failure (network, non-2xx HTTP, JSON parse, shape validation).
    async fetchSnapshot() {
        const url = this.buildUrl();
        let resp;
        try {
            resp = await this.fetchImpl(url, { credentials: 'include' });
        }
        catch (err) {
            throw new SnapshotFetchError('network', url, err instanceof Error ? err.message : String(err));
        }
        if (!resp.ok) {
            throw new SnapshotFetchError('http', url, 'HTTP ' + resp.status + ' ' + resp.statusText, resp.status);
        }
        let raw;
        try {
            raw = await resp.json();
        }
        catch (err) {
            throw new SnapshotFetchError('parse', url, err instanceof Error ? err.message : String(err));
        }
        return this.validateResponse(raw, url);
    }
    // Apply the snapshot to the world's engine resources. Pure (no
    // network I/O). Idempotent - reapplying the same snapshot is safe.
    applySnapshot(world, snapshot) {
        const knotCtx = world.resources.get(RESOURCE_KNOT_CONTEXT);
        const budget = world.resources.get(RESOURCE_VEIL_BUDGET);
        const log = world.resources.get(RESOURCE_DIRECTOR_LOG);
        const zone = world.resources.get(RESOURCE_ZONE_STATE);
        const nowMs = typeof performance !== 'undefined' ? performance.now() : 0;
        // knot_context: apply palette + mood with a short fade so the
        // visual snap-in isn't jarring.
        if (knotCtx && snapshot.snapshot.knot_context) {
            const d = snapshot.snapshot.knot_context.data;
            knotCtx.knot = d.knot;
            knotCtx.mood = d.mood;
            // Use a short fade (200ms) regardless of the original event's
            // fade_ms because we're snapping, not transitioning.
            knotCtx.beginFade(d.palette, 200, nowMs);
            if (log)
                log.lastKnot = d.knot;
        }
        // ve_budget: apply tier + scalar like DirectorSystem does.
        if (budget && snapshot.snapshot.ve_budget) {
            const d = snapshot.snapshot.ve_budget.data;
            const scalars = TIER_SCALARS[d.tier];
            budget.particleBudget = Math.round(PARTICLE_BUDGET_BASE * scalars.particle);
            budget.audioBudget = scalars.audio;
            budget.shaderBudget = Math.round(SHADER_BUDGET_BASE * scalars.shader);
            budget.eventBudget = d.encounter_budget_ve;
            if (log)
                log.lastTier = d.tier;
        }
        // scene: apply zone transition. If the snapshot's scene says
        // we're in zone X but our state says Y, snap to X without a
        // long fade.
        if (zone && snapshot.snapshot.scene) {
            const d = snapshot.snapshot.scene.data;
            const target = d.to_zone;
            // 1ms fade = effectively instant; engine clamps to 1 frame.
            beginTransition(zone, target, 'instant', 1, nowMs);
        }
        // active_encounter: set encounter id + narrator line if present.
        if (log && snapshot.snapshot.active_encounter) {
            const d = snapshot.snapshot.active_encounter.data;
            log.activeEncounterId = d.encounter_id;
            if (d.narrator_line) {
                log.lastNarratorLine = d.narrator_line;
                log.lastNarratorTtlMs = 0;
            }
        }
        else if (log) {
            // No active encounter in the snapshot - clear if we had one.
            log.activeEncounterId = null;
        }
    }
    // Convenience: fetch + apply + return the tail_id. Application
    // uses the tail_id when constructing the replacement bridge so
    // duplicate replayed events are silently deduped.
    async recover(world) {
        const snap = await this.fetchSnapshot();
        this.applySnapshot(world, snap);
        return snap.tail_id;
    }
    // ----- Private helpers -----
    buildUrl() {
        const sep = this.baseUrl.includes('?') ? '&' : '?';
        return this.baseUrl + sep + 'character_id=' + encodeURIComponent(this.characterId);
    }
    validateResponse(raw, url) {
        if (!raw || typeof raw !== 'object') {
            throw new SnapshotFetchError('invalid', url, 'response is not an object');
        }
        const r = raw;
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
        return r;
    }
}
//# sourceMappingURL=snapshot-recovery.js.map