// EmotionState - per-character mood / fear / anger / joy gauges.
//
// 1.3.2 enabling primitive (Wave 1.3 AI persona depth).
// PersonaTrait (1.3.0) is the LONG-TERM bias of an NPC ("Mira is
// brave"). EmotionState is the RIGHT-NOW state ("Mira is terrified
// at this exact moment because she just saw a wolf"). Different
// timescale: traits decay over hours / days / forever; emotions
// decay over seconds / minutes. Pulse on events, decay otherwise,
// fire threshold callbacks when intensities cross.
//
//   var emo = EmotionState.create();
//   emo.defineEmotion({ id: 'fear', decayHalfLifeMs: 4000 });
//   emo.defineEmotion({
//     id: 'anger', decayHalfLifeMs: 6000,
//     thresholds: [{ level: 0.8, id: 'rage', onCross: () => triggerBerserker() }],
//   });
//
//   on hit:        emo.pulse('mira', 'fear', 0.5);
//   on insulted:   emo.pulse('mira', 'anger', 0.4);
//   each frame:    emo.tick(dtMs);
//
//   var dom = emo.dominant('mira');  // which emotion is loudest?
//   renderer.setFacialExpression(dom?.emotionId, dom?.value);
//
// Pairs with PersonaTrait (1.3.0, individual character traits),
// RelationshipGraph (1.3.1, per-pair bonds), DialogTree (0.61,
// often gated by emotion thresholds), VignetteRenderState (0.99,
// visualize fear as red overlay).
//
// Code style: var-only in browser source.

export interface EmotionThreshold {
  // Stable threshold id (e.g. 'panic', 'rage'). Optional.
  id?: string;
  // Level to cross. Crossing UPWARD fires onCross.
  level: number;
  // Fired when value crosses level upward (was below, now >= level).
  onCross?: () => void;
}

export interface EmotionSpec {
  id: string;
  // Baseline value. Default 0.
  baseline?: number;
  // Decay half-life in ms toward baseline. Default 5000 (5s).
  decayHalfLifeMs?: number;
  // Threshold callbacks. Each fires once per upward crossing;
  // re-arms when value falls back below.
  thresholds?: EmotionThreshold[];
  data?: Record<string, unknown>;
}

export interface EmotionEntry {
  characterId: string;
  emotionId: string;
  value: number;       // clamped (default [-1, 1])
  rawValue: number;    // un-clamped
  ageMs: number;       // ms since last pulse / set
  // Highest absolute value reached since last reset / clear.
  peakValue: number;
}

// DominantEmotion is just an EmotionEntry — kept as a separate type
// alias for clarity at call sites. Sign of `value` is the consumer's
// to interpret (e.g. fear is semantically "negative" but its scalar
// value is positive when fear intensifies).
export type DominantEmotion = EmotionEntry;

export interface EmotionStateOptions {
  // Optional global value clamp. Default `[-1, 1]`.
  valueClamp?: (raw: number) => number;
  // Fired on any value change.
  onChange?: (entry: EmotionEntry) => void;
}

interface InternalThreshold extends EmotionThreshold {
  fired: boolean; // true between cross-up and fall-below re-arm
}

interface InternalEntry {
  characterId: string;
  emotionId: string;
  rawValue: number;
  ageMs: number;
  peakValue: number;
  thresholds: InternalThreshold[];
}

function defaultClamp(v: number): number {
  if (!isFinite(v)) return 0;
  if (v < -1) return -1;
  if (v > 1) return 1;
  return v;
}

function key(characterId: string, emotionId: string): string {
  return characterId + '|' + emotionId;
}

export class EmotionState {
  private specs: Map<string, EmotionSpec> = new Map();
  private entries: Map<string, InternalEntry> = new Map();
  private valueClamp: (raw: number) => number;
  private onChange: ((e: EmotionEntry) => void) | null;
  private disposed: boolean = false;

  private constructor(opts: EmotionStateOptions) {
    this.valueClamp = typeof opts.valueClamp === 'function'
      ? opts.valueClamp : defaultClamp;
    this.onChange = opts.onChange ?? null;
  }

  static create(opts: EmotionStateOptions = {}): EmotionState {
    return new EmotionState(opts);
  }

  // ---------- emotion spec management ----------

  defineEmotion(spec: EmotionSpec): boolean {
    if (this.disposed) return false;
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) return false;
    var clone: EmotionSpec = {
      id: spec.id,
      baseline: spec.baseline !== undefined && isFinite(spec.baseline)
        ? spec.baseline : 0,
      decayHalfLifeMs: spec.decayHalfLifeMs !== undefined
          && isFinite(spec.decayHalfLifeMs) && spec.decayHalfLifeMs >= 0
        ? spec.decayHalfLifeMs : 5000,
    };
    if (Array.isArray(spec.thresholds) && spec.thresholds.length > 0) {
      clone.thresholds = spec.thresholds.slice();
    }
    if (spec.data !== undefined) clone.data = spec.data;
    this.specs.set(spec.id, clone);
    return true;
  }

  hasEmotion(id: string): boolean {
    return this.specs.has(id);
  }

  emotionIds(): string[] {
    var out: string[] = [];
    var keys = this.specs.keys();
    var k = keys.next();
    while (!k.done) {
      out.push(k.value);
      k = keys.next();
    }
    return out;
  }

  removeEmotion(id: string): boolean {
    if (this.disposed) return false;
    if (!this.specs.has(id)) return false;
    var toRemove: string[] = [];
    var keys = this.entries.keys();
    var k = keys.next();
    var suffix = '|' + id;
    while (!k.done) {
      if (k.value.length >= suffix.length
          && k.value.substring(k.value.length - suffix.length) === suffix) {
        toRemove.push(k.value);
      }
      k = keys.next();
    }
    for (var i = 0; i < toRemove.length; i++) {
      this.entries.delete(toRemove[i] as string);
    }
    return this.specs.delete(id);
  }

  // ---------- value get / set / pulse ----------

  // Pulse: add a delta to the current value. Most common usage.
  // Triggers threshold callbacks if the new value crosses upward.
  pulse(characterId: string, emotionId: string, delta: number): number | null {
    if (this.disposed) return null;
    if (typeof characterId !== 'string' || characterId.length === 0) return null;
    if (typeof emotionId !== 'string' || emotionId.length === 0) return null;
    if (!isFinite(delta)) return null;
    if (!this.specs.has(emotionId)) this.defineEmotion({ id: emotionId });
    var k = key(characterId, emotionId);
    var entry = this.entries.get(k);
    if (!entry) {
      entry = this.makeEntry(characterId, emotionId);
      this.entries.set(k, entry);
    }
    var oldClamped = this.valueClamp(entry.rawValue);
    entry.rawValue += delta;
    entry.ageMs = 0;
    var newClamped = this.valueClamp(entry.rawValue);
    var absVal = Math.abs(newClamped);
    if (absVal > entry.peakValue) entry.peakValue = absVal;
    this.checkThresholds(entry, oldClamped, newClamped);
    this.fireChange(entry);
    return newClamped;
  }

  set(characterId: string, emotionId: string, value: number): boolean {
    if (this.disposed) return false;
    if (typeof characterId !== 'string' || characterId.length === 0) return false;
    if (typeof emotionId !== 'string' || emotionId.length === 0) return false;
    if (!isFinite(value)) return false;
    if (!this.specs.has(emotionId)) this.defineEmotion({ id: emotionId });
    var k = key(characterId, emotionId);
    var entry = this.entries.get(k);
    var oldClamped = entry ? this.valueClamp(entry.rawValue) : 0;
    if (!entry) {
      entry = this.makeEntry(characterId, emotionId);
      this.entries.set(k, entry);
    }
    entry.rawValue = value;
    entry.ageMs = 0;
    var newClamped = this.valueClamp(entry.rawValue);
    var absVal = Math.abs(newClamped);
    if (absVal > entry.peakValue) entry.peakValue = absVal;
    this.checkThresholds(entry, oldClamped, newClamped);
    this.fireChange(entry);
    return true;
  }

  getValue(characterId: string, emotionId: string): number {
    var entry = this.entries.get(key(characterId, emotionId));
    if (!entry) return 0;
    return this.valueClamp(entry.rawValue);
  }

  get(characterId: string, emotionId: string): EmotionEntry | null {
    var entry = this.entries.get(key(characterId, emotionId));
    return entry ? this.snapshot(entry) : null;
  }

  has(characterId: string, emotionId: string): boolean {
    return this.entries.has(key(characterId, emotionId));
  }

  remove(characterId: string, emotionId: string): boolean {
    if (this.disposed) return false;
    return this.entries.delete(key(characterId, emotionId));
  }

  isAbove(characterId: string, emotionId: string, threshold: number): boolean {
    return this.getValue(characterId, emotionId) >= threshold;
  }

  isBelow(characterId: string, emotionId: string, threshold: number): boolean {
    return this.getValue(characterId, emotionId) <= threshold;
  }

  // ---------- bulk reads ----------

  forCharacter(characterId: string): EmotionEntry[] {
    var out: EmotionEntry[] = [];
    var iter = this.entries.values();
    var v = iter.next();
    while (!v.done) {
      var e = v.value;
      if (e.characterId === characterId) out.push(this.snapshot(e));
      v = iter.next();
    }
    return out;
  }

  // Dominant emotion: highest absolute value for this character.
  // Returns null if no emotions.
  dominant(characterId: string): DominantEmotion | null {
    var bestEntry: InternalEntry | null = null;
    var bestAbs = -Infinity;
    var iter = this.entries.values();
    var v = iter.next();
    while (!v.done) {
      var e = v.value;
      if (e.characterId === characterId) {
        var clamped = this.valueClamp(e.rawValue);
        var abs = Math.abs(clamped);
        if (abs > bestAbs) {
          bestAbs = abs;
          bestEntry = e;
        }
      }
      v = iter.next();
    }
    if (!bestEntry) return null;
    return this.snapshot(bestEntry);
  }

  list(): EmotionEntry[] {
    var out: EmotionEntry[] = [];
    var iter = this.entries.values();
    var v = iter.next();
    while (!v.done) {
      out.push(this.snapshot(v.value));
      v = iter.next();
    }
    return out;
  }

  entryCount(): number { return this.entries.size; }
  emotionCount(): number { return this.specs.size; }

  // Reset peak tracking for a character (or all if characterId
  // omitted).
  resetPeaks(characterId?: string): void {
    if (this.disposed) return;
    var iter = this.entries.values();
    var v = iter.next();
    while (!v.done) {
      var e = v.value;
      if (characterId === undefined || e.characterId === characterId) {
        e.peakValue = Math.abs(this.valueClamp(e.rawValue));
      }
      v = iter.next();
    }
  }

  tick(dtMs: number): void {
    if (this.disposed) return;
    var dt = +dtMs;
    if (!isFinite(dt) || dt <= 0) return;
    var iter = this.entries.values();
    var v = iter.next();
    while (!v.done) {
      var e = v.value;
      e.ageMs += dt;
      var spec = this.specs.get(e.emotionId);
      if (spec && (spec.decayHalfLifeMs as number) > 0) {
        var halfLife = spec.decayHalfLifeMs as number;
        var factor = Math.pow(0.5, dt / halfLife);
        var baseline = spec.baseline as number;
        var newRaw = baseline + (e.rawValue - baseline) * factor;
        if (Math.abs(newRaw - e.rawValue) > 1e-9) {
          var oldClamped = this.valueClamp(e.rawValue);
          e.rawValue = newRaw;
          var newClamped = this.valueClamp(e.rawValue);
          // Re-arm thresholds when crossing downward.
          for (var i = 0; i < e.thresholds.length; i++) {
            var th = e.thresholds[i] as InternalThreshold;
            if (th.fired && newClamped < th.level) th.fired = false;
          }
          this.fireChange(e);
        }
      }
      v = iter.next();
    }
  }

  clear(): void {
    if (this.disposed) return;
    this.specs.clear();
    this.entries.clear();
  }

  dispose(): void {
    this.specs.clear();
    this.entries.clear();
    this.onChange = null;
    this.disposed = true;
  }

  // ---------- private ----------

  private makeEntry(characterId: string, emotionId: string): InternalEntry {
    var spec = this.specs.get(emotionId);
    var thresholds: InternalThreshold[] = [];
    if (spec && spec.thresholds) {
      for (var i = 0; i < spec.thresholds.length; i++) {
        var t = spec.thresholds[i] as EmotionThreshold;
        thresholds.push({
          ...(t.id !== undefined ? { id: t.id } : {}),
          level: t.level,
          ...(t.onCross !== undefined ? { onCross: t.onCross } : {}),
          fired: false,
        });
      }
    }
    return {
      characterId: characterId,
      emotionId: emotionId,
      rawValue: spec ? (spec.baseline as number) : 0,
      ageMs: 0,
      peakValue: 0,
      thresholds: thresholds,
    };
  }

  private checkThresholds(e: InternalEntry, oldClamped: number,
                          newClamped: number): void {
    if (e.thresholds.length === 0) return;
    for (var i = 0; i < e.thresholds.length; i++) {
      var th = e.thresholds[i] as InternalThreshold;
      var crossedUp = oldClamped < th.level && newClamped >= th.level;
      if (crossedUp && !th.fired) {
        th.fired = true;
        if (th.onCross) {
          try { th.onCross(); } catch { /* ignore */ }
        }
      } else if (th.fired && newClamped < th.level) {
        th.fired = false;
      }
    }
  }

  private fireChange(e: InternalEntry): void {
    if (!this.onChange) return;
    try { this.onChange(this.snapshot(e)); } catch { /* ignore */ }
  }

  private snapshot(e: InternalEntry): EmotionEntry {
    return {
      characterId: e.characterId,
      emotionId: e.emotionId,
      value: this.valueClamp(e.rawValue),
      rawValue: e.rawValue,
      ageMs: e.ageMs,
      peakValue: e.peakValue,
    };
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_EMOTION_STATE = 'emotion_state';
