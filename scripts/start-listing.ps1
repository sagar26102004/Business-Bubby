# START LISTING — launcher for the unattended listing run (/start-listing).
# See LISTING-PLAN.md at the repo root.
#
#   powershell -ExecutionPolicy Bypass -File scripts\start-listing.ps1 [-Hours 10] [-DryPublish]
#
# Runs scripts/listing-loop.ts in THIS window and keeps Windows awake until it
# ends (the keep-awake request dies with the window, so closing it is a stop).
# Stop gracefully any time by creating E:\listing\STOP — the loop finishes the
# cycle it is in and exits.
param(
  [double]$Hours = 10,
  [switch]$DryPublish,
  # Test knobs; normally left to scripts/listing-plan.json.
  [double]$Interval = 0,
  [int]$PerCycle = 0,
  [string]$Root = '',
  [string]$Plan = ''
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$Host.UI.RawUI.WindowTitle = "Localo listing run ($Hours h) - do not close"

# A STOP file left over from last time would end this run immediately.
$stopFile = if ($Root) { Join-Path $Root 'STOP' } else { 'E:\listing\STOP' }
if (Test-Path $stopFile) { Remove-Item $stopFile -Force }

# Keep the PC awake (system, not display) while this window runs.
Add-Type -Namespace Localo -Name Power -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);
'@
$ES_CONTINUOUS = [uint32]'0x80000000'
$ES_SYSTEM_REQUIRED = [uint32]'0x00000001'
[void][Localo.Power]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)

Write-Host "Localo listing run started $(Get-Date -Format 'HH:mm') for $Hours h. Keep the laptop plugged in with the lid OPEN."
Write-Host "Stop gracefully: create the file E:\listing\STOP   (or close this window to stop at once)."
Write-Host ""

$loopArgs = @('tsx', 'scripts/listing-loop.ts', '--hours', "$Hours")
if ($DryPublish) { $loopArgs += '--dry-publish' }
if ($Interval -gt 0) { $loopArgs += @('--interval', "$Interval") }
if ($PerCycle -gt 0) { $loopArgs += @('--per-cycle', "$PerCycle") }
if ($Root) { $loopArgs += @('--root', $Root) }
if ($Plan) { $loopArgs += @('--plan', $Plan) }
try {
  & npx.cmd @loopArgs
} finally {
  [void][Localo.Power]::SetThreadExecutionState($ES_CONTINUOUS)
  Write-Host ""
  Write-Host "Run finished $(Get-Date -Format 'HH:mm'). Logs: E:\listing\logs"
}
