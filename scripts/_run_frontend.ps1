# Runs the Vite dev server in this window (opened by start.ps1). It needs no secrets.
. "$PSScriptRoot\_common.ps1"
$Host.UI.RawUI.WindowTitle = "OrderWave frontend :5173"
Set-Location $FrontendDir
& npm run dev
