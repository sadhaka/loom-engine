// ChartRenderer - render-state primitive for line / bar / scatter
// charts.
//
// 1.5.0 enabling primitive (Wave 1.5 educational / interactive sim
// depth opens). Tutorials, dashboards, training apps, learning
// platforms, in-game stat screens, end-of-run summaries - they all
// want charts. ChartRenderer is the data + axis + scaling layer
// the consumer's renderer reads each frame to draw lines, bars,
// scatter plots. Engine ships zero render path - the consumer
// reads transformed point coordinates and styles, draws in
// whatever style fits (Canvas2D, WebGL, DOM, SVG).
//
//   var chart = ChartRenderer.create({
//     width: 600, height: 300,
//     padding: { top: 20, right: 20, bottom: 40, left: 50 },
//   });
//   chart.addSeries({ id: 'hp_over_time', kind: 'line',
//                     points: [[0, 100], [10, 80], [20, 60], [30, 40]] });
//   chart.setAxisRange('x', 0, 30);
//   chart.setAxisRange('y', 0, 100);
//
//   each frame: chart.forEach((segment) => renderer.drawLine(...));
//
// Pairs with TimelineLedger (1.5.1 next, time-series events),
// NumberFormatter (0.98, axis tick labels), Localization (0.46,
// chart titles).
//
// Code style: var-only in browser source.
function normalizePoints(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        if (Array.isArray(p)) {
            var x = p[0];
            var y = p[1];
            if (isFinite(x) && isFinite(y))
                out.push({ x: x, y: y });
        }
        else if (p && typeof p === 'object') {
            if (isFinite(p.x)
                && isFinite(p.y)) {
                out.push({ x: p.x, y: p.y });
            }
        }
    }
    return out;
}
export class ChartRenderer {
    widthVal;
    heightVal;
    padding;
    series = new Map();
    axisX = { min: 0, max: 1 };
    axisY = { min: 0, max: 1 };
    autoFitX;
    autoFitY;
    xExplicit = false;
    yExplicit = false;
    disposed = false;
    constructor(opts) {
        this.widthVal = isFinite(opts.width) && opts.width > 0 ? opts.width : 400;
        this.heightVal = isFinite(opts.height) && opts.height > 0 ? opts.height : 200;
        this.padding = {
            top: opts.padding?.top !== undefined && isFinite(opts.padding.top)
                ? opts.padding.top : 10,
            right: opts.padding?.right !== undefined && isFinite(opts.padding.right)
                ? opts.padding.right : 10,
            bottom: opts.padding?.bottom !== undefined && isFinite(opts.padding.bottom)
                ? opts.padding.bottom : 30,
            left: opts.padding?.left !== undefined && isFinite(opts.padding.left)
                ? opts.padding.left : 40,
        };
        this.autoFitX = opts.autoFitX !== false;
        this.autoFitY = opts.autoFitY !== false;
    }
    static create(opts) {
        return new ChartRenderer(opts);
    }
    // ---------- series management ----------
    addSeries(spec) {
        if (this.disposed)
            return false;
        if (!spec || typeof spec.id !== 'string' || spec.id.length === 0)
            return false;
        if (!Array.isArray(spec.points))
            return false;
        var internal = {
            id: spec.id,
            kind: spec.kind ?? 'line',
            points: normalizePoints(spec.points),
            color: typeof spec.color === 'string' ? spec.color : null,
            label: typeof spec.label === 'string' ? spec.label : null,
        };
        if (spec.data !== undefined)
            internal.data = spec.data;
        this.series.set(spec.id, internal);
        this.recomputeAutoFit();
        return true;
    }
    updatePoints(seriesId, points) {
        if (this.disposed)
            return false;
        var s = this.series.get(seriesId);
        if (!s)
            return false;
        if (!Array.isArray(points))
            return false;
        s.points = normalizePoints(points);
        this.recomputeAutoFit();
        return true;
    }
    removeSeries(id) {
        if (this.disposed)
            return false;
        var ok = this.series.delete(id);
        if (ok)
            this.recomputeAutoFit();
        return ok;
    }
    hasSeries(id) {
        return this.series.has(id);
    }
    seriesCount() { return this.series.size; }
    // ---------- axes ----------
    setAxisRange(axis, min, max) {
        if (this.disposed)
            return false;
        if (!isFinite(min) || !isFinite(max) || min === max)
            return false;
        var lo = Math.min(min, max);
        var hi = Math.max(min, max);
        if (axis === 'x') {
            this.axisX = { min: lo, max: hi };
            this.xExplicit = true;
        }
        else {
            this.axisY = { min: lo, max: hi };
            this.yExplicit = true;
        }
        return true;
    }
    // Reset to auto-fit (subsequent data changes will auto-update).
    resetAxis(axis) {
        if (axis === 'x')
            this.xExplicit = false;
        else
            this.yExplicit = false;
        this.recomputeAutoFit();
    }
    getAxisRange(axis) {
        return axis === 'x' ? { ...this.axisX } : { ...this.axisY };
    }
    setSize(width, height) {
        if (this.disposed)
            return false;
        if (!isFinite(width) || width <= 0 || !isFinite(height) || height <= 0)
            return false;
        this.widthVal = width;
        this.heightVal = height;
        return true;
    }
    // ---------- snapshot ----------
    getSnapshot() {
        var plotX = this.padding.left;
        var plotY = this.padding.top;
        var plotW = Math.max(0, this.widthVal - this.padding.left - this.padding.right);
        var plotH = Math.max(0, this.heightVal - this.padding.top - this.padding.bottom);
        var rendered = [];
        var iter = this.series.values();
        var v = iter.next();
        while (!v.done) {
            rendered.push(this.renderSeries(v.value, plotX, plotY, plotW, plotH));
            v = iter.next();
        }
        return {
            width: this.widthVal,
            height: this.heightVal,
            plotArea: { x: plotX, y: plotY, width: plotW, height: plotH },
            axisX: { ...this.axisX },
            axisY: { ...this.axisY },
            series: rendered,
        };
    }
    forEach(cb) {
        if (this.disposed)
            return;
        var snap = this.getSnapshot();
        for (var i = 0; i < snap.series.length; i++) {
            try {
                cb(snap.series[i]);
            }
            catch { /* ignore */ }
        }
    }
    list() {
        return this.getSnapshot().series;
    }
    // Convert a data point to screen coords (useful for crosshair /
    // tooltip rendering).
    toScreen(x, y) {
        var plotX = this.padding.left;
        var plotY = this.padding.top;
        var plotW = Math.max(0, this.widthVal - this.padding.left - this.padding.right);
        var plotH = Math.max(0, this.heightVal - this.padding.top - this.padding.bottom);
        return this.dataToScreen(x, y, plotX, plotY, plotW, plotH);
    }
    clear() {
        if (this.disposed)
            return;
        this.series.clear();
        this.recomputeAutoFit();
    }
    dispose() {
        this.series.clear();
        this.disposed = true;
    }
    // ---------- private ----------
    recomputeAutoFit() {
        if (!this.autoFitX && !this.autoFitY)
            return;
        if (this.xExplicit && this.yExplicit)
            return;
        var minX = Infinity, maxX = -Infinity;
        var minY = Infinity, maxY = -Infinity;
        var any = false;
        var iter = this.series.values();
        var v = iter.next();
        while (!v.done) {
            var s = v.value;
            for (var i = 0; i < s.points.length; i++) {
                var p = s.points[i];
                if (p.x < minX)
                    minX = p.x;
                if (p.x > maxX)
                    maxX = p.x;
                if (p.y < minY)
                    minY = p.y;
                if (p.y > maxY)
                    maxY = p.y;
                any = true;
            }
            v = iter.next();
        }
        if (!any)
            return;
        if (minX === maxX)
            maxX = minX + 1;
        if (minY === maxY)
            maxY = minY + 1;
        if (this.autoFitX && !this.xExplicit) {
            this.axisX = { min: minX, max: maxX };
        }
        if (this.autoFitY && !this.yExplicit) {
            this.axisY = { min: minY, max: maxY };
        }
    }
    renderSeries(s, plotX, plotY, plotW, plotH) {
        var pts = [];
        for (var i = 0; i < s.points.length; i++) {
            var p = s.points[i];
            var screen = this.dataToScreen(p.x, p.y, plotX, plotY, plotW, plotH);
            pts.push({ px: screen.px, py: screen.py, x: p.x, y: p.y });
        }
        var out = {
            id: s.id,
            kind: s.kind,
            color: s.color,
            label: s.label,
            points: pts,
        };
        if (s.data !== undefined)
            out.data = s.data;
        return out;
    }
    dataToScreen(x, y, plotX, plotY, plotW, plotH) {
        var spanX = this.axisX.max - this.axisX.min;
        var spanY = this.axisY.max - this.axisY.min;
        var nx = spanX > 0 ? (x - this.axisX.min) / spanX : 0.5;
        var ny = spanY > 0 ? (y - this.axisY.min) / spanY : 0.5;
        return {
            px: plotX + nx * plotW,
            py: plotY + (1 - ny) * plotH, // y axis inverted (screen y goes down)
        };
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_CHART_RENDERER = 'chart_renderer';
//# sourceMappingURL=chart-renderer.js.map