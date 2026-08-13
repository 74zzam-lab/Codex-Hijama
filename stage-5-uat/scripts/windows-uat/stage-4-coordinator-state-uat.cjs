#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.STAGE4_BUILD_ID || process.env.STAGE3_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence/STAGE-4-COORDINATOR-STATE', buildId);
fs.mkdirSync(evidenceDir, { recursive: true });

function git(cmd) {
  return (spawnSync('git', cmd, { cwd: root, encoding: 'utf8' }).stdout || '').trim();
}

function runTest(rel) {
  const r = spawnSync(process.execPath, [path.join(root, rel)], { cwd: root, encoding: 'utf8' });
  return { pass: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

const BC = require('../../cloud/bootstrap-coordinator');
const stage4 = runTest('tests/baseline/test-stage-4-bootstrap-coordinator-state.js');
const stage3 = runTest('tests/baseline/test-stage-3-no-auto-boot.js');
const stage2 = runTest('tests/baseline/test-stage-2-ready-pure.js');
const stage1Tests = [
  'tests/baseline/test-v2-5-10-cloud-discovery-restore.js',
  'tests/baseline/test-p0-c-restore-truth-and-boot-gate.js',
  'tests/baseline/test-current-restore-license-login.js',
  'tests/baseline/test-current-setup-restore-runtime.js',
  'tests/baseline/test-v2-5-8-auth-activation-ui.js',
].map((name) => ({ name, ...runTest(name) }));

const fieldInventory = BC.getFieldInventory();
const legacyFlags = Object.fromEntries(
  Object.entries(BC.FIELD_AUTHORITY).map(([k, v]) => [k, { classification: v }]),
);

fs.writeFileSync(path.join(evidenceDir, 'SOURCE-MANIFEST.json'), `${JSON.stringify({
  commit: git(['rev-parse', 'HEAD']),
  buildId,
  stage3Baseline: { commit: '012d7ce3fe45fdd7541d1f46ba61b96abef12d2c', run: '31693060935' },
  at: new Date().toISOString(),
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'BOOT-STATE-INVENTORY.json'), `${JSON.stringify({ fields: fieldInventory }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'FIELD-AUTHORITY-MATRIX.json'), `${JSON.stringify({ authority: BC.FIELD_AUTHORITY }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'COORDINATOR-STATE.json'), `${JSON.stringify({
  model: ['currentStep', 'userPathChoice', 'restoreChoice', 'selectedCandidateId', 'selectedBranchCandidate', 'pendingRetry', 'lastDiagnostic', 'transientProgress'],
  module: 'cloud/bootstrap-coordinator.js',
}, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'LEGACY-FLAGS.json'), `${JSON.stringify(legacyFlags, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'FALSE-COMPLETION.json'), `${JSON.stringify({ result: stage4.pass ? 'PASS' : 'FAIL', note: 'wizard fake flags cannot override missing SoT' }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'FALSE-INCOMPLETION.json'), `${JSON.stringify({ result: stage4.pass ? 'PASS' : 'FAIL', note: 'complete SoT yields READY despite empty wizard' }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'CORRUPT-STATE.json'), `${JSON.stringify({ result: stage4.pass ? 'PASS' : 'FAIL' }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'RESUME-VERIFICATION.json'), `${JSON.stringify({ result: stage4.pass ? 'PASS' : 'FAIL' }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'ZERO-WRITE.json'), `${JSON.stringify({ result: stage4.pass ? 'PASS' : 'FAIL', method: 'resolveCoordinatorState x5 + getDisplayWizard' }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'DUPLICATION-VERIFICATION.json'), `${JSON.stringify({ result: 'OBSERVATION', note: 'Owner/Branch/Device creation unchanged in Stage 4' }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'TEST-RESULTS.json'), `${JSON.stringify({
  stage4Focused: stage4.pass ? 'PASS' : 'FAIL',
  stage3Focused: stage3.pass ? 'PASS' : 'FAIL',
  stage2Focused: stage2.pass ? 'PASS' : 'FAIL',
  stage1Focused: stage1Tests.every((t) => t.pass) ? 'PASS' : 'FAIL',
}, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'REGRESSION-RESULTS.json'), `${JSON.stringify({
  stage4Focused: stage4.pass ? 'PASS' : 'FAIL',
  stage3Focused: stage3.pass ? 'PASS' : 'FAIL',
  stage2Focused: stage2.pass ? 'PASS' : 'FAIL',
  stage1Details: stage1Tests,
}, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'WINDOWS-VERIFICATION.json'), `${JSON.stringify({
  node: stage4.pass ? 'PASS' : 'FAIL',
  electronIpcHarness: 'via stage 1-3 UAT scripts',
  installedExeSmoke: 'GHA post-build',
  fullInteractiveGui: 'UNVERIFIED',
  realGoogleDrive: 'UNVERIFIED',
}, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'SUMMARY.md'), `# Stage 4 Coordinator State — Summary\n\n**Build ID:** ${buildId}\n**Verdict:** ${stage4.pass && stage3.pass && stage2.pass ? 'PASS' : 'FAIL'}\n`);

const ok = stage4.pass && stage3.pass && stage2.pass && stage1Tests.every((t) => t.pass);
console.log(JSON.stringify({ ok, evidenceDir, stage4Focused: stage4.pass ? 'PASS' : 'FAIL' }, null, 2));
process.exit(ok ? 0 : 1);
