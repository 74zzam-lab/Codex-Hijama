#!/usr/bin/env node
'use strict';

/**
 * Stage 8 — Explicit NEW/EXISTING fork after Discovery.
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
    wizard: { path: 'new', currentStep: 0, lang: 'ar', restoreChoice: null, syncDone: false, completedSteps: [], wizardFlowVersion: 8 },
    settings: { centerName: '', backup: { providers: { google: { connected: false } } } },
    ...overrides,
  };
  const kvWrites = [];
  const activationCommits = [];
  const orgCommits = [];
  let licStatus = snap.license ? 'valid' : null;
  let discoverDriveCalls = 0;

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
      discoverAllSources: async () => ({ ok: true, cloud: { status: 'ready', restorePoints: [] }, durationMs: 1 }),
      formatBytes: (n) => `${n}B`,
    },
    notify: () => {},
    AuditLogger: { logSyncEvent: () => {} },
    _kvWrites: kvWrites,
    _activationCommits: activationCommits,
    _orgCommits: orgCommits,
    _discoverDriveCalls: () => discoverDriveCalls,
    _snap: snap,
  };
  ctx.global = ctx;
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  loadModules(ctx);
  return ctx;
}

function primeDiscovery(ctx, discoveryResult) {
  const email = String(ctx.settings?.backup?.providers?.google?.email || 't@test.com').toLowerCase();
  ctx._snap.wizard.cloudDiscovery = {
    result: discoveryResult,
    googleAccountKey: email,
    completedAt: new Date().toISOString(),
  };
  ctx._snap.wizard.discoveryCompletedAt = new Date().toISOString();
  ctx._snap.wizard.licenseDiscoveryAttempted = true;
  ctx._snap.wizard.discoveryStatus = discoveryResult.status;
  if (!discoveryResult.forkClassification && ctx.global.PostGoogleCloudDiscovery) {
    discoveryResult.forkClassification = ctx.global.PostGoogleCloudDiscovery.classifyForkScenario(discoveryResult);
    discoveryResult.requiresPathFork = ctx.global.PostGoogleCloudDiscovery.requiresPathFork(discoveryResult.forkClassification);
  }
}

async function runTests() {
// 1. no existing → no fork required
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR', centerName: 'N', activation: { consumed: true }, branches: [] },
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 't@test.com' } } } },
  });
  ctx._licStatus = 'valid';
  primeDiscovery(ctx, {
    ok: true,
    status: 'no_existing_business',
    forkClassification: 'no_existing_business',
    organizationCandidates: [],
    licenseCandidates: [],
    backupCandidates: [],
  });
  check(ctx.BootFlow.needsPathForkDecision() === false, 'no existing → no fork');
  check(ctx.BootFlow.hasPathDecisionResolved() === true, 'path decision auto-resolved when no fork');
})();

// 2. unique existing → fork required
(() => {
  const ctx = baseEnv({
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'u@test.com' } } } },
  });
  primeDiscovery(ctx, {
    ok: true,
    status: 'existing_business_found',
    forkClassification: 'unique_existing_business',
    organizationCandidates: [{ id: 'CTR-OLD', centerId: 'CTR-OLD', centerName: 'Old' }],
    licenseCandidates: [{ id: 'lic-1', centerId: 'CTR-OLD' }],
    backupCandidates: [],
  });
  check(ctx.BootFlow.needsPathForkDecision() === true, 'unique existing → fork required');
})();

// 3. path remains NEW before decision
(() => {
  const ctx = baseEnv({
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'v@test.com' } } } },
  });
  primeDiscovery(ctx, {
    ok: true,
    forkClassification: 'unique_existing_business',
    organizationCandidates: [{ id: 'CTR-X', centerId: 'CTR-X' }],
    licenseCandidates: [],
  });
  check(ctx._snap.wizard.path === 'new', 'path remains NEW before decision');
})();

// 4. choose existing
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR-NEW', centerName: 'New', activation: { consumed: true }, branches: [] },
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'w@test.com' } } } },
  });
  ctx._licStatus = 'valid';
  primeDiscovery(ctx, {
    ok: true,
    forkClassification: 'unique_existing_business',
    organizationCandidates: [{ id: 'CTR-OLD', centerId: 'CTR-OLD', centerName: 'Old' }],
    licenseCandidates: [{ id: 'lic-1', centerId: 'CTR-OLD' }],
  });
  const r = ctx.BootFlow.commitForkUseExisting();
  check(r.ok === true && r.path === 'existing', 'choose existing flips path once');
  check(ctx.BootFlow.EXISTING_STEPS[ctx._snap.wizard.currentStep] === 'license', 'resume EXISTING at license');
})();

// 5. choose new
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR-NEW', centerName: 'New', activation: { consumed: true }, branches: [] },
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'x@test.com' } } } },
  });
  ctx._licStatus = 'valid';
  primeDiscovery(ctx, {
    ok: true,
    forkClassification: 'unique_existing_business',
    organizationCandidates: [{ id: 'CTR-OLD', centerId: 'CTR-OLD' }],
    licenseCandidates: [],
  });
  const r = ctx.BootFlow.commitForkStartNew();
  check(r.ok === true && ctx._snap.wizard.path === 'new', 'choose new keeps NEW');
  check(ctx.BootFlow.hasPathDecisionResolved() === true, 'start new resolves fork');
})();

// 6. cancel — no decision
(() => {
  const ctx = baseEnv({
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'y@test.com' } } } },
  });
  primeDiscovery(ctx, {
    ok: true,
    forkClassification: 'unique_existing_business',
    organizationCandidates: [{ id: 'CTR-OLD', centerId: 'CTR-OLD' }],
    licenseCandidates: [],
  });
  check(!ctx._snap.wizard.forkDecision, 'cancel leaves decision unresolved');
  check(ctx.BootFlow.hasPathDecisionResolved() === false, 'unresolved fork blocks advance');
})();

// 7–10. no entity creation at fork
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR-NEW', centerName: 'New', activation: { consumed: true }, branches: [] },
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'z@test.com' } } } },
  });
  ctx._licStatus = 'valid';
  primeDiscovery(ctx, {
    ok: true,
    forkClassification: 'unique_existing_business',
    organizationCandidates: [{ id: 'CTR-OLD', centerId: 'CTR-OLD' }],
    licenseCandidates: [],
  });
  check(ctx._orgCommits.length === 0, 'no org creation at fork');
  check(ctx.BootFlow.hasBranch() === false, 'no branch at fork');
  check(ctx.BootFlow.hasOwnerPasswordAccount() === false, 'no owner at fork');
  check(!ctx._snap.deviceConfig.deviceUuid, 'no device at fork');
})();

// 11. no restore/sync at fork
(() => {
  const ctx = baseEnv();
  primeDiscovery(ctx, {
    ok: true,
    forkClassification: 'unique_existing_business',
    organizationCandidates: [{ id: 'A', centerId: 'A' }],
    licenseCandidates: [],
    backupCandidates: [{ id: 'b1', classification: 'backup_file' }],
  });
  check(!ctx._snap.wizard.restoreChoice, 'no restore at fork');
  check(ctx._snap.wizard.syncDone !== true, 'no sync at fork');
})();

// 13. multiple candidates
(() => {
  const ctx = baseEnv({
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'm@test.com' } } } },
  });
  primeDiscovery(ctx, {
    ok: true,
    forkClassification: 'ambiguous_candidates',
    organizationCandidates: [
      { id: 'A', centerId: 'A', centerName: 'A' },
      { id: 'B', centerId: 'B', centerName: 'B' },
    ],
    licenseCandidates: [],
  });
  const r = ctx.BootFlow.commitForkUseExisting();
  check(r.ok === false && r.error === 'candidate_selection_required', 'multiple candidates require selection');
  const r2 = ctx.BootFlow.commitForkUseExisting('A');
  check(r2.ok === true, 'selection then use existing');
})();

// 15–17. restart scenarios
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR-NEW', centerName: 'N', activation: { consumed: true }, branches: [] },
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'r1@test.com' } } } },
  });
  ctx._licStatus = 'valid';
  primeDiscovery(ctx, {
    ok: true,
    forkClassification: 'unique_existing_business',
    organizationCandidates: [{ id: 'CTR-OLD', centerId: 'CTR-OLD' }],
    licenseCandidates: [],
  });
  ctx._snap.wizard.currentStep = ctx.BootFlow.NEW_STEPS.indexOf('path_decision');
  const resume = ctx.BootstrapCoordinator.resolveResumeStepIndex('new', ctx._snap.wizard.currentStep);
  check(ctx.BootFlow.NEW_STEPS[resume] === 'path_decision', 'restart before decision → fork');
})();

(() => {
  const ctx = baseEnv({
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'r2@test.com' } } } },
  });
  primeDiscovery(ctx, {
    ok: true,
    forkClassification: 'unique_existing_business',
    organizationCandidates: [{ id: 'CTR-OLD', centerId: 'CTR-OLD' }],
    licenseCandidates: [],
  });
  ctx.BootFlow.commitForkUseExisting();
  const resume = ctx.BootstrapCoordinator.resolveResumeStepIndex('existing', ctx._snap.wizard.currentStep);
  check(ctx.BootFlow.EXISTING_STEPS[resume] === 'license', 'restart after existing → EXISTING license');
})();

(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR-NEW', centerName: 'N', activation: { consumed: true }, branches: [] },
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'r3@test.com' } } } },
  });
  ctx._licStatus = 'valid';
  primeDiscovery(ctx, {
    ok: true,
    forkClassification: 'unique_existing_business',
    organizationCandidates: [{ id: 'CTR-OLD', centerId: 'CTR-OLD' }],
    licenseCandidates: [],
  });
  ctx.BootFlow.commitForkStartNew();
  const resume = ctx.BootstrapCoordinator.resolveResumeStepIndex('new', ctx._snap.wizard.currentStep);
  const forkIdx = ctx.BootFlow.NEW_STEPS.indexOf('path_decision');
  check(resume > forkIdx, 'restart after new → past fork toward organization');
})();

// 18. account change invalidates
(() => {
  const ctx = baseEnv({
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'a1@test.com' } } } },
  });
  primeDiscovery(ctx, {
    ok: true,
    forkClassification: 'unique_existing_business',
    organizationCandidates: [{ id: 'CTR-OLD', centerId: 'CTR-OLD' }],
    licenseCandidates: [],
  });
  ctx.BootFlow.commitForkStartNew();
  ctx.settings.backup.providers.google.email = 'other@test.com';
  check(ctx.global.PostGoogleCloudDiscovery.isForkDecisionValid(ctx._snap.wizard) === false, 'account change invalidates fork');
})();

// 19. refresh invalidates
(() => {
  const ctx = baseEnv({
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'a2@test.com' } } } },
  });
  primeDiscovery(ctx, {
    ok: true,
    forkClassification: 'unique_existing_business',
    organizationCandidates: [{ id: 'CTR-OLD', centerId: 'CTR-OLD' }],
    licenseCandidates: [],
  });
  ctx.BootFlow.commitForkStartNew();
  const oldFp = ctx._snap.wizard.forkDiscoveryFingerprint;
  ctx._snap.wizard.cloudDiscovery.result = {
    ...ctx._snap.wizard.cloudDiscovery.result,
    organizationCandidates: [{ id: 'CTR-NEW2', centerId: 'CTR-NEW2' }],
  };
  const newFp = ctx.global.PostGoogleCloudDiscovery.discoveryFingerprint(ctx._snap.wizard.cloudDiscovery.result);
  check(oldFp !== newFp && ctx.global.PostGoogleCloudDiscovery.isForkDecisionValid(ctx._snap.wizard) === false, 'discovery fingerprint change invalidates');
})();

// 20. direct EXISTING unaffected
(() => {
  const ctx = baseEnv({ wizard: { path: 'existing', lang: 'ar', wizardFlowVersion: 8 } });
  check(ctx.BootFlow.needsPathForkDecision() === false, 'direct EXISTING no NEW fork');
})();

// 21–22. activation retained, no duplicate consume
(() => {
  const ctx = baseEnv({
    license: { centerId: 'CTR-NEW', centerName: 'New', activation: { consumed: true }, branches: [] },
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'act@test.com' } } } },
  });
  ctx._licStatus = 'valid';
  const before = ctx._activationCommits.length;
  primeDiscovery(ctx, {
    ok: true,
    forkClassification: 'unique_existing_business',
    organizationCandidates: [{ id: 'CTR-OLD', centerId: 'CTR-OLD' }],
    licenseCandidates: [{ id: 'lic-old', centerId: 'CTR-OLD' }],
  });
  ctx.BootFlow.commitForkUseExisting();
  check(ctx._activationCommits.length === before, 'no duplicate activation consume on use existing');
  check(ctx.BootFlow.hasValidLicense() === true, 'activation retained locally after use existing choice');
})();

// 23. cached discovery reused
(() => {
  const ctx = baseEnv({
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'cache@test.com' } } } },
  });
  primeDiscovery(ctx, { ok: true, forkClassification: 'no_existing_business', organizationCandidates: [], licenseCandidates: [] });
  const d1 = ctx.BootFlow.getCachedDiscoveryResult();
  const d2 = ctx.BootFlow.getCachedDiscoveryResult();
  check(d1 && d2 && d1.status === d2.status, 'cached discovery reused');
})();

// 24–26. partial / backup-only / license-only
(() => {
  const PG = baseEnv().global.PostGoogleCloudDiscovery;
  check(PG.classifyForkScenario({ ok: true, backupCandidates: [{ classification: 'backup_file' }], organizationCandidates: [], licenseCandidates: [] }) === 'backup_only', 'backup-only');
  check(PG.classifyForkScenario({ ok: true, licenseCandidates: [{ id: 'l1', centerId: 'C1' }], organizationCandidates: [] }) === 'license_only', 'license-only');
  check(PG.classifyForkScenario({ ok: true, branchCandidates: [{ id: 'b1' }], organizationCandidates: [], licenseCandidates: [] }) === 'partial_existing_state', 'partial existing');
  check(PG.requiresPathFork('backup_only') === true, 'backup-only requires fork');
})();

// Gate integration
(() => {
  const ctx = baseEnv({
    settings: { backup: { providers: { google: { connected: true, oauth: true, email: 'g@test.com' } } } },
  });
  primeDiscovery(ctx, {
    ok: true,
    forkClassification: 'unique_existing_business',
    organizationCandidates: [{ id: 'CTR-OLD', centerId: 'CTR-OLD' }],
    licenseCandidates: [],
  });
  const gate = ctx.BootstrapGates.evaluateGate('PATH_DECISION_RESOLVED', 'new');
  check(gate.status === 'missing', 'gate missing until fork resolved');
})();

// NEW steps include path_decision
(() => {
  const steps = baseEnv().BootFlow.NEW_STEPS;
  check(steps.indexOf('path_decision') === steps.indexOf('discovery') + 1, 'path_decision after discovery');
})();

check(/path_decision/.test(fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8')), 'boot flow has path_decision step');

if (errors.length) {
  console.error('FAIL stage-8-explicit-new-existing-fork');
  errors.forEach((e) => console.error(' -', e));
  process.exit(1);
}
console.log('PASS stage-8-explicit-new-existing-fork (explicit NEW/EXISTING fork, no silent flip)');
process.exit(0);
}

runTests().catch((e) => {
  console.error('FAIL stage-8-explicit-new-existing-fork', e);
  process.exit(1);
});
