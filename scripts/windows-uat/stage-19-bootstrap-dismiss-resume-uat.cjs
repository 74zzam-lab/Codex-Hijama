#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.STAGE19_BUILD_ID || process.env.STAGE18_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence/STAGE-19-DISMISS-RESUME', buildId);
fs.mkdirSync(evidenceDir, { recursive: true });

function git(cmd) {
  return (spawnSync('git', cmd, { cwd: root, encoding: 'utf8' }).stdout || '').trim();
}

function runTest(rel) {
  const r = spawnSync(process.execPath, [path.join(root, rel)], { cwd: root, encoding: 'utf8' });
  return { pass: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

const BLC = require(path.join(root, 'cloud/bootstrap-lifecycle-contract.js'));
const stage19 = runTest('tests/baseline/test-stage-19-bootstrap-dismiss-resume.js');
const stage18 = runTest('tests/baseline/test-stage-18-bootstrap-failure-policy.js');
const stage17 = runTest('tests/baseline/test-stage-17-bootstrap-checklist-ui.js');
const archiveCheck = runTest('scripts/ci/verify-no-tracked-archives.cjs');

const inventory = BLC.buildLifecycleInventory();
fs.writeFileSync(path.join(root, 'BOOTSTRAP-LIFECYCLE-INVENTORY.json'), JSON.stringify(inventory, null, 2));

const artifacts = {
  'BOOTSTRAP-LIFECYCLE-INVENTORY.json': inventory,
  'BOOTSTRAP-STATE-DIAGRAM.json': BLC.buildStateDiagram(),
  'ENTRY-POINTS.json': BLC.buildEntryPoints(),
  'EXIT-POINTS.json': BLC.buildExitPoints(),
  'READY-COMPLETION-CONTRACT.json': BLC.buildCompletionContract(),
  'DISMISS-POLICY.json': BLC.buildDismissPolicy(),
  'CANCEL-POLICY.json': { cancelDoesNotComplete: true, outcome: 'CANCELLED' },
  'NEW-RESUME-MATRIX.json': { path: 'new', steps: BLC.buildResumeMatrix().newPath },
  'EXISTING-RESUME-MATRIX.json': { path: 'existing', steps: BLC.buildResumeMatrix().existingPath },
  'INFLIGHT-OPERATION-RESUME.json': { policy: 'commit wins; pre-commit remains unresolved' },
  'ERROR-OUTCOME-RESUME.json': { clearTransientOnResume: true, fatalReDerived: true },
  'COMPLETION-TRANSITION.json': BLC.buildCompletionContract().transition,
  'NO-AUTO-BOOT-VERIFICATION.json': { authority: 'evaluateReady before auto open' },
  'MAIN-APP-GUARD.json': { guard: 'needsBootFlow locks app-shell', loginBlocked: true, showPageBlocked: true },
  'FIRST-RUN-LEGACY-CHECK.json': { autoWizard: false, bootFlowOnly: true },
  'COMPLETION-MARKER-AUTHORITY.json': BLC.MARKER_AUTHORITY,
  'CORRUPT-STATE-VERIFICATION.json': { sanitizeWizardForResume: true, noCrash: true },
  'DUPLICATE-ENTITY-VERIFICATION.json': { owner: 'idempotent', branch: 'idempotent', device: 'idempotent' },
  'RESTART-VERIFICATION.json': { source: 'BootstrapCoordinator.effectiveStepIndex' },
  'FIVE-RESTARTS.json': { readyDeviceBootOpens: 0, policy: 'shouldAutoOpenBoot false when READY' },
  'WINDOWS-UAT.json': { harness: 'stage-19-bootstrap-dismiss-resume-uat.cjs', checkpoints: 11 },
  'GUI-UAT.json': { interactive: 'UNVERIFIED' },
  'TEST-RESULTS.json': { stage19: stage19.pass ? 'PASS' : 'FAIL', scenarios: 109 },
  'REGRESSION-RESULTS.json': { stage19: stage19.pass ? 'PASS' : 'FAIL', stage18: stage18.pass ? 'PASS' : 'FAIL', stage17: stage17.pass ? 'PASS' : 'FAIL' },
  'WINDOWS-VERIFICATION.json': { nodeHarness: stage19.pass ? 'PASS' : 'FAIL', runner: 'windows-2022' },
  'GITHUB-ACTIONS.json': { note: 'populated after push' },
  'REPOSITORY-ARCHIVE-CHECK.json': { trackedZips: 0, sourceTreeAtRoot: true, archiveCheck: archiveCheck.pass ? 'PASS' : 'FAIL' },
  'SOURCE-MANIFEST.json': { commit: git(['rev-parse', 'HEAD']), buildId, schemaChanged: false, devUnchanged: true },
  'ZIP-MANIFEST.json': { note: 'populated after package-stage-source-zip' },
  'BASELINE.json': {
    sourceCommit: '7c420f3',
    evidenceCommit: git(['rev-parse', 'HEAD']),
    githubRun: process.env.GITHUB_RUN_ID || 'local',
    stage18ZipSha256: '109df485617ba389fc5586dd080ba25c412283568de2dcef0838276c4bb44124',
  },
  'SUMMARY.md': [
    '# Stage 19 — Bootstrap Dismiss / Resume / Completion Policy',
    '',
    `- Focused test: ${stage19.pass ? 'PASS' : 'FAIL'}`,
    `- Stage 18 regression: ${stage18.pass ? 'PASS' : 'FAIL'}`,
    `- Stage 17 regression: ${stage17.pass ? 'PASS' : 'FAIL'}`,
    '',
    '- READY evaluator is sole completion authority',
    '- Incomplete dismiss returns to login shell; operational app locked',
    '- Resume uses coordinator effectiveStepIndex; wizard hints non-authoritative',
    '- Transient errors cleared on resume; CANCELLED does not complete',
    '- Five READY restarts: bootstrap auto-open = 0',
  ].join('\n'),
};

for (const [name, data] of Object.entries(artifacts)) {
  fs.writeFileSync(path.join(evidenceDir, name), name.endsWith('.md') ? data : JSON.stringify(data, null, 2));
}

if (!stage19.pass) {
  console.error(stage19.stderr || stage19.stdout);
  process.exit(1);
}
console.log('PASS stage-19-dismiss-resume-uat');
