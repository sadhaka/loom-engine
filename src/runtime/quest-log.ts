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

export type QuestState =
  | 'offered'
  | 'accepted'
  | 'active'
  | 'complete'
  | 'failed';

export interface QuestObjective {
  id: string;
  // Required progress to mark this objective complete.
  required: number;
  // Current progress.
  progress: number;
  // True if marked complete.
  done: boolean;
  // Optional payload (level, location, item id).
  data?: Record<string, unknown>;
}

export interface QuestEntry {
  id: string;
  state: QuestState;
  // Wall-clock timestamp when state last changed (consumer-supplied
  // via nowFn or Date.now).
  stateChangedAtMs: number;
  objectives: QuestObjective[];
}

export interface OfferQuestOptions {
  // Required objectives. Empty array = quest with no objectives
  // (instantly completable on accept if auto-complete is wanted).
  objectives: Array<{ id: string; required: number; data?: Record<string, unknown> }>;
}

export interface QuestLogOptions {
  // Optional clock seam.
  now?: () => number;
  // Fired on every state transition; receives (questId, prev, next).
  onStateChanged?: (questId: string, prev: QuestState, next: QuestState) => void;
  // Fired when an objective ticks up.
  onObjectiveProgress?: (questId: string, objectiveId: string, progress: number, required: number) => void;
}

export class QuestLog {
  private quests: Map<string, QuestEntry> = new Map();
  private nowFn: () => number;
  private onStateChanged: ((q: string, p: QuestState, n: QuestState) => void) | null;
  private onObjectiveProgress: ((q: string, o: string, p: number, r: number) => void) | null;
  private disposed: boolean = false;

  private constructor(opts: QuestLogOptions) {
    this.nowFn = opts.now ?? Date.now;
    this.onStateChanged = opts.onStateChanged ?? null;
    this.onObjectiveProgress = opts.onObjectiveProgress ?? null;
  }

  static create(opts: QuestLogOptions = {}): QuestLog {
    return new QuestLog(opts);
  }

  // Begin tracking a quest in the 'offered' state. No-op if quest
  // already known. Returns true if the quest was newly added.
  offer(questId: string, opts: OfferQuestOptions): boolean {
    if (this.disposed) return false;
    if (typeof questId !== 'string' || questId.length === 0) return false;
    if (this.quests.has(questId)) return false;
    var objectives: QuestObjective[] = [];
    for (var i = 0; i < opts.objectives.length; i++) {
      var od = opts.objectives[i];
      if (!od) continue;
      var obj: QuestObjective = {
        id: od.id,
        required: Math.max(1, Math.floor(od.required)),
        progress: 0,
        done: false,
      };
      if (od.data !== undefined) obj.data = od.data;
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
  accept(questId: string): boolean {
    var q = this.quests.get(questId);
    if (!q) return false;
    if (q.state !== 'offered') return false;
    this.transition(q, 'accepted');
    this.transition(q, 'active');
    return true;
  }

  // Decline an offered quest: removes it from the log.
  decline(questId: string): boolean {
    var q = this.quests.get(questId);
    if (!q) return false;
    if (q.state !== 'offered') return false;
    this.quests.delete(questId);
    return true;
  }

  // Mark a quest as failed. Allowed from 'accepted' or 'active'.
  fail(questId: string): boolean {
    var q = this.quests.get(questId);
    if (!q) return false;
    if (q.state !== 'accepted' && q.state !== 'active') return false;
    this.transition(q, 'failed');
    return true;
  }

  // Force-complete a quest (consumer-decision; bypasses objective
  // checks). Only works from 'active'.
  complete(questId: string): boolean {
    var q = this.quests.get(questId);
    if (!q) return false;
    if (q.state !== 'active') return false;
    // Mark every objective done.
    for (var i = 0; i < q.objectives.length; i++) {
      var obj = q.objectives[i] as QuestObjective;
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
  addProgress(questId: string, objectiveId: string, n: number = 1): boolean {
    if (this.disposed) return false;
    var q = this.quests.get(questId);
    if (!q || q.state !== 'active') return false;
    var obj: QuestObjective | null = null;
    for (var i = 0; i < q.objectives.length; i++) {
      var o = q.objectives[i] as QuestObjective;
      if (o.id === objectiveId) { obj = o; break; }
    }
    if (!obj) return false;
    if (obj.done) return false;
    var amt = Math.floor(n);
    if (amt <= 0) return false;
    obj.progress = Math.min(obj.required, obj.progress + amt);
    if (obj.progress >= obj.required) obj.done = true;
    if (this.onObjectiveProgress) {
      try { this.onObjectiveProgress(questId, objectiveId, obj.progress, obj.required); } catch { /* ignore */ }
    }
    if (this.allDone(q)) {
      this.transition(q, 'complete');
    }
    return true;
  }

  // Read current state of a quest. Returns null if unknown.
  getState(questId: string): QuestState | null {
    var q = this.quests.get(questId);
    return q ? q.state : null;
  }

  // Read full quest entry. Returns a defensive copy.
  get(questId: string): QuestEntry | null {
    var q = this.quests.get(questId);
    if (!q) return null;
    return cloneEntry(q);
  }

  has(questId: string): boolean {
    return this.quests.has(questId);
  }

  // List quest ids in a given state. Pass nothing for all.
  listIds(filter?: QuestState): string[] {
    var out: string[] = [];
    this.quests.forEach((q, id) => {
      if (filter === undefined || q.state === filter) out.push(id);
    });
    return out;
  }

  // List quest entries (defensive copies) in a given state.
  list(filter?: QuestState): QuestEntry[] {
    var out: QuestEntry[] = [];
    this.quests.forEach((q) => {
      if (filter === undefined || q.state === filter) out.push(cloneEntry(q));
    });
    return out;
  }

  count(filter?: QuestState): number {
    if (filter === undefined) return this.quests.size;
    var n = 0;
    this.quests.forEach((q) => { if (q.state === filter) n++; });
    return n;
  }

  // Snapshot for save / load.
  toSnapshot(): QuestEntry[] {
    var out: QuestEntry[] = [];
    this.quests.forEach((q) => out.push(cloneEntry(q)));
    return out;
  }

  fromSnapshot(snap: ReadonlyArray<QuestEntry>): void {
    if (this.disposed) return;
    this.quests.clear();
    for (var i = 0; i < snap.length; i++) {
      var s = snap[i];
      if (!s || typeof s.id !== 'string') continue;
      this.quests.set(s.id, cloneEntry(s as QuestEntry));
    }
  }

  dispose(): void {
    this.quests.clear();
    this.onStateChanged = null;
    this.onObjectiveProgress = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private transition(q: QuestEntry, next: QuestState): void {
    var prev = q.state;
    if (prev === next) return;
    q.state = next;
    q.stateChangedAtMs = this.nowFn();
    if (this.onStateChanged) {
      try { this.onStateChanged(q.id, prev, next); } catch { /* ignore */ }
    }
  }

  private allDone(q: QuestEntry): boolean {
    if (q.objectives.length === 0) return false; // empty objectives stay open until force-complete
    for (var i = 0; i < q.objectives.length; i++) {
      if (!(q.objectives[i] as QuestObjective).done) return false;
    }
    return true;
  }
}

function cloneEntry(q: QuestEntry): QuestEntry {
  return {
    id: q.id,
    state: q.state,
    stateChangedAtMs: q.stateChangedAtMs,
    objectives: q.objectives.map((o) => {
      var copy: QuestObjective = {
        id: o.id,
        required: o.required,
        progress: o.progress,
        done: o.done,
      };
      if (o.data !== undefined) copy.data = o.data;
      return copy;
    }),
  };
}

// Resource key for the world's resource registry.
export const RESOURCE_QUEST_LOG = 'quest_log';
