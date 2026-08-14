#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const Database = require('better-sqlite3');

const root = path.join(__dirname, '..', '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tadawi-p0b-gate-'));
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        getPath(name) {
          if (name === 'userData') return tempRoot;
          return tempRoot;
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    checks.push({ name, ok: false, error: error.message });
    console.error(`FAIL  ${name}: ${error.message}`);
  }
}

let service;
try {
  service = require('../../electron/database/service');
} finally {
  Module._load = originalLoad;
}

const centerId = 'CTR-P0B-GATE';
const branchA = 'BR-A';
const branchB = 'BR-B';
const ctxA = { centerId, branchId: branchA, actorId: 'OWNER-1', deviceId: 'DEV-A' };
const ctxB = { centerId, branchId: branchB, actorId: 'OWNER-1', deviceId: 'DEV-B' };
const db = service.ensureDb();

check('all branch-owned schema tables enforce non-null center_id and branch_id', () => {
  const migration = require('../../database/migrations/003_p0b_authority');
  for (const table of migration.BRANCH_TABLES) {
    const info = db.prepare(`PRAGMA table_info("${table}")`).all();
    assert.equal(info.find((column) => column.name === 'center_id')?.notnull, 1, `${table}.center_id`);
    assert.equal(info.find((column) => column.name === 'branch_id')?.notnull, 1, `${table}.branch_id`);
  }
});

check('typed command writes authoritative data and outbox in one transaction', () => {
  const result = service.command({
    commandId: 'p0b-client-a-create', entity: 'clientsRegistry', action: 'upsert',
    record: { id: 'CLIENT-A', name: 'A' },
  }, ctxA);
  assert.equal(result.ok, true);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients WHERE id='CLIENT-A' AND branch_id=?").get(branchA).c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sync_outbox WHERE record_id='CLIENT-A' AND branch_id=?").get(branchA).c, 1);
});

check('cross-branch relationship is rejected and transaction rolls back', () => {
  const result = service.command({
    commandId: 'p0b-cross-branch-visit', entity: 'cases', action: 'upsert',
    record: { id: 'VISIT-B-X', clientRegistryId: 'CLIENT-A', invoice: 'INV-X', total: 10 },
  }, ctxB);
  assert.equal(result.ok, false);
  assert.match(`${result.error}:${result.message}`, /cross_scope_client_reference/);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM visits WHERE id='VISIT-B-X'").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sync_outbox WHERE record_id='VISIT-B-X'").get().c, 0);
});

check('scoped replaceAll removes branch A only and preserves branch B', () => {
  assert.equal(service.command({
    commandId: 'p0b-client-b-create', entity: 'clientsRegistry', action: 'upsert',
    record: { id: 'CLIENT-B', name: 'B' },
  }, ctxB).ok, true);
  const result = service.command({
    commandId: 'p0b-client-a-replace-empty', entity: 'clientsRegistry', action: 'replaceAll', records: [],
  }, ctxA);
  assert.equal(result.ok, true);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients WHERE branch_id=?").get(branchA).c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients WHERE branch_id=?").get(branchB).c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sync_outbox WHERE record_id='CLIENT-A' AND operation='DELETE'").get().c, 1);
});

check('aggregate/owner context cannot bypass required write branch', () => {
  const result = service.command({
    commandId: 'p0b-owner-aggregate-write', entity: 'clientsRegistry', action: 'upsert',
    record: { id: 'CLIENT-AGG', name: 'aggregate' },
  }, { centerId, aggregate: true, actorId: 'OWNER-1' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'write_branch_required');
});

check('forged source labels cannot override authoritative branch context', () => {
  const result = service.command({
    commandId: 'p0b-forged-source', entity: 'clientsRegistry', action: 'upsert', source: 'sync',
    record: { id: 'CLIENT-FORGE', centerId, branchId: branchB, name: 'forged' },
  }, ctxA);
  assert.equal(result.ok, true);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients WHERE id='CLIENT-FORGE' AND branch_id=?").get(branchB).c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients WHERE id='CLIENT-FORGE' AND branch_id=?").get(branchA).c, 1);
});

check('raw persistKv rejects every operational entity', () => {
  for (const key of service.catalog.OPERATIONAL_SET) {
    const result = service.persistKv(key, []);
    assert.equal(result.ok, false, key);
    assert.equal(result.error, 'raw_kv_operational_write_denied', key);
  }
});

check('failed multi-record command rolls back data and outbox', () => {
  const before = db.prepare("SELECT COUNT(*) c FROM sync_outbox WHERE table_name='invoices'").get().c;
  const result = service.command({
    commandId: 'p0b-rollback-duplicate-invoice', entity: 'invoices', action: 'upsertMany',
    records: [
      { id: 'INVOICE-1', invoiceNumber: 'DUP-100', total: 10 },
      { id: 'INVOICE-2', invoiceNumber: 'DUP-100', total: 20 },
    ],
  }, ctxA);
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM invoices WHERE id IN ('INVOICE-1','INVOICE-2')").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sync_outbox WHERE table_name='invoices'").get().c, before);
});

check('database:syncOp rejects cross-branch mutation', () => {
  const result = service.syncOp({
    op: 'enqueue',
    entry: { branch_id: branchB, table_name: 'cases', record_id: 'X', operation: 'UPDATE' },
  }, ctxA);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'branch_access_denied');
});

check('ambiguous legacy ownership is quarantined, never assigned to BR-MAIN, and rerun is idempotent', () => {
  const initial = require('../../database/migrations/001_initial');
  const sync = require('../../database/migrations/002_sync_platform');
  const p0b = require('../../database/migrations/003_p0b_authority');
  const legacy = new Database(':memory:');
  try {
    legacy.exec(initial.sql);
    legacy.exec(sync.sql);
    const now = new Date().toISOString();
    legacy.prepare(`INSERT INTO clients(id,name,payload_json,created_at,updated_at,revision)
      VALUES(?,?,?,?,?,?)`).run('AMB-1', 'ambiguous', JSON.stringify({ id: 'AMB-1' }), now, now, 1);
    const first = p0b.up(legacy);
    assert.equal(first.status, 'quarantine_review_required');
    assert.equal(legacy.prepare("SELECT COUNT(*) c FROM clients WHERE id='AMB-1'").get().c, 0);
    assert.equal(legacy.prepare("SELECT COUNT(*) c FROM clients WHERE branch_id='BR-MAIN'").get().c, 0);
    assert.equal(legacy.prepare("SELECT COUNT(*) c FROM p0b_quarantine WHERE source_id='AMB-1'").get().c, 1);
    p0b.up(legacy);
    assert.equal(legacy.prepare("SELECT COUNT(*) c FROM p0b_quarantine WHERE source_id='AMB-1'").get().c, 1);
  } finally {
    legacy.close();
  }
});

check('renderer boundary contains no direct literal operational DB.set writes', () => {
  const allowed = new Set(['cupping-sqlite-bridge.js', 'cloud/synced-write.js']);
  const operational = service.catalog.OPERATIONAL_SET;
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.codex') || ['node_modules', 'dist', 'docs', 'tests', 'scripts', 'review-work', 'pat-reports', '01-ORIGINAL', '02-CURRENT', 'app-source', 'src-stage5', 'src-stage6', 'ci-artifacts'].includes(entry.name) || entry.name.startsWith('stage-') && entry.name.endsWith('-uat')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:js|html)$/.test(entry.name)) files.push(full);
    }
  }
  walk(root);
  const violations = [];
  const directSet = /(?:global\.)?DB(?:\?\.)?\.set(?:\?\.)?\(\s*(['"])([^'"]+)\1/g;
  for (const file of files) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    if (allowed.has(relative)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(directSet)) {
      if (operational.has(match[2])) violations.push(`${relative}:${match[2]}`);
    }
  }
  assert.deepEqual(violations, []);
});

service.close();
try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* test temp only */ }

const failed = checks.filter((item) => !item.ok);
if (failed.length) {
  console.error(`P0-B authority gate FAIL: ${failed.length}/${checks.length}`);
  process.exit(1);
}
console.log(`P0-B authority gate PASS: ${checks.length}/${checks.length}`);
