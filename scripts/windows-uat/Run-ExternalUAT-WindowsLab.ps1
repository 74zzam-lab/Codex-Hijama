#Requires -Version 5.1
<#
.SYNOPSIS
  Self-hosted Windows lab launcher for Post-Stage-20 External UAT.
  Requires: exact Stage 20 Setup EXE, Google test tenant creds, Device A + B profiles.

  Set environment before interactive journeys:
    $env:GOOGLE_OAUTH_CLIENT_ID = '<from secure store>'
    $env:GOOGLE_OAUTH_CLIENT_SECRET = '<from secure store>'
    $env:EXTERNAL_UAT_INTERACTIVE = 'true'
    $env:EXTERNAL_UAT_DEVICE_B = 'true'          # when Device B VM ready
    $env:EXTERNAL_UAT_STAGE19_PROFILE = 'true'   # when Stage 19 upgrade profile ready
    $env:EXTERNAL_UAT_BUILD_ID = 'winlab-<date>'

  Do NOT commit secrets. Do NOT use production customer data.
#>
param(
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [string]$BuildId = $(Get-Date -Format 'winlab-yyyyMMdd-HHmm'),
  [string]$SetupExePath = ''
)

$ErrorActionPreference = 'Stop'
Set-Location $RepoRoot

$expectedSha = '058626db3bdc1f632bef49fc0fa6862cc76fb34ded26293251501d022bd376c0'

if ($SetupExePath) {
  if (-not (Test-Path $SetupExePath)) { throw "Setup EXE not found: $SetupExePath" }
  $sha = (Get-FileHash -Algorithm SHA256 $SetupExePath).Hash.ToLowerInvariant()
  if ($sha -ne $expectedSha) { throw "Setup EXE SHA mismatch. Expected $expectedSha got $sha" }
  New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot 'dist') | Out-Null
  Copy-Item -Force $SetupExePath (Join-Path $RepoRoot 'dist' (Split-Path $SetupExePath -Leaf))
} else {
  $setup = Get-ChildItem (Join-Path $RepoRoot 'dist') -Filter 'HijamaManagement-Setup-*.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $setup) { throw 'Place exact Stage 20 Setup EXE under dist/ or pass -SetupExePath' }
  $sha = (Get-FileHash -Algorithm SHA256 $setup.FullName).Hash.ToLowerInvariant()
  if ($sha -ne $expectedSha) { throw "Setup EXE SHA mismatch. Expected $expectedSha got $sha" }
}

$env:EXTERNAL_UAT_BUILD_ID = $BuildId
$env:STAGE1_BUILD_ID = $BuildId

Write-Host "Exact EXE SHA verified: $expectedSha"
Write-Host "Build ID: $BuildId"
Write-Host "Interactive journeys require EXTERNAL_UAT_INTERACTIVE=true and Google creds in environment."

npm ci
node scripts/generate-oauth-config.mjs
node scripts/generate-license-registries.mjs
node scripts/generate-brand-assets.mjs

pwsh -File (Join-Path $RepoRoot 'scripts/windows-uat/Install-Stage1-UAT.ps1') `
  -RepoRoot $RepoRoot `
  -BuildId $BuildId `
  -EvidenceDir (Join-Path $RepoRoot "docs/remediation/evidence/STAGE-1-WINDOWS-UAT/$BuildId")

node (Join-Path $RepoRoot 'scripts/windows-uat/external-uat-windows-runner.cjs')
Write-Host "Evidence: docs/remediation/evidence/EXTERNAL-UAT-WINDOWS/$BuildId"
Write-Host "Complete interactive GUI/Google/Device-A/B/upgrade journeys manually; update evidence JSON files."
