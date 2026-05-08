# Loom Engine perf bench - one-command runner (PowerShell).
#
# Usage:
#   pwsh -File tools/run-bench.ps1                       # node bench, all scenarios
#   pwsh -File tools/run-bench.ps1 -Browser              # build + serve, then prompt to open the HTML
#   pwsh -File tools/run-bench.ps1 -Label "MBP"          # node bench, tagged report
#   pwsh -File tools/run-bench.ps1 -- --compare a.json b.json
#
# Anything after `--` is forwarded verbatim to perf-bench.ts.

[CmdletBinding()]
param(
  [switch]$Browser,
  [switch]$Node,
  [string]$Label,
  [int]$Port = 8088,
  [Parameter(ValueFromRemainingArguments=$true)]
  [string[]]$Rest
)

$ErrorActionPreference = 'Stop'

# Resolve repo root from this script's path so cwd doesn't matter.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir '..')).Path
Set-Location $RepoRoot

Write-Host "[run-bench] building engine -> dist/"
& npm run build --silent
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($Browser) {
  Write-Host "[run-bench] compiling tools/ -> tools/*.js for browser harness"
  & npx tsc -p tools/tsconfig.bench.json
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Write-Host "[run-bench] serving repo on http://127.0.0.1:$Port/"
  Write-Host "[run-bench] open: http://127.0.0.1:$Port/tools/perf-bench.html"
  Write-Host "[run-bench] real-device: connect from the same LAN with this machine's IP"
  Write-Host "[run-bench] (Ctrl-C to stop the server)"
  & npx --yes http-server -a 0.0.0.0 -p $Port -c-1 --no-dotfiles $RepoRoot
  exit $LASTEXITCODE
}

# Node mode. Forward Label + the rest of the args through to perf-bench.ts.
$forwarded = @()
if ($Label) { $forwarded += @('--label', $Label) }
if ($Rest) { $forwarded += $Rest }

Write-Host "[run-bench] running node bench (--expose-gc for heap stats)"
& node --expose-gc --import=tsx (Join-Path $RepoRoot 'tools/perf-bench.ts') @forwarded
exit $LASTEXITCODE
