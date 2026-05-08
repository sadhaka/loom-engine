// Loom Engine - Phase 14.3 perf bench (Node entry).
//
// Drives the standardized scenarios in perf-suite.ts, formats a report
// via perf-report.ts, and writes JSON + Markdown output to
// tools/bench-results/<timestamp>.{json,md}. The browser entry
// (perf-bench-browser.ts) calls the same suite but renders to DOM
// instead of disk.
//
// The Phase 9.1 perf-bench.ts that this file replaces ran a fixed
// set of small/medium/large/xlarge sprite scenarios + a single
// tint-alloc-churn microbench. That older shape is now produced by
// the 'sprite-scaling' + 'tint-alloc-churn' scenarios here, with
// larger entity counts (50k) extending the curve. Pre-Phase-14.3
// log lines are NOT byte-compatible with the new format; the JSON
// schema (REPORT_SCHEMA_VERSION = 1) is the stable contract.
//
// CLI:
//   npx tsx tools/perf-bench.ts                         # all scenarios -> bench-results/
//   npx tsx tools/perf-bench.ts --out my-run.json       # specific output path
//   npx tsx tools/perf-bench.ts --format md             # markdown to stdout, no file
//   npx tsx tools/perf-bench.ts --format json           # JSON to stdout, no file
//   npx tsx tools/perf-bench.ts --label "MacBook M2"    # tag the report
//   npx tsx tools/perf-bench.ts --compare a.json b.json # diff two reports -> stdout
//
// Environment overrides:
//   BENCH_FRAMES=1800           default 1800 (30s @ 60fps)
//   BENCH_WARMUP=120            default 120 (2s @ 60fps)
//   BENCH_SCENARIOS=sprite-scaling,sse-drain    filter by id
//   BENCH_LABEL="iPhone SE"     tag the report (overridden by --label)
//
// To pick up heap metrics, launch with --expose-gc:
//   node --expose-gc --import=tsx tools/perf-bench.ts
// Or run via the wrapper script which does that for you:
//   bash tools/run-bench.sh
//   pwsh -File tools/run-bench.ps1

import { performance as nodePerformance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';

import {
  makeHeapHelper,
  runSpriteScaling,
  runAnimationScaling,
  runParticleStress,
  runSseDrain,
  runEcsIteration,
  runAssetLoad,
  runMemorySustained,
  runTintAllocChurn,
  SPRITE_SCALING_DEFAULT_COUNTS,
  ANIMATION_SCALING_DEFAULT_COUNTS,
  PARTICLE_STRESS_DEFAULT_BUDGETS,
  SSE_DRAIN_DEFAULT_RATES,
  ECS_ITERATION_DEFAULT_COUNTS,
  SCENARIO_IDS,
  isScenarioId,
  type ScenarioResult,
  type ScenarioId,
} from './perf-suite.js';
import {
  buildReport,
  reportToJson,
  reportToMarkdown,
  reportToConsole,
  compareReports,
  diffToMarkdown,
  type BenchReport,
  type ReportEnvironment,
} from './perf-report.js';

// Make performance.now resolvable inside perf-suite.ts when running
// under Node. The suite uses globalThis.performance; the perf_hooks
// module exposes it under that same name on modern Node, but importing
// it here ensures the polyfill path in nowMs() never fires.
if (typeof (globalThis as { performance?: Performance }).performance === 'undefined') {
  (globalThis as { performance?: Performance }).performance = nodePerformance as unknown as Performance;
}

interface CliArgs {
  out: string | null;
  format: 'json' | 'md' | 'console' | 'auto';
  label: string | null;
  compareBaseline: string | null;
  compareCurrent: string | null;
  // True when the user passed --no-write; we still print the report
  // but skip writing to disk.
  noWrite: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    out: null,
    format: 'auto',
    label: null,
    compareBaseline: null,
    compareCurrent: null,
    noWrite: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') { out.out = argv[++i] ?? null; }
    else if (a === '--format') {
      const v = argv[++i] ?? 'auto';
      if (v === 'json' || v === 'md' || v === 'console' || v === 'auto') out.format = v;
      else throw new Error('--format must be one of: json, md, console, auto');
    }
    else if (a === '--label') { out.label = argv[++i] ?? null; }
    else if (a === '--no-write') { out.noWrite = true; }
    else if (a === '--compare') {
      out.compareBaseline = argv[++i] ?? null;
      out.compareCurrent = argv[++i] ?? null;
      if (!out.compareBaseline || !out.compareCurrent) {
        throw new Error('--compare requires two paths: --compare BASELINE CURRENT');
      }
    }
    else if (a === '-h' || a === '--help') {
      printHelp();
      process.exit(0);
    }
    else if (a && a.startsWith('-')) {
      throw new Error('unknown flag: ' + a);
    }
  }
  return out;
}

function printHelp(): void {
  console.log('Loom Engine perf-bench');
  console.log('');
  console.log('Usage:');
  console.log('  npx tsx tools/perf-bench.ts [options]');
  console.log('');
  console.log('Options:');
  console.log('  --out <path>           write JSON + MD to a specific path (.json suffix appended/replaced)');
  console.log('  --format <fmt>         json | md | console | auto (default: auto)');
  console.log('  --label <text>         human-readable label tagging this run');
  console.log('  --no-write             do not write to disk; print only');
  console.log('  --compare <a> <b>      diff two report JSONs and print the markdown diff');
  console.log('  -h, --help             this message');
  console.log('');
  console.log('Environment:');
  console.log('  BENCH_FRAMES           per-scenario frames (default 1800)');
  console.log('  BENCH_WARMUP           warmup frames (default 120)');
  console.log('  BENCH_SCENARIOS        comma-separated id filter, e.g. sprite-scaling,sse-drain');
  console.log('  BENCH_LABEL            label override (--label takes precedence)');
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function selectedScenarios(): ScenarioId[] {
  const env = process.env['BENCH_SCENARIOS'] ?? '';
  const filter = env.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (filter.length === 0) return SCENARIO_IDS.slice();
  const out: ScenarioId[] = [];
  for (const f of filter) {
    if (isScenarioId(f)) {
      out.push(f);
    } else {
      console.warn('# warn: unknown scenario id "' + f + '" - ignoring. Valid ids: ' + SCENARIO_IDS.join(', '));
    }
  }
  return out;
}

function logProgress(line: string): void {
  // Single line per progress event; goes to stderr so --format json
  // stdout can be piped without interleaving.
  process.stderr.write('[bench] ' + line + '\n');
}

async function runAll(opts: {
  frames: number;
  warmup: number;
  scenarios: ScenarioId[];
  label: string | null;
}): Promise<BenchReport> {
  const heap = makeHeapHelper();
  if (!heap.available) {
    logProgress('heap metrics unavailable - relaunch with --expose-gc for heapDelta + peakHeap');
  }

  const results: ScenarioResult[] = [];

  for (const id of opts.scenarios) {
    if (id === 'sprite-scaling') {
      for (const n of SPRITE_SCALING_DEFAULT_COUNTS) {
        logProgress('sprite-scaling entities=' + n);
        results.push(runSpriteScaling({
          entityCount: n, frames: opts.frames, warmup: opts.warmup, heap,
        }));
      }
    } else if (id === 'animation-scaling') {
      for (const n of ANIMATION_SCALING_DEFAULT_COUNTS) {
        logProgress('animation-scaling entities=' + n);
        results.push(runAnimationScaling({
          entityCount: n, frames: opts.frames, warmup: opts.warmup, heap,
        }));
      }
    } else if (id === 'particle-stress') {
      for (const n of PARTICLE_STRESS_DEFAULT_BUDGETS) {
        logProgress('particle-stress budget=' + n);
        results.push(runParticleStress({
          particleBudget: n, frames: opts.frames, warmup: opts.warmup, heap,
        }));
      }
    } else if (id === 'sse-drain') {
      for (const n of SSE_DRAIN_DEFAULT_RATES) {
        logProgress('sse-drain eventsPerFrame=' + n);
        results.push(runSseDrain({
          eventsPerFrame: n, frames: opts.frames, warmup: opts.warmup, heap,
        }));
      }
    } else if (id === 'ecs-iteration') {
      for (const n of ECS_ITERATION_DEFAULT_COUNTS) {
        logProgress('ecs-iteration entities=' + n);
        const iter = n >= 100000 ? 200 : n >= 10000 ? 1000 : 5000;
        results.push(runEcsIteration({
          entityCount: n, iterations: iter, heap,
        }));
      }
    } else if (id === 'asset-load') {
      logProgress('asset-load iterations=200');
      results.push(await runAssetLoad({ iterations: 200, heap }));
    } else if (id === 'memory-sustained') {
      logProgress('memory-sustained entities=1000 frames=3600');
      results.push(runMemorySustained({
        entityCount: 1000, durationFrames: 3600, warmup: opts.warmup, heap,
      }));
    } else if (id === 'tint-alloc-churn') {
      logProgress('tint-alloc-churn ticks=5000');
      results.push(runTintAllocChurn({ ticks: 5000, warmup: 200, heap }));
    }
  }

  const label = opts.label ?? process.env['BENCH_LABEL'] ?? null;
  // Build env conditionally so exactOptionalPropertyTypes is happy.
  const env: ReportEnvironment = {
    runtime: 'node',
    nodeVersion: process.version,
    platform: process.platform + '/' + process.arch,
    hardwareConcurrency: os.cpus().length,
    backend: 'headless',
  };
  if (label) env.label = label;
  return buildReport({
    environment: env,
    frames: opts.frames,
    warmup: opts.warmup,
    scenarios: opts.scenarios.slice(),
    results,
  });
}

function timestampSlug(): string {
  const d = new Date();
  // ISO-ish but filename-safe: 2026-05-08T193045Z
  const pad = function (n: number): string { return n < 10 ? '0' + n : '' + n; };
  return d.getUTCFullYear() + '-'
    + pad(d.getUTCMonth() + 1) + '-'
    + pad(d.getUTCDate()) + 'T'
    + pad(d.getUTCHours())
    + pad(d.getUTCMinutes())
    + pad(d.getUTCSeconds()) + 'Z';
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function thisDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function defaultResultsDir(): string {
  return join(thisDir(), 'bench-results');
}

function writeReport(report: BenchReport, outFlag: string | null): { jsonPath: string; mdPath: string } {
  let basePath: string;
  if (outFlag) {
    const abs = isAbsolute(outFlag) ? outFlag : resolve(process.cwd(), outFlag);
    // Strip a trailing .json so we can produce both .json and .md from
    // one --out value.
    basePath = abs.replace(/\.json$/i, '');
  } else {
    const dir = defaultResultsDir();
    ensureDir(dir);
    basePath = join(dir, timestampSlug());
  }
  const jsonPath = basePath + '.json';
  const mdPath = basePath + '.md';
  ensureDir(dirname(jsonPath));
  writeFileSync(jsonPath, reportToJson(report, true), 'utf8');
  writeFileSync(mdPath, reportToMarkdown(report), 'utf8');
  return { jsonPath, mdPath };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Compare mode short-circuits the bench run; no scenarios execute.
  if (args.compareBaseline && args.compareCurrent) {
    if (!existsSync(args.compareBaseline)) {
      console.error('compare: baseline not found: ' + args.compareBaseline);
      process.exit(2);
    }
    if (!existsSync(args.compareCurrent)) {
      console.error('compare: current not found: ' + args.compareCurrent);
      process.exit(2);
    }
    const baseline = JSON.parse(readFileSync(args.compareBaseline, 'utf8')) as BenchReport;
    const current = JSON.parse(readFileSync(args.compareCurrent, 'utf8')) as BenchReport;
    const diff = compareReports(baseline, current);
    process.stdout.write(diffToMarkdown(diff) + '\n');
    return;
  }

  const frames = envInt('BENCH_FRAMES', 1800);
  const warmup = envInt('BENCH_WARMUP', 120);
  const scenarios = selectedScenarios();

  logProgress('frames=' + frames + ' warmup=' + warmup
    + ' scenarios=' + scenarios.join(',')
    + ' node=' + process.version);

  const report = await runAll({ frames, warmup, scenarios, label: args.label });

  const format = args.format === 'auto'
    ? (args.noWrite ? 'console' : 'console')
    : args.format;

  if (args.noWrite) {
    if (format === 'json') process.stdout.write(reportToJson(report, true) + '\n');
    else if (format === 'md') process.stdout.write(reportToMarkdown(report) + '\n');
    else process.stdout.write(reportToConsole(report) + '\n');
    return;
  }

  if (format === 'json') {
    process.stdout.write(reportToJson(report, true) + '\n');
  } else if (format === 'md') {
    process.stdout.write(reportToMarkdown(report) + '\n');
  } else {
    // console
    process.stdout.write(reportToConsole(report) + '\n');
  }

  const { jsonPath, mdPath } = writeReport(report, args.out);
  logProgress('wrote ' + jsonPath);
  logProgress('wrote ' + mdPath);
}

main().catch(function (err) {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
