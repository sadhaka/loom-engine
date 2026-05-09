// Achievements - milestone tracker with progress + unlock callbacks.
//
// 0.75.0 enabling primitive. Achievements / trophies / titles all
// share the same shape: a named goal with a target progress value,
// a counter that the game advances as the player plays, and a flag
// that flips once when the counter crosses the target. The engine
// just owns the bookkeeping; consumers decide what counts as
// "progress" (kills, hours played, items collected, quests
// completed) and wire add() / set() at the appropriate sites.
//
//   var ach = Achievements.create({
//     onUnlocked: (spec) => toast.post(spec.data.label),
//   });
//   ach.register({ id: 'first-kill', target: 1, data: { label: 'First Blood' } });
//   ach.register({ id: 'centurion', target: 100, data: { label: 'Centurion' } });
//
//   // On a kill event:
//   ach.add('first-kill', 1);
//   ach.add('centurion', 1);
//
// Pairs with QuestLog (0.63), StatStack (0.59), and ToastQueue (0.65)
// for the standard "achievement popup" UX.
//
// Code style: var-only in browser source.

export interface AchievementSpec {
  id: string;
  // Target progress to unlock. Default 1 (one-shot binary
  // achievement). Must be positive.
  target?: number;
  // Pass-through metadata for the UI / logger (label, icon, hidden,
  // category, points, etc.).
  data?: Record<string, unknown>;
}

export interface ActiveAchievement {
  spec: AchievementSpec;
  progress: number;
  unlocked: boolean;
  // Monotonic counter assigned at unlock time (0 if not unlocked).
  // Useful for stable sort ("most recent unlocks first") without
  // requiring a clock seam.
  unlockedAt: number;
}

export interface AchievementsOptions {
  onUnlocked?: (spec: AchievementSpec, progress: number) => void;
  onProgress?: (spec: AchievementSpec, progress: number, prev: number) => void;
}

export interface AchievementSnapshotEntry {
  progress: number;
  unlocked: boolean;
  unlockedAt?: number;
}

interface InternalEntry {
  spec: AchievementSpec;
  target: number;
  progress: number;
  unlocked: boolean;
  unlockedAt: number;
}

export class Achievements {
  private entries: Map<string, InternalEntry> = new Map();
  private onUnlocked: ((spec: AchievementSpec, p: number) => void) | null;
  private onProgress: ((spec: AchievementSpec, n: number, p: number) => void) | null;
  private unlockSeq: number = 0;
  private disposed: boolean = false;

  private constructor(opts: AchievementsOptions) {
    this.onUnlocked = opts.onUnlocked ?? null;
    this.onProgress = opts.onProgress ?? null;
  }

  static create(opts: AchievementsOptions = {}): Achievements {
    return new Achievements(opts);
  }

  // Register an achievement. Returns false on duplicate / invalid.
  register(spec: AchievementSpec): boolean {
    if (this.disposed) return false;
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) return false;
    if (this.entries.has(spec.id)) return false;
    var target = spec.target !== undefined && isFinite(spec.target) && spec.target > 0
      ? spec.target : 1;
    var copy: AchievementSpec = { id: spec.id };
    if (spec.target !== undefined) copy.target = target;
    if (spec.data) copy.data = spec.data;
    this.entries.set(spec.id, {
      spec: copy,
      target: target,
      progress: 0,
      unlocked: false,
      unlockedAt: 0,
    });
    return true;
  }

  unregister(id: string): boolean {
    if (this.disposed) return false;
    return this.entries.delete(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  isUnlocked(id: string): boolean {
    var e = this.entries.get(id);
    return e ? e.unlocked : false;
  }

  getProgress(id: string): number {
    var e = this.entries.get(id);
    return e ? e.progress : 0;
  }

  // Add to current progress. Clamps at target. Fires onProgress on
  // every change; onUnlocked once when progress crosses target.
  // Returns false if disposed / unknown / no-op.
  add(id: string, delta: number): boolean {
    if (this.disposed) return false;
    var e = this.entries.get(id);
    if (!e) return false;
    var d = +delta;
    if (!isFinite(d) || d === 0) return false;
    return this.applyProgress(e, e.progress + d);
  }

  // Set absolute progress. Same fire / clamp rules as add().
  set(id: string, value: number): boolean {
    if (this.disposed) return false;
    var e = this.entries.get(id);
    if (!e) return false;
    var v = +value;
    if (!isFinite(v)) return false;
    return this.applyProgress(e, v);
  }

  // Reset a single achievement to progress 0 / unlocked false.
  // Returns false if not registered.
  reset(id: string): boolean {
    if (this.disposed) return false;
    var e = this.entries.get(id);
    if (!e) return false;
    e.progress = 0;
    e.unlocked = false;
    e.unlockedAt = 0;
    return true;
  }

  // Reset every achievement. Returns the count reset.
  resetAll(): number {
    if (this.disposed) return 0;
    var n = 0;
    this.entries.forEach((e) => {
      e.progress = 0;
      e.unlocked = false;
      e.unlockedAt = 0;
      n++;
    });
    return n;
  }

  // List of active achievements (defensive copies of surface fields).
  list(): ActiveAchievement[] {
    var out: ActiveAchievement[] = [];
    this.entries.forEach((e) => {
      out.push({
        spec: cloneSpec(e.spec),
        progress: e.progress,
        unlocked: e.unlocked,
        unlockedAt: e.unlockedAt,
      });
    });
    return out;
  }

  // Save: { id -> { progress, unlocked, unlockedAt } }.
  toSnapshot(): Record<string, AchievementSnapshotEntry> {
    var out: Record<string, AchievementSnapshotEntry> = {};
    this.entries.forEach((e, id) => {
      var entry: AchievementSnapshotEntry = {
        progress: e.progress,
        unlocked: e.unlocked,
      };
      if (e.unlockedAt > 0) entry.unlockedAt = e.unlockedAt;
      out[id] = entry;
    });
    return out;
  }

  // Restore from a snapshot. Unknown ids in the snapshot are
  // ignored; missing ids stay at their current values. Does NOT
  // fire onProgress / onUnlocked callbacks.
  fromSnapshot(snap: Record<string, AchievementSnapshotEntry>): void {
    if (this.disposed) return;
    if (!snap || typeof snap !== 'object') return;
    var keys = Object.keys(snap);
    for (var i = 0; i < keys.length; i++) {
      var id = keys[i] as string;
      var s = snap[id];
      if (!s) continue;
      var e = this.entries.get(id);
      if (!e) continue;
      var p = +s.progress;
      e.progress = isFinite(p) && p >= 0 ? Math.min(p, e.target) : 0;
      e.unlocked = !!s.unlocked;
      var ua = s.unlockedAt;
      e.unlockedAt = ua !== undefined && isFinite(ua) && ua > 0 ? ua : 0;
      if (e.unlockedAt > this.unlockSeq) this.unlockSeq = e.unlockedAt;
    }
  }

  dispose(): void {
    this.entries.clear();
    this.onUnlocked = null;
    this.onProgress = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private applyProgress(e: InternalEntry, raw: number): boolean {
    var prev = e.progress;
    var next = raw;
    if (next < 0) next = 0;
    if (next > e.target) next = e.target;
    if (next === prev) return false;
    e.progress = next;
    if (this.onProgress) {
      try { this.onProgress(e.spec, next, prev); } catch { /* ignore */ }
    }
    if (!e.unlocked && next >= e.target) {
      e.unlocked = true;
      this.unlockSeq += 1;
      e.unlockedAt = this.unlockSeq;
      if (this.onUnlocked) {
        try { this.onUnlocked(e.spec, next); } catch { /* ignore */ }
      }
    }
    return true;
  }
}

function cloneSpec(s: AchievementSpec): AchievementSpec {
  var copy: AchievementSpec = { id: s.id };
  if (s.target !== undefined) copy.target = s.target;
  if (s.data) copy.data = s.data;
  return copy;
}

// Resource key for the world's resource registry.
export const RESOURCE_ACHIEVEMENTS = 'achievements';
