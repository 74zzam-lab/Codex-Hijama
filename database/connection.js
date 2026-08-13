'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const initial = require('./migrations/001_initial');
const syncPlatform = require('./migrations/002_sync_platform');
const p0bAuthority = require('./migrations/003_p0b_authority');
const syncOperations = require('./migrations/004_sync_operations');
const financialIntegrity = require('./migrations/005_financial_integrity');
const financialReversals = require('./migrations/006_financial_reversals');
const { applyOpenPragmas } = require('./db-maintenance');

const MIGRATIONS = [initial, syncPlatform, p0bAuthority, syncOperations, financialIntegrity, financialReversals];

class DatabaseOpenError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'DatabaseOpenError';
    this.code = code;
    this.details = details || {};
  }
}

function copyDiagnostic(dbPath) {
  try {
    if (!dbPath || dbPath === ':memory:' || !fs.existsSync(dbPath)) return null;
    const dest = `${dbPath}.diagnostic-${Date.now()}`;
    fs.copyFileSync(dbPath, dest);
    return dest;
  } catch {
    return null;
  }
}

/**
 * Open SQLite with fail-safe rules (DATA-007):
 * - Missing file on first run: create schema (unless requireExisting).
 * - Corrupt / integrity fail: STOP — preserve original, diagnostic copy, throw.
 * - Never silently replace a bad DB with an empty one when the file already existed.
 */
function openDatabase(dbPath, options = {}) {
  const requireExisting = options.requireExisting === true;
  const failOnCorrupt = options.failOnCorrupt !== false;
  const existedBefore = dbPath !== ':memory:' && fs.existsSync(dbPath);

  if (dbPath !== ':memory:') {
    if (requireExisting && !existedBefore) {
      throw new DatabaseOpenError(
        'DATABASE_MISSING',
        'Database file is missing; refusing to create empty schema silently.',
        { dbPath }
      );
    }
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  let db;
  try {
    db = new Database(dbPath, options);
  } catch (err) {
    const diagnostic = existedBefore ? copyDiagnostic(dbPath) : null;
    throw new DatabaseOpenError(
      'DATABASE_OPEN_FAILED',
      'Failed to open database — original file preserved.',
      { dbPath, diagnostic, cause: String(err && err.message) }
    );
  }

  try {
    // WAL + FK + busy_timeout=5000 (V2-5.5 DB-255)
    applyOpenPragmas(db);
  } catch (err) {
    try { db.close(); } catch { /* ignore */ }
    const diagnostic = existedBefore ? copyDiagnostic(dbPath) : null;
    throw new DatabaseOpenError(
      'DATABASE_PRAGMA_FAILED',
      'Database pragmas failed — original preserved.',
      { dbPath, diagnostic, cause: String(err && err.message) }
    );
  }

  if (existedBefore && failOnCorrupt) {
    const integ = integrityCheck(db);
    if (!integ.ok) {
      try { db.close(); } catch { /* ignore */ }
      const diagnostic = copyDiagnostic(dbPath);
      throw new DatabaseOpenError(
        'DATABASE_CORRUPT',
        'PRAGMA integrity_check failed — refusing empty replacement. Restore from backup.',
        { dbPath, diagnostic, detail: integ.detail }
      );
    }
  }

  try {
    migrate(db, { dbPath });
  } catch (err) {
    try { db.close(); } catch { /* ignore */ }
    const diagnostic = existedBefore ? copyDiagnostic(dbPath) : null;
    throw new DatabaseOpenError(
      'DATABASE_MIGRATE_FAILED',
      'Schema migration failed — original preserved.',
      { dbPath, diagnostic, cause: String(err && err.message) }
    );
  }
  return db;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function createPreMigrationBackup(db, dbPath, migration) {
  if (!migration?.backupLabel || !dbPath || dbPath === ':memory:') return null;
  const backupDir = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const target = path.join(
    backupDir,
    `${migration.backupLabel}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`
  );
  try { db.pragma('wal_checkpoint(FULL)'); } catch { /* best effort before VACUUM INTO */ }
  db.exec(`VACUUM INTO ${sqlString(target)}`);
  const check = new Database(target, { readonly: true, fileMustExist: true });
  try {
    const integrity = integrityCheck(check);
    if (!integrity.ok) throw new Error('pre_migration_backup_integrity_failed');
  } finally {
    check.close();
  }
  return target;
}

function writeMigrationReport(dbPath, migration, report, backupPath) {
  if (!dbPath || dbPath === ':memory:' || !report) return null;
  const reportPath = path.join(
    path.dirname(dbPath),
    `migration-report-${migration.id}-${Date.now()}.json`
  );
  const output = { ...report, backupPath: backupPath || null };
  fs.writeFileSync(reportPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return reportPath;
}

function migrate(db, options = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id)
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    const backupPath = createPreMigrationBackup(db, options.dbPath, m);
    let migrationReport = null;
    const markApplied = () => {
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        m.id,
        new Date().toISOString()
      );
      db.prepare(
        `INSERT INTO meta(key, value) VALUES('schemaVersion', ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`
      ).run(String(m.version));
      if (backupPath) {
        db.prepare(
          `INSERT INTO meta(key, value) VALUES(?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value`
        ).run(`migrationBackup:${m.id}`, backupPath);
      }
    };
    if (typeof m.up === 'function') {
      migrationReport = m.up(db) || null;
      db.transaction(markApplied)();
    } else {
      db.transaction(() => {
        db.exec(m.sql);
        markApplied();
      })();
    }
    const reportPath = writeMigrationReport(options.dbPath, m, migrationReport, backupPath);
    if (reportPath) {
      db.prepare(
        `INSERT INTO meta(key, value) VALUES(?, ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`
      ).run(`migrationReport:${m.id}`, reportPath);
    }
  }
  return getSchemaVersion(db);
}

function getSchemaVersion(db) {
  try {
    const row = db.prepare(`SELECT value FROM meta WHERE key = 'schemaVersion'`).get();
    return row ? Number(row.value) : 0;
  } catch {
    return 0;
  }
}

function integrityCheck(db) {
  const row = db.prepare('PRAGMA integrity_check').get();
  const ok = row && String(row.integrity_check || Object.values(row)[0]).toLowerCase() === 'ok';
  return { ok, detail: row };
}

function defaultDbPath(userDataPath) {
  return path.join(userDataPath, 'database', 'tadawi.db');
}

module.exports = {
  openDatabase,
  migrate,
  getSchemaVersion,
  integrityCheck,
  defaultDbPath,
  MIGRATIONS,
  DatabaseOpenError,
  copyDiagnostic,
};
