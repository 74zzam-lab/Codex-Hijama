#!/usr/bin/env node
'use strict';

/**
 * Production-path Bootstrap acceptance — loads real boot-flow-ui.js, real DOM stubs,
 * real event handlers, and exercises the renderer state machine (not helper-only).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const bootSrc = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
const registrySrc = fs.readFileSync(path.join(root, 'electron/cloud-providers/registry.js'), 'utf8');
const cloudSvcSrc = fs.readFileSync(path.join(root, 'electron/cloud-providers/cloud-service.js'), 'utf8');
const failures = [];
let passed = 0;

function check(ok, msg) {
  if (ok) { passed += 1; return; }
  failures.push(msg);
}

function makeElement(tagOrId) {
  const attrs = {};
  const children = [];
  let textContent = '';
  let disabled = false;
  const classes = new Set();
  const el = {
    id: typeof tagOrId === 'string' && !String(tagOrId).includes(' ') ? tagOrId : '',
    tagName: tagOrId, hidden: false, style: { cssText: '' }, className: '', value: '', dataset: {},
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: () => {} },
    appendChild(c) { children.push(c); return c; },
    append(...k) { children.push(...k); },
    querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {},
    getAttribute: (k) => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = v; },
    removeAttribute: (k) => { delete attrs[k]; }, focus: () => {}, remove: () => {},
    get children() { return children; },
    get disabled() { return disabled; },
    set disabled(v) { disabled = !!v; },
  };
  Object.defineProperty(el, 'textContent', { get: () => textContent, set: (v) => { textContent = v; if (v === '') children.length = 0; } });
  Object.defineProperty(el, 'innerHTML', { get: () => textContent, set: (v) => { textContent = v; } });
  return el;
}

function makeDocument() {
  const byId = new Map();
  const ensure = (id) => { if (!byId.has(id)) byId.set(id, makeElement(id)); return byId.get(id); };
  const register = (el) => {
    if (el && el.id) byId.set(el.id, el);
    return el;
  };
  const baseMake = (tagOrId) => {
    const el = makeElement(tagOrId);
    const origAppend = el.appendChild.bind(el);
    el.appendChild = (c) => { if (c?.id) register(c); return origAppend(c); };
    return el;
  };
  return {
    body: baseMake('body'), head: { appendChild: () => {} },
    getElementById: (id) => byId.get(id) || ensure(id),
    querySelector: (s) => { const m = String(s || '').match(/#([A-Za-z0-9_-]+)/); return m ? (byId.get(m[1]) || ensure(m[1])) : null; },
    querySelectorAll: () => [], createElement: (t) => register(baseMake(t)),
  };
}

function seedBootstrapDom(document) {
  const ids = [
    'bf-progress', 'bf-stepper', 'bf-step-meta', 'bf-step-label', 'bf-step-hint', 'bf-wizard-title',
    'bf-step-nav', 'bf-step-content', 'bf-step-actions', 'bf-wizard-status',
    'bf-checklist-panel', 'bf-checklist-list', 'bf-checklist-bar', 'bf-checklist-pct',
    'bf-branch-id',
  ];
  ids.forEach((id) => document.getElementById(id));
}

function liveWizard(overrides = {}) {
  const snap = {
    license: {
      centerId: 'NJR-1', centerName: 'Clinic', activation: { consumed: true },
      branches: overrides.licenseBranches || [{ id: 'BR-MAIN', active: true }, { id: 'BR-2', active: true }],
    },
    meta: { centerId: 'NJR-1' },
    deviceConfig: overrides.deviceConfig || {},
    users: overrides.users || [],
    wizard: {
      path: 'existing', currentStep: 4, lang: 'ar', completedSteps: ['language', 'google', 'discovery', 'license_org_recovery'],
      wizardFlowVersion: 16, discoveryCompletedAt: '2026-08-16T09:00:00.000Z', restoreChoice: null, syncDone: false,
      ...(overrides.wizard || {}),
    },
    settings: { centerName: 'Clinic', phone: '05', backup: { providers: { google: { connected: true, oauth: true, email: 'o@e.com' } } } },
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
        if (k === '__tdw_device_config__') snap.deviceConfig = v;
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
        organizationCandidates: [{ id: 'NJR-1' }],
        licenseCandidates: [{ centerId: 'NJR-1' }],
        backupCandidates: [],
        branchCandidates: [{ id: 'BR-MAIN', source: 'cloud', verified: true }, { id: 'BR-2', source: 'cloud', verified: true }],
        syncCandidates: [],
      }),
      hasDiscoveryResolved: () => true,
      runPostGoogleCloudDiscovery: async () => ({
        ok: true, status: 'existing_business_found',
        organizationCandidates: [{ id: 'NJR-1' }],
        licenseCandidates: [{ centerId: 'NJR-1' }],
        backupCandidates: [],
        branchCandidates: [{ id: 'BR-MAIN' }, { id: 'BR-2' }],
      }),
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
    'cloud/business-setup-contract.js', 'cloud/publication-contract.js', 'cloud/readback-verification-contract.js',
    'cloud/initial-sync-direction-contract.js', 'cloud/existing-short-path-contract.js',
    'cloud/bootstrap-step-model.js', 'cloud/bootstrap-checklist-contract.js',
    'cloud/bootstrap-failure-policy-contract.js', 'cloud/ipc-error-envelope.js',
    'cloud/ready-pure-evaluator.js', 'cloud/setup-state-service.js', 'cloud/bootstrap-coordinator.js',
    'cloud/bootstrap-gates.js', 'cloud/setup-state-dom.js', 'cloud/boot-flow-ui.js',
  ]) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
  }
  return ctx;
}

function sourceWiringTests() {
  console.log('\n-- production wiring (source) --');
  check(/function captureRenderContext/.test(bootSrc), 'captureRenderContext defined');
  check(/function guardedRender/.test(bootSrc), 'guardedRender defined');
  check(/isRenderCurrent\(/.test(bootSrc), 'isRenderCurrent used in production');
  check(/guardedRender\(renderCtx/.test(bootSrc), 'async handlers use guardedRender');
  check(/resolveStepIdFromIndex/.test(bootSrc), 'currentStepId delegates to BootstrapStepModel');
  check(/body\.bf-active #backupPasswordModal\.open/.test(bootSrc), 'password modal z-index above bootstrap');
  check(/options\.signal/.test(registrySrc), 'resolveActiveProviderKey accepts AbortSignal');
  check(/resolveActiveProviderKey\(id,\s*\{\s*signal:\s*options\.signal\s*\}\)/.test(cloudSvcSrc),
    'downloadCloudBackup passes signal to resolveActiveProviderKey');
  check(!/lic\.branches \|\| \[\]\)\.find/.test(bootSrc) || !/selectExistingBranchOnly[\s\S]{0,800}lic\.branches/.test(bootSrc),
    'branch confirm does not accept unfiltered lic.branches fallback');
}

function existingJourneyTests() {
  console.log('\n-- EXISTING production-path journey (renderer) --');
  const ctx = liveWizard();
  const BF = ctx.BootFlow;
  const SM = ctx.BootstrapStepModel;

  seedBootstrapDom(ctx.document);

  // Path persistence: existing path survives render cycle.
  BF.renderAll(ctx.DB.get('__tdw_boot_wizard__'));
  check(ctx._snap.wizard.path === 'existing', 'wizard.path remains existing after renderAll');

  const frame = BF.describeCurrentStep();
  check(frame.stepId === 'branch_select', `lands on branch_select (${frame.stepId})`);
  check(frame.stepNumber === 5 && frame.totalSteps === 10,
    `step X/Y is 5/10 (${frame.stepNumber}/${frame.totalSteps})`);

  const checklist = ctx.BootstrapChecklistContract.buildChecklistModel(BF.getChecklistUiContext());
  const active = checklist.items.find((i) => i.active);
  check(active?.id === frame.stepId, 'checklist active step matches header/body');

  // Next blocked until branch confirmed (authoritative gate contract).
  BF.renderAll(ctx.DB.get('__tdw_boot_wizard__'));
  check(BF.validateStep('branch_select') === false, 'validateStep false before branch confirm');
  const beforeAdvance = BF.describeCurrentStep().stepId;
  return Promise.resolve(BF.advanceWizard()).then(() => {
    check(BF.describeCurrentStep().stepId === beforeAdvance,
      'Next/advance blocked before branch confirm');
    ctx.document.getElementById('bf-branch-id').value = 'BR-2';
    return Promise.resolve(BF.selectExistingBranchOnly());
  }).then((r) => {
    check(r?.ok === true, 'branch confirm handler succeeds');
    const pinned = BF.describeCurrentStep();
    check(pinned.stepId === 'branch_select', `stays on branch_select until Next (${pinned.stepId})`);
    const bodyStep = ctx.document.getElementById('bf-step-content')?.dataset?.stepId
      || ctx.document.getElementById('bf-step-content')?.getAttribute?.('data-step-id');
    check(bodyStep === 'branch_select', `body matches branch_select (${bodyStep})`);
    check(BF.validateStep('branch_select') === true, 'validateStep true after confirm');
    const nextAfter = ctx.document.getElementById('bf-next-btn');
    check(!nextAfter || nextAfter.disabled === false, 'Next enabled after branch confirm');
    return Promise.resolve(BF.advanceWizard());
  }).then(() => {
    const after = BF.describeCurrentStep();
    check(after.stepId === 'device', `advance moves to device (${after.stepId})`);
    check(SM.getApplicableSteps('existing', { path: 'existing' }).indexOf('device')
      === SM.getApplicableSteps('existing', { path: 'existing' }).indexOf('branch_select') + 1,
      'device follows branch_select in authoritative sequence');
  });
}

function staleAsyncGuardTests() {
  console.log('\n-- stale async render guard (runtime) --');
  const ctx = liveWizard();
  const BF = ctx.BootFlow;
  BF.renderAll(ctx.DB.get('__tdw_boot_wizard__'));
  const gen = BF.currentRenderGeneration();
  const step = BF.describeCurrentStep().stepId;
  BF.renderAll(ctx.DB.get('__tdw_boot_wizard__'));
  check(BF.isRenderCurrent(gen, step) === false, 'stale generation rejected after navigation');
  check(BF.isRenderCurrent(BF.currentRenderGeneration(), BF.describeCurrentStep().stepId) === true,
    'current generation accepted for active step');
}

function reviewStepIndexLocalStorageAuthorityTest() {
  console.log('\n-- reviewStepIndex honors loadWizard state when DB lags --');
  const ctx = liveWizard();
  const BC = ctx.BootstrapCoordinator;
  const loaded = {
    path: 'existing',
    currentStep: 4,
    reviewStepIndex: 4,
    completedSteps: ['language', 'google', 'discovery', 'license_org_recovery', 'branch_select'],
    branchSelection: { branchId: 'BR-2', provenance: 'user', organizationId: 'NJR-1', googleAccountKey: 'o@e.com' },
    wizardFlowVersion: 16,
  };
  const eff = BC.effectiveStepIndex(loaded);
  check(eff === 4, `effectiveStepIndex stays pinned at branch_select (${eff})`);
}

(async function main() {
  try {
    sourceWiringTests();
    staleAsyncGuardTests();
    reviewStepIndexLocalStorageAuthorityTest();
    await existingJourneyTests();
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
    console.log('OK bootstrap production-path acceptance');
  }
})();
