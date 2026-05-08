// ZoneAudioSystem - zone-event audio integration shell (Phase 17, Track C).
//
// Runs PHASE_RENDER, AFTER ZoneEventSystem (which appends every
// observed zone event to the per-zone ring buffer in
// ZoneEventLog.byZone[<zone>].recent). Each tick the audio system
// drains the local zone's ring buffer for events that landed THIS
// frame (i.e. events with id strictly greater than the last id we
// processed for that zone), looks up the consumer-registered mapping
// for each event type, and dispatches the resulting cue play through
// the registered CueCatalog / MusicDirector resources.
//
// This file ships ZERO mappings. Engine consumers (TheWorldTable.ai,
// etc.) register their own mappings for the cues they want to fire on
// each zone event type.
//
// Tolerances:
//   - Missing mapping for an event type: log + skip silently. Most
//     consumers will register only a subset of the seven zone event
//     types.
//   - Missing CueCatalog / MusicDirector resources: no-op gracefully.
//     The system keeps draining events but cue plays evaporate. This
//     lets a consumer wire ZoneAudioSystem before the catalog is built
//     (e.g. while audio assets are still loading) without crashing.
//   - Missing ZoneEventLog: no-op (nothing to drain).
//   - Missing AudioListener resource: cue plays still dispatch but
//     `listener` in the handler context falls back to a zero pose.
//   - Multiple mappings for the SAME event type: registerMapping
//     overwrites. unregisterMapping by eventType.
//
// Dispatch ORDER: registerMapping registration order is irrelevant
// since each event type has at most ONE handler. The order in which
// events are processed within a tick is the order they appear in
// ZoneEventLog.byZone[<zone>].recent (newest first, per Phase 16
// log semantics). Per spec we replay newest-first so a consumer that
// registers a music crossfade reacts to the latest knot pulse before
// older ones; the zone-events log is a deduped ring, so duplicates
// are not a concern.
import { RESOURCE_ZONE_EVENT_LOG, } from '../director/zone/zone-event-log.js';
// Resource keys (defined here as duplicate string constants to keep
// the system standalone). The values MATCH the ones declared in the
// Track A / Track B files; coordination merge will swap to a single
// import after 0.15.0 assembles.
// TODO[phase-17-merge]: replace these constants with re-imports from
// audio-listener-resource.ts / cue-catalog.ts / music-director.ts.
export const RESOURCE_AUDIO_LISTENER_STUB = 'audio_listener';
export const RESOURCE_CUE_CATALOG_STUB = 'cue_catalog';
export const RESOURCE_MUSIC_DIRECTOR_STUB = 'music_director';
// ---- The system ----
export class ZoneAudioSystem {
    name = 'zone-audio';
    mappings;
    currentZone;
    verbose;
    // Per-zone last processed event id. Drives the "events landed this
    // frame" filter so the system reads the per-zone ring buffer once
    // per tick and fires only fresh events.
    lastProcessedIdByZone;
    constructor(opts = {}) {
        this.mappings = new Map();
        this.currentZone = opts.currentZone ?? null;
        this.verbose = opts.verbose ?? false;
        this.lastProcessedIdByZone = new Map();
    }
    registerMapping(mapping) {
        if (!mapping || typeof mapping.eventType !== 'string'
            || typeof mapping.handle !== 'function') {
            return;
        }
        this.mappings.set(mapping.eventType, mapping);
    }
    unregisterMapping(eventType) {
        this.mappings.delete(eventType);
    }
    // For tests + introspection.
    hasMapping(eventType) {
        return this.mappings.has(eventType);
    }
    mappingCount() {
        return this.mappings.size;
    }
    update(world, _dt) {
        const log = world.resources.get(RESOURCE_ZONE_EVENT_LOG);
        if (!log)
            return;
        const cues = world.resources.get(RESOURCE_CUE_CATALOG_STUB) ?? null;
        const music = world.resources.get(RESOURCE_MUSIC_DIRECTOR_STUB) ?? null;
        const listenerRes = world.resources.get(RESOURCE_AUDIO_LISTENER_STUB);
        const listener = listenerRes
            ? listenerRes.pose
            : { x: 0, y: 0, z: 0 };
        const localZone = safeCurrentZone(this.currentZone);
        // Decide which zones to drain. With a local-zone filter set, we
        // drain ONLY that zone; without it, we drain every zone present
        // in the log (single-zone consumers + tests).
        const zonesToDrain = [];
        if (localZone !== null) {
            if (log.byZone.has(localZone))
                zonesToDrain.push(localZone);
        }
        else {
            for (const z of log.byZone.keys())
                zonesToDrain.push(z);
        }
        for (let zi = 0; zi < zonesToDrain.length; zi++) {
            const zone = zonesToDrain[zi];
            const entry = log.byZone.get(zone);
            if (!entry)
                continue;
            // recent[] is newest-first per Phase 16 ZoneEventLog convention.
            // We walk from oldest -> newest among UNSEEN events so handlers
            // see events in chronological order (e.g. boss.spawn before
            // boss.tick). Determine the cutoff by lastProcessedId for this
            // zone.
            const lastId = this.lastProcessedIdByZone.get(zone) ?? 0;
            let maxIdSeen = lastId;
            // Walk newest->oldest, collect unseen, then reverse so dispatch
            // is oldest->newest.
            const fresh = [];
            for (let i = 0; i < entry.recent.length; i++) {
                const ev = entry.recent[i];
                if (!ev)
                    continue;
                if (ev.id > lastId) {
                    fresh.push(ev);
                    if (ev.id > maxIdSeen)
                        maxIdSeen = ev.id;
                }
                else {
                    // Past the boundary; older events have already been
                    // processed.
                    break;
                }
            }
            if (fresh.length === 0)
                continue;
            // Reverse to oldest-first.
            for (let i = fresh.length - 1; i >= 0; i--) {
                const ev = fresh[i];
                const mapping = this.mappings.get(ev.type);
                if (!mapping) {
                    if (this.verbose) {
                        try {
                            console.log('[zone-audio] no mapping for ' + ev.type + ' (zone='
                                + ev.zone_id + ', id=' + ev.id + ')');
                        }
                        catch { /* ignore */ }
                    }
                    continue;
                }
                const ctx = {
                    cues,
                    music,
                    localZone,
                    listener,
                };
                let result = null;
                try {
                    result = mapping.handle(ev, ctx);
                }
                catch (err) {
                    if (this.verbose) {
                        try {
                            console.warn('[zone-audio] mapping handle threw', err);
                        }
                        catch { /* ignore */ }
                    }
                    result = null;
                }
                if (!result)
                    continue;
                if (typeof result.cue !== 'string' || result.cue.length === 0)
                    continue;
                if (!cues) {
                    // Catalog absent: silently drop the cue. The handler
                    // already ran (e.g. it called ctx.music.crossfadeMusic) so
                    // music side-effects still happen.
                    continue;
                }
                try {
                    cues.play(result.cue, result.options);
                }
                catch (err) {
                    if (this.verbose) {
                        try {
                            console.warn('[zone-audio] cues.play threw', err);
                        }
                        catch { /* ignore */ }
                    }
                }
            }
            this.lastProcessedIdByZone.set(zone, maxIdSeen);
        }
    }
}
function safeCurrentZone(fn) {
    if (!fn)
        return null;
    try {
        const z = fn();
        return typeof z === 'string' && z.length > 0 ? z : null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=zone-audio-system.js.map