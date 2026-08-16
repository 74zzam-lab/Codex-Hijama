/**
 * Conflict Queue — conflicts held for manager resolution; closed after resolve with audit trail.
 */
(function (global) {
  'use strict';

  const QUEUE_KEY = '__tdw_conflict_queue__';
  const ARCHIVE_KEY = '__tdw_conflict_archive__';
  const MAX_ARCHIVE = 300;

  const TABLE_LABELS = {
    cases: 'فاتورة',
    clientsRegistry: 'عميل',
    bookings: 'حجز',
    attendance: 'حضور',
    expenses: 'مصروف',
    settings: 'إعدادات',
    users: 'مستخدم',
    services: 'خدمة',
    packages: 'باقة',
    inventoryItems: 'صنف مخزون',
    inventoryMovements: 'حركة مخزون',
    doctors: 'موظف'
  };

  function recordLabel(table) {
    return TABLE_LABELS[table] || 'سجل';
  }

  function friendlySummary(item) {
    const label = recordLabel(item.table);
    const num = item.recordId || item.local?.invoiceNo || item.local?.number || item.recordId || '';
    const devices = [item.local?.deviceId, item.remote?.deviceId].filter(Boolean);
    const deviceNote = devices.length >= 2 && devices[0] !== devices[1]
      ? ' — تم تعديلها على جهازين مختلفين'
      : '';
    return `تم العثور على تعديلين مختلفين على ${label} رقم ${num}${deviceNote}`;
  }

  function dbApi() {
    return global.cuppingElectron?.database || global.tadawi?.database || null;
  }

  function loadQueue() {
    return global.DB?.get?.(QUEUE_KEY, []) || [];
  }

  function saveQueue(list) {
    // V2-5.10: prefer authoritative SQLite KV when bridge is primary
    if (typeof global.SqliteBridge?.setAuthoritative === 'function' && global.SqliteBridge?.isPrimary?.()) {
      return global.SqliteBridge.setAuthoritative(QUEUE_KEY, list);
    }
    return global.DB?.set?.(QUEUE_KEY, list);
  }

  function loadArchive() {
    return global.DB?.get?.(ARCHIVE_KEY, []) || [];
  }

  function saveArchive(list) {
    const trimmed = list.slice(0, MAX_ARCHIVE);
    if (typeof global.SqliteBridge?.setAuthoritative === 'function' && global.SqliteBridge?.isPrimary?.()) {
      return global.SqliteBridge.setAuthoritative(ARCHIVE_KEY, trimmed);
    }
    return global.DB?.set?.(ARCHIVE_KEY, trimmed);
  }

  function centerIdForConflict() {
    return global.CenterId?.getStoredCenterId?.()
      || global.Organization?.getId?.()
      || global.LicenseCloud?.loadLocal?.()?.centerId
      || 'CTR';
  }

  /** Dual-write pending conflict into SQLite sync_conflicts (canonical table). */
  function mirrorOpenToSqlite(item) {
    const api = dbApi();
    if (!api?.syncOp || !item?.id || !item.table || !item.recordId) return;
    try {
      const result = api.syncOp({
        op: 'openConflict',
        entry: {
          conflict_id: item.id,
          center_id: centerIdForConflict(),
          branch_id: item.branchId || global.BranchScope?.getActiveBranchId?.() || 'BR-MAIN',
          table_name: item.table,
          record_id: String(item.recordId),
          local_json: item.local || {},
          remote_json: item.remote || {},
          device_id: item.deviceId || null,
          actor_id: item.detectedBy || null,
        },
      });
      if (result && typeof result.then === 'function') {
        result.then((r) => {
          if (r?.ok) item.sqliteConflictId = r.conflictId || item.id;
        }).catch(() => { /* non-blocking */ });
      } else if (result?.ok) {
        item.sqliteConflictId = result.conflictId || item.id;
      }
    } catch { /* non-blocking dual-write */ }
  }

  function mirrorResolveToSqlite(item, resolution) {
    const api = dbApi();
    const conflictId = item.sqliteConflictId || item.id;
    if (!api?.syncOp || !conflictId) return;
    try {
      const result = api.syncOp({
        op: 'resolveConflict',
        conflictId,
        resolution: resolution.choice || item.resolution || 'manual',
        actorId: item.resolvedBy || null,
      });
      if (result && typeof result.then === 'function') result.catch(() => { /* empty */ });
    } catch { /* non-blocking */ }
  }

  function enqueue(entry) {
    entry = entry || {};
    const list = loadQueue();
    const id = entry.id || `cf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const item = {
      id,
      status: 'pending',
      table: entry.table || '',
      recordId: entry.recordId || entry.id || '',
      branchId: entry.branchId || global.BranchScope?.getActiveBranchId?.() || '',
      local: entry.local || null,
      remote: entry.remote || null,
      fields: entry.fields || [],
      reason: entry.reason || 'diverged',
      detectedAt: new Date().toISOString(),
      deviceId: global.RecordMetadata?.getDeviceId?.() || '',
      detectedBy: global.RecordMetadata?.getUserLabel?.() || 'system',
      summary: '',
      sqliteConflictId: entry.sqliteConflictId || null,
    };
    item.summary = friendlySummary(item);
    const existing = list.findIndex(x => x.status === 'pending' && x.table === item.table && x.recordId === item.recordId);
    if (existing >= 0) list[existing] = { ...list[existing], ...item, updatedAt: new Date().toISOString() };
    else list.unshift(item);
    saveQueue(list.slice(0, 200));
    mirrorOpenToSqlite(existing >= 0 ? list[existing] : item);

    global.AuditLogger?.logSyncEvent?.('CONFLICT_DETECTED', {
      entity: item.table,
      entityId: item.recordId,
      summary: item.summary,
      fields: item.fields
    });

    if (global.RolePolicy?.isManager?.(global.currentUser)) {
      global.ConflictManagerUI?.notifyPending?.();
    }

    return item;
  }

  function enqueueMany(conflicts, table, branchId) {
    return (conflicts || []).map(c => enqueue({
      table,
      branchId,
      recordId: c.id,
      local: c.local,
      remote: c.remote,
      fields: c.fields,
      reason: c.reason
    }));
  }

  function rowToQueueItem(row) {
    if (!row) return null;
    let local = {};
    let remote = {};
    try { local = typeof row.local_json === 'string' ? JSON.parse(row.local_json) : (row.local_json || {}); } catch { local = {}; }
    try { remote = typeof row.remote_json === 'string' ? JSON.parse(row.remote_json) : (row.remote_json || {}); } catch { remote = {}; }
    const item = {
      id: row.conflict_id,
      sqliteConflictId: row.conflict_id,
      status: row.status === 'open' ? 'pending' : String(row.status || 'pending'),
      table: row.table_name || '',
      recordId: String(row.record_id || ''),
      branchId: row.branch_id || '',
      local,
      remote,
      fields: [],
      reason: 'sqlite_sync_conflicts',
      detectedAt: row.created_at || new Date().toISOString(),
      deviceId: row.device_id || '',
      detectedBy: row.actor_id || 'system',
      summary: '',
      source: 'sync_conflicts',
    };
    item.summary = friendlySummary(item);
    return item;
  }

  /** Prefer UI queue; hydrate missing pending rows from SQLite sync_conflicts. */
  function listMerged(options) {
    options = options || {};
    const fromQueue = list(options);
    const byId = new Map(fromQueue.map((x) => [x.id, x]));
    try {
      const api = dbApi();
      if (api?.syncOp) {
        const res = api.syncOp({ op: 'listOpenConflicts', options: { branchId: options.branchId, table: options.table, limit: 200 } });
        const applyRows = (rows) => {
          (rows || []).forEach((row) => {
            const item = rowToQueueItem(row);
            if (!item) return;
            if (options.status && item.status !== options.status) return;
            if (!byId.has(item.id)) byId.set(item.id, item);
          });
        };
        if (res && typeof res.then === 'function') {
          // sync path is sync in main; if promise, ignore for sync list
        } else if (res?.ok && Array.isArray(res.rows)) {
          applyRows(res.rows);
        }
      }
    } catch { /* non-blocking */ }
    return Array.from(byId.values());
  }

  function list(options) {
    options = options || {};
    let q = loadQueue();
    if (options.status) q = q.filter(x => x.status === options.status);
    if (options.table) q = q.filter(x => x.table === options.table);
    if (options.branchId) q = q.filter(x => x.branchId === options.branchId);
    return q;
  }

  function getHistory(options) {
    options = options || {};
    let archive = loadArchive();
    if (options.table) archive = archive.filter(x => x.table === options.table);
    if (options.branchId) archive = archive.filter(x => x.branchId === options.branchId);
    if (options.since) {
      const since = new Date(options.since).getTime();
      archive = archive.filter(x => new Date(x.resolvedAt || x.detectedAt).getTime() >= since);
    }
    return archive;
  }

  function countPending(options) {
    return listMerged({ status: 'pending', ...(options || {}) }).length;
  }

  function listForUser(user, options) {
    options = options || {};
    let q = listMerged(options);
    if (!user || !global.BranchScope?.getUserBranchScope) return q;
    const scope = global.BranchScope.getUserBranchScope(user);
    if (!scope.length || scope.includes('*')) return q;
    return q.filter((item) => !item.branchId || scope.includes(item.branchId));
  }

  async function applyResolutionToRepo(item, resolution) {
    const table = item.table;
    if (!global.SyncedWrite?.upsertRecord) return { ok: false, error: 'authoritative_write_unavailable' };
    const choice = resolution.choice || 'local';
    let record = null;

    if (choice === 'local') record = { ...item.local };
    else if (choice === 'cloud' || choice === 'remote') record = { ...item.remote };
    else if ((choice === 'manual' || choice === 'merge') && resolution.record) record = { ...resolution.record };
    else return { ok: false, error: 'invalid_resolution' };

    if (!record.id) record.id = item.recordId;
    const committed = await global.SyncedWrite.upsertRecord(table, record, {
      branchId: item.branchId,
      source: 'conflict_resolve',
    });
    return committed?.ok ? { ok: true, record } : committed;
  }

  async function resolve(conflictId, resolution) {
    resolution = resolution || {};
    const list = loadQueue();
    const idx = list.findIndex(x => x.id === conflictId);
    if (idx < 0) return { ok: false, error: 'not_found' };
    const item = list[idx];
    if (item.status !== 'pending') return { ok: false, error: 'already_resolved' };
    if (!global.RolePolicy?.canResolveConflicts?.()) {
      return { ok: false, error: 'manager_only' };
    }
    if (item.branchId && global.BranchScope?.userCanAccessBranch
      && !global.BranchScope.userCanAccessBranch(global.currentUser, item.branchId)) {
      return { ok: false, error: 'branch_access_denied', branchId: item.branchId };
    }

    const applied = await applyResolutionToRepo(item, resolution);
    if (!applied.ok && resolution.choice !== 'defer') return applied;

    item.status = 'resolved';
    item.resolvedAt = new Date().toISOString();
    item.resolvedBy = global.RecordMetadata?.getUserLabel?.() || 'manager';
    item.resolution = resolution.choice || 'manual';
    item.resolvedRecord = applied.record || resolution.record || null;
    list.splice(idx, 1);
    saveQueue(list);
    mirrorResolveToSqlite(item, resolution);

    const archive = loadArchive();
    archive.unshift({ ...item });
    saveArchive(archive);

    global.AuditLogger?.logSyncEvent?.('CONFLICT_RESOLVED', {
      entity: item.table,
      entityId: item.recordId,
      summary: `تم حل التعارض على ${recordLabel(item.table)} ${item.recordId} — ${resolution.choice === 'local' ? 'النسخة المحلية' : resolution.choice === 'cloud' ? 'نسخة السحابة' : 'دمج يدوي'}`,
      resolution: item.resolution,
      before: item.local,
      after: item.resolvedRecord
    });

    if (countPending() === 0) global.SyncGuard?.resume?.({ state: 'conflicts_resolved' });

    return { ok: true, item };
  }

  function getFieldDiff(item) {
    const fields = item.fields || [];
    const diff = [];
    fields.forEach(f => {
      diff.push({
        field: f,
        local: item.local?.[f],
        remote: item.remote?.[f]
      });
    });
    return diff;
  }

  global.ConflictQueue = {
    QUEUE_KEY,
    ARCHIVE_KEY,
    TABLE_LABELS,
    recordLabel,
    friendlySummary,
    loadQueue,
    enqueue,
    enqueueMany,
    list,
    listMerged,
    listForUser,
    getHistory,
    countPending,
    resolve,
    getFieldDiff,
    applyResolutionToRepo,
    mirrorOpenToSqlite,
    mirrorResolveToSqlite,
    rowToQueueItem,
  };
})(typeof window !== 'undefined' ? window : globalThis);
