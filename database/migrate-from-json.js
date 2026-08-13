'use strict';

/**
 * Import a legacy backup/localStorage snapshot into the scoped SQLite authority.
 * The importer is additive and restart-safe: absence never means deletion and
 * every operational value is written to a typed core/entity repository.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { openDatabase, integrityCheck, getSchemaVersion } = require('./connection');
const { createRepositories } = require('./repositories');
const catalog = require('./entity-catalog');

const TABLE_KEY_MAP = Object.freeze({ ...catalog.CORE_TABLES });
const KV_KEYS = Object.freeze([...catalog.NON_OPERATIONAL_KV_KEYS]);

function stableId(key, item, index) {
  const hash = crypto.createHash('sha256')
    .update(`${key}:${index}:${JSON.stringify(item)}`)
    .digest('hex')
    .slice(0, 24);
  return `migrated-${hash}`;
}

function normalizeRecords(key, value) {
  const list = Array.isArray(value) ? value : [];
  return list.filter((item) => item && typeof item === 'object').map((item, index) => {
    if (item.id != null && String(item.id).trim()) return { ...item, id: String(item.id) };
    return { ...item, id: stableId(key, item, index), _migrationGeneratedId: true };
  });
}

function dedupeById(list) {
  const map = new Map();
  for (const item of list || []) map.set(String(item.id), item);
  return [...map.values()];
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((output, key) => {
    if (!['_migrationGeneratedId'].includes(key) && value[key] !== undefined) {
      output[key] = canonical(value[key]);
    }
    return output;
  }, {});
}

function recordTime(record) {
  const value = record?.updatedAt || record?.updated_at || record?.modifiedAt || record?.modified_at || '';
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function reconcileDecision(existing, incoming) {
  if (!existing) return { action: 'incoming', reason: 'new_record' };
  if (JSON.stringify(canonical(existing)) === JSON.stringify(canonical(incoming))) {
    return { action: 'same', reason: 'identical' };
  }
  const existingRevision = Number(existing.revision);
  const incomingRevision = Number(incoming.revision);
  if (Number.isFinite(existingRevision) && existingRevision > 0
      && Number.isFinite(incomingRevision) && incomingRevision > 0
      && existingRevision !== incomingRevision) {
    return incomingRevision > existingRevision
      ? { action: 'incoming', reason: 'higher_revision' }
      : { action: 'existing', reason: 'lower_revision' };
  }
  const existingTime = recordTime(existing);
  const incomingTime = recordTime(incoming);
  if (existingTime !== null && incomingTime !== null && existingTime !== incomingTime) {
    return incomingTime > existingTime
      ? { action: 'incoming', reason: 'newer_timestamp' }
      : { action: 'existing', reason: 'older_timestamp' };
  }
  return { action: 'conflict', reason: 'ambiguous_revision_timestamp' };
}

function prepareMigrationRecord(item, migrationTimestamp) {
  const createdAt = item.createdAt || item.created_at || migrationTimestamp;
  const updatedAt = item.updatedAt || item.updated_at || createdAt;
  const revision = Math.max(1, Number(item.revision) || 1);
  return { ...item, createdAt, updatedAt, revision };
}

function validateSnapshot(snapshot) {
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? { ok: true }
    : { ok: false, error: 'invalid_json' };
}

function collectScopeCandidates(snapshot) {
  const centerIds = new Set();
  const branchIds = new Set();
  const inspect = (item) => {
    if (!item || typeof item !== 'object') return;
    const centerId = String(item.centerId || item.center_id || item.organizationId || '').trim();
    const branchId = String(item.branchId || item.branch_id || item.lockedBranchId || '').trim();
    if (centerId) centerIds.add(centerId);
    if (branchId) branchIds.add(branchId);
    if (Array.isArray(item.branches)) {
      for (const branch of item.branches) {
        const id = String(branch?.id || branch?.branchId || '').trim();
        if (id) branchIds.add(id);
      }
    }
  };
  inspect(snapshot);
  for (const key of ['_meta', '__tdw_meta__', '__tdw_cloud_license__', 'license', 'organization']) {
    inspect(snapshot[key]);
    inspect(snapshot[key]?.meta);
    inspect(snapshot[key]?.license);
  }
  for (const key of [...Object.keys(TABLE_KEY_MAP), ...catalog.BRANCH_ENTITY_KEYS, ...catalog.ORGANIZATION_ENTITY_KEYS]) {
    const value = snapshot[key];
    if (Array.isArray(value)) value.forEach(inspect);
    else inspect(value);
  }
  return {
    centerIds: [...centerIds],
    branchIds: [...branchIds],
    centerId: centerIds.size === 1 ? [...centerIds][0] : '',
    branchId: branchIds.size === 1 ? [...branchIds][0] : '',
  };
}

function recordScope(record, authority, branchRequired) {
  const centerId = String(record?.centerId || record?.center_id || authority.centerId || '').trim();
  const branchId = branchRequired
    ? String(record?.branchId || record?.branch_id || authority.branchId || '').trim()
    : '__ORG__';
  if (!centerId) throw Object.assign(new Error('migration_center_ambiguous'), { code: 'migration_center_ambiguous' });
  if (branchRequired && !branchId) {
    throw Object.assign(new Error('migration_branch_ambiguous'), { code: 'migration_branch_ambiguous' });
  }
  return { centerId, branchId };
}

function summarizeSource(snapshot) {
  const output = {};
  for (const key of Object.keys(TABLE_KEY_MAP)) {
    output[TABLE_KEY_MAP[key]] = dedupeById(normalizeRecords(key, snapshot[key])).length;
  }
  output.visitTotalSum = dedupeById(normalizeRecords('cases', snapshot.cases))
    .reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  output.expenseSum = dedupeById(normalizeRecords('expenses', snapshot.expenses))
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  output.invoiceCounter = Number(snapshot.invoiceCounter) || 0;
  return output;
}

function writeOperationalEntities(repos, snapshot, authority, reconcile, migrationTimestamp) {
  let imported = 0;
  for (const key of catalog.BRANCH_ENTITY_KEYS) {
    if (snapshot[key] === undefined) continue;
    const raw = catalog.SINGLETON_SET.has(key)
      ? [{ id: '__singleton__', value: snapshot[key] }]
      : normalizeRecords(key, snapshot[key]);
    for (const sourceItem of dedupeById(raw)) {
      const item = prepareMigrationRecord(sourceItem, migrationTimestamp);
      const scope = recordScope(item, authority, true);
      const normalized = repos.forEntity?.(key);
      if (reconcile(key, item, scope, normalized, false)) imported += 1;
    }
  }
  for (const key of catalog.ORGANIZATION_ENTITY_KEYS) {
    if (snapshot[key] === undefined) continue;
    const raw = catalog.SINGLETON_SET.has(key)
      ? [{ id: '__singleton__', value: snapshot[key] }]
      : normalizeRecords(key, snapshot[key]);
    for (const sourceItem of dedupeById(raw)) {
      const item = prepareMigrationRecord(sourceItem, migrationTimestamp);
      const scope = recordScope(item, authority, false);
      const normalized = repos.forEntity?.(key);
      if (reconcile(key, item, { ...scope, organizationScoped: true }, normalized, true)) imported += 1;
    }
  }
  return imported;
}

function migrateFromSnapshot(options) {
  const opts = options || {};
  const snapshot = opts.snapshot;
  const validation = validateSnapshot(snapshot);
  if (!validation.ok) return { ok: false, error: validation.error };

  const source = summarizeSource(snapshot);
  const authority = collectScopeCandidates(snapshot);
  const report = {
    startedAt: new Date().toISOString(), source, authority, steps: [], ok: false,
  };
  const migrationTimestamp = (() => {
    const candidate = snapshot?._meta?.date || snapshot?.date || snapshot?.exportedAt;
    return Number.isFinite(Date.parse(String(candidate || '')))
      ? new Date(Date.parse(String(candidate))).toISOString()
      : '1970-01-01T00:00:00.000Z';
  })();
  const hasOperationalData = Object.keys(TABLE_KEY_MAP).some((key) => normalizeRecords(key, snapshot[key]).length > 0)
    || [...catalog.BRANCH_ENTITY_KEYS, ...catalog.ORGANIZATION_ENTITY_KEYS]
      .some((key) => snapshot[key] !== undefined && snapshot[key] !== null);
  if (!authority.centerId && hasOperationalData) {
    return { ...report, error: 'migration_center_ambiguous', finishedAt: new Date().toISOString() };
  }

  const dbPath = opts.dbPath || ':memory:';
  if (dbPath !== ':memory:' && fs.existsSync(dbPath) && opts.backupPath) {
    fs.mkdirSync(path.dirname(opts.backupPath), { recursive: true });
    fs.copyFileSync(dbPath, opts.backupPath);
    report.steps.push({ step: 'backup_existing_db', path: opts.backupPath });
  }
  if (opts.dryRun) {
    return { ...report, ok: true, dryRun: true, finishedAt: new Date().toISOString() };
  }

  let db;
  try {
    db = openDatabase(dbPath);
    const repos = createRepositories(db);
    const employees = dedupeById(normalizeRecords('doctors', snapshot.doctors))
      .map((item) => prepareMigrationRecord(item, migrationTimestamp));
    const clients = dedupeById(normalizeRecords('clientsRegistry', snapshot.clientsRegistry))
      .map((item) => prepareMigrationRecord(item, migrationTimestamp));
    const visits = dedupeById(normalizeRecords('cases', snapshot.cases))
      .map((item) => prepareMigrationRecord(item, migrationTimestamp));
    const employeeScopeIds = new Set(employees.map((item) => {
      const scope = recordScope(item, authority, true);
      return `${scope.centerId}:${scope.branchId}:${item.id}`;
    }));
    const clientScopeIds = new Set(clients.map((item) => {
      const scope = recordScope(item, authority, true);
      return `${scope.centerId}:${scope.branchId}:${item.id}`;
    }));
    const quarantine = [];

    const tx = db.transaction(() => {
      const putQuarantine = db.prepare(`
        INSERT OR REPLACE INTO p0b_quarantine
          (quarantine_id, source_table, source_id, reason, payload_json, quarantined_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const quarantineRecord = (key, item, reason, origin = 'incoming') => {
        const scope = (() => {
          try { return recordScope(item, authority, catalog.ORGANIZATION_SET.has(key) === false); }
          catch { return { centerId: '', branchId: '' }; }
        })();
        const fingerprint = crypto.createHash('sha256')
          .update(`${key}:${scope.centerId}:${scope.branchId}:${item.id}:${origin}:${reason}`)
          .digest('hex').slice(0, 24);
        putQuarantine.run(
          `snapshot:${fingerprint}`,
          key,
          String(item.id),
          reason,
          JSON.stringify({ origin, centerId: scope.centerId, branchId: scope.branchId, record: item }),
          new Date().toISOString()
        );
        quarantine.push({ key, id: item.id, reason, origin, total: Number(item.total) || 0, amount: Number(item.amount) || 0 });
      };
      const reconcile = (key, item, scope, normalizedRepo, organizationScoped = false) => {
        const repo = normalizedRepo || repos.entities;
        const lookupScope = organizationScoped ? { ...scope, branchId: '__ORG__' } : scope;
        const existing = normalizedRepo
          ? normalizedRepo.getById(item.id, lookupScope)
          : repos.entities.getById(key, item.id, lookupScope, { includeDeleted: true });
        const incoming = { ...item, centerId: scope.centerId, branchId: organizationScoped ? '__ORG__' : scope.branchId };
        const decision = reconcileDecision(existing, incoming);
        if (decision.action === 'same') return false;
        if (decision.action === 'existing' || decision.action === 'conflict') {
          quarantineRecord(key, incoming,
            decision.action === 'conflict' ? 'ambiguous_revision_timestamp_conflict' : `incoming_${decision.reason}`,
            'incoming');
          return false;
        }
        if (existing) quarantineRecord(key, existing, `existing_superseded_${decision.reason}`, 'existing');
        try {
          if (normalizedRepo) normalizedRepo.upsert(incoming, scope);
          else repo.upsert(key, incoming, scope);
          return true;
        } catch (error) {
          if (error?.code === 'DB_CONSTRAINT' && /cross_scope_id_collision/.test(String(error.detail || error.message))) {
            quarantineRecord(key, incoming, 'cross_scope_id_collision', 'incoming');
            return false;
          }
          throw error;
        }
      };
      for (const item of employees) reconcile('doctors', item, recordScope(item, authority, true), repos.employees);
      for (const item of clients) reconcile('clientsRegistry', item, recordScope(item, authority, true), repos.clients);
      for (const item of visits) {
        const scope = recordScope(item, authority, true);
        const clientId = item.clientRegistryId == null ? '' : String(item.clientRegistryId);
        if (clientId && !clientScopeIds.has(`${scope.centerId}:${scope.branchId}:${clientId}`)) {
          quarantineRecord('cases', item, 'orphan_client_reference');
          continue;
        }
        reconcile('cases', item, scope, repos.visits);
      }
      for (const sourceItem of dedupeById(normalizeRecords('bookings', snapshot.bookings))) {
        const item = prepareMigrationRecord(sourceItem, migrationTimestamp);
        reconcile('bookings', item, recordScope(item, authority, true), repos.bookings);
      }
      for (const sourceItem of dedupeById(normalizeRecords('attendance', snapshot.attendance))) {
        const item = prepareMigrationRecord(sourceItem, migrationTimestamp);
        const scope = recordScope(item, authority, true);
        const employeeId = String(item.doctorId || '');
        if (!employeeScopeIds.has(`${scope.centerId}:${scope.branchId}:${employeeId}`)) {
          quarantineRecord('attendance', item, 'orphan_employee_reference');
          continue;
        }
        reconcile('attendance', item, scope, repos.attendance);
      }
      for (const sourceItem of dedupeById(normalizeRecords('expenses', snapshot.expenses))) {
        const item = prepareMigrationRecord(sourceItem, migrationTimestamp);
        reconcile('expenses', item, recordScope(item, authority, true), repos.expenses);
      }

      const entityCount = writeOperationalEntities(repos, snapshot, authority, reconcile, migrationTimestamp);
      for (const key of catalog.NON_OPERATIONAL_KV_KEYS) {
        if (snapshot[key] !== undefined) repos.kv.set(key, snapshot[key]);
      }
      // Operational legacy KV is rollback material only and cannot remain a second authority.
      for (const key of catalog.OPERATIONAL_SET) repos.kv.delete(key);

      const migratedAt = new Date().toISOString();
      const putMeta = db.prepare(`
        INSERT INTO meta(key, value) VALUES(?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
      `);
      putMeta.run('migratedAt', migratedAt);
      putMeta.run('migrationSource', String(opts.sourceLabel || 'snapshot'));
      putMeta.run('localStorageRetained', 'false');
      putMeta.run('sqlitePrimary', 'true');
      if (authority.centerId) putMeta.run('authorityCenterId', authority.centerId);
      report.steps.push({ step: 'typed_import_transaction', entityCount, quarantine });
    });
    tx();

    const integrity = integrityCheck(db);
    report.integrity = integrity;
    if (!integrity.ok) throw Object.assign(new Error('integrity_failed'), { code: 'integrity_failed' });
    const centerScope = { centerId: authority.centerId, branchId: null };
    const target = {
      clients: authority.centerId ? repos.clients.count(centerScope) : 0,
      visits: authority.centerId ? repos.visits.count(centerScope) : 0,
      bookings: authority.centerId ? repos.bookings.count(centerScope) : 0,
      employees: authority.centerId ? repos.employees.count(centerScope) : 0,
      attendance: authority.centerId ? repos.attendance.count(centerScope) : 0,
      expenses: authority.centerId ? repos.expenses.count(centerScope) : 0,
      visitTotalSum: authority.centerId ? repos.visits.sumTotal(centerScope) : 0,
      expenseSum: authority.centerId ? repos.expenses.sumAmount(centerScope) : 0,
      invoiceCounter: snapshot.invoiceCounter === undefined ? 0 : Number(snapshot.invoiceCounter) || 0,
      schemaVersion: getSchemaVersion(db),
    };
    report.target = target;
    const quarantined = report.steps.flatMap((step) => step.quarantine || []);
    const incomingQuarantine = quarantined.filter((item) => item.origin !== 'existing');
    const countOk = target.clients >= source.clients
      && target.visits + incomingQuarantine.filter((item) => item.key === 'cases').length >= source.visits
      && target.bookings >= source.bookings
      && target.employees >= source.employees
      && target.attendance + incomingQuarantine.filter((item) => item.key === 'attendance').length >= source.attendance
      && target.expenses >= source.expenses;
    const verifiedVisitTotal = dedupeById(normalizeRecords('cases', snapshot.cases)).reduce((sum, item) => {
      const stored = repos.visits.getById(item.id, recordScope(item, authority, true));
      return sum + (Number(stored?.total) || 0);
    }, 0);
    const verifiedExpenseSum = dedupeById(normalizeRecords('expenses', snapshot.expenses)).reduce((sum, item) => {
      const stored = repos.expenses.getById(item.id, recordScope(item, authority, true));
      return sum + (Number(stored?.amount) || 0);
    }, 0);
    const preservedVisitTotal = verifiedVisitTotal
      + incomingQuarantine.filter((item) => item.key === 'cases').reduce((sum, item) => sum + item.total, 0);
    const preservedExpenseSum = verifiedExpenseSum
      + incomingQuarantine.filter((item) => item.key === 'expenses').reduce((sum, item) => sum + item.amount, 0);
    const totalsOk = Math.abs(preservedVisitTotal - source.visitTotalSum) < 0.02
      && Math.abs(preservedExpenseSum - source.expenseSum) < 0.02;
    report.comparison = {
      countOk,
      totalsOk,
      quarantineCount: quarantined.length,
      skippedAttendance: incomingQuarantine.filter((item) => item.key === 'attendance').length,
    };
    report.ok = countOk && totalsOk;
    if (!report.ok) report.error = 'comparison_mismatch';
    report.finishedAt = new Date().toISOString();
    return report;
  } catch (error) {
    report.ok = false;
    report.error = error.code || 'migration_failed';
    report.message = error.message;
    report.finishedAt = new Date().toISOString();
    return report;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

function migrateFromFile(jsonPath, dbPath, options = {}) {
  let snapshot;
  try { snapshot = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); }
  catch { return { ok: false, error: 'invalid_json' }; }
  return migrateFromSnapshot({ ...options, snapshot, dbPath, sourceLabel: path.basename(jsonPath) });
}

function exportSnapshot(dbPath, context = {}) {
  const db = openDatabase(dbPath);
  try {
    const repos = createRepositories(db);
    let centerId = String(context.centerId || '').trim();
    if (!centerId) {
      const centers = db.prepare(`
        SELECT center_id FROM (
          SELECT DISTINCT center_id FROM clients
          UNION SELECT DISTINCT center_id FROM employees
          UNION SELECT DISTINCT center_id FROM users
          UNION SELECT DISTINCT center_id FROM p0b_entities
        ) WHERE center_id <> '__QUARANTINE__' LIMIT 2
      `).all().map((row) => row.center_id).filter(Boolean);
      if (centers.length === 1) centerId = centers[0];
    }
    if (!centerId) throw Object.assign(new Error('export_center_required'), { code: 'export_center_required' });
    let branchId = context.aggregate === true ? null : String(context.branchId || '').trim();
    if (!branchId && context.aggregate !== true) {
      const branches = db.prepare(`
        SELECT branch_id FROM (
          SELECT DISTINCT branch_id FROM clients WHERE center_id=?
          UNION SELECT DISTINCT branch_id FROM employees WHERE center_id=?
          UNION SELECT DISTINCT branch_id FROM p0b_entities WHERE center_id=? AND branch_id <> '__ORG__'
        ) WHERE branch_id <> '__QUARANTINE__' LIMIT 2
      `).all(centerId, centerId, centerId).map((row) => row.branch_id).filter(Boolean);
      if (branches.length === 1) branchId = branches[0];
    }
    const scope = { centerId, branchId };
    if (!scope.branchId && context.aggregate !== true) {
      throw Object.assign(new Error('export_branch_required'), { code: 'export_branch_required' });
    }
    const output = {
      _meta: { version: 6, date: new Date().toISOString(), app: 'Hijama Management System', source: 'sqlite', schemaVersion: getSchemaVersion(db), centerId },
      clientsRegistry: repos.clients.getAll(scope),
      cases: repos.visits.getAll(scope),
      bookings: repos.bookings.getAll(scope),
      doctors: repos.employees.getAll(scope),
      attendance: repos.attendance.getAll(scope),
      expenses: repos.expenses.getAll(scope),
    };
    for (const key of catalog.BRANCH_ENTITY_KEYS) {
      const normalized = repos.forEntity?.(key);
      const rows = normalized
        ? normalized.getAll(scope)
        : (context.aggregate === true
          ? repos.entities.getAllForCenter(key, centerId)
          : repos.entities.getAll(key, scope));
      output[key] = catalog.SINGLETON_SET.has(key)
        ? (rows.find((row) => row.id === '__singleton__')?.value ?? null)
        : rows;
    }
    for (const key of catalog.ORGANIZATION_ENTITY_KEYS) {
      const normalized = repos.forEntity?.(key);
      const rows = normalized
        ? normalized.getAll({ centerId, branchId: '__ORG__' })
        : repos.entities.getAll(key, { centerId, branchId: '__ORG__' });
      output[key] = catalog.SINGLETON_SET.has(key)
        ? (rows.find((row) => row.id === '__singleton__')?.value ?? null)
        : rows;
    }
    for (const [key, value] of Object.entries(repos.kv.exportAll())) {
      if (catalog.classifyKey(key).kind === 'kv') output[key] = value;
    }
    return output;
  } finally {
    db.close();
  }
}

module.exports = {
  TABLE_KEY_MAP,
  KV_KEYS,
  validateSnapshot,
  summarizeSource,
  migrateFromSnapshot,
  migrateFromFile,
  exportSnapshot,
  collectScopeCandidates,
  dedupeById,
};
