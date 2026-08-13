'use strict';

/**
 * Creates the mandatory encrypted Backup V2 before migration 003 can open the
 * live database. The recovery password is random and protected by Electron
 * safeStorage; it is never derived from a public/default application secret.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const backupV2 = require('./backup-v2-core');
const { createFileCredentialVault } = require('./backup-v2-ipc');
const { PASSWORD_CREDENTIAL } = require('./backup-v2-scheduler');

const MIGRATION_ID = '003_p0b_authority';
const RECOVERY_CREDENTIAL = 'p0b-migration-backup-password';

function migrationPending(databasePath) {
  if (!fs.existsSync(databasePath)) return false;
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const table = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    ).get();
    if (!table) return true;
    return !db.prepare('SELECT 1 FROM schema_migrations WHERE id=?').get(MIGRATION_ID);
  } finally {
    db.close();
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function prepareP0bMigrationBackup(options = {}) {
  const userDataDir = path.resolve(String(options.userDataDir || ''));
  if (!userDataDir || userDataDir === path.parse(userDataDir).root) {
    throw new Error('p0b_preflight_user_data_invalid');
  }
  const databasePath = path.join(userDataDir, 'database', 'tadawi.db');
  if (!migrationPending(databasePath)) return { ok: true, required: false };

  const vault = options.vault || createFileCredentialVault(userDataDir);
  let password = vault.get(PASSWORD_CREDENTIAL) || vault.get(RECOVERY_CREDENTIAL);
  if (!password) {
    password = crypto.randomBytes(32).toString('base64url');
    vault.set(RECOVERY_CREDENTIAL, password);
  }

  const backupDir = path.join(userDataDir, 'database', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(backupDir, `pre-p0b-backup-v2-${stamp}.tdw`);
  const created = await (options.createBackupFile || backupV2.createBackupFile)({
    userDataDir,
    databasePath,
    outputPath,
    password,
    appVersion: String(options.appVersion || 'unknown'),
    backupType: 'pre-migration-p0b',
    centerId: '',
    organizationId: '',
    branchId: '',
    branchIds: [],
    deviceId: '',
  });
  if (!created?.ok || !fs.existsSync(outputPath)) throw new Error('p0b_backup_v2_not_committed');

  const report = {
    ok: true,
    required: true,
    migrationId: MIGRATION_ID,
    createdAt: new Date().toISOString(),
    databasePath,
    databaseSha256: sha256File(databasePath),
    backupPath: outputPath,
    backupSha256: sha256File(outputPath),
    backupId: created.manifest?.backupId || null,
    credential: vault.get(PASSWORD_CREDENTIAL) ? PASSWORD_CREDENTIAL : RECOVERY_CREDENTIAL,
  };
  const reportPath = path.join(path.dirname(databasePath), `pre-p0b-backup-v2-${Date.now()}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { ...report, reportPath };
}

module.exports = {
  MIGRATION_ID,
  RECOVERY_CREDENTIAL,
  migrationPending,
  prepareP0bMigrationBackup,
};
