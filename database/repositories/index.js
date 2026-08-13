'use strict';

function nowIso() {
  return new Date().toISOString();
}

function fail(code) {
  throw Object.assign(new Error(code), { code: 'DB_CONSTRAINT', detail: code });
}

function normalizeScope(record, context = {}, organizationScoped = false) {
  const centerId = String(
    context.centerId || context.center_id || record?.centerId || record?.center_id || ''
  ).trim();
  const branchId = organizationScoped
    ? '__ORG__'
    : String(context.branchId || context.branch_id || record?.branchId || record?.branch_id || '').trim();
  if (!centerId) fail('center_id_required');
  if (!branchId) fail('branch_id_required');
  return { centerId, branchId };
}

function scopedPayload(record, scope) {
  return {
    ...record,
    centerId: scope.centerId,
    branchId: scope.branchId,
  };
}

function whereScope(scope, alias = '') {
  if (!scope?.centerId) fail('center_id_required');
  const prefix = alias ? `${alias}.` : '';
  if (scope.branchId) {
    return {
      sql: `${prefix}center_id=@scope_center_id AND ${prefix}branch_id=@scope_branch_id`,
      params: { scope_center_id: scope.centerId, scope_branch_id: scope.branchId },
    };
  }
  return { sql: `${prefix}center_id=@scope_center_id`, params: { scope_center_id: scope.centerId } };
}

function createScopedRepository(db, config) {
  const insertColumns = ['id', ...config.columns, 'center_id', 'branch_id', 'payload_json'];
  const placeholders = insertColumns.map((column) => `@${column}`).join(', ');
  const updates = insertColumns
    .filter((column) => column !== 'id')
    .map((column) => `${column}=excluded.${column}`)
    .join(', ');
  const upsertStatement = db.prepare(`
    INSERT INTO ${config.table} (${insertColumns.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT(id) DO UPDATE SET ${updates}
  `);
  const ownershipById = db.prepare(
    `SELECT center_id, branch_id FROM ${config.table} WHERE id=?`
  );

  function mapRecord(record, context) {
    if (!record?.id) fail(`${config.entity}_id_required`);
    const scope = normalizeScope(record, context);
    const normalized = config.normalize ? config.normalize({ ...record }, scope) : { ...record };
    const payload = scopedPayload(normalized, scope);
    const fields = config.map(normalized, scope);
    return {
      id: String(normalized.id),
      ...fields,
      center_id: scope.centerId,
      branch_id: scope.branchId,
      payload_json: JSON.stringify(payload),
    };
  }

  function getAll(scope) {
    const scoped = whereScope(scope || {});
    return db.prepare(
      `SELECT payload_json FROM ${config.table} WHERE ${scoped.sql} ORDER BY rowid`
    ).all(scoped.params).map((row) => JSON.parse(row.payload_json));
  }

  function getById(id, scope) {
    const scoped = whereScope(scope || {});
    const row = db.prepare(
      `SELECT payload_json FROM ${config.table} WHERE id=@id AND ${scoped.sql}`
    ).get({ id: String(id), ...scoped.params });
    return row ? JSON.parse(row.payload_json) : null;
  }

  function upsert(record, context) {
    const mapped = mapRecord(record, context);
    const existingOwner = ownershipById.get(mapped.id);
    if (existingOwner && (
      existingOwner.center_id !== mapped.center_id || existingOwner.branch_id !== mapped.branch_id
    )) fail(`${config.entity}_cross_scope_id_collision`);
    upsertStatement.run(mapped);
    return JSON.parse(mapped.payload_json);
  }

  function upsertMany(list, context) {
    const tx = db.transaction((records) => records.map((record) => upsert(record, context)));
    const rows = tx(Array.isArray(list) ? list : []);
    return { ok: true, upserted: rows.length, records: rows };
  }

  function deleteById(id, context) {
    const scope = normalizeScope({}, context);
    const info = db.prepare(
      `DELETE FROM ${config.table} WHERE id=? AND center_id=? AND branch_id=?`
    ).run(String(id), scope.centerId, scope.branchId);
    return { ok: true, deleted: info.changes };
  }

  return {
    count(scope) {
      const scoped = whereScope(scope || {});
      return db.prepare(`SELECT COUNT(*) AS c FROM ${config.table} WHERE ${scoped.sql}`).get(scoped.params).c;
    },
    getAll,
    getById,
    upsert,
    upsertMany,
    deleteById,
    /** Compatibility only: absence never means deletion. */
    replaceAll(list, context) {
      return upsertMany(list, context);
    },
  };
}

function createClientRepository(db) {
  return createScopedRepository(db, {
    table: 'clients', entity: 'client',
    columns: [
      'file_no', 'key', 'name', 'phone', 'patient_id', 'nationality', 'is_vip',
      'default_invoice_type', 'created_at', 'updated_at', 'revision',
    ],
    normalize(record) {
      if (!record.name) fail('client_name_required');
      return record;
    },
    map(record) {
      return {
        file_no: record.fileNo || null,
        key: record.key || null,
        name: String(record.name),
        phone: record.phone || null,
        patient_id: record.patientId || null,
        nationality: record.nationality || null,
        is_vip: record.isVip ? 1 : 0,
        default_invoice_type: record.defaultInvoiceType || null,
        created_at: record.createdAt || nowIso(),
        updated_at: record.updatedAt || nowIso(),
        revision: Math.max(1, Number(record.revision) || 1),
      };
    },
  });
}

function createVisitRepository(db) {
  const repo = createScopedRepository(db, {
    table: 'visits', entity: 'visit',
    columns: [
      'invoice', 'client_id', 'doctor_id', 'date', 'service_type', 'cups', 'total',
      'pre_tax', 'vat', 'cash', 'card', 'commission', 'created_at', 'updated_at', 'revision',
    ],
    map(record) {
      return {
        invoice: record.invoice || null,
        client_id: record.clientRegistryId || null,
        doctor_id: record.doctorId || null,
        date: record.date || null,
        service_type: record.serviceType || null,
        cups: record.cups != null ? Number(record.cups) : null,
        total: Math.max(0, Number(record.total) || 0),
        pre_tax: record.preTax != null ? Number(record.preTax) : null,
        vat: record.vat != null ? Number(record.vat) : null,
        cash: record.cash != null ? Number(record.cash) : null,
        card: record.card != null ? Number(record.card) : null,
        commission: record.commission != null ? Number(record.commission) : null,
        created_at: record.createdAt || nowIso(),
        updated_at: record.updatedAt || nowIso(),
        revision: Math.max(1, Number(record.revision) || 1),
      };
    },
  });
  repo.sumTotal = (scope) => {
    const scoped = whereScope(scope || {});
    return db.prepare(`SELECT COALESCE(SUM(total),0) AS s FROM visits WHERE ${scoped.sql}`).get(scoped.params).s;
  };
  return repo;
}

function createBookingRepository(db) {
  return createScopedRepository(db, {
    table: 'appointments', entity: 'booking',
    columns: ['client_id', 'doctor_id', 'date', 'time', 'status', 'service', 'created_at', 'updated_at'],
    normalize(record) {
      if (!record.date) fail('booking_date_required');
      return record;
    },
    map(record) {
      return {
        client_id: record.clientRegistryId || null,
        doctor_id: record.doctorId || null,
        date: record.date,
        time: record.time || null,
        status: record.status || 'pending',
        service: record.service || null,
        created_at: record.createdAt || nowIso(),
        updated_at: record.updatedAt || nowIso(),
      };
    },
  });
}

function createEmployeeRepository(db) {
  return createScopedRepository(db, {
    table: 'employees', entity: 'employee',
    columns: ['name', 'active', 'salary', 'created_at', 'updated_at'],
    normalize(record) {
      if (!record.name) fail('employee_name_required');
      return record;
    },
    map(record) {
      return {
        name: String(record.name),
        active: record.active === false ? 0 : 1,
        salary: Math.max(0, Number(record.salary) || 0),
        created_at: record.createdAt || nowIso(),
        updated_at: record.updatedAt || nowIso(),
      };
    },
  });
}

function createAttendanceRepository(db) {
  return createScopedRepository(db, {
    table: 'attendance', entity: 'attendance',
    columns: ['employee_id', 'date', 'type', 'total_hours', 'created_at'],
    normalize(record) {
      if (!record.doctorId || !record.date) fail('attendance_invalid');
      return record;
    },
    map(record) {
      return {
        employee_id: String(record.doctorId),
        date: record.date,
        type: record.type || null,
        total_hours: record.totalHours != null ? Number(record.totalHours) : null,
        created_at: record.createdAt || nowIso(),
      };
    },
  });
}

function createExpenseRepository(db) {
  const repo = createScopedRepository(db, {
    table: 'expenses', entity: 'expense',
    columns: ['date', 'amount', 'category', 'pay_status', 'created_at'],
    map(record) {
      return {
        date: record.date || null,
        amount: Math.max(0, Number(record.amount) || 0),
        category: record.cat || record.category || null,
        pay_status: record.payStatus || null,
        created_at: record.createdAt || nowIso(),
      };
    },
  });
  repo.sumAmount = (scope) => {
    const scoped = whereScope(scope || {});
    return db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE ${scoped.sql}`).get(scoped.params).s;
  };
  return repo;
}

function createEntityRepository(db) {
  const upsert = db.prepare(`
    INSERT INTO p0b_entities
      (center_id, branch_id, entity_type, entity_id, payload_json, revision, deleted_at, updated_at)
    VALUES (@center_id, @branch_id, @entity_type, @entity_id, @payload_json, @revision, @deleted_at, @updated_at)
    ON CONFLICT(center_id, branch_id, entity_type, entity_id) DO UPDATE SET
      payload_json=excluded.payload_json,
      revision=excluded.revision,
      deleted_at=excluded.deleted_at,
      updated_at=excluded.updated_at
    WHERE excluded.revision > p0b_entities.revision
  `);
  return {
    getById(entityType, entityId, scope, options = {}) {
      const row = db.prepare(`
        SELECT payload_json, deleted_at FROM p0b_entities
        WHERE center_id=? AND branch_id=? AND entity_type=? AND entity_id=?
      `).get(scope.centerId, scope.branchId, entityType, String(entityId));
      if (!row || (row.deleted_at && options.includeDeleted !== true)) return null;
      return JSON.parse(row.payload_json);
    },
    getAll(entityType, scope, options = {}) {
      const rows = db.prepare(`
        SELECT payload_json, deleted_at FROM p0b_entities
        WHERE center_id=? AND branch_id=? AND entity_type=?
        ORDER BY updated_at, entity_id
      `).all(scope.centerId, scope.branchId, entityType);
      return rows
        .filter((row) => options.includeDeleted === true || !row.deleted_at)
        .map((row) => JSON.parse(row.payload_json));
    },
    getAllForCenter(entityType, centerId, options = {}) {
      if (!centerId) fail('center_id_required');
      const rows = db.prepare(`
        SELECT payload_json, deleted_at FROM p0b_entities
        WHERE center_id=? AND entity_type=?
        ORDER BY branch_id, updated_at, entity_id
      `).all(centerId, entityType);
      return rows
        .filter((row) => options.includeDeleted === true || !row.deleted_at)
        .map((row) => JSON.parse(row.payload_json));
    },
    upsert(entityType, record, context) {
      if (!record?.id) fail('entity_id_required');
      const scope = normalizeScope(record, context, context?.organizationScoped === true);
      const previous = db.prepare(`
        SELECT revision FROM p0b_entities
        WHERE center_id=? AND branch_id=? AND entity_type=? AND entity_id=?
      `).get(scope.centerId, scope.branchId, entityType, String(record.id));
      const revision = Math.max(Number(record.revision) || 0, Number(previous?.revision) + 1 || 1);
      const payload = scopedPayload({ ...record, revision }, scope);
      const info = upsert.run({
        center_id: scope.centerId,
        branch_id: scope.branchId,
        entity_type: String(entityType),
        entity_id: String(record.id),
        payload_json: JSON.stringify(payload),
        revision,
        deleted_at: record.deletedAt || null,
        updated_at: record.updatedAt || nowIso(),
      });
      return { ok: true, changed: info.changes, record: payload, revision };
    },
    tombstone(entityType, entityId, context) {
      const scope = normalizeScope({}, context, context?.organizationScoped === true);
      const existing = db.prepare(`
        SELECT payload_json, revision FROM p0b_entities
        WHERE center_id=? AND branch_id=? AND entity_type=? AND entity_id=?
      `).get(scope.centerId, scope.branchId, entityType, String(entityId));
      if (!existing) return { ok: true, changed: 0 };
      const deletedAt = nowIso();
      const record = { ...JSON.parse(existing.payload_json), deletedAt, revision: Number(existing.revision) + 1 };
      return this.upsert(entityType, record, context);
    },
  };
}

/** Repository for schema-backed entities whose complete compatibility payload is JSON. */
function createPayloadTableRepository(db, config) {
  const tableColumns = new Set(
    db.prepare(`PRAGMA table_info(${config.table})`).all().map((column) => column.name)
  );
  const idColumn = config.idColumn || 'id';
  const payloadColumn = config.payloadColumn || 'payload_json';
  const organizationScoped = config.organizationScoped === true;
  const mappedColumns = (config.columns || []).filter((column) => tableColumns.has(column));
  const insertColumns = [idColumn, ...mappedColumns, 'center_id'];
  if (!organizationScoped) insertColumns.push('branch_id');
  insertColumns.push(payloadColumn);
  const statement = db.prepare(`
    INSERT INTO ${config.table} (${insertColumns.join(', ')})
    VALUES (${insertColumns.map((column) => `@${column}`).join(', ')})
    ON CONFLICT(${idColumn}) DO UPDATE SET
      ${insertColumns.filter((column) => column !== idColumn).map((column) => `${column}=excluded.${column}`).join(', ')}
  `);
  const ownership = db.prepare(
    `SELECT center_id${organizationScoped ? '' : ', branch_id'} FROM ${config.table} WHERE ${idColumn}=?`
  );

  function normalize(record, context) {
    if (!record?.id) fail(`${config.entity}_id_required`);
    const scope = normalizeScope(record, context, organizationScoped);
    const payload = scopedPayload({ ...record }, scope);
    const values = config.map ? config.map(record, scope) : {};
    const storageId = config.storageId ? config.storageId(record, scope) : String(record.id);
    const row = {
      [idColumn]: storageId,
      ...values,
      center_id: scope.centerId,
      [payloadColumn]: JSON.stringify(payload),
    };
    if (!organizationScoped) row.branch_id = scope.branchId;
    return { row, payload, scope };
  }

  function scopedWhere(scope) {
    if (!scope?.centerId) fail('center_id_required');
    if (organizationScoped) return { sql: 'center_id=@center_id', params: { center_id: scope.centerId } };
    if (scope.branchId) {
      return {
        sql: 'center_id=@center_id AND branch_id=@branch_id',
        params: { center_id: scope.centerId, branch_id: scope.branchId },
      };
    }
    return { sql: 'center_id=@center_id', params: { center_id: scope.centerId } };
  }

  return {
    getAll(scope) {
      const where = scopedWhere(scope);
      return db.prepare(`SELECT ${payloadColumn} AS payload FROM ${config.table} WHERE ${where.sql} ORDER BY rowid`)
        .all(where.params).map((row) => JSON.parse(row.payload));
    },
    getById(id, scope) {
      const where = scopedWhere(scope);
      const storageId = config.storageId
        ? config.storageId({ id: String(id) }, normalizeScope({}, scope, organizationScoped))
        : String(id);
      const row = db.prepare(
        `SELECT ${payloadColumn} AS payload FROM ${config.table} WHERE ${idColumn}=@id AND ${where.sql}`
      ).get({ id: storageId, ...where.params });
      return row ? JSON.parse(row.payload) : null;
    },
    upsert(record, context) {
      const normalized = normalize(record, context);
      const existing = ownership.get(normalized.row[idColumn]);
      if (existing && (existing.center_id !== normalized.scope.centerId
          || (!organizationScoped && existing.branch_id !== normalized.scope.branchId))) {
        fail(`${config.entity}_cross_scope_id_collision`);
      }
      statement.run(normalized.row);
      return normalized.payload;
    },
    upsertMany(list, context) {
      const tx = db.transaction((records) => records.map((record) => this.upsert(record, context)));
      const records = tx(Array.isArray(list) ? list : []);
      return { ok: true, upserted: records.length, records };
    },
    deleteById(id, context) {
      const scope = normalizeScope({}, context, organizationScoped);
      const storageId = config.storageId
        ? config.storageId({ id: String(id) }, scope)
        : String(id);
      const sql = organizationScoped
        ? `DELETE FROM ${config.table} WHERE ${idColumn}=? AND center_id=?`
        : `DELETE FROM ${config.table} WHERE ${idColumn}=? AND center_id=? AND branch_id=?`;
      const params = organizationScoped
        ? [storageId, scope.centerId]
        : [storageId, scope.centerId, scope.branchId];
      return { ok: true, deleted: db.prepare(sql).run(...params).changes };
    },
    count(scope) {
      const where = scopedWhere(scope);
      return db.prepare(`SELECT COUNT(*) AS c FROM ${config.table} WHERE ${where.sql}`).get(where.params).c;
    },
    replaceAll(list, context) { return this.upsertMany(list, context); },
  };
}

function createSchemaEntityRepositories(db) {
  const make = (config) => createPayloadTableRepository(db, config);
  return {
    invoices: make({
      table: 'invoices', entity: 'invoice',
      columns: ['visit_id', 'invoice_number', 'total', 'pre_tax', 'vat', 'created_at'],
      map: (r) => ({
        visit_id: r.visitId || r.visit_id || null,
        invoice_number: r.invoiceNumber || r.invoice || null,
        total: Math.max(0, Number(r.total) || 0), pre_tax: Number(r.preTax) || null,
        vat: Number(r.vat) || null, created_at: r.createdAt || nowIso(),
      }),
    }),
    payments: make({
      table: 'payments', entity: 'payment',
      columns: ['invoice_id', 'visit_id', 'method', 'amount', 'created_at'],
      map: (r) => ({
        invoice_id: r.invoiceId || null, visit_id: r.visitId || null,
        method: r.method || null, amount: Math.max(0, Number(r.amount) || 0),
        created_at: r.createdAt || nowIso(),
      }),
    }),
    payrollPeriods: make({
      table: 'payroll_periods', entity: 'payroll_period',
      columns: ['year', 'month', 'status'],
      map: (r) => ({ year: Number(r.year), month: Number(r.month), status: r.status || 'open' }),
    }),
    payrollEntries: make({
      table: 'payroll_entries', entity: 'payroll_entry',
      columns: ['period_id', 'employee_id', 'net_total'],
      map: (r) => ({
        period_id: String(r.periodId || ''), employee_id: String(r.employeeId || r.doctorId || ''),
        net_total: Number(r.netTotal) || 0,
      }),
    }),
    commissions: make({
      table: 'commissions', entity: 'commission',
      columns: ['employee_id', 'visit_id', 'amount', 'created_at'],
      map: (r) => ({
        employee_id: r.employeeId || r.doctorId || null, visit_id: r.visitId || null,
        amount: Number(r.amount) || 0, created_at: r.createdAt || nowIso(),
      }),
    }),
    attachments: make({
      table: 'attachments', entity: 'attachment',
      columns: ['entity_type', 'entity_id', 'path', 'mime', 'created_at'],
      map: (r) => ({
        entity_type: r.entityType || r.recordTable || null,
        entity_id: r.entityId || r.recordId || null,
        path: r.path || r.localPath || null, mime: r.mime || null,
        created_at: r.createdAt || nowIso(),
      }),
    }),
    services: make({
      table: 'services', entity: 'service', organizationScoped: true,
      columns: ['name'], map: (r) => ({ name: r.name || null }),
    }),
    users: make({
      table: 'users', entity: 'user', organizationScoped: true,
      columns: ['username', 'role'],
      map: (r) => ({ username: r.username || null, role: r.role || null }),
    }),
    settings: make({
      table: 'settings', entity: 'settings', organizationScoped: true,
      idColumn: 'key', payloadColumn: 'value_json', columns: [],
      storageId: (r, scope) => `${scope.centerId}:${r.id}`,
    }),
  };
}

function createKvRepository(db) {
  const upsert = db.prepare(`
    INSERT INTO kv_store(key, value_json, updated_at) VALUES(?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
  `);
  return {
    get(key, def = null) {
      const row = db.prepare('SELECT value_json FROM kv_store WHERE key = ?').get(key);
      if (!row) return def;
      try { return JSON.parse(row.value_json); } catch { return def; }
    },
    set(key, value) {
      upsert.run(String(key), JSON.stringify(value), nowIso());
      return { ok: true, key: String(key) };
    },
    delete(key) {
      const info = db.prepare('DELETE FROM kv_store WHERE key=?').run(String(key));
      return { ok: true, key: String(key), deleted: info.changes };
    },
    getAllKeys() {
      return db.prepare('SELECT key FROM kv_store').all().map((row) => row.key);
    },
    exportAll() {
      const output = {};
      for (const row of db.prepare('SELECT key, value_json FROM kv_store').all()) {
        try { output[row.key] = JSON.parse(row.value_json); } catch { output[row.key] = null; }
      }
      return output;
    },
  };
}

function createRepositories(db) {
  const result = {
    clients: createClientRepository(db),
    visits: createVisitRepository(db),
    bookings: createBookingRepository(db),
    employees: createEmployeeRepository(db),
    attendance: createAttendanceRepository(db),
    expenses: createExpenseRepository(db),
    entities: createEntityRepository(db),
    kv: createKvRepository(db),
  };
  result.schemaEntities = createSchemaEntityRepositories(db);
  result.forEntity = (entity) => result.schemaEntities[entity] || null;
  return result;
}

module.exports = {
  createRepositories,
  createClientRepository,
  createVisitRepository,
  createBookingRepository,
  createEmployeeRepository,
  createAttendanceRepository,
  createExpenseRepository,
  createEntityRepository,
  createPayloadTableRepository,
  createSchemaEntityRepositories,
  createKvRepository,
  normalizeScope,
};
