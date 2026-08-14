#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const root = path.join(__dirname, '..', '..');
const checks = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    checks.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  }, (error) => {
    checks.push({ name, ok: false, error: error.message });
    console.error(`FAIL  ${name}: ${error.message}`);
  });
}

function loadService(userData) {
  const original = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => userData } };
    return original.call(this, request, parent, isMain);
  };
  const resolved = require.resolve('../../electron/database/service');
  delete require.cache[resolved];
  try { return require(resolved); } finally { Module._load = original; }
}

class MemoryProvider {
  constructor() { this.files = new Map(); this.sequence = 0; this.failNext = false; }
  async publishImmutableJson(remotePath, payload, expectedHash) {
    if (this.failNext) { this.failNext = false; return { ok: false, error: 'injected_upload_failure' }; }
    const existing = this.files.get(remotePath);
    if (existing && existing.payload !== payload) return { ok: false, error: 'immutable_operation_collision' };
    if (!existing) this.files.set(remotePath, { payload, modifiedAt: new Date(1700000000000 + (++this.sequence)).toISOString() });
    return { ok: true, duplicate: !!existing, id: `remote-${this.sequence}`, sha256: expectedHash };
  }
  async downloadBackup(remotePath) {
    const row = this.files.get(remotePath);
    return row ? { ok: true, text: row.payload } : { ok: false, error: 'not_found' };
  }
  async listOperationFiles(prefix) {
    return {
      ok: true,
      items: [...this.files.entries()]
        .filter(([file]) => file.startsWith(`${prefix}/`))
        .map(([file, row]) => ({ path: file, modifiedAt: row.modifiedAt }))
        .sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt) || a.path.localeCompare(b.path)),
    };
  }
}

(async () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'tdw-p0d-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'tdw-p0d-b-'));
  const serviceA = loadService(dirA);
  const serviceB = loadService(dirB);
  const { createSyncOperationTransport, documentFromRow } = require('../../electron/database/sync-operation-transport');
  const provider = new MemoryProvider();
  const transportA = createSyncOperationTransport(serviceA, provider);
  const transportB = createSyncOperationTransport(serviceB, provider);
  const centerId = 'CTR-P0D';
  const branchId = 'BR-1';
  const ctxA = { centerId, branchId, actorId: 'OWNER-A', deviceId: 'DEVICE-A', role: 'owner' };
  const ctxB = { centerId, branchId, actorId: 'OWNER-B', deviceId: 'DEVICE-B', role: 'owner' };

  await check('migration 004 operation/tombstone ledgers remain present after later schema migrations', () => {
    const db = serviceA.ensureDb();
    assert.ok(serviceA.getStatus(ctxA).schemaVersion >= 7);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_operations_applied'").get());
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_tombstones'").get());
  });

  await check('authoritative command emits an immutable per-record payload with revision and hash', () => {
    const result = serviceA.command({
      commandId: 'A-create-1', entity: 'clientsRegistry', action: 'upsert',
      record: { id: 'CLIENT-1', name: 'Device A' },
    }, ctxA);
    assert.equal(result.ok, true);
    const row = serviceA.ensureDb().prepare("SELECT * FROM sync_outbox WHERE record_id='CLIENT-1'").get();
    assert.equal(row.operation, 'CREATE');
    assert.equal(row.base_revision, 0);
    assert.equal(row.new_revision, 1);
    assert.equal(JSON.parse(row.payload_json).name, 'Device A');
    assert.equal(documentFromRow(row).payloadHash, row.payload_hash);
  });

  await check('Device A publish and Device B pull recover the exact record', async () => {
    const push = await transportA.pushPending(ctxA);
    assert.equal(push.ok, true);
    assert.equal(push.published, 1);
    const pull = await transportB.pullRemote(ctxB);
    assert.equal(pull.ok, true);
    assert.equal(pull.applied, 1);
    const record = serviceB.ensureDb().prepare("SELECT payload_json FROM clients WHERE id='CLIENT-1'").get();
    assert.equal(JSON.parse(record.payload_json).name, 'Device A');
  });

  await check('duplicate delivery is idempotent', async () => {
    const second = await transportB.pullRemote(ctxB);
    assert.equal(second.ok, true);
    assert.ok(second.scopes[0].results.some((row) => row.duplicate === true));
    assert.equal(serviceB.ensureDb().prepare("SELECT COUNT(*) c FROM clients WHERE id='CLIENT-1'").get().c, 1);
  });

  await check('concurrent Device A/B updates open a record conflict and do not overwrite either value', async () => {
    assert.equal(serviceA.command({
      commandId: 'A-update-1', entity: 'clientsRegistry', action: 'upsert',
      record: { id: 'CLIENT-1', name: 'A concurrent' },
    }, ctxA).ok, true);
    assert.equal(serviceB.command({
      commandId: 'B-update-1', entity: 'clientsRegistry', action: 'upsert',
      record: { id: 'CLIENT-1', name: 'B concurrent' },
    }, ctxB).ok, true);
    assert.equal((await transportB.pushPending(ctxB)).ok, true);
    const pull = await transportA.pullRemote(ctxA);
    assert.equal(pull.ok, true);
    assert.ok(pull.scopes[0].results.some((row) => row.status === 'conflict'));
    const local = JSON.parse(serviceA.ensureDb().prepare("SELECT payload_json FROM clients WHERE id='CLIENT-1'").get().payload_json);
    assert.equal(local.name, 'A concurrent');
    assert.equal(serviceA.ensureDb().prepare("SELECT COUNT(*) c FROM sync_conflicts WHERE record_id='CLIENT-1' AND status='open'").get().c, 1);
  });

  await check('delete/update race is retained as conflict and tombstones prevent silent resurrection', async () => {
    assert.equal(serviceA.command({
      commandId: 'A-create-2', entity: 'clientsRegistry', action: 'upsert', record: { id: 'CLIENT-2', name: 'Base' },
    }, ctxA).ok, true);
    await transportA.pushPending(ctxA);
    await transportB.pullRemote(ctxB);
    assert.equal(serviceB.command({
      commandId: 'B-delete-2', entity: 'clientsRegistry', action: 'delete', entityId: 'CLIENT-2',
    }, ctxB).ok, true);
    assert.equal(serviceA.command({
      commandId: 'A-update-2', entity: 'clientsRegistry', action: 'upsert', record: { id: 'CLIENT-2', name: 'A update' },
    }, ctxA).ok, true);
    await transportB.pushPending(ctxB);
    const pull = await transportA.pullRemote(ctxA);
    assert.ok(pull.scopes[0].results.some((row) => row.status === 'conflict'));
    assert.equal(serviceA.ensureDb().prepare("SELECT COUNT(*) c FROM sync_conflicts WHERE record_id='CLIENT-2' AND status='open'").get().c, 1);
    assert.equal(serviceB.ensureDb().prepare("SELECT COUNT(*) c FROM sync_tombstones WHERE record_id='CLIENT-2'").get().c, 1);
  });

  await check('tampered payload and cross-branch operation are denied', () => {
    const row = serviceA.ensureDb().prepare("SELECT * FROM sync_outbox WHERE record_id='CLIENT-1' AND operation='UPDATE'").get();
    const tampered = { ...row, payload_json: row.payload_json.replace('A concurrent', 'tampered') };
    assert.equal(serviceB.applyRemoteOperation(tampered, ctxB).error, 'sync_payload_hash_mismatch');
    assert.equal(serviceB.applyRemoteOperation({ ...row, branch_id: 'BR-X' }, ctxB).error, 'branch_access_denied');
  });

  await check('failed upload remains durable with exponential retry metadata across restart', async () => {
    await transportA.pushPending(ctxA);
    assert.equal(serviceA.command({
      commandId: 'A-offline-3', entity: 'clientsRegistry', action: 'upsert', record: { id: 'CLIENT-3', name: 'Offline' },
    }, ctxA).ok, true);
    provider.failNext = true;
    const failed = await transportA.pushPending(ctxA);
    assert.equal(failed.ok, false);
    let row = serviceA.ensureDb().prepare("SELECT * FROM sync_outbox WHERE record_id='CLIENT-3'").get();
    assert.equal(row.status, 'pending');
    assert.ok(row.attempt_count >= 1);
    assert.ok(row.next_attempt_at);
    serviceA.close();
    const restarted = loadService(dirA);
    row = restarted.ensureDb().prepare("SELECT * FROM sync_outbox WHERE record_id='CLIENT-3'").get();
    assert.equal(row.status, 'pending');
    assert.equal(row.payload_json.includes('Offline'), true);
    restarted.close();
  });

  await check('production engine never calls full-table writer from schedule, retry, poll, or startup', () => {
    const src = fs.readFileSync(path.join(root, 'cloud', 'sync-engine.js'), 'utf8');
    assert.match(src, /legacy_full_table_writer_disabled/);
    const schedule = src.slice(src.indexOf('function schedulePush'), src.indexOf('function queueFailedPush'));
    const flush = src.slice(src.indexOf('async function flushPending'), src.indexOf('function setPollIntervalMs'));
    const poll = src.slice(src.indexOf('async function poll'), src.indexOf('async function flushPending'));
    assert.doesNotMatch(schedule, /pushTable\s*\(/);
    assert.doesNotMatch(flush, /pushTable\s*\(/);
    assert.doesNotMatch(poll, /downloadVersions|applyRemoteVersions|pushTable\s*\(/);
    assert.match(flush, /pushPending/);
    assert.match(poll, /pullRemote/);
  });

  serviceB.close();
  for (const dir of [dirA, dirB]) fs.rmSync(dir, { recursive: true, force: true });
  const failed = checks.filter((item) => !item.ok);
  if (failed.length) {
    console.error(`P0-D operation sync FAIL: ${failed.length}/${checks.length}`);
    process.exit(1);
  }
  console.log(`P0-D operation sync PASS: ${checks.length}/${checks.length}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
