#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const saved = [];
let buildOptions = null;
let activeLicense = { centerId: 'WORKSTATION-CENTER', licenseId: 'WORKSTATION-LICENSE' };
const CL = {
  constants: { SUBSCRIPTION_DAYS: { '05': 365 } },
  store: {
    loadState: () => ({}),
    allocateLicenseId: () => ({ licenseId: 'L000001', licenseUuid: 'UUID-1', licenseSeq: 1 }),
    saveLicense: (record) => saved.push(record),
    writeShard: () => {},
  },
  featureResolver: {
    resolvePackageCached: () => ({ featureIds: ['001'], featureKeys: { core_dashboard: true }, branches: 1, maxUsers: 10 }),
  },
  registries: {
    package: { packages: [{ id: '01', displayName: 'Starter', maxUsers: 10 }] },
    subscription: { subscriptions: [{ id: '05', days: 365, nameEn: 'Annual' }] },
    feature: { features: [{ id: '001', key: 'core_dashboard' }] },
  },
  activationBundle: { buildBundle: async () => ({ licenseId: 'L000001', bundleSig: 'fixture' }) },
  codecV5: { encodeV5Key: async () => ({ key: 'TDWI2-P01AA-AAAAA-AAAAA-AAAAA' }) },
  persistence: { syncLicense: async () => ({ ok: true }) },
  auditLog: { log: () => {} },
};
const sandbox = {
  console,
  crypto: crypto.webcrypto,
  CommercialLicense: CL,
  CenterId: { generateCenterId: () => 'CUSTOMER-CENTER' },
  LicenseCloud: {
    buildFromRecord: async (record, options) => {
      buildOptions = options;
      if (options?.persistCenterId !== false) activeLicense = { centerId: record.centerId, licenseId: record.licenseId };
      return { centerId: record.centerId, licenseId: record.licenseId, signature: 'fixture' };
    },
    loadLocal: () => activeLicense,
    saveLocal: (value) => { activeLicense = value; },
  },
  licIsFullEdition: () => false,
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.runInNewContext(
  fs.readFileSync(path.join(root, 'license', 'engine', 'license-generator-v2.js'), 'utf8'),
  sandbox,
  { filename: 'license-generator-v2.js' },
);

(async () => {
  const result = await sandbox.CommercialLicense.generator.generate({
    packageId: '01', actionId: '01', subscriptionId: '05', branches: 1,
    customer: { name: 'Customer', company: 'Customer Center' },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(saved.length, 1, 'one issuance artifact is persisted');
  assert.strictEqual(result.record.centerId, 'CUSTOMER-CENTER');
  assert.strictEqual(result.driveDocument.centerId, 'CUSTOMER-CENTER');
  assert.strictEqual(buildOptions.persistCenterId, false, 'issuance uses the pure document builder mode');
  assert.strictEqual(activeLicense.centerId, 'WORKSTATION-CENTER', 'issuance must not activate the customer license locally');
  assert.strictEqual(activeLicense.licenseId, 'WORKSTATION-LICENSE');
  console.log('PASS: V5 customer issuance is isolated from the workstation active license');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
