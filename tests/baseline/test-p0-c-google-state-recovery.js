#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');

function loadFresh(relative) {
  if (relative === 'cloud/boot-flow-ui.js') {
    require(path.join(root, 'cloud/publication-contract.js'));
    require(path.join(root, 'cloud/readback-verification-contract.js'));
    require(path.join(root, 'cloud/initial-sync-direction-contract.js'));
  }
  const resolved = require.resolve(path.join(root, relative));
  delete require.cache[resolved];
  return require(resolved);
}

async function check(name, operation) {
  try {
    await operation();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}: ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  await check('AUD-BOOT-005 activation defaults recover trusted Main Google state before readiness', async () => {
    let ensureOptions = null;
    global.settings = {
      centerName: 'Center',
      backup: { providers: { google: { connected: false, userDisconnected: true } } },
    };
    global.DriveAdapter = {
      isConnected: () => global.settings.backup.providers.google.connected === true,
      ensureConnected: async (options) => {
        ensureOptions = options;
        global.settings.backup.providers.google = {
          connected: true, oauth: true, userDisconnected: false, email: 'owner@example.test',
        };
        return true;
      },
    };
    global.LicenseCloud = { loadLocal: () => ({ centerId: 'CTR-1' }) };
    global.DeviceConfig = { load: () => ({ lockedBranchId: 'BR-1', deviceUuid: 'DEV-1' }) };
    global.CloudMeta = {
      isCloudV2Enabled: () => global.settings.cloudV2Enabled === true,
      setCloudV2Enabled: (value) => { global.settings.cloudV2Enabled = value; },
      loadMeta: () => ({}),
      saveMeta: () => {},
    };
    global.CloudV2 = {
      maybeAutoEnableCloudV2: async () => {
        global.settings.cloudV2Enabled = true;
        return { ok: true };
      },
    };
    global.persistData = async () => ({ ok: true });
    global.SyncEngine = { isRunning: () => true };

    loadFresh('cloud/activation-sync-defaults.js');
    const result = await global.ActivationSyncDefaults.applyDefaults({
      startSync: false,
      startBackup: false,
      acceptLiveReconnect: true,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(ensureOptions.acceptLiveReconnect, true);
    assert.strictEqual(global.settings.cloudV2Enabled, true);
    assert.strictEqual(global.settings.backup.providers.google.userDisconnected, false);
  });

  await check('AUD-BOOT-005 BootFlow refreshes Google before applying Cloud V2 defaults', async () => {
    const state = new Map();
    state.set('__tdw_boot_wizard__', {
      path: 'existing',
      restoreChoice: 'cloud',
      syncDone: false,
      completedSteps: ['language', 'google', 'license', 'organization', 'branch_select', 'restore', 'owner'],
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
        getSession: async () => ({ ok: true, session: { userId: 'OWNER-P0C', role: 'owner' } }),
      },
    };
    global.settings = { backup: { providers: { google: { connected: false, userDisconnected: true } } } };
    let defaultsOptions = null;
    global.DriveAdapter = {
      isConnected: () => global.settings.backup.providers.google.connected === true,
      ensureConnected: async (options) => {
        assert.strictEqual(options.acceptLiveReconnect, true);
        global.settings.backup.providers.google = { connected: true, oauth: true, userDisconnected: false };
        return true;
      },
    };
    global.ActivationSyncDefaults = {
      applyDefaults: async (options) => { defaultsOptions = options; return { ok: true }; },
    };
    global.SyncEngine = {
      getReadiness: () => ({ ready: true }),
      isRunning: () => true,
      runOnce: async () => ({ ok: true }),
    };
    global.DeviceConfig = { load: () => ({ lockedBranchId: 'BR-1', deviceUuid: 'DEV-1' }) };
    global.OwnerManagement = { getOwnerState: () => ({ state: 'OWNER_EXISTS' }) };
    global.ensureCloudBootstrapReady = async () => ({
      runNewDeviceBootstrap: async () => ({ ok: true }),
      markBootstrapComplete: () => {},
    });

    loadFresh('cloud/boot-flow-ui.js');
    const result = await global.BootFlow.runInitialSyncPipeline();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(defaultsOptions.acceptLiveReconnect, true);
    assert.strictEqual(state.get('__tdw_boot_wizard__').syncDone, true);
  });

  await check('AUD-BOOT-005 stale renderer disconnect flag cannot delete a newly connected Main token', async () => {
    const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const start = source.indexOf('async function syncCloudStatusFromElectron(options)');
    const end = source.indexOf('\nfunction formatBackupDateTime', start);
    assert.ok(start > 0 && end > start, 'syncCloudStatusFromElectron source not found');
    const functionSource = source.slice(start, end);
    let disconnectCalls = 0;
    const sandbox = {
      settings: {
        backup: {
          cloudProvider: 'google', cloudEnabled: false,
          providers: { google: { connected: false, userDisconnected: true, email: '' } },
        },
      },
      BackupBridge: {
        isElectron: () => true,
        getCloudStatus: async () => ({ connected: true, oauth: true, hasRefreshToken: true, email: 'owner@example.test' }),
        disconnectCloud: async () => { disconnectCalls += 1; return { ok: true }; },
      },
      persistData: async () => ({ ok: true }),
      commitGoogleConnectionForSetup: async (patch) => {
        sandbox.settings.backup.providers.google = {
          ...(sandbox.settings.backup.providers.google || {}),
          connected: patch.connected === true,
          email: patch.email || '',
          oauth: patch.oauth !== false,
          hasRefreshToken: patch.hasRefreshToken === true,
          userDisconnected: patch.userDisconnected === true,
        };
        sandbox.settings.backup.cloudEnabled = patch.connected === true;
        return { ok: true, google: sandbox.settings.backup.providers.google, settings: sandbox.settings };
      },
      renderCloudDbBackupUI: () => {},
      renderBackupCloudStatus: () => {},
      renderBackupUI: () => {},
    };
    vm.runInNewContext(`${functionSource}\nthis.syncStatus = syncCloudStatusFromElectron;`, sandbox);
    const result = await sandbox.syncStatus({ acceptLiveReconnect: true });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.connected, true);
    assert.strictEqual(disconnectCalls, 0);
    assert.strictEqual(sandbox.settings.backup.providers.google.userDisconnected, false);
  });

  if (!process.exitCode) console.log('P0-C Google state recovery PASS: Main OAuth state -> renderer -> Cloud V2 readiness');
})();
