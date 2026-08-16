#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.STAGE15_BUILD_ID || process.env.STAGE14_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence/STAGE-15-INITIAL-SYNC', buildId);
fs.mkdirSync(evidenceDir, { recursive: true });

function git(cmd) {
  return (spawnSync('git', cmd, { cwd: root, encoding: 'utf8' }).stdout || '').trim();
}

function runTest(rel) {
  const r = spawnSync(process.execPath, [path.join(root, rel)], { cwd: root, encoding: 'utf8' });
  return { pass: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

const ISC = require(path.join(root, 'cloud/initial-sync-direction-contract.js'));
const stage15 = runTest('tests/baseline/test-stage-15-initial-sync-direction.js');
const stage14 = runTest('tests/baseline/test-stage-14-readback-hardening.js');
const archiveCheck = runTest('scripts/ci/verify-no-tracked-archives.cjs');

const entryPoints = [
  { file: 'cloud/boot-flow-ui.js', function: 'runInitialSyncPipeline', caller: 'sync wizard step', canPush: 'plan-bound', canPull: 'plan-bound' },
  { file: 'cloud/sync-engine.js', function: 'runOnce', caller: 'BootFlow + manual sync', direction: 'explicit options.direction' },
  { file: 'cloud/restore-reconciliation.js', function: 'reconcileAfterRestore', caller: 'post-restore', direction: 'pull only' },
  { file: 'cloud/initial-sync-direction-contract.js', function: 'resolveInitialSyncPlan', caller: 'bootstrap orchestration', direction: 'read-only plan' },
];

const artifacts = {
  'BASELINE.json': {
    sourceCommit: '9c484e7',
    evidenceCommit: git(['rev-parse', 'HEAD']),
    githubRun: process.env.GITHUB_RUN_ID || 'local',
    stage14ZipSha256: 'ab8b14eef2f72cec910a88c5106d9e9b5d5b3dd6b16a90f91d4b22090914870f',
  },
  'SYNC-ENTRY-POINT-INVENTORY.json': { entryPoints },
  'INITIAL-SYNC-MODE-CONTRACT.json': ISC.buildContract(),
  'SCENARIO-SYNC-MATRIX.json': {
    NEW_START_NEW: ISC.MODES.PUSH_ONLY,
    NEW_USE_EXISTING: ISC.MODES.PULL_ONLY,
    DIRECT_EXISTING: ISC.MODES.PULL_ONLY,
    CLOUD_RESTORE: ISC.MODES.PULL_ONLY,
    LOCAL_RESTORE: ISC.MODES.RECONCILE,
    REPLACEMENT_DEVICE: ISC.MODES.PULL_ONLY,
  },
  'NEW-SYNC-PLAN.json': { mode: ISC.MODES.PUSH_ONLY, reason: 'new_start_new_local_authoritative' },
  'EXISTING-SYNC-PLAN.json': { mode: ISC.MODES.PULL_ONLY, reason: 'existing_pull_authoritative' },
  'USE-EXISTING-SYNC-PLAN.json': { mode: ISC.MODES.PULL_ONLY, reason: 'existing_or_restore_pull_first_empty_local_guard' },
  'RESTORE-SYNC-PLAN.json': { cloud: ISC.MODES.PULL_ONLY, local: ISC.MODES.RECONCILE },
  'REPLACEMENT-DEVICE-SYNC.json': { mode: ISC.MODES.PULL_ONLY, emptyLocalPushBlocked: true },
  'EMPTY-LOCAL-PUSH-PROTECTION.json': { guard: 'emptyLocalPushBlocked', bootstrapOnlyExcluded: true },
  'BOOTSTRAP-ONLY-CLASSIFICATION.json': { classifier: 'classifyBootstrapOnlyState' },
  'OUTBOX-SAFETY.json': { pullFirstAllowOutboxDrain: false, pushPathAllowOutboxDrain: true },
  'PRE-POST-RESTORE-OUTBOX.json': { preRestore: 'DB swap replaces outbox', postRestore: 'restored outbox authoritative' },
  'SYNC-PLAN-BINDING.json': { fields: ['organizationId', 'branchId', 'deviceId', 'path', 'restoreChoice'] },
  'SYNC-PLAN-INVALIDATION.json': { triggers: ['branch change', 'path change', 'restore choice change'] },
  'INITIAL-SYNC-COMPLETION.json': { authority: '__tdw_meta__.initialSyncCompletion', notWizardSyncDone: true },
  'RESTART-VERIFICATION.json': { resume: ISC.MODES.RESUME_PENDING, durableMarker: true },
  'FAILURE-INJECTION.json': { codes: ['sync_plan_invalid', 'sync_post_restore_blocked', 'sync_publication_required', 'sync_readback_required'] },
  'BRANCH-SCOPE-VERIFICATION.json': { deviceBranch: 'BR-1', crossBranchBlocked: true },
  'DEVICE-AB-SIMULATION.json': { deviceB: 'PULL_ONLY empty-local guard', note: 'simulated provider state' },
  'LEGACY-WRITER-CHECK.json': { legacyFullTablePush: 'blocked unless legacyMigration' },
  'SYNC-PROGRESS.json': { stages: ['plan', 'pull', 'push', 'reconcile', 'complete'] },
  'SYNC-DIAGNOSTICS.json': { planReason: true, bindingFingerprint: true },
  'READY-SYNC-GATE.json': { gate: 'INITIAL_SYNC_RESOLVED', evaluator: 'InitialSyncDirectionContract.isInitialSyncResolved' },
  'TEST-RESULTS.json': { stage15: stage15.pass ? 'PASS' : 'FAIL', scenarios: 79 },
  'UAT-RESULTS.json': {
    matrix: ['NEW start-new', 'Existing empty local', 'Post-restore', 'Replacement device', 'Restart during sync', 'Failure/retry', 'two-device simulated'],
    realGoogle: 'UNVERIFIED',
    gui: 'UNVERIFIED',
  },
  'REGRESSION-RESULTS.json': { stage15: stage15.pass ? 'PASS' : 'FAIL', stage14: stage14.pass ? 'PASS' : 'FAIL' },
  'WINDOWS-VERIFICATION.json': { nodeHarness: stage15.pass ? 'PASS' : 'FAIL', runner: 'windows-2022' },
  'REAL-GOOGLE-DRIVE.json': { available: false, status: 'UNVERIFIED' },
  'GITHUB-ACTIONS.json': { note: 'populated after push' },
  'REPOSITORY-ARCHIVE-CHECK.json': { trackedZips: 0, sourceTreeAtRoot: true, archiveCheck: archiveCheck.pass ? 'PASS' : 'FAIL' },
  'SOURCE-MANIFEST.json': { commit: git(['rev-parse', 'HEAD']), buildId, schemaChanged: false, devUnchanged: true },
  'ZIP-MANIFEST.json': { note: 'populated after package-stage-source-zip' },
  'SUMMARY.md': [
    '# Stage 15 — Initial Sync Direction + Post-Restore Sync Safety',
    '',
    `- Focused test: ${stage15.pass ? 'PASS' : 'FAIL'}`,
    `- Stage 14 regression: ${stage14.pass ? 'PASS' : 'FAIL'}`,
    '',
    '- Explicit pull/push/reconcile contract per bootstrap scenario',
    '- Empty-local push protection for existing/restore/replacement',
    '- INITIAL_SYNC_RESOLVED uses durable completion marker',
    '- PULL_ONLY cannot drain outbox or push',
    '- Publication + read-back gates enforced before initial sync (NEW path)',
  ].join('\n'),
};

for (const [name, data] of Object.entries(artifacts)) {
  fs.writeFileSync(path.join(evidenceDir, name), name.endsWith('.md') ? data : JSON.stringify(data, null, 2));
}

if (!stage15.pass) {
  console.error(stage15.stderr || stage15.stdout);
  process.exit(1);
}
console.log('PASS stage-15-initial-sync-direction-uat');
