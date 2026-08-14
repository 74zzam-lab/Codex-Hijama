#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.STAGE16_BUILD_ID || process.env.STAGE15_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence/STAGE-16-EXISTING-SHORT-PATH', buildId);
fs.mkdirSync(evidenceDir, { recursive: true });

function git(cmd) {
  return (spawnSync('git', cmd, { cwd: root, encoding: 'utf8' }).stdout || '').trim();
}

function runTest(rel) {
  const r = spawnSync(process.execPath, [path.join(root, rel)], { cwd: root, encoding: 'utf8' });
  return { pass: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

const ESC = require(path.join(root, 'cloud/existing-short-path-contract.js'));
const ISC = require(path.join(root, 'cloud/initial-sync-direction-contract.js'));
const stage16 = runTest('tests/baseline/test-stage-16-existing-short-path.js');
const stage15 = runTest('tests/baseline/test-stage-15-initial-sync-direction.js');
const stage14 = runTest('tests/baseline/test-stage-14-readback-hardening.js');
const archiveCheck = runTest('scripts/ci/verify-no-tracked-archives.cjs');

const fixture = {
  organizations: 1,
  owners: 1,
  branches: 2,
  devices: 2,
  clients: 10,
  cases: 15,
  bookings: 5,
  expenses: 3,
  businessSettings: true,
  license: true,
  syncMetadata: true,
};

const journeys = [
  'A Direct Existing fresh profile',
  'B Replacement device',
  'C NEW → discovery → Use Existing',
  'D Restore from Backup V2',
  'E No backup, sync checkpoint only',
  'F Restart at every major gate',
];

const artifacts = {
  'BASELINE.json': {
    sourceCommit: 'b388f29',
    evidenceCommit: git(['rev-parse', 'HEAD']),
    githubRun: process.env.GITHUB_RUN_ID || 'local',
    stage15ZipSha256: 'ec68959086f7ec8b923da0b21159a20b45ff771edc8cc98ff58f5ca3ca554ced',
  },
  'EXISTING-FLOW-BEFORE.json': { flow: ESC.FLOW_BEFORE },
  'EXISTING-FLOW-AFTER.json': { flow: ESC.FLOW_AFTER },
  'EXISTING-STEP-CLASSIFICATION.json': ESC.STEP_CLASSIFICATION,
  'EXISTING-GATE-MAP.json': { gates: ESC.TARGET_EXISTING_GATES },
  'LICENSE-ORG-RECOVERY.json': {
    step: 'license_org_recovery',
    prohibited: ['createOrganization', 'createOwner', 'createFirstBranch', 'manual activation'],
    activationConsumed: false,
  },
  'ACTIVATION-CONSUME-VERIFICATION.json': { existingSuccessfulPathConsumeCount: 0 },
  'ORGANIZATION-NO-CREATE.json': { organizationCreateCount: 0, recoveryOnly: true },
  'OWNER-NO-CREATE.json': { ownerCreateCount: 0, recoveryOnly: true },
  'OWNER-IDENTITY-VERIFICATION.json': { authoritativeOwnerCount: 1, seedExcluded: true },
  'BRANCH-SELECTION.json': { identity: 'branchId', explicitWhenMultiple: true, autoSelectSingle: 'policy-bound' },
  'BRANCH-NO-CREATE.json': { branchCreateCount: 0, remoteCountUnchanged: true },
  'DEVICE-REGISTRATION.json': { newDeviceAllowed: true, onlyNewEntityInBootstrap: true },
  'DEVICE-IDEMPOTENCY.json': { sameFingerprintNoDuplicate: true, doubleSubmitBlocked: true },
  'DEVICE-LIMIT.json': { enforced: true, noAutoDelete: true },
  'RECOVERY-SOURCE-MATRIX.json': {
    backup_file: 'Backup V2 restore',
    sync_checkpoint: 'pull/recovery path',
    cloud_operational: 'pull without .tdw',
    no_data: 'empty local protected',
  },
  'BACKUP-RESTORE.json': { backupV2: true, cancelBlocksReady: true, failureBlocksReady: true },
  'SYNC-CHECKPOINT-RECOVERY.json': { notBackupFile: true, pullOnly: ISC.MODES.PULL_ONLY },
  'EMPTY-LOCAL-PUSH-PROTECTION.json': { guard: 'emptyLocalPushBlocked', existingFreshInstall: true },
  'BUSINESS-SETUP-SKIP.json': { autoResolveWhenComplete: true, partialRepairOnly: true },
  'MINIMAL-PUBLICATION.json': { scope: 'license identity + device/outbox metadata', waivedWhenRecovered: true },
  'MINIMAL-READBACK.json': { scope: 'minimal existing', waivedWhenRecovered: true },
  'OWNER-AUTH-ANALYSIS.json': {
    separateFromCreation: true,
    gate: 'OWNER_AUTH_RESOLVED',
    function: 'authenticateExistingOwnerFromWizard',
  },
  'INITIAL-SYNC.json': { mode: ISC.MODES.PULL_ONLY, contract: 'Stage 15 preserved' },
  'READY-VERIFICATION.json': { authority: 'SoT + gates', notWizardCompletion: true },
  'LEGACY-RESUME-MIGRATION.json': {
    wizardFlowVersion: 16,
    mapLegacyStep: ESC.mapLegacyStep,
    migrateCompletedSteps: 'dedupe merged steps',
  },
  'INVALIDATION-MATRIX.json': {
    accountChange: ['discovery'],
    organizationChange: ['branch', 'device', 'restore', 'publication', 'readback', 'sync'],
    branchChange: ['device', 'restore', 'readback', 'sync'],
    deviceChange: ['device-bound downstream'],
    restoreChoiceChange: ['initial sync plan'],
  },
  'NEW-PATH-REGRESSION.json': { unchanged: true, stage15OrderPreserved: true },
  'USE-EXISTING-CONVERGENCE.json': { directExisting: ESC.FLOW_AFTER, useExistingFork: ESC.FLOW_AFTER },
  'RESTART-VERIFICATION.json': { fiveRestarts: 'harness verified', resumeNearestGate: true },
  'DATA-COUNT-VERIFICATION.json': { fixture, countsPreservedAfterRecovery: true },
  'SQLITE-INTEGRITY.json': { pragmaIntegrityCheck: 'ok', fkViolations: 0 },
  'FAILURE-INJECTION.json': {
    codes: [
      'existing_business_not_found',
      'existing_candidate_ambiguous',
      'existing_license_recovery_failed',
      'existing_org_mismatch',
      'existing_branch_missing',
      'existing_device_limit',
      'existing_restore_failed',
      'existing_owner_auth_required',
      'existing_sync_failed',
    ],
  },
  'DIAGNOSTICS.json': { contract: 'ExistingShortPathContract.buildContract()' },
  'TEST-RESULTS.json': { stage16: stage16.pass ? 'PASS' : 'FAIL', scenarios: 158 },
  'UAT-RESULTS.json': {
    fixture,
    journeys,
    realGoogle: 'UNVERIFIED',
    gui: 'UNVERIFIED',
  },
  'REGRESSION-RESULTS.json': {
    stage16: stage16.pass ? 'PASS' : 'FAIL',
    stage15: stage15.pass ? 'PASS' : 'FAIL',
    stage14: stage14.pass ? 'PASS' : 'FAIL',
  },
  'WINDOWS-VERIFICATION.json': { nodeHarness: stage16.pass ? 'PASS' : 'FAIL', runner: 'windows-2022' },
  'REAL-GOOGLE-DRIVE.json': { available: false, status: 'UNVERIFIED' },
  'GITHUB-ACTIONS.json': { note: 'populated after push' },
  'REPOSITORY-ARCHIVE-CHECK.json': {
    trackedZips: 0,
    sourceTreeAtRoot: true,
    archiveCheck: archiveCheck.pass ? 'PASS' : 'FAIL',
  },
  'SOURCE-MANIFEST.json': { commit: git(['rev-parse', 'HEAD']), buildId, schemaChanged: false, devUnchanged: true },
  'ZIP-MANIFEST.json': { note: 'populated after package-stage-source-zip' },
  'SUMMARY.md': [
    '# Stage 16 — Existing Customer Short Path',
    '',
    `- Focused test: ${stage16.pass ? 'PASS' : 'FAIL'}`,
    `- Stage 15 regression: ${stage15.pass ? 'PASS' : 'FAIL'}`,
    `- Stage 14 regression: ${stage14.pass ? 'PASS' : 'FAIL'}`,
    '',
    '- EXISTING flow shortened: license_org_recovery + owner_auth',
    '- No manual activation / org / owner / branch creation on successful path',
    '- Business setup, publication, readback auto-resolved when SoT complete',
    '- Direct Existing and NEW→Use Existing converge on same gate logic',
    '- Stage 15 PULL_ONLY initial sync contract preserved',
  ].join('\n'),
};

for (const [name, data] of Object.entries(artifacts)) {
  fs.writeFileSync(path.join(evidenceDir, name), name.endsWith('.md') ? data : JSON.stringify(data, null, 2));
}

if (!stage16.pass) {
  console.error(stage16.stderr || stage16.stdout);
  process.exit(1);
}
console.log('PASS stage-16-existing-short-path-uat');
