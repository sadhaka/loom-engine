// ProgressTracker - skill mastery ledger using Bloom's taxonomy.
//
// 1.5.4 enabling primitive (Wave 1.5 educational depth). Used for
// learning-progress dashboards, adaptive content selection (only
// show advanced material once basics are mastered), achievement
// milestones based on mastery, learning analytics. Each skill
// tracks per-level mastery (0..1) across Bloom's six cognitive
// levels (remember / understand / apply / analyze / evaluate /
// create) plus a weighted aggregate. Mastery can decay over time
// without practice.
//
//   var pt = ProgressTracker.create();
//   pt.defineSkill({ id: 'algebra_linear', name: 'Linear algebra' });
//   pt.recordEvidence('algebra_linear', 'remember', 0.8, Date.now());
//   pt.recordEvidence('algebra_linear', 'apply', 0.6, Date.now());
//
//   var skill = pt.getSkill('algebra_linear');
//   if (skill!.overallMastery > 0.7) unlockAdvancedTopics();
//
// Pairs with QuestionBank (1.5.3, evidence source - quiz scores
// feed mastery), KnowledgeMap (1.5.5 capstone, prerequisite
// gating), ChartRenderer (1.5.0, mastery-over-time visualization).
//
// Code style: var-only in browser source.

export type BloomLevel =
  | 'remember'
  | 'understand'
  | 'apply'
  | 'analyze'
  | 'evaluate'
  | 'create';

export interface SkillSpec<T = Record<string, unknown>> {
  id: string;
  // Human-readable name.
  name: string;
  // Mastery decay rate per day. 0 = no decay (default).
  decayPerDay?: number;
  // Per-level weight in overallMastery aggregate. Defaults to
  // ascending weights favoring higher Bloom's levels (remember=1,
  // understand=1.2, apply=1.5, analyze=1.8, evaluate=2, create=2.5).
  levelWeights?: Partial<Record<BloomLevel, number>>;
  data?: T;
}

export interface SkillState<T = Record<string, unknown>> {
  id: string;
  name: string;
  // Per-level mastery 0..1.
  levels: Record<BloomLevel, number>;
  // Weighted aggregate 0..1.
  overallMastery: number;
  // Total evidence events recorded across all levels.
  evidenceCount: number;
  // ms timestamp of last evidence (or 0 if none).
  lastEvidenceAt: number;
  data?: T;
}

export interface ProgressTrackerOptions {
  // Time getter. Default returns 0 (consumer should pass `now`
  // explicitly to recordEvidence / tick).
  now?: () => number;
  // Default decay per day applied to skills without their own
  // override. Default 0.
  defaultDecayPerDay?: number;
}

const DAY_MS = 86400000;

const DEFAULT_LEVEL_WEIGHTS: Record<BloomLevel, number> = {
  remember: 1.0,
  understand: 1.2,
  apply: 1.5,
  analyze: 1.8,
  evaluate: 2.0,
  create: 2.5,
};

const ALL_LEVELS: BloomLevel[] = [
  'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create',
];

interface InternalSkill<T> {
  spec: SkillSpec<T>;
  levels: Record<BloomLevel, number>;
  weights: Record<BloomLevel, number>;
  // Per-level evidence count. Levels with 0 evidence are
  // "unmeasured" and excluded from the overallMastery weighted
  // average so untouched levels do not dilute the aggregate.
  levelEvidence: Record<BloomLevel, number>;
  evidenceCount: number;
  lastEvidenceAt: number;
}

function emptyLevels(): Record<BloomLevel, number> {
  return {
    remember: 0,
    understand: 0,
    apply: 0,
    analyze: 0,
    evaluate: 0,
    create: 0,
  };
}

function clamp01(v: number): number {
  if (!isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export class ProgressTracker<T = Record<string, unknown>> {
  private skills: Map<string, InternalSkill<T>> = new Map();
  private nowFn: () => number;
  private defaultDecay: number;
  private lastTickAt: number = 0;
  private hasTicked: boolean = false;
  private disposed: boolean = false;

  private constructor(opts: ProgressTrackerOptions) {
    this.nowFn = typeof opts.now === 'function' ? opts.now : function () { return 0; };
    this.defaultDecay = opts.defaultDecayPerDay !== undefined
        && isFinite(opts.defaultDecayPerDay) && opts.defaultDecayPerDay >= 0
      ? opts.defaultDecayPerDay : 0;
  }

  static create<T = Record<string, unknown>>(
    opts: ProgressTrackerOptions = {}): ProgressTracker<T> {
    return new ProgressTracker<T>(opts);
  }

  defineSkill(spec: SkillSpec<T>): boolean {
    if (this.disposed) return false;
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) return false;
    if (typeof spec.name !== 'string') return false;
    var weights: Record<BloomLevel, number> = { ...DEFAULT_LEVEL_WEIGHTS };
    if (spec.levelWeights) {
      for (var i = 0; i < ALL_LEVELS.length; i++) {
        var l = ALL_LEVELS[i] as BloomLevel;
        if (typeof spec.levelWeights[l] === 'number'
            && isFinite(spec.levelWeights[l] as number)
            && (spec.levelWeights[l] as number) >= 0) {
          weights[l] = spec.levelWeights[l] as number;
        }
      }
    }
    var clone: SkillSpec<T> = {
      id: spec.id,
      name: spec.name,
      decayPerDay: spec.decayPerDay !== undefined && isFinite(spec.decayPerDay)
          && spec.decayPerDay >= 0
        ? spec.decayPerDay : this.defaultDecay,
    };
    if (spec.levelWeights !== undefined) clone.levelWeights = { ...spec.levelWeights };
    if (spec.data !== undefined) clone.data = spec.data;
    this.skills.set(spec.id, {
      spec: clone,
      levels: emptyLevels(),
      weights: weights,
      levelEvidence: emptyLevels(),
      evidenceCount: 0,
      lastEvidenceAt: 0,
    });
    return true;
  }

  hasSkill(id: string): boolean {
    return this.skills.has(id);
  }

  removeSkill(id: string): boolean {
    if (this.disposed) return false;
    return this.skills.delete(id);
  }

  // Record evidence at a Bloom level. Score is 0..1; updates the
  // level via exponential moving average toward score (smoother
  // than overwriting).
  // Returns updated SkillState or null if skill missing / invalid.
  recordEvidence(skillId: string, level: BloomLevel, score: number,
                 now?: number): SkillState<T> | null {
    if (this.disposed) return null;
    var skill = this.skills.get(skillId);
    if (!skill) return null;
    if (ALL_LEVELS.indexOf(level) < 0) return null;
    if (!isFinite(score)) return null;
    var s = clamp01(score);
    var refTime = now !== undefined && isFinite(now) ? now : this.nowFn();
    // EMA with alpha=0.3 (responsive but stable; ~3-4 events for
    // ~75% influence).
    var prev = skill.levels[level];
    var alpha = 0.3;
    skill.levels[level] = clamp01(prev + alpha * (s - prev));
    skill.levelEvidence[level]++;
    skill.evidenceCount++;
    skill.lastEvidenceAt = refTime;
    return this.snapshot(skill);
  }

  // Apply decay since lastTickAt.
  tick(now?: number): void {
    if (this.disposed) return;
    var refTime = now !== undefined && isFinite(now) ? now : this.nowFn();
    if (!this.hasTicked) {
      this.hasTicked = true;
      this.lastTickAt = refTime;
      return;
    }
    var deltaMs = refTime - this.lastTickAt;
    if (deltaMs <= 0) return;
    var deltaDays = deltaMs / DAY_MS;
    this.lastTickAt = refTime;
    var iter = this.skills.values();
    var v = iter.next();
    while (!v.done) {
      var skill = v.value;
      var decay = skill.spec.decayPerDay as number;
      if (decay > 0) {
        var factor = Math.max(0, 1 - decay * deltaDays);
        for (var i = 0; i < ALL_LEVELS.length; i++) {
          var l = ALL_LEVELS[i] as BloomLevel;
          skill.levels[l] = clamp01(skill.levels[l] * factor);
        }
      }
      v = iter.next();
    }
  }

  getSkill(id: string): SkillState<T> | null {
    var skill = this.skills.get(id);
    return skill ? this.snapshot(skill) : null;
  }

  list(): SkillState<T>[] {
    var out: SkillState<T>[] = [];
    var iter = this.skills.values();
    var v = iter.next();
    while (!v.done) {
      out.push(this.snapshot(v.value));
      v = iter.next();
    }
    return out;
  }

  count(): number { return this.skills.size; }

  // Skills with overallMastery >= threshold.
  highMastery(threshold: number): SkillState<T>[] {
    if (!isFinite(threshold)) return [];
    var out: SkillState<T>[] = [];
    var iter = this.skills.values();
    var v = iter.next();
    while (!v.done) {
      var snap = this.snapshot(v.value);
      if (snap.overallMastery >= threshold) out.push(snap);
      v = iter.next();
    }
    return out;
  }

  // Skills with overallMastery < threshold.
  lowMastery(threshold: number): SkillState<T>[] {
    if (!isFinite(threshold)) return [];
    var out: SkillState<T>[] = [];
    var iter = this.skills.values();
    var v = iter.next();
    while (!v.done) {
      var snap = this.snapshot(v.value);
      if (snap.overallMastery < threshold) out.push(snap);
      v = iter.next();
    }
    return out;
  }

  // Force a skill back to zero (for retraining flows).
  resetSkill(id: string): boolean {
    if (this.disposed) return false;
    var skill = this.skills.get(id);
    if (!skill) return false;
    skill.levels = emptyLevels();
    skill.levelEvidence = emptyLevels();
    skill.evidenceCount = 0;
    skill.lastEvidenceAt = 0;
    return true;
  }

  clear(): void {
    if (this.disposed) return;
    this.skills.clear();
  }

  dispose(): void {
    this.skills.clear();
    this.disposed = true;
  }

  // ---------- private ----------

  private snapshot(skill: InternalSkill<T>): SkillState<T> {
    // Only levels with at least one evidence event count toward
    // overallMastery. Untouched levels are "unmeasured" rather
    // than "0 mastery" - excluding them stops a few practiced
    // levels from being dragged down by the rest.
    var totalWeight = 0;
    var weightedSum = 0;
    for (var i = 0; i < ALL_LEVELS.length; i++) {
      var l = ALL_LEVELS[i] as BloomLevel;
      if (skill.levelEvidence[l] <= 0) continue;
      totalWeight += skill.weights[l];
      weightedSum += skill.weights[l] * skill.levels[l];
    }
    var overall = totalWeight > 0 ? weightedSum / totalWeight : 0;
    var out: SkillState<T> = {
      id: skill.spec.id,
      name: skill.spec.name,
      levels: { ...skill.levels },
      overallMastery: clamp01(overall),
      evidenceCount: skill.evidenceCount,
      lastEvidenceAt: skill.lastEvidenceAt,
    };
    if (skill.spec.data !== undefined) out.data = skill.spec.data;
    return out;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_PROGRESS_TRACKER = 'progress_tracker';
