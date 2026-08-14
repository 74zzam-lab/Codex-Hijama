#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const discoverySource = fs.readFileSync(path.join(root, 'cloud', 'cloud-data-discovery.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function functionSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing source slice ${startMarker}`);
  return source.slice(start, end);
}

async function testAsyncRestorePasswordIsCloneable() {
  let captured = null;
  const sandbox = {
    console,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    structuredClone,
    getBackupV2Password: async () => 'runtime-recovery-secret',
    getBackupV2IdentityMeta: () => ({ centerId: 'CTR-RESTORE', branchId: 'BR-MAIN' }),
    LicenseCloud: { loadLocal: () => ({ centerId: 'CTR-RESTORE' }) },
    DeviceConfig: { load: () => ({ centerId: 'CTR-RESTORE', lockedBranchId: 'BR-MAIN' }) },
    SqliteBridge: { hydrateIntoMemory: async () => ({ ok: true }) },
    BackupBridge: {
      discoverCloudRestorePoints: async () => ({ ok: true }),
      v2SetupCloudRestore: async (options) => {
        captured = structuredClone(options);
        return {
          ok: true,
          database: { ok: true },
          progress: [{ stage: 'staging_restore' }, { stage: 'restore_complete' }],
        };
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(discoverySource, sandbox, { filename: 'cloud-data-discovery.js' });
  const result = await sandbox.CloudDataDiscovery.confirmedCloudRestore({
    kind: 'backup_file', validation: 'ready', path: 'Backups/V2/restore.tdw',
  });
  assert.equal(result.ok, true);
  assert.equal(captured.password, 'runtime-recovery-secret');
  assert.equal(typeof captured.password, 'string');
}

function testAuthoritativeLicenseLoad() {
  const authoritative = {
    licenseId: 'LIC-SQLITE', expiry: '2030-01-01', fingerprint: 'DEVICE_ANY', deviceMode: 'any',
  };
  const sandbox = {
    DB: { get: (key, fallback) => key === 'commercial_license_data_v2' ? authoritative : fallback },
    localStorage: { getItem: () => null },
    sessionStorage: { getItem: () => null },
    licDecrypt: () => null,
  };
  vm.runInNewContext(
    functionSlice(indexSource, 'function licLoad() {', 'function licSaveMeta('),
    sandbox,
    { filename: 'lic-load-slice.js' },
  );
  assert.equal(sandbox.licLoad(), authoritative);
}

async function testPreauthUserUsesMainAuthentication() {
  const elements = {
    'login-role': { value: 'owner' },
    'login-username': { value: 'OWNER-1' },
    'login-password': { value: 'correct-password' },
    'login-error': { style: {}, textContent: '' },
  };
  let mainCalls = 0;
  let finished = 0;
  const sandbox = {
    console,
    document: { getElementById: (id) => elements[id] || null },
    users: [{ id: 'OWNER-1', username: 'owner', fullName: 'Owner', role: 'owner', active: true }],
    DEV_ACCOUNT: { password: 'unused', username: 'dev' },
    verifyPW: async () => { throw new Error('renderer_password_hash_must_not_be_required'); },
    finishLogin: async () => { finished += 1; return true; },
    upgradeUserPassword: async () => {},
    _licStatus: 'valid',
    _authPending: false,
    _pendingRbacProof: null,
    currentUser: null,
    RolePolicy: null,
    cuppingElectron: {
      rbac: {
        authenticateUser: async (credentials) => {
          mainCalls += 1;
          assert.deepEqual(credentials, { userId: 'OWNER-1', role: 'owner', password: 'correct-password' });
          return { ok: true, proof: 'main-proof' };
        },
      },
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(
    functionSlice(indexSource, 'async function doLogin() {', 'async function finishLogin() {'),
    sandbox,
    { filename: 'login-slice.js' },
  );
  await sandbox.doLogin();
  assert.equal(mainCalls, 1);
  assert.equal(finished, 1);
  assert.equal(sandbox._pendingRbacProof, 'main-proof');
  assert.equal(sandbox.currentUser.id, 'OWNER-1');
}

(async () => {
  await testAsyncRestorePasswordIsCloneable();
  testAuthoritativeLicenseLoad();
  await testPreauthUserUsesMainAuthentication();

  for (const relative of [
    'cloud/cloud-data-discovery.js',
    'cloud/boot-flow-ui.js',
    'cloud/backup-layer.js',
    'cloud/restore-reconciliation.js',
  ]) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    const calls = [...source.matchAll(/getBackupV2Password\(\)/g)];
    for (const call of calls) {
      const before = source.slice(Math.max(0, call.index - 80), call.index);
      assert.match(before, /await\s+(?:global\.)?$/, `${relative} has an unawaited Backup V2 password call`);
    }
  }

  const bootFlow = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
  assert.match(bootFlow, /cloud\.restorePoints[\s\S]*?selectedCloudPoint/, 'restore UI must expose discovered backups instead of newest-only restore');
  assert.match(bootFlow, /confirmedCloudRestore\(selectedCloudPoint/, 'restore must execute the selected cloud backup');
  assert.doesNotMatch(bootFlow, /confirmedCloudRestore\(newest/, 'newest-only restore path must not remain');
  assert.match(bootFlow, /backupPoints\.length > 1 \? null : newest/, 'multiple backups must require explicit selection');
  assert.match(bootFlow, /selectedRestoreButton\.disabled = false/, 'selecting a backup must enable the restore action');
  assert.match(bootFlow, /SafeRender\?\.setStructuredHtml/, 'cloud backup metadata must pass through the unified safe renderer');

  console.log('PASS current restore/license/login: cloneable password + SQLite license + Main-owned user authentication');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
