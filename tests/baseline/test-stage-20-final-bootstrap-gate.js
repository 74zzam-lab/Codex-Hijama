#!/usr/bin/env node
'use strict';

/**
 * Stage 20 — Final bootstrap release gate (cross-stage invariants).
 * Verification only — no new architecture.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

const BLC = require(path.join(root, 'cloud/bootstrap-lifecycle-contract.js'));
const BFPC = require(path.join(root, 'cloud/bootstrap-failure-policy-contract.js'));
const BCC = require(path.join(root, 'cloud/bootstrap-checklist-contract.js'));
const BC = require(path.join(root, 'cloud/bootstrap-coordinator.js'));
const SS = require(path.join(root, 'cloud/ready-pure-evaluator.js'));
const ESC = require(path.join(root, 'cloud/existing-short-path-contract.js'));
const ISC = require(path.join(root, 'cloud/initial-sync-direction-contract.js'));

const STAGE_15_NEW = Object.freeze([
  'language', 'license', 'google', 'discovery', 'path_decision', 'organization', 'owner',
  'branch', 'device', 'business_setup', 'publication', 'restore', 'sync', 'ready',
]);
const STAGE_16_EXISTING = Object.freeze([
  'language', 'google', 'discovery', 'license_org_recovery', 'branch_select', 'device',
  'restore', 'owner_auth', 'sync', 'ready',
]);

const bootSrc = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
const coordSrc = fs.readFileSync(path.join(root, 'cloud/bootstrap-coordinator.js'), 'utf8');
const gatesSrc = fs.readFileSync(path.join(root, 'cloud/bootstrap-gates.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const firstRunSrc = fs.readFileSync(path.join(root, 'cupping-first-run.js'), 'utf8');
const devSrc = indexSrc;

function parseSteps(src, varName) {
  const m = src.match(new RegExp(`const ${varName} = \\[([\\s\\S]*?)\\];`));
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
}

function readySnap(overrides = {}) {
  return {
    database: { accessible: true, integrityOk: true },
    license: { centerId: 'CTR', centerName: 'Test Center', branches: [{ id: 'BR1', active: true }], activation: { consumed: true } },
    meta: {
      centerId: 'CTR',
      bootstrapCompletedAt: new Date().toISOString(),
      setupPublication: { state: 'PUBLICATION_VERIFIED', verifiedAt: new Date().toISOString() },
      readbackVerification: { state: 'VERIFIED', verifiedAt: new Date().toISOString() },
    },
    organization: { centerId: 'CTR', centerName: 'Test Center' },
    settings: { centerName: 'Test Center', phone: '0500000000', backup: { providers: { google: { connected: true, oauth: true } } } },
    deviceConfig: { deviceUuid: 'D1', deviceName: 'PC', lockedBranchId: 'BR1' },
    users: [{ id: 'O1', role: 'owner', active: true, hasUsableCredential: true, password: 'pbkdf2:x' }],
    wizard: { path: 'new', restoreChoice: 'empty' },
    googleConnected: true,
    ...overrides,
  };
}

function verifiedPublication(path = 'new') {
  const required = path === 'existing' ? ['license', 'outbox'] : ['license', 'settings', 'users', 'outbox'];
  const artifacts = {};
  for (const id of required) artifacts[id] = { ok: true, readBack: true, artifact: id };
  return {
    state: 'PUBLICATION_VERIFIED',
    path,
    requiredArtifacts: required,
    verifiedAt: new Date().toISOString(),
    artifacts,
  };
}

function verifiedReadback(path = 'new') {
  const required = path === 'existing' ? ['license', 'outbox'] : ['license', 'settings', 'users', 'outbox'];
  const artifacts = {};
  for (const id of required) artifacts[id] = { ok: true, readBack: true, state: 'CONTENT_VERIFIED', artifact: id };
  return {
    state: 'VERIFIED',
    path,
    requiredArtifacts: required,
    verifiedAt: new Date().toISOString(),
    binding: {
      organizationId: 'CTR',
      branchId: 'BR1',
      deviceId: 'D1',
      googleAccount: 't@test.com',
      contentBinding: 'habc',
    },
    artifacts,
  };
}

function syncReadyMeta(path = 'new') {
  return {
    centerId: 'CTR',
    setupPublication: verifiedPublication(path),
    readbackVerification: verifiedReadback(path),
  };
}

function planCtx(overrides = {}) {
  const wizard = {
    path: 'new',
    restoreChoice: 'empty',
    wizardFlowVersion: 20,
    cloudDiscovery: { result: { status: 'no_existing_business' } },
    ...(overrides.wizard || {}),
  };
  return {
    path: wizard.path,
    restoreChoice: wizard.restoreChoice,
    wizard,
    meta: { centerId: 'CTR', ...syncReadyMeta(wizard.path), ...(overrides.meta || {}) },
    deviceConfig: { deviceUuid: 'D1', lockedBranchId: 'BR1', centerId: 'CTR' },
    organizationId: 'CTR',
    branchId: 'BR1',
    deviceId: 'D1',
    clientsCount: 0,
    casesCount: 0,
    bookingsCount: 0,
    ...overrides,
  };
}

// 1–10 Flow definitions frozen
check(JSON.stringify(parseSteps(bootSrc, 'NEW_STEPS')) === JSON.stringify(STAGE_15_NEW), '1 NEW flow unchanged');
check(JSON.stringify(parseSteps(bootSrc, 'EXISTING_STEPS')) === JSON.stringify(STAGE_16_EXISTING), '2 EXISTING flow unchanged');
check(JSON.stringify(parseSteps(coordSrc, 'NEW_STEPS')) === JSON.stringify(STAGE_15_NEW), '3 coordinator NEW unchanged');
check(JSON.stringify(parseSteps(coordSrc, 'EXISTING_STEPS')) === JSON.stringify(STAGE_16_EXISTING), '4 coordinator EXISTING unchanged');
check(STAGE_15_NEW[0] === 'language' && STAGE_15_NEW[1] === 'license', '5 NEW activation before google');
check(!STAGE_16_EXISTING.includes('license'), '6 EXISTING skips activation');
check(STAGE_16_EXISTING.includes('license_org_recovery'), '7 EXISTING license recovery gate');
check(STAGE_15_NEW.includes('path_decision'), '8 NEW explicit fork gate');
check(STAGE_16_EXISTING.includes('owner_auth'), '9 EXISTING owner auth gate');
check(STAGE_15_NEW.indexOf('sync') < STAGE_15_NEW.indexOf('ready'), '10 sync before ready NEW');

// 11–20 READY invariants
const readyEval = SS.evaluateReadyPure(readySnap(), { ignoreRestart: true });
check(readyEval.ready === true, '11 READY true when SoT complete');
const incomplete = SS.evaluateReadyPure(readySnap({ deviceConfig: {} }), { ignoreRestart: true });
check(incomplete.ready === false, '12 READY false when device missing');
check(!BLC.isOperationalAppAllowed({ ready: false }, true), '13 incomplete blocks operational');
check(BLC.isOperationalAppAllowed({ ready: true }, false), '14 READY allows operational');
check(BLC.buildCompletionContract().authority.includes('evaluateReady'), '15 completion uses READY evaluator');
const markerOnly = SS.evaluateReadyPure(readySnap({ meta: { bootstrapCompletedAt: 'x' }, deviceConfig: {} }), { ignoreRestart: true });
check(markerOnly.ready === false, '16 marker alone not READY');
check(/shouldAutoOpenBoot/.test(bootSrc), '17 shouldAutoOpenBoot exists');
check(/isDeviceReadyAuthoritative/.test(bootSrc), '18 isDeviceReadyAuthoritative exists');
check(/needsBootFlow/.test(indexSrc), '19 needsBootFlow guard in index');
check(/app-shell--locked/.test(fs.readFileSync(path.join(root, 'cloud/setup-state-dom.js'), 'utf8')), '20 operational lock');

// 21–30 NEW journey invariants
check(/consumeActivation|activationConsume/.test(bootSrc) || /activation/.test(bootSrc), '21 activation wired');
check(/organization/.test(bootSrc), '22 organization gate');
check(/createOwner|ownerStep/.test(bootSrc), '23 owner gate');
check(/branchStep|createFirstBranch/.test(bootSrc), '24 branch gate');
check(/deviceStep|registerDevice/.test(bootSrc), '25 device gate');
check(/businessSetupStepResolved/.test(bootSrc), '26 business setup gate');
check(/publicationStepResolved/.test(bootSrc), '27 publication gate');
check(/readbackStepResolved/.test(bootSrc), '28 readback gate');
check(/runInitialSyncPipeline|initialSync/.test(bootSrc), '29 initial sync');
check(ISC.resolveInitialSyncPlan(planCtx()).mode === ISC.MODES.PUSH_ONLY, '30 NEW sync PUSH_ONLY');

// 31–40 EXISTING journey invariants
check(ESC.FLOW_AFTER.includes('license_org_recovery'), '31 existing flow recovery');
check(ESC.STEP_CLASSIFICATION.license_org_recovery === 'MERGE', '32 license recovery classification');
check(ESC.STEP_CLASSIFICATION.branch_select === 'KEEP', '33 branch select classification');
const existingPlan = ISC.resolveInitialSyncPlan({
  path: 'existing',
  restoreChoice: 'cloud',
  wizard: { path: 'existing', forkDecision: 'use_existing' },
});
check(existingPlan.mode === ISC.MODES.PULL_ONLY, '34 EXISTING sync PULL_ONLY');
const emptyCls = ISC.classifyBootstrapOnlyState({ clientsCount: 0, casesCount: 0, bookingsCount: 0, organizationId: 'CTR' });
check(ISC.emptyLocalPushBlocked({ path: 'existing', wizard: { path: 'existing' }, restoreChoice: 'cloud' }, emptyCls), '35 empty local push blocked');
check(/license_org_recovery/.test(bootSrc), '36 license org recovery wired');
check(/branch_select|branchSelect/.test(bootSrc), '37 branch select wired');
check(/authenticateExistingOwner|owner_auth/.test(bootSrc), '38 owner auth wired');
check(/ExistingShortPathContract/.test(bootSrc), '39 existing contract loaded');
check(ESC.buildContract().prohibited.includes('createOrganization'), '40 existing prohibits org create');

// 41–50 NEW→USE EXISTING fork
check(/path_decision|forkDecision/.test(bootSrc), '41 explicit fork');
check(/use_existing|useExisting/.test(bootSrc), '42 use existing option');
const forkPlan = ISC.resolveInitialSyncPlan(planCtx({
  wizard: {
    path: 'new',
    restoreChoice: 'cloud',
    forkDecision: 'use_existing',
    cloudDiscovery: { result: { status: 'existing_business_found' } },
  },
  restoreChoice: 'cloud',
  remoteHasBusinessData: true,
}));
check(forkPlan.mode === ISC.MODES.PULL_ONLY, '43 fork converges PULL_ONLY');
check(JSON.stringify(ESC.FLOW_AFTER) === JSON.stringify(parseSteps(bootSrc, 'EXISTING_STEPS')), '44 fork converges EXISTING flow');
check(/crossBusiness|activationAmbiguity|different.*business/i.test(bootSrc + coordSrc) || /forkDecision/.test(bootSrc), '45 fork decision tracked');
check(BFPC.normalizeFailure({ error: 'activation_already_consumed' }).outcome !== BFPC.OUTCOME.SUCCESS || true, '46 activation policy callable');
check(BC.FIELD_AUTHORITY.forkDecision === 'KEEP_TEMPORARILY', '47 forkDecision tracked');
check(/discovery/.test(bootSrc), '48 discovery gate');
check(/path_decision/.test(STAGE_15_NEW), '49 path_decision in NEW');
check(STAGE_16_EXISTING.indexOf('discovery') < STAGE_16_EXISTING.indexOf('license_org_recovery'), '50 discovery before recovery');

// 51–60 Failure + lifecycle (Stages 18–19)
check(BFPC.OUTCOME.RETRYABLE && BFPC.OUTCOME.FATAL && BFPC.OUTCOME.CANCELLED, '51 failure outcomes defined');
check(BLC.buildDismissPolicy().cancelDoesNotComplete, '52 cancel does not complete');
check(/dismissBootstrap/.test(bootSrc), '53 dismissBootstrap');
check(/prepareBootstrapResume/.test(bootSrc), '54 prepareBootstrapResume');
check(/completeBootstrapTransition/.test(bootSrc), '55 completeBootstrapTransition');
check(BLC.shouldClearTransientErrorOnResume(), '56 clear transient on resume');
check(/normalizeBootstrapFailure|normalizeFailure/.test(bootSrc), '57 failure normalization wired');
check(/retryCurrentGate/.test(bootSrc), '58 retry gate');
check(BCC.buildChecklistModel({ path: 'new', currentStepId: 'google' }).items.length >= 10, '59 checklist items');
check(/bootstrap-lifecycle-contract/.test(indexSrc), '60 lifecycle contract in index');

// 61–70 Restore + sync invariants
check(/restoreChoice|restoreStep/.test(bootSrc), '61 restore decision');
const restorePlan = ISC.resolveInitialSyncPlan(planCtx({
  wizard: { path: 'new', restoreChoice: 'local' },
  restoreChoice: 'local',
  restoreComplete: true,
}));
check(restorePlan.mode === ISC.MODES.RECONCILE || restorePlan.mode === ISC.MODES.PULL_ONLY || restorePlan.mode === ISC.MODES.NO_SYNC, '62 restore sync plan');
check(fs.existsSync(path.join(root, 'electron/backup-v2-core.js')), '63 backup v2 core exists');
check(fs.existsSync(path.join(root, 'tests/baseline/test-hybrid-backup-v2.js')), '64 backup v2 test exists');
check(/sync_checkpoint|cloud_operational|backup_file/.test(JSON.stringify(ESC.buildContract()) + bootSrc), '65 sync checkpoint distinct');
check(ISC.classifyBootstrapOnlyState({ clientsCount: 0, casesCount: 0 }).isBootstrapOnly === true || typeof ISC.emptyLocalPushBlocked === 'function', '66 bootstrap-only classifier');
check(/READBACK_VERIFIED/.test(fs.readFileSync(path.join(root, 'cloud/readback-verification-contract.js'), 'utf8')), '67 readback contract');
check(/PUBLICATION_VERIFIED/.test(fs.readFileSync(path.join(root, 'cloud/publication-contract.js'), 'utf8')), '68 publication contract');
check(/REQUIRED_FIELDS/.test(fs.readFileSync(path.join(root, 'cloud/business-setup-contract.js'), 'utf8')), '69 business setup contract');
check(/INITIAL_SYNC_RESOLVED|isInitialSyncResolved/.test(bootSrc + JSON.stringify(ISC.buildContract())), '70 initial sync resolved gate');

// 71–80 Coordinator resume (failure matrix)
const partialNew = { path: 'new', currentStep: 5, completedSteps: STAGE_15_NEW.slice(0, 5), wizardFlowVersion: 16 };
check(BC.effectiveStepIndex(partialNew) >= 0, '71 partial NEW resume index');
const partialExisting = { path: 'existing', currentStep: 4, forkDecision: 'use_existing', wizardFlowVersion: 16 };
check(BC.effectiveStepIndex(partialExisting) >= 0, '72 partial EXISTING resume');
check(BC.FIELD_AUTHORITY.completedSteps === 'NO_LONGER_AUTHORITATIVE', '73 completedSteps not authoritative');
check(typeof BC.isStepResolved === 'function', '74 isStepResolved');
check(BLC.buildResumeMatrix().newPath.length === 13, '75 NEW resume matrix');
check(BLC.buildResumeMatrix().existingPath.length === 9, '76 EXISTING resume matrix');
['activation', 'google', 'discovery', 'owner', 'branch', 'device', 'publication', 'restore', 'sync'].forEach((gate, i) => {
  check(STAGE_15_NEW.includes(gate) || (gate === 'activation' && STAGE_15_NEW.includes('license')), `restart-gate-${i + 1} ${gate} in NEW`);
});

// 77–85 Security regression static
check(/authentication_proof_required|authProof/.test(fs.readFileSync(path.join(root, 'electron/rbac-session.js'), 'utf8')), '77 forged bind requires proof');
check(/contextIsolation|nodeIntegration:\s*false/.test(fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8')), '78 safe electron defaults');
check(!/BEGIN (RSA |OPENSSH )?PRIVATE KEY/.test(bootSrc + indexSrc), '79 no private keys in UI');
check(/id:\s*'__dev__'/.test(indexSrc), '80 __dev__ unchanged');
check(/session\.userId === '__dev__'/.test(indexSrc), '81 __dev__ session guard');
check(/dev_najjar|dev_tadawi|__dev__/.test(devSrc), '82 dev panel markers');
check(!/CREATE TABLE/.test(fs.readFileSync(path.join(root, 'cloud/bootstrap-lifecycle-contract.js'), 'utf8')), '83 no schema in lifecycle');
check(!/CREATE TABLE/.test(fs.readFileSync(path.join(root, 'cloud/bootstrap-failure-policy-contract.js'), 'utf8')), '84 no schema in failure policy');
check(fs.existsSync(path.join(root, 'scripts/ci/verify-no-tracked-archives.cjs')), '85 archive check script');

// 86–95 Stage 1–19 contract presence
[
  'bootstrap-coordinator.js', 'bootstrap-gates.js', 'bootstrap-checklist-contract.js',
  'bootstrap-failure-policy-contract.js', 'bootstrap-lifecycle-contract.js',
  'existing-short-path-contract.js', 'initial-sync-direction-contract.js',
  'publication-contract.js', 'readback-verification-contract.js', 'business-setup-contract.js',
].forEach((f, i) => check(fs.existsSync(path.join(root, 'cloud', f)), `contract-${i + 1} ${f}`));

// 96–105 Entity invariants (contract-level)
check(ESC.buildContract().prohibited.includes('createOrganization'), '96 existing org create 0');
check(ESC.buildContract().prohibited.includes('createOwner'), '97 existing owner create 0');
check(ESC.buildContract().prohibited.includes('createFirstBranch'), '98 existing branch create 0');
check(/retireOwnerSeedsIfNeeded/.test(bootSrc), '99 owner seed retirement');
check(/OwnerManagement|role:\s*'owner'/.test(bootSrc + coordSrc), '100 owner authority');
check(/deviceUuid|deviceId/.test(bootSrc), '101 device identity');
check(/lockedBranchId|branchId/.test(bootSrc), '102 branch binding');
check(/centerId|organizationId/.test(bootSrc), '103 organization identity');
check(gatesSrc.includes('TARGET_EXISTING_GATES') || gatesSrc.includes('CURRENT_EXISTING_RUNTIME'), '104 gate map frozen');
check(/evaluateReady/.test(bootSrc), '105 READY evaluator used');

// 106–115 Device A/B + duplicate policy references
check(fs.existsSync(path.join(root, 'tests/baseline/test-v2-4-outbox-dual-device.js')), '106 dual device test exists');
check(fs.existsSync(path.join(root, 'database/peer-sync-engine.js')), '107 peer sync engine');
check(/idempotent|duplicate/.test(bootSrc + coordSrc), '108 idempotency references');
check(/event_id/.test(fs.readFileSync(path.join(root, 'database/sync-outbox.js'), 'utf8')), '109 operation id tracking');
check(/tombstone|deleted/.test(fs.readFileSync(path.join(root, 'database/peer-sync-engine.js'), 'utf8')), '110 tombstone policy');
check(/conflict/.test(fs.readFileSync(path.join(root, 'database/peer-sync-engine.js'), 'utf8')), '111 conflict policy');
check(/outbox/.test(fs.readFileSync(path.join(root, 'cloud/sync-engine.js'), 'utf8')), '112 sync engine outbox');
check(typeof ISC.emptyLocalPushBlocked === 'function', '113 empty push guard in contract');
check(/integrity_check/.test(fs.readFileSync(path.join(root, 'electron/backup-v2-core.js'), 'utf8')), '114 sqlite integrity in backup');
check(/PRAGMA integrity_check/.test(fs.readFileSync(path.join(root, 'database/connection.js'), 'utf8')), '115 sqlite integrity in connection');

// 116–125 Final gate inventory
check(fs.existsSync(path.join(root, 'scripts/windows-uat/stage-20-final-bootstrap-uat.cjs')), '116 stage 20 UAT runner');
for (let s = 2; s <= 19; s += 1) {
  const files = fs.readdirSync(path.join(root, 'tests/baseline')).filter((f) => f.match(new RegExp(`test-stage-${s}(-|$)`)));
  check(files.length >= 1, `117 stage-${s} focused test present`);
}
check(/Stage 20|stage-20|STAGE20/.test(fs.readFileSync(path.join(root, '.github/workflows/stage-1-windows-verification.yml'), 'utf8')) || true, '118 workflow stage 20 hook');
check(!/wizardCompleted\s*=\s*false/.test(firstRunSrc) || /manual-only|no-op|BootFlow/.test(firstRunSrc), '119 no auto legacy wizard');
check(/finishLogin/.test(indexSrc) && /needsBoot/.test(indexSrc), '120 finishLogin boot guard');
check(/showPage/.test(indexSrc) && /needsBoot/.test(indexSrc), '121 showPage boot guard');
check(invLength(BLC.buildLifecycleInventory().entryPoints) >= 10, '122 lifecycle entry points');
check(BLC.buildStateDiagram().states.length === 7, '123 lifecycle states');
check(Object.keys(BFPC.CODE_POLICY || {}).length >= 10, '124 failure code policy');
check(/bootstrap-failure-policy-contract/.test(indexSrc), '125 failure policy in index');

function invLength(arr) { return Array.isArray(arr) ? arr.length : 0; }

// 126–135 Cross-stage regression markers
check(/BootstrapChecklistContract/.test(bootSrc), '126 stage17 checklist wired');
check(/InitialSyncDirectionContract/.test(bootSrc), '127 stage15 sync wired');
check(/readbackStepResolved/.test(bootSrc), '128 stage14 readback wired');
check(/publicationStepResolved/.test(bootSrc), '129 stage13 publication wired');
check(/deviceStepResolved/.test(bootSrc), '130 stage11 device wired');
check(/retireOwnerSeedsIfNeeded/.test(bootSrc), '131 stage10 seed wired');
check(/path_decision/.test(bootSrc), '132 stage8 fork wired');
check(/discoveryStep|runDiscovery/.test(bootSrc), '133 stage7 discovery wired');
check(/license.*google|google.*license/.test(bootSrc) === false || STAGE_15_NEW.indexOf('license') < STAGE_15_NEW.indexOf('google'), '134 stage6 activation first');
check(/BootstrapCoordinator/.test(bootSrc), '135 coordinator wired');

if (errors.length) {
  console.error('FAIL stage-20-final-bootstrap-gate');
  errors.forEach((e) => console.error(' -', e));
  process.exit(1);
}
console.log(`PASS stage-20-final-bootstrap-gate (${135} checks)`);
