# COLLECT ALL — launcher for the collector bots (/collect-businesses).
# See LISTING-PLAN.md → "Many bots → merge → publish".
#
#   powershell -ExecutionPolicy Bypass -File scripts\collect-all.ps1 [-Bots "google-maps,osm,magicpin,practo"] [-Group health] [-NoMerge]
#
# Runs scripts/collect-all.ts in THIS window and keeps Windows awake until it
# ends (closing the window stops every bot at once). Stop gracefully any time
# by creating E:\listing\STOP — each bot finishes the page it is on and exits.
# Nothing is published.
param(
  [string]$Bots = '',
  [string]$Group = '',
  [double]$Hours = 0,
  [switch]$NoMerge
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$Host.UI.RawUI.WindowTitle = "Localo collect - $(if ($Bots) { $Bots } else { 'all bots' }) - do not close"

# A STOP file left over from last time would end this run immediately.
if (Test-Path 'E:\listing\STOP') { Remove-Item 'E:\listing\STOP' -Force }

# Keep the PC awake (system, not display) while this window runs.
Add-Type -Namespace Localo -Name Power -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);
'@
$ES_CONTINUOUS = [uint32]'0x80000000'
$ES_SYSTEM_REQUIRED = [uint32]'0x00000001'
[void][Localo.Power]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)

Write-Host "Localo collect started $(Get-Date -Format 'HH:mm'). Keep the laptop plugged in with the lid OPEN."
Write-Host "Stop gracefully: create the file E:\listing\STOP   (or close this window to stop at once)."
Write-Host ""

$runArgs = @('tsx', 'scripts/collect-all.ts')
if ($Bots) { $runArgs += @('--bots', $Bots) }
if ($Group) { $runArgs += @('--group', $Group) }
if ($NoMerge) { $runArgs += '--no-merge' }
if ($Hours -gt 0) { $runArgs += @('--hours', "$Hours") }
try {
  & npx.cmd @runArgs
} finally {
  [void][Localo.Power]::SetThreadExecutionState($ES_CONTINUOUS)
  Write-Host ""
  Write-Host "Finished $(Get-Date -Format 'HH:mm'). Logs: E:\listing\<bot>\logs   Merged: E:\listing\merged\merge-report.txt"
}
