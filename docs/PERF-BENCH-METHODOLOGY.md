# Loom Engine - Perf Bench Methodology

Phase 14.3. The infrastructure validates Track A (WebGL2 batcher) and any
future backend by producing comparable numbers across runs, machines, and
backends. The shape of the bench matters more than any one number; the
shape is what survives engine version bumps.

## What this measures and what it doesn't

What the bench DOES measure:

- JS-side cost of the per-frame engine loop (ECS update + system pipeline),
  separated from the device's draw cost via the no-op `HeadlessDevice` in
  Node and the real device in the browser.
- Allocation pressure across a sustained run, surfaced as
  `peakHeapAboveBaselineKb` (high-water mark above the post-warmup baseline)
  and `heapDeltaKb` (residual after a final GC).
- Per-scenario fps distribution: mean, p50, p95, p99, max, and the fraction
  of frames over the 16.7ms budget.
- Custom metrics where they add information: live particle count at end of
  particle stress; effective events/sec on SSE drain; mean ns/entity on
  ECS iteration.

What the bench DOES NOT measure:

- First-paint cost or page load. The bench starts AFTER the page loads.
- Real network asset latency. The asset-load scenario uses stub fetch and
  stub decode for cross-run repeatability; CDN time-to-first-byte is a
  separate concern.
- Power draw or thermals. Real-device fps under load reflects throttling
  but does not isolate the cause.
- Cross-tab work. Anything outside the bench's tab is invisible.
- Lighthouse-style synthetic scoring. The numbers here are engineering
  metrics, not marketing scores.

A regression in this bench means a regression in *engine* CPU work or
allocation. A regression in real-device fps that does NOT show up here
means the cost moved to GPU / rasterizer / compositor - exactly the kind
of result Track A is designed to look for.

## Running locally

### Node mode (fastest signal)

```sh
# POSIX
bash tools/run-bench.sh

# Windows PowerShell
pwsh -File tools/run-bench.ps1
```

This:

1. Runs `npm run build` to populate `dist/`.
2. Launches `node --expose-gc --import=tsx tools/perf-bench.ts`.
3. Writes JSON + Markdown to `tools/bench-results/<timestamp>.{json,md}`.

The `--expose-gc` flag is what lets the bench surface heap stats. Without
it, `heapDeltaKb` and `peakHeapAboveBaselineKb` are null.

To filter scenarios:

```sh
BENCH_SCENARIOS=sprite-scaling,ecs-iteration bash tools/run-bench.sh
```

To label a run for later comparison:

```sh
bash tools/run-bench.sh --label "MacBook M2 Pro / 2026-05-08"
```

### Browser mode (real-device numbers)

```sh
# POSIX
bash tools/run-bench.sh --browser

# Windows PowerShell
pwsh -File tools/run-bench.ps1 -Browser
```

This:

1. Builds the engine (`dist/`).
2. Compiles `tools/*.ts` into `tools/perf-suite.js`,
   `tools/perf-report.js`, `tools/perf-bench-browser.js`.
3. Serves the repo on `http://0.0.0.0:8088/` via `npx http-server`.
4. Prints the URL of `tools/perf-bench.html`.

Open the URL on the device under test. Click "Start bench". When done,
two download links appear: a JSON report and a Markdown summary. Save
both into `tools/bench-results/` to keep them with their Node-side peers.

The browser harness accepts query params:

| param | default | purpose |
|---|---|---|
| `frames` | 900 | per-scenario frames |
| `warmup` | 60 | warmup frames |
| `scenarios` | (all) | comma-separated id filter |
| `label` | (none) | tag the report (e.g. `iPhone%20SE%202020`) |
| `backend` | `headless` | record the backend tag (`canvas2d`, `webgl2`, ...) |

Example:

```
http://your-mac.local:8088/tools/perf-bench.html?label=Pixel%203a&backend=canvas2d&scenarios=sprite-scaling,particle-stress
```

## Real-device profile

The browser bench is the only honest source for fps numbers on a phone.
The Node bench can't see GPU cost, can't see browser scheduling, can't
see iOS thermal throttling.

### iPhone Safari (iOS 17+)

1. Connect the iPhone to the same Wi-Fi network as the dev machine.
2. Find the dev machine's LAN IP (`ipconfig getifaddr en0` on macOS,
   `ipconfig` on Windows).
3. Run `bash tools/run-bench.sh --browser` (or the PowerShell equivalent).
4. On the iPhone, open `http://<dev-machine-ip>:8088/tools/perf-bench.html?label=iPhone%20<model>%20<iOS-version>&backend=canvas2d`.
5. Plug the iPhone in (charging changes scheduler behavior, but stays
   reproducible if you always run charging or always run battery).
6. **Disable Low Power Mode** - it caps the renderer at ~50% throughput.
7. **Foreground the tab** during the run. Backgrounded tabs are throttled
   to ~1fps; mean frame time will read 1000ms+ which is the throttling
   budget, not the engine's.
8. Click "Start bench". Wait. Save the downloaded JSON.

### Pixel / Android Chrome

Same flow. Differences worth noting:

- Android's renderer can downclock the GPU more aggressively than iOS.
  Run twice with a 2-3 minute pause between to spot thermal effects.
- Chrome on Android exposes `navigator.hardwareConcurrency` accurately;
  iOS Safari reports a capped value. The report includes the field
  verbatim - read with that lens.

### Cross-machine comparisons

Always tag with `--label` (or `?label=`). Reports without a label are
hard to triangulate later. Recommended labels:

- Desktop: `<vendor> <model> / <year>` - e.g. `MacBook Air M2 / 2024`.
- Phone: `<vendor> <model> <OS-version>` - e.g. `iPhone SE 2020 iOS 17.4`.
- VM / CI: `<provider> <instance-type>` - e.g. `GHA ubuntu-latest x64`.

## Scenario reference

### 1. sprite-scaling

Sweeps entity counts: 100 / 1000 / 5000 / 10000 / 50000. Each entity
has Transform + Sprite + Animation; the world runs Input + Animation +
SpriteRender. Half the sprites are tinted to exercise the
SPRITE_FLAG_TINTED branch in the render pipeline.

What it diagnoses:

- Where the per-entity cost cliff sits. Mean frame time should scale
  near-linearly with entity count; a knee suggests cache-line pressure
  or a hash-map blowup.
- Tint allocation churn. Compare against the dedicated
  `tint-alloc-churn` microbench: a regression in sprite-scaling p99
  with no churn regression points at non-tint code.

### 2. animation-scaling

Same world as sprite-scaling but with the SpriteRenderSystem stripped.
Counts: 1000 / 5000 / 10000 / 50000. Isolates AnimationSystem cost from
draw cost. A regression here without a sprite-scaling regression
points at the animation pool.

### 3. particle-stress

One emitter at the world origin with `rate = particleBudget` and
`particleLife = 1.0s`, so the live count saturates near the budget.
Sweep budget: 500 / 1000 / 2000 / 4000 / 8000. Measures the per-frame
cost of (emitter spawn -> simulation step -> render submission).

What it diagnoses:

- The fps cliff for particle work. The live-count metric in custom
  metrics should equal or be just under the budget at end-of-run; if
  it's far below, the emitter rate is the bottleneck.

### 4. sse-drain

`MockDirectorBridge` enqueues N synthetic `ve.budget.update` events per
frame; `DirectorSystem` drains them. Sweep N: 10 / 50 / 100 / 500 / 1000.
What it diagnoses:

- The events/sec the director pipeline absorbs before frame-budget burn.
- The custom metric `eventsPerSecAtMean` is the practical ceiling
  (e.g. eventsPerFrame=100 at mean 5ms = 20000 events/sec).

### 5. ecs-iteration

Pure read sweep over `TransformPool.x/y/z` arrays. Counts: 1000 / 10000
/ 100000. No System, no draw, just `for (i...) accum += x[i]+y[i]+z[i]`.
Establishes the cache-bound floor: if iteration cost grows superlinearly
with N, something architectural is wrong with the pool layout.

The `meanNsPerEntity` custom metric is the headline number. On modern
desktop hardware this should be in single-digit ns; on a phone, 10-30 ns.

### 6. asset-load

`loadSpriteSheet()` with stub `fetchImpl` + stub `decodeImage` so the
loader code path is exercised without a network or image decoder. Runs
one cold call (first time) followed by N warm calls, reports both.
Diagnoses the cost of manifest validation + URL resolution + the
loader's own bookkeeping.

The stubs mean this scenario is NOT a real-network benchmark. The
real-network number is the CDN's time-to-first-byte plus the engine's
loader cost; the engine cost is what this scenario isolates.

### 7. memory-sustained

Runs the medium sprite scenario (1000 entities) for 3600 frames (60s
at 60fps) in Node, 1800 frames in the browser. Heap is sampled every
60 frames. The headline is `peakHeapAboveBaselineKb`: how much heap
climbs between collections. Residual heap after a final GC is reported
as `heapDeltaKb` for context but is not the metric that matters - what
matters is GC pause frequency, which maps to peak height.

`tint-alloc-churn` (legacy Phase 9.1 microbench) runs alongside the 7
modern scenarios for cross-version continuity; it isolates the
SpriteRenderSystem tinted-path allocation cost.

## Output schema

Every run produces:

- `tools/bench-results/<timestamp>.json` - structured report. The schema
  is versioned (`schemaVersion: 1` as of Phase 14.3); the comparator
  refuses to diff reports of different schema versions.
- `tools/bench-results/<timestamp>.md` - human-readable Markdown summary.

Schema sketch:

```jsonc
{
  "schemaVersion": 1,
  "engineVersion": "0.11.0",
  "timestamp": "2026-05-08T19:30:45Z",
  "environment": {
    "runtime": "node" | "browser",
    "nodeVersion": "v22.10.0",      // Node only
    "platform": "darwin/arm64",     // Node only
    "userAgent": "Mozilla/...",     // Browser only
    "hardwareConcurrency": 10,
    "label": "MacBook Air M2 / 2024",
    "backend": "headless" | "canvas2d" | "webgl2"
  },
  "config": { "frames": 1800, "warmup": 120, "scenarios": ["sprite-scaling", ...] },
  "results": [
    {
      "scenarioId": "sprite-scaling",
      "variant": "entities=1000",
      "config": { "entityCount": 1000, "tintedFraction": 0.5, ... },
      "stats": { "frames": 1800, "meanMs": 0.42, "p95Ms": 0.61, ... },
      "drawCallsPerFrame": 1000,
      "heapDeltaKb": 12,
      "peakHeapAboveBaselineKb": 480,
      "customMetrics": { ... }
    },
    ...
  ]
}
```

## Comparing backends (Track A and beyond)

When Track A's WebGL2 backend lands, run the bench twice:

```sh
# Baseline: current Canvas2D backend
bash tools/run-bench.sh --browser   # then in browser, ?backend=canvas2d&label=baseline
# Save bench-results/<ts>.json as baseline-canvas2d.json

# Current: WebGL2 backend
bash tools/run-bench.sh --browser   # then ?backend=webgl2&label=track-a
# Save bench-results/<ts>.json as current-webgl2.json
```

Then diff:

```sh
node --import=tsx tools/perf-bench.ts --compare baseline-canvas2d.json current-webgl2.json > docs/track-a-diff.md
```

The diff Markdown:

- Tags every metric with `BETR` (improvement), `REGR` (regression), or
  `----` (within ~1% noise floor).
- Sorts each scenario block with regressions at the top, then improvements,
  then neutral, so worst-case rows lead.
- Calls out backend mismatches explicitly so you can read the diff with
  the right lens (a "regression" on a backend swap usually means cost
  moved between CPU and GPU, not that anything got worse).

The diff is suitable to drop into a release note. For 0.12.0 specifically:
include the bench json + the markdown diff and link to the Track A spec.

## Comparing engine versions

Same flow, different snapshots:

```sh
# Tag the previous engine commit
git checkout v0.11.0
bash tools/run-bench.sh --label "0.11.0"
# Save bench-results/<ts>.json as v0.11.0.json

git checkout main
bash tools/run-bench.sh --label "main"
# Save bench-results/<ts>.json as main.json

node --import=tsx tools/perf-bench.ts --compare v0.11.0.json main.json
```

Cross-version comparisons are most reliable when:

- Both runs are on the same machine.
- Background load is comparable (no rebuilds running, no Slack updates).
- The scenarios run in the same order. The default order is fixed in
  `SCENARIO_IDS`; don't reorder via `BENCH_SCENARIOS` for baseline runs.

## Known limits and pitfalls

- **Foregrounding matters.** A backgrounded browser tab will read 1000ms+
  per frame because that is the throttling budget. Do not interpret a
  backgrounded run as a regression.
- **Thermal throttling on phones.** Run twice with a 2-3 minute pause
  to detect throttling. If the second run is dramatically slower, the
  first run was on a cool device and represents an upper bound.
- **GC pauses spike p99.** The mean and p50 are stable; the p99 and max
  reflect the longest-collection-this-run. A single 30ms GC pause inside
  a 30-second run is normal noise.
- **`asset-load` is loader-only.** It does not measure network. For
  network numbers, instrument the actual `loadSpriteSheet` call against
  a real CDN and use Chrome DevTools Network panel.
- **Heap stats need `--expose-gc` in Node.** The wrapper script passes
  this; raw `npx tsx tools/perf-bench.ts` does not.
- **Browser heap is opaque.** `peakHeapAboveBaselineKb` is null in the
  browser. Use Chrome DevTools Memory panel for browser heap analysis.
- **The `headless` backend is fictional.** It records draw calls but
  does no rendering. Numbers from `backend: headless` are JS-only and
  cannot be compared 1:1 with `canvas2d` or `webgl2` runs - the diff
  Markdown calls out the mismatch, but the reader still has to apply
  judgment.

## Reproducibility checklist

Before claiming a perf win or regression:

1. Run the bench three times on the baseline; pick the median.
2. Run the bench three times on the current; pick the median.
3. Diff median vs median, not single-run vs single-run.
4. Tag both runs with `--label` and the backend.
5. Save both JSONs to `tools/bench-results/`.
6. If on a phone: charge state, OS version, low-power-mode state all
   recorded in the label.
7. Quote the JSON path of both runs in any release note - reviewers
   should be able to re-run the diff command verbatim.
