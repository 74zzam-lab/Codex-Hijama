#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const Database = require('better-sqlite3');
const { openDatabase } = require('../../database/connection');
const { createRepositories } = require('../../database/repositories');
const backupV2 = require('../../electron/backup-v2-core');
const V = require('../../electron/security/ipc-validate');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdw-current-setup-restore-'));
const sourceUserData = path.join(root, 'source');
const targetUserData = path.join(root, 'target');
const sourceDbPath = path.join(sourceUserData, 'database', 'tadawi.db');
const backupPath = path.join(root, 'source.tdw');
const password = 'same-device-safe-storage-secret';

fs.mkdirSync(path.dirname(sourceDbPath), { recursive: true });
fs.mkdirSync(path.join(sourceUserData, 'settings'), { recursive: true });
fs.mkdirSync(targetUserData, { recursive: true });
const db = openDatabase(sourceDbPath);
db.prepare(`INSERT INTO clients
  (id,name,phone,center_id,branch_id,payload_json,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?)`).run(
  'CLIENT-RESTORED', 'Restored Client', '0500000000', 'CTR-RESTORE', 'BR-MAIN',
  JSON.stringify({ id: 'CLIENT-RESTORED', name: 'Restored Client', centerId: 'CTR-RESTORE', branchId: 'BR-MAIN' }),
  new Date().toISOString(), new Date().toISOString(),
);
db.close();

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`protected:${value}`, 'utf8'),
  decryptString: (value) => value.toString('utf8').replace(/^protected:/, ''),
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === 'electron') return { dialog: {}, safeStorage };
  return originalLoad.call(this, request, parent, isMain);
};
let ipc;
try {
  ipc = require('../../electron/backup-v2-ipc');
} finally {
  Module._load = originalLoad;
}

async function register(userDataDir) {
  const handlers = new Map();
  const registration = ipc.registerBackupV2Ipc({
    handle: (channel, handler) => handlers.set(channel, handler),
    V,
    getUserDataPath: () => userDataDir,
    appVersion: 'test',
    app: null,
    closeDatabase: async () => {},
    reopenDatabase: async () => {},
    getLiveIdentity: () => ({ centerId: '', branchId: '' }),
  });
  return { handlers, registration };
}

(async () => {
  await backupV2.createBackupFile({
    userDataDir: sourceUserData,
    outputPath: backupPath,
    password,
    centerId: 'CTR-RESTORE',
    organizationId: 'CTR-RESTORE',
    branchId: 'BR-MAIN',
    branchIds: ['BR-MAIN'],
  });

  const vault = ipc.createFileCredentialVault(targetUserData);
  vault.set(ipc.MASTER_SECRET_CREDENTIAL, password);
  const { handlers, registration } = await register(targetUserData);
  const result = await handlers.get('backup:v2:setupLocalRestore')(null, {
    filePath: backupPath,
    setupMode: true,
    relaunch: false,
  });
  assert.equal(result.ok, true);
  assert.doesNotThrow(() => structuredClone(result), 'restore IPC result must be cloneable');
  const restoredDbPath = path.join(targetUserData, 'database', 'tadawi.db');
  const restored = new Database(restoredDbPath, { readonly: true, fileMustExist: true });
  assert.equal(restored.prepare('SELECT COUNT(*) AS c FROM clients WHERE id=?').get('CLIENT-RESTORED').c, 1);
  restored.close();
  registration.scheduler?.stop?.();

  const bootstrapTarget = path.join(root, 'bootstrap-target');
  const bootstrapDbPath = path.join(bootstrapTarget, 'database', 'tadawi.db');
  fs.mkdirSync(path.dirname(bootstrapDbPath), { recursive: true });
  const bootstrapDb = openDatabase(bootstrapDbPath);
  const bootstrapRepos = createRepositories(bootstrapDb);
  const preservedLicense = {
    licenseUuid: 'LIC-CURRENT-SETUP', centerId: 'CTR-RESTORE',
    branches: [{ id: 'BR-MAIN', name: 'Main', active: true }], expiresAt: '2027-12-31T23:59:59.000Z',
  };
  const preservedDevice = {
    deviceUuid: 'DEVICE-CURRENT-SETUP', deviceName: 'Current setup device',
    centerId: 'CTR-RESTORE', lockedBranchId: 'BR-MAIN', branchLocked: true,
  };
  bootstrapRepos.kv.set('__tdw_cloud_license__', preservedLicense);
  bootstrapRepos.kv.set('commercial_license_data_v2', { centerId: 'CTR-RESTORE', status: 'valid', expiry: '2027-12-31' });
  bootstrapRepos.kv.set('__tdw_device_config__', preservedDevice);
  bootstrapRepos.kv.set('__tdw_meta__', { centerId: 'CTR-RESTORE', setup: true });
  bootstrapRepos.forEntity('settings').upsert(
    { id: '__singleton__', value: { centerName: 'Current Setup Center' } },
    { centerId: 'CTR-RESTORE', branchId: '__ORG__' },
  );
  bootstrapRepos.entities.upsert('__tdw_device_registry__', {
    id: '__singleton__',
    value: { registered: [{ deviceUuid: preservedDevice.deviceUuid, branchId: 'BR-MAIN', active: true }] },
  }, { centerId: 'CTR-RESTORE', branchId: '__ORG__', organizationScoped: true });
  bootstrapDb.prepare("INSERT INTO meta(key,value) VALUES('authorityCenterId','CTR-RESTORE') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  bootstrapDb.close();
  const capturedSetup = ipc.captureSetupRestoreState(bootstrapDbPath);
  assert.deepEqual(capturedSetup.kv.__tdw_cloud_license__, preservedLicense, 'setup state capture must include license');
  assert.deepEqual(capturedSetup.kv.__tdw_device_config__, preservedDevice, 'setup state capture must include device');
  assert.equal(capturedSetup.deviceRegistries.length, 1, 'setup state capture must include device registry');
  ipc.createFileCredentialVault(bootstrapTarget).set(ipc.MASTER_SECRET_CREDENTIAL, password);
  const bootstrapRegistration = await register(bootstrapTarget);
  const bootstrapResult = await bootstrapRegistration.handlers.get('backup:v2:setupLocalRestore')(null, {
    filePath: backupPath,
    setupMode: true,
    relaunch: false,
  });
  assert.equal(bootstrapResult.ok, true);
  const merged = new Database(bootstrapDbPath, { readonly: true, fileMustExist: true });
  const readKv = (key) => JSON.parse(merged.prepare('SELECT value_json FROM kv_store WHERE key=?').get(key).value_json);
  assert.deepEqual(readKv('__tdw_cloud_license__'), preservedLicense, 'current setup license must survive V2 DB swap');
  assert.deepEqual(readKv('__tdw_device_config__'), preservedDevice, 'current device/branch binding must survive V2 DB swap');
  const registry = JSON.parse(merged.prepare(`
    SELECT payload_json FROM p0b_entities
    WHERE entity_type='__tdw_device_registry__' AND entity_id='__singleton__'
  `).get().payload_json);
  assert.equal(registry.value.registered.some((device) => device.deviceUuid === preservedDevice.deviceUuid), true);
  assert.equal(merged.prepare('SELECT COUNT(*) AS c FROM clients WHERE id=?').get('CLIENT-RESTORED').c, 1);
  merged.close();
  bootstrapRegistration.registration.scheduler?.stop?.();

  const wrongTarget = path.join(root, 'wrong-target');
  fs.mkdirSync(wrongTarget, { recursive: true });
  const wrong = await register(wrongTarget);
  await assert.rejects(
    wrong.handlers.get('backup:v2:setupLocalRestore')(null, {
      filePath: backupPath,
      password: 'definitely-wrong-password',
      setupMode: true,
      relaunch: false,
    }),
    (error) => String(error?.code || '').includes('backup_authentication_failed'),
  );
  assert.equal(fs.existsSync(path.join(wrongTarget, 'database', 'tadawi.db')), false, 'wrong password must not replace target DB');
  wrong.registration.scheduler?.stop?.();

  fs.rmSync(root, { recursive: true, force: true });
  console.log('PASS setup restore runtime: Main safeStorage fallback + cloneable result + wrong-password no-swap');
})().catch((error) => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort test cleanup */ }
  console.error(error);
  process.exit(1);
});
