#!/usr/bin/env node
'use strict';

/**
 * Hybrid Backup V2 smoke tests (Node main-process path — no Electron required).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../database/connection');
const backupV2 = require('../../electron/backup-v2-core');

const errors = [];
function check(ok, msg) {
  if (!ok) errors.push(msg);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-backup-v2-'));
  const userDataDir = path.join(root, 'userData');
  const dbPath = path.join(userDataDir, 'database', 'tadawi.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(path.join(userDataDir, 'settings'), { recursive: true });
  fs.mkdirSync(path.join(userDataDir, 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'settings', 'app.json'), JSON.stringify({ theme: 'light' }, null, 2));

  const db = openDatabase(dbPath);
  db.prepare(
    `INSERT INTO clients
      (id, name, phone, center_id, branch_id, payload_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'c1', 'Test Client', '0500000000', 'CTR-TEST', 'BR-MAIN',
    JSON.stringify({ id: 'c1', centerId: 'CTR-TEST', branchId: 'BR-MAIN', name: 'Test Client' }),
    new Date().toISOString(), new Date().toISOString()
  );
  db.close();

  const health = backupV2.databaseHealth(dbPath);
  check(health.ok === true, 'databaseHealth ok');
  check(Number(health.schemaVersion) >= 4, `schemaVersion expected >=4 got ${health.schemaVersion}`);

  const password = 'hybrid-test-password';
  const outPath = path.join(root, 'backup.tdw');
  const created = await backupV2.createBackupFile({
    userDataDir,
    outputPath: outPath,
    password,
    appVersion: '2.0.0',
    backupType: 'manual',
  });
  check(created.ok === true, 'createBackupFile ok');
  check(fs.existsSync(outPath), 'backup file exists');
  check(created.hash && /^[a-f0-9]{64}$/i.test(created.hash), 'backup hash present');

  const verified = backupV2.verifyBackupFile(outPath, password);
  check(verified.ok === true || verified.manifest?.format === backupV2.BACKUP_FORMAT || verified.database?.ok, 'verifyBackupFile ok');

  // wrong password
  let wrongOk = false;
  try {
    backupV2.verifyBackupFile(outPath, 'wrong-password-xx');
    wrongOk = true;
  } catch (err) {
    check(/backup_authentication_failed|password|auth/i.test(String(err.message)), `wrong password error: ${err.message}`);
  }
  check(!wrongOk, 'wrong password must fail');

  // corrupted file
  const corruptPath = path.join(root, 'corrupt.tdw');
  const buf = fs.readFileSync(outPath);
  buf[buf.length - 1] ^= 0xff;
  fs.writeFileSync(corruptPath, buf);
  let corruptFailed = false;
  try {
    backupV2.verifyBackupFile(corruptPath, password);
  } catch {
    corruptFailed = true;
  }
  check(corruptFailed, 'corrupted backup must fail');

  // restore to alternate userData
  const restoreDir = path.join(root, 'restoreUserData');
  fs.mkdirSync(restoreDir, { recursive: true });
  const restored = await backupV2.restoreBackupFile({
    userDataDir: restoreDir,
    filePath: outPath,
    password,
  });
  check(restored.ok === true || fs.existsSync(path.join(restoreDir, 'database', 'tadawi.db')), 'restore writes database');
  if (fs.existsSync(path.join(restoreDir, 'database', 'tadawi.db'))) {
    const restoredHealth = backupV2.databaseHealth(path.join(restoreDir, 'database', 'tadawi.db'));
    check(restoredHealth.ok === true, 'restored DB health ok');
  } else {
    check(false, `restore did not create DB; result=${JSON.stringify(restored && { ok: restored.ok, error: restored.error })}`);
  }

  // CSP / remote QR must remain rejected in protected tree
  const csp = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'security', 'window-policy.js'), 'utf8');
  check(!csp.includes('api.qrserver.com'), 'Backup V2 port must not loosen CSP for QR');

  // cleanup
  fs.rmSync(root, { recursive: true, force: true });

  if (errors.length) {
    console.error('FAIL: hybrid backup v2');
    for (const e of errors) console.error(' -', e);
    process.exit(1);
  }
  console.log('OK: hybrid backup v2 create/verify/restore smoke');
}

main().catch((err) => {
  console.error('FAIL: hybrid backup v2', err);
  process.exit(1);
});
