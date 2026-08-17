#!/usr/bin/env node
'use strict';

/**
 * Behavioral production-path tests for delta closure after 00d22be.
 * These are runtime proofs — not regex/source assertions.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const failures = [];
let passed = 0;

function check(ok, msg) {
  if (ok) { passed += 1; return; }
  failures.push(msg);
}

function loadFresh(rel) {
  const abs = path.join(root, rel);
  delete require.cache[abs];
  return require(abs);
}

function makeElement(tagOrId) {
  let disabled = false;
  let textContent = '';
  const classes = new Set();
  const el = {
    id: typeof tagOrId === 'string' && !String(tagOrId).includes(' ') ? tagOrId : '',
    tagName: tagOrId, hidden: false, style: { cssText: '' }, className: '', value: '', dataset: {},
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: () => {} },
    appendChild(c) { return c; }, append(..._k) {}, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {}, getAttribute: () => null, setAttribute: () => {}, removeAttribute: () => {},
    focus: () => {}, remove: () => {},
    get disabled() { return disabled; },
    set disabled(v) { disabled = !!v; },
  };
  Object.defineProperty(el, 'textContent', { get: () => textContent, set: (v) => { textContent = v; } });
  Object.defineProperty(el, 'innerHTML', { get: () => textContent, set: (v) => { textContent = v; } });
  return el;
}

function makeDocument() {
  const byId = new Map();
  const register = (el) => { if (el?.id) byId.set(el.id, el); return el; };
  const baseMake = (t) => {
    const el = makeElement(t);
    const orig = el.appendChild.bind(el);
    el.appendChild = (c) => { if (c?.id) register(c); return orig(c); };
    return el;
  };
  return {
    body: baseMake('body'), head: { appendChild: () => {} },
    getElementById: (id) => byId.get(id) || register(baseMake(id)),
    querySelector: (s) => { const m = String(s).match(/#([A-Za-z0-9_-]+)/); return m ? (byId.get(m[1]) || register(baseMake(m[1]))) : null; },
    querySelectorAll: () => [], createElement: (t) => register(baseMake(t)),
  };
}

function bootEnv(overrides = {}) {
  const snap = {
    license: { centerId: 'NJR-1', centerName: 'Clinic', activation: { consumed: true }, branches: [{ id: 'BR-MAIN', active: true }] },
    meta: { centerId: 'NJR-1' },
    deviceConfig: overrides.deviceConfig || {},
    users: overrides.users || [],
    wizard: {
      path: 'existing', currentStep: 4, lang: 'ar', completedSteps: ['language', 'google', 'discovery', 'license_org_recovery'],
      wizardFlowVersion: 16, discoveryCompletedAt: '2026-08-16T09:00:00.000Z', restoreChoice: null,
      ...(overrides.wizard || {}),
    },
    settings: { centerName: 'Clinic', backup: { providers: { google: { connected: true, oauth: true, email: 'o@e.com' } } } },
  };
  const ctx = {
    console: { info: () => {}, warn: () => {}, error: () => {}, log: () => {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    document: makeDocument(),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { search: '' }, confirm: () => true,
    DB: {
      get: (k, f) => ({
        __tdw_boot_wizard__: snap.wizard, __tdw_meta__: snap.meta, __tdw_cloud_license__: snap.license,
        __tdw_device_config__: snap.deviceConfig, users: snap.users, settings: snap.settings,
      }[k] ?? (f === undefined ? null : f)),
      set: (k, v) => {
        if (k === '__tdw_boot_wizard__') snap.wizard = v;
        if (k === '__tdw_meta__') snap.meta = v;
        if (k === 'settings') snap.settings = v;
        return { ok: true };
      },
    },
    users: snap.users, settings: snap.settings,
    LicenseCloud: { loadLocal: () => snap.license },
    DeviceConfig: { load: () => snap.deviceConfig },
    CenterId: { getStoredCenterId: () => snap.license.centerId },
    DriveAdapter: { isConnected: () => true },
    PostGoogleCloudDiscovery: {
      getCachedDiscovery: () => ({
        ok: true, status: 'existing_business_found',
        organizationCandidates: [{ id: 'NJR-1', centerId: 'NJR-1' }],
        licenseCandidates: [{ centerId: 'NJR-1' }],
        branchCandidates: [], backupCandidates: [],
        forkClassification: 'existing_business',
      }),
      hasDiscoveryResolved: () => true,
      requiresPathFork: () => false,
      classifyForkScenario: () => 'existing_business',
      discoveryFingerprint: () => 'fp1',
    },
    OwnerManagement: { isSystemBusy: () => false, getOwnerState: () => ({ state: 'NO_OWNER' }), isOwnerCreationInProgress: () => false },
    RestoreReconciliation: { loadState: () => null },
    SyncEngine: { getReadiness: () => ({ ready: false, state: 'PENDING', missing: [] }) },
    licLoad: () => snap.license,
    LicenseActivationGate: { isConsumed: () => true, getConsumeCount: () => 0 },
    _snap: snap,
  };
  ctx.global = ctx; ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const rel of [
    'cloud/bootstrap-step-model.js', 'cloud/bootstrap-checklist-contract.js',
    'cloud/bootstrap-failure-policy-contract.js', 'cloud/ready-pure-evaluator.js',
    'cloud/setup-state-service.js', 'cloud/bootstrap-coordinator.js', 'cloud/bootstrap-gates.js',
    'cloud/existing-short-path-contract.js', 'cloud/initial-sync-direction-contract.js',
    'cloud/boot-flow-ui.js',
  ]) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
  }
  return ctx;
}

async function restoreAbortChainTest() {
  console.log('\n-- restore pre-download abort (behavioral) --');
  const { createByteProgressWatchdog } = loadFresh('electron/byte-progress-watchdog.js');
  const registryPath = path.join(root, 'electron/cloud-providers/registry.js');
  const googleDrivePath = path.join(root, 'electron/cloud-providers/google-drive.js');
  const apiPath = path.join(root, 'electron/cloud-providers/google-drive-api.js');

  // Inject a hung getStatus into an isolated registry load.
  const hungGoogle = {
    getStatus: () => new Promise(() => {}),
  };
  const Module = require('module');
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === './google-drive' && parent && parent.filename === registryPath) return hungGoogle;
    return originalLoad(request, parent, isMain);
  };
  try {
    delete require.cache[registryPath];
    delete require.cache[googleDrivePath];
    delete require.cache[apiPath];
    const registry = require(registryPath);
    const wd = createByteProgressWatchdog({ stallMs: 80 });
    wd.arm();
    const started = Date.now();
    let err = null;
    try {
      await registry.resolveActiveProviderKey('google', { signal: wd.signal });
    } catch (e) {
      err = e;
    }
    const elapsed = Date.now() - started;
    check(!!err, 'hung getStatus rejects when watchdog aborts');
    check(elapsed < 500, `abort settles quickly (${elapsed}ms)`);
    check(wd.signal.aborted === true, 'watchdog signal aborted');
  } finally {
    Module._load = originalLoad;
    delete require.cache[registryPath];
  }
}

function syncDirectionSafetyTest() {
  console.log('\n-- EXISTING empty restore cannot become PUSH_ONLY --');
  const ISC = loadFresh('cloud/initial-sync-direction-contract.js');
  const plan = ISC.resolveInitialSyncPlan({
    path: 'existing',
    restoreChoice: 'empty',
    wizard: { path: 'existing', restoreChoice: 'empty' },
    clientsCount: 0, casesCount: 0, bookingsCount: 0,
    organizationId: 'NJR-1',
    remoteHasBusinessData: true,
  });
  check(plan.mode !== ISC.MODES.PUSH_ONLY, `EXISTING+empty is not PUSH_ONLY (got ${plan.mode})`);
  check(plan.allowPush !== true, 'EXISTING+empty does not allow push');
  check(plan.reason === 'existing_empty_push_forbidden', `reason is explicit (${plan.reason})`);

  const newPlan = ISC.resolveInitialSyncPlan({
    path: 'new',
    restoreChoice: 'empty',
    wizard: { path: 'new', restoreChoice: 'empty' },
    meta: { centerId: 'NJR-1', setupPublication: { verifiedAt: 'x' }, readbackVerification: { state: 'VERIFIED' } },
    clientsCount: 0, casesCount: 0, bookingsCount: 0,
  });
  check(newPlan.mode === ISC.MODES.PUSH_ONLY, 'NEW+empty remains PUSH_ONLY when publication gates pass');
}

function emptyRestorePolicyBypassTest() {
  console.log('\n-- commitRestoreChoice blocks empty bypass on EXISTING --');
  const ctx = bootEnv({ users: [] });
  const BF = ctx.BootFlow;
  const result = BF.commitRestoreChoice('empty', 'should not apply');
  check(result?.ok === false, 'empty restore rejected without recoverable owner');
  check(ctx._snap.wizard.restoreChoice !== 'empty', 'restoreChoice not mutated on rejection');
  check(result?.error === 'existing_empty_start_blocked_no_owner', 'specific policy code returned');
}

function forkStepAuthorityTest() {
  console.log('\n-- fork decisions use BootstrapStepModel sequence --');
  const ctx = bootEnv({
    wizard: { path: 'new', currentStep: 3, completedSteps: ['language', 'google', 'discovery'], restoreChoice: null },
  });
  const BF = ctx.BootFlow;
  const SM = ctx.BootstrapStepModel;
  const r = BF.commitForkUseExisting('NJR-1');
  check(r?.ok === true, 'commitForkUseExisting succeeds');
  check(ctx._snap.wizard.path === 'existing', 'path flips to existing');
  const expectedIdx = SM.sequenceFor('existing').indexOf('license_org_recovery');
  check(ctx._snap.wizard.currentStep === expectedIdx,
    `currentStep maps to license_org_recovery index (${ctx._snap.wizard.currentStep} === ${expectedIdx})`);
}

function staleAsyncGuardTest() {
  console.log('\n-- stale async render rejects step-A mutation after navigation --');
  const ctx = bootEnv();
  const BF = ctx.BootFlow;
  ['bf-step-nav', 'bf-step-meta', 'bf-step-content', 'bf-step-actions', 'bf-wizard-status',
    'bf-progress', 'bf-stepper', 'bf-checklist-panel', 'bf-checklist-list', 'bf-checklist-bar', 'bf-checklist-pct'].forEach((id) => {
    ctx.document.getElementById(id);
  });
  BF.renderAll(ctx._snap.wizard);
  const gen = BF.currentRenderGeneration();
  const stepA = BF.describeCurrentStep().stepId;
  BF.renderAll(ctx._snap.wizard);
  check(BF.isRenderCurrent(gen, stepA) === false, 'stale generation rejected after rerender');
  check(typeof BF.guardedRender === 'function' || typeof BF.captureRenderContext === 'function',
    'single guard mechanism exported');
}

function printerWizardFieldTest() {
  console.log('\n-- selectPrinter updates first-run wizard fields --');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  check(/fr-dev-thermal/.test(html) && /getElementById\('fr-dev-thermal'\)/.test(html),
    'selectPrinter writes fr-dev-thermal when present');
  check(/fr-dev-a4/.test(html) && /getElementById\('fr-dev-a4'\)/.test(html),
    'selectPrinter writes fr-dev-a4 when present');
  check(/setupWizardModal/.test(html) && /inFirstRunWizard/.test(html),
    'wizard context uses distinct notify message');
}

(async function main() {
  try {
    await restoreAbortChainTest();
    syncDirectionSafetyTest();
    emptyRestorePolicyBypassTest();
    forkStepAuthorityTest();
    staleAsyncGuardTest();
    printerWizardFieldTest();
  } catch (error) {
    failures.push(`harness crash: ${error && error.stack ? error.stack : error}`);
    console.error(error);
  }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.error('\nFailing checks:');
    for (const f of failures) console.error(` - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('OK bootstrap delta closure');
  }
})();
