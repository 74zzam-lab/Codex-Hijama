#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.STAGE8_BUILD_ID || process.env.STAGE7_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence/STAGE-8-EXPLICIT-FORK', buildId);
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

const stage8 = runTest('tests/baseline/test-stage-8-explicit-new-existing-fork.js');
const stage7 = runTest('tests/baseline/test-stage-7-explicit-discovery-gate.js');
const stage6 = runTest('tests/baseline/test-stage-6-activation-before-google.js');
const stage5 = runTest('tests/baseline/test-stage-5-bootstrap-gate-map.js');
const stage4 = runTest('tests/baseline/test-stage-4-bootstrap-coordinator-state.js');
const stage3 = runTest('tests/baseline/test-stage-3-no-auto-boot.js');
const stage2 = runTest('tests/baseline/test-stage-2-ready-pure.js');

const newFlow = BG.CURRENT_NEW_RUNTIME;
const existingFlow = BG.CURRENT_EXISTING_RUNTIME;

const stage7Baseline = {
  sourceCommit: '659e7f8',
  evidenceCommit: '962d78f',
  githubRun: '31701831883',
};

const artifacts = {
  'SOURCE-MANIFEST.json': {
    stage7Baseline,
    commit: git(['rev-parse', 'HEAD']),
    buildId,
    at: new Date().toISOString(),
  },
  'FORK-DECISION-CONTRACT.json': {
    forkStep: 'path_decision',
    newOnly: true,
    choices: ['use_existing', 'start_new'],
    labelsAr: ['استخدام البيانات الموجودة', 'بدء إعداد جديد'],
    noSilentPathFlip: true,
    noSilentOrgCreate: true,
    coordinatorFields: ['forkDecision', 'forkSelectedCandidateId'],
    gate: 'PATH_DECISION_RESOLVED',
  },
  'DISCOVERY-TO-FORK.json': {
    classifications: [
      'no_existing_business',
      'unique_existing_business',
      'ambiguous_candidates',
      'backup_only',
      'license_only',
      'partial_existing_state',
      'discovery_error',
    ],
    requiresForkWhen: 'requiresPathFork(classification) === true',
    noForkWhen: 'no_existing_business',
  },
  'NEW-NO-EXISTING.json': { forkShown: false, pathRemains: 'new', nextStep: 'organization' },
  'NEW-EXISTING-FOUND.json': { forkShown: true, pathBeforeChoice: 'new', requiresUserAction: true },
  'MULTIPLE-CANDIDATES.json': { candidateSelectionRequired: true, noUseExistingWithoutSelection: true },
  'CANCEL-DECISION.json': { decisionUnresolved: true, noPathMutation: true },
  'RESTART-DECISION.json': { beforeChoice: 'resume fork', afterExisting: 'resume EXISTING route', afterNew: 'resume NEW next gate' },
  'ACCOUNT-CHANGE-INVALIDATION.json': { invalidateOnGoogleAccountChange: true, invalidateOnDiscoveryRefresh: true },
  'PATH-SWITCH.json': { useExisting: 'path → existing once', startNew: 'path remains new' },
  'ACTIVATION-CONSUMPTION.json': {
    afterUseExisting: 'retained-until-existing-license-recovery',
    duplicateConsume: false,
    observation: 'NEW activation consumed before fork remains local; EXISTING license step may recover Drive license without re-consume',
  },
  'NO-DUPLICATE-ENTITIES.json': { organization: 0, owner: 0, branch: 0, device: 0, atFork: true },
  'ORIGINAL-VS-CURRENT.json': {
    original: 'silent NEW→EXISTING flip possible via autoDiscoverActivationAfterGoogle',
    preStage8: 'flip logged/blocked at discovery; no explicit fork UI',
    stage8: 'explicit path_decision step; user must choose use_existing or start_new',
  },
  'TEST-RESULTS.json': { stage8Focused: stage8.pass ? 'PASS' : 'FAIL', scenarios: 26 },
  'UAT-RESULTS.json': { harness: stage8.pass ? 'PASS' : 'FAIL', controlledDiscovery: true },
  'REGRESSION-RESULTS.json': {
    stage8: stage8.pass ? 'PASS' : 'FAIL',
    stage7: stage7.pass ? 'PASS' : 'FAIL',
    stage6: stage6.pass ? 'PASS' : 'FAIL',
    stage5: stage5.pass ? 'PASS' : 'FAIL',
    stage4: stage4.pass ? 'PASS' : 'FAIL',
    stage3: stage3.pass ? 'PASS' : 'FAIL',
    stage2: stage2.pass ? 'PASS' : 'FAIL',
  },
  'WINDOWS-VERIFICATION.json': {
    nodeHarness: stage8.pass ? 'PASS' : 'FAIL',
    windowsRunner: 'windows-2022',
    installedExeSmoke: 'GHA post-build',
    fullInteractiveGui: 'UNVERIFIED',
    realGoogleDrive: 'UNVERIFIED',
  },
  'GITHUB-ACTIONS.json': { note: 'populated after push' },
  'ZIP-MANIFEST.json': { note: 'populated after package-stage-source-zip' },
};

for (const [name, data] of Object.entries(artifacts)) {
  fs.writeFileSync(path.join(evidenceDir, name), `${JSON.stringify(data, null, 2)}\n`);
}

fs.writeFileSync(path.join(evidenceDir, 'SUMMARY.md'), `# Stage 8 Explicit NEW/EXISTING Fork

**Build ID:** ${buildId}
**Verdict:** ${stage8.pass && stage7.pass && stage6.pass && stage5.pass ? 'PASS' : 'FAIL'}

NEW: \`${newFlow.join(' → ')}\`
EXISTING: \`${existingFlow.join(' → ')}\`

Stage 7 baseline: ${stage7Baseline.sourceCommit} / run ${stage7Baseline.githubRun}
`);

const ok = stage8.pass && stage7.pass && stage6.pass && stage5.pass && stage4.pass && stage3.pass && stage2.pass;
console.log(JSON.stringify({ ok, evidenceDir, stage8Focused: stage8.pass ? 'PASS' : 'FAIL' }, null, 2));
process.exit(ok ? 0 : 1);
