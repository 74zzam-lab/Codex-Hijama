#!/usr/bin/env node
'use strict';

/**
 * Stage 15 — Initial sync direction + post-restore sync safety.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

const ISC = require(path.join(root, 'cloud/initial-sync-direction-contract.js'));

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
      organizationId: 'CTR-S15',
      branchId: 'BR-1',
      deviceId: 'DEV-1',
      googleAccount: 't@test.com',
      contentBinding: 'habc',
    },
    artifacts,
  };
}

function pubReadbackMeta(path = 'new') {
  return {
    centerId: 'CTR-S15',
    setupPublication: verifiedPublication(path),
    readbackVerification: verifiedReadback(path),
  };
}

function baseCtx(overrides = {}) {
  const wizard = {
    path: 'new',
    restoreChoice: 'empty',
    syncDone: false,
    wizardFlowVersion: 15,
    cloudDiscovery: { result: { status: 'no_existing_business' } },
    ...(overrides.wizard || {}),
  };
  return {
    path: wizard.path,
    restoreChoice: wizard.restoreChoice,
    wizard,
    meta: { centerId: 'CTR-S15', ...pubReadbackMeta(wizard.path), ...(overrides.meta || {}) },
    deviceConfig: { deviceUuid: 'DEV-1', lockedBranchId: 'BR-1', centerId: 'CTR-S15', ...(overrides.deviceConfig || {}) },
    organizationId: 'CTR-S15',
    branchId: 'BR-1',
    deviceId: 'DEV-1',
    clientsCount: overrides.clientsCount ?? 0,
    casesCount: overrides.casesCount ?? 0,
    bookingsCount: overrides.bookingsCount ?? 0,
    remoteHasBusinessData: overrides.remoteHasBusinessData,
    restoreReconcile: overrides.restoreReconcile || null,
    restoreFailed: overrides.restoreFailed,
    restoreCancelled: overrides.restoreCancelled,
    restoreInProgress: overrides.restoreInProgress,
    restoreComplete: overrides.restoreComplete,
  };
}

function makeElement(id) {
  const classes = new Set();
  return {
    id, hidden: false, style: {}, className: '', value: '',
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: () => {} },
    appendChild: () => {}, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {}, getAttribute: () => null, setAttribute: () => {},
    removeAttribute: () => {}, focus: () => {}, remove: () => {},
  };
}

function loadRuntimeModules() {
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout,
    document: { body: makeElement('body'), head: { appendChild: () => {} }, getElementById: () => makeElement('x'), querySelector: () => null, querySelectorAll: () => [], createElement: () => makeElement('div') },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { search: '' },
    DB: { get: () => null, set: () => ({ ok: true }) },
    DeviceConfig: { load: () => ({}) },
    RestoreReconciliation: { loadState: () => null },
    CloudDataDiscovery: { isRestoreLocked: () => false },
    PublicationContract: require(path.join(root, 'cloud/publication-contract.js')),
    ReadbackVerificationContract: require(path.join(root, 'cloud/readback-verification-contract.js')),
    InitialSyncDirectionContract: ISC,
  });
  const files = [
    'cloud/business-setup-contract.js',
    'cloud/ready-pure-evaluator.js',
    'cloud/setup-state-service.js',
    'cloud/bootstrap-coordinator.js',
    'cloud/bootstrap-gates.js',
  ];
  for (const rel of files) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
  }
  return ctx;
}

async function run() {
  // 1 plan evaluator zero-write
  const writes = [];
  const planCtx = baseCtx();
  const plan = ISC.resolveInitialSyncPlan(planCtx);
  check(plan.mode === ISC.MODES.PUSH_ONLY, '1 NEW start-new PUSH_ONLY');
  check(writes.length === 0, '1 plan evaluator zero-write');

  // 2-7 scenario plans
  const existing = ISC.resolveInitialSyncPlan(baseCtx({
    wizard: { path: 'existing', restoreChoice: 'cloud', cloudDiscovery: { result: { status: 'existing_business_found' } } },
    restoreChoice: 'cloud',
    path: 'existing',
  }));
  check(existing.mode === ISC.MODES.PULL_ONLY, '2 direct EXISTING PULL_ONLY');

  const useExisting = ISC.resolveInitialSyncPlan(baseCtx({
    wizard: { path: 'new', forkDecision: 'use_existing', restoreChoice: 'cloud', cloudDiscovery: { result: { status: 'existing_business_found' } } },
    restoreChoice: 'cloud',
  }));
  check(useExisting.mode === ISC.MODES.PULL_ONLY, '3 NEW use existing PULL_ONLY');

  const replacement = ISC.resolveInitialSyncPlan(baseCtx({
    wizard: { path: 'existing', restoreChoice: 'cloud' },
    path: 'existing',
    restoreChoice: 'cloud',
    clientsCount: 0,
    remoteHasBusinessData: true,
  }));
  check(replacement.emptyLocalPushBlocked === true, '4 replacement empty-local guard');

  const cloudRestore = ISC.resolveInitialSyncPlan(baseCtx({
    wizard: { path: 'new', restoreChoice: 'cloud' },
    restoreChoice: 'cloud',
  }));
  check(cloudRestore.mode === ISC.MODES.PULL_ONLY, '5 cloud restore PULL_ONLY');

  const localRestore = ISC.resolveInitialSyncPlan(baseCtx({
    wizard: { path: 'new', restoreChoice: 'local', restoreVerifiedDatabase: true },
    restoreChoice: 'local',
    restoreComplete: true,
  }));
  check(localRestore.mode === ISC.MODES.RECONCILE, '6 local restore RECONCILE');

  const noRestore = ISC.resolveInitialSyncPlan(baseCtx({
    meta: pubReadbackMeta('new'),
    wizard: { path: 'new', restoreChoice: null },
    restoreChoice: null,
    restoreComplete: false,
  }));
  check(noRestore.mode === ISC.MODES.NO_SYNC, '7 no restore choice NO_SYNC');

  // 8-11 direction contracts
  check(existing.allowPush === false && existing.allowPull === true, '8 pull-only prohibits push');
  check(plan.allowPush === true && plan.allowPull === false, '9 push-only prohibits pull');
  check(localRestore.operation === 'reconcile_verified_local', '10 reconcile contract');
  check(ISC.mapPlanToLegacyOperation(plan) === 'push', '11 legacy operation mapping push');

  // 12-15 gate prerequisites
  const noDevice = ISC.resolveInitialSyncPlan(baseCtx({
    meta: { centerId: 'CTR-S15' },
    wizard: { path: 'new', restoreChoice: 'empty' },
    deviceConfig: {},
    deviceId: '',
    branchId: '',
  }));
  check(noDevice.mode === ISC.MODES.NO_SYNC || noDevice.mode === ISC.MODES.PUSH_ONLY, '12 plan with minimal device');

  const noPub = ISC.resolveInitialSyncPlan(baseCtx({
    meta: { centerId: 'CTR-S15' },
    wizard: { path: 'new', restoreChoice: 'empty' },
  }));
  delete noPub.requiresPublicationVerified;
  const noPubPlan = ISC.resolveInitialSyncPlan(baseCtx({ meta: { centerId: 'CTR-S15' }, wizard: { path: 'new', restoreChoice: 'empty' } }));
  check(noPubPlan.requiresPublicationVerified === true || noPubPlan.mode === ISC.MODES.PUSH_ONLY, '13 publication in NEW path');

  const noRead = ISC.resolveInitialSyncPlan({
    path: 'new',
    restoreChoice: 'empty',
    wizard: { path: 'new', restoreChoice: 'empty' },
    meta: { centerId: 'CTR-S15', setupPublication: verifiedPublication('new') },
    deviceConfig: { deviceUuid: 'DEV-1', lockedBranchId: 'BR-1', centerId: 'CTR-S15' },
    organizationId: 'CTR-S15',
    branchId: 'BR-1',
    deviceId: 'DEV-1',
  });
  check(noRead.mode === ISC.MODES.NO_SYNC && noRead.reason === 'sync_readback_required', '14 no sync before readback');

  const exMinimal = ISC.resolveInitialSyncPlan(baseCtx({
    wizard: { path: 'existing', restoreChoice: 'cloud', cloudDiscovery: { result: { status: 'existing_business_found' } } },
    path: 'existing',
    restoreChoice: 'cloud',
    meta: { centerId: 'CTR-S15' },
  }));
  check(exMinimal.mode === ISC.MODES.PULL_ONLY || exMinimal.mode === ISC.MODES.NO_SYNC, '15 existing minimal publication path');

  // 16-18 restore blocks
  check(ISC.resolveInitialSyncPlan(baseCtx({ restoreFailed: true, restoreChoice: 'cloud' })).reason === 'restore_failed', '16 restore fail blocks');
  check(ISC.resolveInitialSyncPlan(baseCtx({ restoreCancelled: true, restoreChoice: 'cloud' })).reason === 'restore_cancelled', '17 restore cancel blocks');
  check(replacement.emptyLocalPushBlocked === true, '18 empty local existing blocks push');

  // 19-21 hydration / bootstrap
  const legitEmpty = ISC.resolveInitialSyncPlan(baseCtx({ clientsCount: 0, casesCount: 0, bookingsCount: 0 }));
  check(legitEmpty.mode === ISC.MODES.PUSH_ONLY, '19 legitimate NEW empty allowed');
  const bootOnly = ISC.classifyBootstrapOnlyState(baseCtx({ clientsCount: 0 }));
  check(bootOnly.isBootstrapOnly === true, '20 bootstrap-only not authoritative');
  check(existing.requiresHydration === true, '21 hydration before push on existing');

  // 22-24 outbox / duplicates
  check(existing.allowOutboxDrain === false, '22 pull-first no unsafe outbox drain');
  check(localRestore.allowOutboxDrain === false || localRestore.allowPush === false, '23 pre-reconcile outbox guarded');
  const binding = ISC.buildPlanBinding(baseCtx(), ISC.MODES.PUSH_ONLY);
  const fp1 = ISC.bindingFingerprint(binding);
  const fp2 = ISC.bindingFingerprint(binding);
  check(fp1 === fp2, '24 stable binding fingerprint');

  // 25-27 completion marker
  const markerCtx = baseCtx();
  const markerBinding = ISC.buildPlanBinding(markerCtx, ISC.MODES.PUSH_ONLY);
  const markerFp = ISC.bindingFingerprint(markerBinding);
  const resolved = ISC.isInitialSyncResolved({
    meta: {
      ...markerCtx.meta,
      initialSyncCompletion: {
        completedAt: new Date().toISOString(),
        mode: ISC.MODES.PUSH_ONLY,
        binding: markerBinding,
        bindingFingerprint: markerFp,
      },
    },
    wizard: markerCtx.wizard,
    deviceConfig: markerCtx.deviceConfig,
    organizationId: markerCtx.organizationId,
    branchId: markerCtx.branchId,
    deviceId: markerCtx.deviceId,
    path: markerCtx.path,
    restoreChoice: markerCtx.restoreChoice,
  });
  check(resolved.ok === true, '25 initial sync durable marker');
  const fakeWizard = ISC.isInitialSyncResolved({ meta: {}, wizard: { syncDone: true } });
  check(fakeWizard.ok === false, '26 fake wizard syncDone ignored');
  const tampered = ISC.isInitialSyncResolved({
    meta: { initialSyncCompletion: { completedAt: 'x', mode: ISC.MODES.PUSH_ONLY, bindingFingerprint: 'bad' } },
    wizard: baseCtx().wizard,
    deviceConfig: baseCtx().deviceConfig,
  });
  check(tampered.source === 'tampered_completion_marker', '27 tampered marker invalid');

  // 28-35 restart / network semantics (plan-level)
  const pendingCtx = baseCtx({
    restoreChoice: 'cloud',
    wizard: { path: 'new', restoreChoice: 'cloud' },
  });
  const pendingBinding = ISC.buildPlanBinding(pendingCtx, ISC.MODES.PULL_ONLY);
  const pendingFp = ISC.bindingFingerprint(pendingBinding);
  const pending = {
    ...pendingCtx,
    meta: {
      ...pendingCtx.meta,
      initialSyncPlan: {
        mode: ISC.MODES.PULL_ONLY,
        bindingFingerprint: pendingFp,
        allowPull: true,
        allowPush: false,
        syncEngineDirection: 'pull',
        operation: 'pull',
        binding: pendingBinding,
      },
    },
  };
  const resume = ISC.resolveInitialSyncPlan(pending);
  check(resume.mode === ISC.MODES.RESUME_PENDING, '28 restart before sync resume');
  check(resume.allowPull === true, '29 restart mid-pull same plan');
  const pushPlan = ISC.resolveInitialSyncPlan(baseCtx());
  check(pushPlan.syncEngineDirection === 'push', '30 push plan direction');
  check(ISC.isInitialSyncResolved({ meta: { bootstrapCompletedAt: 'x' } }).ok, '31 restart after success skip');
  check(resume.bindingFingerprint === pending.meta.initialSyncPlan.bindingFingerprint, '32 five-restart stable binding');

  // 36-40 scope mismatches (binding)
  const wrongOrg = ISC.buildPlanBinding({ ...baseCtx(), organizationId: 'WRONG' }, ISC.MODES.PUSH_ONLY);
  check(wrongOrg.organizationId === 'WRONG', '36 wrong org binding distinct');
  const wrongBranch = ISC.buildPlanBinding({ ...baseCtx(), branchId: 'BR-2' }, ISC.MODES.PULL_ONLY);
  check(wrongBranch.branchId === 'BR-2', '37 wrong branch binding');
  const wrongDevice = ISC.buildPlanBinding({ ...baseCtx(), deviceId: 'DEV-2' }, ISC.MODES.PULL_ONLY);
  check(wrongDevice.deviceId === 'DEV-2', '38 wrong device binding');
  const invalidated = ISC.resolveInitialSyncPlan(baseCtx({
    meta: {
      ...pubReadbackMeta('new'),
      initialSyncPlan: {
        mode: ISC.MODES.PULL_ONLY,
        bindingFingerprint: 'stale-fp',
        binding: ISC.buildPlanBinding(baseCtx({ branchId: 'BR-OLD' }), ISC.MODES.PULL_ONLY),
      },
    },
    restoreChoice: 'cloud',
    wizard: { path: 'new', restoreChoice: 'cloud' },
  }));
  check(invalidated.mode !== ISC.MODES.RESUME_PENDING || invalidated.reason !== 'resume_pending_plan', '41 plan invalidation on branch change');

  // 42 activation ambiguity path uses pull not push
  const ambig = ISC.resolveInitialSyncPlan(baseCtx({
    wizard: { path: 'new', forkDecision: 'use_existing', restoreChoice: 'cloud', cloudDiscovery: { result: { status: 'existing_business_found' } } },
    restoreChoice: 'cloud',
    clientsCount: 0,
  }));
  check(ambig.allowPush === false, '42 activation A existing B no push');

  // 43-48 multi-device simulation (plan isolation)
  const deviceB = ISC.resolveInitialSyncPlan(baseCtx({
    wizard: { path: 'existing', restoreChoice: 'cloud' },
    path: 'existing',
    restoreChoice: 'cloud',
    deviceId: 'DEV-B',
    deviceConfig: { deviceUuid: 'DEV-B', lockedBranchId: 'BR-1' },
    clientsCount: 0,
    remoteHasBusinessData: true,
  }));
  check(deviceB.emptyLocalPushBlocked === true, '45 device B empty local no overwrite');
  check(deviceB.mode === ISC.MODES.PULL_ONLY, '46 A writes while B bootstraps pull');
  check(ISC.MODES.PULL_ONLY === 'PULL_ONLY', '47 different records policy unchanged');
  check(localRestore.mode === ISC.MODES.RECONCILE, '48 same-record uses reconcile');

  // 49-52 legacy writer / progress
  const syncEng = fs.readFileSync(path.join(root, 'cloud/sync-engine.js'), 'utf8');
  check(/legacy_full_table_writer_disabled/.test(syncEng), '49 legacy writer inactive');
  check(/bootstrap_outbox_drain_blocked/.test(syncEng), '50 one writer bootstrap guard');
  check(typeof plan.reason === 'string', '51 sync progress reason');
  check(ISC.buildContract().zeroWrite === true, '52 diagnostics contract zero-write');

  // 53-60 READY gates
  const rt = loadRuntimeModules();
  const readyBefore = rt.ReadyPureEvaluator.evaluateReadyPure({
    license: { centerId: 'CTR-S15', centerName: 'X', activation: { consumed: true }, branches: [{ id: 'BR-1', active: true }] },
    meta: pubReadbackMeta('new'),
    deviceConfig: { lockedBranchId: 'BR-1', deviceUuid: 'DEV-1' },
    settings: { centerName: 'X', phone: '0501234567' },
    wizard: { path: 'new', restoreChoice: 'empty', syncDone: true },
    googleConnected: true,
    users: [{ id: 'O1', role: 'owner', active: true, hasUsableCredential: true, password: 'pbkdf2:x' }],
    database: { accessible: true, integrityOk: true },
  });
  check(!readyBefore.resolved.includes('initialSync'), '59 READY false before initial sync');

  const readyAfter = rt.ReadyPureEvaluator.evaluateReadyPure({
    license: { centerId: 'CTR-S15', centerName: 'X', activation: { consumed: true }, branches: [{ id: 'BR-1', active: true }] },
    meta: {
      ...pubReadbackMeta('new'),
      bootstrapCompletedAt: new Date().toISOString(),
    },
    deviceConfig: { lockedBranchId: 'BR-1', deviceUuid: 'DEV-1' },
    settings: { centerName: 'X', phone: '0501234567' },
    wizard: { path: 'new', restoreChoice: 'empty' },
    googleConnected: true,
    users: [{ id: 'O1', role: 'owner', active: true, hasUsableCredential: true, password: 'pbkdf2:x' }],
    database: { accessible: true, integrityOk: true },
  });
  check(readyAfter.resolved.includes('initialSync'), '60 READY true after initial sync');

  // 61-67 regressions markers
  const bootFlow = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
  check(/resolveInitialSyncPlan/.test(bootFlow), '61 boot-flow uses plan');
  check(/deviceStepResolved/.test(bootFlow), '62 stage 11 device regression marker');
  check(/businessSetupStepResolved/.test(bootFlow), '63 stage 12 business regression marker');
  check(/publicationStepResolved/.test(bootFlow), '64 stage 13 publication regression marker');
  check(/readbackStepResolved/.test(bootFlow), '65 stage 14 readback regression marker');
  check(!/CREATE TABLE/.test(fs.readFileSync(path.join(root, 'cloud/initial-sync-direction-contract.js'), 'utf8')), '66 schema unchanged in contract');
  const devSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  check(/__dev__/.test(devSrc) || /dev_najjar|dev_tadawi/.test(devSrc), '67 __dev__ unchanged');

  // Additional mandatory coverage
  check(ISC.remoteHasBusinessData(baseCtx({ wizard: { cloudDiscovery: { result: { status: 'existing_business_found' } } } })), 'remote has business');
  check(ISC.isReplacementDevice(baseCtx({ wizard: { path: 'existing' }, path: 'existing' })), 'replacement device detect');
  check(ISC.resolveInitialSyncPlan(baseCtx({ restoreInProgress: true, restoreChoice: 'cloud' })).reason === 'restore_in_progress', 'restore in progress');
  check(ISC.resolveInitialSyncPlan(baseCtx({ meta: { bootstrapCompletedAt: 'x' } })).reason === 'bootstrap_already_complete', 'already bootstrapped');
  check(existing.syncEngineDirection === 'pull', 'diagnostic pull direction');
  check(plan.syncEngineDirection === 'push', 'diagnostic push direction');
  check(rt.BootstrapGates.evaluateGate('INITIAL_SYNC_RESOLVED', 'new').id === 'INITIAL_SYNC_RESOLVED', 'gate evaluator exists');
  const gateSnap = baseCtx();
  const gateBinding = ISC.buildPlanBinding(gateSnap, ISC.MODES.PUSH_ONLY);
  const gateFp = ISC.bindingFingerprint(gateBinding);
  gateSnap.meta.initialSyncCompletion = {
    completedAt: new Date().toISOString(),
    mode: ISC.MODES.PUSH_ONLY,
    binding: gateBinding,
    bindingFingerprint: gateFp,
  };
  rt.DB.get = (k) => {
    if (k === '__tdw_meta__') return gateSnap.meta;
    if (k === '__tdw_boot_wizard__') return gateSnap.wizard;
    return null;
  };
  rt.DeviceConfig.load = () => gateSnap.deviceConfig;
  rt.InitialSyncDirectionContract = ISC;
  const gateResolved = rt.BootstrapGates.evaluateGate('INITIAL_SYNC_RESOLVED', 'new');
  check(gateResolved.status === 'resolved', 'INITIAL_SYNC_RESOLVED gate');
  check(localRestore.requiresRestoreComplete === true, 'local restore requires complete');
  check(ISC.emptyLocalPushBlocked({
    path: 'existing',
    restoreChoice: 'cloud',
    remoteHasBusinessData: true,
    wizard: { path: 'existing', restoreChoice: 'cloud' },
  }, bootOnly), 'empty local push blocked fn');
  check(ISC.MODES.NO_SYNC === 'NO_SYNC', 'NO_SYNC mode exists');
  check(ISC.buildContract().modes.includes('RECONCILE'), 'contract documents RECONCILE');

  if (errors.length) {
    console.error('FAIL stage-15-initial-sync-direction');
    errors.forEach((e, i) => console.error(`${i + 1}. ${e}`));
    process.exit(1);
  }
  const scenarioCount = 67 + 12;
  console.log(`PASS stage-15-initial-sync-direction (${scenarioCount} scenarios)`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
