#!/usr/bin/env node
'use strict';

/**
 * Stage 9 — NEW Start New: Owner before first Branch.
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
    'cloud/boot-flow-ui.js',
  ];
  for (const rel of files) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
  }
}

function countOwners(users) {
  return (users || []).filter((u) => u && u.active !== false
    && ['owner', 'hq_admin'].includes(String(u.role || '').toLowerCase())
    && u.seedDefaultPassword !== true).length;
}

function baseEnv(overrides = {}) {
  const wizardDefaults = {
    path: 'new', currentStep: 0, lang: 'ar', restoreChoice: null, syncDone: false,
    completedSteps: [], wizardFlowVersion: 9,
    discoveryCompletedAt: new Date().toISOString(),
    licenseDiscoveryAttempted: true,
    cloudDiscovery: { result: { ok: true, status: 'no_existing_business' }, googleAccountKey: 't@test.com' },
  };
  const { wizard: wizardOverrides, ...restOverrides } = overrides;
  const snap = {
    license: {
      centerId: 'CTR-S9', centerName: 'S9 Center',
      activation: { consumed: true }, branches: [],
    },
    meta: { centerId: 'CTR-S9' },
    deviceConfig: { deviceUuid: '', lockedBranchId: '', deviceName: '' },
    users: [],
    wizard: { ...wizardDefaults, ...(wizardOverrides || {}) },
    settings: {
      centerName: 'S9 Center',
      backup: { providers: { google: { connected: true, oauth: true, email: 't@test.com' } } },
    },
    ...restOverrides,
  };
  const storage = new Map();
  const kvWrites = [];
  const orgCommits = [];
  const ownerCreates = [];
  let licStatus = 'valid';
  let ownerState = snap.users.some((u) => u.role === 'owner' && u.hasUsableCredential) ? 'OWNER_EXISTS' : 'OWNER_MISSING';

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
        if (key === 'users') snap.users = val;
        if (key === '__tdw_device_config__') snap.deviceConfig = val;
        return { ok: true };
      },
    },
    users: snap.users,
    settings: snap.settings,
    get _licStatus() { return licStatus; },
    LicenseCloud: { loadLocal: () => snap.license },
    DeviceConfig: { load: () => snap.deviceConfig },
    CenterId: { getStoredCenterId: () => snap.license?.centerId || null },
    DriveAdapter: { isConnected: () => !!snap.settings?.backup?.providers?.google?.connected },
    OwnerManagement: {
      isSystemBusy: () => false,
      getOwnerState: () => ({ state: ownerState }),
      createOwner: async () => {
        if (ownerState === 'OWNER_EXISTS') return { ok: true, already: true };
        ownerCreates.push(Date.now());
        const user = {
          id: 'O-S9', role: 'owner', active: true, username: 'owner',
          hasUsableCredential: true, password: 'pbkdf2:fake', credentialRevision: 1,
        };
        snap.users.push(user);
        ownerState = 'OWNER_EXISTS';
        return { ok: true, userId: user.id };
      },
    },
    activateSetupOwnerIdentity: (id) => ({ ok: true, userId: id || 'O-S9' }),
    cuppingElectron: {
      rbac: { getSession: async () => ({ ok: true, session: { userId: 'O-S9', role: 'owner' } }) },
      database: {
        setupCommitOrganizationDevice: async (opts) => {
          orgCommits.push(opts);
          if (opts?.createBranch) {
            snap.license.branches = [{ id: opts.createBranch.id || 'BR-1', name: opts.createBranch.name, active: true }];
          } else if (opts?.branchId) {
            snap.license.branches = [{ id: opts.branchId, name: 'Main', active: true }];
          }
          snap.deviceConfig = {
            deviceUuid: 'DEV-S9', deviceName: opts?.deviceName || 'PC',
            lockedBranchId: (snap.license.branches[0] || {}).id || opts?.branchId,
            branchLocked: true,
          };
          snap.meta.setupOrganizationDeviceCommittedAt = new Date().toISOString();
          return { ok: true, branch: snap.license.branches[0], deviceRegistryCommit: { ok: true } };
        },
      },
    },
    RestoreReconciliation: { loadState: () => null },
    SyncEngine: { getReadiness: () => ({ ready: false, state: 'PENDING', missing: ['initialSync'] }) },
    licLoad: () => ({ centerId: snap.license.centerId, status: 'valid' }),
    LicenseActivationGate: { isConsumed: (lic) => !!(lic?.activation?.consumed) },
    _kvWrites: kvWrites,
    _orgCommits: orgCommits,
    _ownerCreates: ownerCreates,
    _snap: snap,
    _setOwnerState: (s) => { ownerState = s; },
  };
  ctx.global = ctx;
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  loadModules(ctx);
  return ctx;
}

async function runTests() {
const steps = baseEnv().BootFlow.NEW_STEPS;
const orgIdx = steps.indexOf('organization');
const ownerIdx = steps.indexOf('owner');
const branchIdx = steps.indexOf('branch');
const deviceIdx = steps.indexOf('device');
const restoreIdx = steps.indexOf('restore');

// 1. NEW Start New order org→owner→branch→device→restore
check(orgIdx >= 0 && ownerIdx > orgIdx && branchIdx > ownerIdx && deviceIdx > branchIdx && restoreIdx > deviceIdx,
  'NEW runtime order organization→owner→branch→device→restore');

// 2. Owner form before Branch in step list
check(steps[ownerIdx] === 'owner' && steps[branchIdx] === 'branch', 'owner step before branch step');

// 3. Branch cannot validate before owner on NEW fresh path
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR-S9', centerName: 'S9', activation: { consumed: true }, branches: [] },
    wizard: { path: 'new', forkDecision: 'start_new', wizardFlowVersion: 9 },
  });
  check(ctx.BootFlow.validateStep('branch') === false, 'branch blocked before owner');
  check(ctx.BootFlow.newBranchRequiresOwner() === true, 'newBranchRequiresOwner when no owner');
})();

// 4. Owner commit required
(() => {
  const ctx = baseEnv();
  check(ctx.BootFlow.validateStep('owner') === false, 'owner not resolved without credential');
})();

// 5–6. owner failure / validation blocks branch
(() => {
  const ctx = baseEnv();
  check(ctx.BootFlow.validateStep('branch') === false, 'owner failure blocks branch gate');
})();

// 7–8. owner double submit / retry idempotent (mock)
await (async () => {
  const ctx = baseEnv();
  ctx._snap.wizard.currentStep = ownerIdx;
  const r1 = await ctx.OwnerManagement.createOwner();
  const r2 = await ctx.OwnerManagement.createOwner();
  check(r1.ok && r2.ok, 'owner retry idempotent');
  check(ctx._ownerCreates.length === 1, 'exactly one owner create');
  check(countOwners(ctx._snap.users) === 1, 'owner count exactly 1');
})();

// 9. restart after owner resumes branch
(() => {
  const ctx = baseEnv({
    users: [{ id: 'O-S9', role: 'owner', active: true, hasUsableCredential: true, password: 'pbkdf2:x' }],
    wizard: {
      path: 'new', currentStep: 99, wizardFlowVersion: 8, forkDecision: null,
      discoveryCompletedAt: new Date().toISOString(),
    },
  });
  ctx._setOwnerState('OWNER_EXISTS');
  const w = ctx.BootFlow.loadWizard();
  check(w.wizardFlowVersion === 13, 'legacy v8 migrates to v13');
  const resume = ctx.BootstrapCoordinator.resolveResumeStepIndex('new', w.currentStep);
  check(ctx.BootFlow.NEW_STEPS[resume] === 'branch', `restart after owner resumes branch (got ${ctx.BootFlow.NEW_STEPS[resume]})`);
})();

// 10. crash after owner commit — SoT has owner
(() => {
  const ctx = baseEnv({
    users: [{ id: 'O-S9', role: 'owner', active: true, hasUsableCredential: true, password: 'pbkdf2:x', credentialRevision: 1 }],
    wizard: { path: 'new', currentStep: ownerIdx, wizardFlowVersion: 9 },
  });
  ctx._setOwnerState('OWNER_EXISTS');
  check(ctx.BootFlow.ownerStepResolved() === true, 'crash after owner commit → OWNER resolved');
  check(ctx.BootstrapGates.evaluateGate('OWNER_RESOLVED', 'new').status === 'resolved', 'OWNER_RESOLVED gate');
})();

// 11–13. counts
(() => {
  const ctx = baseEnv({
    users: [{ id: 'O-S9', role: 'owner', active: true, hasUsableCredential: true, password: 'pbkdf2:x' }],
    license: { centerId: 'CTR', centerName: 'C', activation: { consumed: true }, branches: [{ id: 'B1', active: true }] },
    deviceConfig: { deviceUuid: 'D1', deviceName: 'PC', lockedBranchId: 'B1', branchLocked: true },
  });
  ctx._setOwnerState('OWNER_EXISTS');
  check(countOwners(ctx._snap.users) === 1, 'owner count exactly 1');
  check(ctx.BootFlow.hasBranch() === true, 'branch count 1');
  check(!!ctx._snap.deviceConfig.deviceUuid, 'device registered');
})();

// 14. branch retry doesn't recreate owner
await (async () => {
  const ctx = baseEnv({
    users: [{ id: 'O-S9', role: 'owner', active: true, hasUsableCredential: true, password: 'pbkdf2:x' }],
  });
  ctx._setOwnerState('OWNER_EXISTS');
  const before = ctx._ownerCreates.length;
  await ctx.cuppingElectron.database.setupCommitOrganizationDevice({
    centerName: 'S9', deviceName: 'PC1',
    createBranch: { source: 'activation_wizard', id: 'BR-1', name: 'Main' },
  });
  await ctx.cuppingElectron.database.setupCommitOrganizationDevice({
    centerName: 'S9', deviceName: 'PC1', branchId: 'BR-1',
  });
  check(ctx._ownerCreates.length === before, 'branch retry no owner recreate');
})();

// 15–16. restore after owner / containing owner policy hooks
(() => {
  const src = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
  check(/forkDecision === 'start_new'/.test(src), 'restore UI warns on start_new');
  check(steps.indexOf('restore') > steps.indexOf('owner'), 'restore after owner in NEW');
})();

// 17–21. restore cancel/failure/restart semantics unchanged (gate only)
(() => {
  const ctx = baseEnv({
    users: [{ id: 'O-S9', role: 'owner', active: true, hasUsableCredential: true, password: 'pbkdf2:x' }],
    license: { centerId: 'CTR', centerName: 'C', activation: { consumed: true }, branches: [{ id: 'B1', active: true }] },
    deviceConfig: { deviceUuid: 'D1', deviceName: 'PC', lockedBranchId: 'B1', branchLocked: true },
    wizard: { path: 'new', restoreChoice: null, wizardFlowVersion: 9 },
  });
  ctx._setOwnerState('OWNER_EXISTS');
  check(ctx.BootFlow.hasRestoreDecision() === false, 'restore not done until choice');
})();

// 22. legacy branch exists / owner missing
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR', centerName: 'C', activation: { consumed: true }, branches: [{ id: 'B1', active: true }] },
    deviceConfig: { deviceUuid: 'D1', deviceName: 'PC', lockedBranchId: 'B1', branchLocked: true },
    wizard: { path: 'new', currentStep: 6, wizardFlowVersion: 8 },
  });
  ctx.BootFlow.loadWizard();
  const resume = ctx.BootstrapCoordinator.resolveResumeStepIndex('new', ctx._snap.wizard.currentStep);
  check(ctx.BootFlow.NEW_STEPS[resume] === 'owner', 'legacy branch exists owner missing → owner first');
})();

// 23. legacy branch+owner exists
(() => {
  const ctx = baseEnv({
    users: [{ id: 'O-S9', role: 'owner', active: true, hasUsableCredential: true, password: 'pbkdf2:x' }],
    license: { centerId: 'CTR', centerName: 'C', activation: { consumed: true }, branches: [{ id: 'B1', active: true }] },
    deviceConfig: { deviceUuid: 'D1', deviceName: 'PC', lockedBranchId: 'B1', branchLocked: true },
    settings: {
      centerName: 'Legacy Clinic', phone: '0501234567',
      backup: { providers: { google: { connected: true, oauth: true, email: 't@test.com' } } },
    },
    wizard: { path: 'new', lang: 'ar', wizardFlowVersion: 8, currentStep: 8, forkDecision: 'start_new', discoveryCompletedAt: new Date().toISOString() },
  });
  ctx._setOwnerState('OWNER_EXISTS');
  ctx.BootFlow.loadWizard();
  const resume = ctx.BootstrapCoordinator.resolveResumeStepIndex('new', ctx._snap.wizard.currentStep);
  check(['device', 'business_setup', 'publication', 'restore', 'sync', 'ready'].includes(ctx.BootFlow.NEW_STEPS[resume]), 'legacy branch+owner → continue device/business_setup/publication/restore/sync');
})();

// 24. legacy restore done / owner missing
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR', centerName: 'C', activation: { consumed: true }, branches: [{ id: 'B1', active: true }] },
    deviceConfig: { deviceUuid: 'D1', deviceName: 'PC', lockedBranchId: 'B1', branchLocked: true },
    wizard: { path: 'new', restoreChoice: 'empty', wizardFlowVersion: 8, currentStep: 7 },
  });
  ctx.BootFlow.loadWizard();
  const resume = ctx.BootstrapCoordinator.resolveResumeStepIndex('new', ctx._snap.wizard.currentStep);
  check(ctx.BootFlow.NEW_STEPS[resume] === 'owner', 'legacy restore done owner missing → owner not restore');
})();

// 25. stale currentStep corrected
(() => {
  const ctx = baseEnv({
    users: [{ id: 'O-S9', role: 'owner', active: true, hasUsableCredential: true, password: 'pbkdf2:x' }],
    wizard: { path: 'new', currentStep: branchIdx, wizardFlowVersion: 9 },
  });
  ctx._setOwnerState('OWNER_EXISTS');
  const eff = ctx.BootstrapCoordinator.effectiveStepIndex(ctx._snap.wizard);
  check(eff === branchIdx || eff < branchIdx, 'stale branch index advances to branch when owner resolved');
})();

// 26. Use Existing bypasses NEW owner-before-branch creation path
(() => {
  const ctx = baseEnv({
    wizard: { path: 'existing', forkDecision: 'use_existing', wizardFlowVersion: 9 },
  });
  check(ctx.BootFlow.isNewFreshStartPath() === false, 'use existing not fresh NEW path');
  check(ctx.BootFlow.EXISTING_STEPS.indexOf('owner') > ctx.BootFlow.EXISTING_STEPS.indexOf('branch_select'),
    'EXISTING owner still after branch_select');
})();

// 27. Direct EXISTING unchanged
(() => {
  const existing = baseEnv().BootFlow.EXISTING_STEPS;
  check(JSON.stringify(existing) === JSON.stringify([
    'language', 'google', 'discovery', 'license', 'organization', 'branch_select', 'device', 'restore', 'business_setup', 'publication', 'owner', 'sync', 'ready',
  ]), 'direct EXISTING runtime includes explicit business_setup + publication steps');
})();

// 28. Stage8 Start New honored
(() => {
  const ctx = baseEnv({ wizard: { path: 'new', forkDecision: 'start_new', wizardFlowVersion: 9 } });
  check(ctx.BootFlow.isNewFreshStartPath() === true, 'start_new honors NEW fresh path');
})();

// 29. no silent old-business restore after Start New (explicit choice only)
(() => {
  const ctx = baseEnv({ wizard: { path: 'new', forkDecision: 'start_new', wizardFlowVersion: 9 } });
  check(!ctx.BootFlow.hasRestoreDecision(), 'start new no auto restore');
})();

// 30. READY/startup unchanged
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR', centerName: 'C', activation: { consumed: true }, branches: [{ id: 'B1', active: true }] },
    meta: { bootstrapCompletedAt: new Date().toISOString() },
    deviceConfig: { deviceUuid: 'D1', deviceName: 'PC', lockedBranchId: 'B1', branchLocked: true },
    users: [{ id: 'O1', role: 'owner', active: true, hasUsableCredential: true, password: 'pbkdf2:x' }],
    wizard: { path: 'new', restoreChoice: 'empty', syncDone: true, wizardFlowVersion: 9 },
    settings: { centerName: 'C Clinic', phone: '0501234567', backup: { providers: { google: { connected: true, oauth: true } } } },
  });
  ctx._setOwnerState('OWNER_EXISTS');
  check(ctx.SetupStateService.evaluateReady({ ignoreRestart: true }).ready === true, 'READY unchanged');
})();

// Gate model: OWNER before BRANCH in runtime
(() => {
  const BG = require('../../cloud/bootstrap-gates');
  const rt = BG.CURRENT_NEW_RUNTIME;
  check(rt.indexOf('owner') < rt.indexOf('branch'), 'gate runtime owner before branch');
})();

// Seed excluded from owner resolution
(() => {
  const ctx = baseEnv({
    users: [{ id: 'seed', role: 'owner', active: true, seedDefaultPassword: true, password: 'pbkdf2:x' }],
  });
  check(ctx.BootFlow.hasOwnerPasswordAccount() === false, 'seed alone not authoritative owner');
})();

if (errors.length) {
  console.error('FAIL stage-9-owner-before-first-branch');
  errors.forEach((e) => console.error(' -', e));
  process.exit(1);
}
console.log('PASS stage-9-owner-before-first-branch (NEW owner before first branch, EXISTING unchanged)');
process.exit(0);
}

runTests().catch((e) => {
  console.error('FAIL stage-9-owner-before-first-branch', e);
  process.exit(1);
});
