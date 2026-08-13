#!/usr/bin/env node
'use strict';

/**
 * Stage 4 — Bootstrap Coordinator State slimming.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BC = require('../../cloud/bootstrap-coordinator');

const root = path.join(__dirname, '../..');
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

function makeElement(id) {
  const classes = new Set();
  return {
    id, hidden: false, style: {}, className: '',
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c), toggle: () => {},
    },
    appendChild: () => {}, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {}, getAttribute: () => null, setAttribute: () => {},
    removeAttribute: () => {}, focus: () => {}, remove: () => {},
  };
}

function makeDocument() {
  const byId = new Map();
  return {
    body: makeElement('body'),
    head: { appendChild: () => {} },
    getElementById: (id) => {
      if (!byId.has(id)) byId.set(id, makeElement(id));
      return byId.get(id);
    },
    querySelector: () => null,
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
    'cloud/setup-state-dom.js',
    'cloud/boot-flow-ui.js',
  ];
  for (const rel of files) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
  }
}

function readyEnv(overrides = {}) {
  const {
    SyncEngine: syncEngineOverride,
    OwnerManagement: ownerManagementOverride,
    DriveAdapter: driveAdapterOverride,
    ...snapOverrides
  } = overrides;
  const snap = {
    license: {
      centerId: 'CTR-S4', centerName: 'S4 Center',
      branches: [{ id: 'BR-1', name: 'Main', active: true }],
      activation: { consumed: true },
    },
    meta: { centerId: 'CTR-S4', bootstrapCompletedAt: new Date().toISOString() },
    deviceConfig: { deviceUuid: 'DEV-S4', deviceName: 'D', lockedBranchId: 'BR-1', branchLocked: true },
    users: [{ id: 'O1', role: 'owner', active: true, hasUsableCredential: true, password: 'pbkdf2:x' }],
    wizard: {
      path: 'new', currentStep: 0, restoreChoice: 'empty', syncDone: false, completedSteps: [], wizardFlowVersion: 12,
      discoveryCompletedAt: new Date().toISOString(),
      licenseDiscoveryAttempted: true,
      cloudDiscovery: { result: { ok: true, status: 'no_existing_business' }, googleAccountKey: null },
    },
    settings: { centerName: 'S4 Center', phone: '0501234567', backup: { providers: { google: { connected: true, oauth: true } } } },
    ...snapOverrides,
  };
  const storage = new Map();
  const kvWrites = [];
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
      set: (key, val) => { kvWrites.push({ key, val }); return { ok: true }; },
    },
    users: snap.users,
    settings: snap.settings,
    _licStatus: 'valid',
    LicenseCloud: { loadLocal: () => snap.license },
    DeviceConfig: { load: () => snap.deviceConfig },
    CenterId: { getStoredCenterId: () => snap.license.centerId },
    DriveAdapter: driveAdapterOverride || { isConnected: () => true },
    CloudDataDiscovery: { isRestoreLocked: () => false },
    OwnerManagement: ownerManagementOverride || { isSystemBusy: () => false, getOwnerState: () => ({ state: 'OWNER_EXISTS' }) },
    RestoreReconciliation: { loadState: () => null },
    SyncEngine: syncEngineOverride || { getReadiness: () => ({ ready: true, state: 'READY', missing: [] }) },
    licLoad: () => ({ centerId: 'CTR-S4', status: 'valid' }),
    LicenseActivationGate: { isConsumed: () => true },
    notify: () => {},
    AuditLogger: { logSyncEvent: () => {} },
    _kvWrites: kvWrites,
    _snap: snap,
  };
  ctx.global = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  loadModules(ctx);
  return ctx;
}

// 1. READY without wizard KV
(() => {
  const ctx = readyEnv({ wizard: null });
  check(ctx.SetupStateService.evaluateReady({ ignoreRestart: true }).ready === true, 'READY without wizard KV');
  check(ctx.BootFlow.shouldAutoOpenBoot() === false, 'READY no wizard: no auto boot');
})();

// 2. READY with corrupted wizard KV
(() => {
  const ctx = readyEnv({ wizard: { path: 'new', currentStep: 999, completedSteps: 'bad', syncDone: true } });
  check(ctx.SetupStateService.evaluateReady({ ignoreRestart: true }).ready === true, 'READY corrupt wizard still READY');
  check(ctx.BootFlow.shouldAutoOpenBoot() === false, 'READY corrupt wizard: no auto boot');
})();

// 3. NOT READY without wizard KV
(() => {
  const ctx = readyEnv({
    wizard: null,
    deviceConfig: { deviceUuid: '', lockedBranchId: '', deviceName: '' },
    meta: {},
    users: [],
  });
  check(ctx.SetupStateService.evaluateReady({ ignoreRestart: true }).ready === false, 'NOT READY without wizard');
  check(ctx.BootFlow.shouldAutoOpenBoot() === true, 'NOT READY: boot allowed');
})();

// 4. False completion flags cannot fake SoT
(() => {
  const ctx = readyEnv({
    deviceConfig: { deviceUuid: '', lockedBranchId: '', deviceName: '' },
    meta: {},
    users: [],
    SyncEngine: { getReadiness: () => ({ ready: false, state: 'PENDING', missing: ['device'] }) },
    wizard: {
      path: 'new', currentStep: 8,
      completedSteps: ['language', 'google', 'license', 'organization', 'branch', 'restore', 'owner', 'sync', 'ready'],
      syncDone: true, restoreChoice: 'empty', wizardFlowVersion: 9,
    },
  });
  check(ctx.SetupStateService.evaluateReady({ ignoreRestart: true }).ready === false,
    'fake completion flags do not yield READY');
  check(ctx.BootFlow.hasSyncDone() === false, 'fake syncDone not authoritative');
})();

// 5. False incomplete flags cannot override complete SoT
(() => {
  const ctx = readyEnv({
    wizard: { path: 'new', currentStep: 0, completedSteps: [], syncDone: false, restoreChoice: null, wizardFlowVersion: 6 },
  });
  check(ctx.SetupStateService.evaluateReady({ ignoreRestart: true }).ready === true, 'complete SoT despite empty wizard flags');
  check(ctx.BootFlow.shouldAutoOpenBoot() === false, 'complete SoT: login path');
})();

// 6–8. Owner/branch/device derived from services
(() => {
  const ctx = readyEnv({
    users: [],
    OwnerManagement: { isSystemBusy: () => false, getOwnerState: () => ({ state: 'OWNER_MISSING' }) },
  });
  check(ctx.BootstrapCoordinator.getDerivedGates().ownerResolved === false, 'owner derived from service');
  const ctx2 = readyEnv({
    license: { centerId: 'CTR', branches: [], activation: { consumed: true } },
    deviceConfig: { deviceUuid: 'x', deviceName: 'n', lockedBranchId: '', branchLocked: false },
  });
  check(ctx2.BootstrapCoordinator.getDerivedGates().branchResolved === false, 'branch derived from service');
  const ctx3 = readyEnv({ deviceConfig: { deviceUuid: '', lockedBranchId: '', deviceName: '' } });
  check(ctx3.BootstrapCoordinator.getDerivedGates().deviceResolved === false, 'device derived from service');
})();

// 9. Google not trusted from stale wizard flag
(() => {
  const ctx = readyEnv({
    settings: { centerName: 'S4', backup: { providers: { google: { connected: false, userDisconnected: true } } } },
    DriveAdapter: { isConnected: () => false },
    wizard: { path: 'new', completedSteps: ['google'], syncDone: false, restoreChoice: 'empty', currentStep: 2 },
  });
  check(ctx.BootFlow.hasGoogle() === false, 'stale google completedSteps does not imply connected');
})();

// 10. restore choice vs completion
(() => {
  const ctx = readyEnv({
    meta: {},
    SyncEngine: { getReadiness: () => ({ ready: false, state: 'PENDING', missing: ['initialSync'] }) },
    wizard: { path: 'new', restoreChoice: 'cloud', currentStep: 5, completedSteps: [], syncDone: false },
    deviceConfig: { deviceUuid: 'DEV', deviceName: 'D', lockedBranchId: 'BR-1', branchLocked: true },
  });
  check(ctx.BootFlow.hasRestoreDecision() === true, 'restore choice persisted as coordinator');
  check(ctx.BootFlow.hasSyncDone() === false, 'restore choice alone is not sync completion');
})();

// 11. currentStep may persist
(() => {
  const coord = BC.coordinatorSnapshot();
  check(typeof coord.currentStep === 'number', 'coordinator exposes currentStep');
})();

// 12. resolve causes zero operational writes
(() => {
  const ctx = readyEnv();
  const before = ctx._kvWrites.length;
  for (let i = 0; i < 5; i++) ctx.BootstrapCoordinator.resolveCoordinatorState();
  ctx.BootFlow.resolveCoordinatorState?.();
  ctx.BootFlow.getDisplayWizard?.(ctx._snap.wizard);
  check(ctx._kvWrites.length === before, 'resolve/render prep zero KV writes');
})();

// 13. repeated resolve idempotent
(() => {
  const ctx = readyEnv();
  const strip = (o) => {
    const copy = JSON.parse(JSON.stringify(o));
    delete copy.at;
    return copy;
  };
  const a = strip(ctx.BootstrapCoordinator.resolveCoordinatorState());
  const b = strip(ctx.BootstrapCoordinator.resolveCoordinatorState());
  check(JSON.stringify(a) === JSON.stringify(b), 'idempotent resolve');
})();

// 14. restart resume uses derived step
(() => {
  const ctx = readyEnv({
    meta: {},
    license: { centerId: 'CTR-S4', centerName: 'S4', branches: [], activation: { consumed: true } },
    deviceConfig: { deviceUuid: '', lockedBranchId: '', deviceName: '' },
    wizard: {
      path: 'new', currentStep: 7,
      completedSteps: ['language', 'google', 'discovery', 'license', 'organization'],
      restoreChoice: 'empty', wizardFlowVersion: 9,
      discoveryCompletedAt: new Date().toISOString(),
      licenseDiscoveryAttempted: true,
      cloudDiscovery: { result: { ok: true, status: 'no_existing_business' }, googleAccountKey: null },
    },
  });
  const resume = ctx.BootstrapCoordinator.resolveResumeStepIndex('new', 7);
  check(resume <= 5, 'resume snaps back from stale step 7 when branch/device missing');
})();

// 15. coordinator module field inventory
(() => {
  const inv = BC.getFieldInventory();
  check(inv.some((f) => f.field === 'syncDone' && f.classification === 'NO_LONGER_AUTHORITATIVE'), 'syncDone classified');
  check(inv.some((f) => f.field === 'completedSteps' && f.classification === 'NO_LONGER_AUTHORITATIVE'), 'completedSteps classified');
})();

const bootSrc = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
check(/bootstrap-coordinator/.test(fs.readFileSync(path.join(root, 'index.html'), 'utf8')), 'index loads bootstrap-coordinator');
check(!/return !!loadWizard\(\)\.syncDone/.test(bootSrc), 'hasSyncDone no longer wizard-only');
check(/metaBootstrapCommitted|bootstrapCompletedAt/.test(bootSrc), 'boot uses meta bootstrap marker');
check(/deriveCompletedSteps/.test(bootSrc), 'render uses derived completed steps');

if (errors.length) {
  console.error('FAIL stage-4-bootstrap-coordinator-state');
  errors.forEach((e) => console.error(' -', e));
  process.exit(1);
}
console.log('PASS stage-4-bootstrap-coordinator-state (coordinator slimming, derived gates, zero-write resolve)');
process.exit(0);
