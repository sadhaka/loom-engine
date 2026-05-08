// Loom Engine - Phase 14.3 perf report.
//
// Serializes ScenarioResult[] -> structured JSON, renders Markdown,
// and computes diffs between two reports.
//
// Schema is versioned (REPORT_SCHEMA_VERSION). Bump it when the
// shape changes in a way that breaks the comparator. The comparator
// refuses to diff reports of different schema versions; that's
// the point of the version field.
//
// Output is environment-tagged so a reader can tell whether a number
// is from Node bench (JS-only, no GPU cost) or browser bench
// (includes real device + canvas / WebGL backend cost). Mixing the
// two in a comparison without that tag would be misleading.

// Imports the BUILT engine (../dist/index.js) so the same file works
// in Node + browser. See perf-suite.ts header.
import {
  LOOM_ENGINE_VERSION,
} from '../dist/index.js';
import type { ScenarioResult } from './perf-suite.js';

export const REPORT_SCHEMA_VERSION = 1;

export interface ReportEnvironment {
  runtime: 'node' | 'browser';
  // Node: process.version (e.g. "v22.10.0"). Browser: undefined.
  nodeVersion?: string;
  // Node: process.platform + process.arch. Browser: undefined.
  platform?: string;
  // Browser: navigator.userAgent. Node: undefined.
  userAgent?: string;
  // Browser: navigator.hardwareConcurrency. Node: os.cpus().length when
  // available; the runner is responsible for filling it.
  hardwareConcurrency?: number;
  // Caller-supplied label so multi-machine comparisons stay
  // identifiable (e.g. "MacBook M2 Pro", "iPhone SE 2020", "Pixel 3a").
  label?: string;
  // Backend identifier - "headless" for the no-op device, "canvas2d"
  // when a real Canvas2DDevice is wired up, "webgl2" once Track A
  // lands. Critical for cross-backend comparisons.
  backend: string;
}

export interface BenchReport {
  schemaVersion: number;
  engineVersion: string;
  timestamp: string;        // ISO 8601 UTC
  environment: ReportEnvironment;
  config: {
    frames: number;
    warmup: number;
    scenarios: string[];
  };
  results: ScenarioResult[];
}

export interface BuildReportInput {
  environment: ReportEnvironment;
  frames: number;
  warmup: number;
  scenarios: string[];
  results: ScenarioResult[];
}

export function buildReport(input: BuildReportInput): BenchReport {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    engineVersion: LOOM_ENGINE_VERSION,
    timestamp: new Date().toISOString(),
    environment: input.environment,
    config: {
      frames: input.frames,
      warmup: input.warmup,
      scenarios: input.scenarios.slice(),
    },
    results: input.results,
  };
}

export function reportToJson(report: BenchReport, pretty: boolean = true): string {
  return JSON.stringify(report, null, pretty ? 2 : 0);
}

// ----- Markdown rendering -----

function fmt(n: number, digits: number = 2): string {
  if (!Number.isFinite(n)) return 'n/a';
  return n.toFixed(digits);
}

function fmtKb(v: number | null | undefined): string {
  if (v == null) return 'n/a';
  return v + ' KiB';
}

function fmtPct(v: number, digits: number = 2): string {
  return fmt(v, digits) + '%';
}

export function reportToMarkdown(report: BenchReport): string {
  const lines: string[] = [];
  lines.push('# Loom Engine perf report');
  lines.push('');
  lines.push('- engine: ' + report.engineVersion);
  lines.push('- timestamp: ' + report.timestamp);
  lines.push('- runtime: ' + report.environment.runtime + (report.environment.label ? ' (' + report.environment.label + ')' : ''));
  lines.push('- backend: ' + report.environment.backend);
  if (report.environment.nodeVersion) {
    lines.push('- node: ' + report.environment.nodeVersion);
  }
  if (report.environment.platform) {
    lines.push('- platform: ' + report.environment.platform);
  }
  if (report.environment.userAgent) {
    lines.push('- userAgent: ' + report.environment.userAgent);
  }
  if (report.environment.hardwareConcurrency != null) {
    lines.push('- hardwareConcurrency: ' + report.environment.hardwareConcurrency);
  }
  lines.push('- frames: ' + report.config.frames + ', warmup: ' + report.config.warmup);
  lines.push('- scenarios: ' + report.config.scenarios.join(', '));
  lines.push('');

  // Group by scenarioId so each section is a single sweep.
  const byScenario: Map<string, ScenarioResult[]> = new Map();
  for (let i = 0; i < report.results.length; i++) {
    const r = report.results[i];
    if (!r) continue;
    let bucket = byScenario.get(r.scenarioId);
    if (!bucket) {
      bucket = [];
      byScenario.set(r.scenarioId, bucket);
    }
    bucket.push(r);
  }

  for (const [scenarioId, bucket] of byScenario) {
    lines.push('## ' + scenarioId);
    lines.push('');
    lines.push('| variant | mean ms | p50 | p95 | p99 | fps_mean | fps_p95 | budget16% | slow% | drawCalls | heapDelta | peakHeap |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const r of bucket) {
      const s = r.stats;
      const row = [
        r.variant,
        s ? fmt(s.meanMs, 3) : 'n/a',
        s ? fmt(s.p50Ms, 3) : 'n/a',
        s ? fmt(s.p95Ms, 3) : 'n/a',
        s ? fmt(s.p99Ms, 3) : 'n/a',
        s ? fmt(s.fpsMean, 1) : 'n/a',
        s ? fmt(s.fpsP95, 1) : 'n/a',
        s ? fmtPct(s.budget16Pct, 1) : 'n/a',
        s ? fmtPct(s.slowFraction * 100, 2) : 'n/a',
        r.drawCallsPerFrame != null ? String(r.drawCallsPerFrame) : 'n/a',
        fmtKb(r.heapDeltaKb),
        fmtKb(r.peakHeapAboveBaselineKb),
      ];
      lines.push('| ' + row.join(' | ') + ' |');
    }
    // Custom metrics table only when at least one row carries any.
    const customRows = bucket.filter(function (r) { return r.customMetrics; });
    if (customRows.length > 0) {
      lines.push('');
      lines.push('### ' + scenarioId + ' custom metrics');
      lines.push('');
      // Collect keys union.
      const keySet: Set<string> = new Set();
      for (const r of customRows) {
        const cm = r.customMetrics;
        if (!cm) continue;
        for (const k of Object.keys(cm)) keySet.add(k);
      }
      const keys = Array.from(keySet);
      lines.push('| variant | ' + keys.join(' | ') + ' |');
      lines.push('|---|' + keys.map(function () { return '---:'; }).join('|') + '|');
      for (const r of customRows) {
        const cm = r.customMetrics ?? {};
        const row = [r.variant];
        for (const k of keys) {
          const v = cm[k];
          row.push(v != null ? fmt(v, 4) : 'n/a');
        }
        lines.push('| ' + row.join(' | ') + ' |');
      }
    }
    // Per-row notes.
    for (const r of bucket) {
      if (r.note) {
        lines.push('');
        lines.push('> ' + r.variant + ': ' + r.note);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ----- Diff / comparison -----

export interface DiffEntry {
  scenarioId: string;
  variant: string;
  metric: string;
  baseline: number;
  current: number;
  // Negative = current is lower (better for time-based metrics).
  // The summarizer interprets the sign; the diff itself is just math.
  absoluteDelta: number;
  percentDelta: number;     // (current - baseline) / baseline * 100
  // 'improvement' / 'regression' / 'neutral'. Computed against the
  // metric's known direction (lowerIsBetter for time/heap/slow,
  // higherIsBetter for fps).
  direction: 'improvement' | 'regression' | 'neutral';
}

export interface DiffReport {
  baselineMeta: BenchReport['environment'] & { engineVersion: string; timestamp: string };
  currentMeta: BenchReport['environment'] & { engineVersion: string; timestamp: string };
  entries: DiffEntry[];
  // Variants present in current but not baseline (or vice versa).
  unmatched: string[];
}

// Per-metric direction. lowerIsBetter for time/heap/slow; higher for
// fps. Anything not listed is treated as neutral (delta reported but
// no direction tag).
const METRIC_DIRECTION: Record<string, 'lower' | 'higher'> = {
  meanMs: 'lower',
  p50Ms: 'lower',
  p95Ms: 'lower',
  p99Ms: 'lower',
  maxMs: 'lower',
  fpsMean: 'higher',
  fpsP95: 'higher',
  slowFrames: 'lower',
  slowFraction: 'lower',
  longTaskMs: 'lower',
  budget16Pct: 'lower',
  heapDeltaKb: 'lower',
  peakHeapAboveBaselineKb: 'lower',
  drawCallsPerFrame: 'lower',
};

// Threshold below which a delta is considered noise / neutral.
const NEUTRAL_PCT = 1.0;

function classify(metric: string, baseline: number, current: number): DiffEntry['direction'] {
  if (!Number.isFinite(baseline) || !Number.isFinite(current) || baseline === 0) return 'neutral';
  const pct = ((current - baseline) / Math.abs(baseline)) * 100;
  if (Math.abs(pct) < NEUTRAL_PCT) return 'neutral';
  const dir = METRIC_DIRECTION[metric];
  if (!dir) return 'neutral';
  if (dir === 'lower') return pct < 0 ? 'improvement' : 'regression';
  return pct > 0 ? 'improvement' : 'regression';
}

function metricsForResult(r: ScenarioResult): Record<string, number> {
  const out: Record<string, number> = {};
  if (r.stats) {
    out['meanMs'] = r.stats.meanMs;
    out['p50Ms'] = r.stats.p50Ms;
    out['p95Ms'] = r.stats.p95Ms;
    out['p99Ms'] = r.stats.p99Ms;
    out['maxMs'] = r.stats.maxMs;
    out['fpsMean'] = r.stats.fpsMean;
    out['fpsP95'] = r.stats.fpsP95;
    out['slowFraction'] = r.stats.slowFraction;
    out['budget16Pct'] = r.stats.budget16Pct;
  }
  if (r.drawCallsPerFrame != null) out['drawCallsPerFrame'] = r.drawCallsPerFrame;
  if (r.heapDeltaKb != null) out['heapDeltaKb'] = r.heapDeltaKb;
  if (r.peakHeapAboveBaselineKb != null) out['peakHeapAboveBaselineKb'] = r.peakHeapAboveBaselineKb;
  if (r.customMetrics) {
    for (const k of Object.keys(r.customMetrics)) {
      const v = r.customMetrics[k];
      if (v != null) out['custom.' + k] = v;
    }
  }
  return out;
}

export function compareReports(baseline: BenchReport, current: BenchReport): DiffReport {
  if (baseline.schemaVersion !== current.schemaVersion) {
    throw new Error(
      'compareReports: schemaVersion mismatch (baseline=' + baseline.schemaVersion
      + ', current=' + current.schemaVersion + '). Re-run both bench passes on a single engine version.',
    );
  }
  const indexBy = function (rs: ScenarioResult[]): Map<string, ScenarioResult> {
    const m: Map<string, ScenarioResult> = new Map();
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i];
      if (!r) continue;
      m.set(r.scenarioId + '/' + r.variant, r);
    }
    return m;
  };
  const baseMap = indexBy(baseline.results);
  const curMap = indexBy(current.results);

  const entries: DiffEntry[] = [];
  const unmatched: string[] = [];
  for (const [k, cur] of curMap) {
    const base = baseMap.get(k);
    if (!base) {
      unmatched.push('+' + k);
      continue;
    }
    const baseMetrics = metricsForResult(base);
    const curMetrics = metricsForResult(cur);
    for (const m of Object.keys(curMetrics)) {
      const b = baseMetrics[m];
      const c = curMetrics[m];
      if (b == null || c == null) continue;
      if (!Number.isFinite(b) || !Number.isFinite(c)) continue;
      const absoluteDelta = c - b;
      const percentDelta = b === 0 ? 0 : (absoluteDelta / Math.abs(b)) * 100;
      entries.push({
        scenarioId: cur.scenarioId,
        variant: cur.variant,
        metric: m,
        baseline: b,
        current: c,
        absoluteDelta,
        percentDelta,
        direction: classify(m, b, c),
      });
    }
  }
  for (const [k] of baseMap) {
    if (!curMap.has(k)) unmatched.push('-' + k);
  }

  return {
    baselineMeta: {
      ...baseline.environment,
      engineVersion: baseline.engineVersion,
      timestamp: baseline.timestamp,
    },
    currentMeta: {
      ...current.environment,
      engineVersion: current.engineVersion,
      timestamp: current.timestamp,
    },
    entries,
    unmatched,
  };
}

export function diffToMarkdown(diff: DiffReport): string {
  const lines: string[] = [];
  lines.push('# Loom Engine perf diff');
  lines.push('');
  lines.push('- baseline: ' + diff.baselineMeta.engineVersion + ' / ' + diff.baselineMeta.runtime
    + ' / ' + diff.baselineMeta.backend + ' @ ' + diff.baselineMeta.timestamp);
  lines.push('- current:  ' + diff.currentMeta.engineVersion + ' / ' + diff.currentMeta.runtime
    + ' / ' + diff.currentMeta.backend + ' @ ' + diff.currentMeta.timestamp);
  if (diff.unmatched.length > 0) {
    lines.push('- unmatched variants: ' + diff.unmatched.join(', '));
  }
  if (diff.baselineMeta.runtime !== diff.currentMeta.runtime) {
    lines.push('');
    lines.push('> WARNING: runtime mismatch (' + diff.baselineMeta.runtime + ' vs '
      + diff.currentMeta.runtime + '). Cross-runtime numbers are not directly comparable; '
      + 'browser runs include device cost, Node runs do not.');
  }
  if (diff.baselineMeta.backend !== diff.currentMeta.backend) {
    lines.push('');
    lines.push('> NOTE: backend changed from "' + diff.baselineMeta.backend + '" to "'
      + diff.currentMeta.backend + '". This is the intended use of compare mode for '
      + 'Track A WebGL2 vs Canvas2D - read the diff with that lens.');
  }
  lines.push('');

  // Summary counts.
  let regressions = 0;
  let improvements = 0;
  for (const e of diff.entries) {
    if (e.direction === 'regression') regressions++;
    else if (e.direction === 'improvement') improvements++;
  }
  lines.push('- improvements: ' + improvements);
  lines.push('- regressions: ' + regressions);
  lines.push('- neutral: ' + (diff.entries.length - improvements - regressions));
  lines.push('');

  // Group by scenarioId.
  const byScenario: Map<string, DiffEntry[]> = new Map();
  for (const e of diff.entries) {
    let bucket = byScenario.get(e.scenarioId);
    if (!bucket) {
      bucket = [];
      byScenario.set(e.scenarioId, bucket);
    }
    bucket.push(e);
  }

  for (const [scenarioId, bucket] of byScenario) {
    // Sort: regressions first (worst at top), then improvements, then neutral.
    bucket.sort(function (a, b) {
      function rank(e: DiffEntry): number {
        if (e.direction === 'regression') return 0;
        if (e.direction === 'improvement') return 2;
        return 1;
      }
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return Math.abs(b.percentDelta) - Math.abs(a.percentDelta);
    });
    lines.push('## ' + scenarioId);
    lines.push('');
    lines.push('| variant | metric | baseline | current | abs Δ | % Δ | dir |');
    lines.push('|---|---|---:|---:|---:|---:|---|');
    for (const e of bucket) {
      const tag = e.direction === 'regression'
        ? 'REGR'
        : e.direction === 'improvement'
          ? 'BETR'
          : '----';
      lines.push('| ' + [
        e.variant,
        e.metric,
        fmt(e.baseline, 3),
        fmt(e.current, 3),
        fmt(e.absoluteDelta, 3),
        (e.percentDelta >= 0 ? '+' : '') + fmt(e.percentDelta, 2) + '%',
        tag,
      ].join(' | ') + ' |');
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ----- Console-friendly text rendering (no markdown overhead) -----
//
// For when the bench is invoked interactively and the user wants a
// quick look. Mirrors the structure of reportToMarkdown but plain text.

export function reportToConsole(report: BenchReport): string {
  const lines: string[] = [];
  lines.push('# Loom Engine perf report');
  lines.push('engine=' + report.engineVersion + ' runtime=' + report.environment.runtime
    + ' backend=' + report.environment.backend + ' ts=' + report.timestamp);
  if (report.environment.label) {
    lines.push('label=' + report.environment.label);
  }
  if (report.environment.userAgent) {
    lines.push('userAgent=' + report.environment.userAgent);
  }
  if (report.environment.nodeVersion) {
    lines.push('node=' + report.environment.nodeVersion + ' platform='
      + (report.environment.platform ?? 'unknown'));
  }
  lines.push('frames=' + report.config.frames + ' warmup=' + report.config.warmup);
  lines.push('');

  for (const r of report.results) {
    lines.push('## ' + r.scenarioId + ' ' + r.variant);
    if (r.stats) {
      const s = r.stats;
      lines.push('  mean=' + fmt(s.meanMs, 3) + 'ms  p50=' + fmt(s.p50Ms, 3)
        + 'ms  p95=' + fmt(s.p95Ms, 3) + 'ms  p99=' + fmt(s.p99Ms, 3)
        + 'ms  max=' + fmt(s.maxMs, 3) + 'ms');
      lines.push('  fps_mean=' + fmt(s.fpsMean, 1) + '  fps_p95=' + fmt(s.fpsP95, 1)
        + '  budget16=' + fmtPct(s.budget16Pct, 1)
        + '  slowFrames=' + s.slowFrames + ' (' + fmtPct(s.slowFraction * 100, 2) + ')');
    }
    if (r.drawCallsPerFrame != null) {
      lines.push('  drawCallsPerFrame=' + r.drawCallsPerFrame);
    }
    if (r.heapDeltaKb != null) {
      lines.push('  heapDelta=' + r.heapDeltaKb + ' KiB');
    }
    if (r.peakHeapAboveBaselineKb != null) {
      lines.push('  peakHeap=' + r.peakHeapAboveBaselineKb + ' KiB');
    }
    if (r.customMetrics) {
      const parts: string[] = [];
      for (const k of Object.keys(r.customMetrics)) {
        const v = r.customMetrics[k];
        if (v != null) parts.push(k + '=' + fmt(v, 4));
      }
      if (parts.length > 0) lines.push('  custom: ' + parts.join('  '));
    }
    if (r.note) lines.push('  note: ' + r.note);
    lines.push('');
  }
  return lines.join('\n');
}
