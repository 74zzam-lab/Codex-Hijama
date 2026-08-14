#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const Database = require('better-sqlite3');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdw-legacy-cloud-restore-'));
const userData = path.join(root, 'profile');
fs.mkdirSync(userData, { recursive: true });

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`protected:${value}`, 'utf8'),
  decryptString: (value) => value.toString('utf8').replace(/^protected:/, ''),
};
const electronMock = {
  app: { getPath: (name) => (name === 'userData' ? userData : root) },
  dialog: {},
  safeStorage,
};
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return originalLoad.call(this, request, parent, isMain);
};

let service;
let backupIpc;
try {
  service = require('../../electron/database/service');
  backupIpc = require('../../electron/backup-v2-ipc');
} finally {
  Module._load = originalLoad;
}
const passwordAuth = require('../../electron/security/password-auth');

function encryptLegacy(snapshot, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password, salt, 250000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(snapshot), 'utf8'), cipher.final()]);
  return JSON.stringify({
    _meta: { version: 3, encrypted: true, alg: 'AES-256-GCM' },
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    data: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString('base64'),
  });
}

(async () => {
  const ownerPassword = 'Owner-runtime-password-2026!';
  const staffPassword = 'Staff-runtime-password-2026!';
  const centerId = 'CTR-LEGACY-RESTORE';
  const branchId = 'BR-MAIN';
  const currentLicense = {
    licenseUuid: 'LIC-LEGACY-RESTORE',
    centerId,
    centerName: 'Runtime Center',
    branches: [{ id: branchId, name: 'Main', active: true }],
    expiresAt: '2027-12-31T23:59:59.000Z',
    limits: { maxDevices: 5 },
  };
  const activation = service.commitSetupActivation({
    license: currentLicense,
    legacyLicense: { centerId, expiry: '2027-12-31', status: 'valid' },
    remotePath: 'NajjarTech/license.json',
  });
  assert.equal(activation.ok, true, 'bootstrap activation should commit');
  const deviceBinding = service.commitSetupOrganizationDevice({
    license: currentLicense,
    centerName: currentLicense.centerName,
    branchId,
    deviceName: 'Restored workstation',
  });
  assert.equal(deviceBinding.ok, true, deviceBinding.error || 'bootstrap device binding should commit');

  const snapshot = {
    _meta: { version: 3, centerId, organizationId: centerId, branchId, date: '2026-07-29T18:22:48.025Z' },
    clientsRegistry: [{ id: 'CLIENT-1', name: 'Restored Client', centerId, branchId }],
    cases: [],
    bookings: [],
    doctors: [{ id: 'EMP-1', name: 'Restored Employee', centerId, branchId }],
    attendance: [],
    expenses: [],
    users: [
      {
        id: 'OWNER-1', username: 'owner-restored', fullName: 'Restored Owner', role: 'owner', active: true,
        password: passwordAuth.hashPasswordV2(ownerPassword), mustChangePassword: false,
        seedDefaultPassword: false, credentialRevision: 4, centerId,
      },
      {
        id: 'STAFF-1', username: 'staff-restored', fullName: 'Restored Staff', role: 'reception', active: true,
        password: passwordAuth.hashPasswordV2(staffPassword), mustChangePassword: false,
        seedDefaultPassword: false, credentialRevision: 2, centerId,
      },
    ],
    settings: { centerName: 'Restored Runtime Center' },
    services: [],
    packages: [],
  };

  const legacyPath = path.join(root, 'legacy-cloud.tdw');
  fs.writeFileSync(legacyPath, encryptLegacy(snapshot, 'legacy-backup-password'), 'utf8');
  const decrypted = backupIpc.readLegacyBackupSnapshot(legacyPath, 'legacy-backup-password');
  assert.deepEqual(decrypted._meta, snapshot._meta, 'legacy envelope must decrypt exactly');
  assert.throws(
    () => backupIpc.readLegacyBackupSnapshot(legacyPath, 'wrong-password'),
    (error) => error?.code === 'legacy_backup_password_invalid',
    'wrong legacy password must fail before DB mutation',
  );

  const restored = service.bootstrapFromLocalSnapshot(decrypted, {
    force: true,
    sourceLabel: 'first-setup-legacy-cloud-backup',
  });
  assert.equal(restored.ok, true, `${restored.error || 'legacy restore failed'} ${JSON.stringify(restored.targetClassification || {})}`);
  assert.equal(restored.atomicSwap, true, 'legacy migration must use atomic swap');
  assert.equal(restored.targetClassification.classification, 'bootstrap_only');

  const dbPath = path.join(userData, 'database', 'tadawi.db');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM clients WHERE id='CLIENT-1'").get().c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM employees WHERE id='EMP-1'").get().c, 1);
  db.close();

  const users = service.listUsersForAuthentication();
  assert.equal(users.length, 2, 'all restored login accounts must be present');
  const owner = users.find((user) => user.id === 'OWNER-1');
  const staff = users.find((user) => user.id === 'STAFF-1');
  assert.equal(passwordAuth.verifyStoredPassword(ownerPassword, owner.password, owner.username), true);
  assert.equal(passwordAuth.verifyStoredPassword(staffPassword, staff.password, staff.username), true);
  const preauth = service.hydratePreauth();
  assert.equal(preauth.data.users.length, 2, 'preauth must expose every active account');
  assert.equal(preauth.data.users.every((user) => user.hasUsableCredential === true), true);
  assert.deepEqual(service.getStoredLicense(), currentLicense, 'current verified activation must survive legacy restore');
  const restoredPreauth = service.hydratePreauth();
  assert.equal(restoredPreauth.data.__tdw_device_registry__.registered.length, 1, 'current device binding must survive legacy restore');

  service.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('PASS legacy cloud restore: decrypt + bootstrap-only gate + atomic SQLite swap + users/passwords/license');
})().catch((error) => {
  try { service?.close?.(); } catch { /* best-effort test cleanup */ }
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort test cleanup */ }
  console.error(error);
  process.exit(1);
});
