# PUBLISH ALL — keeps scripts/publish-merged.ts running until everything in
# E:\listing\merged\businesses.json is published (LISTING-PLAN.md, "Publish").
#
#   powershell -ExecutionPolicy Bypass -File scripts\publish-all.ps1 [-Batch 100]
#
# If the publisher ever dies (memory, network), it is started again after a
# minute; it continues where it stopped, because every published business is
# in the published-keys file. Keeps Windows awake. Stop: create
# E:\listing\ready\STOP (finishes the round it is in), or close this window.
param([int]$Batch = 100)

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)
$Host.UI.RawUI.WindowTitle = 'Localo PUBLISHING - do not close'
$stop = 'E:\listing\ready\STOP'
if (Test-Path $stop) { Remove-Item $stop -Force }

Add-Type -Namespace Localo -Name Power -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);
'@
[void][Localo.Power]::SetThreadExecutionState([uint32]'0x80000000' -bor [uint32]'0x00000001')

try {
  while ($true) {
    & npx.cmd tsx scripts/publish-merged.ts --batch $Batch
    if ($LASTEXITCODE -eq 0 -or (Test-Path $stop) -or (Test-Path 'E:\listing\STOP')) { break }
    Write-Host "Publisher stopped with an error at $(Get-Date -Format 'HH:mm') - starting it again in 60 s (see E:\listing\ready\publish-log.txt)."
    Start-Sleep -Seconds 60
  }
} finally {
  [void][Localo.Power]::SetThreadExecutionState([uint32]'0x80000000')
  Write-Host "Publishing finished $(Get-Date -Format 'HH:mm'). Log: E:\listing\ready\publish-log.txt"
}
