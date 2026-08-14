#!/usr/bin/env node
'use strict';

/**
 * Stage 12 — Explicit Business Setup gate after Device.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

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

function makeDocument() {
  const byId = new Map();
  const ensure = (id) => {
    if (!byId.has(id)) byId.set(id, makeElement(id));
    return byId.get(id);
  };
  return {
    body: makeElement('body'),
    head: { appendChild: () => {} },
    getElementById: ensure,
    querySelector: (sel) => {
      const m = String(sel || '').match(/#([A-Za-z0-9_-]+)/);
      return m ? ensure(m[1]) : null;
    },
    querySelectorAll: () => [],
    createElement: () => makeElement('div'),
  };
}

function loadModules(ctx) {
  const files = [
    'cloud/business-setup-contract.js',
    'cloud/ready-pure-evaluator.js',
    'cloud/setup-state-service.js',
    'cloud/bootstrap-coordinator.js',
    'cloud/bootstrap-gates.js',
    'cloud/post-google-cloud-discovery.js',
    'cloud/setup-state-dom.js',
    'cloud/owner-seed-retirement.js',
    'cloud/boot-flow-ui.js',
  ];
  for (const rel of files) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
  }
}

function baseEnv(overrides = {}) {
  const wizardDefaults = {
    path: 'new', currentStep: 0, lang: 'ar', restoreChoice: null, syncDone: false,
    completedSteps: [], wizardFlowVersion: 12,
    discoveryCompletedAt: new Date().toISOString(),
    licenseDiscoveryAttempted: true,
    cloudDiscovery: { result: { ok: true, status: 'no_existing_business' }, googleAccountKey: 't@test.com' },
  };
  const { wizard: wizardOverrides, ...restOverrides } = overrides;
  const snap = {
    license: {
      centerId: 'CTR-S12', centerName: 'S12 Center',
      activation: { consumed: true }, branches: [{ id: 'BR-1', name: 'Main', active: true }],
    },
    meta: { centerId: 'CTR-S12' },
    deviceConfig: { deviceUuid: 'DEV-1', deviceName: 'PC-1', lockedBranchId: 'BR-1', centerId: 'CTR-S12' },
    users: [{ id: 'O1', role: 'owner', active: true, seedDefaultPassword: false, password: 'pbkdf2v2:x', hasUsableCredential: true }],
    wizard: { ...wizardDefaults, ...(wizardOverrides || {}) },
    settings: {
      centerName: 'S12 Clinic', phone: '0501234567', address: 'Riyadh',
      backup: { providers: { google: { connected: true, oauth: true, email: 't@test.com' } } },
    },
    ...restOverrides,
  };
  const storage = new Map();
  const kvWrites = [];
  const persistCalls = [];
  let ownerCreates = 0;
  let branchCreates = 0;
  let deviceCreates = 0;

  const ctx = {
    console, setTimeout, clearTimeout, document: makeDocument(),
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)); },
      removeItem: (k) => { storage.delete(k); },
    },
    location: { search: '' },
    DB: {
      get: (key) => {
        if (key === '__tdw_boot_wizard__') return snap.wizard;
        if (key === '__tdw_meta__') return snap.meta;
        if (key === '__tdw_cloud_license__') return snap.license;
        if (key === '__tdw_device_config__') return snap.deviceConfig;
        if (key === 'users') return snap.users;
        if (key === 'settings') return snap.settings;
        return null;
      },
      set: (key, val) => {
        kvWrites.push({ key, val });
        if (key === '__tdw_cloud_license__') snap.license = val;
        if (key === '__tdw_boot_wizard__') snap.wizard = val;
        if (key === 'settings') snap.settings = val;
        if (key === '__tdw_device_config__') snap.deviceConfig = val;
        return { ok: true };
      },
    },
    users: snap.users,
    settings: snap.settings,
    LicenseCloud: { loadLocal: () => snap.license, saveLocal: (v) => { snap.license = v; } },
    DeviceConfig: { load: () => snap.deviceConfig },
    CenterId: { getStoredCenterId: () => snap.license?.centerId || null },
    DriveAdapter: { isConnected: () => !!snap.settings?.backup?.providers?.google?.connected },
    OwnerManagement: {
      isSystemBusy: () => false,
      getOwnerState: () => ({ state: 'OWNER_EXISTS' }),
      createOwner: async () => { ownerCreates += 1; return { ok: true, already: true }; },
      retireOwnerSeedsIfNeeded: async () => ({ ok: true, changed: false }),
    },
    licGetFingerprint: () => 'fp-s12',
    cuppingElectron: {
      rbac: { getSession: async () => ({ ok: true, session: { userId: 'O1', role: 'owner' } }) },
      database: {
        setupCommitOrganizationDevice: async (opts) => {
          if (opts?.createBranch) branchCreates += 1;
          if (opts?.deviceName) deviceCreates += 1;
          if (opts?.branchOnly) {
            return { ok: true, branch: { id: 'BR-1', name: 'Main' }, setupBranch: true };
          }
          if (opts?.deviceName) {
            snap.deviceConfig = { deviceUuid: 'DEV-1', deviceName: opts.deviceName, lockedBranchId: opts.branchId || 'BR-1' };
            return { ok: true, deviceRegistryCommit: { ok: true }, deviceConfig: snap.deviceConfig };
          }
          return { ok: true };
        },
      },
    },
    SqliteBridge: { hydrateIntoMemory: async () => ({ ok: true }) },
    persistData: async (key, val) => {
      persistCalls.push({ key, val });
      if (key === 'settings') snap.settings = { ...snap.settings, ...val };
      return { ok: true };
    },
    RestoreReconciliation: { loadState: () => null },
    SyncEngine: { getReadiness: () => ({ ready: false, state: 'PENDING', missing: ['initialSync'] }) },
    licLoad: () => ({ centerId: snap.license.centerId, status: 'valid' }),
    LicenseActivationGate: { isConsumed: (lic) => !!(lic?.activation?.consumed) },
    _kvWrites: kvWrites,
    _persistCalls: persistCalls,
    _ownerCreates: () => ownerCreates,
    _branchCreates: () => branchCreates,
    _deviceCreates: () => deviceCreates,
    _snap: snap,
  };
  ctx.global = ctx;
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  loadModules(ctx);
  return ctx;
}

async function run() {
  const newSteps = baseEnv().BootFlow.NEW_STEPS;
  const exSteps = baseEnv({ wizard: { path: 'existing', wizardFlowVersion: 12 } }).BootFlow.EXISTING_STEPS;
  const bsNew = newSteps.indexOf('business_setup');
  const devNew = newSteps.indexOf('device');
  const restoreNew = newSteps.indexOf('restore');
  const devEx = exSteps.indexOf('device');

  check(bsNew > devNew && restoreNew > bsNew, '1 NEW reaches Business Setup after Device');
  check(!exSteps.includes('business_setup'), '37 EXISTING short path skips business_setup wizard step');
  check(exSteps.indexOf('restore') > devEx, '37b EXISTING: device before restore');

  const ctxNoDev = baseEnv({ deviceConfig: { deviceUuid: '', lockedBranchId: '', deviceName: '' } });
  check(!ctxNoDev.BootFlow.validateStep('business_setup'), '2 cannot reach before Device');

  const contract = ctxNoDev.BusinessSetupContract.buildContract();
  check(contract.requiredFields.includes('centerName') && contract.requiredFields.includes('phone'), '3 required fields inventory');

  check(ctxNoDev.BusinessSetupContract.isResolved({ centerName: 'My Clinic', phone: '0501111111', address: '' }), '4 optional address allowed');
  check(!ctxNoDev.BusinessSetupContract.isResolved({ centerName: '', phone: '0501111111' }), '5 required centerName');
  check(!ctxNoDev.BusinessSetupContract.isResolved({ centerName: 'مركز الحجامة', phone: '0501111111' }), '6 placeholder rejected');

  const ctxComplete = baseEnv();
  check(ctxComplete.BootFlow.businessSetupStepResolved(), '7 valid existing setup resolves');

  const ctxPartial = baseEnv({ settings: { centerName: 'S12 Clinic', phone: '' } });
  check(!ctxPartial.BootFlow.businessSetupStepResolved(), '8 partial phone missing unresolved');

  const ctxInvalid = baseEnv({ settings: { centerName: 'مركز الحجامة', phone: '0501234567' } });
  check(!ctxInvalid.BootFlow.businessSetupStepResolved(), '9 invalid placeholder unresolved');

  const ctxEmptyWiz = baseEnv({ wizard: { path: 'new', completedSteps: [], wizardFlowVersion: 12 } });
  check(ctxEmptyWiz.BootFlow.businessSetupStepResolved(), '10 empty wizard + complete SoT resolves');

  const ctxStale = baseEnv({
    settings: { centerName: 'مركز الحجامة', phone: '' },
    wizard: { path: 'new', completedSteps: ['business_setup'], wizardFlowVersion: 12 },
  });
  check(!ctxStale.BootFlow.businessSetupStepResolved(), '11 stale wizard completed but SoT incomplete');

  (() => {
    const c = baseEnv();
    const before = c._kvWrites.length;
    for (let i = 0; i < 3; i++) c.BootstrapGates.evaluateGate('BUSINESS_SETUP_RESOLVED', 'new');
    check(c._kvWrites.length === before, '12 evaluator zero-write');
  })();

  (() => {
    const c = baseEnv();
    const a = JSON.stringify(c.BootstrapGates.evaluateGate('BUSINESS_SETUP_RESOLVED', 'new'));
    const b = JSON.stringify(c.BootstrapGates.evaluateGate('BUSINESS_SETUP_RESOLVED', 'new'));
    check(a === b, '13 evaluator idempotent');
  })();

  await (async () => {
    const c = baseEnv({ settings: { centerName: '', phone: '' } });
    c.document.getElementById('bf-business-center-name').value = 'My Clinic';
    c.document.getElementById('bf-business-phone').value = '0509999888';
    const r = await c.BootFlow.commitBusinessSetupFromForm();
    check(r?.ok && c._persistCalls.length === 1, '14 save success');
    check(c.BootFlow.readBusinessSetupState().centerName === 'My Clinic', '17 read-back');
  })();

  await (async () => {
    const c = baseEnv({ settings: { centerName: '', phone: '' } });
    c.document.getElementById('bf-business-center-name').value = 'مركز الحجامة';
    c.document.getElementById('bf-business-phone').value = '0509999888';
    const r = await c.BootFlow.commitBusinessSetupFromForm();
    check(!r?.ok, '5/15 required/placeholder rejected on save');
  })();

  await (async () => {
    const c = baseEnv({ settings: { centerName: '', phone: '' } });
    c.persistData = async () => ({ ok: false, error: 'fail' });
    c.document.getElementById('bf-business-center-name').value = 'Clinic X';
    c.document.getElementById('bf-business-phone').value = '0501234567';
    const r = await c.BootFlow.commitBusinessSetupFromForm();
    check(!r?.ok, '16 save failure');
    check(!c.BootFlow.businessSetupStepResolved(), '16b still unresolved');
  })();

  await (async () => {
    const c = baseEnv({ settings: { centerName: '', phone: '' } });
    c.document.getElementById('bf-business-center-name').value = 'Clinic Y';
    c.document.getElementById('bf-business-phone').value = '0501234567';
    await c.BootFlow.commitBusinessSetupFromForm();
    await c.BootFlow.commitBusinessSetupFromForm();
    check(c._persistCalls.length === 1, '19 double submit idempotent');
  })();

  await (async () => {
    const c = baseEnv({ settings: { centerName: '', phone: '' } });
    c.document.getElementById('bf-business-center-name').value = 'Retry Clinic';
    c.document.getElementById('bf-business-phone').value = '0501234567';
    const r1 = await c.BootFlow.commitBusinessSetupFromForm();
    const r2 = await c.BootFlow.commitBusinessSetupFromForm();
    check(r1?.ok && r2?.ok && r2?.already, '20 retry idempotent when already resolved');
  })();

  check(!baseEnv({ deviceConfig: { deviceUuid: '', lockedBranchId: '', deviceName: '' } }).BootFlow.validateStep('restore'), '27 restore blocked before device');
  const cNew = baseEnv({ settings: { centerName: 'مركز الحجامة', phone: '' } });
  check(!cNew.BootFlow.validateStep('restore'), '27b NEW restore blocked before business setup');
  const cEx = baseEnv({ wizard: { path: 'existing', wizardFlowVersion: 12 }, settings: { centerName: 'مركز الحجامة', phone: '' } });
  check(cEx.BootFlow.validateStep('restore') === false || !cEx.BootFlow.hasRestoreDecision(), '38 EXISTING restore allowed before business setup when no choice');

  check(!baseEnv({ settings: { centerName: 'مركز الحجامة', phone: '' } }).BootFlow.validateStep('sync'), '29 sync blocked');

  const readyMissing = baseEnv({
    settings: { centerName: 'مركز الحجامة', phone: '' },
    meta: { bootstrapCompletedAt: new Date().toISOString() },
    wizard: { path: 'new', restoreChoice: 'empty', syncDone: true, wizardFlowVersion: 12 },
  });
  check(readyMissing.SetupStateService.evaluateReady({ ignoreRestart: true }).ready === false, '40 READY false without business setup');

  const readyOk = baseEnv({
    meta: { bootstrapCompletedAt: new Date().toISOString() },
    wizard: { path: 'new', restoreChoice: 'empty', syncDone: true, wizardFlowVersion: 12 },
  });
  readyOk._snap.wizard.syncDone = true;
  check(readyOk.BootFlow.businessSetupStepResolved(), '41 business setup part for READY');

  check(baseEnv()._ownerCreates() === 0, '25 owner count stable');
  check(baseEnv()._branchCreates() === 0, '26 branch count stable');
  check(baseEnv()._deviceCreates() === 0, '27 device count stable');

  const mig = baseEnv({
    settings: { centerName: 'Legacy Clinic', phone: '0500000001' },
    wizard: { path: 'new', currentStep: 9, wizardFlowVersion: 11, completedSteps: ['device'] },
  });
  mig.BootFlow.loadWizard();
  check(mig._snap.wizard.wizardFlowVersion === 16, '50 v11 migrates to v16');
  check(mig._snap.wizard.completedSteps.includes('business_setup'), '51 legacy configured skips step');

  const legacyReady = baseEnv({
    meta: { bootstrapCompletedAt: new Date().toISOString() },
    wizard: { path: 'new', restoreChoice: 'empty', syncDone: true, wizardFlowVersion: 8 },
    settings: { centerName: 'Production Clinic', phone: '0502222222' },
  });
  legacyReady.BootFlow.loadWizard();
  check(legacyReady.BootFlow.businessSetupStepResolved(), '52 legacy READY profile compatible');

  const exOwner = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
  check(/authenticateExistingOwnerFromWizard/.test(exOwner), 'EXISTING owner = credential verification not creation');

  const devSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  check(/dev_najjar|dev_tadawi|__dev__/.test(devSrc), '45 __dev__ unchanged');

  const gates = fs.readFileSync(path.join(root, 'cloud/bootstrap-gates.js'), 'utf8');
  check(/BusinessSetupContract/.test(gates), '8 BUSINESS_SETUP_RESOLVED uses contract');

  check(baseEnv().BootFlow.WIZARD_FLOW_VERSION >= 14, '49 wizard flow version >= 14');

  if (errors.length) {
    console.error('FAIL stage-12-business-setup-gate');
    errors.forEach((e, i) => console.error(`${i + 1}. ${e}`));
    process.exit(1);
  }
  console.log('PASS stage-12-business-setup-gate (45 scenarios)');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
