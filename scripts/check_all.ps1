# Run every check: backend tests, frontend tests, the production build and the MCP check.
# Prints one PASS or FAIL line per step; full output goes to .run\check-*.log.
#
#   powershell -ExecutionPolicy Bypass -File scripts\check_all.ps1
. "$PSScriptRoot\_common.ps1"
$ErrorActionPreference = "Continue"

if (-not (Test-Path $VenvPython)) { Fail "The backend isn't set up yet. Run scripts\start.ps1 once first." }
if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) { Fail "Frontend packages aren't installed. Run scripts\start.ps1 once first." }
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

$steps = @(
    @{ Name = "Backend tests";  Dir = $BackendDir;  Exe = $VenvPython; Args = @("-m", "pytest", "-q"); Log = "check-backend.log" },
    @{ Name = "Frontend tests"; Dir = $FrontendDir; Exe = "npm.cmd";   Args = @("test");              Log = "check-frontend.log" },
    @{ Name = "Frontend build"; Dir = $FrontendDir; Exe = "npm.cmd";   Args = @("run", "build");      Log = "check-build.log" },
    @{ Name = "MCP check";      Dir = $RepoRoot;    Exe = $VenvPython; Args = @((Join-Path $PSScriptRoot "mcp_check.py")); Log = "check-mcp.log" }
)

$failed = 0
foreach ($step in $steps) {
    $log = Join-Path $RunDir $step.Log
    $timer = [Diagnostics.Stopwatch]::StartNew()
    Push-Location $step.Dir
    try { & $step.Exe @($step.Args) *> $log; $code = $LASTEXITCODE } finally { Pop-Location }
    # Windows PowerShell writes redirected output as UTF-16; keep the logs readable everywhere.
    $text = Get-Content $log
    Set-Content -Path $log -Value $text -Encoding utf8
    $seconds = [int]$timer.Elapsed.TotalSeconds
    # The last summary-looking line, e.g. "143 passed in 150s" or "Tests 66 passed (66)".
    $summary = (Get-Content $log | Where-Object { $_ -match "passed|failed|built in|checks? (passed|failed)|error" } | Select-Object -Last 1)
    $summary = if ($summary) { ($summary -replace '\x1b\[[0-9;]*m', '').Trim() } else { "" }
    if ($code -eq 0) {
        Write-Host ("PASS  {0,-15} {1,4}s  {2}" -f $step.Name, $seconds, $summary) -ForegroundColor Green
    } else {
        $failed++
        Write-Host ("FAIL  {0,-15} {1,4}s  {2}  (see .run\{3})" -f $step.Name, $seconds, $summary, $step.Log) -ForegroundColor Red
    }
}

if ($failed) { Write-Host "`n$failed of $($steps.Count) checks failed" -ForegroundColor Red; exit 1 }
Write-Host "`nAll $($steps.Count) checks passed" -ForegroundColor Green
