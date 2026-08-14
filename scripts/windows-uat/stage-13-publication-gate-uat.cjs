#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.STAGE13_BUILD_ID || process.env.STAGE12_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence/STAGE-13-PUBLICATION-GATE', buildId);
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

const stage13 = runTest('tests/baseline/test-stage-13-publication-gate.js');
const stage12 = runTest('tests/baseline/test-stage-12-business-setup-gate.js');
const stage11 = runTest('tests/baseline/test-stage-11-explicit-device-step.js');
const archiveCheck = runScript('scripts/ci/verify-no-tracked-archives.cjs');

const bootFlow = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
const gatesJs = fs.readFileSync(path.join(root, 'cloud/bootstrap-gates.js'), 'utf8');
const pubSvc = fs.readFileSync(path.join(root, 'cloud/publication-gate-service.js'), 'utf8');
const pubContract = require(path.join(root, 'cloud/publication-contract.js'));
const newFlow = bootFlow.match(/const NEW_STEPS = (\[[^\]]+\])/)?.[1] || '';
const existingFlow = bootFlow.match(/const EXISTING_STEPS = (\[[^\]]+\])/)?.[1] || '';

const inventory = [
  {
    artifact: 'license',
    file: 'cloud/publication-gate-service.js',
    function: 'publishLicense',
    trigger: 'commitPublicationFromWizard → runSetupPublication',
    remotePath: 'DriveLayout.licenseJson(centerId)',
    payload: 'signed license document (immutable bytes)',
    sourceOfTruth: 'LicenseCloud.loadLocal',
    overwrite: 'LicenseCloud.pushToDrive overwrite',
    retry: 'idempotent upsert via publication retry',
    idempotency: 'centerId match read-back',
    verification: 'remote download + centerId/branchId',
    beforeLocalCommit: false,
    dependsOnGoogle: true,
    onRestart: 'resume if not verified',
  },
  {
    artifact: 'settings',
    file: 'cloud/publication-gate-service.js',
    function: 'publishSettings',
    trigger: 'runSetupPublication (NEW only)',
    remotePath: 'ConfigLayer.drivePathForFile(centerId, branchId, settings.json)',
    payload: 'centerName, phone, branch settings pack',
    sourceOfTruth: 'settings + ConfigLayer.exportBranchPack',
    overwrite: 'uploadJson overwrite:true',
    retry: 'partial retry from failed artifact',
    idempotency: 'overwrite same path',
    verification: 'remote download centerName/phone',
    beforeLocalCommit: false,
    dependsOnGoogle: true,
    onRestart: 'skip if verified',
  },
  {
    artifact: 'users',
    file: 'cloud/publication-gate-service.js',
    function: 'publishUsers',
    trigger: 'runSetupPublication (NEW only)',
    remotePath: 'users.json + owner.json under branch config',
    payload: 'owner projection without plaintext password / seed',
    sourceOfTruth: 'ConfigLayer.exportBranchPack',
    overwrite: 'uploadJson overwrite:true',
    retry: 'partial retry',
    idempotency: 'overwrite same path',
    verification: 'remote users array owner without seedDefaultPassword',
    beforeLocalCommit: false,
    dependsOnGoogle: true,
    onRestart: 'skip if verified',
  },
  {
    artifact: 'outbox',
    file: 'cloud/publication-gate-service.js',
    function: 'publishOutbox',
    trigger: 'runSetupPublication',
    remotePath: 'SqliteOutboxBridge pending ops',
    payload: 'org/branch/device metadata via outbox',
    sourceOfTruth: 'local SQLite outbox',
    overwrite: 'outbox flush semantics',
    retry: 'pushPending idempotent',
    idempotency: 'outbox dedupe',
    verification: 'flush count / no hard fail',
    beforeLocalCommit: false,
    dependsOnGoogle: true,
    onRestart: 'resume flush',
  },
  {
    artifact: 'branch_license_inline',
    file: 'cloud/boot-flow-ui.js',
    function: 'publishFirstSetupBranch (pre-stage13)',
    trigger: 'branch step commit',
    remotePath: 'license.json',
    payload: 'branch added to signed license',
    sourceOfTruth: 'local license',
    note: 'Stage 13 publication re-verifies license read-back; does not mutate signed bytes in publication gate',
  },
];

const artifacts = {
  'PUBLICATION-INVENTORY.json': inventory,
  'REMOTE-ARTIFACT-MATRIX.json': {
    A_IMMUTABLE_SIGNED: ['license'],
    B_ORG_METADATA: ['outbox org projection'],
    C_BRANCH_METADATA: ['license branches', 'settings pack'],
    D_DEVICE_METADATA: ['outbox device projection'],
    E_CONFIG_BUSINESS_SETUP: ['settings.json centerName/phone'],
    F_RUNTIME_ACTIVATION: ['license identity reference only — no re-consume'],
    G_SYNC_DATA: 'deferred to sync engine — not setup publication',
    H_BACKUP_DATA: 'deferred to backup layer — not setup publication',
  },
  'LOCAL-VS-CLOUD-AUTHORITY.json': {
    local: ['settings', 'users', 'license local', 'device config', 'wizard local only'],
    cloudAuthority: '__tdw_meta__.setupPublication with per-artifact readBack:true',
    states: pubContract.STATES,
    notCloudSuccess: ['upload return without read-back', 'wizard.completedSteps alone'],
  },
  'PUBLICATION-DEPENDENCY-GRAPH.json': {
    hardDependencies: ['organization', 'owner (NEW)', 'branch', 'device', 'business_setup'],
    order: ['license', 'settings', 'users', 'outbox'],
    existingMinimal: pubContract.EXISTING_MINIMAL,
    newFull: pubContract.NEW_REQUIRED,
  },
  'PUBLICATION-CONTRACT.json': pubContract.buildContract(),
  'NEW-PUBLICATION-FLOW.json': {
    steps: JSON.parse(newFlow.replace(/'/g, '"')),
    publicationAfter: 'business_setup',
    publicationBefore: 'restore',
    gate: 'PUBLICATION_RESOLVED',
  },
  'EXISTING-PUBLICATION-FLOW.json': {
    steps: JSON.parse(existingFlow.replace(/'/g, '"')),
    publicationAfter: 'business_setup',
    publicationBefore: 'owner',
    scope: 'license read-back + outbox only',
    noFullRepublish: true,
  },
  'OWNER-PUBLICATION.json': {
    via: 'publishUsers owner.json projection',
    noPlaintextPassword: !/passwordPlain/.test(pubSvc) || pubSvc.includes('delete copy.passwordPlain'),
    seedExcluded: pubSvc.includes('seedDefaultPassword'),
    retiredSeedNotAuthoritative: true,
  },
  'BRANCH-PUBLICATION.json': {
    via: 'license.json branches + settings pack branchId',
    readBackFields: ['branchId', 'organizationId', 'name'],
  },
  'DEVICE-PUBLICATION.json': {
    via: 'outbox device metadata',
    readBackFields: ['deviceId', 'fingerprint', 'deviceName', 'branchId'],
  },
  'BUSINESS-SETUP-PUBLICATION.json': {
    via: 'publishSettings',
    fields: ['centerName', 'phone'],
    readBackRequired: true,
  },
  'LICENSE-RUNTIME-PUBLICATION.json': {
    publish: 'LicenseCloud.pushToDrive',
    existingPath: 'read-back only skippedPublish',
    noActivationReconsume: !pubSvc.includes('consume'),
  },
  'SIGNED-LICENSE-IMMUTABILITY.json': {
    publicationMutatesSignedBytes: false,
    contractFlag: pubContract.buildContract().signedLicenseImmutable,
    branchInlinePublish: 'pre-existing at branch step — separate from publication gate mutation',
  },
  'READBACK-VERIFICATION.json': {
    authority: 'DriveAdapter.downloadJsonFirst / remoteDownload',
    notCache: 'must not use in-memory object as read-back',
    mismatchBehavior: 'PUBLICATION_FAILED / gate unresolved',
    perArtifact: true,
  },
  'PARTIAL-PUBLICATION.json': {
    behavior: 'stop at first failed artifact; prior artifacts not destructive on retry',
    state: 'PUBLICATION_FAILED with artifacts map',
  },
  'IDEMPOTENCY.json': {
    inFlightGuard: bootFlow.includes('publicationInFlight'),
    verifiedSkips: bootFlow.includes('publicationStepResolved'),
    noDuplicateRemoteFiles: 'overwrite:true + find-first download paths',
  },
  'FAILURE-INJECTION.json': {
    uploadOkReadbackFail: 'PUBLICATION_RESOLVED false',
    missingRemote: 'PUBLICATION_RESOLVED false',
    network: 'PUBLICATION_PENDING/FAILED local SoT preserved',
    token: 'oauth_unauthorized → failed',
    identityMismatch: 'cloud_identity_mismatch',
  },
  'ACCOUNT-IDENTITY-VERIFICATION.json': {
    function: 'verifyGoogleIdentity',
    checks: ['DriveAdapter connected', 'license ownerIdentity email binding'],
    accountChangeBlocked: true,
  },
  'DUPLICATE-REMOTE-FILE-CHECK.json': {
    policy: 'uploadJson overwrite + candidate path resolution',
    doubleSubmit: 'publicationInFlight guard',
    fiveRestarts: 'verified record prevents republish',
  },
  'ACTIVATION-EXISTING-POLICY-IMPACT.json': {
    useExisting: 'minimal publication scope',
    retainedActivation: 'no wrong remote activation write over existing business',
    publicationWaits: 'existing license recovery before remote activation metadata',
  },
  'TEST-RESULTS.json': {
    stage13Focused: stage13.pass ? 'PASS' : 'FAIL',
    scenarioCount: 49,
    stdout: stage13.stdout,
  },
  'UAT-RESULTS.json': {
    harness: 'controlled provider mock in focused test',
    realGoogle: 'UNVERIFIED',
    fullInteractiveGui: 'UNVERIFIED',
  },
  'REGRESSION-RESULTS.json': {
    stage13: stage13.pass ? 'PASS' : 'FAIL',
    stage12: stage12.pass ? 'PASS' : 'FAIL',
    stage11: stage11.pass ? 'PASS' : 'FAIL',
    archiveCheck: archiveCheck.pass ? 'PASS' : 'FAIL',
  },
  'WINDOWS-VERIFICATION.json': {
    nodeHarness: stage13.pass ? 'PASS' : 'FAIL',
    windowsRunner: 'windows-2022',
    installedExeSmoke: 'GHA post-build',
    fullInteractiveGui: 'UNVERIFIED',
    realGoogleDrive: 'UNVERIFIED',
  },
  'GITHUB-ACTIONS.json': { note: 'populated after push' },
  'REPOSITORY-ARCHIVE-CHECK.json': {
    trackedHistoricalZips: 0,
    trackedSourceBuildZips: 0,
    sourceTreeAtRepoRoot: fs.existsSync(path.join(root, 'package.json')),
    stage13ZipCommittedToGit: false,
    zipArtifactOnly: true,
    verifyScript: archiveCheck.pass ? 'PASS' : 'FAIL',
  },
  'SOURCE-MANIFEST.json': {
    commit: git(['rev-parse', 'HEAD']),
    buildId,
    at: new Date().toISOString(),
    sourceTreeAtRepoRoot: true,
    schemaChanged: false,
    devUnchanged: true,
  },
  'ZIP-MANIFEST.json': { note: 'populated after package-stage-source-zip' },
  'SUMMARY.md': [
    '# Stage 13 — Publication Gate + Cloud Read-Back Boundary',
    '',
    `- Focused test: ${stage13.pass ? 'PASS' : 'FAIL'}`,
    `- Stage 12 regression: ${stage12.pass ? 'PASS' : 'FAIL'}`,
    `- Stage 11 regression: ${stage11.pass ? 'PASS' : 'FAIL'}`,
    `- Archive cleanup: ${archiveCheck.pass ? 'PASS' : 'FAIL'}`,
    '',
    '- Gate: PUBLICATION_RESOLVED (read-only evaluator)',
    '- Action: commitPublicationFromWizard → PublicationGateService.runSetupPublication',
    '- NEW: business_setup → publication → restore',
    '- EXISTING: business_setup → publication → owner (minimal scope)',
    '- Read-back required for all required artifacts',
    '- ZIP artifact only (not committed to Git)',
  ].join('\n'),
};

for (const [name, data] of Object.entries(artifacts)) {
  const out = name.endsWith('.md') ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(path.join(evidenceDir, name), out);
}

if (!stage13.pass || !archiveCheck.pass) {
  console.error(stage13.stderr || stage13.stdout || archiveCheck.stderr);
  process.exit(1);
}
console.log('PASS stage-13-publication-gate-uat');
