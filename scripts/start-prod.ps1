# Single-port mode: build the frontend, then run everything on port 8000 (API, frontend,
# product images, /docs and /mcp). This is the mode to put behind a tunnel.
#
#   powershell -ExecutionPolicy Bypass -File scripts\start-prod.ps1
. "$PSScriptRoot\_common.ps1"

Write-Step "Checking prerequisites"
Assert-Prerequisites
if (Test-Port 8000) { Fail "Port 8000 is already in use. If OrderWave is already running, stop it first: scripts\stop.ps1" }
Install-BackendDeps
Install-FrontendDeps

Write-Step "Building the frontend"
Push-Location $FrontendDir
try { & npm run build; if ($LASTEXITCODE -ne 0) { Fail "The frontend build failed." } } finally { Pop-Location }

Write-Step "Starting OrderWave on port 8000 (new window)"
$server = Start-Process powershell -PassThru -WorkingDirectory $RepoRoot `
    -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "_run_backend.ps1"), "-Prod")
Save-RunPid "backend" $server.Id

Write-Step "Waiting for http://localhost:8000"
if (-not (Wait-Url "http://127.0.0.1:8000/api/health" 90)) { Fail "The server did not answer within 90 seconds. Check the 'OrderWave (single port :8000)' window." }
if (-not (Wait-Url "http://127.0.0.1:8000/" 15)) { Fail "The API is up but is not serving the frontend. Is frontend\dist\index.html there?" }
Write-Ok "API and frontend are up on one port"

Show-DemoAccounts "http://localhost:8000"
if ($env:MCP_API_KEY) { Write-Host "MCP endpoint: http://localhost:8000/mcp (key: MCP_API_KEY in .env)" }
Write-Host "To share it: cloudflared tunnel --url http://localhost:8000"
