#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const results = [];
async function check(name, operation) {
  try {
    await operation();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.stack || error.message });
    console.error(`FAIL  ${name}: ${error.message}`);
  }
}

function loadService(userData) {
  const original = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => userData } };
    return original.call(this, request, parent, isMain);
  };
  const target = require.resolve('../../electron/database/service');
  delete require.cache[target];
  try { return require(target); } finally { Module._load = original; }
}

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tdw-p0c-credential-op-'));
  const service = loadService(tempRoot);
  const remote = new Map();
  let failNext = true;
  const provider = {
    async publishImmutableJson(remotePath, payload) {
      if (failNext) { failNext = false; return { ok: false, error: 'injected_upload_failure' }; }
      const prior = remote.get(remotePath);
      if (prior && prior !== payload) return { ok: false, error: 'immutable_collision' };
      remote.set(remotePath, payload);
      return { ok: true, id: 'REMOTE-USER-OP', duplicate: !!prior };
    },
    async downloadBackup(remotePath) {
      return remote.has(remotePath) ? { ok: true, text: remote.get(remotePath) } : { ok: false, error: 'not_found' };
    },
    async listOperationFiles() { return { ok: true, items: [] }; },
  };
  const { createSyncOperationTransport } = require('../../electron/database/sync-operation-transport');
  const transport = createSyncOperationTransport(service, provider);
  const context = {
    centerId: 'CTR-P0C', branchId: '__ORG__', actorId: 'OWNER-1',
    deviceId: 'DEVICE-A', role: 'owner',
  };
  const owner = {
    id: 'OWNER-1', username: 'owner', role: 'owner', active: true,
    password: 'pbkdf2v2:sha256:120000:c2FsdA==:aGFzaA==',
    credentialRevision: 12, passwordChangedAt: '2026-08-10T12:00:00.000Z',
    mustChangePassword: false, seedDefaultPassword: false,
  };
  assert.equal(service.command({
    commandId: 'credential-publication-12', entity: 'users', action: 'upsert', record: owner,
  }, context).ok, true);

  await check('AT-AUTH-003 failed immutable publication keeps credential operation retryable and unacknowledged', async () => {
    const first = await transport.pushPending(context, { includeOrganization: false });
    assert.equal(first.ok, false);
    let row = service.ensureDb().prepare("SELECT * FROM sync_outbox WHERE record_id='OWNER-1'").get();
    assert.equal(row.status, 'pending');
    assert.equal(row.remote_file_id, null);
    assert.equal(remote.size, 0);
    service.ensureDb().prepare("UPDATE sync_outbox SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE event_id=?").run(row.event_id);
    const second = await transport.pushPending(context, { includeOrganization: false });
    assert.equal(second.ok, true);
    row = service.ensureDb().prepare("SELECT * FROM sync_outbox WHERE record_id='OWNER-1'").get();
    assert.equal(row.status, 'acked');
    assert.equal(remote.size, 1);
  });

  await check('AT-AUTH-003 one immutable users operation carries password and credentialRevision atomically', async () => {
    const document = JSON.parse([...remote.values()][0]);
    const published = JSON.parse(document.payloadJson);
    assert.equal(document.tableName, 'users');
    assert.equal(document.recordId, 'OWNER-1');
    assert.match(published.password, /^pbkdf2v2:/);
    assert.equal(published.credentialRevision, 12);
    assert.equal(published.seedDefaultPassword, false);
    assert.equal(published.mustChangePassword, false);
  });

  service.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  const failed = results.filter((row) => !row.ok);
  console.log(`\nP0-C credential publication: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
