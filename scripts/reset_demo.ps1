# Reset the demo data: delete backend\data.db and the uploaded files, then seed again.
# Asks for confirmation (skip with -Force). Refuses while the backend is running.
#
#   powershell -ExecutionPolicy Bypass -File scripts\reset_demo.ps1
param([switch]$Force)
. "$PSScriptRoot\_common.ps1"

if ((Test-Port 8000) -or (Wait-Url "http://127.0.0.1:8000/api/health" 1)) {
    Fail "The backend is running on port 8000. Stop it first (scripts\stop.ps1), then reset."
}
if (-not (Test-Path $VenvPython)) { Fail "The backend isn't set up yet. Run scripts\start.ps1 once first." }
if (-not (Import-DotEnv)) { Fail "No .env file found. Copy .env.example to .env and fill it in." }
foreach ($name in "SEED_OPS_PASSWORD", "SEED_CUSTOMER_PASSWORD") {
    if (-not [Environment]::GetEnvironmentVariable($name)) { Fail ".env is missing a value for $name" }
}

$db = Join-Path $BackendDir "data.db"
$uploads = Join-Path $BackendDir "uploads"
if (-not $Force) {
    Write-Host "This deletes $db and every file in $uploads, then seeds fresh demo data." -ForegroundColor Yellow
    $answer = Read-Host "Type RESET to continue"
    if ($answer -ne "RESET") { Write-Host "Nothing changed."; exit 0 }
}

Write-Step "Deleting the database and uploaded files"
foreach ($file in "$db", "$db-wal", "$db-shm", "$db-journal") {
    if (Test-Path $file) { Remove-Item $file -Force }
}
if (Test-Path $uploads) { Get-ChildItem $uploads -Force | Remove-Item -Recurse -Force }

Write-Step "Seeding the demo data"
Push-Location $BackendDir
try {
    & $VenvPython seed.py
    if ($LASTEXITCODE -ne 0) { Fail "The seed failed." }
} finally { Pop-Location }

Write-Host ""
& $VenvPython (Join-Path $PSScriptRoot "demo_counts.py") $db
