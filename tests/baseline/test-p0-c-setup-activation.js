#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const results = [];
async function check(name, operation) {
  try {
    await operation();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.stack || error.message });
    console.error(`FAIL  ${name}: ${error.stack || error.message}`);
  }
}

const setupActivation = require('../../electron/setup-activation');
const passwordAuth = require('../../electron/security/password-auth');

function activeDocument(overrides = {}) {
  return {
    schemaVersion: 2,
    centerId: 'CTR-P0C',
    centerName: 'P0C Center',
    licenseId: 'LIC-P0C',
    licenseUuid: 'UUID-P0C',
    packageId: '05',
    expiresAt: '2099-12-31',
    issuedAt: '2026-08-10',
    limits: { maxDevices: 0, maxBranches: 3 },
    ownerIdentity: { authorizedEmail: 'owner@example.test' },
    signature: 'verified-by-fixture',
    ...overrides,
  };
}

function dependencies(document = activeDocument(), status = {}) {
  return {
    googleDrive: {
      getStatus: async () => ({ connected: true, needsReauth: false, email: 'owner@example.test', ...status }),
      downloadBackup: async () => ({ ok: true, text: JSON.stringify(document) }),
    },
    licenseVerifier: { verifyLicenseDoc: async () => ({ ok: true }) },
  };
}

(async () => {
  await check('production setup verifier modules load from the real runtime path', async () => {
    const verifier = setupActivation.loadLicenseVerifier();
    assert.strictEqual(typeof verifier?.verifyLicenseDoc, 'function');
  });

  await check('main-owned setup verifier accepts only a verified Drive license path', async () => {
    const verified = await setupActivation.verifyRemoteSetupActivation({
      remotePath: 'NajjarTech/CTR-P0C/License/license.json',
      legacyLicense: { licenseId: 'UUID-P0C', edition: 'full', injected: 'drop-me' },
    }, dependencies());
    assert.strictEqual(verified.ok, true);
    assert.strictEqual(verified.license.centerId, 'CTR-P0C');
    assert.strictEqual(verified.legacyLicense.licenseId, 'UUID-P0C');
    assert.strictEqual(verified.legacyLicense.injected, undefined);
    assert.strictEqual(verified.legacyLicense.fingerprint, 'DEVICE_ANY');
  });

  await check('setup verifier rejects traversal, expired licenses and Google identity mismatch', async () => {
    await assert.rejects(
      setupActivation.verifyRemoteSetupActivation({ remotePath: '../license.json', legacyLicense: {} }, dependencies()),
      /invalid_remote_license_path/,
    );
    await assert.rejects(
      setupActivation.verifyRemoteSetupActivation({
        remotePath: 'NajjarTech/C/License/license.json', legacyLicense: {},
      }, dependencies(activeDocument({ expiresAt: '2020-01-01' }))),
      /license_expired/,
    );
    await assert.rejects(
      setupActivation.verifyRemoteSetupActivation({
        remotePath: 'NajjarTech/C/License/license.json', legacyLicense: {},
      }, dependencies(activeDocument(), { email: 'other@example.test' })),
      /google_email_mismatch/,
    );
  });

  await check('setup publishes legacy V5 first branch while V6 remains immutable', async () => {
    const branchDependencies = {
      legacyCrypto: { canonicalJson: JSON.stringify, signHex: () => 'legacy-fixture-signature' },
      licenseVerifier: { verifyLicenseDoc: async () => ({ ok: true }) },
      googleDrive: { getStatus: async () => ({ connected: false }) },
    };
    const legacyCreated = await setupActivation.publishFirstSetupBranch(
      'NajjarTech/CTR-P0C/License/license.json',
      activeDocument({ branches: [], licenseVersion: 1 }),
      { id: 'BR-MAIN', name: 'الفرع الأول', code: 'MAIN' },
      branchDependencies,
    );
    assert.strictEqual(legacyCreated.ok, true);
    assert.strictEqual(legacyCreated.branch.id, 'BR-MAIN');
    assert.strictEqual(legacyCreated.license.signature, 'legacy-fixture-signature');

    const preIssued = activeDocument({
      branches: [{ id: 'BR-MAIN', name: 'الفرع الأول', code: 'MAIN', active: true }],
      licenseVersion: 1,
    });
    const existing = await setupActivation.publishFirstSetupBranch(
      'NajjarTech/CTR-P0C/License/license.json',
      preIssued,
      { id: 'BR-MAIN', name: 'الفرع الأول', code: 'MAIN' },
      branchDependencies,
    );
    assert.strictEqual(existing.ok, true);
    assert.strictEqual(existing.already, true);
    assert.strictEqual(existing.license.signature, 'legacy-fixture-signature');

    await assert.rejects(() => setupActivation.publishFirstSetupBranch(
      'NajjarTech/CTR-P0C/License/license.json',
      activeDocument({ schemaVersion: 6, branches: [], licenseVersion: 1 }),
      { id: 'BR-MAIN', name: 'الفرع الأول', code: 'MAIN' },
      branchDependencies,
    ), /license_branch_entitlement_missing_admin_reissue_required/);
  });

  await check('pre-auth no_session IPC envelope uses the narrow setup activation commit', async () => {
    const source = fs.readFileSync(path.join(root, 'cloud/license-legacy-bridge.js'), 'utf8');
    const calls = [];
    const context = {
      console,
      CommercialLicense: { registries: { feature: { features: [] } } },
      FEATURE_REGISTRY: [],
      FEATURE_ADDON_IDS: [],
      LicenseCloud: { verifyLicenseDoc: async () => ({ ok: true }) },
      LicenseLimits: { isMultiDeviceLicense: () => true },
      licGetFingerprint: () => 'fixture-device',
      cuppingElectron: {
        rbac: { getSession: async () => ({ ok: false, error: 'no_session' }) },
        database: {
          setupCommitActivation: async (payload) => {
            calls.push(payload);
            return { ok: true, committedAt: '2026-08-10T00:00:00.000Z' };
          },
        },
      },
      SqliteBridge: { hydrateIntoMemory: async () => ({ ok: true }) },
      licFinalizeFeatureState: async () => {},
    };
    context.window = context;
    vm.runInNewContext(source, context, { filename: 'license-legacy-bridge.js' });
    const result = await context.LicenseLegacyBridge.applyFromCloudDoc(activeDocument(), {
      remotePath: 'NajjarTech/CTR-P0C/License/license.json',
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.setupCommitted, true);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].remotePath, 'NajjarTech/CTR-P0C/License/license.json');
    assert.strictEqual(context.LicenseLegacyBridge.unwrapAuthenticatedSession({ ok: false, error: 'no_session' }), null);
  });

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tadawi-p0c-activation-'));
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return { app: { getPath: () => tempRoot } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let service;
  try {
    service = require('../../electron/database/service');
  } finally {
    Module._load = originalLoad;
  }
  const db = service.ensureDb();
  service.enableSqlitePrimary();

  await check('setup activation SQLite commit rolls back every key on injected failure', async () => {
    db.exec(`
      CREATE TRIGGER p0c_fail_legacy BEFORE INSERT ON kv_store
      WHEN NEW.key='commercial_license_data_v2'
      BEGIN SELECT RAISE(ABORT, 'injected_setup_commit_failure'); END;
    `);
    const result = service.commitSetupActivation({
      license: activeDocument(),
      legacyLicense: { licenseId: 'UUID-P0C', expiry: '2099-12-31' },
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.rolledBack, true);
    assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM kv_store').get().c, 0);
    assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM meta WHERE key='authorityCenterId'").get().c, 0);
    db.exec('DROP TRIGGER p0c_fail_legacy');
  });

  await check('setup activation commits verified license, meta and legacy projection atomically', async () => {
    const result = service.commitSetupActivation({
      license: activeDocument(),
      legacyLicense: { licenseId: 'UUID-P0C', expiry: '2099-12-31', edition: 'full' },
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.setupActivation, true);
    assert.strictEqual(result.data.__tdw_cloud_license__.centerId, 'CTR-P0C');
    assert.strictEqual(result.data.__tdw_meta__.centerId, 'CTR-P0C');
    assert.strictEqual(result.data.commercial_license_data_v2.licenseId, 'UUID-P0C');
    assert.strictEqual(db.prepare("SELECT value FROM meta WHERE key='authorityCenterId'").get().value, 'CTR-P0C');
    assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM users').get().c, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM settings').get().c, 0);
  });

  await check('pre-auth organization and device binding commit only verified setup scope', async () => {
    const licenseWithBranch = activeDocument({
      branches: [{ id: 'BR-MAIN', name: 'الفرع الأول', active: true }],
    });
    const result = service.commitSetupOrganizationDevice({
      commandId: 'p0c-setup-org-device',
      license: licenseWithBranch,
      centerName: 'مركز P0C',
      branchId: 'BR-MAIN',
      deviceName: 'Reception-P0C',
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.deviceConfig.lockedBranchId, 'BR-MAIN');
    assert.strictEqual(result.deviceConfig.branchLocked, true);
    assert.strictEqual(result.deviceRegistryCommit.ok, true);
    assert.strictEqual(result.deviceRegistry.registered.length, 1);
    assert.strictEqual(result.settings.centerName, 'مركز P0C');
    assert.strictEqual(service.hydratePreauth().data.__tdw_device_config__.deviceName, 'Reception-P0C');
    assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM sync_outbox WHERE table_name='settings'").get().c, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM sync_outbox WHERE table_name='__tdw_device_registry__'").get().c, 1);

    const replay = service.commitSetupOrganizationDevice({
      commandId: 'p0c-setup-org-device',
      license: licenseWithBranch,
      centerName: 'مركز P0C',
      branchId: 'BR-MAIN',
      deviceName: 'Reception-P0C',
    });
    assert.strictEqual(replay.ok, true);
    assert.strictEqual(replay.deviceRegistry.registered.length, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM sync_outbox WHERE table_name='settings'").get().c, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM sync_outbox WHERE table_name='__tdw_device_registry__'").get().c, 1);

    const denied = service.commitSetupOrganizationDevice({
      license: licenseWithBranch,
      branchId: 'BR-NOT-LICENSED',
      deviceName: 'Denied',
    });
    assert.strictEqual(denied.ok, false);
    assert.strictEqual(denied.error, 'setup_branch_not_in_verified_license');
    assert.strictEqual(service.hydratePreauth().data.__tdw_device_config__.deviceName, 'Reception-P0C');
  });

  const ownerPassword = 'P0C-Owner-Strong-Password';
  const ownerPayload = {
    commandId: 'p0c-owner-setup',
    user: {
      id: 'OWNER-P0C',
      username: 'owner.p0c',
      fullName: 'P0C Owner',
      email: 'owner@example.test',
      password: passwordAuth.hashPasswordV2(ownerPassword),
      role: 'owner',
      active: true,
      credentialRevision: 1,
      passwordChangedAt: '2026-08-10T00:00:00.000Z',
    },
    ownerProfile: {
      salt: '0123456789abcdef0123456789abcdef',
      recovery: { type: 'code', hash: 'sha256:fixture-recovery-hash' },
      sessionEpoch: 1,
    },
  };

  await check('initial Owner commit rolls users/profile/outbox back together on failure', async () => {
    db.exec(`
      CREATE TRIGGER p0c_fail_owner_profile BEFORE INSERT ON p0b_entities
      WHEN NEW.entity_type='__tdw_owner_profile__'
      BEGIN SELECT RAISE(ABORT, 'injected_owner_profile_failure'); END;
    `);
    const result = service.commitSetupOwner(ownerPayload);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.rolledBack, true);
    assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM users').get().c, 0);
    assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM sync_outbox WHERE table_name='users'").get().c, 0);
    assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM p0b_entities WHERE entity_type='__tdw_owner_profile__'").get().c, 0);
    assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM p0b_entities WHERE entity_type='__tdw_owner_setup__'").get().c, 0);
    assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM kv_store WHERE key IN ('__tdw_owner_profile__','__tdw_owner_setup__')").get().c, 0);
    db.exec('DROP TRIGGER p0c_fail_owner_profile');
  });

  await check('first Owner password is authoritative, non-seed and immediately authenticates', async () => {
    const result = service.commitSetupOwner(ownerPayload);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.credentialRevision, 1);
    const stored = service.listUsersForAuthentication().find((user) => user.id === 'OWNER-P0C');
    assert.ok(stored);
    assert.strictEqual(stored.mustChangePassword, false);
    assert.strictEqual(stored.seedDefaultPassword, false);
    assert.strictEqual(stored.credentialRevision, 1);
    assert.ok(passwordAuth.verifyStoredPassword(ownerPassword, stored.password, stored.username));
    assert.ok(!passwordAuth.verifyStoredPassword('wrong-password', stored.password, stored.username));
    const profileRow = db.prepare(`
      SELECT payload_json FROM p0b_entities
      WHERE entity_type='__tdw_owner_profile__' AND entity_id='__singleton__'
    `).get();
    const profile = JSON.parse(profileRow.payload_json).value;
    assert.strictEqual(profile.passwordHash, null);
    assert.strictEqual(profile.credentialUserId, 'OWNER-P0C');
    assert.strictEqual(profile.credentialRevision, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM sync_outbox WHERE table_name='users'").get().c, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM sync_outbox WHERE table_name='__tdw_owner_profile__'").get().c, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM sync_outbox WHERE table_name='__tdw_owner_setup__'").get().c, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM kv_store WHERE key IN ('__tdw_owner_profile__','__tdw_owner_setup__')").get().c, 0);
    assert.strictEqual(service.hydratePreauth().data.users[0].hasUsableCredential, true);
    assert.strictEqual(service.hydratePreauth().data.__tdw_owner_setup__.status, 'complete');
  });

  await check('initial Owner endpoint is idempotently closed after a usable Owner exists', async () => {
    const duplicate = service.commitSetupOwner({
      ...ownerPayload,
      commandId: 'p0c-owner-duplicate',
      user: { ...ownerPayload.user, id: 'OWNER-SECOND', username: 'second.owner' },
    });
    assert.strictEqual(duplicate.ok, false);
    assert.strictEqual(duplicate.error, 'owner_already_present');
    assert.strictEqual(service.listUsersForAuthentication().filter((user) => user.role === 'owner').length, 1);
  });

  await check('setup activation cannot overwrite a populated operational database', async () => {
    const created = service.command({
      commandId: 'p0c-business-row', entity: 'clientsRegistry', action: 'upsert',
      record: { id: 'CLIENT-1', name: 'Existing' },
    }, { centerId: 'CTR-P0C', branchId: 'BR-A', actorId: 'OWNER', deviceId: 'DEV' });
    assert.strictEqual(created.ok, true);
    const replacement = activeDocument({ licenseUuid: 'UUID-REPLACEMENT', licenseId: 'LIC-REPLACEMENT' });
    const result = service.commitSetupActivation({
      license: replacement,
      legacyLicense: { licenseId: 'UUID-REPLACEMENT', expiry: '2099-12-31' },
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'setup_activation_target_not_empty');
    assert.strictEqual(service.hydratePreauth().data.__tdw_cloud_license__.licenseId, 'LIC-P0C');
  });

  await check('IPC exposes one narrow setup commit while protected generic writes remain guarded', async () => {
    const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
    const preload = fs.readFileSync(path.join(root, 'electron/preload.js'), 'utf8');
    const rbac = fs.readFileSync(path.join(root, 'electron/rbac-session.js'), 'utf8');
    const bridge = fs.readFileSync(path.join(root, 'cloud/license-legacy-bridge.js'), 'utf8');
    assert.match(main, /handle\('database:setupCommitActivation'/);
    assert.match(main, /verifyRemoteSetupActivation/);
    assert.match(preload, /setupCommitActivation/);
    assert.match(preload, /setupCommitOrganizationDevice/);
    assert.match(preload, /setupCommitOwner/);
    assert.match(rbac, /'database:setupCommitActivation': \{ public: true \}/);
    assert.match(rbac, /'database:setupCommitOrganizationDevice': \{ public: true \}/);
    assert.match(rbac, /'database:setupCommitOwner': \{ public: true \}/);
    assert.match(rbac, /'database:persistKv': \{ minRank: 2 \}/);
    assert.match(bridge, /setupCommitActivation/);
    assert.match(main, /handle\('database:setupCommitOrganizationDevice'/);
    assert.match(main, /publishFirstSetupBranch/);
    assert.doesNotMatch(main, /setupCommitActivation[\s\S]{0,1200}persistKv\(.*opts/i);
  });

  await check('BootFlow wizard navigation remains writable after SQLite becomes primary', async () => {
    const sqliteBridge = fs.readFileSync(path.join(root, 'cupping-sqlite-bridge.js'), 'utf8');
    const bootFlow = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
    assert.match(sqliteBridge, /UI_ONLY_KEYS[\s\S]*__tdw_boot_wizard__/);
    assert.match(bootFlow, /commitSetupOrganizationDevice/);
    assert.doesNotMatch(bootFlow, /case 'organization':[\s\S]{0,1600}persistData\('settings'/);
  });

  await check('password change publishes hash and credential revision in one authoritative users commit', async () => {
    const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const start = index.indexOf('async function saveChangePassword()');
    const end = index.indexOf('function downloadFile(', start);
    const flow = index.slice(start, end);
    assert.ok(start > 0 && end > start);
    assert.strictEqual((flow.match(/persistData\('users'/g) || []).length, 1);
    assert.ok(flow.indexOf('credentialRevision:') < flow.indexOf("persistData('users'"));
    assert.ok(flow.indexOf('users = committedUsers') > flow.indexOf("persistData('users'"));
    assert.doesNotMatch(flow, /catch \{ \/\* empty \*\/ \}[\s\S]{0,80}credentialRevision/);

    const profile = fs.readFileSync(path.join(root, 'cloud/owner-profile.js'), 'utf8');
    assert.match(profile, /profile\.passwordHash = null/);
    assert.match(profile, /profile\.credentialRevision = Number\(ownerUser\.credentialRevision\)/);
    assert.match(profile, /rbac\.authenticateUser/);
  });

  service.close();
  const failed = results.filter((entry) => !entry.ok);
  if (failed.length) process.exit(1);
  console.log(`P0-C setup activation PASS: ${results.length}/${results.length}`);
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
