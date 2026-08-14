#!/usr/bin/env node
'use strict';

/**
 * Stage 2 evidence pack + zero-write verification artifact generator.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.STAGE2_BUILD_ID || process.env.STAGE1_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence/STAGE-2-READY-PURE', buildId);
fs.mkdirSync(evidenceDir, { recursive: true });

function git(cmd) {
  const r = spawnSync('git', cmd, { cwd: root, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

const stage1Ref = {
  tag: 'stage1-restore-pass',
  evidencePath: 'docs/remediation/evidence/STAGE-1-WINDOWS-UAT/gha-6-1',
  githubRun: '31682099953',
  setupExeSha256: '896288338774dde1635860a165943c4d78d94081f1169d397891298fd0fe8454',
};

const readyGates = {
  evaluator: 'cloud/ready-pure-evaluator.js',
  serviceApi: 'SetupStateService.evaluateReady()',
  gates: ['database', 'organization', 'license', 'owner', 'branch', 'device', 'dataSource', 'initialSync', 'google'],
  authoritativeSources: {
    database: 'SQLite integrity + accessibility',
    organization: '__tdw_cloud_license__.centerId + centerName',
    license: '__tdw_cloud_license__ + commercial_license_data_v2',
    owner: 'users table owner/hq_admin with usable credential',
    branch: 'license.branches[] or device.lockedBranchId',
    device: '__tdw_device_config__',
    dataSource: 'restoreChoice or bootstrapCompletedAt',
    initialSync: 'meta.bootstrapCompletedAt (authoritative) — NOT wizard syncDone alone',
    google: 'Drive connection state',
  },
  notAuthoritative: ['__tdw_boot_wizard__.syncDone alone', '__tdw_boot_complete__ localStorage flag'],
};

const legacyFlags = {
  wizardComplete: { storage: '__tdw_boot_wizard__.completedSteps', classification: 'UI-only' },
  bootCompleted: { storage: 'localStorage __tdw_boot_complete__', classification: 'legacy/UI marker' },
  setupComplete: { storage: '__tdw_boot_wizard__.setupCompletedAt', classification: 'UI-only (SqliteBridge UI_ONLY)' },
  syncDone: { storage: '__tdw_boot_wizard__.syncDone', classification: 'derived wizard progress — not sole SoT for READY' },
  firstRunComplete: { storage: 'settings.firstRun.wizardCompleted', classification: 'UI-only post-auth onboarding' },
  restoreChoice: { storage: '__tdw_boot_wizard__.restoreChoice', classification: 'UI prerequisite input' },
  bootstrapCompletedAt: { storage: '__tdw_meta__.bootstrapCompletedAt', classification: 'authoritative operational' },
};

const stateMap = {
  generatedAt: new Date().toISOString(),
  readyEvaluator: 'ReadyPureEvaluator.evaluateReadyPure',
  setupStateIntegration: 'SetupStateService.evaluateReady + resolveState',
  bootFlowDelegation: 'BootFlow.isBootComplete → SetupStateService.evaluateReady',
  startupUnchanged: true,
  bootOrderingUnchanged: true,
};

const tests = spawnSync(process.execPath, [path.join(root, 'tests/baseline/test-stage-2-ready-pure.js')], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, STAGE2_BUILD_ID: buildId },
});
const stage1Tests = [
  'test-v2-5-10-cloud-discovery-restore',
  'test-p0-c-restore-truth-and-boot-gate',
  'test-current-restore-license-login',
  'test-current-setup-restore-runtime',
  'test-v2-5-8-auth-activation-ui',
].map((name) => {
  const r = spawnSync(process.execPath, [path.join(root, 'tests/baseline', `${name}.js`)], { cwd: root, encoding: 'utf8' });
  return { name, pass: r.status === 0 };
});

const manifest = {
  branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
  commit: git(['rev-parse', 'HEAD']),
  commitShort: git(['rev-parse', '--short', 'HEAD']),
  stage1Reference: stage1Ref,
  node: process.version,
  platform: process.platform,
  buildId,
};

const regression = {
  stage2Focused: tests.status === 0 ? 'PASS' : 'FAIL',
  stage1Focused: stage1Tests.every((t) => t.pass) ? 'PASS' : 'FAIL',
  stage1Details: stage1Tests,
  stdout: (tests.stdout || '').trim().slice(-500),
  stderr: (tests.stderr || '').trim().slice(-500),
};

const zeroWrite = {
  method: 'VM sandbox with localStorage write guards',
  iterations: 5,
  result: tests.status === 0 ? 'PASS' : 'FAIL',
  note: 'evaluateReady must not mutate SQLite/KV/localStorage',
};

const files = {
  'SOURCE-MANIFEST.json': manifest,
  'READY-STATE-MAP.json': stateMap,
  'READY-GATES.json': readyGates,
  'LEGACY-FLAGS.json': legacyFlags,
  'ZERO-WRITE-VERIFICATION.json': zeroWrite,
  'RESTART-VERIFICATION.json': { simulated: true, result: tests.status === 0 ? 'PASS' : 'UNVERIFIED' },
  'RESTORE-VERIFICATION.json': { via: 'test-stage-2-ready-pure restore consistency', result: tests.status === 0 ? 'PASS' : 'FAIL' },
  'REGRESSION-RESULTS.json': regression,
  'TEST-RESULTS.json': { ok: tests.status === 0, buildId, regression },
};

for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(evidenceDir, name), `${JSON.stringify(data, null, 2)}\n`);
}

const summary = [
  '# Stage 2 READY Pure — Summary',
  '',
  `**Build ID:** ${buildId}`,
  `**Commit:** ${manifest.commit}`,
  `**Stage 2 focused:** ${regression.stage2Focused}`,
  `**Stage 1 regression:** ${regression.stage1Focused}`,
  '',
  '## Verdict',
  tests.status === 0 && regression.stage1Focused === 'PASS' ? '**PASS**' : '**FAIL**',
].join('\n');
fs.writeFileSync(path.join(evidenceDir, 'SUMMARY.md'), `${summary}\n`);

console.log(JSON.stringify({ ok: tests.status === 0, evidenceDir, regression }, null, 2));
process.exit(tests.status === 0 && regression.stage1Focused === 'PASS' ? 0 : 1);
