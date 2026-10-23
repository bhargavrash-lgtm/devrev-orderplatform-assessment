# Stop everything start.ps1 or start-prod.ps1 started.
#
#   powershell -ExecutionPolicy Bypass -File scripts\stop.ps1
. "$PSScriptRoot\_common.ps1"

$stopped = 0
# The windows started by the scripts, with everything running inside them.
foreach ($name in "backend", "frontend") {
    $pidFile = Join-Path $RunDir "$name.pid"
    if (Test-Path $pidFile) {
        $windowPid = [int](Get-Content $pidFile -Raw)
        if (Get-Process -Id $windowPid -ErrorAction SilentlyContinue) {
            & taskkill.exe /T /F /PID $windowPid 2>&1 | Out-Null
            Write-Ok "Stopped the $name window"
            $stopped++
        }
        Remove-Item $pidFile -Force
    }
}

# Anything still listening on our ports, if it is a Python or Node process (e.g. started by hand).
foreach ($port in 8000, 5173) {
    foreach ($conn in @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -match '^(python|node|uvicorn)') {
            & taskkill.exe /T /F /PID $proc.Id 2>&1 | Out-Null
            Write-Ok "Stopped $($proc.ProcessName) on port $port"
            $stopped++
        } elseif ($proc) {
            Write-Host "    Port $port is used by $($proc.ProcessName) (pid $($proc.Id)); not an OrderWave process, left running." -ForegroundColor Yellow
        }
    }
}

if ($stopped -eq 0) { Write-Ok "Nothing was running" } else { Write-Ok "OrderWave is stopped" }
