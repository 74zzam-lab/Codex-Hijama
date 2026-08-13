#!/usr/bin/env node
'use strict';

/**
 * Create Stage N source ZIP (project files only, no build artifacts).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const stage = process.env.STAGE_NUMBER || '2';
const label = process.env.STAGE_ZIP_LABEL || 'READY-PASS';
const commit = (spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout || '').trim()
  || 'local';
const zipName = `Tadawi-Stage-${stage}-${label}-${commit}.zip`;
const zipPath = path.join(root, zipName);

const EXCLUDE_DIRS = new Set([
  'node_modules', 'dist', '.git', 'ci-artifacts', 'review-work',
  '01-ORIGINAL', '02-CURRENT', '03-REPORTS', 'stage-1-uat', 'stage-2-uat', 'app-source',
]);
const EXCLUDE_FILES = /\.(tdw|log|exe|msi|dmg|AppImage|blockmap)$/i;
const EXCLUDE_ZIP = /^Tadawi-Stage-.*\.zip$/i;

function shouldInclude(rel) {
  const parts = rel.split(/[/\\]/);
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return false;
  const base = path.basename(rel);
  if (EXCLUDE_ZIP.test(base)) return false;
  if (EXCLUDE_FILES.test(base)) return false;
  if (base === 'Hijama-Management-System-SOURCE-BUILD-2.0.1.zip') return false;
  if (base.includes('COMPLETE-ORIGINAL')) return false;
  return true;
}

function collectFiles(dir, prefix = '') {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const rel = prefix ? `${prefix}/${name}` : name;
    const abs = path.join(dir, name);
    if (!shouldInclude(rel)) continue;
    const st = fs.statSync(abs);
    if (st.isDirectory()) out.push(...collectFiles(abs, rel));
    else out.push({ rel, abs, size: st.size });
  }
  return out;
}

const files = collectFiles(root);
const manifest = {
  zipName,
  commit: (spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout || '').trim(),
  commitShort: commit,
  createdAt: new Date().toISOString(),
  fileCount: files.length,
  excludedDirectories: [...EXCLUDE_DIRS],
  totalBytes: files.reduce((s, f) => s + f.size, 0),
};

// Use system zip
const listFile = path.join(os.tmpdir(), `zip-list-${Date.now()}.txt`);
fs.writeFileSync(listFile, files.map((f) => f.rel).join('\n'));
const zipCmd = process.platform === 'win32'
  ? `powershell -Command "Compress-Archive -Path @(Get-Content '${listFile}') -DestinationPath '${zipPath}' -Force"`
  : `cd "${root}" && zip -q -r "${zipPath}" -@ < "${listFile}"`;

if (process.platform !== 'win32') {
  const r = spawnSync('bash', ['-lc', `cd "${root}" && zip -q -r "${zipPath}" -@`], {
    input: files.map((f) => f.rel).join('\n'),
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }
} else {
  const r = spawnSync('powershell', ['-Command', `
    $files = Get-Content '${listFile}'
    $temp = Join-Path $env:TEMP 'stage-zip-staging'
    if (Test-Path $temp) { Remove-Item -Recurse -Force $temp }
    New-Item -ItemType Directory -Force -Path $temp | Out-Null
    foreach ($f in $files) { Copy-Item (Join-Path '${root}' $f) (Join-Path $temp $f) -Force }
    Compress-Archive -Path (Join-Path $temp '*') -DestinationPath '${zipPath}' -Force
  `], { encoding: 'utf8' });
  if (r.status !== 0) process.exit(1);
}

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
const zipStat = fs.statSync(zipPath);
manifest.zipSizeBytes = zipStat.size;
manifest.sha256 = sha256;

const buildId = process.env.STAGE2_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence', `STAGE-${stage}-READY-PURE`, buildId);
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(path.join(evidenceDir, 'ZIP-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// Validate extract
const validateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-zip-validate-'));
if (process.platform !== 'win32') {
  spawnSync('unzip', ['-q', zipPath, '-d', validateDir], { stdio: 'inherit' });
} else {
  spawnSync('powershell', ['-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${validateDir}' -Force`]);
}
const required = ['package.json', 'cloud/ready-pure-evaluator.js', 'cloud/setup-state-service.js', 'tests/baseline/test-stage-2-ready-pure.js'];
const missing = required.filter((f) => !fs.existsSync(path.join(validateDir, f)));
manifest.validation = {
  extractedTo: validateDir,
  requiredPresent: missing.length === 0,
  missing,
};
fs.writeFileSync(path.join(evidenceDir, 'ZIP-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({ ok: missing.length === 0, zipPath, sha256, size: zipStat.size, fileCount: files.length }, null, 2));
process.exit(missing.length === 0 ? 0 : 1);
