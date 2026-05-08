#!/usr/bin/env bash
# Loom Engine perf bench - one-command runner (POSIX).
#
# Usage:
#   bash tools/run-bench.sh                # node bench, all scenarios
#   bash tools/run-bench.sh --browser      # build + serve, then prompt to open the HTML
#   bash tools/run-bench.sh --label "MBP"  # node bench, tagged report
#   bash tools/run-bench.sh --compare a.json b.json
#
# All non-flag args after `--` are passed straight to perf-bench.ts.

set -euo pipefail

# Resolve repo root from this script's location so the runner works
# regardless of the cwd it was launched from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

MODE="node"
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --browser)
      MODE="browser"
      shift
      ;;
    --node)
      MODE="node"
      shift
      ;;
    --)
      shift
      ARGS+=("$@")
      break
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

echo "[run-bench] building engine -> dist/"
npm run build --silent

if [ "$MODE" = "browser" ]; then
  echo "[run-bench] compiling tools/ -> tools/*.js for browser harness"
  npx tsc -p tools/tsconfig.bench.json
  PORT="${BENCH_PORT:-8088}"
  echo "[run-bench] serving repo on http://127.0.0.1:${PORT}/"
  echo "[run-bench] open: http://127.0.0.1:${PORT}/tools/perf-bench.html"
  echo "[run-bench] real-device: connect from the same LAN with this machine's IP"
  echo "[run-bench] (Ctrl-C to stop the server)"
  # http-server is a tiny zero-config option; npx pulls it on demand.
  exec npx --yes http-server -a 0.0.0.0 -p "$PORT" -c-1 --no-dotfiles "$REPO_ROOT"
fi

# Node mode: launch with --expose-gc so the bench can capture heap deltas.
echo "[run-bench] running node bench (--expose-gc for heap stats)"
exec node --expose-gc --import=tsx "$REPO_ROOT/tools/perf-bench.ts" "${ARGS[@]+"${ARGS[@]}"}"
