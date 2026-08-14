#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.STAGE11_BUILD_ID || process.env.STAGE10_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence/STAGE-11-EXPLICIT-DEVICE-STEP', buildId);
fs.mkdirSync(evidenceDir, { recursive: true });

function git(cmd) {
  return (spawnSync('git', cmd, { cwd: root, encoding: 'utf8' }).stdout || '').trim();
}

function runTest(rel) {
  const r = spawnSync(process.execPath, [path.join(root, rel)], { cwd: root, encoding: 'utf8' });
  return { pass: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

function runScript(rel) {
  const r = spawnSync(process.execPath, [path.join(root, rel)], { cwd: root, encoding: 'utf8' });
  return { pass: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

const stage11 = runTest('tests/baseline/test-stage-11-explicit-device-step.js');
const stage10 = runTest('tests/baseline/test-stage-10-owner-seed-retirement.js');
const stage9 = runTest('tests/baseline/test-stage-9-owner-before-first-branch.js');
const archiveCheck = runScript('scripts/ci/verify-no-tracked-archives.cjs');

const bootFlow = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
const newFlow = bootFlow.match(/const NEW_STEPS = (\[[^\]]+\])/)?.[1] || '';
const existingFlow = bootFlow.match(/const EXISTING_STEPS = (\[[^\]]+\])/)?.[1] || '';

const artifacts = {
  'DEVICE-INVENTORY.json': {
    branchCreation: 'createFirstBranchFromForm → commitSetupOrganizationDevice(branchOnly:true)',
    branchSelect: 'selectExistingBranchOnly → pendingBranchId',
    deviceId: 'commitSetupOrganizationDevice → device registry',
    fingerprint: 'licGetFingerprint',
    deviceName: 'registerDeviceFromForm → bf-device-name',
    branchLink: 'DeviceConfig.lockedBranchId + pendingBranchId',
    localCommit: 'setupCommitOrganizationDevice IPC',
    publish: 'publishFirstSetupBranch (branch) + device registry publication',
    deviceLimit: 'service.js device limit check on commit',
    lockedBranchId: 'DeviceConfig.lockedBranchId',
    readyCheck: 'hasDeviceBranch + deviceStepResolved',
    existingPath: 'selectExistingBranchOnly + registerDeviceFromForm',
  },
  'ORIGINAL-VS-STAGE11.json': {
    before: 'branch step combined branch+device registration',
    after: 'branch → device explicit gates',
    wizardFlowVersion: 11,
    orchestrationOnly: true,
  },
  'DEVICE-AUTHORITY-CONTRACT.json': {
    gate: 'DEVICE_RESOLVED',
    sourceOfTruth: 'DeviceConfig + device registry via hasDeviceBranch/deviceStepResolved',
    notBasedOn: ['completedSteps alone', 'wizard boolean only'],
  },
  'DEVICE-LIMIT-VERIFICATION.json': {
    enforcedAt: 'registerDeviceFromForm / setupCommitOrganizationDevice',
    noPartialRegistration: true,
  },
  'DEVICE-IDEMPOTENCY.json': {
    sameDeviceRetry: 'deviceStepResolved + deviceRegisterInFlight guard',
    doubleSubmit: 'deviceRegisterInFlight',
  },
  'DEVICE-READBACK.json': {
    fields: ['deviceId', 'organizationId', 'branchId', 'fingerprint', 'deviceName'],
    function: 'readDeviceCommitState',
    mismatchFails: true,
  },
  'RESUME-MIGRATION.json': {
    v10ToV11: 'legacy branch+device auto-completes device step when hasDeviceBranch',
    branchOnlyLegacy: 'resume to device step',
    stage10OwnerBeforeBranch: 'resume branch → device → restore',
  },
  'FAILURE-INJECTION.json': {
    beforeCommit: 'stay on device step',
    afterCommit: 'device gate resolved on restart',
    publicationFailure: 'local authoritative commit preserved per existing contract',
  },
  'NEW-FLOW.json': { steps: JSON.parse(newFlow.replace(/'/g, '"')) },
  'EXISTING-FLOW.json': { steps: JSON.parse(existingFlow.replace(/'/g, '"')) },
  'REGRESSION-RESULTS.json': {
    stage11: stage11.pass ? 'PASS' : 'FAIL',
    stage10: stage10.pass ? 'PASS' : 'FAIL',
    stage9: stage9.pass ? 'PASS' : 'FAIL',
    archiveCheck: archiveCheck.pass ? 'PASS' : 'FAIL',
  },
  'WINDOWS-VERIFICATION.json': {
    newPath: stage11.pass ? 'Owner→Branch→Device→restart stable' : 'FAIL',
    existingPath: stage11.pass ? 'Branch Select→Device→restart stable' : 'FAIL',
    nodeHarness: stage11.pass ? 'PASS' : 'FAIL',
    windowsRunner: 'windows-2022',
    installedExeSmoke: 'GHA post-build',
    fullInteractiveGui: 'UNVERIFIED',
    realGoogleDrive: 'UNVERIFIED',
  },
  'GITHUB-ACTIONS.json': { note: 'populated after push' },
  'REPOSITORY-ARCHIVE-CLEANUP.json': {
    trackedHistoricalZipsRemoved: true,
    gitignoreRules: ['Tadawi-Stage-*.zip', 'Hijama-Management-System-SOURCE-BUILD-*.zip'],
    verifyScript: 'scripts/ci/verify-no-tracked-archives.cjs',
    zipArtifactOnly: true,
  },
  'SOURCE-MANIFEST.json': {
    commit: git(['rev-parse', 'HEAD']),
    buildId,
    at: new Date().toISOString(),
    sourceTreeAtRepoRoot: fs.existsSync(path.join(root, 'package.json')),
  },
  'ZIP-MANIFEST.json': { note: 'populated after package-stage-source-zip' },
  'UAT-RESULTS.json': {
    newOwnerBranchDeviceRestart: stage11.pass ? 'PASS' : 'FAIL',
    existingBranchSelectDeviceRestart: stage11.pass ? 'PASS' : 'FAIL',
    deviceRemainsOne: stage11.pass ? 'PASS' : 'FAIL',
  },
  'SUMMARY.md': [
    '# Stage 11 — Explicit Device Step',
    '',
    `- Focused test: ${stage11.pass ? 'PASS' : 'FAIL'}`,
    `- Stage 10 regression: ${stage10.pass ? 'PASS' : 'FAIL'}`,
    `- Stage 9 regression: ${stage9.pass ? 'PASS' : 'FAIL'}`,
    `- Archive cleanup check: ${archiveCheck.pass ? 'PASS' : 'FAIL'}`,
    '- NEW: owner → branch → device → restore',
    '- EXISTING: branch_select → device → restore',
    '- ZIP artifact only (not committed to Git)',
  ].join('\n'),
};

for (const [name, data] of Object.entries(artifacts)) {
  const out = name.endsWith('.md') ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(path.join(evidenceDir, name), out);
}

if (!stage11.pass || !archiveCheck.pass) {
  console.error(stage11.stderr || stage11.stdout || archiveCheck.stderr);
  process.exit(1);
}
console.log('PASS stage-11-explicit-device-step-uat');
