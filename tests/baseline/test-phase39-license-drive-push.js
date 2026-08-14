#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');
const verifier = require('../../electron/license-verifier');

const root = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(root, 'cloud/license-cloud.js'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(
  path.join(root, 'tools/license-admin/fixtures/TDW-PROD-TEST-000001.v6.json'), 'utf8',
));
const memory = new Map();
const uploads = [];
let uploadFailure = null;
const sandbox = {
  console,
  crypto: webcrypto,
  TextEncoder,
  DB: {
    get: (key, fallback) => memory.has(key) ? memory.get(key) : fallback,
    set: async (key, value) => { memory.set(key, value); return { ok: true }; },
  },
  DriveLayout: { licenseJson: () => 'NajjarTech/CTR-PROD-TEST/License/license.json' },
  DriveAdapter: {
    isConnected: () => true,
    ensureConnected: async () => true,
    uploadJson: async (remotePath, data) => {
      uploads.push({ remotePath, data: JSON.parse(JSON.stringify(data)) });
      if (uploadFailure) return { ok: false, error: uploadFailure };
      return { ok: true, id: 'fixture-upload' };
    },
  },
  CommercialLicense: {
    v6Verify: { verifyPayload: (document) => verifier.verifyLicenseDoc(document) },
    legacyLicenseAllowlist: [],
  },
  CloudMeta: { loadMeta: () => ({}), saveMeta: async (meta) => meta },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(src, sandbox, { filename: 'cloud/license-cloud.js' });

(async () => {
  const licenseCloud = sandbox.LicenseCloud;
  assert.equal((await licenseCloud.verifyLicenseDoc(fixture)).ok, true);
  await assert.rejects(() => licenseCloud.resignDoc(fixture), /license_document_immutable_admin_signature_required/);
  licenseCloud.saveLocal(fixture);
  const pushed = await licenseCloud.ensurePushedToDrive({ doc: fixture });
  assert.equal(pushed.ok, true, JSON.stringify(pushed));
  assert.equal(uploads.length, 1);
  assert.deepEqual(uploads[0].data, fixture, 'verified bytes uploaded without mutation');
  const priorLocal = { centerId: 'WORKSTATION', licenseId: 'CURRENT' };
  memory.set(licenseCloud.LOCAL_LICENSE_KEY, priorLocal);
  uploadFailure = 'injected_upload_failure';
  const failedPush = await licenseCloud.pushToDrive(fixture);
  assert.equal(failedPush.ok, false);
  assert.equal(memory.get(licenseCloud.LOCAL_LICENSE_KEY), priorLocal, 'failed upload must not replace local active license');
  uploadFailure = null;
  const tampered = { ...fixture, updatedAt: '2099-01-01T00:00:00.000Z' };
  assert.equal((await licenseCloud.verifyLicenseDoc(tampered)).ok, false);
  const noBranch = { ...fixture, branches: [] };
  const blocked = await licenseCloud.ensurePushedToDrive({ doc: noBranch });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'license_branch_entitlement_missing_admin_reissue_required');
  console.log('OK: phase39 verification-only license Drive push checks');
})().catch((error) => { console.error('FAIL: phase39 license drive push', error); process.exit(1); });
