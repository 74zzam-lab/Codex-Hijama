#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const mainVerifier = require(path.join(root, 'electron', 'license-verifier'));

function loadBrowserRuntime() {
  const sandbox = { console, crypto: crypto.webcrypto, TextEncoder, TextDecoder, CommercialLicense: {} };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  for (const file of [
    'license/core/license-constants.js',
    'license/core/license-crypto.js',
    'license/core/license-codec-v5.js',
    'license/engine/activation-bundle.js',
  ]) {
    vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
  }
  sandbox.CommercialLicense.store = { saveBundle: () => {} };
  return sandbox;
}

async function run() {
  const runtime = loadBrowserRuntime();
  const CL = runtime.CommercialLicense;

  const issued = await CL.codecV5.encodeV5Key({
    packageId: '04', actionId: '01', subscriptionId: '05', licenseSeq: 321,
    expiry: '2027-08-11', devices: 0, branches: 5, deviceAny: true, deviceHash: 0xFF, flags: 0
  });
  assert.match(issued.key, /^TDWI2-P04AA-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  const decoded = await CL.codecV5.decodeV5Key(issued.key);
  assert.strictEqual(decoded.ok, true);
  assert.strictEqual(decoded.packageId, '04');
  assert.strictEqual(decoded.fields.branches, 5);
  assert.strictEqual(decoded.licenseSeq, 321);
  const changed = issued.key.slice(0, -1) + (issued.key.endsWith('A') ? 'B' : 'A');
  assert.strictEqual((await CL.codecV5.decodeV5Key(changed)).ok, false, 'tampered V5 key must be rejected');

  const packages = ['01', '02', '03', '04', '05', '06', '99'];
  const actions = ['01', '02', '03', '04', '05', '06', '07'];
  const subscriptions = ['01', '02', '03', '04', '05', '06', '07', '08', '09'];
  let matrixCount = 0;
  for (const packageId of packages) {
    for (const actionId of actions) {
      for (const subscriptionId of subscriptions) {
        const matrixIssued = await CL.codecV5.encodeV5Key({
          packageId,
          ...(packageId === '99' ? { customPackageId: 'CP001' } : {}),
          actionId,
          subscriptionId,
          licenseSeq: 1000 + matrixCount,
          expiry: subscriptionId === '08' ? '2099-12-31' : '2030-12-31',
          devices: 0,
          branches: 5,
          deviceAny: true,
          deviceHash: 0xFF,
          flags: 0,
        });
        const matrixDecoded = await CL.codecV5.decodeV5Key(matrixIssued.key);
        assert.strictEqual(matrixDecoded.ok, true);
        assert.strictEqual(matrixDecoded.packageId, packageId);
        assert.strictEqual(matrixDecoded.fields.actionId, Number(actionId));
        assert.strictEqual(matrixDecoded.fields.subscriptionId, Number(subscriptionId));
        assert.strictEqual(matrixDecoded.expiry, subscriptionId === '08' ? '2099-12-31' : '2030-12-31');
        matrixCount += 1;
      }
    }
  }
  assert.strictEqual(matrixCount, 441, 'every original V5 package/action/subscription combination is covered');

  const historicalWrappedLifetime = await CL.codecV5.decodeV5Key('TDWI2-P01AA-ETDAA-A98EE-CDKZE');
  assert.strictEqual(historicalWrappedLifetime.ok, true);
  assert.strictEqual(historicalWrappedLifetime.expiry, '2099-12-31', 'historical lifetime keys remain lifetime');

  const customFarFuture = await CL.codecV5.encodeV5Key({
    packageId: '99', customPackageId: 'CP777', actionId: '01', subscriptionId: '09',
    licenseSeq: 777, expiry: '2099-12-31', devices: 0, branches: 1,
    deviceAny: true, deviceHash: 0xFF, flags: 0
  });
  const decodedCustomFarFuture = await CL.codecV5.decodeV5Key(customFarFuture.key);
  assert.strictEqual(decodedCustomFarFuture.ok, true);
  assert.strictEqual(decodedCustomFarFuture.expiry, null, 'signed bundle supplies extended custom expiry');
  assert.strictEqual(decodedCustomFarFuture.expiryOverflow, true);

  const farFutureRecord = {
    licenseId: 'L000777', licenseUuid: 'UUID-777', licenseSeq: 777,
    centerId: 'NJR-FAR-FUTURE', packageId: '99', customPackageId: 'CP777',
    subscriptionId: '09', actionId: '01', expiryDate: '2099-12-31',
    devices: 0, branches: 1, maxUsers: 20, deviceBinding: 'DEVICE_ANY', customer: {}
  };
  const records = new Map([[farFutureRecord.licenseId, farFutureRecord]]);
  const bundles = new Map();
  CL.store = {
    saveBundle: (licenseId, value) => bundles.set(licenseId, value),
    getBundle: (licenseId) => bundles.get(licenseId) || null,
    getLicense: (licenseId) => records.get(licenseId) || null,
    formatLicenseId: (sequence) => 'L' + String(sequence).padStart(6, '0')
  };
  CL.bridge = { applyV5Activation: async (_key, value) => ({ ok: true, record: farFutureRecord, bundle: value, payload: { expiry: value.expiryDate } }) };
  const farFutureBundle = await CL.activationBundle.buildBundle(farFutureRecord, { featureKeys: {}, internalName: 'Custom' });
  vm.runInNewContext(fs.readFileSync(path.join(root, 'license/engine/license-validator-v2.js'), 'utf8'), runtime, { filename: 'license-validator-v2.js' });
  const validatedFarFuture = await CL.validator.validateKey(customFarFuture.key, farFutureBundle);
  assert.strictEqual(validatedFarFuture.ok, true, 'authenticated bundle expiry is authoritative beyond V5 date bits');

  const mismatchedBundle = await CL.activationBundle.buildBundle(
    { ...farFutureRecord, actionId: '02' },
    { featureKeys: {}, internalName: 'Custom' }
  );
  const mismatched = await CL.validator.validateKey(customFarFuture.key, mismatchedBundle);
  assert.strictEqual(mismatched.ok, false);
  assert.strictEqual(mismatched.error, 'key_bundle_mismatch', 'valid bundle cannot be paired with another key action');

  const bundle = await CL.activationBundle.buildBundle({
    licenseId: 'L000321', licenseUuid: 'UUID-321', licenseSeq: 321,
    centerId: 'NJR-LEGACY-TEST', packageId: '04', customPackageId: null,
    subscriptionId: '05', actionId: '01', expiryDate: '2027-08-11',
    devices: 0, branches: 5, maxUsers: 30, deviceBinding: 'DEVICE_ANY', customer: {}
  }, { featureKeys: { core_clients: true, cloud_multi_device: true }, internalName: 'Business' });
  assert.strictEqual(await CL.activationBundle.verifyBundle(bundle), true);
  await assert.rejects(() => CL.activationBundle.verifyBundle({ ...bundle, maxUsers: 999 }), /bundle_tampered/);

  const body = {
    schemaVersion: 2,
    centerId: 'NJR-LEGACY-TEST',
    centerName: 'Legacy Center',
    licenseId: 'L000321',
    packageId: '04',
    subscriptionId: '05',
    expiresAt: '2027-08-11',
    features: ['core_clients'],
    limits: { maxDevices: 0, maxBranches: 5, maxUsers: 30 },
    branches: [{ id: 'BR-MAIN', name: 'الفرع الرئيسي', code: 'MAIN', active: true }],
    licenseVersion: 1,
    issuedAt: '2026-08-11',
    updatedAt: '2026-08-11T00:00:00.000Z'
  };
  const signature = await CL.crypto.hmacSha256Hex(CL.crypto.canonicalJson(body));
  const document = { ...body, signature };
  assert.strictEqual((await mainVerifier.verifyLicenseDoc(document)).ok, true, 'Main must verify renderer-issued legacy document');
  assert.strictEqual((await mainVerifier.verifyLicenseDoc({ ...document, centerId: 'NJR-TAMPERED' })).ok, false);

  console.log('PASS: legacy V5 441-type matrix, lifetime/custom expiry, bundle and cross-process verification');
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
