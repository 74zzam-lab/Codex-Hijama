#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { openDatabase } = require('../../database/connection');
const backupV2 = require('../../electron/backup-v2-core');

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

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdw-p0c-restore-target-'));
  const dbPath = path.join(root, 'tadawi.db');
  const migrated = openDatabase(dbPath);
  migrated.close();
  return { root, dbPath, db: () => new Database(dbPath) };
}

function insertUser(db, user, id = user.id || 'seed-1') {
  db.prepare(`
    INSERT INTO users(id, username, role, payload_json, center_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, user.username || id, user.role || 'owner', JSON.stringify(user), 'CTR-TEST');
}

check('AT-RST-001 empty/missing target is replaceable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdw-p0c-missing-'));
  const result = backupV2.classifySetupRestoreTarget(path.join(root, 'missing.db'));
  assert.strictEqual(result.classification, 'empty');
  assert.strictEqual(result.replaceAllowed, true);
  fs.rmSync(root, { recursive: true, force: true });
});

check('AT-RST-001 schema and metadata-only target is replaceable', () => {
  const f = fixture();
  const db = f.db();
  db.prepare("INSERT INTO meta(key,value) VALUES('authorityCenterId','CTR-TEST') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  db.prepare("INSERT INTO kv_store(key,value_json,updated_at) VALUES(?,?,?)").run(
    '__tdw_cloud_license__', JSON.stringify({ centerId: 'CTR-TEST' }), new Date().toISOString()
  );
  db.prepare("INSERT INTO device_registry_local(device_uuid,status) VALUES('DEV-1','pending')").run();
  db.close();
  const result = backupV2.classifySetupRestoreTarget(f.dbPath);
  assert.strictEqual(result.classification, 'bootstrap_only');
  assert.strictEqual(result.replaceAllowed, true);
  assert.strictEqual(result.meaningfulRows, 0);
  fs.rmSync(f.root, { recursive: true, force: true });
});

check('AT-RST-001 seeded forced-change users remain bootstrap-only', () => {
  const f = fixture();
  const db = f.db();
  insertUser(db, {
    id: 'seed-owner', username: 'owner', role: 'owner', active: true,
    password: 'pbkdf2:seed:hash', mustChangePassword: true, seedDefaultPassword: true,
  }, 'seed-owner');
  db.close();
  const result = backupV2.classifySetupRestoreTarget(f.dbPath);
  assert.strictEqual(result.classification, 'bootstrap_only');
  assert.strictEqual(result.replaceAllowed, true);
  fs.rmSync(f.root, { recursive: true, force: true });
});

check('AT-RST-001 setup settings and device enrollment remain bootstrap-only', () => {
  const f = fixture();
  const db = f.db();
  const now = new Date().toISOString();
  for (const [entityType, value] of [
    ['settings', { centerName: 'Setup Center' }],
    ['__tdw_device_registry__', { registered: [{ deviceUuid: 'DEV-SETUP', branchId: 'BR-1' }] }],
  ]) {
    const payload = { id: '__singleton__', value, centerId: 'CTR-TEST', branchId: '__ORG__', revision: 1 };
    db.prepare(`
      INSERT INTO p0b_entities(center_id,branch_id,entity_type,entity_id,payload_json,revision,updated_at)
      VALUES(?,?,?,?,?,?,?)
    `).run('CTR-TEST', '__ORG__', entityType, '__singleton__', JSON.stringify(payload), 1, now);
    db.prepare(`
      INSERT INTO p0b_commands(command_id,center_id,branch_id,entity_type,result_json,committed_at)
      VALUES(?,?,?,?,?,?)
    `).run(`CMD-${entityType}`, 'CTR-TEST', '__ORG__', entityType, '{"ok":true}', now);
    db.prepare(`
      INSERT INTO sync_outbox(event_id,idempotency_key,center_id,branch_id,table_name,record_id,operation,base_revision,new_revision,payload_json,payload_hash,device_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      `EVT-${entityType}`, `IDEMP-${entityType}`, 'CTR-TEST', '__ORG__', entityType, '__singleton__',
      'CREATE', 0, 1, JSON.stringify(payload), 'a'.repeat(64), 'DEV-SETUP', now,
    );
  }
  db.close();
  const result = backupV2.classifySetupRestoreTarget(f.dbPath);
  assert.strictEqual(result.classification, 'bootstrap_only');
  assert.strictEqual(result.replaceAllowed, true);
  fs.rmSync(f.root, { recursive: true, force: true });
});

check('AT-RST-001 partial business data closes setup restore gate', () => {
  const f = fixture();
  const db = f.db();
  db.prepare(`
    INSERT INTO clients(id,name,payload_json,center_id,branch_id)
    VALUES('C-1','Patient','{}','CTR-TEST','BR-1')
  `).run();
  db.close();
  const result = backupV2.classifySetupRestoreTarget(f.dbPath);
  assert.strictEqual(result.classification, 'populated');
  assert.strictEqual(result.replaceAllowed, false);
  assert.ok(result.reasons.includes('persisted_rows:clients'));
  fs.rmSync(f.root, { recursive: true, force: true });
});

check('AT-RST-001 usable Owner credential is meaningful and cannot be overwritten', () => {
  const f = fixture();
  const db = f.db();
  insertUser(db, {
    id: 'owner-real', username: 'owner', role: 'owner', active: true,
    password: 'pbkdf2v2:sha256:120000:c2FsdA==:aGFzaA==',
    mustChangePassword: false, seedDefaultPassword: false, credentialRevision: 2,
  }, 'owner-real');
  db.close();
  const result = backupV2.classifySetupRestoreTarget(f.dbPath);
  assert.strictEqual(result.classification, 'populated');
  assert.strictEqual(result.replaceAllowed, false);
  assert.ok(result.reasons.includes('usable_or_nonseed_user'));
  fs.rmSync(f.root, { recursive: true, force: true });
});

check('setup local and cloud IPC routes use the semantic target classifier', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../electron/backup-v2-ipc.js'), 'utf8');
  assert.strictEqual((source.match(/classifySetupRestoreTarget\(databasePath\)/g) || []).length, 2);
  assert.doesNotMatch(source, /ignoredTables = new Set\(\['schema_migrations'/);
});

const failed = results.filter((row) => !row.ok);
console.log(`\nP0-C setup restore target: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
