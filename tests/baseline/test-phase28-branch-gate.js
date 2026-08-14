#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(root, 'cloud', 'branch-enrollment.js'), 'utf8');
const errors = [];
function check(ok, msg) { if (!ok) errors.push(msg); }

const sandbox = {
  console,
  LicenseCloud: {
    _doc: null,
    loadLocal() { return this._doc; },
    saveLocal(doc) { this._doc = doc; },
    async pushToDrive(doc) { this._doc = doc; return { ok: true, signed: doc }; },
    async resignDoc(doc) { return { ...doc, signature: 'sig' }; },
    verifyLicenseDoc: false
  },
  DeviceConfig: { load: () => ({ deviceUuid: 'dev-1' }) },
  LicenseLimits: { getMaxBranches: () => 5 },
  CommercialLicense: { crypto: { canonicalJson: (x) => JSON.stringify(x), async hmacSha256Hex() { return 'sig'; } } }
};
sandbox.DB = {
  state: {},
  get(key, fallback) { return Object.prototype.hasOwnProperty.call(this.state, key) ? this.state[key] : fallback; },
  set(key, value) { this.state[key] = value; return { ok: true }; }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

try { vm.runInNewContext(src, sandbox, { timeout: 1000 }); } catch (e) { errors.push('branch-enrollment eval failed: ' + e.message); }

const doc0 = { centerId: 'NJR-CLINIC-1', branches: [], limits: { maxBranches: 5 } };
sandbox.LicenseCloud._doc = doc0;

async function run() {
  // V2-3: even the first branch requires Owner Hub source.
  const firstBlocked = await sandbox.BranchEnrollment.enrollBranch(doc0, { branchName: 'Main Setup' });
  check(firstBlocked.ok === false && firstBlocked.error === 'owner_hub_required', 'first branch without owner_hub must be blocked');

  const firstHub = await sandbox.BranchEnrollment.enrollBranch(doc0, { branchName: 'Main Setup', source: 'owner_hub' });
  check(firstHub.ok === true && firstHub.branch?.id === 'BR-MAIN',
    'legacy V5 first branch should be created and signed');

  const doc1 = sandbox.LicenseCloud._doc;
  const secondBlocked = await sandbox.BranchEnrollment.enrollBranch(doc1, { branchName: 'Second from setup' });
  check(secondBlocked.ok === false && secondBlocked.error === 'owner_hub_required', 'second branch should require owner hub source');

  const secondHub = await sandbox.BranchEnrollment.enrollBranch(doc1, { branchName: 'Second from hub', source: 'owner_hub' });
  check(secondHub.ok === true && secondHub.branch?.id === 'BR02',
    'legacy V5 additional branch should be created within the licensed limit');

  const v6 = { ...sandbox.LicenseCloud._doc, schemaVersion: 6 };
  const v6Blocked = await sandbox.BranchEnrollment.enrollBranch(v6, { branchName: 'V6 branch', source: 'owner_hub' });
  check(v6Blocked.ok === false && v6Blocked.requiresAdminReissue === true,
    'V6 branch entitlement must remain issuer-owned');

  if (errors.length) {
    console.error('FAIL: phase28 branch gate');
    for (const err of errors) console.error(' -', err);
    process.exit(1);
  }
  console.log('OK: phase28 branch gate checks');
}

run();
