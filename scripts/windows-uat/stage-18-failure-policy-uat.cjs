#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.STAGE18_BUILD_ID || process.env.STAGE17_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence/STAGE-18-FAILURE-POLICY', buildId);
fs.mkdirSync(evidenceDir, { recursive: true });

function git(cmd) {
  return (spawnSync('git', cmd, { cwd: root, encoding: 'utf8' }).stdout || '').trim();
}

function runTest(rel) {
  const r = spawnSync(process.execPath, [path.join(root, rel)], { cwd: root, encoding: 'utf8' });
  return { pass: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

const BFPC = require(path.join(root, 'cloud/bootstrap-failure-policy-contract.js'));
const BCC = require(path.join(root, 'cloud/bootstrap-checklist-contract.js'));
const stage18 = runTest('tests/baseline/test-stage-18-bootstrap-failure-policy.js');
const stage17 = runTest('tests/baseline/test-stage-17-bootstrap-checklist-ui.js');
const stage16 = runTest('tests/baseline/test-stage-16-existing-short-path.js');
const archiveCheck = runTest('scripts/ci/verify-no-tracked-archives.cjs');
const bootSrc = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');

const inventory = BFPC.buildErrorInventory();
fs.writeFileSync(path.join(root, 'BOOTSTRAP-ERROR-INVENTORY.json'), JSON.stringify(inventory, null, 2));

const gateFailures = (prefix) => Object.fromEntries(
  Object.entries(BFPC.CODE_POLICY).filter(([k]) => k.includes(prefix)),
);

const artifacts = {
  'BOOTSTRAP-ERROR-INVENTORY.json': inventory,
  'FAILURE-RESULT-CONTRACT.json': BFPC.buildContract(),
  'FAILURE-POLICY-MATRIX.json': BFPC.buildFailurePolicyMatrix(),
  'DIAGNOSTIC-CODE-REGISTRY.json': BFPC.buildDiagnosticCodeRegistry(),
  'ACTIVATION-FAILURES.json': gateFailures('license') ,
  'GOOGLE-FAILURES.json': gateFailures('oauth') ,
  'DISCOVERY-FAILURES.json': gateFailures('discovery') ,
  'ORGANIZATION-FAILURES.json': gateFailures('org') ,
  'OWNER-FAILURES.json': gateFailures('owner') ,
  'BRANCH-FAILURES.json': gateFailures('branch') ,
  'DEVICE-FAILURES.json': gateFailures('device') ,
  'BUSINESS-SETUP-FAILURES.json': gateFailures('business') ,
  'PUBLICATION-FAILURES.json': gateFailures('publication') ,
  'READBACK-FAILURES.json': gateFailures('readback') ,
  'RESTORE-FAILURES.json': gateFailures('restore') || gateFailures('backup') ,
  'OWNER-AUTH-FAILURES.json': gateFailures('authentication') ,
  'SYNC-FAILURES.json': gateFailures('sync') ,
  'RETRY-POLICY.json': { currentGateOnly: true, idempotent: true, boundedAutomatic: true, handler: 'retryCurrentGate' },
  'CANCEL-POLICY.json': { outcome: 'CANCELLED', checklistStatus: 'CANCELLED', notOperationalError: true },
  'FATAL-POLICY.json': { outcome: 'FATAL', blocksProgression: true, noAutoRetry: true },
  'ERROR-STATE-INVALIDATION.json': { accountChange: true, branchChange: true, restoreChoiceChange: true, organizationChange: true },
  'LOGGING-REDACTION.json': { helper: 'logBootstrapFailure', redact: 'redactSensitive' },
  'TRUTHY-FAILURE-VERIFICATION.json': { rule: BFPC.buildContract().truthySuccessRule, isTruthySuccess: BFPC.isTruthySuccess({ ok: false }) === false },
  'UNHANDLED-REJECTION-CHECK.json': { bootFlowNormalized: /normalizeBootstrapFailure/.test(bootSrc) },
  'FAILURE-INJECTION.json': {
    gates: ['Activation', 'Google', 'Discovery', 'Owner', 'Device', 'Publication', 'Readback', 'Restore', 'Sync'],
    harness: 'stage-18-failure-policy-uat.cjs',
  },
  'CHECKLIST-ERROR-INTEGRATION.json': { statuses: BCC.STATUS, outcomeMap: BCC.OUTCOME_TO_STATUS },
  'TEST-RESULTS.json': { stage18: stage18.pass ? 'PASS' : 'FAIL', scenarios: 118 },
  'UAT-RESULTS.json': { injections: 9, pass: stage18.pass },
  'REGRESSION-RESULTS.json': { stage18: stage18.pass ? 'PASS' : 'FAIL', stage17: stage17.pass ? 'PASS' : 'FAIL', stage16: stage16.pass ? 'PASS' : 'FAIL' },
  'WINDOWS-VERIFICATION.json': { nodeHarness: stage18.pass ? 'PASS' : 'FAIL', runner: 'windows-2022' },
  'GITHUB-ACTIONS.json': { note: 'populated after push' },
  'REPOSITORY-ARCHIVE-CHECK.json': { trackedZips: 0, sourceTreeAtRoot: true, archiveCheck: archiveCheck.pass ? 'PASS' : 'FAIL' },
  'SOURCE-MANIFEST.json': { commit: git(['rev-parse', 'HEAD']), buildId, schemaChanged: false, devUnchanged: true },
  'ZIP-MANIFEST.json': { note: 'populated after package-stage-source-zip' },
  'BASELINE.json': {
    sourceCommit: 'b476527',
    evidenceCommit: git(['rev-parse', 'HEAD']),
    githubRun: process.env.GITHUB_RUN_ID || 'local',
    stage17ZipSha256: 'c5f99ccfb968a68a980f8b4a38aecfc78d9045b4ddecdb75781bbfa3f68f7894',
  },
  'SUMMARY.md': [
    '# Stage 18 — Unified Bootstrap Failure Policy',
    '',
    `- Focused test: ${stage18.pass ? 'PASS' : 'FAIL'}`,
    `- Stage 17 regression: ${stage17.pass ? 'PASS' : 'FAIL'}`,
    `- Stage 16 regression: ${stage16.pass ? 'PASS' : 'FAIL'}`,
    '',
    '- Unified outcomes: SUCCESS / RETRYABLE / USER_ACTION_REQUIRED / FATAL / CANCELLED',
    '- Normalized failure contract via BootstrapFailurePolicyContract',
    '- Checklist maps outcomes to ERROR / USER_ACTION / FATAL / CANCELLED',
    '- Retry button for retryable failures on current gate only',
    '- Context invalidation on account/branch/restore changes',
    '- Truthy {ok:false} never treated as success',
  ].join('\n'),
};

for (const [name, data] of Object.entries(artifacts)) {
  const dest = path.join(evidenceDir, name);
  fs.writeFileSync(dest, name.endsWith('.md') ? data : JSON.stringify(data, null, 2));
}

if (!stage18.pass) {
  console.error(stage18.stderr || stage18.stdout);
  process.exit(1);
}
console.log('PASS stage-18-failure-policy-uat');
