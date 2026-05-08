// Loom Engine - Phase 14.3 perf bench (browser entry).
//
// Loads the same scenario suite the Node bench uses (perf-suite.ts)
// and renders the report into the page. The browser cannot write to
// disk, so the report is shown in the DOM AND offered as a
// downloadable JSON blob - the user clicks a link to save it under
// tools/bench-results/ for archival.
//
// What this measures that the Node bench cannot:
//   - Real device fps (background processes, throttling, OS scheduler)
//   - Real Canvas2DDevice / WebGL2Device backend cost (post-Track A)
//   - Real GPU + rasterizer + compositor budget at the device's actual
//     resolution
//
// What this still does NOT measure:
//   - Cold-cache asset load over real network (the asset-load scenario
//     uses stub fetch + stub decode for repeatability across runs)
//   - First-paint cost; bench starts AFTER the page is loaded
//
// To run:
//   1. npm run build         (engine -> dist/)
//   2. npm run build:bench:browser  (this file -> tools/dist-bench/)
//   3. serve tools/ over HTTP and open tools/perf-bench.html
//      (see tools/run-bench.sh / run-bench.ps1 for one-command run)

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
  type BenchReport,
  type ReportEnvironment as BuildReportEnvironment,
} from './perf-report.js';

interface BrowserOpts {
  frames: number;
  warmup: number;
  scenarios: ScenarioId[];
  label: string;
  backend: string;
}

function readQueryOpts(): BrowserOpts {
  const params = new URLSearchParams(window.location.search);
  const frames = parseInt(params.get('frames') ?? '900', 10);
  const warmup = parseInt(params.get('warmup') ?? '60', 10);
  const scenariosParam = params.get('scenarios') ?? '';
  const filter = scenariosParam.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  const scenarios: ScenarioId[] = filter.length === 0
    ? (SCENARIO_IDS.slice() as unknown as ScenarioId[])
    : filter.filter(isScenarioId);
  const label = params.get('label') ?? '';
  const backend = params.get('backend') ?? 'headless';
  return {
    frames: Number.isFinite(frames) && frames > 0 ? frames : 900,
    warmup: Number.isFinite(warmup) && warmup >= 0 ? warmup : 60,
    scenarios,
    label,
    backend,
  };
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error('missing element #' + id);
  return el;
}

function setStatus(line: string): void {
  const el = $('status');
  el.textContent = line;
}

function appendLog(line: string): void {
  const el = $('log');
  const t = document.createElement('div');
  t.textContent = line;
  el.appendChild(t);
  // Keep latest visible.
  el.scrollTop = el.scrollHeight;
}

// Yield to the event loop so long-running scenarios don't peg the
// renderer thread for the entire run. setTimeout 0 also lets the
// browser garbage-collect between sweeps.
function tick(): Promise<void> {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

async function runAll(opts: BrowserOpts): Promise<BenchReport> {
  const heap = makeHeapHelper();
  if (!heap.available) {
    appendLog('heap metrics unavailable in browser - heapDelta and peakHeap will be null.');
  }

  const results: ScenarioResult[] = [];

  for (const id of opts.scenarios) {
    if (id === 'sprite-scaling') {
      for (const n of SPRITE_SCALING_DEFAULT_COUNTS) {
        appendLog('sprite-scaling entities=' + n);
        await tick();
        results.push(runSpriteScaling({
          entityCount: n, frames: opts.frames, warmup: opts.warmup, heap,
        }));
      }
    } else if (id === 'animation-scaling') {
      for (const n of ANIMATION_SCALING_DEFAULT_COUNTS) {
        appendLog('animation-scaling entities=' + n);
        await tick();
        results.push(runAnimationScaling({
          entityCount: n, frames: opts.frames, warmup: opts.warmup, heap,
        }));
      }
    } else if (id === 'particle-stress') {
      for (const n of PARTICLE_STRESS_DEFAULT_BUDGETS) {
        appendLog('particle-stress budget=' + n);
        await tick();
        results.push(runParticleStress({
          particleBudget: n, frames: opts.frames, warmup: opts.warmup, heap,
        }));
      }
    } else if (id === 'sse-drain') {
      for (const n of SSE_DRAIN_DEFAULT_RATES) {
        appendLog('sse-drain eventsPerFrame=' + n);
        await tick();
        results.push(runSseDrain({
          eventsPerFrame: n, frames: opts.frames, warmup: opts.warmup, heap,
        }));
      }
    } else if (id === 'ecs-iteration') {
      for (const n of ECS_ITERATION_DEFAULT_COUNTS) {
        appendLog('ecs-iteration entities=' + n);
        await tick();
        const iter = n >= 100000 ? 200 : n >= 10000 ? 1000 : 5000;
        results.push(runEcsIteration({
          entityCount: n, iterations: iter, heap,
        }));
      }
    } else if (id === 'asset-load') {
      appendLog('asset-load iterations=200');
      await tick();
      results.push(await runAssetLoad({ iterations: 200, heap }));
    } else if (id === 'memory-sustained') {
      // Browser default a shorter sustained run so users can see the
      // result this decade. Still long enough to spot heap creep.
      appendLog('memory-sustained entities=1000 frames=1800 (30s @ 60fps)');
      await tick();
      results.push(runMemorySustained({
        entityCount: 1000, durationFrames: 1800, warmup: opts.warmup, heap,
      }));
    } else if (id === 'tint-alloc-churn') {
      appendLog('tint-alloc-churn ticks=5000');
      await tick();
      results.push(runTintAllocChurn({ ticks: 5000, warmup: 200, heap }));
    }
  }

  // Build env conditionally so exactOptionalPropertyTypes is happy.
  const env: BuildReportEnvironment = {
    runtime: 'browser',
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    backend: opts.backend,
  };
  if (opts.label) env.label = opts.label;

  return buildReport({
    environment: env,
    frames: opts.frames,
    warmup: opts.warmup,
    scenarios: opts.scenarios.slice(),
    results,
  });
}

function offerDownload(report: BenchReport): void {
  const json = reportToJson(report, true);
  const md = reportToMarkdown(report);

  const isoSafe = report.timestamp.replace(/[:.]/g, '-');
  const baseName = 'bench-' + isoSafe;

  const jsonBlob = new Blob([json], { type: 'application/json' });
  const mdBlob = new Blob([md], { type: 'text/markdown' });

  const downloads = $('downloads');
  downloads.innerHTML = '';

  const jsonLink = document.createElement('a');
  jsonLink.href = URL.createObjectURL(jsonBlob);
  jsonLink.download = baseName + '.json';
  jsonLink.textContent = 'download ' + baseName + '.json';
  downloads.appendChild(jsonLink);

  downloads.appendChild(document.createElement('br'));

  const mdLink = document.createElement('a');
  mdLink.href = URL.createObjectURL(mdBlob);
  mdLink.download = baseName + '.md';
  mdLink.textContent = 'download ' + baseName + '.md';
  downloads.appendChild(mdLink);
}

function renderReport(report: BenchReport): void {
  const md = reportToMarkdown(report);
  $('output').textContent = md;
}

async function start(): Promise<void> {
  const opts = readQueryOpts();
  setStatus('running... ' + opts.scenarios.length + ' scenario sweeps. Reload to abort.');
  appendLog('frames=' + opts.frames + ' warmup=' + opts.warmup
    + ' scenarios=' + opts.scenarios.join(','));
  appendLog('label=' + (opts.label || '(none)') + ' backend=' + opts.backend);

  const t0 = performance.now();
  let report: BenchReport;
  try {
    report = await runAll(opts);
  } catch (err) {
    setStatus('FAILED');
    appendLog('error: ' + (err instanceof Error ? err.stack ?? err.message : String(err)));
    throw err;
  }
  const elapsed = (performance.now() - t0) / 1000;

  setStatus('done in ' + elapsed.toFixed(1) + 's');
  renderReport(report);
  offerDownload(report);
}

// Bind to the start button so the user controls when the run starts -
// browser perf is sensitive to whether the tab is foregrounded, and an
// auto-start could be silently throttled.
function init(): void {
  const btn = document.getElementById('start') as HTMLButtonElement | null;
  if (!btn) {
    // Auto-start if no button (someone wired the page differently).
    void start();
    return;
  }
  btn.addEventListener('click', function () {
    btn.disabled = true;
    void start();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
