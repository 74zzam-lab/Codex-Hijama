#Requires -Version 5.1
<#
.SYNOPSIS
  Stage 1 — silent install Setup EXE + isolated userData smoke for installed-path proof.
#>
param(
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [Parameter(Mandatory = $true)][string]$BuildId,
  [Parameter(Mandatory = $true)][string]$EvidenceDir
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null

$installer = Get-ChildItem -Path (Join-Path $RepoRoot 'dist') -Filter 'HijamaManagement-Setup-*.exe' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) { throw 'Setup EXE missing under dist/' }
if ($installer.Length -lt 50MB) { throw "Setup EXE too small: $($installer.Length)" }

$installDir = Join-Path $env:LOCALAPPDATA 'Programs\Hijama Management System'
$installedExe = Join-Path $installDir 'Hijama Management System.exe'
$isolatedUserData = Join-Path $env:LOCALAPPDATA ("uat-stage1-{0}" -f $BuildId)

$meta = [ordered]@{
  at = (Get-Date).ToString('o')
  buildId = $BuildId
  installer = $installer.FullName
  installerSha256 = (Get-FileHash -Algorithm SHA256 $installer.FullName).Hash.ToLowerInvariant()
  installerSizeBytes = $installer.Length
  isolatedUserData = $isolatedUserData
  productionUserDataAvoided = $true
}

if (Test-Path $isolatedUserData) { Remove-Item -LiteralPath $isolatedUserData -Recurse -Force }
New-Item -ItemType Directory -Force -Path $isolatedUserData | Out-Null

$uninst = Join-Path $installDir 'Uninstall Hijama Management System.exe'
if (Test-Path $uninst) {
  $u = Start-Process -FilePath $uninst -ArgumentList '/S' -PassThru -Wait
  $meta.priorUninstallExit = $u.ExitCode
  Start-Sleep -Seconds 2
}

$p = Start-Process -FilePath $installer.FullName -ArgumentList '/S' -PassThru -Wait
if ($p.ExitCode -ne 0) { throw "Silent install failed exit=$($p.ExitCode)" }
Start-Sleep -Seconds 3
if (-not (Test-Path $installedExe)) { throw "Installed EXE missing: $installedExe" }

$meta.installedExe = $installedExe
$meta.installedExeSha256 = (Get-FileHash -Algorithm SHA256 $installedExe).Hash.ToLowerInvariant()
$meta.installedExeSizeBytes = (Get-Item $installedExe).Length

$stderrLog = Join-Path $EvidenceDir 'installed-exe-smoke-stderr.log'
$startupSmokeScript = Join-Path $RepoRoot 'scripts/windows-uat/installed-startup-license-smoke.cjs'
$startupSmokeJson = Join-Path $EvidenceDir 'INSTALLED-STARTUP-LICENSE-SMOKE.json'
$startupSmoke = @{ ok = $false; finalState = 'FAIL'; licensePending = $true; result = 'FAIL' }
if (Test-Path $startupSmokeScript) {
  try {
    & node $startupSmokeScript --exe $installedExe --user-data $isolatedUserData --output $startupSmokeJson --timeout-ms 15000 2> $stderrLog | Out-Null
    if (Test-Path $startupSmokeJson) {
      $startupSmoke = Get-Content $startupSmokeJson -Raw | ConvertFrom-Json
    }
  } catch {
    $startupSmoke.error = $_.Exception.Message
  }
} else {
  $startupSmoke.error = 'installed-startup-license-smoke.cjs missing'
}

$meta.smokeRunning = $true
$meta.smokeExitCode = $(if ($startupSmoke.ok -eq $true) { 0 } else { 1 })
$meta.installedStartupLicenseSmoke = $startupSmoke
$meta.licenseVerificationSettled = ($startupSmoke.licensePending -ne $true)
$meta.installedFinalState = $startupSmoke.finalState
$meta.ok = (Test-Path $installedExe) -and ($startupSmoke.ok -eq $true) -and ($startupSmoke.licensePending -ne $true)

$meta | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $EvidenceDir 'INSTALLED-EXE-SMOKE.json') -Encoding UTF8
if (-not $meta.ok) { exit 1 }
exit 0
