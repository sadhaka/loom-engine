// TimelineLedger - events along a time axis with windowed render
// state for history views, replay scrubbers, lesson timelines,
// dashboard analytics.
//
// 1.5.1 enabling primitive (Wave 1.5 educational depth).
// ChartRenderer (1.5.0) is for X/Y data series. TimelineLedger
// is purpose-built for time-anchored EVENTS: a flag at t=300s,
// a milestone at t=1200s, a phase change at t=1800s. The
// consumer's renderer reads getSnapshot().events each frame and
// draws ticks / pins / labels along the timeline UI. Engine ships
// zero render path - consumer styles the events.
//
//   var t = TimelineLedger.create({ width: 800 });
//   t.add({ id: 'level_1', atTime: 60, kind: 'level',  label: 'Level 1' });
//   t.add({ id: 'boss',    atTime: 300, kind: 'boss',  label: 'First boss' });
//   t.add({ id: 'death',   atTime: 320, kind: 'death', label: 'Player died' });
//   t.setWindow(0, 600);
//
//   each frame:
//     t.forEach((e) => {
//       if (e.inWindow) renderer.drawPin(e.px, e.kind, e.label);
//     });
//
// Pairs with ChartRenderer (1.5.0, line/bar/scatter), ReplayRecorder
// (0.58, deterministic event recording), NarrativeMemory (1.3.5,
// remembered events).
//
// Code style: var-only in browser source.

export interface TimelineEvent<T = Record<string, unknown>> {
  id: string;
  // Scalar time coordinate (engine doesn't interpret unit:
  // ms / game-tick / lesson-position / wall-clock all work).
  atTime: number;
  kind: string;
  label?: string;
  tags?: string[];
  payload?: T;
}

export interface TimelineWindow {
  startTime: number;
  endTime: number;
}

export interface RenderedEvent<T = Record<string, unknown>> {
  id: string;
  atTime: number;
  kind: string;
  label: string | null;
  tags: string[] | null;
  payload?: T;
  // Screen x in pixels (mapped from atTime via current window).
  px: number;
  // True if atTime falls within the current window.
  inWindow: boolean;
  // 0..1 normalized position within window (clamped).
  windowPct: number;
}

export interface TimelineSnapshot<T = Record<string, unknown>> {
  width: number;
  paddingLeft: number;
  paddingRight: number;
  window: TimelineWindow;
  totalRange: TimelineWindow;
  events: RenderedEvent<T>[];
}

export interface TimelineLedgerOptions {
  // Plot width in pixels.
  width: number;
  // Side padding in pixels. Default 0 / 0.
  paddingLeft?: number;
  paddingRight?: number;
}

interface InternalEvent<T> {
  id: string;
  atTime: number;
  kind: string;
  label: string | null;
  tags: string[] | null;
  payload?: T;
}

export class TimelineLedger<T = Record<string, unknown>> {
  private events: Map<string, InternalEvent<T>> = new Map();
  private widthVal: number;
  private padL: number;
  private padR: number;
  private windowStart: number = 0;
  private windowEnd: number = 1;
  private windowExplicit: boolean = false;
  private disposed: boolean = false;

  private constructor(opts: TimelineLedgerOptions) {
    this.widthVal = isFinite(opts.width) && opts.width > 0 ? opts.width : 400;
    this.padL = opts.paddingLeft !== undefined && isFinite(opts.paddingLeft)
      ? opts.paddingLeft : 0;
    this.padR = opts.paddingRight !== undefined && isFinite(opts.paddingRight)
      ? opts.paddingRight : 0;
  }

  static create<T = Record<string, unknown>>(
    opts: TimelineLedgerOptions): TimelineLedger<T> {
    return new TimelineLedger<T>(opts);
  }

  // ---------- event CRUD ----------

  add(event: TimelineEvent<T>): boolean {
    if (this.disposed) return false;
    if (!event || typeof event.id !== 'string' || event.id.length === 0) return false;
    if (typeof event.kind !== 'string' || event.kind.length === 0) return false;
    if (!isFinite(event.atTime)) return false;
    var internal: InternalEvent<T> = {
      id: event.id,
      atTime: event.atTime,
      kind: event.kind,
      label: typeof event.label === 'string' ? event.label : null,
      tags: Array.isArray(event.tags) && event.tags.length > 0 ? event.tags.slice() : null,
    };
    if (event.payload !== undefined) internal.payload = event.payload;
    this.events.set(event.id, internal);
    if (!this.windowExplicit) this.recomputeAutoWindow();
    return true;
  }

  remove(id: string): boolean {
    if (this.disposed) return false;
    var ok = this.events.delete(id);
    if (ok && !this.windowExplicit) this.recomputeAutoWindow();
    return ok;
  }

  has(id: string): boolean {
    return this.events.has(id);
  }

  get(id: string): TimelineEvent<T> | null {
    var e = this.events.get(id);
    return e ? this.publicEvent(e) : null;
  }

  count(): number { return this.events.size; }

  // ---------- queries ----------

  // All events sorted by atTime ascending.
  list(): TimelineEvent<T>[] {
    var arr: InternalEvent<T>[] = [];
    var iter = this.events.values();
    var v = iter.next();
    while (!v.done) {
      arr.push(v.value);
      v = iter.next();
    }
    arr.sort(function (a, b) { return a.atTime - b.atTime; });
    var out: TimelineEvent<T>[] = [];
    for (var i = 0; i < arr.length; i++) {
      out.push(this.publicEvent(arr[i] as InternalEvent<T>));
    }
    return out;
  }

  byRange(startTime: number, endTime: number): TimelineEvent<T>[] {
    if (!isFinite(startTime) || !isFinite(endTime)) return [];
    var lo = Math.min(startTime, endTime);
    var hi = Math.max(startTime, endTime);
    var out: TimelineEvent<T>[] = [];
    var iter = this.events.values();
    var v = iter.next();
    while (!v.done) {
      var e = v.value;
      if (e.atTime >= lo && e.atTime <= hi) out.push(this.publicEvent(e));
      v = iter.next();
    }
    out.sort(function (a, b) { return a.atTime - b.atTime; });
    return out;
  }

  byKind(kind: string): TimelineEvent<T>[] {
    var out: TimelineEvent<T>[] = [];
    var iter = this.events.values();
    var v = iter.next();
    while (!v.done) {
      var e = v.value;
      if (e.kind === kind) out.push(this.publicEvent(e));
      v = iter.next();
    }
    out.sort(function (a, b) { return a.atTime - b.atTime; });
    return out;
  }

  byTag(tag: string): TimelineEvent<T>[] {
    var out: TimelineEvent<T>[] = [];
    var iter = this.events.values();
    var v = iter.next();
    while (!v.done) {
      var e = v.value;
      if (e.tags && e.tags.indexOf(tag) >= 0) out.push(this.publicEvent(e));
      v = iter.next();
    }
    out.sort(function (a, b) { return a.atTime - b.atTime; });
    return out;
  }

  // ---------- window ----------

  setWindow(startTime: number, endTime: number): boolean {
    if (this.disposed) return false;
    if (!isFinite(startTime) || !isFinite(endTime) || startTime === endTime) return false;
    this.windowStart = Math.min(startTime, endTime);
    this.windowEnd = Math.max(startTime, endTime);
    this.windowExplicit = true;
    return true;
  }

  resetWindow(): void {
    if (this.disposed) return;
    this.windowExplicit = false;
    this.recomputeAutoWindow();
  }

  getWindow(): TimelineWindow {
    return { startTime: this.windowStart, endTime: this.windowEnd };
  }

  setSize(width: number, paddingLeft?: number, paddingRight?: number): boolean {
    if (this.disposed) return false;
    if (!isFinite(width) || width <= 0) return false;
    this.widthVal = width;
    if (paddingLeft !== undefined && isFinite(paddingLeft)) this.padL = paddingLeft;
    if (paddingRight !== undefined && isFinite(paddingRight)) this.padR = paddingRight;
    return true;
  }

  // Total time span across all events.
  totalRange(): TimelineWindow {
    if (this.events.size === 0) return { startTime: 0, endTime: 0 };
    var minT = Infinity;
    var maxT = -Infinity;
    var iter = this.events.values();
    var v = iter.next();
    while (!v.done) {
      var e = v.value;
      if (e.atTime < minT) minT = e.atTime;
      if (e.atTime > maxT) maxT = e.atTime;
      v = iter.next();
    }
    return { startTime: minT, endTime: maxT };
  }

  // ---------- snapshot ----------

  getSnapshot(): TimelineSnapshot<T> {
    var sortedEvents = this.list();
    var rendered: RenderedEvent<T>[] = [];
    var span = this.windowEnd - this.windowStart;
    var plotW = Math.max(0, this.widthVal - this.padL - this.padR);
    for (var i = 0; i < sortedEvents.length; i++) {
      var e = sortedEvents[i] as TimelineEvent<T>;
      var pct = span > 0 ? (e.atTime - this.windowStart) / span : 0;
      var clampedPct = Math.max(0, Math.min(1, pct));
      var inWindow = e.atTime >= this.windowStart && e.atTime <= this.windowEnd;
      var px = this.padL + clampedPct * plotW;
      var renderedEvent: RenderedEvent<T> = {
        id: e.id,
        atTime: e.atTime,
        kind: e.kind,
        label: e.label ?? null,
        tags: e.tags ? e.tags.slice() : null,
        px: px,
        inWindow: inWindow,
        windowPct: clampedPct,
      };
      if (e.payload !== undefined) renderedEvent.payload = e.payload;
      rendered.push(renderedEvent);
    }
    return {
      width: this.widthVal,
      paddingLeft: this.padL,
      paddingRight: this.padR,
      window: this.getWindow(),
      totalRange: this.totalRange(),
      events: rendered,
    };
  }

  forEach(cb: (e: RenderedEvent<T>) => void): void {
    if (this.disposed) return;
    var snap = this.getSnapshot();
    for (var i = 0; i < snap.events.length; i++) {
      try { cb(snap.events[i] as RenderedEvent<T>); } catch { /* ignore */ }
    }
  }

  clear(): void {
    if (this.disposed) return;
    this.events.clear();
    if (!this.windowExplicit) this.recomputeAutoWindow();
  }

  dispose(): void {
    this.events.clear();
    this.disposed = true;
  }

  // ---------- private ----------

  private recomputeAutoWindow(): void {
    if (this.events.size === 0) {
      this.windowStart = 0;
      this.windowEnd = 1;
      return;
    }
    var range = this.totalRange();
    if (range.startTime === range.endTime) {
      this.windowStart = range.startTime - 0.5;
      this.windowEnd = range.startTime + 0.5;
    } else {
      this.windowStart = range.startTime;
      this.windowEnd = range.endTime;
    }
  }

  private publicEvent(e: InternalEvent<T>): TimelineEvent<T> {
    var out: TimelineEvent<T> = {
      id: e.id,
      atTime: e.atTime,
      kind: e.kind,
    };
    if (e.label !== null) out.label = e.label;
    if (e.tags !== null) out.tags = e.tags.slice();
    if (e.payload !== undefined) out.payload = e.payload;
    return out;
  }
}

// Resource key for the world's resource registry.
export const RESOURCE_TIMELINE_LEDGER = 'timeline_ledger';
