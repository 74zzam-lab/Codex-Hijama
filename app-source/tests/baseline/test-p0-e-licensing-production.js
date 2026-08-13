#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..', '..');
const verifier = require('../../electron/license-verifier');
const entitlements = require('../../electron/license-entitlements');
const adminCrypto = require('../../tools/license-admin/src/crypto');

(async () => {
  const productionFixture = JSON.parse(fs.readFileSync(
    path.join(root, 'tools/license-admin/fixtures/TDW-PROD-TEST-000001.v6.json'), 'utf8',
  ));
  assert.equal((await verifier.verifyLicenseDoc(productionFixture)).ok, true, 'production fixture accepted');
  assert.equal(productionFixture.keyId, verifier.PRODUCTION_KEY_ID);

  const { privateKey: devPrivate } = crypto.generateKeyPairSync('ed25519');
  const devFixture = adminCrypto.issueLicense({
    licenseId: 'DEV-MUST-BE-REJECTED', expiresAt: '2035-01-01T00:00:00.000Z',
    keyId: verifier.PRODUCTION_KEY_ID,
  }, devPrivate);
  assert.equal((await verifier.verifyLicenseDoc(devFixture)).ok, false, 'development signing key rejected');
  assert.equal((await verifier.verifyLicenseDoc({
    schemaVersion: 2, centerId: 'FORGED', expiresAt: '2035-01-01', signature: 'forged',
  })).ok, false, 'unlisted legacy license rejected');

  const entitled = {
    ...productionFixture,
    branches: [{ id: 'BR-A', active: true }],
    features: ['clients', 'appointments', 'payroll', 'sync'],
  };
  assert.equal(entitlements.check(entitled, { entity: 'cases', branchId: 'BR-A' }).ok, true);
  assert.equal(entitlements.check(entitled, { entity: 'payrollRuns', branchId: 'BR-A' }).ok, true);
  assert.equal(entitlements.check(entitled, { entity: 'inventoryItems', branchId: 'BR-A' }).error, 'license_feature_not_entitled');
  assert.equal(entitlements.check(entitled, { group: 'sync', branchId: 'BR-A' }).ok, true);
  assert.equal(entitlements.check(entitled, { entity: 'cases', branchId: 'BR-B' }).error, 'license_branch_not_entitled');
  assert.equal(entitlements.check({ ...entitled, expiresAt: '2020-01-01' }, { entity: 'cases', branchId: 'BR-A' }).error, 'license_expired');
  assert.equal(entitlements.check(null, { entity: 'cases', branchId: 'BR-A' }).error, 'license_required');
  assert.equal(entitlements.check(null, { entity: 'cases', actorId: '__dev__' }).ok, true, 'authenticated developer support retained');

  const scanFiles = [];
  function walk(target) {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(target)) walk(path.join(target, name));
    } else if (/\.(?:js|html|json|mjs)$/i.test(target)) scanFiles.push(target);
  }
  ['index.html', 'license', 'electron', 'cloud'].forEach((entry) => walk(path.join(root, entry)));
  const { assertV5SigningPolicy } = require('../../license/core/v5-signing-policy');
  assertV5SigningPolicy(root, scanFiles);
  const mainSrc = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  assert.equal(mainSrc.includes('LIC_SECRETS'), false, 'main must not embed LIC_SECRETS');
  assert.equal(mainSrc.includes('-----BEGIN'), false, 'main must not ship private keys');

  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron/preload.js'), 'utf8');
  for (const channel of [
    'license:writeLicenseShard', 'license:writeActivationBundle', 'license:writeCustomPackage',
    'license:updateLicenseIndex', 'license:appendPackageToRegistry',
  ]) {
    assert.match(main, new RegExp(`handle\\('${channel}'[\\s\\S]{0,240}assertDeveloperIssuerSession`), `${channel} requires authenticated developer session`);
    assert.ok(preload.includes(`'${channel}'`), `${channel} remains on preload allowlist for developer support`);
  }
  assert.match(main, /licenseEntitlements\.assert\(dbService\.getStoredLicense\(\)/);

  const licenseData = require('../../electron/license-data');
  assert.throws(() => licenseData.writeLicenseShard('X', {}), /license_mutation_requires_offline_admin_tool/);
  assert.throws(() => licenseData.appendPackageToRegistry({ id: 'X' }), /license_mutation_requires_offline_admin_tool/);

  const alien = crypto.generateKeyPairSync('ed25519');
  const alienLicense = adminCrypto.issueLicense({ licenseId: 'ALIEN', expiresAt: '2035-01-01' }, alien.privateKey);
  assert.equal((await verifier.verifyLicenseDoc(alienLicense)).ok, false);
  console.log('P0-E production licensing PASS: production key, dev rejection, domain gates, intentional V5 allowlist, no runtime mutation outside V5 paths');
})().catch((error) => { console.error(error); process.exit(1); });
