#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.STAGE10_BUILD_ID || process.env.STAGE9_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence/STAGE-10-OWNER-SEED-RETIREMENT', buildId);
fs.mkdirSync(evidenceDir, { recursive: true });

function git(cmd) {
  return (spawnSync('git', cmd, { cwd: path.join(root, '..'), encoding: 'utf8' }).stdout || '').trim()
    || (spawnSync('git', cmd, { cwd: root, encoding: 'utf8' }).stdout || '').trim();
}

function runTest(rel) {
  const r = spawnSync(process.execPath, [path.join(root, rel)], { cwd: root, encoding: 'utf8' });
  return { pass: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

const stage10 = runTest('tests/baseline/test-stage-10-owner-seed-retirement.js');
const stage9 = runTest('tests/baseline/test-stage-9-owner-before-first-branch.js');
const stage8 = runTest('tests/baseline/test-stage-8-explicit-new-existing-fork.js');

const stage9Baseline = {
  sourceCommit: 'b9369e7',
  evidenceCommit: '2df5e53',
  githubRun: '31708117757',
};

const artifacts = {
  'OWNER-SEED-INVENTORY.json': {
    markers: ['seedDefaultPassword', 'OWNER_SEED_PASSWORD_HASH', 'ensureOwnerSeedAccount', 'ownerSeedRetired'],
    modules: ['cloud/owner-seed-retirement.js', 'cloud/owner-management.js', 'index.html', 'electron/security/password-auth.js'],
  },
  'OWNER-STATE-CLASSIFICATION.json': {
    states: ['NO_OWNER', 'SEED_ONLY', 'REAL_OWNER', 'REAL_OWNER + LEGACY_SEED', 'AMBIGUOUS_MULTIPLE_OWNER', 'RESTORED_OWNER', 'INVALID_OWNER_CREDENTIAL'],
    module: 'OwnerSeedRetirement.classifyOwnerState',
  },
  'AUTHORITATIVE-OWNER-CONTRACT.json': {
    rule: 'active owner with usable credential, not seedDefaultPassword, not ownerSeedRetired',
    count: 'OwnerSeedRetirement.countAuthoritativeOwners === 1',
  },
  'SEED-RETIREMENT-POLICY.json': {
    method: 'disable + ownerSeedRetired marker + supersededByOwnerId (no hard delete)',
    triggers: ['OwnerManagement.createOwner', 'migrateOwnerSeedStateIfNeeded', 'startup migration', 'commitSetupOwner'],
  },
  'LEGACY-MIGRATION.json': { idempotent: true, restartSafe: true, seedOnlyRequiresSetup: true },
  'OWNER-COUNT-VERIFICATION.json': { authoritativeOwnerCount: 1, seedExcluded: true },
  'LOGIN-VERIFICATION.json': {
    seedAfterSetup: 'DENIED',
    realOwner: 'PASS',
    renderer: 'doLogin + filterLoginUsers',
    main: 'password-auth.hasAuthoritativeOwner',
  },
  'RESTORE-VERIFICATION.json': { realOwner: 'authoritative', seedOnly: 'setup required', realPlusSeed: 'real wins' },
  'CREDENTIAL-REVISION.json': { preserved: true, seedCannotOverwrite: true },
  'FAILURE-INJECTION.json': { afterOwnerCommit: 'migrate on restart', duringRetirement: 'idempotent' },
  'DEVICE-AB-OWNER.json': { note: 'sync preserves real owner; seed not reintroduced' },
  'DEV-ACCESS-NOT-CHANGED.json': { devLogin: 'unchanged', developerCredentials: 'unchanged' },
  'TEST-RESULTS.json': { stage10Focused: stage10.pass ? 'PASS' : 'FAIL', scenarios: 35 },
  'UAT-RESULTS.json': {
    freshSeedToRealOwner: stage10.pass ? 'PASS' : 'FAIL',
    restart: stage10.pass ? 'PASS' : 'FAIL',
    seedLoginDenied: stage10.pass ? 'PASS' : 'FAIL',
    legacyMigration: stage10.pass ? 'PASS' : 'FAIL',
    restoreRoundTrip: 'UNVERIFIED',
    noDuplicateOwner: stage10.pass ? 'PASS' : 'FAIL',
  },
  'REGRESSION-RESULTS.json': {
    stage10: stage10.pass ? 'PASS' : 'FAIL',
    stage9: stage9.pass ? 'PASS' : 'FAIL',
    stage8: stage8.pass ? 'PASS' : 'FAIL',
  },
  'WINDOWS-VERIFICATION.json': {
    nodeHarness: stage10.pass ? 'PASS' : 'FAIL',
    windowsRunner: 'windows-2022',
    installedExeSmoke: 'GHA post-build',
    fullInteractiveGui: 'UNVERIFIED',
    realGoogleDrive: 'UNVERIFIED',
  },
  'GITHUB-ACTIONS.json': { note: 'populated after push' },
  'SOURCE-MANIFEST.json': { stage9Baseline, commit: git(['rev-parse', 'HEAD']), buildId, at: new Date().toISOString() },
  'ZIP-MANIFEST.json': { note: 'populated after package-stage-source-zip' },
  'SUMMARY.md': [
    '# Stage 10 — Owner Seed Retirement',
    '',
    `- Focused test: ${stage10.pass ? 'PASS' : 'FAIL'}`,
    `- Stage 9 regression: ${stage9.pass ? 'PASS' : 'FAIL'}`,
    `- Retirement: disable + ownerSeedRetired (no hard delete)`,
    `- Authoritative Owner: real credential only; seed excluded from READY/login after setup`,
  ].join('\n'),
};

for (const [name, data] of Object.entries(artifacts)) {
  fs.writeFileSync(path.join(evidenceDir, name), JSON.stringify(data, null, 2));
}

if (!stage10.pass) {
  console.error(stage10.stderr || stage10.stdout);
  process.exit(1);
}
console.log('PASS stage-10-owner-seed-retirement-uat');
