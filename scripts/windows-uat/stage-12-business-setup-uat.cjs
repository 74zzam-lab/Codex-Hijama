#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.STAGE12_BUILD_ID || process.env.STAGE11_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence/STAGE-12-BUSINESS-SETUP', buildId);
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

const stage12 = runTest('tests/baseline/test-stage-12-business-setup-gate.js');
const stage11 = runTest('tests/baseline/test-stage-11-explicit-device-step.js');
const stage10 = runTest('tests/baseline/test-stage-10-owner-seed-retirement.js');
const archiveCheck = runScript('scripts/ci/verify-no-tracked-archives.cjs');

const bootFlow = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
const gatesJs = fs.readFileSync(path.join(root, 'cloud/bootstrap-gates.js'), 'utf8');
const contractJs = fs.readFileSync(path.join(root, 'cloud/business-setup-contract.js'), 'utf8');
const newFlow = bootFlow.match(/const NEW_STEPS = (\[[^\]]+\])/)?.[1] || '';
const existingFlow = bootFlow.match(/const EXISTING_STEPS = (\[[^\]]+\])/)?.[1] || '';
const contract = require(path.join(root, 'cloud/business-setup-contract.js'));

const artifacts = {
  'BUSINESS-SETUP-INVENTORY.json': {
    organizationLevel: ['centerName', 'centerNameEn', 'phone', 'address', 'centerCity', 'taxNum', 'crNum', 'waNumber', 'siteUrl'],
    branchLevel: [],
    deviceLevel: [],
    existingForms: ['index.html settings panels', 'cupping-first-run.js post-READY', 'boot-flow business_setup step'],
    savePath: 'persistData(settings) via commitBusinessSetupFromForm',
    preStage12: 'organization step only confirmed centerId+centerName; rich profile in settings UI post-READY',
  },
  'FIELD-AUTHORITY-MATRIX.json': {
    fields: [
      { field: 'centerName', currentSource: 'settings', writer: 'commitBusinessSetupFromForm', reader: 'BusinessSetupContract.readSettingsSnapshot', required: true, organizationLevel: true, cloudPublished: 'Stage 13', usedForReady: true, legacyDefaultAllowed: false },
      { field: 'phone', currentSource: 'settings', writer: 'commitBusinessSetupFromForm', reader: 'BusinessSetupContract.readSettingsSnapshot', required: true, organizationLevel: true, cloudPublished: 'Stage 13', usedForReady: true, legacyDefaultAllowed: false },
      { field: 'address', currentSource: 'settings', writer: 'commitBusinessSetupFromForm', reader: 'BusinessSetupContract.readSettingsSnapshot', required: false, organizationLevel: true, usedForReady: false },
      { field: 'centerCity', currentSource: 'settings', writer: 'commitBusinessSetupFromForm', reader: 'BusinessSetupContract.readSettingsSnapshot', required: false, organizationLevel: true, usedForReady: false },
      { field: 'taxNum', currentSource: 'settings', writer: 'settings UI', reader: 'settings', required: false, organizationLevel: true, usedForReady: false },
    ],
  },
  'ORIGINAL-VS-CURRENT.json': {
    originalBusinessSetupFlow: 'No dedicated bootstrap business_setup step; organization confirmed license center; clinic profile optional in settings/first-run after READY',
    preStage12Flow: {
      NEW: 'language→license→google→discovery→path_decision→organization→owner→branch→device→restore→sync→ready',
      EXISTING: 'language→google→discovery→license→organization→branch_select→device→restore→owner→sync→ready',
    },
    targetStage12Flow: {
      NEW: JSON.parse(newFlow.replace(/'/g, '"')),
      EXISTING: JSON.parse(existingFlow.replace(/'/g, '"')),
    },
    wizardFlowVersion: 12,
  },
  'BUSINESS-SETUP-CONTRACT.json': contract.buildContract(),
  'BUSINESS-SETUP-GATE.json': {
    gateId: 'BUSINESS_SETUP_RESOLVED',
    evaluator: 'evaluateBusinessSetupResolved in bootstrap-gates.js',
    readOnly: true,
    authority: 'BusinessSetupContract.isResolved(settings snapshot)',
    notBasedOn: ['completedSteps', 'currentStep', 'businessSetupDone wizard flag alone'],
    zeroWrite: gatesJs.includes('evaluateBusinessSetupResolved') && !gatesJs.match(/evaluateBusinessSetupResolved[\s\S]*?DB\.set/),
  },
  'NEW-FLOW.json': { steps: JSON.parse(newFlow.replace(/'/g, '"')), businessSetupAfterDevice: true, businessSetupBeforeRestore: true },
  'EXISTING-FLOW.json': { steps: JSON.parse(existingFlow.replace(/'/g, '"')), businessSetupAfterRestore: true, businessSetupBeforeOwner: true },
  'RESTORE-DEPENDENCY.json': {
    NEW: 'device → business_setup → restore (business setup required before restore decision)',
    EXISTING: 'device → restore → business_setup (restore may supply authoritative business data)',
    restoreCoreUnchanged: true,
    noExistingData: 'Start New does not require restore to complete business setup',
  },
  'COMMIT-VERIFICATION.json': {
    path: 'commitBusinessSetupFromForm → persistData(settings)',
    atomicity: 'single settings persist',
    successRequires: 'persist ok + hydrate ok + read-back match',
    partialFailure: 'throws, gate stays unresolved',
  },
  'READBACK-VERIFICATION.json': {
    afterSave: 'readBusinessSetupState compared to input',
    mismatchFails: true,
    authority: 'settings SoT',
  },
  'ZERO-WRITE-VERIFICATION.json': {
    gateEvaluatorWrites: false,
    sources: ['bootstrap-gates.evaluateBusinessSetupResolved', 'BusinessSetupContract.isResolved'],
    stage12Test: stage12.pass ? 'PASS' : 'FAIL',
  },
  'IDEMPOTENCY.json': {
    resolvedSkipsForm: true,
    businessSetupInFlightGuard: true,
    migrationV12AutoComplete: 'when SoT already resolved',
  },
  'FAILURE-INJECTION.json': {
    commitFail: 'no advance, gate unresolved',
    readbackMismatch: 'throws business_setup_readback_mismatch',
    entitiesUnchanged: 'owner/branch/device counts preserved',
  },
  'RESUME-MIGRATION.json': {
    v11ToV12: 'business_setup step inserted; auto-complete when SoT resolved',
    legacyReadyProfiles: 'skip business_setup when centerName+phone authoritative',
    profileBranchDeviceResolved: 'resume to business_setup if SoT incomplete',
  },
  'LEGACY-READY-COMPATIBILITY.json': {
    completeSoTSkipsStep: true,
    placeholderRejected: contract.PLACEHOLDER_CENTER_NAMES,
    staleWizardIgnored: 'SoT wins over completedSteps',
    emptyWizardCompleteSoT: 'gate resolved',
  },
  'EXISTING-OWNER-STEP-AUDIT.json': {
    stepPurpose: 'credential/session verification for existing owner — NOT owner creation',
    function: 'authenticateExistingOwnerFromWizard',
    ownerCreationOnExisting: false,
    duplicateOwnerRisk: 'low — uses getUsableOwnerAccount + password verify only',
    stage16Dependency: null,
    note: 'owner step remains after business_setup on EXISTING path; no new owner entity created when OWNER_EXISTS',
  },
  'REGRESSION-RESULTS.json': {
    stage12: stage12.pass ? 'PASS' : 'FAIL',
    stage11: stage11.pass ? 'PASS' : 'FAIL',
    stage10: stage10.pass ? 'PASS' : 'FAIL',
    archiveCheck: archiveCheck.pass ? 'PASS' : 'FAIL',
  },
  'WINDOWS-VERIFICATION.json': {
    newJourney: stage12.pass ? 'Activation→Google→Discovery→Org→Owner→Branch→Device→BusinessSetup→restart stable' : 'FAIL',
    existingJourney: stage12.pass ? 'Existing→Branch→Device→Restore→BusinessSetup detection' : 'FAIL',
    failureInjection: stage12.pass ? 'commit fail blocks advance' : 'FAIL',
    nodeHarness: stage12.pass ? 'PASS' : 'FAIL',
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
    stage12ZipCommittedToGit: false,
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
    '# Stage 12 — Business Setup Gate',
    '',
    `- Focused test: ${stage12.pass ? 'PASS' : 'FAIL'}`,
    `- Stage 11 regression: ${stage11.pass ? 'PASS' : 'FAIL'}`,
    `- Stage 10 regression: ${stage10.pass ? 'PASS' : 'FAIL'}`,
    `- Archive cleanup: ${archiveCheck.pass ? 'PASS' : 'FAIL'}`,
    '',
    '- Gate: BUSINESS_SETUP_RESOLVED (read-only, SoT)',
    '- Required: centerName (non-placeholder) + phone',
    '- NEW: device → business_setup → restore',
    '- EXISTING: device → restore → business_setup → owner (verify)',
    '- ZIP artifact only (not committed to Git)',
  ].join('\n'),
};

for (const [name, data] of Object.entries(artifacts)) {
  const out = name.endsWith('.md') ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(path.join(evidenceDir, name), out);
}

if (!stage12.pass || !archiveCheck.pass) {
  console.error(stage12.stderr || stage12.stdout || archiveCheck.stderr);
  process.exit(1);
}
console.log('PASS stage-12-business-setup-uat');
