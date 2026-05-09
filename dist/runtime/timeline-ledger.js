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
export class TimelineLedger {
    events = new Map();
    widthVal;
    padL;
    padR;
    windowStart = 0;
    windowEnd = 1;
    windowExplicit = false;
    disposed = false;
    constructor(opts) {
        this.widthVal = isFinite(opts.width) && opts.width > 0 ? opts.width : 400;
        this.padL = opts.paddingLeft !== undefined && isFinite(opts.paddingLeft)
            ? opts.paddingLeft : 0;
        this.padR = opts.paddingRight !== undefined && isFinite(opts.paddingRight)
            ? opts.paddingRight : 0;
    }
    static create(opts) {
        return new TimelineLedger(opts);
    }
    // ---------- event CRUD ----------
    add(event) {
        if (this.disposed)
            return false;
        if (!event || typeof event.id !== 'string' || event.id.length === 0)
            return false;
        if (typeof event.kind !== 'string' || event.kind.length === 0)
            return false;
        if (!isFinite(event.atTime))
            return false;
        var internal = {
            id: event.id,
            atTime: event.atTime,
            kind: event.kind,
            label: typeof event.label === 'string' ? event.label : null,
            tags: Array.isArray(event.tags) && event.tags.length > 0 ? event.tags.slice() : null,
        };
        if (event.payload !== undefined)
            internal.payload = event.payload;
        this.events.set(event.id, internal);
        if (!this.windowExplicit)
            this.recomputeAutoWindow();
        return true;
    }
    remove(id) {
        if (this.disposed)
            return false;
        var ok = this.events.delete(id);
        if (ok && !this.windowExplicit)
            this.recomputeAutoWindow();
        return ok;
    }
    has(id) {
        return this.events.has(id);
    }
    get(id) {
        var e = this.events.get(id);
        return e ? this.publicEvent(e) : null;
    }
    count() { return this.events.size; }
    // ---------- queries ----------
    // All events sorted by atTime ascending.
    list() {
        var arr = [];
        var iter = this.events.values();
        var v = iter.next();
        while (!v.done) {
            arr.push(v.value);
            v = iter.next();
        }
        arr.sort(function (a, b) { return a.atTime - b.atTime; });
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            out.push(this.publicEvent(arr[i]));
        }
        return out;
    }
    byRange(startTime, endTime) {
        if (!isFinite(startTime) || !isFinite(endTime))
            return [];
        var lo = Math.min(startTime, endTime);
        var hi = Math.max(startTime, endTime);
        var out = [];
        var iter = this.events.values();
        var v = iter.next();
        while (!v.done) {
            var e = v.value;
            if (e.atTime >= lo && e.atTime <= hi)
                out.push(this.publicEvent(e));
            v = iter.next();
        }
        out.sort(function (a, b) { return a.atTime - b.atTime; });
        return out;
    }
    byKind(kind) {
        var out = [];
        var iter = this.events.values();
        var v = iter.next();
        while (!v.done) {
            var e = v.value;
            if (e.kind === kind)
                out.push(this.publicEvent(e));
            v = iter.next();
        }
        out.sort(function (a, b) { return a.atTime - b.atTime; });
        return out;
    }
    byTag(tag) {
        var out = [];
        var iter = this.events.values();
        var v = iter.next();
        while (!v.done) {
            var e = v.value;
            if (e.tags && e.tags.indexOf(tag) >= 0)
                out.push(this.publicEvent(e));
            v = iter.next();
        }
        out.sort(function (a, b) { return a.atTime - b.atTime; });
        return out;
    }
    // ---------- window ----------
    setWindow(startTime, endTime) {
        if (this.disposed)
            return false;
        if (!isFinite(startTime) || !isFinite(endTime) || startTime === endTime)
            return false;
        this.windowStart = Math.min(startTime, endTime);
        this.windowEnd = Math.max(startTime, endTime);
        this.windowExplicit = true;
        return true;
    }
    resetWindow() {
        if (this.disposed)
            return;
        this.windowExplicit = false;
        this.recomputeAutoWindow();
    }
    getWindow() {
        return { startTime: this.windowStart, endTime: this.windowEnd };
    }
    setSize(width, paddingLeft, paddingRight) {
        if (this.disposed)
            return false;
        if (!isFinite(width) || width <= 0)
            return false;
        this.widthVal = width;
        if (paddingLeft !== undefined && isFinite(paddingLeft))
            this.padL = paddingLeft;
        if (paddingRight !== undefined && isFinite(paddingRight))
            this.padR = paddingRight;
        return true;
    }
    // Total time span across all events.
    totalRange() {
        if (this.events.size === 0)
            return { startTime: 0, endTime: 0 };
        var minT = Infinity;
        var maxT = -Infinity;
        var iter = this.events.values();
        var v = iter.next();
        while (!v.done) {
            var e = v.value;
            if (e.atTime < minT)
                minT = e.atTime;
            if (e.atTime > maxT)
                maxT = e.atTime;
            v = iter.next();
        }
        return { startTime: minT, endTime: maxT };
    }
    // ---------- snapshot ----------
    getSnapshot() {
        var sortedEvents = this.list();
        var rendered = [];
        var span = this.windowEnd - this.windowStart;
        var plotW = Math.max(0, this.widthVal - this.padL - this.padR);
        for (var i = 0; i < sortedEvents.length; i++) {
            var e = sortedEvents[i];
            var pct = span > 0 ? (e.atTime - this.windowStart) / span : 0;
            var clampedPct = Math.max(0, Math.min(1, pct));
            var inWindow = e.atTime >= this.windowStart && e.atTime <= this.windowEnd;
            var px = this.padL + clampedPct * plotW;
            var renderedEvent = {
                id: e.id,
                atTime: e.atTime,
                kind: e.kind,
                label: e.label ?? null,
                tags: e.tags ? e.tags.slice() : null,
                px: px,
                inWindow: inWindow,
                windowPct: clampedPct,
            };
            if (e.payload !== undefined)
                renderedEvent.payload = e.payload;
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
    forEach(cb) {
        if (this.disposed)
            return;
        var snap = this.getSnapshot();
        for (var i = 0; i < snap.events.length; i++) {
            try {
                cb(snap.events[i]);
            }
            catch { /* ignore */ }
        }
    }
    clear() {
        if (this.disposed)
            return;
        this.events.clear();
        if (!this.windowExplicit)
            this.recomputeAutoWindow();
    }
    dispose() {
        this.events.clear();
        this.disposed = true;
    }
    // ---------- private ----------
    recomputeAutoWindow() {
        if (this.events.size === 0) {
            this.windowStart = 0;
            this.windowEnd = 1;
            return;
        }
        var range = this.totalRange();
        if (range.startTime === range.endTime) {
            this.windowStart = range.startTime - 0.5;
            this.windowEnd = range.startTime + 0.5;
        }
        else {
            this.windowStart = range.startTime;
            this.windowEnd = range.endTime;
        }
    }
    publicEvent(e) {
        var out = {
            id: e.id,
            atTime: e.atTime,
            kind: e.kind,
        };
        if (e.label !== null)
            out.label = e.label;
        if (e.tags !== null)
            out.tags = e.tags.slice();
        if (e.payload !== undefined)
            out.payload = e.payload;
        return out;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_TIMELINE_LEDGER = 'timeline_ledger';
//# sourceMappingURL=timeline-ledger.js.map