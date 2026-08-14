'use strict';

/**
 * P0-B ownership and single-authority schema.
 *
 * The migration is deliberately restart-safe. Ambiguous legacy rows are copied to
 * p0b_quarantine and removed from authoritative tables; they are never silently
 * assigned to BR-MAIN. The original database is backed up by connection.js before
 * this migration starts.
 */

const BRANCH_TABLES = Object.freeze([
  'clients', 'visits', 'visit_cups', 'invoices', 'invoice_items', 'payments',
  'appointments', 'employees', 'attendance', 'payroll_periods', 'payroll_entries',
  'commissions', 'expenses', 'attachments', 'audit_events',
]);

const CENTER_TABLES = Object.freeze([
  ...BRANCH_TABLES,
  'services', 'practitioners', 'users', 'roles', 'permissions', 'settings',
]);

const QUARANTINE = '__QUARANTINE__';

function quoteId(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function tableExists(db, table) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${quoteId(table)})`).all();
}

function columnExists(db, table, column) {
  return columns(db, table).some((item) => item.name === column);
}

function parseJson(value) {
  try { return JSON.parse(String(value || 'null')); } catch { return null; }
}

function nonEmpty(value) {
  const normalized = String(value || '').trim();
  return normalized && normalized !== QUARANTINE ? normalized : '';
}

function collectIdentity(db) {
  const centerIds = new Set();
  const branchIds = new Set();
  if (tableExists(db, 'kv_store')) {
    for (const row of db.prepare('SELECT key, value_json FROM kv_store').all()) {
      const value = parseJson(row.value_json);
      const candidates = [value, value?.meta, value?.license, value?.device, value?.organization];
      for (const item of candidates) {
        if (!item || typeof item !== 'object') continue;
        const centerId = nonEmpty(item.centerId || item.center_id || item.organizationId);
        const branchId = nonEmpty(item.branchId || item.branch_id || item.lockedBranchId);
        if (centerId) centerIds.add(centerId);
        if (branchId) branchIds.add(branchId);
        if (Array.isArray(item.branches) && item.branches.length === 1) {
          const onlyBranch = nonEmpty(item.branches[0]?.id || item.branches[0]?.branchId);
          if (onlyBranch) branchIds.add(onlyBranch);
        }
      }
    }
  }
  return {
    centerId: centerIds.size === 1 ? [...centerIds][0] : '',
    branchId: branchIds.size === 1 ? [...branchIds][0] : '',
    centerCandidates: [...centerIds],
    branchCandidates: [...branchIds],
  };
}

function ensureMigrationTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS p0b_quarantine (
      quarantine_id TEXT PRIMARY KEY,
      source_table TEXT NOT NULL,
      source_id TEXT,
      reason TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      quarantined_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_p0b_quarantine_source
      ON p0b_quarantine(source_table, reason);

    CREATE TABLE IF NOT EXISTS p0b_migration_reports (
      report_id TEXT PRIMARY KEY,
      migration_id TEXT NOT NULL,
      status TEXT NOT NULL,
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS p0b_entities (
      center_id TEXT NOT NULL CHECK(center_id <> ''),
      branch_id TEXT NOT NULL CHECK(branch_id <> ''),
      entity_type TEXT NOT NULL CHECK(entity_type <> ''),
      entity_id TEXT NOT NULL CHECK(entity_id <> ''),
      payload_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
      deleted_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(center_id, branch_id, entity_type, entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_p0b_entities_scope
      ON p0b_entities(center_id, branch_id, entity_type, deleted_at);

    CREATE TABLE IF NOT EXISTS p0b_preferences (
      center_id TEXT NOT NULL CHECK(center_id <> ''),
      preference_key TEXT NOT NULL CHECK(preference_key <> ''),
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(center_id, preference_key)
    );

    CREATE TABLE IF NOT EXISTS p0b_commands (
      command_id TEXT PRIMARY KEY,
      center_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      result_json TEXT NOT NULL,
      committed_at TEXT NOT NULL
    );
  `);
}

function addOwnershipColumns(db, table, requiresBranch) {
  if (!tableExists(db, table)) return;
  if (!columnExists(db, table, 'center_id')) {
    db.exec(`ALTER TABLE ${quoteId(table)} ADD COLUMN center_id TEXT NOT NULL DEFAULT '${QUARANTINE}'`);
  }
  if (requiresBranch && !columnExists(db, table, 'branch_id')) {
    db.exec(`ALTER TABLE ${quoteId(table)} ADD COLUMN branch_id TEXT NOT NULL DEFAULT '${QUARANTINE}'`);
  }
}

function rowIdentifier(row, tableColumns) {
  if (tableColumns.some((item) => item.name === 'id')) return nonEmpty(row.id);
  if (tableColumns.some((item) => item.name === 'key')) return nonEmpty(row.key);
  return '';
}

function quarantineOrBackfill(db, table, requiresBranch, authority, report) {
  if (!tableExists(db, table)) return;
  const tableColumns = columns(db, table);
  const payloadColumn = tableColumns.some((item) => item.name === 'payload_json')
    ? 'payload_json'
    : (tableColumns.some((item) => item.name === 'value_json') ? 'value_json' : null);
  const selectColumns = tableColumns.map((item) => quoteId(item.name)).join(', ');
  const rows = db.prepare(`SELECT rowid AS __rowid, ${selectColumns} FROM ${quoteId(table)}`).all();
  const update = db.prepare(
    `UPDATE ${quoteId(table)} SET center_id=?${requiresBranch ? ', branch_id=?' : ''} WHERE rowid=?`
  );
  const remove = db.prepare(`DELETE FROM ${quoteId(table)} WHERE rowid=?`);
  const putQuarantine = db.prepare(`
    INSERT OR IGNORE INTO p0b_quarantine
      (quarantine_id, source_table, source_id, reason, payload_json, quarantined_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const row of rows) {
    const payload = parseJson(payloadColumn ? row[payloadColumn] : null) || {};
    const centerId = nonEmpty(row.center_id || payload.centerId || payload.center_id) || authority.centerId;
    const branchId = requiresBranch
      ? (nonEmpty(row.branch_id || payload.branchId || payload.branch_id) || authority.branchId)
      : '__ORG__';
    if (!centerId || (requiresBranch && !branchId)) {
      const sourceId = rowIdentifier(row, tableColumns) || String(row.__rowid);
      const reason = !centerId ? 'ambiguous_center' : 'ambiguous_branch';
      putQuarantine.run(
        `003:${table}:${sourceId}`,
        table,
        sourceId,
        reason,
        JSON.stringify(Object.fromEntries(tableColumns.map((item) => [item.name, row[item.name]]))),
        new Date().toISOString()
      );
      remove.run(row.__rowid);
      report.quarantined.push({ table, sourceId, reason });
      continue;
    }
    if (requiresBranch) update.run(centerId, branchId, row.__rowid);
    else update.run(centerId, row.__rowid);
    report.backfilled += 1;
  }
}

function rebuildWithStrictOwnership(db, table, requiresBranch) {
  if (!tableExists(db, table)) return;
  const info = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!info?.sql) return;
  const originalColumns = columns(db, table).map((item) => item.name);
  const indexes = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL"
  ).all(table).map((item) => item.sql);
  const temp = `__p0b_${table}_new`;
  db.exec(`DROP TABLE IF EXISTS ${quoteId(temp)}`);
  let createSql = info.sql.replace(
    /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)/i,
    `CREATE TABLE ${quoteId(temp)}`
  );
  createSql = createSql
    .replace(/center_id\s+TEXT\s+NOT NULL(?:\s+DEFAULT\s+'__QUARANTINE__')?/i,
      "center_id TEXT NOT NULL CHECK(center_id <> '')")
    .replace(/branch_id\s+TEXT(?:\s+NOT NULL)?(?:\s+DEFAULT\s+'__QUARANTINE__')?/i,
      "branch_id TEXT NOT NULL CHECK(branch_id <> '')");
  if (table === 'payroll_periods') {
    createSql = createSql.replace(/,?\s*UNIQUE\s*\(\s*year\s*,\s*month\s*\)/i, '');
    if (!/UNIQUE\s*\(\s*center_id\s*,\s*branch_id\s*,\s*year\s*,\s*month\s*\)/i.test(createSql)) {
      createSql = createSql.replace(/\)\s*$/, ', UNIQUE(center_id, branch_id, year, month))');
    }
  }
  db.exec(createSql);
  const columnList = originalColumns.map(quoteId).join(', ');
  db.exec(`INSERT INTO ${quoteId(temp)} (${columnList}) SELECT ${columnList} FROM ${quoteId(table)}`);
  db.exec(`DROP TABLE ${quoteId(table)}`);
  db.exec(`ALTER TABLE ${quoteId(temp)} RENAME TO ${quoteId(table)}`);
  for (const sql of indexes) db.exec(sql);

  const finalColumns = columns(db, table);
  const center = finalColumns.find((item) => item.name === 'center_id');
  const branch = finalColumns.find((item) => item.name === 'branch_id');
  if (!center?.notnull || (requiresBranch && !branch?.notnull)) {
    throw new Error(`p0b_ownership_not_enforced:${table}`);
  }
}

function createIntegrityGuards(db) {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_visits_scoped_invoice
      ON visits(center_id, branch_id, invoice)
      WHERE invoice IS NOT NULL AND invoice <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_scoped_number
      ON invoices(center_id, branch_id, invoice_number)
      WHERE invoice_number IS NOT NULL AND invoice_number <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS uq_users_scoped_username
      ON users(center_id, username)
      WHERE username IS NOT NULL AND username <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_scope_id
      ON clients(center_id, branch_id, id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_scope_id
      ON employees(center_id, branch_id, id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_visits_scope_id
      ON visits(center_id, branch_id, id);

    CREATE TRIGGER IF NOT EXISTS trg_visits_client_scope_insert
    BEFORE INSERT ON visits
    WHEN NEW.client_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id=NEW.client_id AND c.center_id=NEW.center_id AND c.branch_id=NEW.branch_id
    )
    BEGIN SELECT RAISE(ABORT, 'cross_scope_client_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_visits_client_scope_update
    BEFORE UPDATE OF client_id, center_id, branch_id ON visits
    WHEN NEW.client_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id=NEW.client_id AND c.center_id=NEW.center_id AND c.branch_id=NEW.branch_id
    )
    BEGIN SELECT RAISE(ABORT, 'cross_scope_client_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_visits_employee_scope_insert
    BEFORE INSERT ON visits
    WHEN NEW.doctor_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id=NEW.doctor_id AND e.center_id=NEW.center_id AND e.branch_id=NEW.branch_id
    )
    BEGIN SELECT RAISE(ABORT, 'cross_scope_employee_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_visits_employee_scope_update
    BEFORE UPDATE OF doctor_id, center_id, branch_id ON visits
    WHEN NEW.doctor_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id=NEW.doctor_id AND e.center_id=NEW.center_id AND e.branch_id=NEW.branch_id
    )
    BEGIN SELECT RAISE(ABORT, 'cross_scope_employee_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_appointments_scope_insert
    BEFORE INSERT ON appointments
    WHEN (NEW.client_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id=NEW.client_id AND c.center_id=NEW.center_id AND c.branch_id=NEW.branch_id
    )) OR (NEW.doctor_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id=NEW.doctor_id AND e.center_id=NEW.center_id AND e.branch_id=NEW.branch_id
    ))
    BEGIN SELECT RAISE(ABORT, 'cross_scope_appointment_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_appointments_scope_update
    BEFORE UPDATE OF client_id, doctor_id, center_id, branch_id ON appointments
    WHEN (NEW.client_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id=NEW.client_id AND c.center_id=NEW.center_id AND c.branch_id=NEW.branch_id
    )) OR (NEW.doctor_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id=NEW.doctor_id AND e.center_id=NEW.center_id AND e.branch_id=NEW.branch_id
    ))
    BEGIN SELECT RAISE(ABORT, 'cross_scope_appointment_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_invoices_scope_insert
    BEFORE INSERT ON invoices
    WHEN NEW.visit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM visits v
      WHERE v.id=NEW.visit_id AND v.center_id=NEW.center_id AND v.branch_id=NEW.branch_id
    )
    BEGIN SELECT RAISE(ABORT, 'cross_scope_invoice_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_invoices_scope_update
    BEFORE UPDATE OF visit_id, center_id, branch_id ON invoices
    WHEN NEW.visit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM visits v
      WHERE v.id=NEW.visit_id AND v.center_id=NEW.center_id AND v.branch_id=NEW.branch_id
    )
    BEGIN SELECT RAISE(ABORT, 'cross_scope_invoice_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_payments_scope_insert
    BEFORE INSERT ON payments
    WHEN (NEW.invoice_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id=NEW.invoice_id AND i.center_id=NEW.center_id AND i.branch_id=NEW.branch_id
    )) OR (NEW.visit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM visits v
      WHERE v.id=NEW.visit_id AND v.center_id=NEW.center_id AND v.branch_id=NEW.branch_id
    ))
    BEGIN SELECT RAISE(ABORT, 'cross_scope_payment_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_payments_scope_update
    BEFORE UPDATE OF invoice_id, visit_id, center_id, branch_id ON payments
    WHEN (NEW.invoice_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id=NEW.invoice_id AND i.center_id=NEW.center_id AND i.branch_id=NEW.branch_id
    )) OR (NEW.visit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM visits v
      WHERE v.id=NEW.visit_id AND v.center_id=NEW.center_id AND v.branch_id=NEW.branch_id
    ))
    BEGIN SELECT RAISE(ABORT, 'cross_scope_payment_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_payroll_entries_scope_insert
    BEFORE INSERT ON payroll_entries
    WHEN NOT EXISTS (
      SELECT 1 FROM payroll_periods p
      WHERE p.id=NEW.period_id AND p.center_id=NEW.center_id AND p.branch_id=NEW.branch_id
    ) OR NOT EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id=NEW.employee_id AND e.center_id=NEW.center_id AND e.branch_id=NEW.branch_id
    )
    BEGIN SELECT RAISE(ABORT, 'cross_scope_payroll_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_payroll_entries_scope_update
    BEFORE UPDATE OF period_id, employee_id, center_id, branch_id ON payroll_entries
    WHEN NOT EXISTS (
      SELECT 1 FROM payroll_periods p
      WHERE p.id=NEW.period_id AND p.center_id=NEW.center_id AND p.branch_id=NEW.branch_id
    ) OR NOT EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id=NEW.employee_id AND e.center_id=NEW.center_id AND e.branch_id=NEW.branch_id
    )
    BEGIN SELECT RAISE(ABORT, 'cross_scope_payroll_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_invoice_items_scope_insert
    BEFORE INSERT ON invoice_items
    WHEN NOT EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id=NEW.invoice_id AND i.center_id=NEW.center_id AND i.branch_id=NEW.branch_id
    )
    BEGIN SELECT RAISE(ABORT, 'cross_scope_invoice_item_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_invoice_items_scope_update
    BEFORE UPDATE OF invoice_id, center_id, branch_id ON invoice_items
    WHEN NOT EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id=NEW.invoice_id AND i.center_id=NEW.center_id AND i.branch_id=NEW.branch_id
    )
    BEGIN SELECT RAISE(ABORT, 'cross_scope_invoice_item_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_visit_cups_scope_insert
    BEFORE INSERT ON visit_cups
    WHEN NOT EXISTS (
      SELECT 1 FROM visits v
      WHERE v.id=NEW.visit_id AND v.center_id=NEW.center_id AND v.branch_id=NEW.branch_id
    )
    BEGIN SELECT RAISE(ABORT, 'cross_scope_visit_cup_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_visit_cups_scope_update
    BEFORE UPDATE OF visit_id, center_id, branch_id ON visit_cups
    WHEN NOT EXISTS (
      SELECT 1 FROM visits v
      WHERE v.id=NEW.visit_id AND v.center_id=NEW.center_id AND v.branch_id=NEW.branch_id
    )
    BEGIN SELECT RAISE(ABORT, 'cross_scope_visit_cup_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_attendance_employee_scope_insert
    BEFORE INSERT ON attendance
    WHEN NOT EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id=NEW.employee_id AND e.center_id=NEW.center_id AND e.branch_id=NEW.branch_id
    )
    BEGIN SELECT RAISE(ABORT, 'cross_scope_employee_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_attendance_employee_scope_update
    BEFORE UPDATE OF employee_id, center_id, branch_id ON attendance
    WHEN NOT EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id=NEW.employee_id AND e.center_id=NEW.center_id AND e.branch_id=NEW.branch_id
    )
    BEGIN SELECT RAISE(ABORT, 'cross_scope_employee_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_commission_scope_insert
    BEFORE INSERT ON commissions
    WHEN (NEW.employee_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id=NEW.employee_id AND e.center_id=NEW.center_id AND e.branch_id=NEW.branch_id
    )) OR (NEW.visit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM visits v
      WHERE v.id=NEW.visit_id AND v.center_id=NEW.center_id AND v.branch_id=NEW.branch_id
    ))
    BEGIN SELECT RAISE(ABORT, 'cross_scope_commission_reference'); END;

    CREATE TRIGGER IF NOT EXISTS trg_commission_scope_update
    BEFORE UPDATE OF employee_id, visit_id, center_id, branch_id ON commissions
    WHEN (NEW.employee_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id=NEW.employee_id AND e.center_id=NEW.center_id AND e.branch_id=NEW.branch_id
    )) OR (NEW.visit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM visits v
      WHERE v.id=NEW.visit_id AND v.center_id=NEW.center_id AND v.branch_id=NEW.branch_id
    ))
    BEGIN SELECT RAISE(ABORT, 'cross_scope_commission_reference'); END;
  `);
}

function up(db) {
  ensureMigrationTables(db);
  const priorRow = db.prepare(
    "SELECT report_json FROM p0b_migration_reports WHERE report_id='003_p0b_authority'"
  ).get();
  const ownershipAlreadyStrict = CENTER_TABLES.every((table) => {
    if (!tableExists(db, table)) return true;
    const info = columns(db, table);
    const center = info.find((item) => item.name === 'center_id');
    const branch = info.find((item) => item.name === 'branch_id');
    return center?.notnull === 1 && (!BRANCH_TABLES.includes(table) || branch?.notnull === 1);
  });
  if (priorRow && ownershipAlreadyStrict) {
    return { ...(parseJson(priorRow.report_json) || {}), replayed: true };
  }
  const authority = collectIdentity(db);
  const report = {
    migrationId: '003_p0b_authority',
    startedAt: new Date().toISOString(),
    authority,
    backfilled: 0,
    quarantined: [],
    status: 'running',
  };

  db.pragma('foreign_keys = OFF');
  const tx = db.transaction(() => {
    for (const table of CENTER_TABLES) {
      const requiresBranch = BRANCH_TABLES.includes(table);
      addOwnershipColumns(db, table, requiresBranch);
      quarantineOrBackfill(db, table, requiresBranch, authority, report);
    }
    for (const table of CENTER_TABLES) {
      rebuildWithStrictOwnership(db, table, BRANCH_TABLES.includes(table));
    }
    createIntegrityGuards(db);
    report.status = report.quarantined.length ? 'quarantine_review_required' : 'complete';
    report.finishedAt = new Date().toISOString();
    db.prepare(`
      INSERT OR REPLACE INTO p0b_migration_reports
        (report_id, migration_id, status, report_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('003_p0b_authority', '003_p0b_authority', report.status, JSON.stringify(report), report.finishedAt);
    db.prepare(`
      INSERT INTO meta(key, value) VALUES('p0bAuthorityStatus', ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `).run(report.status);
  });
  try {
    tx();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  const foreignCheck = db.prepare('PRAGMA foreign_key_check').all();
  if (foreignCheck.length) throw new Error(`p0b_foreign_key_check_failed:${foreignCheck.length}`);
  return report;
}

function report(db) {
  const row = db.prepare(
    "SELECT report_json FROM p0b_migration_reports WHERE report_id='003_p0b_authority'"
  ).get();
  return row ? parseJson(row.report_json) : null;
}

module.exports = {
  version: 6,
  id: '003_p0b_authority',
  backupLabel: 'pre-p0b',
  managesTransaction: true,
  up,
  report,
  BRANCH_TABLES,
  CENTER_TABLES,
};
