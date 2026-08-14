#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const asar = require('@electron/asar');
const BetterSqlite = require('better-sqlite3');

const root = path.join(__dirname, '..', '..');
const installRoot = process.env.P0B_INSTALL_ROOT
  || path.join(root, '.codex-p0a', 'installed-p0a', 'Hijama Management System');
const exePath = path.join(installRoot, 'Hijama Management System.exe');
const asarPath = path.join(installRoot, 'resources', 'app.asar');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tadawi-p0b-installed-'));
const extractedRoot = path.join(tempRoot, 'app');
const userData = path.join(tempRoot, 'user-data');
const results = [];

function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: String(error?.message || error) });
    console.error(`FAIL  ${name}: ${error?.message || error}`);
  }
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

check('installed executable and app.asar exist', () => {
  assert.ok(fs.statSync(exePath).size > 100 * 1024 * 1024);
  assert.ok(fs.statSync(asarPath).size > 1024 * 1024);
});

asar.extractAll(asarPath, extractedRoot);
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => userData } };
  }
  if (request === 'better-sqlite3') return BetterSqlite;
  return originalLoad.call(this, request, parent, isMain);
};

let service;
try {
  service = require(path.join(extractedRoot, 'electron', 'database', 'service.js'));
} finally {
  Module._load = originalLoad;
}

const centerId = 'CTR-INSTALLED-P0B';
const ctxA = { centerId, branchId: 'BR-A', actorId: 'OWNER', deviceId: 'DEV-A' };
const ctxB = { centerId, branchId: 'BR-B', actorId: 'OWNER', deviceId: 'DEV-B' };
let db = service.ensureDb();

check('installed artifact enables SQLite primary schema with integrity', () => {
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  const status = service.enableSqlitePrimary();
  assert.equal(status.sqlitePrimary, true);
  assert.equal(status.p0bAuthorityStatus, 'complete');
});

check('installed typed commands publish data and outbox atomically', () => {
  const result = service.command({
    commandId: 'installed-a-create', entity: 'clientsRegistry', action: 'upsert',
    record: { id: 'CLIENT-A', name: 'Branch A' },
  }, ctxA);
  assert.equal(result.ok, true);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients WHERE id='CLIENT-A'").get().c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sync_outbox WHERE record_id='CLIENT-A'").get().c, 1);
});

check('installed scoped replace preserves other branch', () => {
  assert.equal(service.command({
    commandId: 'installed-b-create', entity: 'clientsRegistry', action: 'upsert',
    record: { id: 'CLIENT-B', name: 'Branch B' },
  }, ctxB).ok, true);
  assert.equal(service.command({
    commandId: 'installed-a-empty', entity: 'clientsRegistry', action: 'replaceAll', records: [],
  }, ctxA).ok, true);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients WHERE branch_id='BR-A'").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients WHERE branch_id='BR-B'").get().c, 1);
});

check('installed raw KV and cross-branch sync bypasses are denied', () => {
  assert.equal(service.persistKv('clientsRegistry', []).error, 'raw_kv_operational_write_denied');
  const result = service.syncOp({
    op: 'enqueue', entry: { center_id: centerId, branch_id: 'BR-B', table_name: 'cases' },
  }, ctxA);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'branch_access_denied');
});

check('locked database failure injects no data or outbox', () => {
  const beforeRows = db.prepare("SELECT COUNT(*) c FROM clients WHERE id='LOCKED-ROW'").get().c;
  const beforeEvents = db.prepare("SELECT COUNT(*) c FROM sync_outbox WHERE record_id='LOCKED-ROW'").get().c;
  const blocker = new BetterSqlite(service.getDbPath());
  try {
    blocker.pragma('busy_timeout = 100');
    blocker.exec('BEGIN EXCLUSIVE');
    const result = service.command({
      commandId: 'installed-locked-write', entity: 'clientsRegistry', action: 'upsert',
      record: { id: 'LOCKED-ROW', name: 'must rollback' },
    }, ctxA);
    assert.equal(result.ok, false);
    assert.equal(result.rolledBack, true);
  } finally {
    try { blocker.exec('ROLLBACK'); } catch { /* empty */ }
    blocker.close();
  }
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients WHERE id='LOCKED-ROW'").get().c, beforeRows);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sync_outbox WHERE record_id='LOCKED-ROW'").get().c, beforeEvents);
});

check('restart reopens identical authoritative state without resurrection', () => {
  const dbPath = service.getDbPath();
  service.close();
  db = service.ensureDb();
  assert.equal(service.getDbPath(), dbPath);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients WHERE branch_id='BR-A'").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients WHERE id='CLIENT-B' AND branch_id='BR-B'").get().c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients WHERE id='LOCKED-ROW'").get().c, 0);
});

const output = {
  ok: results.every((item) => item.ok),
  installedRoot: installRoot,
  executable: { path: exePath, sha256: sha256(exePath), size: fs.statSync(exePath).size },
  asar: { path: asarPath, sha256: sha256(asarPath), size: fs.statSync(asarPath).size },
  runtimeDb: {
    schemaVersion: db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()?.value,
    sqlitePrimary: db.prepare("SELECT value FROM meta WHERE key='sqlitePrimary'").get()?.value,
    integrity: db.pragma('integrity_check', { simple: true }),
    quarantine: db.prepare('SELECT COUNT(*) c FROM p0b_quarantine').get().c,
  },
  results,
};
console.log(JSON.stringify(output, null, 2));
service.close();
try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* isolated test temp */ }
if (!output.ok) process.exit(1);
