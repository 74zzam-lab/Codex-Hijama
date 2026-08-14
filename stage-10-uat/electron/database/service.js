'use strict';

/** Main-process authoritative SQLite service (P0-B). */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { openDatabase, defaultDbPath, integrityCheck, getSchemaVersion } = require('../../database/connection');
const { createRepositories } = require('../../database/repositories');
const { migrateFromSnapshot, exportSnapshot } = require('../../database/migrate-from-json');
const { createSyncPlatform } = require('../../database/sync-outbox');
const catalog = require('../../database/entity-catalog');
const { classifySetupRestoreTarget } = require('../backup-v2-core');

let db = null;
let repos = null;
let syncPlatform = null;

function getDbPath() {
  return defaultDbPath(app.getPath('userData'));
}

function ensureDb() {
  if (db) return db;
  try {
    db = openDatabase(getDbPath());
    repos = createRepositories(db);
    syncPlatform = createSyncPlatform(db);
    return db;
  } catch (error) {
    console.error('[sqlite] open failed:', error.code || error.message, error.details || '');
    throw error;
  }
}

function parseJson(value, fallback = null) {
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function readAuthorityIdentity() {
  ensureDb();
  const candidates = [];
  for (const key of ['__tdw_meta__', '__tdw_cloud_license__']) {
    const value = repos.kv.get(key, null);
    if (value && typeof value === 'object') candidates.push(value, value.meta, value.license);
  }
  const centerIds = new Set();
  const branchIds = new Set();
  const authorityMeta = db.prepare("SELECT value FROM meta WHERE key='authorityCenterId'").get();
  if (String(authorityMeta?.value || '').trim()) centerIds.add(String(authorityMeta.value).trim());
  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue;
    const centerId = String(item.centerId || item.center_id || '').trim();
    const branchId = String(item.branchId || item.branch_id || item.lockedBranchId || '').trim();
    if (centerId) centerIds.add(centerId);
    if (branchId) branchIds.add(branchId);
    if (Array.isArray(item.branches) && item.branches.length === 1) {
      const only = String(item.branches[0]?.id || '').trim();
      if (only) branchIds.add(only);
    }
  }
  const entityCenter = db.prepare(
    "SELECT DISTINCT center_id FROM p0b_entities WHERE center_id <> '__QUARANTINE__' LIMIT 2"
  ).all().map((row) => row.center_id);
  entityCenter.forEach((id) => centerIds.add(id));
  for (const table of ['clients', 'employees', 'visits', 'users', 'services']) {
    const centers = db.prepare(
      `SELECT DISTINCT center_id FROM ${table} WHERE center_id <> '__QUARANTINE__' LIMIT 2`
    ).all();
    centers.forEach((row) => { if (row.center_id) centerIds.add(row.center_id); });
  }
  for (const table of ['clients', 'employees', 'visits']) {
    const branches = db.prepare(
      `SELECT DISTINCT branch_id FROM ${table} WHERE branch_id <> '__QUARANTINE__' LIMIT 2`
    ).all();
    branches.forEach((row) => { if (row.branch_id) branchIds.add(row.branch_id); });
  }
  return {
    centerId: centerIds.size === 1 ? [...centerIds][0] : '',
    branchId: branchIds.size === 1 ? [...branchIds][0] : '',
    centerCandidates: [...centerIds],
    branchCandidates: [...branchIds],
  };
}

function normalizeContext(context = {}, options = {}) {
  const authority = readAuthorityIdentity();
  const centerId = String(context.centerId || context.center_id || authority.centerId || '').trim();
  const branchId = options.organizationScoped
    ? '__ORG__'
    : String(context.branchId || context.branch_id || '').trim();
  if (!centerId) throw Object.assign(new Error('center_context_required'), { code: 'center_context_required' });
  if (options.branchRequired !== false && !branchId) {
    throw Object.assign(new Error('write_branch_required'), { code: 'write_branch_required' });
  }
  return {
    centerId,
    branchId: branchId || null,
    actorId: context.actorId || context.actor_id || null,
    deviceId: String(context.deviceId || context.device_id || 'unknown-device'),
    aggregate: context.aggregate === true,
    trusted: context.trusted === true,
  };
}

function coreRepository(key) {
  const map = {
    clientsRegistry: repos.clients,
    cases: repos.visits,
    bookings: repos.bookings,
    doctors: repos.employees,
    attendance: repos.attendance,
    expenses: repos.expenses,
  };
  return map[key] || null;
}

function authoritativeRepository(key) {
  return coreRepository(key) || repos.forEntity?.(key) || null;
}

function getStatus(context = null) {
  ensureDb();
  const meta = {};
  for (const row of db.prepare('SELECT key, value FROM meta').all()) meta[row.key] = row.value;
  const authority = readAuthorityIdentity();
  let counts = {};
  if (context?.centerId || authority.centerId) {
    const scope = {
      centerId: context?.centerId || authority.centerId,
      branchId: context?.branchId || null,
    };
    counts = {
      clients: repos.clients.count(scope),
      visits: repos.visits.count(scope),
      bookings: repos.bookings.count(scope),
      employees: repos.employees.count(scope),
      attendance: repos.attendance.count(scope),
      expenses: repos.expenses.count(scope),
    };
  }
  return {
    ok: true,
    path: getDbPath(),
    schemaVersion: getSchemaVersion(db),
    integrity: integrityCheck(db),
    meta,
    authority,
    counts,
    sqlitePrimary: meta.sqlitePrimary === 'true',
    localStorageRetained: meta.localStorageRetained !== 'false',
    p0bAuthorityStatus: meta.p0bAuthorityStatus || 'unknown',
    quarantineCount: db.prepare('SELECT COUNT(*) AS c FROM p0b_quarantine').get().c,
  };
}

function unwrapEntityValue(key, rows) {
  if (catalog.SINGLETON_SET.has(key)) {
    const fallback = ['__tdw_owner_session_epoch__', 'invoiceCounter', 'clientFileCounter'].includes(key) ? 0 : {};
    return rows.find((row) => row.id === '__singleton__')?.value ?? rows[0]?.value ?? fallback;
  }
  return rows;
}

function migrateSetupSingletonShadows() {
  ensureDb();
  const authority = readAuthorityIdentity();
  const centerId = String(authority.centerId || '').trim();
  if (!centerId) return { ok: true, skipped: true, reason: 'center_not_ready' };
  const migrated = [];
  const removedShadows = [];
  const legacyKeys = new Set(repos.kv.getAllKeys());
  for (const key of ['__tdw_owner_profile__', '__tdw_owner_setup__', '__tdw_device_registry__']) {
    if (!legacyKeys.has(key)) continue;
    const legacyValue = repos.kv.get(key, null);
    const scope = { centerId, branchId: '__ORG__' };
    const repository = authoritativeRepository(key);
    let rows = repository
      ? repository.getAll(scope)
      : repos.entities.getAll(key, scope, { includeDeleted: false });
    if (!rows.some((row) => row.id === '__singleton__')) {
      const result = command({
        commandId: `migration-setup-singleton-v1:${centerId}:${key}`,
        entity: key,
        action: 'upsert',
        record: { id: '__singleton__', value: legacyValue },
      }, { centerId, branchId: '__ORG__', actorId: 'migration', deviceId: 'migration', trusted: true });
      if (result?.ok !== true) {
        const error = new Error(result?.error || 'setup_singleton_migration_failed');
        error.code = result?.error || 'setup_singleton_migration_failed';
        throw error;
      }
      migrated.push(key);
      rows = repository
        ? repository.getAll(scope)
        : repos.entities.getAll(key, scope, { includeDeleted: false });
    }
    if (rows.some((row) => row.id === '__singleton__')) {
      repos.kv.delete(key);
      removedShadows.push(key);
    }
  }
  if (migrated.length || removedShadows.length) {
    db.prepare(`
      INSERT INTO meta(key, value) VALUES('setupSingletonAuthorityVersion', '1')
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `).run();
  }
  return { ok: true, migrated, removedShadows };
}

function hydrate(context = {}) {
  ensureDb();
  migrateSetupSingletonShadows();
  const authority = readAuthorityIdentity();
  const centerId = String(context.centerId || authority.centerId || '').trim();
  const branchId = String(context.branchId || '').trim();
  const aggregate = context.aggregate === true;
  const data = {};
  if (centerId) {
    const scope = { centerId, branchId: aggregate ? null : (branchId || authority.branchId || null) };
    if (scope.branchId || aggregate) {
      data.clientsRegistry = repos.clients.getAll(scope);
      data.cases = repos.visits.getAll(scope);
      data.bookings = repos.bookings.getAll(scope);
      data.doctors = repos.employees.getAll(scope);
      data.attendance = repos.attendance.getAll(scope);
      data.expenses = repos.expenses.getAll(scope);
      for (const key of catalog.BRANCH_ENTITY_KEYS) {
        const normalized = authoritativeRepository(key);
        data[key] = normalized
          ? normalized.getAll({ centerId, branchId: aggregate ? null : scope.branchId })
          : (aggregate
            ? repos.entities.getAllForCenter(key, centerId)
            : repos.entities.getAll(key, { centerId, branchId: scope.branchId }));
      }
    }
    for (const key of catalog.ORGANIZATION_ENTITY_KEYS) {
      const normalized = authoritativeRepository(key);
      const rows = normalized
        ? normalized.getAll({ centerId, branchId: '__ORG__' })
        : repos.entities.getAll(key, { centerId, branchId: '__ORG__' });
      data[key] = unwrapEntityValue(key, rows);
    }
  }
  // Legacy operational KV may remain only as rollback material during migration.
  // It must never shadow normalized/entity authority during hydration.
  const legacyKv = repos.kv.exportAll();
  for (const [key, value] of Object.entries(legacyKv)) {
    if (catalog.classifyKey(key).kind === 'kv') data[key] = value;
  }
  return { ok: true, data, revision: currentRevision(centerId, branchId), status: getStatus(context) };
}

function currentRevision(centerId, branchId) {
  ensureDb();
  const row = db.prepare(`
    SELECT COALESCE(MAX(new_revision), 0) AS revision
    FROM sync_outbox
    WHERE (@centerId='' OR center_id=@centerId)
      AND (@branchId='' OR branch_id=@branchId)
  `).get({ centerId: centerId || '', branchId: branchId || '' });
  return Number(row?.revision) || 0;
}

function listUsersForAuthentication() {
  ensureDb();
  const authority = readAuthorityIdentity();
  if (!authority.centerId) {
    const legacy = repos.kv.get('users', []);
    return Array.isArray(legacy) ? legacy : [];
  }
  return repos.users
    ? repos.users.getAll({ centerId: authority.centerId, branchId: '__ORG__' })
    : repos.forEntity('users').getAll({ centerId: authority.centerId, branchId: '__ORG__' });
}

function hydratePreauth() {
  ensureDb();
  migrateSetupSingletonShadows();
  const authority = readAuthorityIdentity();
  const users = listUsersForAuthentication().map((user) => ({
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    active: user.active,
    branchScope: user.branchScope,
    canSwitchBranch: user.canSwitchBranch,
    mustChangePassword: user.mustChangePassword,
    seedDefaultPassword: user.seedDefaultPassword,
    credentialRevision: Number(user.credentialRevision) || 0,
    hasUsableCredential: user.active !== false
      && user.mustChangePassword !== true
      && user.seedDefaultPassword !== true
      && /^(?:pbkdf2:|pbkdf2v2:|b64:)/.test(String(user.password || '')),
    centerId: user.centerId || user.center_id || null,
  }));
  const data = { users };
  for (const key of [
    '__tdw_cloud_license__', '__tdw_meta__', '__tdw_device_config__',
    'commercial_license_data_v2',
  ]) {
    const value = repos.kv.get(key, undefined);
    if (value !== undefined) data[key] = value;
  }
  if (authority.centerId) {
    for (const key of ['__tdw_owner_setup__', '__tdw_device_registry__']) {
      const repository = authoritativeRepository(key);
      const rows = repository
        ? repository.getAll({ centerId: authority.centerId, branchId: '__ORG__' })
        : repos.entities.getAll(key, { centerId: authority.centerId, branchId: '__ORG__' });
      if (rows.length) data[key] = unwrapEntityValue(key, rows);
    }
  }
  return {
    ok: true,
    preauth: true,
    data,
    revision: currentRevision(authority.centerId, authority.branchId),
    status: getStatus(),
  };
}

function buildOutboxEntry(entity, record, action, baseRevision, newRevision, scope, request) {
  const operation = action === 'delete' ? 'DELETE' : (baseRevision > 0 ? 'UPDATE' : 'CREATE');
  return {
    event_id: request.operationId || crypto.randomUUID(),
    idempotency_key: `${request.commandId}:${entity}:${record.id}:${operation}:${newRevision}`,
    center_id: scope.centerId,
    branch_id: scope.branchId,
    table_name: entity,
    record_id: String(record.id),
    operation,
    base_revision: baseRevision,
    new_revision: newRevision,
    device_id: scope.deviceId,
    actor_id: scope.actorId,
    payload_json: JSON.stringify(record),
    created_at: request.timestamp || new Date().toISOString(),
  };
}

function command(request, context = {}) {
  ensureDb();
  const req = request || {};
  const commandId = String(req.commandId || '').trim();
  const entity = String(req.entity || '').trim();
  const action = String(req.action || '').trim();
  if (!commandId) return { ok: false, error: 'command_id_required', rolledBack: true };
  if (!entity || !catalog.OPERATIONAL_SET.has(entity)) {
    return { ok: false, error: 'operational_entity_not_allowed', rolledBack: true };
  }
  if (!['upsert', 'upsertMany', 'replaceAll', 'delete'].includes(action)) {
    return { ok: false, error: 'command_action_not_allowed', rolledBack: true };
  }
  const existingCommand = db.prepare('SELECT result_json FROM p0b_commands WHERE command_id=?').get(commandId);
  if (existingCommand) return { ...parseJson(existingCommand.result_json, {}), replayed: true };

  const classification = catalog.classifyKey(entity);
  let scope;
  try {
    scope = normalizeContext(context, {
      organizationScoped: classification.branchOwned === false,
      branchRequired: classification.branchOwned === true,
    });
  } catch (error) {
    return { ok: false, error: error.code || error.message, rolledBack: true };
  }
  const records = (action === 'upsertMany' || action === 'replaceAll')
    ? (Array.isArray(req.records) ? req.records : [])
    : [action === 'delete' ? { id: req.entityId } : req.record];
  if ((action !== 'replaceAll' && !records.length) || records.some((record) => !record?.id)) {
    return { ok: false, error: 'command_records_required', rolledBack: true };
  }

  try {
    const result = db.transaction(() => {
      const events = [];
      const committedRecords = [];
      const normalized = authoritativeRepository(entity);
      const recordScope = { centerId: scope.centerId, branchId: scope.branchId };
      const existingBeforeReplace = action === 'replaceAll'
        ? (normalized
          ? normalized.getAll(recordScope)
          : repos.entities.getAll(entity, recordScope, { includeDeleted: false }))
        : [];
      for (const input of records) {
        const previous = normalized
          ? normalized.getById(input.id, recordScope)
          : repos.entities.getAll(entity, recordScope, { includeDeleted: true }).find((row) => String(row.id) === String(input.id));
        const baseRevision = Number(previous?.revision) || 0;
        if (!context.trusted && previous?.financialStatus === 'posted'
          && ['cases', 'invoices', 'payments', 'financialPostings', 'cashMovements'].includes(entity)) {
          throw Object.assign(new Error('financial_record_immutable_use_reversal'), {
            code: 'financial_record_immutable_use_reversal',
          });
        }
        const newRevision = baseRevision + 1;
        const stamped = {
          ...(previous || {}),
          ...(input || {}),
          id: String(input.id),
          centerId: scope.centerId,
          branchId: scope.branchId,
          revision: newRevision,
          updatedAt: req.timestamp || new Date().toISOString(),
        };
        let committed;
        if (action === 'delete') {
          stamped.deletedAt = stamped.updatedAt;
          if (normalized) {
            normalized.deleteById(stamped.id, recordScope);
            committed = stamped;
          } else {
            committed = repos.entities.tombstone(entity, stamped.id, recordScope).record || stamped;
          }
        } else if (normalized) {
          committed = normalized.upsert(stamped, recordScope);
        } else {
          committed = repos.entities.upsert(entity, stamped, {
            ...recordScope,
            organizationScoped: classification.branchOwned === false,
          }).record;
        }
        const outbox = buildOutboxEntry(entity, committed, action, baseRevision, newRevision, scope, req);
        events.push(syncPlatform.enqueue(outbox));
        if (action === 'delete') writeSyncTombstone(outbox);
        committedRecords.push(committed);
      }
      if (action === 'replaceAll') {
        const retainedIds = new Set(records.map((record) => String(record.id)));
        for (const previous of existingBeforeReplace) {
          if (retainedIds.has(String(previous.id))) continue;
          const baseRevision = Number(previous.revision) || 0;
          const deleted = {
            ...previous,
            id: String(previous.id),
            centerId: scope.centerId,
            branchId: scope.branchId,
            revision: baseRevision + 1,
            updatedAt: req.timestamp || new Date().toISOString(),
            deletedAt: req.timestamp || new Date().toISOString(),
          };
          if (normalized) normalized.deleteById(deleted.id, recordScope);
          else repos.entities.tombstone(entity, deleted.id, {
            ...recordScope,
            organizationScoped: classification.branchOwned === false,
          });
          const outbox = buildOutboxEntry(entity, deleted, 'delete', baseRevision, baseRevision + 1, scope, req);
          events.push(syncPlatform.enqueue(outbox));
          writeSyncTombstone(outbox);
          committedRecords.push(deleted);
        }
      }
      const committedAt = new Date().toISOString();
      const output = {
        ok: true,
        commandId,
        entity,
        action,
        count: committedRecords.length,
        replaced: action === 'replaceAll',
        records: committedRecords,
        events,
        revision: Math.max(...committedRecords.map((record) => Number(record.revision) || 0)),
        committedAt,
        authoritative: true,
      };
      db.prepare(`
        INSERT INTO p0b_commands(command_id, center_id, branch_id, entity_type, result_json, committed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(commandId, scope.centerId, scope.branchId, entity, JSON.stringify(output), committedAt);
      return output;
    })();
    return result;
  } catch (error) {
    return {
      ok: false,
      commandId,
      entity,
      action,
      error: error.code || 'command_failed',
      message: error.message,
      rolledBack: true,
    };
  }
}

function moneyMinor(value, field) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) {
    throw Object.assign(new Error(`${field}_invalid`), { code: 'financial_amount_invalid' });
  }
  return Math.round((number + Number.EPSILON) * 100);
}

function assertFinancialPayment(caseRecord) {
  const total = moneyMinor(caseRecord.total, 'total');
  const cash = moneyMinor(caseRecord.cash, 'cash');
  const card = moneyMinor(caseRecord.card, 'card');
  const foreign = moneyMinor(caseRecord.foreignSarEquiv, 'foreign_sar_equiv');
  const change = moneyMinor(caseRecord.changeReturned, 'change_returned');
  const received = cash + card + foreign;
  if (change > received) throw Object.assign(new Error('change_exceeds_received'), { code: 'payment_not_reconciled' });
  const net = received - change;
  if (Math.abs(net - total) > 1) {
    throw Object.assign(new Error(`payment_not_reconciled:${net}:${total}`), { code: 'payment_not_reconciled' });
  }
  return { total, cash, card, foreign, change, net };
}

function allocateInvoiceNumber(scope, dateValue) {
  const date = new Date(dateValue || Date.now());
  const year = Number.isFinite(date.getTime()) ? date.getFullYear() : new Date().getFullYear();
  const deviceTag = crypto.createHash('sha256').update(scope.deviceId).digest('hex').slice(0, 4).toUpperCase();
  const existing = db.prepare(`
    SELECT next_value FROM invoice_sequences
    WHERE center_id=? AND branch_id=? AND year=? AND device_id=?
  `).get(scope.centerId, scope.branchId, year, scope.deviceId);
  const sequence = Math.max(1, Number(existing?.next_value) || 1);
  db.prepare(`
    INSERT INTO invoice_sequences(center_id, branch_id, year, device_id, next_value, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(center_id, branch_id, year, device_id) DO UPDATE SET
      next_value=excluded.next_value, updated_at=excluded.updated_at
  `).run(scope.centerId, scope.branchId, year, scope.deviceId, sequence + 1, new Date().toISOString());
  return `TM-${year}-${String(sequence).padStart(6, '0')}-${deviceTag}`;
}

function assertCommandResult(result) {
  if (!result?.ok) throw Object.assign(new Error(result?.message || result?.error || 'financial_subcommand_failed'), {
    code: result?.error || 'financial_subcommand_failed',
  });
  return result;
}

/** One transaction for case, invoice, payments, stock/cash effects, audit, ledger and outbox. */
function commitFinancialCase(request, context = {}) {
  ensureDb();
  const req = request && typeof request === 'object' ? request : {};
  const transactionId = String(req.transactionId || '').trim();
  if (!/^[A-Za-z0-9_.:-]{8,200}$/.test(transactionId)) return { ok: false, error: 'transaction_id_invalid', rolledBack: true };
  let scope;
  try { scope = normalizeContext(context, { branchRequired: true }); }
  catch (error) { return { ok: false, error: error.code || error.message, rolledBack: true }; }
  const replay = db.prepare('SELECT payload_json FROM financial_transactions WHERE transaction_id=?').get(transactionId);
  if (replay) return { ...parseJson(replay.payload_json, {}), replayed: true };
  const input = req.caseRecord && typeof req.caseRecord === 'object' ? req.caseRecord : null;
  if (!input?.id) return { ok: false, error: 'case_record_required', rolledBack: true };
  const caseId = String(input.id);
  const relatedInputs = Array.isArray(req.relatedCaseRecords) ? req.relatedCaseRecords : [];
  if (relatedInputs.some((record) => !record?.id || String(record.id) === caseId)) {
    return { ok: false, error: 'related_case_records_invalid', rolledBack: true };
  }
  const alreadyPosted = db.prepare(`
    SELECT transaction_id FROM financial_transactions
    WHERE center_id=? AND branch_id=? AND case_id=? AND status='posted'
  `).get(scope.centerId, scope.branchId, caseId);
  if (alreadyPosted) return { ok: false, error: 'financial_record_immutable_use_reversal', rolledBack: true };

  try {
    return db.transaction(() => {
      const payment = assertFinancialPayment(input);
      const invoiceNumber = allocateInvoiceNumber(scope, input.date || input.createdAt);
      const now = req.timestamp || new Date().toISOString();
      const caseRecord = {
        ...input,
        id: caseId,
        invoice: invoiceNumber,
        centerId: scope.centerId,
        branchId: scope.branchId,
        financialStatus: 'posted',
        financialTransactionId: transactionId,
      };
      const relatedCaseRecords = relatedInputs.map((record) => ({
        ...record,
        id: String(record.id),
        invoice: invoiceNumber,
        centerId: scope.centerId,
        branchId: scope.branchId,
        financialStatus: 'posted',
        financialTransactionId: transactionId,
      }));
      const financialScope = { ...scope, trusted: true };
      let step = 0;
      const failpoint = () => {
        step += 1;
        if (context.trusted === true && Number(context.failAfterStep) === step) throw new Error(`injected_financial_failure_${step}`);
      };

      assertCommandResult(command({
        commandId: `${transactionId}:case`, entity: 'cases', action: 'upsert', record: caseRecord, timestamp: now,
      }, financialScope));
      if (relatedCaseRecords.length) assertCommandResult(command({
        commandId: `${transactionId}:related-cases`, entity: 'cases', action: 'upsertMany',
        records: relatedCaseRecords, timestamp: now,
      }, financialScope));
      failpoint();
      const invoice = {
        id: `INV:${caseId}`, visitId: caseId,
        visitIds: [caseId, ...relatedCaseRecords.map((record) => record.id)], invoiceNumber,
        total: payment.total / 100, preTax: Number(caseRecord.preTax) || 0,
        vat: Number(caseRecord.vat) || 0, status: 'posted', createdAt: now,
      };
      assertCommandResult(command({
        commandId: `${transactionId}:invoice`, entity: 'invoices', action: 'upsert', record: invoice, timestamp: now,
      }, financialScope));
      failpoint();

      const paymentRecords = [];
      const pushPayment = (method, minor, extra = {}) => {
        if (minor <= 0) return;
        paymentRecords.push({
          id: `PAY:${caseId}:${method}`, invoiceId: invoice.id, visitId: caseId,
          method, amount: minor / 100, direction: method === 'change' ? 'out' : 'in',
          status: 'posted', createdAt: now, ...extra,
        });
      };
      pushPayment('cash', payment.cash);
      pushPayment('card', payment.card, { cardType: caseRecord.cardType || null });
      pushPayment('foreign', payment.foreign, {
        foreignAmount: Number(caseRecord.foreignAmount) || 0,
        foreignCurrency: caseRecord.payCurrency || null,
      });
      pushPayment('change', payment.change);
      if (paymentRecords.length) assertCommandResult(command({
        commandId: `${transactionId}:payments`, entity: 'payments', action: 'upsertMany', records: paymentRecords, timestamp: now,
      }, financialScope));
      failpoint();

      const posting = {
        id: `POST:${caseId}`, caseId, invoiceId: invoice.id, invoiceNumber,
        total: payment.total / 100, cash: payment.cash / 100, card: payment.card / 100,
        foreignSarEquiv: payment.foreign / 100, change: payment.change / 100,
        vat: Number(caseRecord.vat) || 0, commission: Number(caseRecord.commission) || 0,
        status: 'posted', postedAt: now,
      };
      assertCommandResult(command({
        commandId: `${transactionId}:posting`, entity: 'financialPostings', action: 'upsert', record: posting, timestamp: now,
      }, financialScope));
      const cashMovements = paymentRecords.map((row) => ({
        id: `CASH:${caseId}:${row.method}`, caseId, invoiceNumber, method: row.method,
        amount: row.direction === 'out' ? -row.amount : row.amount,
        foreignAmount: row.foreignAmount || 0, foreignCurrency: row.foreignCurrency || null,
        status: 'posted', createdAt: now,
      }));
      if (cashMovements.length) assertCommandResult(command({
        commandId: `${transactionId}:cash`, entity: 'cashMovements', action: 'upsertMany', records: cashMovements, timestamp: now,
      }, financialScope));
      failpoint();

      const effects = Array.isArray(req.effects) ? req.effects : [];
      const allowedEffects = new Set(['inventoryItems', 'inventoryMovements', 'cashDrawerSession']);
      for (const effect of effects) {
        const entity = String(effect?.entity || '');
        if (!allowedEffects.has(entity)) throw new Error('financial_effect_not_allowed');
        const records = Array.isArray(effect.records) ? effect.records : [];
        if (!records.length) continue;
        assertCommandResult(command({
          commandId: `${transactionId}:effect:${entity}`, entity, action: 'upsertMany', records, timestamp: now,
        }, financialScope));
      }
      failpoint();

      for (const commissionCase of [caseRecord, ...relatedCaseRecords]) {
        if (!(Number(commissionCase.commission) > 0 && commissionCase.doctorId)) continue;
        assertCommandResult(command({
          commandId: `${transactionId}:ledger:${commissionCase.id}`, entity: 'employeeLedgerEntries', action: 'upsert',
          record: {
            id: `LEDGER:CASE:${commissionCase.id}`, sourceType: 'case', sourceId: commissionCase.id,
            doctorId: commissionCase.doctorId, date: commissionCase.date,
            amount: Number(commissionCase.commission), status: 'accrued', createdAt: now,
          }, timestamp: now,
        }, financialScope));
      }
      assertCommandResult(command({
        commandId: `${transactionId}:audit`, entity: 'auditEvents', action: 'upsert',
        record: {
          id: `AUDIT:${transactionId}`, action: 'FINANCIAL_CASE_POSTED', entity: 'cases',
          entityId: caseId, invoiceNumber, total: payment.total / 100,
          actorId: scope.actorId, deviceId: scope.deviceId, createdAt: now,
        }, timestamp: now,
      }, financialScope));
      failpoint();

      const output = {
        ok: true, transactionId, caseId, invoiceNumber, caseRecord,
        invoice, payments: paymentRecords, posting, relatedCaseRecords,
        appliedEffects: JSON.parse(JSON.stringify(effects)), effectsApplied: effects.length,
        committedAt: now, authoritative: true,
      };
      db.prepare(`
        INSERT INTO financial_transactions(
          transaction_id, center_id, branch_id, case_id, invoice_number,
          total_minor, payment_minor, status, payload_json, committed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?)
      `).run(
        transactionId, scope.centerId, scope.branchId, caseId, invoiceNumber,
        payment.total, payment.net, JSON.stringify(output), now
      );
      return output;
    })();
  } catch (error) {
    return {
      ok: false, transactionId, caseId,
      error: error.code || error.message || 'financial_commit_failed',
      message: error.message,
      rolledBack: true,
    };
  }
}

/** Authorized, append-only reversal. Posted records are retained and marked voided. */
function voidFinancialCase(request, context = {}) {
  ensureDb();
  const req = request && typeof request === 'object' ? request : {};
  const reversalId = String(req.reversalId || '').trim();
  const caseId = String(req.caseId || '').trim();
  const reason = String(req.reason || '').trim();
  if (!/^[A-Za-z0-9_.:-]{8,200}$/.test(reversalId)) return { ok: false, error: 'reversal_id_invalid', rolledBack: true };
  if (!caseId || reason.length < 3) return { ok: false, error: 'reversal_case_and_reason_required', rolledBack: true };
  let scope;
  try { scope = normalizeContext(context, { branchRequired: true }); }
  catch (error) { return { ok: false, error: error.code || error.message, rolledBack: true }; }

  const replay = db.prepare('SELECT payload_json FROM financial_reversals WHERE reversal_id=?').get(reversalId);
  if (replay) return { ...parseJson(replay.payload_json, {}), replayed: true };
  const original = db.prepare(`
    SELECT * FROM financial_transactions
    WHERE center_id=? AND branch_id=? AND case_id=?
  `).get(scope.centerId, scope.branchId, caseId);
  if (!original) return { ok: false, error: 'posted_financial_transaction_not_found', rolledBack: true };
  const priorReversal = db.prepare('SELECT payload_json FROM financial_reversals WHERE original_transaction_id=?')
    .get(original.transaction_id);
  if (priorReversal) return { ...parseJson(priorReversal.payload_json, {}), alreadyVoided: true };
  if (original.status !== 'posted') return { ok: false, error: 'financial_transaction_not_posted', rolledBack: true };

  try {
    return db.transaction(() => {
      const posted = parseJson(original.payload_json, {});
      const now = req.timestamp || new Date().toISOString();
      const financialScope = { ...scope, trusted: true };
      const caseRecords = [posted.caseRecord, ...(posted.relatedCaseRecords || [])].filter(Boolean);
      const voidedCases = caseRecords.map((record) => ({
        ...record,
        financialStatus: 'voided',
        voidedAt: now,
        voidReason: reason,
        reversalId,
      }));
      assertCommandResult(command({
        commandId: `${reversalId}:cases`, entity: 'cases', action: 'upsertMany', records: voidedCases, timestamp: now,
      }, financialScope));

      assertCommandResult(command({
        commandId: `${reversalId}:invoice`, entity: 'invoices', action: 'upsert',
        record: { ...posted.invoice, status: 'voided', voidedAt: now, voidReason: reason, reversalId }, timestamp: now,
      }, financialScope));
      if (Array.isArray(posted.payments) && posted.payments.length) assertCommandResult(command({
        commandId: `${reversalId}:payments`, entity: 'payments', action: 'upsertMany',
        records: posted.payments.map((row) => ({ ...row, status: 'voided', voidedAt: now, reversalId })), timestamp: now,
      }, financialScope));

      const reversalPosting = {
        ...posted.posting,
        id: `REVPOST:${caseId}:${reversalId}`,
        total: -Number(posted.posting?.total || 0),
        cash: -Number(posted.posting?.cash || 0),
        card: -Number(posted.posting?.card || 0),
        foreignSarEquiv: -Number(posted.posting?.foreignSarEquiv || 0),
        change: -Number(posted.posting?.change || 0),
        vat: -Number(posted.posting?.vat || 0),
        commission: -Number(posted.posting?.commission || 0),
        status: 'reversal', originalPostingId: posted.posting?.id, reversalId, postedAt: now, reason,
      };
      assertCommandResult(command({
        commandId: `${reversalId}:posting`, entity: 'financialPostings', action: 'upsert',
        record: reversalPosting, timestamp: now,
      }, financialScope));

      const reversalCash = (posted.payments || []).map((row) => {
        const signed = row.direction === 'out' ? -Number(row.amount || 0) : Number(row.amount || 0);
        return {
          id: `REVCASH:${caseId}:${row.method}:${reversalId}`, caseId, invoiceNumber: posted.invoiceNumber,
          method: row.method, amount: -signed, status: 'reversal', originalPaymentId: row.id,
          reversalId, reason, createdAt: now,
        };
      });
      if (reversalCash.length) assertCommandResult(command({
        commandId: `${reversalId}:cash`, entity: 'cashMovements', action: 'upsertMany', records: reversalCash, timestamp: now,
      }, financialScope));

      let reversedCashDrawerSession = null;
      const financialRecordScope = { centerId: scope.centerId, branchId: scope.branchId };
      const readFinancialEntity = (entity, id) => {
        const normalized = authoritativeRepository(entity);
        if (normalized) return normalized.getById(id, financialRecordScope);
        return repos.entities.getAll(entity, financialRecordScope, { includeDeleted: false })
          .find((row) => String(row.id) === String(id)) || null;
      };
      const currentCashDrawer = readFinancialEntity('cashDrawerSession', '__singleton__');
      if (currentCashDrawer) {
        const movements = Array.isArray(currentCashDrawer.movements) ? currentCashDrawer.movements.slice() : [];
        for (const row of reversalCash.filter((item) => item.method === 'cash' || item.method === 'change')) {
          movements.unshift({
            id: `DRAWER:${row.id}`, at: now, amount: row.amount,
            reason: 'financial_case_reversal', meta: { caseId, reversalId, type: 'reversal' },
          });
        }
        const foreign = { ...(currentCashDrawer.foreign || {}) };
        const originalCase = posted.caseRecord || {};
        if (Number(originalCase.foreignAmount) > 0 && originalCase.payCurrency && originalCase.payCurrency !== 'SAR') {
          foreign[originalCase.payCurrency] = Number(foreign[originalCase.payCurrency] || 0) - Number(originalCase.foreignAmount);
        }
        reversedCashDrawerSession = { ...currentCashDrawer, movements, foreign };
        assertCommandResult(command({
          commandId: `${reversalId}:cash-drawer`, entity: 'cashDrawerSession', action: 'upsert',
          record: reversedCashDrawerSession, timestamp: now,
        }, financialScope));
      }

      const originalMovements = (posted.appliedEffects || [])
        .find((effect) => effect?.entity === 'inventoryMovements')?.records || [];
      const reversalItems = [];
      const reversalMovements = [];
      for (const movement of originalMovements) {
        const current = readFinancialEntity('inventoryItems', movement.itemId);
        if (!current) continue;
        const delta = -Number(movement.delta || 0);
        const updated = { ...current, stockPieces: Number(current.stockPieces || 0) + delta };
        reversalItems.push(updated);
        reversalMovements.push({
          id: `REVMOVE:${movement.id}:${reversalId}`, itemId: movement.itemId, itemName: movement.itemName,
          delta, balance: updated.stockPieces, reason: 'financial_case_reversal', refId: caseId,
          reversalId, createdAt: now,
        });
      }
      if (reversalItems.length) assertCommandResult(command({
        commandId: `${reversalId}:inventory-items`, entity: 'inventoryItems', action: 'upsertMany', records: reversalItems, timestamp: now,
      }, financialScope));
      if (reversalMovements.length) assertCommandResult(command({
        commandId: `${reversalId}:inventory-movements`, entity: 'inventoryMovements', action: 'upsertMany', records: reversalMovements, timestamp: now,
      }, financialScope));

      for (const record of caseRecords) {
        if (!(Number(record.commission) > 0 && record.doctorId)) continue;
        assertCommandResult(command({
          commandId: `${reversalId}:ledger:${record.id}`, entity: 'employeeLedgerEntries', action: 'upsert',
          record: {
            id: `LEDGER:REV:${record.id}:${reversalId}`, sourceType: 'case_reversal', sourceId: record.id,
            doctorId: record.doctorId, date: record.date, amount: -Number(record.commission),
            status: 'adjustment', reason, reversalId, createdAt: now,
          }, timestamp: now,
        }, financialScope));
      }
      assertCommandResult(command({
        commandId: `${reversalId}:audit`, entity: 'auditEvents', action: 'upsert',
        record: {
          id: `AUDIT:${reversalId}`, action: 'FINANCIAL_CASE_VOIDED', entity: 'cases', entityId: caseId,
          invoiceNumber: posted.invoiceNumber, originalTransactionId: original.transaction_id,
          reversalId, reason, actorId: scope.actorId, deviceId: scope.deviceId, createdAt: now,
        }, timestamp: now,
      }, financialScope));

      const output = {
        ok: true, reversalId, originalTransactionId: original.transaction_id, caseId,
        invoiceNumber: posted.invoiceNumber, voidedCases, reversalPosting, reversalCash,
        inventoryReversals: reversalMovements, cashDrawerSession: reversedCashDrawerSession,
        reason, reversedAt: now, authoritative: true,
      };
      db.prepare("UPDATE financial_transactions SET status='voided', payload_json=? WHERE transaction_id=?")
        .run(JSON.stringify({ ...posted, voidedAt: now, voidReason: reason, reversalId }), original.transaction_id);
      db.prepare(`
        INSERT INTO financial_reversals(
          reversal_id, original_transaction_id, center_id, branch_id, case_id,
          reason, payload_json, reversed_at, actor_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reversalId, original.transaction_id, scope.centerId, scope.branchId, caseId,
        reason, JSON.stringify(output), now, scope.actorId,
      );
      return output;
    })();
  } catch (error) {
    return { ok: false, reversalId, caseId, error: error.code || error.message || 'financial_reversal_failed', rolledBack: true };
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}

function payrollMoneyMinor(value, field) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) throw Object.assign(new Error(`${field}_invalid`), { code: 'payroll_amount_invalid' });
  return Math.round((number + Number.EPSILON) * 100);
}

function finalizePayrollRun(request, context = {}) {
  ensureDb();
  const req = request && typeof request === 'object' ? request : {};
  const runId = String(req.runId || '').trim();
  const periodKey = String(req.periodKey || '').trim();
  const rows = Array.isArray(req.rows) ? req.rows : [];
  if (!/^[A-Za-z0-9_.:-]{8,200}$/.test(runId) || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(periodKey)) {
    return { ok: false, error: 'payroll_run_identity_invalid', rolledBack: true };
  }
  if (!rows.length || rows.length > 5000) return { ok: false, error: 'payroll_rows_required', rolledBack: true };
  let scope;
  try { scope = normalizeContext(context, { branchRequired: true }); }
  catch (error) { return { ok: false, error: error.code || error.message, rolledBack: true }; }

  try {
    const normalizedRows = rows.map((row) => {
      const employeeId = String(row?.employeeId || row?.doctorId || '').trim();
      if (!employeeId) throw Object.assign(new Error('payroll_employee_required'), { code: 'payroll_employee_required' });
      const grossMinor = payrollMoneyMinor(row.gross, 'gross');
      const deductionsMinor = payrollMoneyMinor(row.deductions, 'deductions');
      const netMinor = payrollMoneyMinor(row.net, 'net');
      if (grossMinor < 0 || deductionsMinor < 0 || Math.abs((grossMinor - deductionsMinor) - netMinor) > 1) {
        throw Object.assign(new Error('payroll_row_not_reconciled'), { code: 'payroll_row_not_reconciled' });
      }
      return {
        employeeId, employeeName: String(row.employeeName || row.doctorName || ''),
        grossMinor, deductionsMinor, netMinor,
        sourceRevision: Number(row.sourceRevision) || 0,
      };
    }).sort((a, b) => a.employeeId.localeCompare(b.employeeId));
    if (new Set(normalizedRows.map((row) => row.employeeId)).size !== normalizedRows.length) {
      return { ok: false, error: 'payroll_duplicate_employee', rolledBack: true };
    }
    const hashBody = { centerId: scope.centerId, branchId: scope.branchId, periodKey, rows: normalizedRows };
    const calculationHash = crypto.createHash('sha256').update(canonicalJson(hashBody), 'utf8').digest('hex');
    const existing = db.prepare(`
      SELECT * FROM payroll_run_control WHERE center_id=? AND branch_id=? AND period_key=?
    `).get(scope.centerId, scope.branchId, periodKey);
    if (existing) {
      if (existing.calculation_hash === calculationHash && existing.status === 'finalized') {
        return { ...parseJson(existing.payload_json, {}), replayed: true };
      }
      return { ok: false, error: 'payroll_period_finalized_immutable', rolledBack: true };
    }
    const now = req.timestamp || new Date().toISOString();
    const totals = normalizedRows.reduce((sum, row) => ({
      grossMinor: sum.grossMinor + row.grossMinor,
      deductionsMinor: sum.deductionsMinor + row.deductionsMinor,
      netMinor: sum.netMinor + row.netMinor,
    }), { grossMinor: 0, deductionsMinor: 0, netMinor: 0 });
    const output = {
      ok: true, runId, periodKey, status: 'finalized', calculationHash,
      rows: normalizedRows, totals, finalizedAt: now, finalizedBy: scope.actorId, authoritative: true,
    };
    return db.transaction(() => {
      db.prepare(`
        INSERT INTO payroll_run_control(
          center_id, branch_id, period_key, run_id, status, calculation_hash, payload_json, finalized_at
        ) VALUES (?, ?, ?, ?, 'finalized', ?, ?, ?)
      `).run(scope.centerId, scope.branchId, periodKey, runId, calculationHash, JSON.stringify(output), now);
      const financialScope = { ...scope, trusted: true };
      assertCommandResult(command({
        commandId: `${runId}:run`, entity: 'payrollRuns', action: 'upsert',
        record: { id: runId, ...output }, timestamp: now,
      }, financialScope));
      for (const row of normalizedRows) {
        assertCommandResult(command({
          commandId: `${runId}:ledger:${row.employeeId}`, entity: 'employeeLedgerEntries', action: 'upsert',
          record: {
            id: `LEDGER:PAYROLL:${runId}:${row.employeeId}`, sourceType: 'payroll_finalization',
            sourceId: runId, doctorId: row.employeeId, periodKey, amount: row.netMinor / 100,
            status: 'finalized', calculationHash, createdAt: now,
          }, timestamp: now,
        }, financialScope));
      }
      return output;
    })();
  } catch (error) {
    return { ok: false, runId, periodKey, error: error.code || error.message || 'payroll_finalize_failed', rolledBack: true };
  }
}

function adjustFinalizedPayroll(request, context = {}) {
  ensureDb();
  const req = request && typeof request === 'object' ? request : {};
  const adjustmentId = String(req.adjustmentId || '').trim();
  const runId = String(req.runId || '').trim();
  const employeeId = String(req.employeeId || '').trim();
  const reason = String(req.reason || '').trim();
  if (!/^[A-Za-z0-9_.:-]{8,200}$/.test(adjustmentId) || !runId || !employeeId || reason.length < 3) {
    return { ok: false, error: 'payroll_adjustment_invalid', rolledBack: true };
  }
  let scope;
  try { scope = normalizeContext(context, { branchRequired: true }); }
  catch (error) { return { ok: false, error: error.code || error.message, rolledBack: true }; }
  try {
    const amountMinor = payrollMoneyMinor(req.amount, 'amount');
    if (amountMinor === 0) return { ok: false, error: 'payroll_adjustment_zero', rolledBack: true };
    const run = db.prepare(`
      SELECT * FROM payroll_run_control WHERE run_id=? AND center_id=? AND branch_id=? AND status='finalized'
    `).get(runId, scope.centerId, scope.branchId);
    if (!run) return { ok: false, error: 'finalized_payroll_run_not_found', rolledBack: true };
    const existing = db.prepare('SELECT payload_json FROM payroll_adjustments WHERE adjustment_id=?').get(adjustmentId);
    if (existing) return { ...parseJson(existing.payload_json, {}), replayed: true };
    const now = req.timestamp || new Date().toISOString();
    const output = {
      ok: true, adjustmentId, runId, employeeId, amountMinor, amount: amountMinor / 100,
      reason, createdAt: now, createdBy: scope.actorId, authoritative: true,
    };
    return db.transaction(() => {
      db.prepare(`
        INSERT INTO payroll_adjustments(
          adjustment_id, center_id, branch_id, run_id, employee_id,
          amount_minor, reason, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        adjustmentId, scope.centerId, scope.branchId, runId, employeeId,
        amountMinor, reason, JSON.stringify(output), now,
      );
      const financialScope = { ...scope, trusted: true };
      assertCommandResult(command({
        commandId: `${adjustmentId}:adjustment`, entity: 'payrollAdjustments', action: 'upsert',
        record: { id: adjustmentId, ...output }, timestamp: now,
      }, financialScope));
      assertCommandResult(command({
        commandId: `${adjustmentId}:ledger`, entity: 'employeeLedgerEntries', action: 'upsert',
        record: {
          id: `LEDGER:PAYROLL-ADJ:${adjustmentId}`, sourceType: 'payroll_adjustment', sourceId: adjustmentId,
          doctorId: employeeId, amount: amountMinor / 100, status: 'adjustment', reason, createdAt: now,
        }, timestamp: now,
      }, financialScope));
      return output;
    })();
  } catch (error) {
    return { ok: false, adjustmentId, runId, error: error.code || error.message || 'payroll_adjustment_failed', rolledBack: true };
  }
}

function replaceOrganizationUsers(users, context = {}) {
  const authority = readAuthorityIdentity();
  const centerId = context.centerId || authority.centerId || users?.find((user) => user?.centerId)?.centerId;
  return command({
    commandId: context.commandId || crypto.randomUUID(),
    entity: 'users',
    action: 'upsertMany',
    records: users,
  }, { ...context, centerId, branchId: '__ORG__', trusted: true });
}

function persistTable(tableKey, records, context = {}) {
  return command({
    commandId: context.commandId || crypto.randomUUID(),
    entity: tableKey,
    action: 'upsertMany',
    records,
  }, context);
}

function persistKv(key, value) {
  ensureDb();
  const classification = catalog.classifyKey(key);
  if (classification.kind !== 'kv') {
    return { ok: false, error: 'raw_kv_operational_write_denied', key: String(key) };
  }
  repos.kv.set(key, value);
  return { ok: true, key: String(key), authoritative: true };
}

function getStoredLicense() {
  ensureDb();
  return repos.kv.get('__tdw_cloud_license__', null);
}

function seedUsersIfEmpty(users, context = {}) {
  ensureDb();
  if (listUsersForAuthentication().length) return { ok: false, error: 'users_already_present' };
  if (!Array.isArray(users) || !users.length) return { ok: false, error: 'users_required' };
  const sanitized = users.map((user) => {
    const copy = { ...user };
    if (copy.password && !/^(?:pbkdf2:|pbkdf2v2:|b64:)/.test(String(copy.password))) delete copy.password;
    delete copy.plainPassword;
    delete copy.tempPassword;
    return copy;
  });
  return replaceOrganizationUsers(sanitized, context);
}

function enableSqlitePrimary() {
  ensureDb();
  db.prepare(`
    INSERT INTO meta(key, value) VALUES('sqlitePrimary', 'true')
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run();
  db.prepare(`
    INSERT INTO meta(key, value) VALUES('localStorageRetained', 'false')
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run();
  return getStatus();
}

function isBootstrapTargetEmpty() {
  ensureDb();
  const core = ['clients', 'visits', 'appointments', 'employees', 'attendance', 'expenses']
    .reduce((sum, table) => sum + db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c, 0);
  const entities = db.prepare('SELECT COUNT(*) AS c FROM p0b_entities').get().c;
  return core === 0 && entities === 0 && listUsersForAuthentication().length === 0;
}

function commitSetupActivation(payload = {}) {
  ensureDb();
  if (!isBootstrapTargetEmpty()) {
    return { ok: false, error: 'setup_activation_target_not_empty', rolledBack: true };
  }
  const license = payload.license;
  const legacyLicense = payload.legacyLicense;
  const centerId = String(license?.centerId || '').trim();
  if (!centerId || !license || typeof license !== 'object' || !legacyLicense || typeof legacyLicense !== 'object') {
    return { ok: false, error: 'setup_activation_payload_invalid', rolledBack: true };
  }
  try {
    const committedAt = new Date().toISOString();
    db.transaction(() => {
      const previousMeta = repos.kv.get('__tdw_meta__', {}) || {};
      repos.kv.set('__tdw_cloud_license__', license);
      repos.kv.set('__tdw_meta__', {
        ...previousMeta,
        schemaVersion: Math.max(Number(previousMeta.schemaVersion) || 0, 6),
        centerId,
        setupActivationCommittedAt: committedAt,
        setupLicenseRemotePath: String(payload.remotePath || ''),
        updatedAt: committedAt,
      });
      repos.kv.set('commercial_license_data_v2', legacyLicense);
      db.prepare(`
        INSERT INTO meta(key, value) VALUES('authorityCenterId', ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
      `).run(centerId);
      db.prepare(`
        INSERT INTO meta(key, value) VALUES('setupActivationCommittedAt', ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
      `).run(committedAt);
      db.prepare(`
        INSERT INTO meta(key, value) VALUES('setupLicenseRemotePath', ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
      `).run(String(payload.remotePath || ''));
    })();
    return {
      ...hydratePreauth(),
      committedAt,
      centerId,
      authoritative: true,
      setupActivation: true,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.code || 'setup_activation_commit_failed',
      message: error.message,
      rolledBack: true,
    };
  }
}

function getSetupLicenseRemotePath() {
  ensureDb();
  const row = db.prepare("SELECT value FROM meta WHERE key='setupLicenseRemotePath'").get();
  return String(row?.value || repos.kv.get('__tdw_meta__', {})?.setupLicenseRemotePath || '').trim();
}

function commitSetupOrganizationDevice(payload = {}) {
  ensureDb();
  const authority = readAuthorityIdentity();
  const centerId = String(authority.centerId || '').trim();
  const storedLicense = repos.kv.get('__tdw_cloud_license__', null);
  const license = payload.license;
  const centerName = String(payload.centerName || '').trim();
  const branchId = String(payload.branchId || '').trim();
  const deviceName = String(payload.deviceName || '').trim();
  if (!centerId || !storedLicense || !license || String(license.centerId || '') !== centerId) {
    return { ok: false, error: 'verified_setup_activation_required', rolledBack: true };
  }
  const storedId = String(storedLicense.licenseUuid || storedLicense.licenseId || '');
  const verifiedId = String(license.licenseUuid || license.licenseId || '');
  if (!storedId || storedId !== verifiedId) {
    return { ok: false, error: 'setup_license_identity_mismatch', rolledBack: true };
  }
  if (!centerName && !branchId) {
    return { ok: false, error: 'setup_organization_or_device_required', rolledBack: true };
  }
  let selectedBranch = null;
  if (branchId) {
    selectedBranch = (Array.isArray(license.branches) ? license.branches : [])
      .find((item) => item && item.active !== false && !item.pending && String(item.id) === branchId);
    if (!selectedBranch) return { ok: false, error: 'setup_branch_not_in_verified_license', rolledBack: true };
    if (!deviceName) return { ok: false, error: 'device_name_required', rolledBack: true };
  }
  try {
    const committedAt = new Date().toISOString();
    let nextSettings = null;
    let deviceConfig = null;
    let deviceRegistry = null;
    let deviceRegistryCommit = null;
    const commandBase = String(payload.commandId || crypto.randomUUID());
    if (selectedBranch) {
      const current = repos.kv.get('__tdw_device_config__', {}) || {};
      deviceConfig = {
        ...current,
        deviceUuid: String(current.deviceUuid || crypto.randomUUID()),
        deviceName,
        centerId,
        lockedBranchId: branchId,
        branchLocked: true,
        setupBoundAt: committedAt,
      };
      const registryRepo = authoritativeRepository('__tdw_device_registry__');
      const registryScope = { centerId, branchId: '__ORG__' };
      const registryRows = registryRepo
        ? registryRepo.getAll(registryScope)
        : repos.entities.getAll('__tdw_device_registry__', registryScope, { includeDeleted: false });
      const currentRegistry = unwrapEntityValue('__tdw_device_registry__', registryRows) || {};
      const registered = Array.isArray(currentRegistry.registered)
        ? currentRegistry.registered.slice()
        : (Array.isArray(license.devices?.registered) ? license.devices.registered.slice() : []);
      const existingIndex = registered.findIndex((item) => item
        && String(item.deviceUuid || '') === deviceConfig.deviceUuid);
      const activeCount = registered.filter((item) => item && item.active !== false).length;
      const maxDevicesRaw = license.limits?.maxDevices;
      const maxDevices = maxDevicesRaw == null || Number(maxDevicesRaw) === 0
        ? null
        : Math.max(1, Number(maxDevicesRaw) || 1);
      if (existingIndex < 0 && maxDevices != null && activeCount >= maxDevices) {
        return { ok: false, error: 'device_limit_reached', max: maxDevices, current: activeCount, rolledBack: true };
      }
      const previousDevice = existingIndex >= 0 ? registered[existingIndex] : null;
      const registeredDevice = {
        ...(previousDevice || {}),
        deviceUuid: deviceConfig.deviceUuid,
        deviceName,
        branchId,
        registeredAt: previousDevice?.registeredAt || committedAt,
        lastSeenAt: committedAt,
        status: 'approved',
        active: true,
      };
      if (existingIndex >= 0) registered[existingIndex] = registeredDevice;
      else registered.push(registeredDevice);
      deviceRegistry = {
        ...currentRegistry,
        schemaVersion: 1,
        registered,
        updatedAt: committedAt,
      };
    }
    db.transaction(() => {
      repos.kv.set('__tdw_cloud_license__', license);
      if (centerName) {
        const settingsRepo = repos.forEntity('settings');
        const existingRows = settingsRepo.getAll({ centerId, branchId: '__ORG__' });
        const currentSettings = unwrapEntityValue('settings', existingRows) || {};
        nextSettings = { ...currentSettings, centerName };
        const settingsCommit = command({
          commandId: `${commandBase}:settings`,
          entity: 'settings',
          action: 'upsert',
          record: { id: '__singleton__', value: nextSettings },
          timestamp: committedAt,
        }, { centerId, branchId: '__ORG__', actorId: 'setup', deviceId: 'setup', trusted: true });
        if (settingsCommit?.ok !== true) {
          const error = new Error(settingsCommit?.error || 'setup_settings_commit_failed');
          error.code = settingsCommit?.error || 'setup_settings_commit_failed';
          throw error;
        }
      }
      if (selectedBranch) {
        repos.kv.set('__tdw_device_config__', deviceConfig);
        deviceRegistryCommit = command({
          commandId: `${commandBase}:device-registry`,
          entity: '__tdw_device_registry__',
          action: 'upsert',
          record: { id: '__singleton__', value: deviceRegistry },
          timestamp: committedAt,
        }, { centerId, branchId: '__ORG__', actorId: 'setup', deviceId: deviceConfig.deviceUuid, trusted: true });
        if (deviceRegistryCommit?.ok !== true) {
          const error = new Error(deviceRegistryCommit?.error || 'setup_device_registry_commit_failed');
          error.code = deviceRegistryCommit?.error || 'setup_device_registry_commit_failed';
          throw error;
        }
      }
      db.prepare(`
        INSERT INTO meta(key, value) VALUES('setupOrganizationDeviceCommittedAt', ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
      `).run(committedAt);
    })();
    return {
      ...hydratePreauth(),
      setupOrganizationDevice: true,
      committedAt,
      centerId,
      centerName: centerName || null,
      branch: selectedBranch,
      deviceConfig,
      deviceRegistry,
      deviceRegistryCommit,
      settings: nextSettings,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.code || 'setup_organization_device_commit_failed',
      message: error.message,
      rolledBack: true,
    };
  }
}

function commitSetupOwner(payload = {}) {
  ensureDb();
  const authority = readAuthorityIdentity();
  const centerId = String(authority.centerId || '').trim();
  const license = repos.kv.get('__tdw_cloud_license__', null);
  const user = payload.user;
  const ownerProfile = payload.ownerProfile;
  if (!centerId || !license || String(license.centerId || '') !== centerId) {
    return { ok: false, error: 'verified_setup_activation_required', rolledBack: true };
  }
  if (!user || !ownerProfile || String(user.role || '').toLowerCase() !== 'owner') {
    return { ok: false, error: 'setup_owner_payload_invalid', rolledBack: true };
  }
  const existingUsers = listUsersForAuthentication();
  const usableOwner = existingUsers.find((candidate) => {
    const role = String(candidate?.role || '').toLowerCase();
    return candidate?.active !== false
      && (role === 'owner' || role === 'hq_admin')
      && candidate.mustChangePassword !== true
      && candidate.seedDefaultPassword !== true
      && /^(?:pbkdf2:|pbkdf2v2:|b64:)/.test(String(candidate.password || ''));
  });
  if (usableOwner) {
    const requestedUsername = String(user?.username || '').trim().toLowerCase();
    if (requestedUsername && requestedUsername === String(usableOwner.username || '').trim().toLowerCase()) {
      return {
        ...hydratePreauth(),
        setupOwner: true,
        already: true,
        userId: usableOwner.id,
        username: usableOwner.username,
        credentialRevision: Number(usableOwner.credentialRevision) || 0,
      };
    }
    return { ok: false, error: 'owner_already_present', rolledBack: true };
  }

  try {
    const committedAt = new Date().toISOString();
    const normalizedOwner = {
      ...user,
      id: String(user.id),
      username: String(user.username || '').trim().toLowerCase(),
      fullName: String(user.fullName || '').trim(),
      email: String(user.email || '').trim(),
      password: String(user.password || ''),
      role: 'owner',
      active: true,
      branchScope: ['*'],
      canSwitchBranch: true,
      mustChangePassword: false,
      seedDefaultPassword: false,
      credentialRevision: Math.max(1, Number(user.credentialRevision) || 1),
      passwordChangedAt: String(user.passwordChangedAt || committedAt),
      centerId,
      branchId: '__ORG__',
    };
    if (!normalizedOwner.id || !normalizedOwner.username || !normalizedOwner.fullName
        || !/^pbkdf2v2:/.test(normalizedOwner.password)) {
      return { ok: false, error: 'setup_owner_credential_invalid', rolledBack: true };
    }
    const nextUsers = existingUsers.map((candidate) => {
      const role = String(candidate?.role || '').toLowerCase();
      if ((role === 'owner' || role === 'hq_admin')
          && (candidate.seedDefaultPassword === true || candidate.mustChangePassword === true)) {
        return { ...candidate, active: false, ownerSeedRetired: true, seedDefaultPassword: true, mustChangePassword: true, supersededByOwnerId: normalizedOwner.id, retiredAt: committedAt };
      }
      return candidate;
    });
    nextUsers.push(normalizedOwner);
    const commandBase = String(payload.commandId || crypto.randomUUID());
    const ownerProfileValue = {
      ...ownerProfile,
      schemaVersion: 2,
      role: 'owner',
      username: normalizedOwner.username,
      credentialUserId: normalizedOwner.id,
      credentialRevision: normalizedOwner.credentialRevision,
      passwordHash: null,
      cloudIdentity: license.ownerIdentity && typeof license.ownerIdentity === 'object'
        ? JSON.parse(JSON.stringify(license.ownerIdentity))
        : {},
      centerId,
      orgId: centerId,
      createdAt: ownerProfile.createdAt || committedAt,
      updatedAt: committedAt,
    };
    const ownerSetupValue = {
      schemaVersion: 2,
      status: 'complete',
      ownerUserId: normalizedOwner.id,
      credentialRevision: normalizedOwner.credentialRevision,
      completedAt: committedAt,
    };

    const result = db.transaction(() => {
      const usersCommit = command({
        commandId: `${commandBase}:users`,
        entity: 'users',
        action: 'replaceAll',
        records: nextUsers,
        timestamp: committedAt,
      }, { centerId, branchId: '__ORG__', actorId: normalizedOwner.id, deviceId: 'setup', trusted: true });
      if (usersCommit?.ok !== true) {
        const error = new Error(usersCommit?.error || 'setup_owner_users_commit_failed');
        error.code = usersCommit?.error || 'setup_owner_users_commit_failed';
        throw error;
      }
      const ownerProfileCommit = command({
        commandId: `${commandBase}:owner-profile`,
        entity: '__tdw_owner_profile__',
        action: 'upsert',
        record: { id: '__singleton__', value: ownerProfileValue },
        timestamp: committedAt,
      }, { centerId, branchId: '__ORG__', actorId: normalizedOwner.id, deviceId: 'setup', trusted: true });
      if (ownerProfileCommit?.ok !== true) {
        const error = new Error(ownerProfileCommit?.error || 'setup_owner_profile_commit_failed');
        error.code = ownerProfileCommit?.error || 'setup_owner_profile_commit_failed';
        throw error;
      }
      const ownerSetupCommit = command({
        commandId: `${commandBase}:owner-setup`,
        entity: '__tdw_owner_setup__',
        action: 'upsert',
        record: { id: '__singleton__', value: ownerSetupValue },
        timestamp: committedAt,
      }, { centerId, branchId: '__ORG__', actorId: normalizedOwner.id, deviceId: 'setup', trusted: true });
      if (ownerSetupCommit?.ok !== true) {
        const error = new Error(ownerSetupCommit?.error || 'setup_owner_state_commit_failed');
        error.code = ownerSetupCommit?.error || 'setup_owner_state_commit_failed';
        throw error;
      }
      db.prepare(`
        INSERT INTO meta(key, value) VALUES('setupOwnerCommittedAt', ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
      `).run(committedAt);
      return { usersCommit, ownerProfileCommit, ownerSetupCommit };
    })();

    return {
      ...hydratePreauth(),
      setupOwner: true,
      committedAt,
      userId: normalizedOwner.id,
      username: normalizedOwner.username,
      credentialRevision: normalizedOwner.credentialRevision,
      usersCommit: result.usersCommit,
      ownerProfileCommit: result.ownerProfileCommit,
      ownerSetupCommit: result.ownerSetupCommit,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.code || 'setup_owner_commit_failed',
      message: error.message,
      rolledBack: true,
    };
  }
}

function bootstrapFromLocalSnapshot(snapshot, options = {}) {
  ensureDb();
  const status = getStatus();
  const dbFile = getDbPath();
  const target = classifySetupRestoreTarget(dbFile);
  if (target.ok !== true || target.replaceAllowed !== true) {
    return { ok: false, error: 'bootstrap_target_not_empty', status, targetClassification: target };
  }

  const authority = readAuthorityIdentity();
  const preservedKv = {};
  for (const key of [
    '__tdw_cloud_license__', 'commercial_license_data_v2', '__tdw_device_config__',
    '__tdw_meta__', '__tdw_drive_folders__',
  ]) {
    const value = repos.kv.get(key, undefined);
    if (value !== undefined) preservedKv[key] = value;
  }
  const preservedSetupEntities = {};
  if (authority.centerId) {
    const setupScope = { centerId: authority.centerId, branchId: '__ORG__' };
    for (const key of ['__tdw_device_registry__']) {
      const rows = repos.entities.getAll(key, setupScope, { includeDeleted: false });
      if (rows.length) preservedSetupEntities[key] = rows;
    }
  }

  const databaseDir = path.dirname(dbFile);
  const nonce = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const stagePath = path.join(databaseDir, `.setup-bootstrap-${nonce}.db`);
  const safetyPath = path.join(databaseDir, 'backups', `pre-setup-bootstrap-${nonce}.db`);
  fs.mkdirSync(path.dirname(stagePath), { recursive: true });
  fs.mkdirSync(path.dirname(safetyPath), { recursive: true });

  const report = migrateFromSnapshot({
    snapshot,
    dbPath: stagePath,
    sourceLabel: options.sourceLabel || 'main-owned-bootstrap',
  });
  if (report?.ok !== true) {
    try { fs.rmSync(stagePath, { force: true }); } catch { /* preserve original */ }
    return { ...report, atomicSwap: false, targetClassification: target };
  }
  if (authority.centerId && report.authority?.centerId
      && String(authority.centerId) !== String(report.authority.centerId)) {
    try { fs.rmSync(stagePath, { force: true }); } catch { /* preserve original */ }
    return {
      ok: false,
      error: 'migration_center_mismatch',
      atomicSwap: false,
      targetClassification: target,
      expectedCenterId: authority.centerId,
    };
  }

  let stageDb;
  try {
    stageDb = openDatabase(stagePath);
    const stageRepos = createRepositories(stageDb);
    for (const [key, value] of Object.entries(preservedKv)) stageRepos.kv.set(key, value);
    if (authority.centerId) {
      const setupScope = { centerId: authority.centerId, branchId: '__ORG__', organizationScoped: true };
      for (const [key, rows] of Object.entries(preservedSetupEntities)) {
        for (const current of rows) {
          const existing = stageRepos.entities.getById(key, current.id, setupScope, { includeDeleted: false });
          let merged = current;
          if (key === '__tdw_device_registry__' && existing) {
            const registered = new Map();
            for (const device of existing.value?.registered || []) {
              if (device?.deviceUuid) registered.set(String(device.deviceUuid), device);
            }
            for (const device of current.value?.registered || []) {
              if (device?.deviceUuid) registered.set(String(device.deviceUuid), device);
            }
            merged = {
              ...existing,
              ...current,
              revision: Math.max(Number(existing.revision) || 0, Number(current.revision) || 0) + 1,
              value: {
                ...(existing.value || {}),
                ...(current.value || {}),
                registered: [...registered.values()],
                updatedAt: new Date().toISOString(),
              },
            };
          }
          stageRepos.entities.upsert(key, merged, setupScope);
        }
      }
      stageDb.prepare(`
        INSERT INTO meta(key, value) VALUES('authorityCenterId', ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
      `).run(authority.centerId);
    }
    const integrity = integrityCheck(stageDb);
    if (!integrity.ok) throw Object.assign(new Error('integrity_failed'), { code: 'integrity_failed' });
  } catch (error) {
    try { stageDb?.close(); } catch { /* empty */ }
    try { fs.rmSync(stagePath, { force: true }); } catch { /* preserve original */ }
    return {
      ...report,
      ok: false,
      error: error.code || error.message || 'bootstrap_stage_finalize_failed',
      atomicSwap: false,
      targetClassification: target,
    };
  } finally {
    try { stageDb?.close(); } catch { /* empty */ }
  }

  let originalMoved = false;
  try {
    try { db?.close(); } catch { /* empty */ }
    db = null;
    repos = null;
    syncPlatform = null;
    if (fs.existsSync(dbFile)) {
      fs.copyFileSync(dbFile, safetyPath);
      fs.renameSync(dbFile, `${dbFile}.setup-old-${nonce}`);
      originalMoved = true;
    }
    fs.renameSync(stagePath, dbFile);
    ensureDb();
    const finalIntegrity = integrityCheck(db);
    if (!finalIntegrity.ok) throw Object.assign(new Error('integrity_failed_after_swap'), { code: 'integrity_failed_after_swap' });
    if (originalMoved) {
      try { fs.rmSync(`${dbFile}.setup-old-${nonce}`, { force: true }); } catch { /* safetyPath remains */ }
    }
    return {
      ...report,
      ok: true,
      atomicSwap: true,
      safetyPath,
      targetClassification: target,
      preservedKeys: Object.keys(preservedKv),
      preservedSetupEntities: Object.keys(preservedSetupEntities),
    };
  } catch (error) {
    try { db?.close(); } catch { /* empty */ }
    db = null;
    repos = null;
    syncPlatform = null;
    try {
      if (fs.existsSync(dbFile)) fs.renameSync(dbFile, `${dbFile}.setup-failed-${nonce}`);
      if (originalMoved && fs.existsSync(`${dbFile}.setup-old-${nonce}`)) {
        fs.renameSync(`${dbFile}.setup-old-${nonce}`, dbFile);
      } else if (fs.existsSync(safetyPath)) {
        fs.copyFileSync(safetyPath, dbFile);
      }
    } catch { /* report rollback failure below */ }
    try { ensureDb(); } catch { /* caller receives failure */ }
    return {
      ...report,
      ok: false,
      error: error.code || error.message || 'bootstrap_atomic_swap_failed',
      atomicSwap: false,
      rolledBack: fs.existsSync(dbFile),
      safetyPath: fs.existsSync(safetyPath) ? safetyPath : null,
      targetClassification: target,
    };
  }
}

function migrateFromBackupObject(snapshot, options = {}) {
  const dbFile = getDbPath();
  const backupPath = path.join(app.getPath('userData'), 'database', 'backups', `pre-migrate-${Date.now()}.db`);
  try { db?.close(); } catch { /* ignore */ }
  db = null;
  repos = null;
  syncPlatform = null;
  if (fs.existsSync(dbFile) && !options.skipBackup) fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  const report = migrateFromSnapshot({
    snapshot,
    dbPath: dbFile,
    backupPath: fs.existsSync(dbFile) ? backupPath : undefined,
    sourceLabel: options.sourceLabel || 'main-owned-migration',
    dryRun: !!options.dryRun,
  });
  try {
    const reportPath = path.join(path.dirname(dbFile), `migration-report-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    report.reportPath = reportPath;
  } catch { /* report remains available to caller */ }
  if (!options.dryRun) ensureDb();
  return report;
}

function querySafe(request, context = {}) {
  ensureDb();
  const req = request || {};
  let scope;
  try { scope = normalizeContext(context, { branchRequired: req.aggregate !== true }); }
  catch (error) { return { ok: false, error: error.code || error.message }; }
  switch (req.op) {
    case 'status': return getStatus(scope);
    case 'count': {
      const keyByTable = {
        clients: 'clientsRegistry', visits: 'cases', bookings: 'bookings',
        employees: 'doctors', attendance: 'attendance', expenses: 'expenses',
      };
      const repo = coreRepository(keyByTable[String(req.table || '')]);
      if (!repo) return { ok: false, error: 'table_not_allowed' };
      return { ok: true, count: repo.count({ centerId: scope.centerId, branchId: req.aggregate ? null : scope.branchId }) };
    }
    case 'sumVisits':
      return { ok: true, sum: repos.visits.sumTotal({ centerId: scope.centerId, branchId: req.aggregate ? null : scope.branchId }) };
    default: return { ok: false, error: 'op_not_allowed' };
  }
}

function ensureSync() {
  ensureDb();
  if (!syncPlatform) syncPlatform = createSyncPlatform(db);
  return syncPlatform;
}

const SYNC_TOMBSTONE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

function syncPayloadHash(payloadJson) {
  return crypto.createHash('sha256').update(String(payloadJson || ''), 'utf8').digest('hex');
}

function writeSyncTombstone(entry) {
  const deletedAt = entry.deleted_at || entry.created_at || new Date().toISOString();
  const expiresAt = new Date(new Date(deletedAt).getTime() + SYNC_TOMBSTONE_RETENTION_MS).toISOString();
  db.prepare(`
    INSERT INTO sync_tombstones (
      center_id, branch_id, table_name, record_id, revision, operation_id,
      deleted_at, expires_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(center_id, branch_id, table_name, record_id) DO UPDATE SET
      revision=excluded.revision,
      operation_id=excluded.operation_id,
      deleted_at=excluded.deleted_at,
      expires_at=excluded.expires_at,
      payload_json=excluded.payload_json
    WHERE excluded.revision > sync_tombstones.revision
  `).run(
    entry.center_id, entry.branch_id, entry.table_name, String(entry.record_id),
    Number(entry.new_revision), entry.event_id, deletedAt, expiresAt,
    String(entry.payload_json || '{}')
  );
}

function validateRemoteOperation(entry, context = {}) {
  const value = entry && typeof entry === 'object' ? entry : {};
  const eventId = String(value.event_id || value.eventId || '').trim();
  const centerId = String(value.center_id || value.centerId || '').trim();
  const branchId = String(value.branch_id || value.branchId || '').trim();
  const tableName = String(value.table_name || value.tableName || '').trim();
  const recordId = String(value.record_id || value.recordId || '').trim();
  const operation = String(value.operation || '').toUpperCase();
  const payloadJson = typeof value.payload_json === 'string'
    ? value.payload_json
    : (typeof value.payloadJson === 'string' ? value.payloadJson : JSON.stringify(value.payload || null));
  const payloadHash = String(value.payload_hash || value.payloadHash || '').toLowerCase();
  const baseRevision = Number(value.base_revision ?? value.baseRevision);
  const newRevision = Number(value.new_revision ?? value.newRevision);
  if (!/^[A-Za-z0-9_.:-]{8,200}$/.test(eventId)) throw new Error('sync_event_id_invalid');
  if (!centerId || centerId !== String(context.centerId || '')) throw new Error('center_access_denied');
  if (!branchId || branchId !== String(context.branchId || '')) throw new Error('branch_access_denied');
  if (!catalog.OPERATIONAL_SET.has(tableName)) throw new Error('sync_table_not_allowed');
  const classification = catalog.classifyKey(tableName);
  if ((classification.branchOwned === false) !== (branchId === '__ORG__')) {
    throw new Error('sync_scope_classification_mismatch');
  }
  if (!recordId) throw new Error('sync_record_id_required');
  if (!['CREATE', 'UPDATE', 'DELETE'].includes(operation)) throw new Error('sync_operation_invalid');
  if (!Number.isInteger(baseRevision) || baseRevision < 0) throw new Error('sync_base_revision_invalid');
  if (!Number.isInteger(newRevision) || newRevision !== baseRevision + 1) throw new Error('sync_revision_invalid');
  if (!payloadJson || payloadJson.length > 16 * 1024 * 1024) throw new Error('sync_payload_invalid');
  if (!/^[a-f0-9]{64}$/.test(payloadHash) || syncPayloadHash(payloadJson) !== payloadHash) {
    throw new Error('sync_payload_hash_mismatch');
  }
  let payload;
  try { payload = JSON.parse(payloadJson); } catch { throw new Error('sync_payload_json_invalid'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('sync_payload_object_required');
  if (String(payload.id || '') !== recordId) throw new Error('sync_payload_record_mismatch');
  if (String(payload.centerId || payload.center_id || '') !== centerId) throw new Error('sync_payload_center_mismatch');
  if (String(payload.branchId || payload.branch_id || '') !== branchId) throw new Error('sync_payload_branch_mismatch');
  if (Number(payload.revision) !== newRevision) throw new Error('sync_payload_revision_mismatch');
  return {
    eventId, centerId, branchId, tableName, recordId, operation,
    baseRevision, newRevision, payloadJson, payloadHash, payload,
    deviceId: String(value.device_id || value.deviceId || ''),
    actorId: value.actor_id || value.actorId || null,
    createdAt: value.created_at || value.createdAt || new Date().toISOString(),
  };
}

/** Main-owned only: apply one verified immutable cloud operation atomically. */
function applyRemoteOperation(entry, context = {}) {
  ensureDb();
  let op;
  try { op = validateRemoteOperation(entry, context); }
  catch (error) { return { ok: false, error: error.message || 'sync_operation_invalid' }; }
  const existingApply = db.prepare('SELECT status FROM sync_operations_applied WHERE event_id=?').get(op.eventId);
  if (existingApply) return { ok: true, duplicate: true, status: existingApply.status, eventId: op.eventId };

  try {
    return db.transaction(() => {
      const repo = authoritativeRepository(op.tableName);
      const recordScope = { centerId: op.centerId, branchId: op.branchId };
      const local = repo?.getById
        ? repo.getById(op.recordId, recordScope)
        : repos.entities.getById(op.tableName, op.recordId, recordScope, { includeDeleted: true });
      const tombstone = db.prepare(`
        SELECT revision, payload_json FROM sync_tombstones
        WHERE center_id=? AND branch_id=? AND table_name=? AND record_id=?
      `).get(op.centerId, op.branchId, op.tableName, op.recordId);
      const localRevision = Math.max(Number(local?.revision) || 0, Number(tombstone?.revision) || 0);

      let status = 'applied';
      let conflictId = null;
      if (localRevision > op.newRevision) {
        status = 'stale';
      } else if (localRevision === op.newRevision) {
        const localPayloadJson = local
          ? JSON.stringify(local)
          : String(tombstone?.payload_json || '');
        status = syncPayloadHash(localPayloadJson) === op.payloadHash ? 'stale' : 'conflict';
      } else if (tombstone && op.operation !== 'DELETE') {
        status = 'conflict';
      } else if (op.operation !== 'DELETE' && localRevision !== op.baseRevision) {
        status = 'conflict';
      } else if (op.operation === 'DELETE' && local && localRevision !== op.baseRevision) {
        status = 'conflict';
      }

      if (status === 'conflict') {
        conflictId = `remote:${op.eventId}`;
        syncPlatform.openConflict({
          conflict_id: conflictId,
          center_id: op.centerId,
          branch_id: op.branchId,
          table_name: op.tableName,
          record_id: op.recordId,
          base_revision: op.baseRevision,
          local_json: local || (tombstone ? JSON.parse(tombstone.payload_json) : {}),
          remote_json: op.payload,
          device_id: op.deviceId,
          actor_id: op.actorId,
        });
      } else if (status === 'applied' && op.operation === 'DELETE') {
        if (repo?.deleteById) repo.deleteById(op.recordId, recordScope);
        else repos.entities.upsert(op.tableName, op.payload, {
          ...recordScope,
          organizationScoped: catalog.classifyKey(op.tableName).branchOwned === false,
        });
        writeSyncTombstone({
          center_id: op.centerId, branch_id: op.branchId, table_name: op.tableName,
          record_id: op.recordId, new_revision: op.newRevision, event_id: op.eventId,
          created_at: op.createdAt, payload_json: op.payloadJson,
        });
      } else if (status === 'applied') {
        if (repo?.upsert) repo.upsert(op.payload, recordScope);
        else repos.entities.upsert(op.tableName, op.payload, {
            ...recordScope,
            organizationScoped: catalog.classifyKey(op.tableName).branchOwned === false,
          });
      }

      db.prepare(`
        INSERT INTO sync_operations_applied (
          event_id, center_id, branch_id, table_name, record_id, operation,
          new_revision, payload_hash, source_device_id, status, applied_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        op.eventId, op.centerId, op.branchId, op.tableName, op.recordId,
        op.operation, op.newRevision, op.payloadHash, op.deviceId || null,
        status, new Date().toISOString()
      );
      return { ok: true, eventId: op.eventId, status, conflictId, revision: op.newRevision };
    })();
  } catch (error) {
    return { ok: false, error: error.code || error.message || 'sync_apply_failed' };
  }
}

function syncOp(request, context = {}) {
  const sp = ensureSync();
  const req = request || {};
  const mutating = new Set([
    'enqueue', 'enqueueAtomicPersistKv', 'enqueueAtomicPersistTable', 'claimPending', 'ack', 'fail',
    'requeueDeadLetter', 'requeueDeadLetters', 'markApplied', 'openConflict',
    'resolveConflict', 'audit', 'metaSet',
  ]);
  let scope = null;
  if (mutating.has(req.op)) {
    try { scope = normalizeContext(context, { branchRequired: true }); }
    catch (error) { return { ok: false, error: error.code || error.message }; }
    const claimedBranch = String(
      req.entry?.branch_id || req.entry?.branchId || req.options?.branchId || req.options?.branch_id
        || req.branchId || scope.branchId || ''
    );
    const claimedCenter = String(req.entry?.center_id || req.entry?.centerId || scope.centerId || '');
    if (claimedCenter && claimedCenter !== scope.centerId) return { ok: false, error: 'center_access_denied' };
    if (claimedBranch && claimedBranch !== scope.branchId) return { ok: false, error: 'branch_access_denied' };
    if (['ack', 'fail', 'requeueDeadLetter'].includes(req.op)) {
      const target = db.prepare(
        'SELECT center_id, branch_id FROM sync_outbox WHERE event_id=?'
      ).get(String(req.eventId || ''));
      if (!target) return { ok: false, error: 'sync_event_not_found' };
      if (target.center_id !== scope.centerId) return { ok: false, error: 'center_access_denied' };
      if (target.branch_id !== scope.branchId) return { ok: false, error: 'branch_access_denied' };
    }
    if (req.op === 'resolveConflict') {
      const target = db.prepare(
        'SELECT center_id, branch_id FROM sync_conflicts WHERE conflict_id=?'
      ).get(String(req.conflictId || ''));
      if (!target) return { ok: false, error: 'sync_conflict_not_found' };
      if (target.center_id !== scope.centerId) return { ok: false, error: 'center_access_denied' };
      if (target.branch_id !== scope.branchId) return { ok: false, error: 'branch_access_denied' };
    }
  }
  switch (req.op) {
    case 'enqueue': return sp.enqueue({ ...req.entry, center_id: scope.centerId, branch_id: scope.branchId });
    case 'enqueueAtomicPersistKv':
    case 'enqueueAtomicPersistTable':
      return { ok: false, error: 'legacy_atomic_snapshot_write_denied' };
    case 'claimPending': return { ok: true, rows: sp.claimPending({ ...(req.options || {}), branch_id: context.branchId || null }) };
    case 'ack': return sp.ack(req.eventId, req.remoteFileId);
    case 'fail': return sp.fail(req.eventId, req.error, req.options || {});
    case 'counts': return { ok: true, counts: sp.countByStatus(context.branchId || null) };
    case 'listDeadLetters': return { ok: true, rows: sp.listDeadLetters({ ...(req.options || {}), branchId: context.branchId }) };
    case 'requeueDeadLetter': return sp.requeueDeadLetter(req.eventId);
    case 'requeueDeadLetters': return sp.requeueDeadLetters({ ...(req.options || {}), branchId: context.branchId });
    case 'markApplied': return sp.markRemoteApplied({ ...req.entry, center_id: scope.centerId, branch_id: scope.branchId });
    case 'openConflict': return sp.openConflict({ ...req.entry, center_id: scope.centerId, branch_id: scope.branchId });
    case 'resolveConflict': return sp.resolveConflictById(req.conflictId, req.resolution, req.resolvedRevision, scope.actorId);
    case 'listOpenConflicts': return { ok: true, rows: sp.listOpenConflicts({ ...(req.options || {}), branchId: context.branchId }) };
    case 'audit': return sp.audit({ ...req.entry, center_id: scope.centerId, branch_id: scope.branchId, actor_id: scope.actorId });
    case 'metaGet': {
      let readScope;
      try { readScope = normalizeContext(context, { branchRequired: true }); }
      catch (error) { return { ok: false, error: error.code || error.message }; }
      return { ok: true, value: sp.metaGet(`${readScope.centerId}:${readScope.branchId}:${req.key}`, req.def) };
    }
    case 'metaSet':
      sp.metaSet(`${scope.centerId}:${scope.branchId}:${req.key}`, req.value);
      return { ok: true };
    default: return { ok: false, error: 'sync_op_not_allowed' };
  }
}

function close() {
  try { db?.close(); } catch { /* ignore */ }
  db = null;
  repos = null;
  syncPlatform = null;
}

module.exports = {
  getDbPath,
  ensureDb,
  getStatus,
  hydrate,
  currentRevision,
  readAuthorityIdentity,
  listUsersForAuthentication,
  hydratePreauth,
  command,
  commitFinancialCase,
  voidFinancialCase,
  finalizePayrollRun,
  adjustFinalizedPayroll,
  replaceOrganizationUsers,
  persistTable,
  persistKv,
  getStoredLicense,
  seedUsersIfEmpty,
  enableSqlitePrimary,
  isBootstrapTargetEmpty,
  commitSetupActivation,
  getSetupLicenseRemotePath,
  commitSetupOrganizationDevice,
  commitSetupOwner,
  bootstrapFromLocalSnapshot,
  migrateFromBackupObject,
  querySafe,
  syncOp,
  applyRemoteOperation,
  exportSnapshot: (context) => exportSnapshot(getDbPath(), context),
  close,
  catalog,
};
