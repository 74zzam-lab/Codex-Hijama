#!/usr/bin/env node
'use strict';

/**
 * Stage 5 — Bootstrap gate map (MAP → VERIFY → PREPARE). No runtime reorder.
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
    'cloud/ready-pure-evaluator.js',
    'cloud/setup-state-service.js',
    'cloud/bootstrap-coordinator.js',
    'cloud/bootstrap-gates.js',
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
      centerId: 'CTR-S5', centerName: 'S5 Center',
      branches: [{ id: 'BR-1', name: 'Main', active: true }],
      activation: { consumed: true },
    },
    meta: { centerId: 'CTR-S5', bootstrapCompletedAt: new Date().toISOString(), setupOrganizationDeviceCommittedAt: new Date().toISOString() },
    deviceConfig: { deviceUuid: 'DEV-S5', deviceName: 'D', lockedBranchId: 'BR-1', branchLocked: true },
    users: [{ id: 'O1', role: 'owner', active: true, hasUsableCredential: true, password: 'pbkdf2:x' }],
    wizard: { path: 'new', currentStep: 0, restoreChoice: 'empty', syncDone: false, completedSteps: [], lang: 'ar', wizardFlowVersion: 6 },
    settings: { centerName: 'S5 Center', backup: { providers: { google: { connected: true, oauth: true } } } },
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
    licLoad: () => ({ centerId: 'CTR-S5', status: 'valid' }),
    LicenseActivationGate: { isConsumed: () => true },
    notify: () => {},
    AuditLogger: { logSyncEvent: () => {} },
    _kvWrites: kvWrites,
    _snap: snap,
  };
  ctx.global = ctx;
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  loadModules(ctx);
  return ctx;
}

// 1. Current runtime ordering unchanged
(() => {
  const ctx = readyEnv();
  const ro = ctx.BootstrapGates.runtimeOrderingUnchanged();
  check(ro.unchanged === true, 'runtime NEW/EXISTING ordering unchanged');
  check(JSON.stringify(ro.NEW_STEPS) === JSON.stringify(ctx.BootstrapGates.CURRENT_NEW_RUNTIME), 'NEW_STEPS baseline');
  check(JSON.stringify(ro.EXISTING_STEPS) === JSON.stringify(ctx.BootstrapGates.CURRENT_EXISTING_RUNTIME), 'EXISTING_STEPS baseline');
})();

// 2. Target NEW gate order defined
(() => {
  const BG = require('../../cloud/bootstrap-gates');
  check(BG.TARGET_NEW_GATES[0] === 'ACTIVATION_RESOLVED', 'target NEW starts activation');
  check(BG.TARGET_NEW_GATES.includes('GOOGLE_CONNECTED'), 'target NEW includes google');
  check(BG.TARGET_NEW_GATES[BG.TARGET_NEW_GATES.length - 1] === 'READY', 'target NEW ends READY');
})();

// 3. Target EXISTING gate order defined
(() => {
  const BG = require('../../cloud/bootstrap-gates');
  check(BG.TARGET_EXISTING_GATES[0] === 'GOOGLE_CONNECTED', 'target EXISTING starts google');
  check(!BG.TARGET_EXISTING_GATES.includes('ACTIVATION_RESOLVED'), 'target EXISTING no activation gate');
  check(BG.TARGET_EXISTING_GATES.includes('DEVICE_RESOLVED'), 'target EXISTING includes device');
})();

// 4. All gate predicates read-only (zero KV writes)
(() => {
  const ctx = readyEnv();
  const before = ctx._kvWrites.length;
  for (let i = 0; i < 3; i++) {
    ctx.BootstrapGates.evaluateAllGates('new');
    ctx.BootstrapGates.evaluateAllGates('existing');
    ctx.BootstrapGates.diagnoseAll('new');
    ctx.BootstrapCoordinator.resolveCoordinatorState();
  }
  check(ctx._kvWrites.length === before, 'gate evaluation zero-write');
})();

// 5. Gate evaluation idempotent
(() => {
  const ctx = readyEnv();
  const a = JSON.stringify(ctx.BootstrapGates.evaluateAllGates('new'));
  const b = JSON.stringify(ctx.BootstrapGates.evaluateAllGates('new'));
  check(a === b, 'gate evaluation idempotent');
})();

// 6. Complete NEW → all resolved
(() => {
  const ctx = readyEnv();
  const gates = ctx.BootstrapGates.evaluateAllGates('new');
  const required = gates.filter((g) => g.status !== 'not_applicable');
  check(required.every((g) => g.status === 'resolved'), 'complete NEW all gates resolved');
  check(ctx.SetupStateService.evaluateReady({ ignoreRestart: true }).ready === true, 'complete NEW READY=true');
})();

// 7. Partial NEW → first unresolved target gate = OWNER (model only)
(() => {
  const ctx = readyEnv({
    users: [],
    OwnerManagement: { isSystemBusy: () => false, getOwnerState: () => ({ state: 'OWNER_MISSING' }) },
    meta: { centerId: 'CTR-S5' },
    wizard: { path: 'new', lang: 'ar', restoreChoice: 'empty', currentStep: 4, completedSteps: [] },
  });
  const first = ctx.BootstrapGates.firstUnresolvedTargetGate('new');
  check(first && first.id === 'OWNER_RESOLVED', 'partial NEW first unresolved = OWNER (target model)');
  const runtimeSteps = ctx.BootstrapGates.getCurrentRuntimeSteps('new');
  check(runtimeSteps.indexOf('branch') < runtimeSteps.indexOf('owner'), 'runtime still branch before owner');
})();

// 8. Existing complete org/owner — no activation gate required
(() => {
  const ctx = readyEnv({ wizard: { path: 'existing', lang: 'ar', restoreChoice: 'skip_existing', currentStep: 0 } });
  const act = ctx.BootstrapGates.evaluateGate('ACTIVATION_RESOLVED', 'existing');
  check(act.status === 'not_applicable', 'existing path activation N/A');
})();

// 9. Existing missing device → device unresolved
(() => {
  const ctx = readyEnv({
    wizard: { path: 'existing', lang: 'ar', restoreChoice: 'cloud', currentStep: 0 },
    deviceConfig: { deviceUuid: '', lockedBranchId: '', deviceName: '' },
  });
  const dev = ctx.BootstrapGates.evaluateGate('DEVICE_RESOLVED', 'existing');
  check(dev.status === 'missing', 'existing missing device unresolved');
  const first = ctx.BootstrapGates.firstUnresolvedTargetGate('existing');
  check(first && first.id === 'DEVICE_RESOLVED', 'existing first unresolved = device');
})();

// 10. Restore choice != restore completion
(() => {
  const ctx = readyEnv({
    meta: {},
    SyncEngine: { getReadiness: () => ({ ready: false, state: 'PENDING', missing: ['initialSync'] }) },
    wizard: { path: 'new', lang: 'ar', restoreChoice: 'cloud', currentStep: 5, completedSteps: [] },
  });
  const restore = ctx.BootstrapGates.evaluateGate('RESTORE_DECISION_RESOLVED', 'new');
  const sync = ctx.BootstrapGates.evaluateGate('INITIAL_SYNC_RESOLVED', 'new');
  check(restore.status === 'resolved', 'restore choice made');
  check(sync.status === 'missing', 'sync not complete');
  check(restore.choiceIsNotCompletion === true, 'restore choice is not completion');
})();

// 11. Google cached flag not authority
(() => {
  const ctx = readyEnv({
    settings: { centerName: 'S5', backup: { providers: { google: { connected: false, userDisconnected: true } } } },
    DriveAdapter: { isConnected: () => false },
    wizard: { path: 'new', lang: 'ar', completedSteps: ['google'], restoreChoice: 'empty', currentStep: 2 },
  });
  const g = ctx.BootstrapGates.evaluateGate('GOOGLE_CONNECTED', 'new');
  check(g.status === 'missing', 'google gate not from wizard flag');
})();

// 12–14. Owner/branch/device gates use services
(() => {
  const ctx = readyEnv({ users: [], OwnerManagement: { getOwnerState: () => ({ state: 'OWNER_MISSING' }) } });
  check(ctx.BootstrapGates.evaluateGate('OWNER_RESOLVED', 'new').source.includes('Owner'), 'owner uses OwnerManagement');
  const ctx2 = readyEnv({ license: { centerId: 'CTR', branches: [], activation: { consumed: true } } });
  check(ctx2.BootstrapGates.evaluateGate('BRANCH_RESOLVED', 'new').status === 'missing', 'branch uses license branches');
  const ctx3 = readyEnv({ deviceConfig: { deviceUuid: '', lockedBranchId: '', deviceName: '' } });
  check(ctx3.BootstrapGates.evaluateGate('DEVICE_RESOLVED', 'new').status === 'missing', 'device uses DeviceConfig');
})();

// 15. READY remains Stage 2 evaluator
(() => {
  const ctx = readyEnv();
  const readyGate = ctx.BootstrapGates.evaluateGate('READY', 'new');
  check(readyGate.source.includes('evaluateReady'), 'READY from Stage 2 evaluator');
})();

// 16. Coordinator remains non-authoritative
(() => {
  const ctx = readyEnv({
    wizard: { path: 'new', currentStep: 8, completedSteps: ['language', 'google', 'license', 'organization', 'branch', 'restore', 'owner', 'sync', 'ready'], syncDone: true, restoreChoice: 'empty', lang: 'ar', wizardFlowVersion: 6 },
    deviceConfig: { deviceUuid: '', lockedBranchId: '', deviceName: '' },
    meta: {},
    users: [],
  });
  const coord = ctx.BootstrapCoordinator.resolveCoordinatorState();
  check(coord.derived.deviceResolved === false, 'coordinator not fooled by wizard flags');
})();

// 17. Restart recomputes gate model (first unresolved)
(() => {
  const ctx = readyEnv({
    meta: {},
    license: { centerId: 'CTR-S5', centerName: 'S5', branches: [], activation: { consumed: true } },
    deviceConfig: { deviceUuid: '', lockedBranchId: '', deviceName: '' },
    wizard: { path: 'new', currentStep: 7, lang: 'ar', restoreChoice: 'empty', completedSteps: ['language', 'google', 'license', 'organization'], wizardFlowVersion: 6 },
  });
  const first = ctx.BootstrapGates.firstUnresolvedTargetGate('new');
  check(first && (first.id === 'BRANCH_RESOLVED' || first.id === 'DEVICE_RESOLVED'), 'restart model finds branch/device gap');
  const resume = ctx.BootstrapCoordinator.resolveResumeStepIndex('new', 7);
  check(resume <= 4, 'coordinator resume not stale step 7');
})();

// 18. Stage 6 NEW runtime: license before google; EXISTING unchanged
(() => {
  const bootSrc = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
  check(/const NEW_STEPS = \['language', 'license', 'google'/.test(bootSrc), 'NEW runtime activation before google');
  check(/const EXISTING_STEPS = \['language', 'google', 'license'/.test(bootSrc), 'EXISTING runtime google before license unchanged');
})();

// Static registry exports
(() => {
  const BG = require('../../cloud/bootstrap-gates');
  check(BG.getStepInventory().length >= 9, 'step inventory');
  check(BG.getDependencyGraph().hard.length > 0, 'dependency graph');
  check(BG.getCircularDependencies().length > 0, 'circular deps documented');
  check(BG.getStage6Plan().goal.includes('Activation before Google'), 'stage 6 plan present');
})();

check(/bootstrap-gates/.test(fs.readFileSync(path.join(root, 'index.html'), 'utf8')), 'index loads bootstrap-gates');

if (errors.length) {
  console.error('FAIL stage-5-bootstrap-gate-map');
  errors.forEach((e) => console.error(' -', e));
  process.exit(1);
}
console.log('PASS stage-5-bootstrap-gate-map (gate model prepared, runtime ordering unchanged, zero-write predicates)');
process.exit(0);
