#!/usr/bin/env node
'use strict';

/**
 * Stage 17 — Bootstrap Checklist UI (read-only gate-derived checklist).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

const BSC = require(path.join(root, 'cloud/business-setup-contract.js'));
const PC = require(path.join(root, 'cloud/publication-contract.js'));
const RVC = require(path.join(root, 'cloud/readback-verification-contract.js'));
const ISC = require(path.join(root, 'cloud/initial-sync-direction-contract.js'));
const ESC = require(path.join(root, 'cloud/existing-short-path-contract.js'));
const BCC = require(path.join(root, 'cloud/bootstrap-checklist-contract.js'));

const STAGE_15_NEW_STEPS = Object.freeze([
  'language', 'license', 'google', 'discovery', 'path_decision', 'organization', 'owner',
  'branch', 'device', 'business_setup', 'publication', 'restore', 'sync', 'ready',
]);

const STAGE_16_EXISTING_STEPS = Object.freeze([
  'language', 'google', 'discovery', 'license_org_recovery', 'branch_select', 'device',
  'restore', 'owner_auth', 'sync', 'ready',
]);

function extractStringArray(src, varName) {
  const re = new RegExp(`const ${varName} = \\[([^\\]]+)\\]`);
  const m = src.match(re);
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim().replace(/['"]/g, ''));
}

function extractFreezeArray(src, varName) {
  const re = new RegExp(`const ${varName} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`);
  const m = src.match(re);
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
}

function makeElement(tagOrId) {
  const children = [];
  const attrs = {};
  const classes = new Set();
  let textContent = '';
  const el = {
    id: typeof tagOrId === 'string' && !String(tagOrId).includes(' ') ? tagOrId : '',
    tagName: tagOrId,
    hidden: false,
    style: {},
    className: '',
    value: '',
    dataset: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: () => {},
    },
    appendChild(child) { children.push(child); return child; },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    getAttribute: (k) => attrs[k] ?? null,
    setAttribute: (k, v) => { attrs[k] = v; },
    removeAttribute: (k) => { delete attrs[k]; },
    focus: () => {},
    remove: () => {},
    get children() { return children; },
    get childNodes() { return children; },
  };
  Object.defineProperty(el, 'textContent', {
    get: () => textContent,
    set: (v) => {
      textContent = v;
      if (v === '') children.length = 0;
    },
  });
  return el;
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
    createElement: (tag) => makeElement(tag),
  };
}

function loadRuntimeModules(ctx) {
  const files = [
    'cloud/business-setup-contract.js',
    'cloud/publication-contract.js',
    'cloud/readback-verification-contract.js',
    'cloud/initial-sync-direction-contract.js',
    'cloud/existing-short-path-contract.js',
    'cloud/bootstrap-checklist-contract.js',
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

function checklistCtx(overrides = {}) {
  const done = new Set(overrides.done || []);
  const validateStep = overrides.validateStep || ((stepId) => done.has(stepId));
  return {
    path: 'new',
    forkDecision: null,
    currentStepId: overrides.currentStepId || 'language',
    validateStep,
    needsPathFork: false,
    pathDecisionResolved: false,
    ownerAuthResolved: false,
    ownerAuthRequired: false,
    stepError: overrides.stepError || null,
    uiOps: overrides.uiOps || {},
    ...overrides,
  };
}

function baseBootEnv(overrides = {}) {
  const wizardDefaults = {
    path: 'new',
    currentStep: 0,
    lang: 'ar',
    restoreChoice: null,
    syncDone: false,
    completedSteps: [],
    wizardFlowVersion: 16,
    discoveryCompletedAt: null,
    cloudDiscovery: { result: { status: 'no_existing_business' } },
  };
  const { wizard: wizardOverrides, meta: metaOverrides, ...rest } = overrides;
  const snap = {
    license: {
      centerId: '',
      centerName: '',
      activation: { consumed: false },
      branches: [],
    },
    meta: { centerId: 'CTR-S17', ...(metaOverrides || {}) },
    deviceConfig: { deviceUuid: 'DEV-1', deviceName: 'PC-1', lockedBranchId: 'BR-1', centerId: 'CTR-S17' },
    users: [{
      id: 'O1', role: 'owner', active: true, seedDefaultPassword: false,
      password: 'pbkdf2v2:x', hasUsableCredential: true, username: 'owner',
    }],
    wizard: { ...wizardDefaults, ...(wizardOverrides || {}) },
    settings: {
      centerName: 'S17 Clinic',
      phone: '0501234567',
      backup: { providers: { google: { connected: false, oauth: false } } },
    },
    ...rest,
  };
  const storage = new Map();
  const kvWrites = [];
  const ctx = {
    console,
    setTimeout,
    clearTimeout,
    document: makeDocument(),
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
        if (key === '__tdw_boot_wizard__') snap.wizard = val;
        if (key === '__tdw_meta__') snap.meta = val;
        if (key === 'settings') snap.settings = val;
        if (key === '__tdw_device_config__') snap.deviceConfig = val;
        return { ok: true };
      },
    },
    users: snap.users,
    settings: snap.settings,
    BusinessSetupContract: BSC,
    PublicationContract: PC,
    ReadbackVerificationContract: RVC,
    InitialSyncDirectionContract: ISC,
    ExistingShortPathContract: ESC,
    BootstrapChecklistContract: BCC,
    LicenseCloud: { loadLocal: () => (snap.license?.centerId ? snap.license : null) },
    DeviceConfig: { load: () => snap.deviceConfig },
    CenterId: { getStoredCenterId: () => snap.license?.centerId || null },
    DriveAdapter: { isConnected: () => !!snap.settings?.backup?.providers?.google?.connected },
    OwnerManagement: {
      isSystemBusy: () => false,
      getOwnerState: () => ({ state: 'NO_OWNER' }),
      retireOwnerSeedsIfNeeded: async () => ({ ok: true, changed: false }),
    },
    RestoreReconciliation: { loadState: () => null },
    SyncEngine: { getReadiness: () => ({ ready: false, state: 'PENDING', missing: ['initialSync'] }) },
    licLoad: () => null,
    LicenseActivationGate: { isConsumed: (lic) => !!(lic?.activation?.consumed) },
    _snap: snap,
    _kvWrites: kvWrites,
  };
  ctx.global = ctx;
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  loadRuntimeModules(ctx);
  ['bf-checklist-list', 'bf-checklist-bar-fill', 'bf-checklist-pct'].forEach((id) => ctx.document.getElementById(id));
  return ctx;
}

function run() {
  const bootSrc = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
  const coordSrc = fs.readFileSync(path.join(root, 'cloud/bootstrap-coordinator.js'), 'utf8');
  const gatesSrc = fs.readFileSync(path.join(root, 'cloud/bootstrap-gates.js'), 'utf8');
  const contractSrc = fs.readFileSync(path.join(root, 'cloud/bootstrap-checklist-contract.js'), 'utf8');
  const indexSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  const bootNewSteps = extractStringArray(bootSrc, 'NEW_STEPS');
  const bootExistingSteps = extractStringArray(bootSrc, 'EXISTING_STEPS');
  const coordNewSteps = extractStringArray(coordSrc, 'NEW_STEPS');
  const coordExistingSteps = extractStringArray(coordSrc, 'EXISTING_STEPS');
  const gatesNewRuntime = extractFreezeArray(gatesSrc, 'CURRENT_NEW_RUNTIME');
  const gatesExistingRuntime = extractFreezeArray(gatesSrc, 'CURRENT_EXISTING_RUNTIME');

  const S = BCC.STATUS;
  const contract = BCC.buildContract();

  // 1–6 NEW checklist order
  check(BCC.NEW_CHECKLIST_STEPS.length === 14, '1 NEW checklist length 14');
  check(JSON.stringify(BCC.NEW_CHECKLIST_STEPS) === JSON.stringify(STAGE_15_NEW_STEPS), '2 NEW checklist matches stage15 order');
  check(BCC.NEW_CHECKLIST_STEPS[0] === 'language', '3 NEW starts language');
  check(BCC.NEW_CHECKLIST_STEPS.at(-1) === 'ready', '4 NEW ends ready');
  check(BCC.NEW_CHECKLIST_STEPS.indexOf('license') < BCC.NEW_CHECKLIST_STEPS.indexOf('google'), '5 NEW license before google');
  check(BCC.NEW_CHECKLIST_STEPS.includes('path_decision') && BCC.NEW_CHECKLIST_STEPS.includes('business_setup'), '6 NEW has path_decision+business_setup');

  // 7–14 EXISTING checklist order + no activation row
  check(BCC.EXISTING_CHECKLIST_STEPS.length === 10, '7 EXISTING checklist length 10');
  check(JSON.stringify(BCC.EXISTING_CHECKLIST_STEPS) === JSON.stringify(STAGE_16_EXISTING_STEPS), '8 EXISTING matches stage16 order');
  check(BCC.EXISTING_CHECKLIST_STEPS.includes('license_org_recovery'), '9 EXISTING has license_org_recovery');
  check(!BCC.EXISTING_CHECKLIST_STEPS.includes('license'), '10 EXISTING no separate activation row');
  check(!BCC.EXISTING_CHECKLIST_STEPS.includes('business_setup'), '11 EXISTING no business_setup row');
  check(!BCC.EXISTING_CHECKLIST_STEPS.includes('publication'), '12 EXISTING no publication row');
  check(!BCC.EXISTING_CHECKLIST_STEPS.includes('readback'), '13 EXISTING no readback row');
  check(BCC.EXISTING_CHECKLIST_STEPS.indexOf('restore') < BCC.EXISTING_CHECKLIST_STEPS.indexOf('owner_auth'), '14 EXISTING restore before owner_auth');

  // 15–18 auto gates hidden for existing
  check(contract.autoResolvedHidden.includes('business_setup'), '15 auto hidden business_setup');
  check(contract.autoResolvedHidden.includes('publication'), '16 auto hidden publication');
  check(contract.autoResolvedHidden.includes('readback'), '17 auto hidden readback');
  check(contract.authority.includes('validateStep'), '18 contract authority validateStep');

  // 19–24 DONE from authoritative gates (validateStep), fake wizard complete ignored
  const doneLang = BCC.buildChecklistModel(checklistCtx({ done: ['language'], currentStepId: 'license' }));
  check(doneLang.items.find((i) => i.id === 'language')?.status === S.DONE, '19 DONE from validateStep language');
  const fakeWizard = BCC.buildChecklistModel(checklistCtx({
    done: [],
    currentStepId: 'license',
    validateStep: () => false,
  }));
  check(fakeWizard.items.find((i) => i.id === 'language')?.status === S.REQUIRED, '20 fake wizard complete ignored (language REQUIRED)');
  const fakeAll = BCC.buildChecklistModel(checklistCtx({
    done: [],
    validateStep: (id) => id === 'language',
    currentStepId: 'license',
  }));
  check(fakeAll.items.find((i) => i.id === 'license')?.status === S.REQUIRED, '21 license REQUIRED when validateStep false');
  check(fakeAll.items.find((i) => i.id === 'google')?.status === S.FUTURE, '22 google FUTURE when unresolved ahead');
  const allDone = BCC.buildChecklistModel(checklistCtx({
    done: STAGE_15_NEW_STEPS.filter((s) => s !== 'ready'),
    currentStepId: 'ready',
    needsPathFork: true,
    validateStep: (id) => id !== 'ready',
  }));
  check(allDone.progress.percent === 93, '23 progress 93% when all but ready done');
  check(allDone.items.find((i) => i.id === 'ready')?.status === S.REQUIRED, '24 ready REQUIRED until boot complete');

  // 25–30 REQUIRED / IN_PROGRESS / ERROR / FUTURE
  const requiredModel = BCC.buildChecklistModel(checklistCtx({ currentStepId: 'google', validateStep: (id) => id === 'language' }));
  check(requiredModel.items.find((i) => i.id === 'google')?.status === S.REQUIRED, '25 google REQUIRED as first unresolved');
  check(requiredModel.items.find((i) => i.id === 'discovery')?.status === S.FUTURE, '26 discovery FUTURE behind unresolved license/google');
  const inProgress = BCC.buildChecklistModel(checklistCtx({
    currentStepId: 'google',
    validateStep: (id) => id === 'language',
    uiOps: { oauth: true },
  }));
  check(inProgress.items.find((i) => i.id === 'google')?.status === S.IN_PROGRESS, '27 google IN_PROGRESS when oauth in flight');
  const errModel = BCC.buildChecklistModel(checklistCtx({
    currentStepId: 'google',
    validateStep: (id) => id === 'language',
    stepError: { stepId: 'google', code: 'google_not_connected', message: 'fail' },
  }));
  const errItem = errModel.items.find((i) => i.id === 'google');
  check(errItem?.status === S.ERROR, '28 google ERROR when stepError set');
  check(errItem?.required === true, '29 ERROR item required');
  check(errItem?.actionAvailable === true, '30 ERROR actionAvailable');
  check(errItem?.error === BCC.ERROR_MESSAGES.google_not_connected, '31 ERROR humanized message');

  // 32–37 path_decision conditional
  const newNoFork = BCC.visibleStepsForPath(checklistCtx({ path: 'new', needsPathFork: false, pathDecisionResolved: false, forkDecision: null }));
  check(!newNoFork.includes('path_decision'), '32 NEW hides path_decision when not needed');
  const newFork = BCC.visibleStepsForPath(checklistCtx({ path: 'new', needsPathFork: true }));
  check(newFork.includes('path_decision'), '33 NEW shows path_decision when needsPathFork');
  const newResolved = BCC.visibleStepsForPath(checklistCtx({ path: 'new', pathDecisionResolved: true }));
  check(newResolved.includes('path_decision'), '34 NEW keeps path_decision when resolved');
  const newForkDecision = BCC.visibleStepsForPath(checklistCtx({ path: 'new', forkDecision: 'start_new' }));
  check(newForkDecision.includes('path_decision'), '35 NEW shows path_decision when forkDecision set');
  const existingNoPath = BCC.visibleStepsForPath(checklistCtx({ path: 'existing' }));
  check(!existingNoPath.includes('path_decision'), '36 EXISTING hides path_decision');
  const useExistingNoPath = BCC.visibleStepsForPath(checklistCtx({ path: 'new', forkDecision: 'use_existing' }));
  check(!useExistingNoPath.includes('path_decision'), '37 use_existing hides path_decision');

  // 38–43 owner_auth conditional
  const existingHiddenOwner = BCC.visibleStepsForPath(checklistCtx({ path: 'existing' }));
  check(!existingHiddenOwner.includes('owner_auth'), '38 EXISTING hides owner_auth initially');
  const existingOwnerRequired = BCC.visibleStepsForPath(checklistCtx({ path: 'existing', ownerAuthRequired: true }));
  check(existingOwnerRequired.includes('owner_auth'), '39 EXISTING shows owner_auth when required');
  const existingOwnerResolved = BCC.visibleStepsForPath(checklistCtx({ path: 'existing', ownerAuthResolved: true }));
  check(existingOwnerResolved.includes('owner_auth'), '40 EXISTING shows owner_auth when resolved');
  const existingOwnerCurrent = BCC.visibleStepsForPath(checklistCtx({ path: 'existing', currentStepId: 'owner_auth' }));
  check(existingOwnerCurrent.includes('owner_auth'), '41 EXISTING shows owner_auth on current step');
  check(!BCC.visibleStepsForPath(checklistCtx({ path: 'new' })).includes('owner_auth'), '42 NEW never shows owner_auth');
  const existingSteps = BCC.visibleStepsForPath(checklistCtx({ path: 'existing', ownerAuthRequired: true }));
  check(existingSteps.indexOf('owner_auth') > existingSteps.indexOf('restore'), '43 owner_auth after restore');

  // 44–48 progress calculation
  const halfDone = BCC.buildChecklistModel(checklistCtx({
    done: ['language', 'license', 'google', 'discovery', 'path_decision', 'organization', 'owner'],
    currentStepId: 'branch',
    needsPathFork: true,
    validateStep: (id) => ['language', 'license', 'google', 'discovery', 'path_decision', 'organization', 'owner'].includes(id),
  }));
  check(halfDone.progress.done === 7, '44 progress done count');
  check(halfDone.progress.total === 14, '45 progress total count');
  check(halfDone.progress.percent === 50, '46 progress percent 50');
  const zeroPct = BCC.buildChecklistModel(checklistCtx({ validateStep: () => false, currentStepId: 'language' }));
  check(zeroPct.progress.percent === 0, '47 progress zero when none done');
  const clamped = BCC.buildChecklistModel(checklistCtx({
    done: STAGE_15_NEW_STEPS,
    validateStep: () => true,
    currentStepId: 'ready',
  }));
  check(clamped.progress.percent === 100, '48 progress clamped at 100');

  // 49–53 XSS safe rendering via escapeHtml
  check(BCC.escapeHtml('<script>') === '&lt;script&gt;', '49 escapeHtml angle brackets');
  check(BCC.escapeHtml('a&b') === 'a&amp;b', '50 escapeHtml ampersand');
  check(BCC.escapeHtml('"x"') === '&quot;x&quot;', '51 escapeHtml double quote');
  check(BCC.escapeHtml("'y'") === '&#39;y&#39;', '52 escapeHtml single quote');
  check(/textContent = item\.label/.test(bootSrc), '53 renderChecklist uses textContent not innerHTML for labels');

  // 54–58 BootFlow.getChecklistUiContext / buildChecklistModel
  const rt = baseBootEnv();
  const uiCtx = rt.BootFlow.getChecklistUiContext();
  check(typeof uiCtx.validateStep === 'function', '54 getChecklistUiContext exposes validateStep');
  check(uiCtx.path === 'new', '55 getChecklistUiContext path from wizard');
  const bfModel = rt.BootFlow.buildChecklistModel(uiCtx);
  check(Array.isArray(bfModel.items) && bfModel.items.length === 13, '56 BootFlow.buildChecklistModel NEW items (path_decision hidden)');
  const existingRt = baseBootEnv({
    wizard: { path: 'existing', currentStep: 3, lang: 'ar' },
    users: [{ id: 'O1', role: 'owner', active: true, seedDefaultPassword: true, password: '', hasUsableCredential: false }],
  });
  const exCtx = existingRt.BootFlow.getChecklistUiContext(existingRt._snap.wizard);
  check(exCtx.path === 'existing', '57 getChecklistUiContext existing path');
  const exModel = existingRt.BootFlow.buildChecklistModel(exCtx);
  check(exModel.items.length === 9, '58 EXISTING checklist hides owner_auth until required');

  // 59–68 zero-write render (10x renderChecklist) + idempotency
  const renderCtx = baseBootEnv({
    wizard: {
      path: 'new', currentStep: 1, lang: 'ar', completedSteps: STAGE_15_NEW_STEPS.slice(),
      wizardFlowVersion: 16,
    },
  });
  const w = renderCtx.BootFlow.getDisplayWizard(renderCtx._snap.wizard);
  const beforeWrites = renderCtx._kvWrites.length;
  const models = [];
  for (let i = 0; i < 10; i++) {
    renderCtx.BootFlow.renderChecklist(w);
    models.push(JSON.stringify(renderCtx.BootFlow.buildChecklistModel(renderCtx.BootFlow.getChecklistUiContext(w))));
    check(renderCtx._kvWrites.length === beforeWrites, `59 zero-write render iteration ${i + 1}`);
  }
  check(models.every((m) => m === models[0]), '69 renderChecklist idempotent model');

  // 70–72 boot-flow DOM strings
  check(/id="bf-checklist-list"/.test(bootSrc), '70 boot-flow bf-checklist-list');
  check(/class="bf-checklist-layout"/.test(bootSrc), '71 boot-flow bf-checklist-layout');
  check(/bf-checklist-panel/.test(bootSrc) && /bf-checklist-main/.test(bootSrc), '72 boot-flow checklist panel+main');

  // 73–76 NEW path unchanged + index contract load
  check(JSON.stringify(bootNewSteps) === JSON.stringify(STAGE_15_NEW_STEPS), '73 boot-flow NEW_STEPS unchanged');
  check(JSON.stringify(coordNewSteps) === JSON.stringify(STAGE_15_NEW_STEPS), '74 coordinator NEW_STEPS unchanged');
  check(JSON.stringify(gatesNewRuntime) === JSON.stringify(STAGE_15_NEW_STEPS), '75 gates NEW runtime unchanged');
  check(/bootstrap-checklist-contract\.js/.test(indexSrc), '76 index loads bootstrap-checklist-contract');

  // 77–79 __dev__ unchanged + schema unchanged hints
  check(/id:\s*'__dev__'/.test(indexSrc), '77 __dev__ unchanged');
  check(/session\.userId === '__dev__'/.test(indexSrc), '78 __dev__ session guard unchanged');
  check(!/CREATE TABLE/.test(contractSrc), '79 schema unchanged in checklist contract');

  // 80–86 stage 10–16 regression static checks in boot-flow
  check(/retireOwnerSeedsIfNeeded/.test(bootSrc), '80 stage10 owner seed marker');
  check(/deviceStepResolved/.test(bootSrc), '81 stage11 device regression');
  check(/businessSetupStepResolved/.test(bootSrc), '82 stage12 business regression');
  check(/publicationStepResolved/.test(bootSrc), '83 stage13 publication regression');
  check(/readbackStepResolved/.test(bootSrc), '84 stage14 readback regression');
  check(/InitialSyncDirectionContract|resolveInitialSyncPlan/.test(bootSrc), '85 stage15 initial sync marker');
  check(/ExistingShortPathContract|licenseOrgRecoveryResolved/.test(bootSrc), '86 stage16 existing short path marker');

  // 87–90 coordinator + gates existing alignment
  check(JSON.stringify(coordExistingSteps) === JSON.stringify(STAGE_16_EXISTING_STEPS), '87 coordinator EXISTING unchanged');
  check(JSON.stringify(bootExistingSteps) === JSON.stringify(STAGE_16_EXISTING_STEPS), '88 boot-flow EXISTING unchanged');
  check(JSON.stringify(gatesExistingRuntime) === JSON.stringify(STAGE_16_EXISTING_STEPS), '89 gates EXISTING runtime unchanged');
  check(/BootstrapChecklistContract/.test(bootSrc), '90 boot-flow uses BootstrapChecklistContract');

  // 91–94 fake wizard complete ignored via BootFlow runtime
  const fakeRt = baseBootEnv({
    wizard: {
      path: 'new', currentStep: 1, lang: 'ar',
      completedSteps: ['language', 'license', 'google', 'discovery', 'path_decision', 'organization', 'owner', 'branch', 'device', 'business_setup', 'publication'],
      wizardFlowVersion: 16,
    },
  });
  const fakeW = fakeRt.BootFlow.getDisplayWizard(fakeRt._snap.wizard);
  const fakeModel = fakeRt.BootFlow.buildChecklistModel(fakeRt.BootFlow.getChecklistUiContext(fakeW));
  check(fakeModel.items.find((i) => i.id === 'license')?.status !== S.DONE, '91 runtime fake completedSteps license not DONE');
  check(fakeModel.items.find((i) => i.id === 'google')?.status !== S.DONE, '92 runtime fake completedSteps google not DONE');
  check(fakeRt.BootFlow.validateStep('language'), '93 runtime validateStep language from lang');
  check(!fakeRt.BootFlow.validateStep('license'), '94 runtime validateStep license false without activation');

  // 95–98 existing path checklist + no activation
  const exRt = baseBootEnv({
    wizard: { path: 'existing', currentStep: 0, lang: 'ar', completedSteps: ['license'], wizardFlowVersion: 16 },
    license: {
      centerId: 'CTR-S17',
      centerName: 'S17 Clinic',
      activation: { consumed: true },
      branches: [{ id: 'BR-1', name: 'Main', active: true }],
    },
    settings: {
      centerName: 'S17 Clinic',
      backup: { providers: { google: { connected: true, oauth: true, email: 'o@test.com' } } },
    },
  });
  exRt._snap.wizard.discoveryCompletedAt = new Date().toISOString();
  const exList = exRt.BootFlow.buildChecklistModel(exRt.BootFlow.getChecklistUiContext(exRt._snap.wizard));
  check(!exList.items.some((i) => i.id === 'license'), '95 EXISTING runtime no activation row');
  check(exList.items.some((i) => i.id === 'license_org_recovery'), '96 EXISTING runtime has recovery row');
  check(exList.items.every((i) => !['business_setup', 'publication', 'readback'].includes(i.id)), '97 EXISTING runtime auto gates hidden');
  check(exList.firstUnresolvedId === 'language' || exList.items.find((i) => i.id === 'language')?.status === S.DONE, '98 EXISTING runtime first unresolved sane');

  // 99–102 buildContract + inventory + labels
  check(contract.newChecklist.length === 14 && contract.existingChecklist.length === 10, '99 buildContract checklist sizes');
  check(BCC.USER_LABELS.language === 'اللغة', '100 USER_LABELS Arabic language');
  check(BCC.buildUiInventoryBefore().stage17Target.includes('bf-checklist'), '101 UI inventory stage17 target');
  check(BCC.humanizeError('unknown_code_xyz')?.includes('unknown_code_xyz'), '102 humanizeError fallback');

  if (errors.length) {
    console.error('FAIL stage-17-bootstrap-checklist-ui');
    errors.forEach((e, i) => console.error(`${i + 1}. ${e}`));
    process.exit(1);
  }
  const scenarioCount = 102;
  console.log(`PASS stage-17-bootstrap-checklist-ui (${scenarioCount} scenarios)`);
}

run();
