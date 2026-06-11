# tools/

Development utilities. Nothing in this directory ships in the npm package; these
scripts exist to (re)generate committed artifacts, gate fixtures, or benchmark the
engine. Listed below: what each tool is for, where its output goes, and which are
experimental.

## Golden-vector generators (outputs committed under `test_vectors/`)

Each `gen-*-vectors.ts` runs the REAL TypeScript implementation and pins reference
hashes into a JSON file under `test_vectors/`. The TS, Rust, Python, WASM, and
C-ABI harnesses all assert against those files - that is what "byte-identical"
means in this repo. Re-run a generator only after an intentional change to the
canonical format, then re-run every language harness against the new vector.

Run with: `npx tsx tools/<file>.ts`

| Tool | Pins | Output |
|---|---|---|
| `gen-event-vectors.ts` | HMAC event-chain signatures | `test_vectors/event_chain_v1.json` |
| `gen-snapshot-vectors.ts` | snapshot canonical encoding + `state_hash` | `test_vectors/v3_0_snapshot_canonical.json` |
| `gen-ast-vectors.ts` | ruleset-AST resolutions + state hashes | `test_vectors/v3_ast_bleed.json` |
| `gen-epoch-vectors.ts` | epoch world-tick (single tick, rejection, catch-up) | `test_vectors/v3_3_epoch_tick.json` |
| `gen-session-vectors.ts` | WorldSession suspend/resume pipeline | `test_vectors/v3_4_world_session.json` |
| `gen-frame-vectors.ts` | command-frame tick | `test_vectors/v5_1_command_frame.json` |
| `gen-reconcile-vectors.ts` | rollback + replay reconciliation | `test_vectors/v5_2_reconciliation.json` |
| `gen-region-vectors.ts` | region leaf hashes + Merkle root | `test_vectors/v5_3_region_hash.json` |

## Fixture gates

- `check_fixtures_nfc.py` - walks the repo's JSON fixtures and fails if any file
  contains non-NFC text. The NFC-rejection hardening at the canonical boundary is
  only non-breaking if every published fixture is already NFC; this is the gate
  that proves it. Run: `python tools/check_fixtures_nfc.py`

## Perf bench (wired into npm scripts; results are advisory, not CI-gated)

- `perf-suite.ts` - standardized scenario suite (sprite scaling, animation
  scaling, particle stress, SSE drain, ...) shared by both entries below.
- `perf-bench.ts` - Node entry. `npm run bench` / `npm run bench:fast` /
  `npm run bench:compare`. Writes `tools/bench-results/<timestamp>.{json,md}`.
- `perf-bench-browser.ts` + `perf-bench.html` - browser entry
  (`npm run bench:browser` builds it). Measures real device fps and real
  Canvas2D / WebGL2 backend cost, which the Node bench cannot.
- `perf-report.ts` - report serialization, Markdown rendering, schema-versioned
  diffing between two runs.
- `run-bench.sh` / `run-bench.ps1` - one-command wrappers (POSIX / PowerShell).
- `tsconfig.bench.json` - build config for the browser bench entry.

Status: maintained but experimental. Bench numbers are environment-tagged and
advisory; no CI job asserts on them.

## One-shot asset generators (outputs committed under `assets/`)

- `gen-knight.py` - Pillow generator for the placeholder knight walk-cycle
  (`assets/knight/walk.png` + `assets/knight/walk.json`). Programmer art used by
  the demos; the outputs are committed, so re-run only to regenerate the
  placeholder. Experimental / placeholder quality by design.
