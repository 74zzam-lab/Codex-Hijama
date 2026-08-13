'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const root = path.join(__dirname, '..', '..');
const kv = new Map();
const issued = {
  schemaVersion: 6,
  keyId: 'prod-ed25519-2026-a7f929f51598',
  licenseId: 'LIC-RUNTIME-IMMUTABLE',
  centerId: 'CTR-IMMUTABLE',
  branches: [{ id: 'BR-MAIN', name: 'Main', active: true }],
  ownerIdentity: { authorizedEmail: 'owner@example.com' },
  devices: { registered: [] },
  signature: 'issuer-signature',
};
const originalBytes = JSON.stringify(issued);
let localLicense = issued;
let pushedBytes = null;

const sandbox = {
  console,
  crypto: webcrypto,
  TextEncoder,
  TextDecoder,
  setInterval: () => 1,
  clearInterval: () => {},
  settings: { backup: { providers: { google: { email: 'owner@example.com', connected: true } } } },
  DB: {
    get(key, fallback) { return kv.has(key) ? kv.get(key) : fallback; },
    async set(key, value) { kv.set(key, value); return { ok: true }; },
  },
  LicenseCloud: {
    loadLocal: () => localLicense,
    saveLocal(doc) { localLicense = doc; return doc; },
    async verifyLicenseDoc(doc) { return doc === issued ? { ok: true } : { ok: false, error: 'tampered' }; },
    async pushToDrive(doc) { pushedBytes = JSON.stringify(doc); return { ok: true }; },
    async ensurePushedToDrive({ doc } = {}) { pushedBytes = JSON.stringify(doc || localLicense); return { ok: true }; },
  },
  DriveAdapter: { isConnected: () => true, ensureConnected: async () => true },
  DeviceConfig: {
    ensureDeviceUuid: () => 'DEV-ONE',
    load: () => ({ deviceUuid: 'DEV-ONE', deviceName: 'Reception', lockedBranchId: 'BR-MAIN' }),
    ensureDeviceConfig: () => ({}),
  },
  LicenseLimits: { canRegisterDevice: () => ({ ok: true }) },
  RolePolicy: {},
  currentUser: { id: 'owner', role: 'owner' },
  OwnerProfile: { currentUserIsOwner: () => true, hasProfile: () => true },
  sessionStorage: {
    _m: new Map(),
    getItem(k) { return this._m.get(k) || null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const rel of [
  'cloud/license-identity.js',
  'cloud/device-registry.js',
  'cloud/license-activation-gate.js',
  'cloud/license-lifecycle.js',
]) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
}

(async () => {
  const bound = await sandbox.LicenseIdentity.bindGoogleAccount('OWNER@example.com');
  assert.equal(bound.ok, true);
  assert.equal(kv.get(sandbox.LicenseIdentity.RUNTIME_IDENTITY_KEY).boundGoogleEmail, 'owner@example.com');
  assert.equal(JSON.stringify(issued), originalBytes, 'Google binding must not mutate issuer bytes');

  const registered = await sandbox.DeviceRegistry.registerDevice({ branchId: 'BR-MAIN' });
  assert.equal(registered.ok, true);
  assert.equal(kv.get(sandbox.DeviceRegistry.REGISTRY_KEY).registered.length, 1);
  assert.equal(JSON.stringify(issued), originalBytes, 'device registration must not mutate issuer bytes');

  const activated = await sandbox.LicenseActivationGate.commitActivation(null, null);
  assert.equal(activated.ok, true);
  assert.equal(kv.get('__tdw_license_activation_state__').consumed, true);
  assert.equal(JSON.stringify(issued), originalBytes, 'activation must not mutate issuer bytes');
  assert.equal(pushedBytes, originalBytes, 'Drive upload must preserve exact verified bytes');
  assert.strictEqual(localLicense, issued, 'local verified license object must remain the issued document');

  kv.delete('__tdw_license_activation_state__');
  const originalPush = sandbox.LicenseCloud.ensurePushedToDrive;
  sandbox.LicenseCloud.ensurePushedToDrive = async () => ({ ok: false, error: 'injected_upload_failure' });
  const failedActivation = await sandbox.LicenseActivationGate.commitActivation({
    licenseId: issued.licenseId,
    centerId: issued.centerId,
    branches: 2,
    deviceBinding: 'DEVICE_ANY',
  }, null);
  assert.equal(failedActivation.ok, false);
  assert.equal(kv.has('__tdw_license_activation_state__'), false, 'failed required upload leaves activation unconsumed');
  sandbox.LicenseCloud.ensurePushedToDrive = originalPush;

  for (const result of [
    sandbox.LicenseLifecycle.refreshLicense(issued, {}),
    sandbox.LicenseLifecycle.upgradeLicense(issued, { maxDevices: 99 }),
    sandbox.LicenseLifecycle.downgradeLicense(issued, { maxDevices: 1 }),
  ]) {
    assert.equal(result.ok, false);
    assert.equal(result.requiresAdminReissue, true);
  }
  assert.equal(JSON.stringify(issued), originalBytes, 'lifecycle actions must not mutate issuer bytes');

  console.log('P0-E runtime license immutability PASS: binding, devices, activation and lifecycle preserve issuer bytes');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
