#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const { createLicenseIssuer } = require(path.join(root, 'electron', 'license-issuer'));
const setupActivation = require(path.join(root, 'electron', 'setup-activation'));
const entitlements = require(path.join(root, 'electron', 'license-entitlements'));

function verifyWith(publicKey) {
  return {
    async verifyLicenseDoc(document) {
      const { signature, ...body } = document || {};
      if (!signature) return { ok: false, error: 'signature_missing' };
      const ok = crypto.verify(
        null,
        Buffer.from(require(path.join(root, 'electron', 'license-verifier')).canonicalJson(body), 'utf8'),
        publicKey,
        Buffer.from(String(signature), 'base64url')
      );
      return ok ? { ok: true, format: 'v6' } : { ok: false, error: 'signature_invalid' };
    },
  };
}

async function testIssuerAndSetupCommitContract() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tdw-license-issuer-'));
  try {
    const pair = crypto.generateKeyPairSync('ed25519');
    const other = crypto.generateKeyPairSync('ed25519');
    const privatePath = path.join(temp, 'issuer.pem');
    const wrongPath = path.join(temp, 'wrong.pem');
    fs.writeFileSync(privatePath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    fs.writeFileSync(wrongPath, other.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const publicB64 = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const issuer = createLicenseIssuer({ publicKeySpkiB64: publicB64 });

    assert.strictEqual(issuer.status().configured, false, 'issuer starts without a selected private key');
    assert.throws(() => issuer.selectKeyPath(wrongPath), /license_signing_key_mismatch/);
    assert.strictEqual(issuer.selectKeyPath(privatePath).configured, true);

    const result = issuer.issue({
      licenseId: 'L900001',
      centerId: 'NJR-TEST-CENTER',
      centerName: 'Runtime Builder Center',
      customerName: 'Runtime Customer',
      packageId: '04',
      issuedAt: '2026-08-11T00:00:00.000Z',
      expiresAt: '2027-08-11T23:59:59.999Z',
      features: ['core_clients', 'book_schedule', 'rep_monthly', 'cloud_multi_device', 'bk_drive'],
      maxBranches: 5,
      maxUsers: 30,
      maxDevices: 5,
      deviceMode: 'any',
    });
    assert.strictEqual(result.ok, true);
    assert.ok(result.token.startsWith('TDW6.'), 'builder emits a compact V6 token');
    assert.strictEqual(result.license.branches[0].id, 'BR-MAIN');
    assert.strictEqual(result.license.limits.maxBranches, 5);

    const verified = await setupActivation.verifySignedSetupActivation({
      license: result.license,
      legacyLicense: { licenseId: 'L900001', fingerprint: 'DEVICE_ANY', edition: 'custom' },
    }, { licenseVerifier: verifyWith(pair.publicKey) });
    assert.strictEqual(verified.ok, true);
    assert.strictEqual(verified.remotePath, 'signed-token:L900001');
    assert.strictEqual(verified.legacyLicense.commercialMeta.centerId, 'NJR-TEST-CENTER');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function testRendererBuilderUsesLegacyV5ByDefault() {
  const saved = [];
  let encodedPayload = null;
  const sandbox = {
    console,
    crypto: crypto.webcrypto,
    CenterId: { generateCenterId: () => 'NJR-RUNTIME-BUILDER' },
    CommercialLicense: {
      store: {
        loadState: () => ({}),
        allocateLicenseId: () => ({ licenseId: 'L900002', licenseUuid: 'UUID-2', licenseSeq: 2 }),
        saveLicense: (record) => saved.push(record),
        writeShard: () => {},
      },
      featureResolver: {
        resolvePackageCached: () => ({
          featureIds: ['003', '009', '025'],
          featureKeys: { core_clients: true, book_schedule: true, rep_monthly: true },
          branches: 1,
          maxUsers: 10,
        }),
      },
      registries: {
        package: { packages: [{ id: '01', displayName: 'Starter', branches: 1, maxUsers: 10 }] },
        subscription: { subscriptions: [{ id: '05', days: 365, nameEn: 'Annual' }] },
      },
      auditLog: { log: () => {} },
      activationBundle: {
        buildBundle: async (record) => ({ licenseId: record.licenseId, bundleSig: 'legacy-signature' }),
      },
      codecV5: {
        encodeV5Key: async (payload) => {
          encodedPayload = payload;
          return { key: 'TDW5-LEGACY-RUNTIME-KEY' };
        },
      },
      persistence: { syncLicense: async () => ({ ok: true }) },
    },
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.runInNewContext(
    fs.readFileSync(path.join(root, 'license', 'engine', 'license-generator-v2.js'), 'utf8'),
    sandbox,
    { filename: 'license-generator-v2.js' }
  );
  const generated = await sandbox.CommercialLicense.generator.generate({
    packageId: '01',
    subscriptionId: '05',
    branches: 1,
    customer: { name: 'Customer', company: 'Center', email: 'owner@example.com' },
    deviceBinding: 'DEVICE_ANY',
  });
  assert.strictEqual(generated.key, 'TDW5-LEGACY-RUNTIME-KEY');
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(encodedPayload.packageId, '01');
  assert.strictEqual(generated.record.licenseSchemaVersion, 5);
  assert.strictEqual(generated.record.centerId, 'NJR-RUNTIME-BUILDER');
}

function testActualRegistryFeatureAliases() {
  const common = { schemaVersion: 6, expiresAt: '2099-01-01T00:00:00.000Z', branches: [] };
  assert.strictEqual(entitlements.check({ ...common, features: ['book_schedule'] }, { group: 'appointments' }).ok, true);
  assert.strictEqual(entitlements.check({ ...common, features: ['ops_inventory'] }, { group: 'inventory' }).ok, true);
  assert.strictEqual(entitlements.check({ ...common, features: ['rep_monthly'] }, { group: 'reports' }).ok, true);
  assert.strictEqual(entitlements.check({ ...common, features: ['cloud_multi_device'] }, { group: 'sync' }).ok, true);
  assert.strictEqual(entitlements.check({ ...common, features: ['bk_local'] }, { group: 'backup' }).ok, true);
}

function testSecurityWiring() {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
  const rbac = fs.readFileSync(path.join(root, 'electron', 'rbac-session.js'), 'utf8');
  const boot = fs.readFileSync(path.join(root, 'cloud', 'boot-flow-ui.js'), 'utf8');
  assert.match(main, /assertDeveloperIssuerSession/);
  assert.match(main, /current\?\.isDev/);
  assert.match(preload, /adminIssueV6/);
  assert.match(rbac, /'license:adminIssueV6': \{ minRank: 4, roles: \['admin'\] \}/);
  assert.match(boot, /setupCommitSignedActivation/);
  assert.match(boot, /if \(!\/\^TDW6\\\.\//);
  assert.doesNotMatch(boot, /keyInput\.value[^\n]+toUpperCase/);
}

(async () => {
  await testIssuerAndSetupCommitContract();
  await testRendererBuilderUsesLegacyV5ByDefault();
  testActualRegistryFeatureAliases();
  testSecurityWiring();
  console.log('PASS: legacy V5 default builder, optional V6 issuer, setup commit and developer-only IPC');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
