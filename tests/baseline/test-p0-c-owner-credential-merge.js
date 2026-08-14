#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

const results = [];
function check(name, operation) {
  try {
    operation();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.stack || error.message });
    console.error(`FAIL  ${name}: ${error.message}`);
  }
}

function loadFresh(relative) {
  const file = require.resolve(path.join(__dirname, '../..', relative));
  delete require.cache[file];
  require(file);
}

const ACTIONS = { SKIP: 'skip', PUSH: 'push', PULL: 'pull', MERGE: 'merge', CONFLICT: 'conflict' };
global.MergePolicy = {
  ACTIONS,
  isIdentical: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  compareRevision: (a, b) => (Number(a?.revision) || 0) - (Number(b?.revision) || 0),
};
loadFresh('cloud/table-merge-policy.js');

function user(overrides = {}) {
  return {
    id: 'OWNER-1', username: 'owner', role: 'owner', active: true,
    password: 'pbkdf2v2:sha256:120000:bG9jYWw=:aGFzaA==',
    credentialRevision: 2, passwordChangedAt: '2026-08-10T10:00:00.000Z',
    mustChangePassword: false, seedDefaultPassword: false, revision: 5,
    ...overrides,
  };
}

check('AT-AUTH-002 higher valid credentialRevision wins password and protected role together', () => {
  const local = user({ credentialRevision: 2, role: 'admin' });
  const remote = user({
    password: 'pbkdf2v2:sha256:120000:cmVtb3Rl:bW9yZWhhc2g=',
    credentialRevision: 3,
    role: 'owner',
    revision: 4,
  });
  const result = global.TableMergePolicy.decideForTable('users', local, remote);
  assert.strictEqual(result.action, 'merge');
  assert.strictEqual(result.merged.password, remote.password);
  assert.strictEqual(result.merged.role, 'owner');
  assert.strictEqual(result.merged.credentialRevision, 3);
  assert.strictEqual(result.merged.seedDefaultPassword, false);
});

check('AT-AUTH-002 stale seed can never replace a same-revision non-seed credential', () => {
  const local = user({ credentialRevision: 1 });
  const remote = user({
    password: 'pbkdf2:owner:seed',
    credentialRevision: 1,
    mustChangePassword: true,
    seedDefaultPassword: true,
  });
  const result = global.TableMergePolicy.decideForTable('users', local, remote);
  assert.strictEqual(result.action, 'merge');
  assert.strictEqual(result.merged.password, local.password);
  assert.strictEqual(result.merged.mustChangePassword, false);
  assert.strictEqual(result.merged.seedDefaultPassword, false);
});

check('AT-AUTH-002 equal revision with different real hashes is an explicit conflict', () => {
  const local = user({ credentialRevision: 4 });
  const remote = user({
    credentialRevision: 4,
    password: 'pbkdf2v2:sha256:120000:cmVtb3Rl:bW9yZWhhc2g=',
    passwordChangedAt: '2026-08-10T11:00:00.000Z',
  });
  const result = global.TableMergePolicy.decideForTable('users', local, remote);
  assert.strictEqual(result.action, 'conflict');
  assert.strictEqual(result.reason, 'credential_revision_collision');
});

check('AT-AUTH-002 a newer revision without a portable hash is rejected', () => {
  const result = global.TableMergePolicy.decideForTable(
    'users', user({ credentialRevision: 3 }), user({ credentialRevision: 4, password: '' })
  );
  assert.strictEqual(result.action, 'conflict');
  assert.strictEqual(result.reason, 'invalid_newer_credential');
});

check('AT-AUTH-004 restored non-seed Owner stays non-seed across three merge cycles', () => {
  let current = user({ credentialRevision: 7 });
  const staleSeed = user({
    credentialRevision: 1,
    password: 'pbkdf2:owner:seed',
    mustChangePassword: true,
    seedDefaultPassword: true,
  });
  for (let i = 0; i < 3; i += 1) {
    const result = global.TableMergePolicy.decideForTable('users', current, staleSeed);
    assert.strictEqual(result.action, 'merge');
    current = result.merged;
    assert.strictEqual(current.credentialRevision, 7);
    assert.strictEqual(current.mustChangePassword, false);
    assert.strictEqual(current.seedDefaultPassword, false);
  }
});

check('AT-AUTH-005 OwnerProfile is a derived projection without a password hash', () => {
  global.users = [user({ credentialRevision: 9 })];
  const legacyProfile = {
    schemaVersion: 1,
    username: 'owner',
    passwordHash: 'sha256:legacy-second-password-store',
    recovery: { hash: 'sha256:recovery' },
  };
  global.DB = {
    get: (key, fallback) => key === 'users' ? global.users
      : (key === '__tdw_owner_profile__' ? legacyProfile : fallback),
  };
  global.BranchScope = { getActiveBranchId: () => 'BR-1' };
  global.SettingsSplit = {
    extractBranchSettings: () => ({}),
    extractPrices: () => ({}),
    filterUsersForBranch: (users) => users,
  };
  global.settings = {};
  loadFresh('cloud/config-layer.js');
  const projection = global.ConfigLayer.deriveOwnerProfileProjection(legacyProfile);
  assert.strictEqual(projection.schemaVersion, 2);
  assert.strictEqual(projection.credentialUserId, 'OWNER-1');
  assert.strictEqual(projection.credentialRevision, 9);
  assert.strictEqual(projection.passwordHash, null);
  assert.strictEqual(projection.recovery.hash, 'sha256:recovery');
  const exported = global.ConfigLayer.exportBranchPack('BR-1');
  assert.strictEqual(exported.owner.profile.passwordHash, null);
  assert.strictEqual(exported.owner.profile.credentialRevision, 9);
});

const failed = results.filter((row) => !row.ok);
console.log(`\nP0-C Owner credential merge: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
