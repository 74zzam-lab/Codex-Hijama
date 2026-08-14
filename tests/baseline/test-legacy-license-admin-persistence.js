#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const licenseData = require(path.join(root, 'electron', 'license-data'));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tdw-v5-admin-'));
try {
  licenseData.configureWritableRoot(temp);
  const record = { licenseId: 'L009999', packageId: '04', status: 'active' };
  const bundle = { licenseId: 'L009999', bundleSig: 'signed' };
  const shardPath = licenseData.writeLicenseShard(record.licenseId, record);
  const bundlePath = licenseData.writeActivationBundle(record.licenseId, bundle);
  const customPath = licenseData.writeCustomPackage({ customPackageId: 'CP999', featureIds: ['001'] });
  const indexPath = licenseData.updateLicenseIndex({ count: 1, entries: [{ licenseId: record.licenseId }] });

  assert.ok(shardPath.startsWith(temp));
  assert.ok(bundlePath.startsWith(temp));
  assert.ok(customPath.startsWith(temp));
  assert.ok(indexPath.startsWith(temp));
  assert.deepStrictEqual(licenseData.readLicenseShard(record.licenseId), record);
  assert.deepStrictEqual(licenseData.readActivationBundle(record.licenseId), bundle);
  assert.deepStrictEqual(licenseData.readCustomPackage('CP999'), { customPackageId: 'CP999', featureIds: ['001'] });
  assert.throws(() => licenseData.writeLicenseShard('../escape', record));
  assert.throws(() => licenseData.writeCustomPackage({ customPackageId: '../escape' }));

  const backup = licenseData.createFilesystemBackup('runtime-test');
  assert.ok(fs.existsSync(path.join(backup, 'license-registry', 'L009999.json')));
  assert.ok(fs.existsSync(path.join(backup, 'activations', 'L009999.bundle.json')));

  console.log('PASS: developer-only V5 artifacts persist atomically outside packaged ASAR');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
