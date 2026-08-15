# Record build identity or finalize manual Existing Customer retest evidence.
# Usage:
#   -Phase build
#   -Phase result -ResultJson path\to\MANUAL-RETEST-RESULT.json
param(
  [ValidateSet('build','result')]
  [string]$Phase = 'build',
  [string]$ResultJson = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$evidenceDir = Join-Path $root 'docs/remediation/evidence/EXTERNAL-RUNTIME-DEFECTS'
New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null

$requiredHead = '013f37e58d4567ad07e1c00bc333094f7323f95b'

function Get-GitHead {
  Push-Location $root
  try { return (git rev-parse HEAD).Trim() } finally { Pop-Location }
}

if ($Phase -eq 'build') {
  $head = Get-GitHead
  if ($head -ne $requiredHead) {
    Write-Warning "HEAD is $head — required $requiredHead for this retest"
  }
  $exe = Get-ChildItem (Join-Path $root 'dist/HijamaManagement-Setup-*.exe') -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $exe) {
    Write-Error 'No Setup EXE found under dist/. Run: npm run build:win'
  }
  $hash = (Get-FileHash $exe.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $out = @{
    recordedAt = (Get-Date).ToUniversalTime().ToString('o')
    phase = 'build'
    requiredHead = $requiredHead
    actualHead = $head
    headMatch = ($head -eq $requiredHead)
    setupExeFilename = $exe.Name
    setupExePath = $exe.FullName
    setupExeSizeBytes = $exe.Length
    setupExeSha256 = $hash
  }
  $outPath = Join-Path $evidenceDir 'BUILD-IDENTITY.json'
  $out | ConvertTo-Json -Depth 6 | Set-Content -Path $outPath -Encoding UTF8
  Write-Host "BUILD IDENTITY recorded: $outPath"
  Write-Host "EXE: $($exe.Name)"
  Write-Host "SHA-256: $hash"
  exit 0
}

if ($Phase -eq 'result') {
  if (-not $ResultJson -or -not (Test-Path $ResultJson)) {
    Write-Error 'Provide -ResultJson pointing to filled MANUAL-RETEST-RESULT.json'
  }
  $payload = Get-Content $ResultJson -Raw | ConvertFrom-Json
  $dest = Join-Path $evidenceDir 'MANUAL-RETEST-RESULT.json'
  Copy-Item $ResultJson $dest -Force
  $stamp = Join-Path $evidenceDir ("MANUAL-RETEST-RESULT-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  Copy-Item $ResultJson $stamp -Force
  Write-Host "Result copied to: $dest"
  Write-Host "Archive: $stamp"
  Write-Host "Verdict: $($payload.verdict.manualExistingRetest)"
  exit 0
}
