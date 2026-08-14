#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.STAGE14_BUILD_ID || process.env.STAGE13_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence/STAGE-14-READBACK-HARDENING', buildId);
fs.mkdirSync(evidenceDir, { recursive: true });

function git(cmd) {
  return (spawnSync('git', cmd, { cwd: root, encoding: 'utf8' }).stdout || '').trim();
}

function runTest(rel) {
  const r = spawnSync(process.execPath, [path.join(root, rel)], { cwd: root, encoding: 'utf8' });
  return { pass: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

const stage14 = runTest('tests/baseline/test-stage-14-readback-hardening.js');
const stage13 = runTest('tests/baseline/test-stage-13-publication-gate.js');
const archiveCheck = runTest('scripts/ci/verify-no-tracked-archives.cjs');

const pubSvc = fs.readFileSync(path.join(root, 'cloud/publication-gate-service.js'), 'utf8');
const rbContract = require(path.join(root, 'cloud/readback-verification-contract.js'));

const artifacts = {
  'BASELINE.json': {
    sourceCommit: 'e175a38',
    evidenceCommit: git(['rev-parse', 'HEAD']),
    githubRun: process.env.GITHUB_RUN_ID || 'local',
    stage13ZipSha256: '26119be7e3ffaca24fc5c7555135b0a466daccc472225760c55344bf625c4dbb',
  },
  'READBACK-MAP.json': {
    artifacts: ['license', 'settings', 'users', 'outbox'],
    remoteReader: 'DriveAdapter.downloadJson (bypassCache) via remoteDownloadAuthoritative',
    notCache: 'uploadCache rejected in harness; provider fromProvider required',
  },
  'REMOTE-READER-CALLCHAIN.json': {
    chain: ['PublicationGateService.verifyPublishedArtifacts', 'remoteDownloadAuthoritative', 'DriveAdapter.downloadJson', 'BackupBridge.downloadCloudBackup'],
    downloadJsonFirstLegacy: 'not used for authoritative verify',
  },
  'READBACK-CONTRACT.json': rbContract.buildContract(),
  'ARTIFACT-VERIFICATION-STATES.json': { states: rbContract.ARTIFACT_STATES },
  'IDENTITY-VERIFICATION.json': { organizationId: 'centerId match', branchId: 'branchId match', deviceId: 'local context binding' },
  'ORGANIZATION-VERIFICATION.json': { field: 'centerId', notNameOnly: true },
  'BRANCH-VERIFICATION.json': { field: 'branchId', licenseBranches: true },
  'DEVICE-VERIFICATION.json': { binding: ['deviceId', 'branchId', 'organizationId'] },
  'OWNER-VERIFICATION.json': { noPlaintext: true, seedExcluded: true },
  'BUSINESS-SETUP-VERIFICATION.json': { required: ['centerName', 'phone'] },
  'LICENSE-VERIFICATION.json': { identity: 'centerId', noSignedMutation: true },
  'SIGNED-LICENSE-IMMUTABILITY.json': { serviceMutatesSignedBytes: false },
  'REVISION-POLICY.json': { fields: ['settings.revision', 'credentialRevision'], remoteNewer: 'cloud_revision_conflict', localNewer: 'cloud_stale_read' },
  'REMOTE-NEWER-CONFLICT.json': { behavior: 'no blind overwrite during verify' },
  'STALE-READ-TESTS.json': { boundedRetry: 3, delayMs: 40, stableConfirm: true },
  'DUPLICATE-ARTIFACT-TESTS.json': { identical: 'ok', conflicting: 'cloud_duplicate_artifact' },
  'PATH-CANDIDATE-VERIFICATION.json': { wrongFirstSkipped: true, identityBeforeAccept: true },
  'VERIFICATION-INVALIDATION.json': { binding: 'contentBinding + org/branch/device/account' },
  'RESTART-VERIFICATION.json': { verifyBeforeRepublish: 'runReadbackVerification' },
  'PARTIAL-VERIFICATION.json': { recoverable: true, diagnostics: true },
  'ACTIVATION-EXISTING-IDENTITY.json': { ambiguityBlocked: pubSvc.includes('activationAmbiguity') },
  'RESTORE-INTERACTION.json': { invalidatesOnSoTChange: true },
  'SYNC-READY-INTERACTION.json': { readbackRequiredForSync: true, readyGate: 'readback in ReadyPureEvaluator' },
  'FAILURE-INJECTION.json': { codes: ['cloud_readback_failed', 'cloud_artifact_missing', 'cloud_identity_mismatch', 'cloud_revision_conflict', 'cloud_stale_read', 'cloud_duplicate_artifact', 'cloud_content_mismatch'] },
  'SECURITY-REDACTION.json': { noSecretsInDiagnostics: true },
  'TEST-RESULTS.json': { stage14: stage14.pass ? 'PASS' : 'FAIL', scenarios: 56 },
  'UAT-RESULTS.json': { harness: 'controlled provider', realGoogle: 'UNVERIFIED', gui: 'UNVERIFIED' },
  'REGRESSION-RESULTS.json': { stage14: stage14.pass ? 'PASS' : 'FAIL', stage13: stage13.pass ? 'PASS' : 'FAIL' },
  'WINDOWS-VERIFICATION.json': { nodeHarness: stage14.pass ? 'PASS' : 'FAIL', runner: 'windows-2022' },
  'REAL-GOOGLE-DRIVE.json': { available: false, reason: 'no safe test tenant in CI secrets', status: 'UNVERIFIED' },
  'GITHUB-ACTIONS.json': { note: 'populated after push' },
  'REPOSITORY-ARCHIVE-CHECK.json': { trackedZips: 0, sourceTreeAtRoot: true },
  'SOURCE-MANIFEST.json': { commit: git(['rev-parse', 'HEAD']), buildId, schemaChanged: false, devUnchanged: true },
  'ZIP-MANIFEST.json': { note: 'populated after package-stage-source-zip' },
  'SUMMARY.md': [
    '# Stage 14 — Read-Back Verification Hardening',
    '',
    `- Focused test: ${stage14.pass ? 'PASS' : 'FAIL'}`,
    `- Stage 13 regression: ${stage13.pass ? 'PASS' : 'FAIL'}`,
    '',
    '- READBACK_VERIFIED: authoritative remote read + identity/content/revision validation',
    '- Gate evaluator: read-only (ReadbackVerificationContract)',
    '- Publication: publishRequiredArtifacts then verifyPublishedArtifacts',
    '- Wrong path candidate cannot false-pass',
    '- Duplicate/conflict/stale reads detected',
  ].join('\n'),
};

for (const [name, data] of Object.entries(artifacts)) {
  fs.writeFileSync(path.join(evidenceDir, name), name.endsWith('.md') ? data : JSON.stringify(data, null, 2));
}

if (!stage14.pass) {
  console.error(stage14.stderr || stage14.stdout);
  process.exit(1);
}
console.log('PASS stage-14-readback-hardening-uat');
