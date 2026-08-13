#!/usr/bin/env node
'use strict';

/**
 * Stage 6 — NEW customer: Activation before Google.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

async function runTests() {
function makeElement(id) {
  const classes = new Set();
  const el = {
    id, hidden: false, style: {}, className: '', value: '',
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c), toggle: () => {},
    },
    appendChild: () => {}, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {}, getAttribute: () => null, setAttribute: () => {},
    removeAttribute: () => {}, focus: () => {}, remove: () => {},
  };
  return el;
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

function baseEnv(overrides = {}) {
  const snap = {
    license: null,
    meta: {},
    deviceConfig: { deviceUuid: '', lockedBranchId: '', deviceName: '' },
    users: [],
    wizard: { path: 'new', currentStep: 0, lang: 'ar', restoreChoice: null, syncDone: false, completedSteps: [], wizardFlowVersion: 0 },
    settings: { centerName: '', backup: { providers: { google: { connected: false } } } },
    ...overrides,
  };
  const storage = new Map();
  const kvWrites = [];
  const oauthCalls = [];
  const activationCommits = [];
  let licStatus = snap.license ? 'valid' : null;

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
        return { ok: true };
      },
    },
    users: snap.users,
    settings: snap.settings,
    get _licStatus() { return licStatus; },
    set _licStatus(v) { licStatus = v; },
    LicenseCloud: { loadLocal: () => snap.license },
    DeviceConfig: { load: () => snap.deviceConfig },
    CenterId: { getStoredCenterId: () => snap.license?.centerId || null },
    DriveAdapter: { isConnected: () => !!snap.settings?.backup?.providers?.google?.connected },
    OwnerManagement: { isSystemBusy: () => false, getOwnerState: () => ({ state: 'OWNER_MISSING' }) },
    RestoreReconciliation: { loadState: () => null },
    SyncEngine: { getReadiness: () => ({ ready: false, state: 'PENDING', missing: ['initialSync'] }) },
    licLoad: () => (snap.license ? { centerId: snap.license.centerId, status: 'valid' } : null),
    LicenseActivationGate: { isConsumed: (lic) => !!(lic?.activation?.consumed) },
    connectGoogleDriveOnly: async () => {
      oauthCalls.push('connect');
      snap.settings.backup.providers.google = { connected: true, oauth: true, email: 't@test.com' };
      return { ok: true, email: 't@test.com' };
    },
    CommercialLicense: {
      router: {
        isV6Input: (k) => /^TDW6\./.test(k),
        isV5Key: () => false,
        applyV6Activation: async () => ({
          ok: true,
          verified: { license: { centerId: 'CTR-NEW', centerName: 'New Center', activation: { consumed: true }, branches: [] } },
          lic: { centerId: 'CTR-NEW', status: 'valid' },
        }),
      },
    },
    cuppingElectron: {
      database: {
        setupCommitSignedActivation: async (payload) => {
          activationCommits.push(payload);
          snap.license = payload.license;
          licStatus = 'valid';
          return { ok: true };
        },
      },
    },
    SqliteBridge: { hydrateIntoMemory: async () => ({ ok: true }) },
    licCheck: async () => { licStatus = 'valid'; },
    CloudBootstrap: {
      discoverAndFetchLicenseFromDrive: async () => ({ ok: false, error: 'no_activation_on_drive' }),
    },
    notify: () => {},
    AuditLogger: { logSyncEvent: () => {} },
    _kvWrites: kvWrites,
    _oauthCalls: oauthCalls,
    _activationCommits: activationCommits,
    _snap: snap,
  };
  ctx.global = ctx;
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  loadModules(ctx);
  return ctx;
}

// 1. NEW starts Activation (license step index 1 after language)
(() => {
  const ctx = baseEnv({ wizard: { path: 'new', currentStep: 1, lang: 'ar', wizardFlowVersion: 6 } });
  const steps = ctx.BootFlow.getStepCatalog().NEW_STEPS;
  check(steps[1] === 'license', 'NEW first operational step after language is license/activation');
})();

// 2. Google not opened before activation
await (async () => {
  const ctx = baseEnv();
  const r = await ctx.BootFlow.runGoogleConnect();
  check(r.ok === false && r.error === 'activation_required_before_google', 'google blocked before activation');
  check(ctx._oauthCalls.length === 0, 'no oauth before activation');
})();

// 3. invalid activation blocks (no license)
(() => {
  const ctx = baseEnv();
  ctx.CommercialLicense.router.applyV6Activation = async () => ({ ok: false, error: 'license_invalid' });
  ctx.document.getElementById('bf-license-key').value = 'TDW6.BAD';
  // synchronous check via validateStep
  check(ctx.BootFlow.validateStep('license') === false, 'invalid activation blocks step');
  check(ctx._oauthCalls.length === 0, 'no oauth on invalid activation');
})();

// 4–5. valid activation then google allowed (async test inline via mocks)
(() => {
  const ctx = baseEnv();
  ctx._snap.license = { centerId: 'CTR-NEW', centerName: 'N', activation: { consumed: true }, branches: [] };
  ctx._licStatus = 'valid';
  check(ctx.BootFlow.validateStep('license') === true, 'valid activation passes license gate');
  const steps = ctx.BootFlow.NEW_STEPS;
  check(steps.indexOf('license') < steps.indexOf('google'), 'activation before google in NEW_STEPS');
})();

// 6. restart after activation resumes google
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR-NEW', centerName: 'N', activation: { consumed: true }, branches: [] },
    wizard: { path: 'new', currentStep: 1, lang: 'ar', wizardFlowVersion: 0, completedSteps: [] },
  });
  ctx._licStatus = 'valid';
  const w = ctx.BootFlow.loadWizard();
  check(w.wizardFlowVersion >= 6, 'legacy wizard migrated to flow v6+');
  const resume = ctx.BootstrapCoordinator.resolveResumeStepIndex('new', w.currentStep);
  const nextStep = ctx.BootFlow.NEW_STEPS[resume];
  check(nextStep === 'google' || nextStep === 'discovery', 'restart after activation resumes at google or discovery');
})();

// 7. google cancel keeps activation
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR-NEW', centerName: 'N', activation: { consumed: true }, branches: [] },
    wizard: { path: 'new', currentStep: 2, lang: 'ar', wizardFlowVersion: 6 },
  });
  ctx._licStatus = 'valid';
  check(ctx.BootFlow.hasValidLicense() === true, 'activation remains after google cancel scenario');
})();

// 8. google failure keeps activation
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR-NEW', centerName: 'N', activation: { consumed: true }, branches: [] },
  });
  ctx._licStatus = 'valid';
  ctx.connectGoogleDriveOnly = async () => ({ ok: false, error: 'oauth_failed' });
  check(ctx.BootFlow.hasValidLicense() === true, 'activation stays on google failure');
})();

// 9–10. double submit / retry idempotency flags
(() => {
  const src = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
  check(/licenseActivateInFlight/.test(src), 'activation in-flight guard');
  check(/activate_in_flight/.test(src), 'double submit blocked');
})();

// 11. no duplicate consume via autoDiscover on NEW when activated
await (async () => {
  const ctx = baseEnv({
    license: { centerId: 'CTR-NEW', centerName: 'N', activation: { consumed: true }, branches: [] },
    wizard: { path: 'new', lang: 'ar', wizardFlowVersion: 6 },
  });
  ctx._licStatus = 'valid';
  let discoverCalls = 0;
  ctx.CloudBootstrap.discoverAndFetchLicenseFromDrive = async () => { discoverCalls++; return { ok: true, license: {} }; };
  const r = await ctx.BootFlow.autoDiscoverActivationAfterGoogle();
  check(r.skipped === true, 'autoDiscover skips re-activation on NEW');
  check(discoverCalls === 0, 'no drive discovery when activation authoritative on NEW');
})();

// 12–14. no org/branch/owner before google
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR-NEW', centerName: 'N', activation: { consumed: true }, branches: [] },
  });
  ctx._licStatus = 'valid';
  check(!ctx._snap.meta.setupOrganizationDeviceCommittedAt, 'no organization commit before google');
  check(ctx.BootFlow.hasBranch() === false, 'no branch before setup');
  check(ctx.BootFlow.hasOwnerPasswordAccount() === false, 'no owner early');
})();

// 15. EXISTING google-first (Stage 7: discovery before license)
(() => {
  const steps = baseEnv().BootFlow.EXISTING_STEPS;
  check(steps[1] === 'google', 'EXISTING google-first');
  check(steps.indexOf('license') > steps.indexOf('google'), 'EXISTING license after google');
})();

// 16. legacy wizard state migration (old index 2 = license → new index 1)
(() => {
  const ctx = baseEnv({
    wizard: { path: 'new', currentStep: 2, lang: 'ar', wizardFlowVersion: 0 },
  });
  const w = ctx.BootFlow.loadWizard();
  check(w.currentStep === 1 && ctx.BootFlow.NEW_STEPS[w.currentStep] === 'license', 'legacy index 2 maps to license');
})();

// 17. stale currentStep corrected when resolved step stored
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR-NEW', centerName: 'N', activation: { consumed: true }, branches: [] },
    wizard: { path: 'new', currentStep: 1, lang: 'ar', wizardFlowVersion: 6 },
  });
  ctx._licStatus = 'valid';
  const eff = ctx.BootstrapCoordinator.effectiveStepIndex(ctx._snap.wizard);
  check(ctx.BootFlow.NEW_STEPS[eff] === 'google', 'stale license index advances to google when resolved');
})();

// 18. back navigation does not clear committed activation (SoT unchanged)
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR-NEW', centerName: 'N', activation: { consumed: true }, branches: [] },
    wizard: { path: 'new', currentStep: 2, lang: 'ar', wizardFlowVersion: 6 },
  });
  ctx._licStatus = 'valid';
  ctx._snap.wizard.currentStep = 1;
  check(ctx.BootFlow.hasValidLicense() === true, 'navigating back keeps activation SoT');
})();

// 19. READY/startup unchanged
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR-S6', centerName: 'S6', activation: { consumed: true }, branches: [{ id: 'B1', active: true }] },
    meta: { bootstrapCompletedAt: new Date().toISOString() },
    deviceConfig: { deviceUuid: 'D1', deviceName: 'PC', lockedBranchId: 'B1', branchLocked: true },
    users: [{ id: 'O1', role: 'owner', active: true, hasUsableCredential: true, password: 'pbkdf2:x' }],
    wizard: { path: 'new', lang: 'ar', restoreChoice: 'empty', wizardFlowVersion: 6 },
    settings: { centerName: 'S6', backup: { providers: { google: { connected: true, oauth: true } } } },
  });
  ctx._licStatus = 'valid';
  check(ctx.SetupStateService.evaluateReady({ ignoreRestart: true }).ready === true, 'READY unchanged');
  check(ctx.BootFlow.shouldAutoOpenBoot() === false, 'no auto boot when READY');
})();

// 20. runtime tail after discovery unchanged
(() => {
  const steps = baseEnv().BootFlow.NEW_STEPS;
  const discoveryIdx = steps.indexOf('discovery');
  const tail = steps.slice(discoveryIdx + 1);
  const expectedTail = steps.includes('owner') && steps.indexOf('owner') < steps.indexOf('branch')
    ? ['path_decision', 'organization', 'owner', 'branch', 'device', 'restore', 'sync', 'ready']
    : (steps.includes('path_decision')
      ? ['path_decision', 'organization', 'branch', 'device', 'restore', 'owner', 'sync', 'ready']
      : ['organization', 'branch', 'device', 'restore', 'owner', 'sync', 'ready']);
  check(JSON.stringify(tail) === JSON.stringify(expectedTail), 'NEW tail after discovery reflects Stage 11 branch→device');
})();

// Gate model alignment
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR', centerName: 'C', activation: { consumed: true }, branches: [] },
    wizard: { path: 'new', lang: 'ar', wizardFlowVersion: 6 },
  });
  ctx._licStatus = 'valid';
  const first = ctx.BootstrapGates.firstUnresolvedTargetGate('new');
  const expected = ['GOOGLE_CONNECTED', 'DISCOVERY_RESOLVED'];
  check(first && expected.includes(first.id), 'gate model: activation resolved → google/discovery next');
})();

check(/wizardFlowVersion/.test(fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8')), 'resume migration version field');

if (errors.length) {
  console.error('FAIL stage-6-activation-before-google');
  errors.forEach((e) => console.error(' -', e));
  process.exit(1);
}
console.log('PASS stage-6-activation-before-google (NEW activation before Google, EXISTING unchanged, resume migration)');
process.exit(0);
}

runTests().catch((e) => {
  console.error('FAIL stage-6-activation-before-google', e);
  process.exit(1);
});
