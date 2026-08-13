#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

const results = [];
async function check(name, operation) {
  try {
    await operation();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.stack || error.message });
    console.error(`FAIL  ${name}: ${error.message}`);
  }
}

function loadFresh(relative) {
  const resolved = require.resolve(path.join(__dirname, '../..', relative));
  delete require.cache[resolved];
  return require(resolved);
}

function resetDiscoveryGlobals() {
  global.LicenseCloud = { loadLocal: () => ({ centerId: 'CTR-P0C' }) };
  global.DeviceConfig = { load: () => ({ centerId: 'CTR-P0C', lockedBranchId: 'BR-1', deviceId: 'DEV-1' }) };
  global.RestoreReconciliation = {
    createMandatoryPreRestoreSnapshot: async () => ({ ok: true, skipped: true, reason: 'empty_local_db' }),
    afterRestoreDataSourceSelected: async () => ({ ok: true }),
  };
  global.CloudBootstrap = { hydrateFromDrive: async () => ({ ok: true, downloaded: 3 }) };
  global.SqliteBridge = { hydrateIntoMemory: async () => ({ ok: true }) };
  delete global.BackupBridge;
  delete global.cuppingElectron;
  delete global.tadawiElectron;
  delete global.tadawi;
}

function resetBootGlobals() {
  const state = new Map();
  state.set('__tdw_boot_wizard__', {
    restoreChoice: 'cloud',
    syncDone: false,
    completedSteps: ['language', 'google', 'license', 'organization', 'branch', 'restore', 'owner'],
  });
  global.DB = {
    get: (key, fallback) => state.has(key) ? state.get(key) : fallback,
    set: (key, value) => { state.set(key, value); return { ok: true }; },
  };
  global.users = [{
    id: 'OWNER-P0C', username: 'owner.p0c', role: 'owner', active: true,
    password: 'pbkdf2v2:fixture', mustChangePassword: false, seedDefaultPassword: false,
  }];
  global.cuppingElectron = {
    rbac: {
      getSession: async () => ({
        ok: true,
        session: { userId: 'OWNER-P0C', role: 'owner' },
      }),
    },
  };
  global.DeviceConfig = { load: () => ({ lockedBranchId: 'BR-1', deviceUuid: 'DEV-1' }) };
  global.settings = {
    cloudV2Enabled: true,
    backup: { providers: { google: { connected: true, oauth: true, userDisconnected: false } } },
  };
  global.DriveAdapter = {
    isConnected: () => true,
    ensureConnected: async () => true,
  };
  global.ActivationSyncDefaults = { applyDefaults: async () => ({ ok: true }) };
  global.SyncEngine = {
    getReadiness: () => ({ ready: true }),
    isRunning: () => true,
    runOnce: async () => ({ ok: true }),
  };
  global.ensureCloudBootstrapReady = async () => ({ runNewDeviceBootstrap: async () => ({ ok: true }) });
  global.OwnerManagement = { getOwnerState: () => ({ state: 'OWNER_EXISTS' }) };
  return state;
}

(async () => {
  await check('AUD-RST-005 checkpoint UI never claims Backup V2 verification stages', async () => {
    resetDiscoveryGlobals();
    const discovery = loadFresh('cloud/cloud-data-discovery.js');
    const progress = [];
    const result = await discovery.confirmedCloudRestore(
      { kind: 'sync_checkpoint', validation: 'ready', path: 'checkpoint.json' },
      { onProgress: (event) => progress.push(event) },
    );
    assert.strictEqual(result.ok, true);
    const ids = progress.map((item) => item.stageId);
    assert.ok(ids.includes('download_state'));
    assert.ok(ids.includes('apply_checkpoint'));
    for (const fake of ['checksums', 'sqlite_integrity', 'atomic_swap']) assert.ok(!ids.includes(fake));
    assert.ok(progress.every((item) => item.stageCount === discovery.CHECKPOINT_RESTORE_STAGES.length));
  });

  await check('AUD-RST-007 cloud restore forwards download progress without percent regression', async () => {
    resetDiscoveryGlobals();
    let progressListener = null;
    global.cuppingElectron = {
      backup: {
        onDownloadProgress: (cb) => { progressListener = cb; },
        v2SetupCloudRestore: async () => new Promise((resolve) => {
          setTimeout(() => {
            progressListener?.({
              remotePath: 'NajjarTech/CTR-P0C/Backups/V2/full.tdw',
              stage: 'downloading',
              downloadedBytes: 512000,
              totalBytes: 1024000,
              percent: 50,
            });
            progressListener?.({
              remotePath: 'NajjarTech/CTR-P0C/Backups/V2/full.tdw',
              stage: 'download_complete',
              downloadedBytes: 1024000,
              totalBytes: 1024000,
              percent: 100,
            });
            resolve({
              ok: true,
              database: { ok: true },
              progress: [{ stage: 'staging_restore' }, { stage: 'restore_complete' }],
            });
          }, 40);
        }),
      },
    };
    const discovery = loadFresh('cloud/cloud-data-discovery.js');
    const progress = [];
    const result = await discovery.confirmedCloudRestore(
      {
        kind: 'backup_file',
        validation: 'ready',
        path: 'NajjarTech/CTR-P0C/Backups/V2/full.tdw',
        sizeBytes: 1024000,
      },
      { password: 'test-password', onProgress: (event) => progress.push(event) },
    );
    assert.strictEqual(result.ok, true);
    const downloadEvents = progress.filter((item) => item.stageId === 'download_db');
    assert.ok(downloadEvents.length >= 2, 'download stage should receive progress events');
    const percents = downloadEvents.map((item) => item.percent);
    for (let i = 1; i < percents.length; i += 1) {
      assert.ok(percents[i] >= percents[i - 1], 'restore percent must never regress');
    }
  });

  await check('AUD-RST-005 Backup V2 stages are emitted only from returned native proof', async () => {
    resetDiscoveryGlobals();
    global.BackupBridge = {
      v2SetupCloudRestore: async () => ({
        ok: true,
        database: { ok: true },
        progress: [{ stage: 'staging_restore' }, { stage: 'restore_complete' }],
      }),
    };
    const discovery = loadFresh('cloud/cloud-data-discovery.js');
    const progress = [];
    const result = await discovery.confirmedCloudRestore(
      { kind: 'backup_file', validation: 'ready', path: 'NajjarTech/CTR-P0C/Backups/V2/full.tdw' },
      { password: 'test-password', onProgress: (event) => progress.push(event) },
    );
    assert.strictEqual(result.ok, true);
    const ids = progress.map((item) => item.stageId);
    for (const proven of ['checksums', 'staging', 'sqlite_integrity', 'atomic_swap', 'hydrate_memory']) {
      assert.ok(ids.includes(proven), `missing truthful stage ${proven}`);
    }
  });

  await check('AUD-RST-006 checkpoint restore stops when mandatory safety snapshot fails', async () => {
    resetDiscoveryGlobals();
    global.RestoreReconciliation.createMandatoryPreRestoreSnapshot = async () => ({ ok: false, error: 'disk_full' });
    let hydrateCalled = false;
    global.CloudBootstrap.hydrateFromDrive = async () => { hydrateCalled = true; return { ok: true }; };
    const discovery = loadFresh('cloud/cloud-data-discovery.js');
    const result = await discovery.confirmedCloudRestore(
      { kind: 'sync_checkpoint', validation: 'ready', path: 'checkpoint.json' },
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'disk_full');
    assert.strictEqual(hydrateCalled, false);
  });

  await check('AUD-RST-006 checkpoint restore fails on hydrate or reconciliation failure', async () => {
    resetDiscoveryGlobals();
    global.CloudBootstrap.hydrateFromDrive = async () => ({ ok: false, error: 'pull_failed' });
    let discovery = loadFresh('cloud/cloud-data-discovery.js');
    let result = await discovery.confirmedCloudRestore(
      { kind: 'sync_checkpoint', validation: 'ready', path: 'checkpoint.json' },
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'pull_failed');

    resetDiscoveryGlobals();
    global.RestoreReconciliation.afterRestoreDataSourceSelected = async () => ({ ok: false, error: 'reconcile_failed' });
    discovery = loadFresh('cloud/cloud-data-discovery.js');
    result = await discovery.confirmedCloudRestore(
      { kind: 'sync_checkpoint', validation: 'ready', path: 'checkpoint.json' },
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'reconcile_failed');
  });

  await check('AUD-RST-006 initial sync failure matrix never persists syncDone', async () => {
    const state = resetBootGlobals();
    loadFresh('cloud/boot-flow-ui.js');
    const boot = global.BootFlow;

    global.ActivationSyncDefaults.applyDefaults = async () => ({ ok: false, error: 'defaults_failed' });
    let result = await boot.runInitialSyncPipeline();
    assert.strictEqual(result.ok, false);
    assert.strictEqual(state.get('__tdw_boot_wizard__').syncDone, false);

    resetBootGlobals();
    global.SyncEngine.runOnce = async () => ({ ok: false, error: 'sync_failed' });
    result = await boot.runInitialSyncPipeline();
    assert.strictEqual(result.ok, false);
    assert.strictEqual(global.DB.get('__tdw_boot_wizard__').syncDone, false);

    resetBootGlobals();
    global.ensureCloudBootstrapReady = async () => ({ runNewDeviceBootstrap: async () => ({ ok: false, error: 'boot_failed' }) });
    result = await boot.runInitialSyncPipeline();
    assert.strictEqual(result.ok, false);
    assert.strictEqual(global.DB.get('__tdw_boot_wizard__').syncDone, false);

    resetBootGlobals();
    global.users = [];
    global.OwnerManagement.getOwnerState = () => ({ state: 'OWNER_REQUIRED' });
    result = await boot.runInitialSyncPipeline();
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'owner_credential_required');
    assert.strictEqual(global.DB.get('__tdw_boot_wizard__').syncDone, false);
  });

  await check('AUD-RST-006 initial sync marks completion only after every downstream result passes', async () => {
    resetBootGlobals();
    loadFresh('cloud/boot-flow-ui.js');
    const boot = global.BootFlow;
    const result = await boot.runInitialSyncPipeline();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(global.DB.get('__tdw_boot_wizard__').syncDone, true);
  });

  await check('AUD-BOOT-002 setup connectivity policy is explicit and stable', async () => {
    resetBootGlobals();
    loadFresh('cloud/boot-flow-ui.js');
    const policy = global.BootFlow.getSetupConnectivityPolicy();
    assert.strictEqual(policy.mode, 'cloud_required_for_initial_setup');
    assert.strictEqual(policy.initialSetupRequiresGoogle, true);
    assert.strictEqual(policy.establishedOfflineStartAllowed, true);
  });

  await check('AUD-BOOT-003 source choices map to explicit non-overwriting operations', async () => {
    resetBootGlobals();
    loadFresh('cloud/boot-flow-ui.js');
    assert.strictEqual(global.BootFlow.initialOperationForChoice('empty'), 'push');
    assert.strictEqual(global.BootFlow.initialOperationForChoice('cloud'), 'pull');
    assert.strictEqual(global.BootFlow.initialOperationForChoice('local'), 'reconcile_verified_local');
    assert.strictEqual(global.BootFlow.initialOperationForChoice('file'), 'reconcile_verified_local');
    assert.strictEqual(global.BootFlow.initialOperationForChoice('skip_existing'), 'reconcile_verified_local');
  });

  await check('AUD-BOOT-003 verified local choice never calls initial pull/bootstrap hydrate', async () => {
    resetBootGlobals();
    global.DB.set('__tdw_boot_wizard__', { restoreChoice: 'local', syncDone: false });
    let runOnceCalls = 0;
    global.SyncEngine.runOnce = async () => { runOnceCalls += 1; return { ok: true }; };
    global.RestoreReconciliation = { loadState: () => ({ pullDone: true, pushAllowed: true }) };
    let markedBranch = null;
    global.ensureCloudBootstrapReady = async () => ({
      runNewDeviceBootstrap: async () => { throw new Error('local_choice_must_not_hydrate'); },
      markBootstrapComplete: (branchId) => { markedBranch = branchId; },
    });
    loadFresh('cloud/boot-flow-ui.js');
    const result = await global.BootFlow.runInitialSyncPipeline();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(runOnceCalls, 0);
    assert.strictEqual(markedBranch, 'BR-1');
    assert.strictEqual(global.DB.get('__tdw_boot_wizard__').syncDone, true);
  });

  await check('AUD-BOOT-008 verified Backup V2 runs operation pull but skips duplicate full-config hydrate', async () => {
    resetBootGlobals();
    global.DB.set('__tdw_boot_wizard__', {
      restoreChoice: 'cloud',
      restoreVerifiedDatabase: true,
      syncDone: false,
      completedSteps: ['google'],
    });
    let pullCalls = 0;
    global.SyncEngine.runOnce = async (options) => {
      pullCalls += 1;
      assert.strictEqual(options.direction, 'pull');
      return { ok: true };
    };
    let fullHydrateCalls = 0;
    let markedBranch = null;
    global.ensureCloudBootstrapReady = async () => ({
      runNewDeviceBootstrap: async () => { fullHydrateCalls += 1; return { ok: false }; },
      markBootstrapComplete: (branchId) => { markedBranch = branchId; },
    });
    loadFresh('cloud/boot-flow-ui.js');
    const result = await global.BootFlow.runInitialSyncPipeline();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(pullCalls, 1);
    assert.strictEqual(fullHydrateCalls, 0);
    assert.strictEqual(markedBranch, 'BR-1');
    assert.strictEqual(global.DB.get('__tdw_boot_wizard__').syncDone, true);
  });

  await check('AUD-BOOT-001 authenticated FirstRun wizard cannot auto-open from dataset heuristics', async () => {
    const fs = require('fs');
    const source = fs.readFileSync(path.join(__dirname, '../../cupping-first-run.js'), 'utf8');
    const start = source.indexOf('function shouldShowSetupWizard');
    const end = source.indexOf('function wizardSeedCatalog', start);
    const body = source.slice(start, end);
    assert.match(body, /forceWizard === true/);
    assert.doesNotMatch(body, /const fresh|wizardStep \|\| 0\) > 0/);
    assert.match(source, /SetupStateService[\s\S]{0,250}BootFlow/);
  });

  const failed = results.filter((row) => !row.ok);
  console.log(`\nP0-C restore truth + Boot gate: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
})();
