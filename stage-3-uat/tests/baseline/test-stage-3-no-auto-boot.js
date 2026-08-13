#!/usr/bin/env node
'use strict';

/**
 * Stage 3 — No Auto-Boot for READY devices.
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
    id,
    hidden: false,
    style: {},
    className: '',
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        if (force === true) classes.add(c);
        else if (force === false) classes.delete(c);
        else if (classes.has(c)) classes.delete(c);
        else classes.add(c);
      },
    },
    appendChild: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    focus: () => {},
    remove: () => {},
  };
}

function makeDocument() {
  const byId = new Map();
  const body = makeElement('body');
  return {
    body,
    getElementById: (id) => {
      if (!byId.has(id)) byId.set(id, makeElement(id));
      return byId.get(id);
    },
    querySelector: (sel) => {
      if (sel === '#bootFlowOverlay') return makeDocument().getElementById('bootFlowOverlay');
      return null;
    },
    querySelectorAll: () => [],
    createElement: (tag) => makeElement(tag),
  };
}

function loadModules(ctx) {
  const files = [
    'cloud/ready-pure-evaluator.js',
    'cloud/setup-state-service.js',
    'cloud/setup-state-dom.js',
    'cloud/boot-flow-ui.js',
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    vm.runInContext(src, ctx, { filename: rel });
  }
}

function readySnapshot(overrides = {}) {
  return {
    database: { accessible: true, integrityOk: true },
    license: {
      centerId: 'CTR-S3',
      centerName: 'Stage 3 Center',
      branches: [{ id: 'BR-MAIN', name: 'Main', active: true }],
      activation: { consumed: true },
    },
    legacyLicense: { centerId: 'CTR-S3', status: 'valid' },
    licenseStatus: 'valid',
    meta: {
      centerId: 'CTR-S3',
      bootstrapCompletedAt: new Date().toISOString(),
    },
    organization: { centerId: 'CTR-S3', centerName: 'Stage 3 Center' },
    settings: { centerName: 'Stage 3 Center' },
    deviceConfig: {
      deviceUuid: 'DEV-S3-001',
      deviceName: 'Stage 3 Device',
      lockedBranchId: 'BR-MAIN',
      branchLocked: true,
    },
    users: [{
      id: 'OWNER-1',
      role: 'owner',
      active: true,
      hasUsableCredential: true,
      password: 'pbkdf2:fake',
    }],
    wizard: { restoreChoice: 'empty', syncDone: false },
    googleConnected: true,
    restoreInProgress: false,
    ownerPasswordChangeRequired: false,
    restartRequired: false,
    ...overrides,
  };
}

function makeCtx(snapshotOverrides = {}, extra = {}) {
  const snap = readySnapshot(snapshotOverrides);
  const storage = new Map();
  const document = makeDocument();

  const ctx = {
    console,
    setTimeout,
    clearTimeout,
    document,
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
        if (key === 'branches') return [];
        return null;
      },
      set: async () => ({ ok: true }),
    },
    users: snap.users,
    settings: snap.settings,
    branches: [],
    currentUser: extra.currentUser || null,
    _licStatus: snap.licenseStatus,
    LicenseCloud: { loadLocal: () => snap.license },
    DeviceConfig: { load: () => snap.deviceConfig },
    CenterId: { getStoredCenterId: () => snap.license.centerId },
    DriveAdapter: { isConnected: () => snap.googleConnected },
    CloudDataDiscovery: { isRestoreLocked: () => false },
    OwnerManagement: { isSystemBusy: () => false },
    RestoreReconciliation: { loadState: () => null },
    SyncEngine: { getReadiness: () => ({ ready: true, state: 'READY', missing: [] }) },
    notify: () => {},
    AuditLogger: { logSyncEvent: () => {} },
  };
  ctx.global = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  loadModules(ctx);
  return ctx;
}

// 1. READY → no auto Boot
(() => {
  const ctx = makeCtx();
  check(ctx.SetupStateService.evaluateReady({ ignoreRestart: true }).ready === true, 'ready profile is READY');
  check(ctx.BootFlow.shouldAutoOpenBoot() === false, 'READY: shouldAutoOpenBoot false');
  check(ctx.BootFlow.needsBootScreen() === false, 'READY: needsBootScreen false');
  check(ctx.SetupStateDom.needsBootFlow() === false, 'READY: needsBootFlow false');
  const opened = ctx.BootFlow.maybeAutoOpenBootFlow();
  check(opened === false, 'READY: maybeAutoOpenBootFlow does not open');
  const trace = ctx.BootFlow.getStage3BootTrace();
  check(trace.autoBootOpenCalls === 0, 'READY: autoBootOpenCalls = 0');
  check(trace.evaluateReadyCalls >= 1, 'READY: evaluateReady called');
})();

// 2. READY + stale wizard → no auto Boot
(() => {
  const ctx = makeCtx({
    wizard: { restoreChoice: 'empty', syncDone: false, completedSteps: [] },
    meta: { centerId: 'CTR-S3', bootstrapCompletedAt: new Date().toISOString() },
  });
  check(ctx.BootFlow.shouldAutoOpenBoot() === false, 'stale wizard: no auto boot');
  check(ctx.BootFlow.maybeAutoOpenBootFlow() === false, 'stale wizard: maybeAutoOpenBootFlow false');
})();

// 3. READY + missing wizard state → no auto Boot
(() => {
  const snap = readySnapshot({
    wizard: null,
    meta: { centerId: 'CTR-S3', bootstrapCompletedAt: new Date().toISOString() },
  });
  const ctx = makeCtx();
  ctx.DB.get = (key) => {
    if (key === '__tdw_boot_wizard__') return null;
    if (key === '__tdw_meta__') return snap.meta;
    if (key === '__tdw_cloud_license__') return snap.license;
    if (key === '__tdw_device_config__') return snap.deviceConfig;
    if (key === 'users') return snap.users;
    return null;
  };
  check(ctx.BootFlow.shouldAutoOpenBoot() === false, 'missing wizard: no auto boot');
})();

// 4–5. READY + restart simulations
(() => {
  const ctx = makeCtx();
  for (let i = 0; i < 5; i += 1) {
    check(ctx.BootFlow.shouldAutoOpenBoot() === false, `restart #${i + 1}: no auto boot`);
    check(ctx.BootFlow.maybeAutoOpenBootFlow() === false, `restart #${i + 1}: login path only`);
  }
})();

// 6. READY + logout simulation (no currentUser)
(() => {
  const ctx = makeCtx({}, { currentUser: null });
  check(ctx.BootFlow.shouldAutoOpenBoot() === false, 'logout: no auto boot');
})();

// 7. READY + failed login should not open boot (finishLogin gate uses needsBootFlow)
(() => {
  const ctx = makeCtx();
  const needsBoot = ctx.SetupStateDom.needsBootFlow();
  check(needsBoot === false, 'failed login path: needsBootFlow false on READY');
})();

// 8. NOT READY → BootFlow allowed
(() => {
  const ctx = makeCtx({ deviceConfig: { deviceUuid: '', lockedBranchId: '', deviceName: '' } });
  check(ctx.SetupStateService.evaluateReady({ ignoreRestart: true }).ready === false, 'unconfigured: NOT READY');
  check(ctx.BootFlow.needsBootScreen() === true, 'NOT READY: needsBootScreen true');
  check(ctx.BootFlow.shouldAutoOpenBoot() === true, 'NOT READY: shouldAutoOpenBoot true');
})();

// 9–11. Missing owner / branch / device
(() => {
  const ownerMissing = makeCtx({ users: [] });
  check(ownerMissing.SetupStateService.evaluateReady({ ignoreRestart: true }).missing.includes('owner'), 'missing owner gate');
  check(ownerMissing.BootFlow.shouldAutoOpenBoot() === true, 'missing owner: boot allowed');

  const branchMissing = makeCtx({
    license: { centerId: 'CTR-S3', branches: [], activation: { consumed: true } },
    deviceConfig: { deviceUuid: 'DEV', deviceName: 'D', lockedBranchId: '', branchLocked: false },
  });
  check(branchMissing.SetupStateService.evaluateReady({ ignoreRestart: true }).ready === false, 'missing branch NOT READY');
  check(branchMissing.BootFlow.shouldAutoOpenBoot() === true, 'missing branch: boot allowed');

  const deviceMissing = makeCtx({
    deviceConfig: { deviceUuid: '', deviceName: '', lockedBranchId: '', branchLocked: false },
  });
  check(deviceMissing.SetupStateService.evaluateReady({ ignoreRestart: true }).missing.includes('device'), 'missing device gate');
  check(deviceMissing.BootFlow.shouldAutoOpenBoot() === true, 'missing device: boot allowed');
})();

// 12. invalid license → no false READY
(() => {
  const ctx = makeCtx({ licenseStatus: 'expired', license: { centerId: 'CTR-S3', branches: [] } });
  const ev = ctx.SetupStateService.evaluateReady({ ignoreRestart: true });
  check(ev.ready === false, 'invalid license: NOT READY');
  check(ctx.BootFlow.shouldAutoOpenBoot() === true, 'invalid license: boot allowed');
})();

// 13. restore→READY→restart trace
(() => {
  const ctx = makeCtx({
    wizard: { restoreChoice: 'cloud', syncDone: false },
    meta: { centerId: 'CTR-S3', bootstrapCompletedAt: new Date().toISOString() },
  });
  check(ctx.SetupStateService.evaluateReady({ ignoreRestart: true }).ready === true, 'restore READY profile');
  check(ctx.BootFlow.maybeAutoOpenBootFlow() === false, 'restore READY: login only after restart');
})();

// 14. delayed hook cannot reopen BootFlow when READY
let delayedOk = true;
(() => {
  const ctx = makeCtx();
  setTimeout(() => {
    if (ctx.BootFlow.shouldAutoOpenBoot() !== false) delayedOk = false;
    if (ctx.BootFlow.maybeAutoOpenBootFlow() !== false) delayedOk = false;
  }, 25);
})();

// 15. manual BootFlow entry API still available on READY device
(() => {
  const ctx = makeCtx();
  check(typeof ctx.BootFlow.forceOpen === 'function', 'manual forceOpen API exists on READY');
  check(ctx.BootFlow.shouldAutoOpenBoot() === false, 'manual entry distinct from auto-open on READY');
})();

// Source structure checks
const bootSrc = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
const setupSrc = fs.readFileSync(path.join(root, 'cloud/setup-state-service.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const firstRunSrc = fs.readFileSync(path.join(root, 'cupping-first-run.js'), 'utf8');

check(/maybeAutoOpenBootFlow/.test(bootSrc), 'boot-flow exports maybeAutoOpenBootFlow');
check(/isDeviceReadyAuthoritative/.test(bootSrc), 'boot-flow has isDeviceReadyAuthoritative');
check(/if \(pure\.ready\)/.test(setupSrc), 'resolveState short-circuits on pure.ready');
check(/authoritativeReady/.test(setupSrc), 'getState uses authoritativeReady for needsBootFlow');
check(/maybeAutoOpenBootFlow/.test(indexSrc), 'index startup uses maybeAutoOpenBootFlow');
check(/early-ready-no-auto-boot/.test(indexSrc), 'index has early READY gate');
check(/evaluateReady/.test(firstRunSrc) && /forceWizard === true/.test(firstRunSrc),
  'cupping-first-run guards auto wizard on READY');

setTimeout(() => {
  check(delayedOk, 'delayed: shouldAutoOpenBoot remains false');
  if (errors.length) {
    console.error('FAIL stage-3-no-auto-boot');
    errors.forEach((e) => console.error(' -', e));
    process.exit(1);
  }
  console.log('PASS stage-3-no-auto-boot (READY→Login, NOT READY→Boot, stale wizard, restart, manual entry)');
  process.exit(0);
}, 60);
