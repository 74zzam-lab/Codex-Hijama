#!/usr/bin/env node
'use strict';

/**
 * Aggregate Stage 1 CI evidence for GitHub artifact upload.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = process.env.STAGE1_SRC_ROOT || process.cwd();
const buildId = process.env.STAGE1_BUILD_ID || process.env.GITHUB_RUN_ID || 'local';
const evidenceSrc = path.join(root, 'docs', 'remediation', 'evidence', 'STAGE-1-WINDOWS-UAT', buildId);
const outDir = path.join(root, 'ci-artifacts', `stage1-evidence-${buildId}`);
fs.mkdirSync(outDir, { recursive: true });

function copyIfExists(name) {
  const src = path.join(evidenceSrc, name);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, name));
}

[
  'SUMMARY.md', 'SOURCE-MANIFEST.json', 'TEST-RESULTS.json', 'SETUP-EXE.json',
  'INSTALL-ENVIRONMENT.json', 'BEFORE-BACKUP.json', 'AFTER-MUTATION.json',
  'AFTER-RESTORE.json', 'RESTORE-PROGRESS.json', 'FAILURE-INJECTION.json',
  'RESTART-RETEST.json', 'RUNTIME-ERRORS.json', 'SQLITE-INTEGRITY.json',
  'BACKUP-CREATE.json', 'CLOUD-REAL-UAT.json', 'INSTALLED-EXE-SMOKE.json',
].forEach(copyIfExists);

const setup = path.join(outDir, 'SETUP-EXE.json');
let shaLines = [];
if (fs.existsSync(setup)) {
  try {
    const j = JSON.parse(fs.readFileSync(setup, 'utf8'));
    if (j.sha256 && j.filename) shaLines.push(`${j.sha256}  ${j.filename}`);
    if (j.absolutePath && fs.existsSync(j.absolutePath)) {
      const hash = crypto.createHash('sha256').update(fs.readFileSync(j.absolutePath)).digest('hex');
      shaLines.push(`${hash}  ${path.basename(j.absolutePath)}`);
    }
  } catch { /* ignore */ }
}
fs.writeFileSync(path.join(outDir, 'SHA256SUMS.txt'), `${shaLines.join('\n')}\n`);

const buildResult = {
  at: new Date().toISOString(),
  buildId,
  commit: (spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout || '').trim(),
  github: {
    runId: process.env.GITHUB_RUN_ID || null,
    runNumber: process.env.GITHUB_RUN_NUMBER || null,
    workflow: process.env.GITHUB_WORKFLOW || null,
    ref: process.env.GITHUB_REF || null,
    sha: process.env.GITHUB_SHA || null,
    serverUrl: process.env.GITHUB_SERVER_URL || null,
    repository: process.env.GITHUB_REPOSITORY || null,
  },
};
fs.writeFileSync(path.join(outDir, 'BUILD-RESULT.json'), `${JSON.stringify(buildResult, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'GITHUB-ACTIONS.json'), `${JSON.stringify(buildResult.github, null, 2)}\n`);

console.log(JSON.stringify({ ok: true, outDir, buildId }, null, 2));
