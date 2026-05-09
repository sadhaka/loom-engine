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

export type SeriesKind = 'line' | 'bar' | 'scatter';

export type ChartPoint = [number, number] | { x: number; y: number };

export interface SeriesSpec {
  // Stable series id.
  id: string;
  // Render kind ('line' / 'bar' / 'scatter'). Default 'line'.
  kind?: SeriesKind;
  // Data points: tuples [x, y] or objects { x, y }.
  points: ChartPoint[];
  // Optional color / style hints (consumer interprets).
  color?: string;
  // Optional series label.
  label?: string;
  data?: Record<string, unknown>;
}

export interface AxisRange {
  min: number;
  max: number;
}

export interface ChartPadding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface ChartRendererOptions {
  width: number;
  height: number;
  padding?: ChartPadding;
  // Auto-fit Y range to data on every change. Default true.
  autoFitY?: boolean;
  // Auto-fit X range to data on every change. Default true.
  autoFitX?: boolean;
}

export interface RenderedPoint {
  // Screen-space coordinates (pixels from top-left).
  px: number;
  py: number;
  // Original data values.
  x: number;
  y: number;
}

export interface RenderedSeries {
  id: string;
  kind: SeriesKind;
  color: string | null;
  label: string | null;
  points: RenderedPoint[];
  data?: Record<string, unknown>;
}

export interface ChartSnapshot {
  width: number;
  height: number;
  plotArea: { x: number; y: number; width: number; height: number };
  axisX: AxisRange;
  axisY: AxisRange;
  series: RenderedSeries[];
}

interface InternalSeries {
  id: string;
  kind: SeriesKind;
  points: { x: number; y: number }[];
  color: string | null;
  label: string | null;
  data?: Record<string, unknown>;
}

function normalizePoints(pts: ChartPoint[]): { x: number; y: number }[] {
  var out: { x: number; y: number }[] = [];
  for (var i = 0; i < pts.length; i++) {
    var p = pts[i] as ChartPoint;
    if (Array.isArray(p)) {
      var x = p[0] as number;
      var y = p[1] as number;
      if (isFinite(x) && isFinite(y)) out.push({ x: x, y: y });
    } else if (p && typeof p === 'object') {
      if (isFinite((p as { x: number }).x)
          && isFinite((p as { y: number }).y)) {
        out.push({ x: (p as { x: number }).x, y: (p as { y: number }).y });
      }
    }
  }
  return out;
}

export class ChartRenderer {
  private widthVal: number;
  private heightVal: number;
  private padding: { top: number; right: number; bottom: number; left: number };
  private series: Map<string, InternalSeries> = new Map();
  private axisX: AxisRange = { min: 0, max: 1 };
  private axisY: AxisRange = { min: 0, max: 1 };
  private autoFitX: boolean;
  private autoFitY: boolean;
  private xExplicit: boolean = false;
  private yExplicit: boolean = false;
  private disposed: boolean = false;

  private constructor(opts: ChartRendererOptions) {
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

  static create(opts: ChartRendererOptions): ChartRenderer {
    return new ChartRenderer(opts);
  }

  // ---------- series management ----------

  addSeries(spec: SeriesSpec): boolean {
    if (this.disposed) return false;
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) return false;
    if (!Array.isArray(spec.points)) return false;
    var internal: InternalSeries = {
      id: spec.id,
      kind: spec.kind ?? 'line',
      points: normalizePoints(spec.points),
      color: typeof spec.color === 'string' ? spec.color : null,
      label: typeof spec.label === 'string' ? spec.label : null,
    };
    if (spec.data !== undefined) internal.data = spec.data;
    this.series.set(spec.id, internal);
    this.recomputeAutoFit();
    return true;
  }

  updatePoints(seriesId: string, points: ChartPoint[]): boolean {
    if (this.disposed) return false;
    var s = this.series.get(seriesId);
    if (!s) return false;
    if (!Array.isArray(points)) return false;
    s.points = normalizePoints(points);
    this.recomputeAutoFit();
    return true;
  }

  removeSeries(id: string): boolean {
    if (this.disposed) return false;
    var ok = this.series.delete(id);
    if (ok) this.recomputeAutoFit();
    return ok;
  }

  hasSeries(id: string): boolean {
    return this.series.has(id);
  }

  seriesCount(): number { return this.series.size; }

  // ---------- axes ----------

  setAxisRange(axis: 'x' | 'y', min: number, max: number): boolean {
    if (this.disposed) return false;
    if (!isFinite(min) || !isFinite(max) || min === max) return false;
    var lo = Math.min(min, max);
    var hi = Math.max(min, max);
    if (axis === 'x') {
      this.axisX = { min: lo, max: hi };
      this.xExplicit = true;
    } else {
      this.axisY = { min: lo, max: hi };
      this.yExplicit = true;
    }
    return true;
  }

  // Reset to auto-fit (subsequent data changes will auto-update).
  resetAxis(axis: 'x' | 'y'): void {
    if (axis === 'x') this.xExplicit = false;
    else this.yExplicit = false;
    this.recomputeAutoFit();
  }

  getAxisRange(axis: 'x' | 'y'): AxisRange {
    return axis === 'x' ? { ...this.axisX } : { ...this.axisY };
  }

  setSize(width: number, height: number): boolean {
    if (this.disposed) return false;
    if (!isFinite(width) || width <= 0 || !isFinite(height) || height <= 0) return false;
    this.widthVal = width;
    this.heightVal = height;
    return true;
  }

  // ---------- snapshot ----------

  getSnapshot(): ChartSnapshot {
    var plotX = this.padding.left;
    var plotY = this.padding.top;
    var plotW = Math.max(0, this.widthVal - this.padding.left - this.padding.right);
    var plotH = Math.max(0, this.heightVal - this.padding.top - this.padding.bottom);
    var rendered: RenderedSeries[] = [];
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

  forEach(cb: (series: RenderedSeries) => void): void {
    if (this.disposed) return;
    var snap = this.getSnapshot();
    for (var i = 0; i < snap.series.length; i++) {
      try { cb(snap.series[i] as RenderedSeries); } catch { /* ignore */ }
    }
  }

  list(): RenderedSeries[] {
    return this.getSnapshot().series;
  }

  // Convert a data point to screen coords (useful for crosshair /
  // tooltip rendering).
  toScreen(x: number, y: number): { px: number; py: number } {
    var plotX = this.padding.left;
    var plotY = this.padding.top;
    var plotW = Math.max(0, this.widthVal - this.padding.left - this.padding.right);
    var plotH = Math.max(0, this.heightVal - this.padding.top - this.padding.bottom);
    return this.dataToScreen(x, y, plotX, plotY, plotW, plotH);
  }

  clear(): void {
    if (this.disposed) return;
    this.series.clear();
    this.recomputeAutoFit();
  }

  dispose(): void {
    this.series.clear();
    this.disposed = true;
  }

  // ---------- private ----------

  private recomputeAutoFit(): void {
    if (!this.autoFitX && !this.autoFitY) return;
    if (this.xExplicit && this.yExplicit) return;
    var minX = Infinity, maxX = -Infinity;
    var minY = Infinity, maxY = -Infinity;
    var any = false;
    var iter = this.series.values();
    var v = iter.next();
    while (!v.done) {
      var s = v.value;
      for (var i = 0; i < s.points.length; i++) {
        var p = s.points[i] as { x: number; y: number };
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
        any = true;
      }
      v = iter.next();
    }
    if (!any) return;
    if (minX === maxX) maxX = minX + 1;
    if (minY === maxY) maxY = minY + 1;
    if (this.autoFitX && !this.xExplicit) {
      this.axisX = { min: minX, max: maxX };
    }
    if (this.autoFitY && !this.yExplicit) {
      this.axisY = { min: minY, max: maxY };
    }
  }

  private renderSeries(s: InternalSeries, plotX: number, plotY: number,
                       plotW: number, plotH: number): RenderedSeries {
    var pts: RenderedPoint[] = [];
    for (var i = 0; i < s.points.length; i++) {
      var p = s.points[i] as { x: number; y: number };
      var screen = this.dataToScreen(p.x, p.y, plotX, plotY, plotW, plotH);
      pts.push({ px: screen.px, py: screen.py, x: p.x, y: p.y });
    }
    var out: RenderedSeries = {
      id: s.id,
      kind: s.kind,
      color: s.color,
      label: s.label,
      points: pts,
    };
    if (s.data !== undefined) out.data = s.data;
    return out;
  }

  private dataToScreen(x: number, y: number, plotX: number, plotY: number,
                       plotW: number, plotH: number): { px: number; py: number } {
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
