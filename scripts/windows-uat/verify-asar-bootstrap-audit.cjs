#!/usr/bin/env node
'use strict';

/**
 * Compare audited bootstrap runtime files in source vs packaged app.asar (LF-normalized).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const asarPath = path.resolve(arg('asar', ''));
const output = path.resolve(arg('output', path.join(root, 'docs/remediation/evidence/EXACT-HEAD-DESKTOP-ACCEPTANCE/ASAR-VERIFY.json')));
const runtimeCommit = arg('runtime-commit', '');

const AUDIT_FILES = [
  'cloud/bootstrap-step-model.js',
  'cloud/bootstrap-coordinator.js',
  'cloud/bootstrap-gates.js',
  'cloud/boot-flow-ui.js',
  'cloud/bootstrap-checklist-contract.js',
  'cloud/bootstrap-failure-policy-contract.js',
  'cloud/bootstrap-lifecycle-contract.js',
  'cloud/setup-state-service.js',
  'cloud/ready-pure-evaluator.js',
  'cloud/post-google-cloud-discovery.js',
  'cloud/cloud-data-discovery.js',
  'cloud/ipc-error-envelope.js',
  'cloud/activation-errors.js',
  'electron/backup-v2-ipc.js',
  'electron/cloud-providers/cloud-service.js',
  'electron/cloud-providers/google-drive.js',
  'electron/cloud-providers/google-drive-api.js',
  'electron/byte-progress-watchdog.js',
  'electron/database/service.js',
  'electron/main.js',
  'electron/preload.js',
  'index.html',
];

function normalizeLf(buf) {
  return Buffer.from(String(buf).replace(/\r\n/g, '\n'), 'utf8');
}

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function extractAsar(asar, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const r = spawnSync('npx', ['--yes', '@electron/asar', 'extract', asar, dest], {
    cwd: root, encoding: 'utf8', timeout: 120000,
  });
  if (r.status !== 0) throw new Error(`asar extract failed: ${r.stderr || r.stdout}`);
}

function git(cmd) {
  const r = spawnSync('git', cmd, { cwd: root, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

if (!asarPath || !fs.existsSync(asarPath)) throw new Error(`asar missing: ${asarPath}`);

const extractDir = path.join(path.dirname(output), `.asar-extract-${Date.now()}`);
extractAsar(asarPath, extractDir);

const rows = [];
let allMatch = true;
for (const rel of AUDIT_FILES) {
  const srcPath = path.join(root, rel);
  const pkgPath = path.join(extractDir, rel);
  const srcExists = fs.existsSync(srcPath);
  const pkgExists = fs.existsSync(pkgPath);
  let match = false;
  let srcHash = null;
  let pkgHash = null;
  if (srcExists && pkgExists) {
    srcHash = sha(normalizeLf(fs.readFileSync(srcPath)));
    pkgHash = sha(normalizeLf(fs.readFileSync(pkgPath)));
    match = srcHash === pkgHash;
  }
  if (!match) allMatch = false;
  rows.push({
    sourceFile: rel,
    packagedFile: rel,
    sourceExists: srcExists,
    packagedExists: pkgExists,
    match: match ? 'YES' : 'NO',
    sourceSha256: srcHash,
    packagedSha256: pkgHash,
  });
}

const forbidden = 'قد يستمر التنزيل في الخلفية';
const cdd = fs.readFileSync(path.join(extractDir, 'cloud/cloud-data-discovery.js'), 'utf8');
const backgroundPhraseAbsent = !cdd.includes(forbidden);

const report = {
  schema: 'bootstrap-asar-verify-v1',
  at: new Date().toISOString(),
  runtimeSourceCommit: runtimeCommit || git(['rev-parse', 'HEAD']),
  asarPath,
  asarSha256: sha(fs.readFileSync(asarPath)),
  asarSizeBytes: fs.statSync(asarPath).size,
  allMatch,
  backgroundRestorePhraseAbsent: backgroundPhraseAbsent,
  files: rows,
  summary: {
    total: rows.length,
    matched: rows.filter((r) => r.match === 'YES').length,
    failed: rows.filter((r) => r.match === 'NO').length,
  },
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { /* empty */ }

console.log(JSON.stringify(report.summary, null, 2));
if (!allMatch || !backgroundPhraseAbsent) process.exit(1);
