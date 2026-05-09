// QuestLog - quest state machine + objective tracking.
//
// 0.63.0 enabling primitive. Quests follow a small state machine
// (offered → accepted → active → complete | failed) with one or
// more objectives that progress independently. QuestLog tracks
// every quest the player has been offered, the current state, and
// per-objective counts. Snapshot-friendly for save data.
//
// The quest CATALOG (definitions) is the consumer's responsibility.
// QuestLog only stores RUNTIME state keyed by quest id.
//
// Code style: var-only in browser source.
export class QuestLog {
    quests = new Map();
    nowFn;
    onStateChanged;
    onObjectiveProgress;
    disposed = false;
    constructor(opts) {
        this.nowFn = opts.now ?? Date.now;
        this.onStateChanged = opts.onStateChanged ?? null;
        this.onObjectiveProgress = opts.onObjectiveProgress ?? null;
    }
    static create(opts = {}) {
        return new QuestLog(opts);
    }
    // Begin tracking a quest in the 'offered' state. No-op if quest
    // already known. Returns true if the quest was newly added.
    offer(questId, opts) {
        if (this.disposed)
            return false;
        if (typeof questId !== 'string' || questId.length === 0)
            return false;
        if (this.quests.has(questId))
            return false;
        var objectives = [];
        for (var i = 0; i < opts.objectives.length; i++) {
            var od = opts.objectives[i];
            if (!od)
                continue;
            var obj = {
                id: od.id,
                required: Math.max(1, Math.floor(od.required)),
                progress: 0,
                done: false,
            };
            if (od.data !== undefined)
                obj.data = od.data;
            objectives.push(obj);
        }
        this.quests.set(questId, {
            id: questId,
            state: 'offered',
            stateChangedAtMs: this.nowFn(),
            objectives: objectives,
        });
        return true;
    }
    // Accept an offered quest. Transitions offered → accepted →
    // active in one call (acceptance is the implicit start).
    accept(questId) {
        var q = this.quests.get(questId);
        if (!q)
            return false;
        if (q.state !== 'offered')
            return false;
        this.transition(q, 'accepted');
        this.transition(q, 'active');
        return true;
    }
    // Decline an offered quest: removes it from the log.
    decline(questId) {
        var q = this.quests.get(questId);
        if (!q)
            return false;
        if (q.state !== 'offered')
            return false;
        this.quests.delete(questId);
        return true;
    }
    // Mark a quest as failed. Allowed from 'accepted' or 'active'.
    fail(questId) {
        var q = this.quests.get(questId);
        if (!q)
            return false;
        if (q.state !== 'accepted' && q.state !== 'active')
            return false;
        this.transition(q, 'failed');
        return true;
    }
    // Force-complete a quest (consumer-decision; bypasses objective
    // checks). Only works from 'active'.
    complete(questId) {
        var q = this.quests.get(questId);
        if (!q)
            return false;
        if (q.state !== 'active')
            return false;
        // Mark every objective done.
        for (var i = 0; i < q.objectives.length; i++) {
            var obj = q.objectives[i];
            obj.progress = obj.required;
            obj.done = true;
        }
        this.transition(q, 'complete');
        return true;
    }
    // Add `n` to objective progress. If progress reaches required,
    // the objective is marked done. If every objective is done,
    // the quest auto-completes (transitions to 'complete'). Returns
    // true if the progress was applied; false if quest/objective
    // missing or quest not in 'active' state.
    addProgress(questId, objectiveId, n = 1) {
        if (this.disposed)
            return false;
        var q = this.quests.get(questId);
        if (!q || q.state !== 'active')
            return false;
        var obj = null;
        for (var i = 0; i < q.objectives.length; i++) {
            var o = q.objectives[i];
            if (o.id === objectiveId) {
                obj = o;
                break;
            }
        }
        if (!obj)
            return false;
        if (obj.done)
            return false;
        var amt = Math.floor(n);
        if (amt <= 0)
            return false;
        obj.progress = Math.min(obj.required, obj.progress + amt);
        if (obj.progress >= obj.required)
            obj.done = true;
        if (this.onObjectiveProgress) {
            try {
                this.onObjectiveProgress(questId, objectiveId, obj.progress, obj.required);
            }
            catch { /* ignore */ }
        }
        if (this.allDone(q)) {
            this.transition(q, 'complete');
        }
        return true;
    }
    // Read current state of a quest. Returns null if unknown.
    getState(questId) {
        var q = this.quests.get(questId);
        return q ? q.state : null;
    }
    // Read full quest entry. Returns a defensive copy.
    get(questId) {
        var q = this.quests.get(questId);
        if (!q)
            return null;
        return cloneEntry(q);
    }
    has(questId) {
        return this.quests.has(questId);
    }
    // List quest ids in a given state. Pass nothing for all.
    listIds(filter) {
        var out = [];
        this.quests.forEach((q, id) => {
            if (filter === undefined || q.state === filter)
                out.push(id);
        });
        return out;
    }
    // List quest entries (defensive copies) in a given state.
    list(filter) {
        var out = [];
        this.quests.forEach((q) => {
            if (filter === undefined || q.state === filter)
                out.push(cloneEntry(q));
        });
        return out;
    }
    count(filter) {
        if (filter === undefined)
            return this.quests.size;
        var n = 0;
        this.quests.forEach((q) => { if (q.state === filter)
            n++; });
        return n;
    }
    // Snapshot for save / load.
    toSnapshot() {
        var out = [];
        this.quests.forEach((q) => out.push(cloneEntry(q)));
        return out;
    }
    fromSnapshot(snap) {
        if (this.disposed)
            return;
        this.quests.clear();
        for (var i = 0; i < snap.length; i++) {
            var s = snap[i];
            if (!s || typeof s.id !== 'string')
                continue;
            this.quests.set(s.id, cloneEntry(s));
        }
    }
    dispose() {
        this.quests.clear();
        this.onStateChanged = null;
        this.onObjectiveProgress = null;
        this.disposed = true;
    }
    // ---------- private ----------
    transition(q, next) {
        var prev = q.state;
        if (prev === next)
            return;
        q.state = next;
        q.stateChangedAtMs = this.nowFn();
        if (this.onStateChanged) {
            try {
                this.onStateChanged(q.id, prev, next);
            }
            catch { /* ignore */ }
        }
    }
    allDone(q) {
        if (q.objectives.length === 0)
            return false; // empty objectives stay open until force-complete
        for (var i = 0; i < q.objectives.length; i++) {
            if (!q.objectives[i].done)
                return false;
        }
        return true;
    }
}
function cloneEntry(q) {
    return {
        id: q.id,
        state: q.state,
        stateChangedAtMs: q.stateChangedAtMs,
        objectives: q.objectives.map((o) => {
            var copy = {
                id: o.id,
                required: o.required,
                progress: o.progress,
                done: o.done,
            };
            if (o.data !== undefined)
                copy.data = o.data;
            return copy;
        }),
    };
}
// Resource key for the world's resource registry.
export const RESOURCE_QUEST_LOG = 'quest_log';
//# sourceMappingURL=quest-log.js.map