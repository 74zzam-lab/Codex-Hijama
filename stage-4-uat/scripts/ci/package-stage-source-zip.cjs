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

function resolveCommitShort() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  const ws = process.env.GITHUB_WORKSPACE;
  if (ws) {
    const fromWs = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ws, encoding: 'utf8' });
    if (fromWs.status === 0 && fromWs.stdout) return fromWs.stdout.trim();
  }
  const fromRoot = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (fromRoot.status === 0 && fromRoot.stdout) return fromRoot.stdout.trim();
  return 'local';
}

function resolveCommitFull() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  const ws = process.env.GITHUB_WORKSPACE;
  if (ws) {
    const fromWs = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ws, encoding: 'utf8' });
    if (fromWs.status === 0 && fromWs.stdout) return fromWs.stdout.trim();
  }
  const fromRoot = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (fromRoot.status === 0 && fromRoot.stdout) return fromRoot.stdout.trim();
  return '';
}

const commit = resolveCommitShort();
const zipName = `Tadawi-Stage-${stage}-${label}-${commit}.zip`;
const zipPath = path.join(root, zipName);

const EXCLUDE_DIRS = new Set([
  'node_modules', 'dist', '.git', 'ci-artifacts', 'review-work',
  '01-ORIGINAL', '02-CURRENT', '03-REPORTS', 'stage-1-uat', 'stage-2-uat', 'stage-3-uat', 'stage-4-uat', 'app-source',
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
    else out.push({ rel: rel.replace(/\\/g, '/'), abs, size: st.size });
  }
  return out;
}

const files = collectFiles(root);
const manifest = {
  zipName,
  commit: resolveCommitFull(),
  commitShort: commit,
  createdAt: new Date().toISOString(),
  fileCount: files.length,
  excludedDirectories: [...EXCLUDE_DIRS],
  totalBytes: files.reduce((s, f) => s + f.size, 0),
};

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

const listFile = path.join(os.tmpdir(), `stage-zip-list-${Date.now()}.txt`);
fs.writeFileSync(listFile, `${files.map((f) => f.rel).join('\n')}\n`, 'utf8');

const tar = spawnSync('tar', ['-a', '-cf', zipPath, '-T', listFile], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (tar.status !== 0) {
  console.error('tar create failed', { status: tar.status, stderr: tar.stderr, stdout: tar.stdout, listFile });
  process.exit(1);
}

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
const zipStat = fs.statSync(zipPath);
manifest.zipSizeBytes = zipStat.size;
manifest.sha256 = sha256;

const buildId = process.env.STAGE4_BUILD_ID || process.env.STAGE3_BUILD_ID || process.env.STAGE2_BUILD_ID || 'local';
const evidenceSubdir = stage === '4'
  ? 'STAGE-4-COORDINATOR-STATE'
  : (stage === '3' ? 'STAGE-3-NO-AUTO-BOOT' : `STAGE-${stage}-READY-PURE`);
const evidenceDir = path.join(root, 'docs/remediation/evidence', evidenceSubdir, buildId);
fs.mkdirSync(evidenceDir, { recursive: true });

const validateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-zip-validate-'));
const untar = spawnSync('tar', ['-xf', zipPath, '-C', validateDir], { cwd: root, encoding: 'utf8' });
const required = ['package.json', 'cloud/ready-pure-evaluator.js', 'cloud/setup-state-service.js', 'tests/baseline/test-stage-2-ready-pure.js'];
const missing = required.filter((f) => !fs.existsSync(path.join(validateDir, f)));
manifest.validation = {
  extractedTo: validateDir,
  requiredPresent: missing.length === 0,
  missing,
  tarExit: untar.status,
  tarExtractStderr: untar.stderr || '',
};
fs.writeFileSync(path.join(evidenceDir, 'ZIP-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const ok = missing.length === 0 && zipStat.size > 1_000_000;
const result = {
  ok,
  zipPath,
  sha256,
  size: zipStat.size,
  fileCount: files.length,
  missing,
  sizeOk: zipStat.size > 1_000_000,
};
console.log(JSON.stringify(result, null, 2));
process.exit(ok ? 0 : 1);
