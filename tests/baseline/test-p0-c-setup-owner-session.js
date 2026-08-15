#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'cloud/owner-create-form.js'), 'utf8');

function loadForm(overrides = {}) {
  const fields = new Map();
  const values = {
    'ocf-name': 'Owner Test',
    'ocf-email': 'owner@example.test',
    'ocf-username': 'owner',
    'ocf-password': 'CorrectHorseBatteryStaple',
    'ocf-confirm': 'CorrectHorseBatteryStaple',
    'ocf-recovery': 'recovery-code',
    'ocf-accept': true,
  };
  for (const [id, value] of Object.entries(values)) {
    fields.set(id, id === 'ocf-accept'
      ? { checked: value, hidden: true, textContent: '' }
      : { value, hidden: true, textContent: '' });
  }
  for (const id of ['name', 'email', 'username', 'password', 'confirm', 'recovery', 'form']) {
    fields.set(`ocf-${id}-err`, { hidden: true, textContent: '' });
  }
  const calls = [];
  const sandbox = {
    console,
    module: { exports: {} },
    document: { getElementById: (id) => fields.get(id) || null },
    users: [],
    OwnerProfile: { hasProfile: () => true }, // Simulates stale legacy partial state.
    OwnerSetupState: { clearRequired: () => calls.push('clearRequired') },
    SqliteBridge: { hydrateIntoMemory: async () => { calls.push('hydrate'); return { ok: true }; } },
    DeviceConfig: { load: () => ({ lockedBranchId: 'BR-SETUP' }) },
    persistData: async () => { throw new Error('generic_pre_auth_write_must_not_run'); },
    cuppingElectron: {
      database: {
        setupCommitOwner: async (payload) => {
          calls.push({ setupCommitOwner: payload });
          return { ok: true, userId: 'owner-1', username: 'owner', credentialRevision: 1 };
        },
      },
      rbac: {
        getSession: async () => ({ ok: false, error: 'no_session' }),
        authenticateUser: async (input) => {
          calls.push({ authenticateUser: input });
          return overrides.authentication || { ok: true, proof: 'main-issued-proof' };
        },
        bindSession: async (claim) => {
          calls.push({ bindSession: claim });
          return overrides.binding || { ok: true, session: { userId: 'owner-1', role: 'owner' } };
        },
        setWriteBranch: async (branchId) => {
          calls.push({ setWriteBranch: branchId });
          return { ok: true };
        },
      },
    },
    ...overrides.globals,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'owner-create-form.js' });
  return { api: sandbox.OwnerCreateForm, calls };
}

(async () => {
  const happy = loadForm();
  const result = await happy.api.createOwnerFromForm('ocf');
  assert.equal(result.ok, true);
  assert.equal(result.setupCommitted, true);
  assert.equal(result.sessionBound, true);
  assert.ok(happy.calls.some((item) => item.setupCommitOwner), 'narrow setup transaction used');
  assert.ok(happy.calls.some((item) => item.authenticateUser?.userId === 'owner-1'), 'main verifies entered owner password');
  assert.ok(happy.calls.some((item) => item.bindSession?.authProof === 'main-issued-proof'), 'only main-issued proof binds session');
  assert.ok(happy.calls.some((item) => item.setWriteBranch === 'BR-SETUP'), 'setup branch bound before initial sync');

  const denied = loadForm({ authentication: { ok: false, error: 'invalid_credentials' } });
  const failed = await denied.api.createOwnerFromForm('ocf');
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'invalid_credentials');
  assert.equal(failed.committed, true);
  assert.equal(denied.calls.some((item) => item.bindSession), false, 'failed authentication cannot bind a session');

  console.log('P0-C setup owner session PASS: atomic pre-auth owner commit + main-issued RBAC proof + branch binding');
})().catch((error) => { console.error(error); process.exit(1); });
