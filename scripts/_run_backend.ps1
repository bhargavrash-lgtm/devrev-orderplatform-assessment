# Runs the API in this window (opened by start.ps1 / start-prod.ps1). Loads .env without printing it.
param([switch]$Prod)
. "$PSScriptRoot\_common.ps1"
$Host.UI.RawUI.WindowTitle = if ($Prod) { "OrderWave (single port :8000)" } else { "OrderWave API :8000" }
$null = Import-DotEnv
if ($Prod) { $env:SERVE_FRONTEND = "1" } else { $env:SERVE_FRONTEND = "0" }
Set-Location $BackendDir
& $VenvPython -m uvicorn main:app --host 127.0.0.1 --port 8000
