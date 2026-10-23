# Shared helpers for the PowerShell scripts. Dot-source it: . "$PSScriptRoot\_common.ps1"
# Nothing here ever prints a value from .env.

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $RepoRoot "backend"
$FrontendDir = Join-Path $RepoRoot "frontend"
$EnvFile = Join-Path $RepoRoot ".env"
$RunDir = Join-Path $RepoRoot ".run"
$VenvPython = Join-Path $BackendDir ".venv\Scripts\python.exe"
$DemoEmails = @(
    "sundaram@orderwave.demo   (customer)",
    "greenfield@orderwave.demo (customer)",
    "ops@orderwave.demo        (ops)",
    "accounts@orderwave.demo   (ops)"
)

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    $Text" -ForegroundColor Green }
function Fail([string]$Text) { Write-Host "ERROR: $Text" -ForegroundColor Red; exit 1 }

# Run a program with arguments, capture stdout, give up after a timeout (some shims hang).
function Invoke-Probe([string]$Exe, [string[]]$Arguments, [int]$TimeoutMs = 15000) {
    try {
        $info = New-Object System.Diagnostics.ProcessStartInfo
        $info.FileName = $Exe
        $info.Arguments = ($Arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
        $info.UseShellExecute = $false
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $info.CreateNoWindow = $true
        $process = [System.Diagnostics.Process]::Start($info)
        $out = $process.StandardOutput.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutMs)) { $process.Kill(); return $null }
        if ($process.ExitCode -ne 0) { return $null }
        return $out.Result.Trim()
    } catch { return $null }
}

# A real Python 3.11+. Tries the py launcher, then python and python3, skips store stubs and
# returns the interpreter's own path (sys.executable), which behaves the same everywhere.
function Find-Python {
    $probe = "import sys; print('%d.%d|%s' % (sys.version_info[0], sys.version_info[1], sys.executable))"
    foreach ($name in @("py", "python", "python3")) {
        foreach ($cmd in @(Get-Command $name -All -CommandType Application -ErrorAction SilentlyContinue)) {
            $prefix = if ($name -eq "py") { @("-3") } else { @() }
            $answer = Invoke-Probe $cmd.Source (@($prefix) + @("-c", $probe))
            if (-not $answer -or $answer -notmatch '^(\d+\.\d+)\|(.+)$') { continue }
            $version, $exe = $Matches[1], $Matches[2]
            if ([version]$version -ge [version]"3.11" -and (Test-Path $exe)) {
                return @{ Path = $exe; Args = @(); Version = $version }
            }
        }
    }
    return $null
}

# Load KEY=value lines from .env into this process's environment. Values are never printed.
function Import-DotEnv {
    if (-not (Test-Path $EnvFile)) { return $false }
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object {
        $name, $value = $_ -split '=', 2
        Set-Item -Path "Env:$($name.Trim())" -Value $value.Trim()
    }
    return $true
}

function Test-Port([int]$Port) {
    return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Wait-Url([string]$Url, [int]$Seconds = 90) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -eq 200) { return $true }
        } catch { }
        Start-Sleep -Milliseconds 700
    }
    return $false
}

function Get-FileHashText([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -Path $Path).Hash
}

# Create the venv and install backend requirements when missing or changed.
function Install-BackendDeps {
    if (-not (Test-Path $VenvPython)) {
        $python = Find-Python
        if (-not $python) { Fail "Python 3.11 or newer is not installed. Get it from https://www.python.org/downloads/" }
        Write-Step "Creating backend virtual environment (Python $($python.Version))"
        & $python.Path @($python.Args) -m venv (Join-Path $BackendDir ".venv")
        if ($LASTEXITCODE -ne 0) { Fail "Could not create the virtual environment." }
    }
    $requirements = Join-Path $BackendDir "requirements.txt"
    $stamp = Join-Path $BackendDir ".venv\.requirements.sha256"
    $hash = Get-FileHashText $requirements
    if (-not (Test-Path $stamp) -or (Get-Content $stamp -Raw).Trim() -ne $hash) {
        Write-Step "Installing backend dependencies"
        & $VenvPython -m pip install --quiet --disable-pip-version-check -r $requirements
        if ($LASTEXITCODE -ne 0) { Fail "pip install failed." }
        Set-Content -Path $stamp -Value $hash -Encoding ascii
    } else {
        Write-Ok "Backend dependencies are up to date"
    }
}

# Install frontend packages when missing or when package-lock.json changed.
function Install-FrontendDeps {
    $lock = Join-Path $FrontendDir "package-lock.json"
    $stamp = Join-Path $FrontendDir "node_modules\.orderwave-lock.sha256"
    $hash = Get-FileHashText $lock
    if (-not (Test-Path $stamp) -or (Get-Content $stamp -Raw).Trim() -ne $hash) {
        Write-Step "Installing frontend dependencies (npm ci)"
        Push-Location $FrontendDir
        try { & npm ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { Fail "npm ci failed." } } finally { Pop-Location }
        Set-Content -Path $stamp -Value $hash -Encoding ascii
    } else {
        Write-Ok "Frontend dependencies are up to date"
    }
}

function Assert-Prerequisites {
    $python = Find-Python
    if (-not $python) { Fail "Python 3.11 or newer is not installed. Get it from https://www.python.org/downloads/" }
    Write-Ok "Python $($python.Version)"
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { Fail "Node.js 18 or newer is not installed. Get it from https://nodejs.org/" }
    $nodeVersion = (& node --version).TrimStart("v")
    if ([version]$nodeVersion -lt [version]"18.0") { Fail "Node.js $nodeVersion is too old; version 18 or newer is needed." }
    Write-Ok "Node $nodeVersion"
    if (-not (Test-Path $EnvFile)) {
        Write-Host ""
        Write-Host "No .env file found at $EnvFile" -ForegroundColor Yellow
        Write-Host "Copy .env.example to .env and fill in every value:" -ForegroundColor Yellow
        Write-Host "    Copy-Item .env.example .env" -ForegroundColor Yellow
        Write-Host "    python -c `"import secrets; print(secrets.token_hex(32))`"   # for SESSION_SECRET and MCP_API_KEY" -ForegroundColor Yellow
        exit 1
    }
    $null = Import-DotEnv
    $missing = @("SESSION_SECRET", "SEED_OPS_PASSWORD", "SEED_CUSTOMER_PASSWORD") | Where-Object { -not [Environment]::GetEnvironmentVariable($_) }
    if ($missing) { Fail ".env is missing a value for: $($missing -join ', ')" }
    Write-Ok ".env found (values not shown)"
}

function Save-RunPid([string]$Name, [int]$ProcessId) {
    New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
    Set-Content -Path (Join-Path $RunDir "$Name.pid") -Value $ProcessId -Encoding ascii
}

function Show-DemoAccounts([string]$Url) {
    Write-Host ""
    Write-Host "OrderWave is running at $Url" -ForegroundColor Green
    Write-Host ""
    Write-Host "Demo accounts (passwords are SEED_CUSTOMER_PASSWORD / SEED_OPS_PASSWORD in .env):"
    $DemoEmails | ForEach-Object { Write-Host "    $_" }
    Write-Host ""
    Write-Host "Stop everything with: powershell -ExecutionPolicy Bypass -File scripts\stop.ps1"
}
