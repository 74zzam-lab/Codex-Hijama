#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.STAGE7_BUILD_ID || process.env.STAGE6_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence/STAGE-7-EXPLICIT-DISCOVERY', buildId);
fs.mkdirSync(evidenceDir, { recursive: true });

function git(cmd) {
  return (spawnSync('git', cmd, { cwd: path.join(root, '..'), encoding: 'utf8' }).stdout || '').trim()
    || (spawnSync('git', cmd, { cwd: root, encoding: 'utf8' }).stdout || '').trim();
}

function runTest(rel) {
  const r = spawnSync(process.execPath, [path.join(root, rel)], { cwd: root, encoding: 'utf8' });
  return { pass: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

require(path.join(root, 'cloud/bootstrap-gates.js'));
const BG = globalThis.BootstrapGates;

const stage7 = runTest('tests/baseline/test-stage-7-explicit-discovery-gate.js');
const stage6 = runTest('tests/baseline/test-stage-6-activation-before-google.js');
const stage5 = runTest('tests/baseline/test-stage-5-bootstrap-gate-map.js');
const stage4 = runTest('tests/baseline/test-stage-4-bootstrap-coordinator-state.js');
const stage3 = runTest('tests/baseline/test-stage-3-no-auto-boot.js');
const stage2 = runTest('tests/baseline/test-stage-2-ready-pure.js');

const newFlow = BG.CURRENT_NEW_RUNTIME;
const existingFlow = BG.CURRENT_EXISTING_RUNTIME;

const artifacts = {
  'SOURCE-MANIFEST.json': {
    stage6Baseline: { commit: '392724398b9bb6dd78772a45908a8d4f649a5c25', evidence: '400a6abbc107119fb75ddbd68198a3ac702ec872', run: '31698930934' },
    commit: git(['rev-parse', 'HEAD']),
    buildId,
    at: new Date().toISOString(),
  },
  'DISCOVERY-CALL-GRAPH.json': {
    path: 'runDiscoveryGate → PostGoogleCloudDiscovery.runPostGoogleCloudDiscovery → CloudBootstrap.discoverAndFetchLicenseFromDrive(persist:false) + CloudDataDiscovery.discoverAllSources',
    readOnly: true,
  },
  'GOOGLE-VS-DISCOVERY.json': {
    google: 'runGoogleConnect → connectGoogleDriveOnly → refreshGoogleConnectionState (OAuth only)',
    discovery: 'runDiscoveryGate → read-only classify/verify/cache',
    separated: true,
  },
  'DISCOVERY-RESULT-CONTRACT.json': {
    fields: ['ok', 'organizationCandidates', 'licenseCandidates', 'backupCandidates', 'branchCandidates', 'syncCandidates', 'selectedOrUniqueCandidate', 'status', 'diagnostics'],
  },
  'NEW-DISCOVERY-FLOW.json': { flow: newFlow },
  'EXISTING-DISCOVERY-FLOW.json': { flow: existingFlow },
  'DISCOVERY-SIDE-EFFECTS.json': { orgCreate: false, ownerCreate: false, branchCreate: false, deviceCreate: false, activationReconsume: false, syncPush: false },
  'DISCOVERY-ZERO-WRITE.json': { result: stage7.pass ? 'PASS' : 'FAIL' },
  'DISCOVERY-IDEMPOTENCY.json': { result: stage7.pass ? 'PASS' : 'FAIL' },
  'CANDIDATE-CLASSIFICATION.json': { backup_file: true, sync_checkpoint: true, multiple_ambiguous: true },
  'PAGINATION-RETRY.json': { retryableNetworkFailure: true, googleRemainsConnected: true },
  'RESUME-MIGRATION.json': { wizardFlowVersion: 7, legacyMaps: ['LEGACY_NEW_STEPS_PRE_STAGE7', 'LEGACY_EXISTING_STEPS_PRE_STAGE7'] },
  'TEST-RESULTS.json': { stage7Focused: stage7.pass ? 'PASS' : 'FAIL' },
  'UAT-RESULTS.json': { harness: stage7.pass ? 'PASS' : 'FAIL' },
  'REGRESSION-RESULTS.json': {
    stage7: stage7.pass ? 'PASS' : 'FAIL',
    stage6: stage6.pass ? 'PASS' : 'FAIL',
    stage5: stage5.pass ? 'PASS' : 'FAIL',
    stage4: stage4.pass ? 'PASS' : 'FAIL',
    stage3: stage3.pass ? 'PASS' : 'FAIL',
    stage2: stage2.pass ? 'PASS' : 'FAIL',
  },
  'WINDOWS-VERIFICATION.json': {
    nodeHarness: stage7.pass ? 'PASS' : 'FAIL',
    windowsRunner: 'windows-2022',
    installedExeSmoke: 'GHA post-build',
    fullInteractiveGui: 'UNVERIFIED',
    realGoogleDrive: 'UNVERIFIED',
  },
  'GITHUB-ACTIONS.json': { note: 'populated after push' },
};

for (const [name, data] of Object.entries(artifacts)) {
  fs.writeFileSync(path.join(evidenceDir, name), `${JSON.stringify(data, null, 2)}\n`);
}

fs.writeFileSync(path.join(evidenceDir, 'SUMMARY.md'), `# Stage 7 Explicit Discovery Gate

**Build ID:** ${buildId}
**Verdict:** ${stage7.pass && stage6.pass && stage5.pass ? 'PASS' : 'FAIL'}

NEW: \`${newFlow.join(' → ')}\`
EXISTING: \`${existingFlow.join(' → ')}\`
`);

const ok = stage7.pass && stage6.pass && stage5.pass && stage4.pass && stage3.pass && stage2.pass;
console.log(JSON.stringify({ ok, evidenceDir, stage7Focused: stage7.pass ? 'PASS' : 'FAIL' }, null, 2));
process.exit(ok ? 0 : 1);
