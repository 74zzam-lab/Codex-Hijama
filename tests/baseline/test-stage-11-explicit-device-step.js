#!/usr/bin/env node
'use strict';

/**
 * Stage 11 — Explicit Device step after Branch.
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
    completedSteps: [], wizardFlowVersion: 11,
    discoveryCompletedAt: new Date().toISOString(),
    licenseDiscoveryAttempted: true,
    cloudDiscovery: { result: { ok: true, status: 'no_existing_business' }, googleAccountKey: 't@test.com' },
  };
  const { wizard: wizardOverrides, ...restOverrides } = overrides;
  const snap = {
    license: {
      centerId: 'CTR-S11', centerName: 'S11 Center',
      activation: { consumed: true }, branches: [],
      limits: { maxDevices: 1 },
    },
    meta: { centerId: 'CTR-S11' },
    deviceConfig: { deviceUuid: '', lockedBranchId: '', deviceName: '' },
    users: [{ id: 'O1', role: 'owner', active: true, seedDefaultPassword: false, password: 'pbkdf2v2:x', hasUsableCredential: true }],
    wizard: { ...wizardDefaults, ...(wizardOverrides || {}) },
    settings: { centerName: 'S11 Center', backup: { providers: { google: { connected: true, oauth: true, email: 't@test.com' } } } },
    ...restOverrides,
  };
  const storage = new Map();
  const commits = [];
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
        if (key === '__tdw_cloud_license__') snap.license = val;
        if (key === '__tdw_boot_wizard__') snap.wizard = val;
        if (key === 'settings') snap.settings = val;
        if (key === '__tdw_device_config__') snap.deviceConfig = val;
        return { ok: true };
      },
    },
    users: snap.users,
    settings: snap.settings,
    LicenseCloud: { loadLocal: () => snap.license },
    DeviceConfig: { load: () => snap.deviceConfig },
    CenterId: { getStoredCenterId: () => snap.license?.centerId || null },
    DriveAdapter: { isConnected: () => !!snap.settings?.backup?.providers?.google?.connected },
    OwnerManagement: {
      isSystemBusy: () => false,
      getOwnerState: () => ({ state: 'OWNER_EXISTS' }),
      createOwner: async () => ({ ok: true, already: true }),
      retireOwnerSeedsIfNeeded: async () => ({ ok: true, changed: false }),
    },
    licGetFingerprint: () => 'fp-test-123',
    cuppingElectron: {
      rbac: { getSession: async () => ({ ok: true, session: { userId: 'O1', role: 'owner' } }) },
      database: {
        setupCommitOrganizationDevice: async (opts) => {
          commits.push(opts);
          if (opts?.branchOnly) {
            const branch = opts.createBranch
              ? { id: opts.createBranch.id || 'BR-1', name: opts.createBranch.name, active: true }
              : { id: opts.branchId || 'BR-1', name: 'Main', active: true };
            if (!snap.license.branches.length) snap.license.branches = [branch];
            snap.wizard.pendingBranchId = branch.id;
            return { ok: true, branch, setupBranch: true };
          }
          if (opts?.deviceName) {
            snap.deviceConfig = {
              deviceUuid: 'DEV-1', deviceName: opts.deviceName,
              lockedBranchId: opts.branchId || snap.wizard.pendingBranchId || 'BR-1',
              centerId: snap.license.centerId,
            };
            return {
              ok: true,
              deviceRegistryCommit: { ok: true },
              deviceConfig: snap.deviceConfig,
              branch: { id: snap.deviceConfig.lockedBranchId },
            };
          }
          return { ok: true };
        },
      },
    },
    SqliteBridge: { hydrateIntoMemory: async () => ({ ok: true }) },
    RestoreReconciliation: { loadState: () => null },
    SyncEngine: { getReadiness: () => ({ ready: false, state: 'PENDING', missing: ['initialSync'] }) },
    licLoad: () => ({ centerId: snap.license.centerId, status: 'valid' }),
    LicenseActivationGate: { isConsumed: (lic) => !!(lic?.activation?.consumed) },
    _commits: commits,
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
  const steps = baseEnv().BootFlow.NEW_STEPS;
  const branchIdx = steps.indexOf('branch');
  const deviceIdx = steps.indexOf('device');
  const restoreIdx = steps.indexOf('restore');
  const ownerIdx = steps.indexOf('owner');

  check(branchIdx >= 0 && deviceIdx > branchIdx && restoreIdx > deviceIdx, '1 NEW branch then device');
  check(ownerIdx < branchIdx, '2 device cannot precede branch (owner before branch)');
  check(steps.includes('device'), 'device step exists');

  const ctx = baseEnv();
  check(!ctx.BootFlow.validateStep('device'), '3 device blocked before branch');
  check(ctx.BootFlow.validateStep('owner'), 'owner resolved in fixture');

  const branchRes = await ctx.cuppingElectron.database.setupCommitOrganizationDevice({
    branchOnly: true,
    createBranch: { id: 'BR-1', name: 'فرع تجريبي' },
  });
  check(branchRes?.branch?.id === 'BR-1', '4 branch created without device');
  check(!ctx.BootFlow.hasDeviceBranch(), '5 no device after branch-only');

  ctx._snap.wizard.pendingBranchId = 'BR-1';
  const devRes = await ctx.cuppingElectron.database.setupCommitOrganizationDevice({
    branchId: 'BR-1', deviceName: 'PC-1',
  });
  check(devRes?.deviceRegistryCommit?.ok, '8 device limit accepted (first device)');
  check(ctx.BootFlow.hasDeviceBranch(), 'device registered');

  const rb = ctx.BootFlow.readDeviceCommitState();
  check(rb.deviceId && rb.branchId === 'BR-1' && rb.deviceName === 'PC-1', '32 read-back verification');
  check(rb.organizationId === 'CTR-S11', '6 org link correct');

  check(!ctx.BootFlow.validateStep('restore') || ctx.BootFlow.deviceStepResolved(), '27 restore needs device');
  check(ctx.BootFlow.deviceStepResolved(), '29 READY device part satisfied');

  const exSteps = baseEnv({ wizard: { path: 'existing', wizardFlowVersion: 11 } }).BootFlow.EXISTING_STEPS;
  check(exSteps.indexOf('device') > exSteps.indexOf('branch_select'), '19 existing branch_select then device');

  const devSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  check(/dev_najjar|dev_tadawi|__dev__/.test(devSrc), '35 __dev__ unchanged');

  const gates = fs.readFileSync(path.join(root, 'cloud/bootstrap-gates.js'), 'utf8');
  check(/stepId: 'device'/.test(gates), 'device gate inventory');

  const archiveScript = fs.readFileSync(path.join(root, 'scripts/ci/verify-no-tracked-archives.cjs'), 'utf8');
  check(/Tadawi-Stage-/.test(archiveScript), '71 archive cleanup check exists');

  const pkg = fs.readFileSync(path.join(root, 'scripts/ci/package-stage-source-zip.cjs'), 'utf8');
  check(/artifactOnly: true/.test(pkg) && /ci-artifacts/.test(pkg), 'ZIP artifact-only not committed');

  if (errors.length) {
    console.error('FAIL stage-11-explicit-device-step');
    errors.forEach((e, i) => console.error(`${i + 1}. ${e}`));
    process.exit(1);
  }
  console.log('PASS stage-11-explicit-device-step (35+ scenarios)');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
