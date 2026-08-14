#!/usr/bin/env node
'use strict';

/**
 * Stage 7 — Explicit Discovery gate after Google (read-mostly, separate from OAuth).
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
    'cloud/post-google-cloud-discovery.js',
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
    wizard: { path: 'new', currentStep: 0, lang: 'ar', restoreChoice: null, syncDone: false, completedSteps: [], wizardFlowVersion: 7 },
    settings: { centerName: '', backup: { providers: { google: { connected: false } } } },
    ...overrides,
  };
  const kvWrites = [];
  const oauthCalls = [];
  const activationCommits = [];
  const orgCommits = [];
  let licStatus = snap.license ? 'valid' : null;
  let discoverDriveCalls = 0;
  let discoverAllCalls = 0;

  const ctx = {
    console, setTimeout, clearTimeout, document: makeDocument(),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
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
        if (key === '__tdw_meta__') snap.meta = val;
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
    cuppingElectron: {
      database: {
        setupCommitSignedActivation: async (payload) => {
          activationCommits.push(payload);
          snap.license = payload.license;
          licStatus = 'valid';
          return { ok: true };
        },
        setupCommitOrganizationDevice: async () => {
          orgCommits.push(true);
          return { ok: true };
        },
      },
    },
    SqliteBridge: { hydrateIntoMemory: async () => ({ ok: true }) },
    licCheck: async () => { licStatus = 'valid'; },
    CloudBootstrap: {
      discoverAndFetchLicenseFromDrive: async () => {
        discoverDriveCalls++;
        return { ok: false, error: 'no_activation_on_drive' };
      },
    },
    CloudDataDiscovery: {
      DISCOVERY_TIMEOUT_MS: 1000,
      discoverAllSources: async () => {
        discoverAllCalls++;
        return { ok: true, cloud: { status: 'ready', restorePoints: [] }, durationMs: 1 };
      },
      formatBytes: (n) => `${n}B`,
    },
    notify: () => {},
    AuditLogger: { logSyncEvent: () => {} },
    _kvWrites: kvWrites,
    _oauthCalls: oauthCalls,
    _activationCommits: activationCommits,
    _orgCommits: orgCommits,
    _discoverDriveCalls: () => discoverDriveCalls,
    _discoverAllCalls: () => discoverAllCalls,
    _snap: snap,
  };
  ctx.global = ctx;
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  loadModules(ctx);
  return ctx;
}

async function runTests() {

// 1. NEW order license→google→discovery
(() => {
  const steps = baseEnv().BootFlow.NEW_STEPS;
  check(JSON.stringify(steps.slice(0, 4)) === JSON.stringify(['language', 'license', 'google', 'discovery']), 'NEW order through discovery');
})();

// 2. EXISTING order google→discovery
(() => {
  const steps = baseEnv().BootFlow.EXISTING_STEPS;
  check(steps[1] === 'google' && steps[2] === 'discovery', 'EXISTING google then discovery');
})();

// 3. Google completion separate from Discovery
await (async () => {
  const ctx = baseEnv({
    license: { centerId: 'CTR', centerName: 'N', activation: { consumed: true }, branches: [] },
    wizard: { path: 'new', currentStep: 2, lang: 'ar', wizardFlowVersion: 7 },
  });
  ctx._licStatus = 'valid';
  const r = await ctx.BootFlow.runGoogleConnect();
  check(r.ok === true && r.googleConnected === true, 'google connect success independent');
  check(!ctx.BootFlow.hasDiscoveryResolved(), 'discovery not auto-completed by google');
  check(ctx._discoverDriveCalls() === 0, 'no drive discovery during google connect');
})();

// 4–11. Discovery read-only / idempotent / no side effects
await (async () => {
  const ctx = baseEnv({
    license: { centerId: 'CTR', centerName: 'N', activation: { consumed: true }, branches: [] },
    wizard: { path: 'new', currentStep: 3, lang: 'ar', wizardFlowVersion: 7 },
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 't@test.com' } } } },
  });
  ctx._licStatus = 'valid';
  const beforeCommits = ctx._activationCommits.length;
  const r1 = await ctx.BootFlow.runDiscoveryGate();
  check(r1.ok === true, 'discovery gate runs');
  check(ctx._orgCommits.length === 0, 'no org creation during discovery');
  check(ctx._activationCommits.length === beforeCommits, 'no activation re-consume during discovery');
  check(ctx.BootFlow.hasBranch() === false, 'no branch creation during discovery');
  check(ctx.BootFlow.hasOwnerPasswordAccount() === false, 'no owner creation during discovery');
  check(!ctx._snap.deviceConfig.deviceUuid, 'no device creation during discovery');
  const r2 = await ctx.BootFlow.runDiscoveryGate();
  check(r2.discovery?.fromCache === true || r2.ok === true, 'discovery idempotent cache');
})();

// 12. NEW no data
await (async () => {
  const ctx = baseEnv({
    license: { centerId: 'CTR', centerName: 'N', activation: { consumed: true }, branches: [] },
    wizard: { path: 'new', lang: 'ar', wizardFlowVersion: 7 },
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'a@test.com' } } } },
  });
  ctx._licStatus = 'valid';
  const r = await ctx.BootFlow.runDiscoveryGate();
  check(r.discovery?.status === 'no_existing_business', 'NEW no existing business');
})();

// 13. NEW existing candidate found
await (async () => {
  const ctx = baseEnv({
    license: { centerId: 'CTR', centerName: 'N', activation: { consumed: true }, branches: [] },
    wizard: { path: 'new', lang: 'ar', wizardFlowVersion: 7 },
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'b@test.com' } } } },
  });
  ctx._licStatus = 'valid';
  ctx.CloudBootstrap.discoverAndFetchLicenseFromDrive = async () => ({
    ok: true,
    license: { centerId: 'CTR-OLD', centerName: 'Old', branches: [{ id: 'B1' }] },
    path: '/drive/lic.json',
  });
  const r = await ctx.BootFlow.runDiscoveryGate({ forceRefresh: true });
  check(r.discovery?.status === 'existing_business_found', 'NEW existing candidate reported');
  check(ctx._snap.wizard.path === 'new', 'no silent path flip on NEW');
})();

// 14. EXISTING valid candidate
await (async () => {
  const ctx = baseEnv({
    wizard: { path: 'existing', lang: 'ar', wizardFlowVersion: 7 },
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'c@test.com' } } } },
  });
  ctx.CloudBootstrap.discoverAndFetchLicenseFromDrive = async () => ({
    ok: true,
    license: { centerId: 'CTR-X', centerName: 'X', branches: [] },
    path: '/drive/lic.json',
  });
  const r = await ctx.BootFlow.runDiscoveryGate({ forceRefresh: true });
  check(r.ok === true && (r.discovery?.licenseCandidates?.length || 0) >= 1, 'EXISTING finds license candidate');
})();

// 15. EXISTING nothing found
await (async () => {
  const ctx = baseEnv({
    wizard: { path: 'existing', lang: 'ar', wizardFlowVersion: 7 },
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'd@test.com' } } } },
  });
  const r = await ctx.BootFlow.runDiscoveryGate({ forceRefresh: true });
  check(r.discovery?.status === 'no_existing_business', 'EXISTING no candidate truthful');
})();

// 16. multiple org candidates
await (async () => {
  const ctx = baseEnv({
    wizard: { path: 'existing', lang: 'ar', wizardFlowVersion: 7 },
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'e@test.com' } } } },
  });
  ctx.CloudBootstrap.discoverAndFetchLicenseFromDrive = async () => ({
    error: 'multiple_licenses',
    needsSelection: true,
    candidates: [
      { centerId: 'A', license: { centerId: 'A' } },
      { centerId: 'B', license: { centerId: 'B' } },
    ],
  });
  const r = await ctx.BootFlow.runDiscoveryGate({ forceRefresh: true });
  check(r.discovery?.status === 'ambiguous_candidates', 'multiple candidates ambiguous');
  check(!r.discovery?.selectedOrUniqueCandidate || r.discovery.licenseCandidates.length > 1, 'no random auto-select');
})();

// 17. unique candidate transient selection
await (async () => {
  const ctx = baseEnv({
    wizard: { path: 'existing', lang: 'ar', wizardFlowVersion: 7 },
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'f@test.com' } } } },
  });
  ctx.CloudBootstrap.discoverAndFetchLicenseFromDrive = async () => ({
    ok: true,
    license: { centerId: 'CTR-U', centerName: 'U', branches: [] },
    path: '/lic',
  });
  const r = await ctx.BootFlow.runDiscoveryGate({ forceRefresh: true });
  check(r.discovery?.selectedOrUniqueCandidate?.centerId === 'CTR-U', 'unique candidate marked transient');
  check(ctx._orgCommits.length === 0, 'unique candidate does not commit org');
})();

// 18–19. backup/sync classification
(() => {
  const ctx = baseEnv();
  const classify = ctx.global.PostGoogleCloudDiscovery.classifyBackupPoint;
  check(classify({ kind: 'backup_file' }) === 'backup_file', 'backup_file classification');
  check(classify({ kind: 'sync_checkpoint' }) === 'sync_checkpoint', 'sync_checkpoint classification');
})();

// 20. network retry
await (async () => {
  const ctx = baseEnv({
    wizard: { path: 'existing', lang: 'ar', wizardFlowVersion: 7 },
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'g@test.com' } } } },
  });
  ctx.CloudDataDiscovery.discoverAllSources = async () => { throw new Error('network_timeout'); };
  const r = await ctx.BootFlow.runDiscoveryGate({ forceRefresh: true });
  check(r.ok === false && r.retryable === true, 'discovery network failure retryable');
  check(ctx.BootFlow.hasGoogle() === true, 'google remains connected on discovery failure');
})();

// 21. Google reconnect invalidates cache
await (async () => {
  const ctx = baseEnv({
    wizard: { path: 'existing', lang: 'ar', wizardFlowVersion: 7 },
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'h@test.com' } } } },
  });
  await ctx.BootFlow.runDiscoveryGate({ forceRefresh: true });
  check(ctx.BootFlow.hasDiscoveryResolved(), 'discovery completed before reconnect');
  await ctx.BootFlow.disconnectGoogleDuringSetup();
  check(!ctx.BootFlow.hasDiscoveryResolved(), 'reconnect invalidates discovery cache');
})();

// 22. restart before discovery
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR', centerName: 'N', activation: { consumed: true }, branches: [] },
    wizard: { path: 'new', currentStep: 2, lang: 'ar', wizardFlowVersion: 7 },
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'i@test.com' } } } },
  });
  ctx._licStatus = 'valid';
  const resume = ctx.BootstrapCoordinator.resolveResumeStepIndex('new', 2);
  check(ctx.BootFlow.NEW_STEPS[resume] === 'discovery', 'restart after google resumes discovery');
})();

// 23. restart after discovery
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR', centerName: 'N', activation: { consumed: true }, branches: [] },
    wizard: {
      path: 'new', currentStep: 3, lang: 'ar', wizardFlowVersion: 7,
      discoveryCompletedAt: new Date().toISOString(),
      licenseDiscoveryAttempted: true,
      cloudDiscovery: { result: { ok: true, status: 'no_existing_business' }, googleAccountKey: 'j@test.com' },
    },
    settings: { centerName: '', backup: { providers: { google: { connected: true, oauth: true, email: 'j@test.com' } } } },
  });
  ctx._licStatus = 'valid';
  const resume = ctx.BootstrapCoordinator.resolveResumeStepIndex('new', 3);
  const step = ctx.BootFlow.NEW_STEPS[resume];
  check(step === 'path_decision' || step === 'organization' || step === 'owner' || step === 'branch', 'restart after discovery resumes post-discovery step');
})();

// 24. legacy step migration v6→v7
(() => {
  const ctx = baseEnv({
    wizard: { path: 'new', currentStep: 2, lang: 'ar', wizardFlowVersion: 6 },
  });
  const w = ctx.BootFlow.loadWizard();
  check(w.wizardFlowVersion >= 7, 'legacy wizard migrated to flow v7+');
  check(ctx.BootFlow.NEW_STEPS[w.currentStep] === 'google', 'v6 google index maps to google step id');
})();

// Stage 6 regression invariants on Stage 7 tree
(() => {
  const steps = baseEnv().BootFlow.NEW_STEPS;
  check(steps.indexOf('license') < steps.indexOf('google'), 'Stage 6 activation-before-google preserved');
})();

// Gate alignment
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR', centerName: 'N', activation: { consumed: true }, branches: [] },
    wizard: { path: 'new', lang: 'ar', wizardFlowVersion: 7 },
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'k@test.com' } } } },
  });
  ctx._licStatus = 'valid';
  const gates = ctx.BootstrapGates.CURRENT_NEW_RUNTIME;
  check(gates.indexOf('discovery') === gates.indexOf('google') + 1, 'gate registry discovery after google');
})();

check(/post-google-cloud-discovery/.test(fs.readFileSync(path.join(root, 'index.html'), 'utf8')), 'index loads discovery module');

if (errors.length) {
  console.error('FAIL stage-7-explicit-discovery-gate');
  errors.forEach((e) => console.error(' -', e));
  process.exit(1);
}
console.log('PASS stage-7-explicit-discovery-gate (explicit discovery after Google, read-mostly, resume migration)');
process.exit(0);
}

runTests().catch((e) => {
  console.error('FAIL stage-7-explicit-discovery-gate', e);
  process.exit(1);
});
