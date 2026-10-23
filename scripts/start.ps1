# Start OrderWave for development: the API on :8000 and the Vite dev server on :5173,
# each in its own window. Open http://localhost:5173 when it says it's ready.
#
#   powershell -ExecutionPolicy Bypass -File scripts\start.ps1
. "$PSScriptRoot\_common.ps1"

Write-Step "Checking prerequisites"
Assert-Prerequisites
foreach ($port in 8000, 5173) {
    if (Test-Port $port) { Fail "Port $port is already in use. If OrderWave is already running, stop it first: scripts\stop.ps1" }
}
Install-BackendDeps
Install-FrontendDeps

Write-Step "Starting the API on port 8000 (new window)"
$backend = Start-Process powershell -PassThru -WorkingDirectory $RepoRoot `
    -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "_run_backend.ps1"))
Save-RunPid "backend" $backend.Id

Write-Step "Starting the frontend on port 5173 (new window)"
$frontend = Start-Process powershell -PassThru -WorkingDirectory $RepoRoot `
    -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "_run_frontend.ps1"))
Save-RunPid "frontend" $frontend.Id

Write-Step "Waiting for http://localhost:8000/api/health"
if (-not (Wait-Url "http://127.0.0.1:8000/api/health" 90)) { Fail "The API did not answer within 90 seconds. Check the 'OrderWave API :8000' window." }
Write-Ok "API is up"
Write-Step "Waiting for http://localhost:5173"
if (-not (Wait-Url "http://localhost:5173/" 90)) { Fail "The frontend did not answer within 90 seconds. Check the 'OrderWave frontend :5173' window." }
Write-Ok "Frontend is up"

Show-DemoAccounts "http://localhost:5173"
