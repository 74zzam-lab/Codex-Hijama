#!/usr/bin/env node
'use strict';

/**
 * Bootstrap step numbering + Next/Back navigation.
 *
 * Guards the defect where the header ("الخطوة 4 من 10"), the step body and the
 * side checklist could describe three different steps, because the order lived
 * in several arrays and only the checklist filtered conditional steps.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const failures = [];
let passed = 0;
function check(cond, msg) {
  if (cond) { passed += 1; console.log(`PASS  ${msg}`); } else { failures.push(msg); console.error(`FAIL  ${msg}`); }
}

const SM = require(path.join(root, 'cloud/bootstrap-step-model.js'));
const BCC = require(path.join(root, 'cloud/bootstrap-checklist-contract.js'));

const EXPECTED_EXISTING = [
  'language', 'google', 'discovery', 'license_org_recovery', 'branch_select',
  'device', 'restore', 'owner_auth', 'sync', 'ready',
];
const EXPECTED_NEW_NO_FORK = [
  'language', 'license', 'google', 'discovery', 'organization', 'owner',
  'branch', 'device', 'business_setup', 'publication', 'restore', 'sync', 'ready',
];

/* ---------------- sequences ---------------- */
function sequenceTests() {
  console.log('\n-- authoritative sequences --');
  const existing = SM.getApplicableSteps('existing', { path: 'existing' });
  check(JSON.stringify(existing) === JSON.stringify(EXPECTED_EXISTING),
    `EXISTING sequence is the 10-step order (${existing.length} steps)`);
  check(SM.getTotalStepCount('existing', { path: 'existing' }) === 10, 'EXISTING total is 10');
  check(SM.getStepNumber('existing', { path: 'existing' }, 'branch_select') === 5,
    'branch_select is step 5 of 10 on EXISTING');
  check(SM.getStepNumber('existing', { path: 'existing' }, 'owner_auth') === 8,
    'owner_auth is step 8 of 10 on EXISTING');

  const newNoFork = SM.getApplicableSteps('new', { path: 'new' });
  check(JSON.stringify(newNoFork) === JSON.stringify(EXPECTED_NEW_NO_FORK),
    `NEW without fork excludes path_decision (${newNoFork.length} steps)`);
  check(SM.getTotalStepCount('new', { path: 'new' }) === 13, 'NEW total is 13 without fork');

  const newFork = SM.getApplicableSteps('new', { path: 'new', needsPathFork: true });
  check(newFork.includes('path_decision') && newFork.length === 14,
    'NEW with fork includes path_decision (14 steps)');
  check(SM.getStepNumber('new', { path: 'new', needsPathFork: true }, 'organization') === 6,
    'path_decision shifts organization to step 6 when applicable');
  check(SM.getStepNumber('new', { path: 'new' }, 'organization') === 5,
    'organization is step 5 when the fork is not applicable');

  check(!SM.getApplicableSteps('new', { path: 'new' }).includes('owner_auth'),
    'owner_auth never applies to NEW');
  check(!SM.getApplicableSteps('existing', { path: 'existing' }).includes('path_decision'),
    'path_decision never applies to EXISTING');
}

/* ---------------- checklist agrees with the model ---------------- */
function checklistConsistencyTests() {
  console.log('\n-- checklist uses the same applicable list --');
  for (const state of [
    { path: 'existing' },
    { path: 'new' },
    { path: 'new', needsPathFork: true },
    { path: 'new', forkDecision: 'start_new' },
  ]) {
    const modelSteps = SM.getApplicableSteps(state.path, state);
    const checklistSteps = BCC.visibleStepsForPath({ ...state, validateStep: () => false });
    check(JSON.stringify(modelSteps) === JSON.stringify(checklistSteps),
      `checklist matches model for ${JSON.stringify(state)}`);
    const model = BCC.buildChecklistModel({ ...state, validateStep: () => false });
    check(model.items.length === modelSteps.length,
      `checklist item count equals total step count for ${state.path}${state.needsPathFork ? '+fork' : ''}`);
  }
}

/* ---------------- forward / backward symmetry ---------------- */
function traversalTests() {
  console.log('\n-- forward / backward traversal --');
  for (const [path, state] of [['existing', { path: 'existing' }], ['new', { path: 'new' }], ['new', { path: 'new', needsPathFork: true }]]) {
    const applicable = SM.getApplicableSteps(path, state);

    const forward = [applicable[0]];
    let cur = applicable[0];
    while (SM.getNextStep(path, state, cur)) {
      cur = SM.getNextStep(path, state, cur);
      forward.push(cur);
    }
    check(JSON.stringify(forward) === JSON.stringify(applicable),
      `${path}${state.needsPathFork ? '+fork' : ''} forward traversal visits every applicable step in order`);

    const backward = [cur];
    while (SM.getPreviousStep(path, state, cur)) {
      cur = SM.getPreviousStep(path, state, cur);
      backward.push(cur);
    }
    check(JSON.stringify(backward.reverse()) === JSON.stringify(applicable),
      `${path}${state.needsPathFork ? '+fork' : ''} backward traversal is the exact reverse`);

    // Five Next/Back cycles must not drift.
    let probe = applicable[Math.min(3, applicable.length - 2)];
    const origin = probe;
    for (let i = 0; i < 5; i += 1) {
      const nxt = SM.getNextStep(path, state, probe);
      probe = nxt ? SM.getPreviousStep(path, state, nxt) : probe;
    }
    check(probe === origin, `${path}${state.needsPathFork ? '+fork' : ''} five Next/Back cycles produce no drift`);
  }

  // A stale index pointing at a non-applicable step resolves to a real step.
  const resolved = SM.resolveStepIdFromIndex('new', SM.toSequenceIndex('new', 'path_decision'), { path: 'new' });
  check(resolved && resolved !== 'path_decision' && SM.getApplicableSteps('new', { path: 'new' }).includes(resolved),
    `stale index on a non-applicable step migrates to an applicable one (${resolved})`);
}

/* ---------------- live wizard: header / body / checklist agree ---------------- */
function makeElement(tagOrId) {
  const children = [];
  const attrs = {};
  const classes = new Set();
  let textContent = '';
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
  };
  Object.defineProperty(el, 'textContent', { get: () => textContent, set: (v) => { textContent = v; if (v === '') children.length = 0; } });
  Object.defineProperty(el, 'innerHTML', { get: () => textContent, set: (v) => { textContent = v; } });
  return el;
}

function makeDocument() {
  const byId = new Map();
  const ensure = (id) => { if (!byId.has(id)) byId.set(id, makeElement(id)); return byId.get(id); };
  return {
    body: makeElement('body'), head: { appendChild: () => {} }, getElementById: ensure,
    querySelector: (s) => { const m = String(s || '').match(/#([A-Za-z0-9_-]+)/); return m ? ensure(m[1]) : null; },
    querySelectorAll: () => [], createElement: (t) => makeElement(t),
  };
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
      getCachedDiscovery: () => ({ ok: true, status: 'existing_business_found', organizationCandidates: [{ id: 'NJR-1' }], licenseCandidates: [{ centerId: 'NJR-1' }], backupCandidates: [], branchCandidates: [], syncCandidates: [] }),
      hasDiscoveryResolved: () => true,
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

function liveConsistencyTests() {
  console.log('\n-- live wizard: header / body / checklist identical --');
  const ctx = liveWizard();
  const BF = ctx.BootFlow;

  BF.renderAll(ctx.DB.get('__tdw_boot_wizard__'));
  const frame = BF.describeCurrentStep();
  const headerText = ctx.document.getElementById('bf-step-meta').textContent;
  const labelText = ctx.document.getElementById('bf-step-label').textContent;

  check(frame.stepId === 'branch_select', `current step is branch_select (got ${frame.stepId})`);
  check(headerText === `الخطوة ${frame.stepNumber} من ${frame.totalSteps}`,
    `header matches model: "${headerText}"`);
  check(headerText === 'الخطوة 5 من 10', `EXISTING branch_select shows "الخطوة 5 من 10" (got "${headerText}")`);
  check(/فرع/.test(labelText), `step label describes the branch step (got "${labelText}")`);

  const model = ctx.BootstrapChecklistContract.buildChecklistModel(BF.getChecklistUiContext());
  const active = model.items.find((i) => i.active);
  check(active && active.id === frame.stepId,
    `checklist active row equals header step (${active && active.id})`);
  check(model.items.length === frame.totalSteps,
    `checklist length equals header total (${model.items.length}/${frame.totalSteps})`);

  // Next must not skip an unresolved REQUIRED gate.
  return Promise.resolve(BF.advanceWizard()).then(() => {
    const after = BF.describeCurrentStep();
    check(after.stepId === 'branch_select',
      `Next is blocked on an unresolved branch gate (still ${after.stepId})`);

    // Confirm the branch, then Next must move to device.
    ctx.document.getElementById('bf-branch-id').value = 'BR-2';
    return Promise.resolve(BF.selectExistingBranchOnly());
  }).then(() => Promise.resolve(BF.advanceWizard())).then(() => {
    const after = BF.describeCurrentStep();
    check(after.stepId === 'device', `Next moves to device after explicit branch selection (${after.stepId})`);
    check(ctx.document.getElementById('bf-step-meta').textContent === 'الخطوة 6 من 10',
      'device shows "الخطوة 6 من 10"');

    // Back returns to the branch step and does not clear the committed choice.
    BF.prevStep();
    const back = BF.describeCurrentStep();
    check(back.stepId === 'branch_select', `Back returns to branch_select (${back.stepId})`);
    check(BF.getSelectedBranchId() === 'BR-2', 'Back does not clear the committed branch selection');
    check(ctx.document.getElementById('bf-step-meta').textContent === 'الخطوة 5 من 10',
      'header follows Back to "الخطوة 5 من 10"');

    // Forward again lands on the same step.
    return Promise.resolve(BF.advanceWizard());
  }).then(() => {
    check(BF.describeCurrentStep().stepId === 'device', 'Back then Next returns to the same stage');
  });
}

function staleRenderTests() {
  console.log('\n-- stale async render protection --');
  const ctx = liveWizard();
  const BF = ctx.BootFlow;
  BF.renderAll(ctx.DB.get('__tdw_boot_wizard__'));
  const gen = BF.currentRenderGeneration();
  check(BF.isRenderCurrent(gen, 'branch_select') === true, 'current generation is accepted');
  BF.renderAll(ctx.DB.get('__tdw_boot_wizard__'));
  check(BF.isRenderCurrent(gen, 'branch_select') === false,
    'a generation from a previous render is rejected');
  check(BF.isRenderCurrent(BF.currentRenderGeneration(), 'device') === false,
    'a render token for a different step is rejected');
}

function deviceOrderTests() {
  console.log('\n-- device cannot precede branch --');
  const ctx = liveWizard();
  const BF = ctx.BootFlow;
  check(BF.validateStep('branch_select') === false, 'branch unresolved initially');
  check(BF.validateStep('device') === false, 'device blocked while branch unresolved');
  const applicable = SM.getApplicableSteps('existing', { path: 'existing' });
  check(applicable.indexOf('device') === applicable.indexOf('branch_select') + 1,
    'device immediately follows branch_select in the authoritative order');
  check(applicable.indexOf('owner_auth') > applicable.indexOf('restore'),
    'owner_auth cannot appear before restore');
}

function coordinatorSyncOwnerAuthTests() {
  console.log('\n-- coordinator sync gate matches validateStep owner_auth on EXISTING --');
  const ctx = liveWizard({
    wizard: {
      path: 'existing', restoreChoice: 'cloud',
      branchSelection: { branchId: 'BR-MAIN', provenance: 'user' },
    },
    deviceConfig: { lockedBranchId: 'BR-MAIN', deviceUuid: 'dev-1', deviceName: 'Desk' },
  });
  const BC = ctx.BootstrapCoordinator;
  const BF = ctx.BootFlow;
  const ownerAuthResolved = () => false;
  BF.ownerAuthStepResolved = ownerAuthResolved;
  const derived = BC.deriveCompletedSteps('existing');
  check(!derived.includes('sync'), 'coordinator does not mark sync done without owner_auth');
  check(BF.validateStep('sync') === false, 'validateStep blocks sync without owner_auth');
  BF.ownerAuthStepResolved = () => true;
  const derived2 = BC.deriveCompletedSteps('existing');
  check(!derived2.includes('sync'), 'coordinator still blocks sync until hasSyncDone');
}

(async function main() {
  try {
    sequenceTests();
    checklistConsistencyTests();
    traversalTests();
    await liveConsistencyTests();
    staleRenderTests();
    deviceOrderTests();
    coordinatorSyncOwnerAuthTests();
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
    console.log('OK: bootstrap navigation model');
  }
})();
