#!/usr/bin/env node
'use strict';

/**
 * Installed-runtime defect: startPath('existing'|'new') must durably persist wizard.path
 * through SqliteBridge's authoritative DB.get even when state.data holds a stale snapshot.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const failures = [];
let passed = 0;

function check(cond, msg) {
  if (cond) { passed += 1; console.log(`PASS  ${msg}`); }
  else { failures.push(msg); console.error(`FAIL  ${msg}`); }
}

function makeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

function bootContext() {
  const localStorage = makeLocalStorage();
  const ctx = {
    console: { info: () => {}, warn: () => {}, error: () => {}, log: () => {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    document: {
      body: { appendChild: () => {}, classList: { add: () => {}, remove: () => {} } },
      head: { appendChild: () => {} },
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ appendChild: () => {}, addEventListener: () => {}, querySelector: () => null }),
    },
    localStorage,
    location: { search: '' },
    confirm: () => true,
    DB: {
      get(k, def) {
        try {
          const raw = localStorage.getItem(k);
          return raw ? JSON.parse(raw) : def;
        } catch {
          return def;
        }
      },
      set(k, v) {
        try {
          localStorage.setItem(k, JSON.stringify(v));
          return Promise.resolve({ ok: true, bootstrapLocal: true });
        } catch (error) {
          return Promise.resolve({ ok: false, error: String(error?.message || error) });
        }
      },
    },
    users: [],
    settings: {},
    LicenseCloud: { loadLocal: () => null },
    DeviceConfig: { load: () => ({}) },
    DriveAdapter: { isConnected: () => false },
    OwnerManagement: { isSystemBusy: () => false, getOwnerState: () => ({ state: 'NO_OWNER' }), isOwnerCreationInProgress: () => false },
    RestoreReconciliation: { loadState: () => null },
    SyncEngine: { getReadiness: () => ({ ready: false }) },
    cuppingElectron: {
      database: {
        status: async () => ({ ok: true, sqlitePrimary: true }),
        hydrate: async () => ({
          ok: true,
          data: { users: [] },
          revision: 0,
          status: { sqlitePrimary: true },
        }),
      },
    },
  };
  ctx.global = ctx;
  ctx.window = ctx;
  ctx.globalThis = ctx;

  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'cupping-sqlite-bridge.js'), 'utf8'), ctx, { filename: 'cupping-sqlite-bridge.js' });
  for (const rel of [
    'cloud/bootstrap-step-model.js',
    'cloud/bootstrap-checklist-contract.js',
    'cloud/bootstrap-coordinator.js',
    'cloud/boot-flow-ui.js',
  ]) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
  }
  return ctx;
}

async function sqliteBridgeTests() {
  console.log('\n-- SqliteBridge UI-only read authority --');
  const ctx = bootContext();
  await ctx.SqliteBridge.hydrateIntoMemory();

  ctx.SqliteBridge.getState().sqlitePrimary = true;
  ctx.SqliteBridge.getSnapshot().data.__tdw_boot_wizard__ = {
    path: null, currentStep: 0, completedSteps: [], lang: 'ar', wizardFlowVersion: 16,
  };

  const stale = ctx.DB.get('__tdw_boot_wizard__', { path: null });
  check(stale.path === null, 'stale state.data path:null before write');

  const existing = {
    path: 'existing',
    currentStep: 0,
    completedSteps: [],
    startedAt: new Date().toISOString(),
    lang: 'ar',
    restoreChoice: null,
    syncDone: false,
    oauthLockAt: null,
    wizardFlowVersion: 16,
  };
  ctx.SqliteBridge.setUiOnly('__tdw_boot_wizard__', existing);
  const readBack = ctx.DB.get('__tdw_boot_wizard__', { path: null });
  check(readBack.path === 'existing', `DB.get returns localStorage path after setUiOnly (got ${readBack.path})`);

  ctx.BootFlow.saveWizard({
    path: 'existing',
    currentStep: 0,
    completedSteps: [],
    startedAt: new Date().toISOString(),
    lang: 'ar',
    restoreChoice: null,
    syncDone: false,
    oauthLockAt: null,
    wizardFlowVersion: ctx.BootFlow.WIZARD_FLOW_VERSION,
  });
  const dbAfterSave = ctx.DB.get('__tdw_boot_wizard__', { path: null });
  check(dbAfterSave.path === 'existing', `DB.get matches saveWizard path before write-through (got ${dbAfterSave.path})`);
}

async function startPathTests() {
  console.log('\n-- BootFlow wizard path persistence --');
  const ctx = bootContext();
  await ctx.SqliteBridge.hydrateIntoMemory();
  ctx.SqliteBridge.getSnapshot().data.__tdw_boot_wizard__ = {
    path: null, currentStep: 0, completedSteps: [], lang: 'ar', wizardFlowVersion: 16,
  };

  const BF = ctx.BootFlow;
  BF.saveWizard({
    path: 'existing',
    currentStep: 0,
    completedSteps: [],
    startedAt: new Date().toISOString(),
    lang: 'ar',
    restoreChoice: null,
    syncDone: false,
    oauthLockAt: null,
    wizardFlowVersion: BF.WIZARD_FLOW_VERSION,
  });
  const w1 = BF.loadWizard();
  check(w1.path === 'existing', `saveWizard(EXISTING) -> loadWizard.path === 'existing' (got ${w1.path})`);
  const steps = ctx.BootstrapStepModel.sequenceFor('existing');
  check(steps.length === 10, `EXISTING sequence has 10 steps (got ${steps.length})`);

  BF.saveWizard({
    path: 'new',
    currentStep: 0,
    completedSteps: [],
    startedAt: new Date().toISOString(),
    lang: 'ar',
    restoreChoice: null,
    syncDone: false,
    oauthLockAt: null,
    wizardFlowVersion: BF.WIZARD_FLOW_VERSION,
  });
  const w2 = BF.loadWizard();
  check(w2.path === 'new', `saveWizard(NEW) -> loadWizard.path === 'new' (got ${w2.path})`);
  const newSteps = ctx.BootstrapStepModel.sequenceFor('new', { path: 'new', needsPathFork: true });
  check(newSteps.length === 14, `NEW sequence has 14 steps with fork (got ${newSteps.length})`);

  ctx.SqliteBridge.getSnapshot().data.__tdw_boot_wizard__ = {
    path: null, currentStep: 0, completedSteps: [], lang: 'ar',
  };
  ctx.SqliteBridge.seedUiOnlyFromLocalStorage();
  const afterSeed = BF.loadWizard();
  check(afterSeed.path === 'new', `seedUiOnlyFromLocalStorage restores persisted path (got ${afterSeed.path})`);
}

function prevStepPathTests() {
  console.log('\n-- prevStep preserves committed path --');
  const ctx = bootContext();
  const BF = ctx.BootFlow;
  BF.saveWizard({
    path: 'existing',
    currentStep: 0,
    completedSteps: [],
    startedAt: new Date().toISOString(),
    lang: 'ar',
    restoreChoice: null,
    syncDone: false,
    oauthLockAt: null,
    wizardFlowVersion: BF.WIZARD_FLOW_VERSION,
  });
  BF.prevStep();
  const afterBack = BF.loadWizard();
  check(afterBack.path === 'existing', `prevStep from language keeps path existing (got ${afterBack.path})`);
  check(
    ctx.BootstrapStepModel.sequenceFor('existing').length === 10,
    'stepsFor still returns 10-step EXISTING sequence after prevStep',
  );

  BF.saveWizard({
    path: 'existing',
    currentStep: 1,
    completedSteps: ['language'],
    startedAt: new Date().toISOString(),
    lang: 'ar',
    restoreChoice: null,
    syncDone: false,
    oauthLockAt: null,
    wizardFlowVersion: BF.WIZARD_FLOW_VERSION,
  });
  BF.prevStep();
  const afterNav = BF.loadWizard();
  check(afterNav.path === 'existing', `prevStep from google keeps path existing (got ${afterNav.path})`);
  check(afterNav.currentStep === 0, `prevStep from google returns to language index (got ${afterNav.currentStep})`);
}

async function dbGetAuthorityTests() {
  console.log('\n-- DB.get wizard authority after SqliteBridge hydrate --');
  const ctx = bootContext();
  await ctx.SqliteBridge.hydrateIntoMemory();
  ctx.BootFlow.saveWizard({
    path: 'existing',
    currentStep: 0,
    completedSteps: [],
    startedAt: new Date().toISOString(),
    lang: 'ar',
    restoreChoice: null,
    syncDone: false,
    oauthLockAt: null,
    wizardFlowVersion: ctx.BootFlow.WIZARD_FLOW_VERSION,
  });
  const viaDb = ctx.DB.get('__tdw_boot_wizard__', {});
  check(viaDb.path === 'existing', `DB.get path after hydrate/write-through (got ${viaDb.path})`);
}

(async () => {
  await sqliteBridgeTests();
  await startPathTests();
  prevStepPathTests();
  await dbGetAuthorityTests();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
