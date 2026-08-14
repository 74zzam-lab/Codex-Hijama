/**
 * Synced Write — single gateway for synced table writes and backup restore.
 */
(function (global) {
  'use strict';

  const LOCAL_ONLY_KEYS = new Set([
    'clientFileCounter', 'hardwareLog', 'importHistory', 'communicationWebhookLog',
    'invoiceCounter', 'backupLog', 'backupRegistry', 'budget', 'systemLogs',
    'logCounter', 'logsPageSize', 'cashDrawerSession', 'preImportBackup',
    'importStudioLog', 'activityLog'
  ]);

  function ensureBridge() {
    global.DbBridge?.install?.();
    return global.Repository;
  }

  function syncedTables() {
    return new Set(global.DbBridge?.syncedTables?.() || global.Repository?.SYNCED_TABLES || []);
  }

  function isSyncedTable(table) {
    return syncedTables().has(table);
  }

  function syncGlobalVar(table, value) {
    if (table === 'cases') global.cases = value;
    else if (table === 'clientsRegistry') global.clientsRegistry = value;
    else if (table === 'bookings') global.bookings = value;
    else if (table === 'users') global.users = value;
    else if (table === 'doctors') global.doctors = value;
    else if (table === 'services') global.services = value;
    else if (table === 'packages') global.packages = value;
    else if (table === 'settings' && value && !Array.isArray(value)) global.settings = value;
    else if (table === 'expenses') global.expenses = value;
    else if (table === 'attendance') global.attendance = value;
    else if (table === 'inventoryItems') global.inventoryItems = value;
    else if (table === 'inventorySuppliers') global.inventorySuppliers = value;
    else if (table === 'inventoryMovements') global.inventoryMovements = value;
    else if (table === 'otRecords') global.otRecords = value;
    else if (table === 'nextSessions') global.nextSessions = value;
    else if (table === 'employeeLeaveRequests') global.employeeLeaveRequests = value;
    else if (table === 'employeeLedgerAccruals') global.employeeLedgerAccruals = value;
    else if (table === 'employeeLedgerPayments') global.employeeLedgerPayments = value;
    else if (table === 'employeeLedgerEntries') global.employeeLedgerEntries = value;
    else if (table === 'messageLog') global.messageLog = value;
  }

  async function setTable(table, value, options) {
    options = options || {};
    ensureBridge();
    if (global.LegacyBranchMigration?.isPushBlocked?.() && isSyncedTable(table)) {
      return { ok: false, error: 'legacy_branch_migration_required' };
    }
    // Authoritative SQLite first when available — no optimistic cache.
    if (global.SqliteBridge?.setAuthoritative && (
      global.SqliteBridge.CORE_TABLES?.includes?.(table)
      || global.SqliteBridge.OPERATIONAL_KEYS?.has?.(table)
      || global.SqliteBridge.KV_MIRROR?.includes?.(table)
      || ['users', 'settings', 'packages', 'services'].includes(table)
    )) {
      const res = await global.SqliteBridge.setAuthoritative(table, value);
      if (!res?.ok) return { ok: false, error: res?.error || 'sqlite_commit_failed', via: 'sqlite' };
      const committed = global.SqliteBridge.getSnapshot?.()?.data?.[table] ?? value;
      syncGlobalVar(table, committed);
      return { ok: true, via: 'sqlite_authoritative', table };
    }
    if (isSyncedTable(table)) {
      return { ok: false, error: 'authoritative_write_unavailable', table };
    }
    const stored = await Promise.resolve(global.DB?.set?.(table, value));
    return stored?.ok === false ? stored : { ok: true, via: 'database_contract', table };
  }

  async function upsertRecord(table, record, options) {
    options = options || {};
    ensureBridge();
    if (!isSyncedTable(table)) {
      return { ok: false, error: 'not_synced_table' };
    }
    if (global.LegacyBranchMigration?.isPushBlocked?.()) {
      return { ok: false, error: 'legacy_branch_migration_required' };
    }
    if (!global.SqliteBridge?.upsertRecord) {
      return { ok: false, error: 'authoritative_write_unavailable', table };
    }
    const result = await global.SqliteBridge.upsertRecord(table, record, options);
    if (result?.ok === false) return result;
    const committed = global.SqliteBridge?.getSnapshot?.()?.data?.[table]
      ?? global.Repository.get(table);
    syncGlobalVar(table, committed);
    return result;
  }

  async function applyLocalOnlyPayload(data) {
    if (!data || typeof data !== 'object') return [];
    const applied = [];
    for (const key of Object.keys(data)) {
      if (LOCAL_ONLY_KEYS.has(key) && data[key] != null) {
        const result = await global.SqliteBridge?.setAuthoritative?.(key, data[key]);
        if (result?.ok === false) continue;
        if (key === 'invoiceCounter') global.invoiceCounter = data[key];
        if (key === 'clientFileCounter') global.clientFileCounter = data[key];
        applied.push(key);
      }
    }
    if (data.license?.meta) {
      try { localStorage.setItem('__tdw_lic_meta__', data.license.meta); } catch { /* empty */ }
      applied.push('license.meta');
    }
    if (data.license?.data) {
      try { localStorage.setItem('__tdw_lic__', data.license.data); } catch { /* empty */ }
      applied.push('license.data');
    }
    return applied;
  }

  async function wipeTable(table, emptyValue) {
    ensureBridge();
    const val = emptyValue != null ? emptyValue : (table.includes('Counter') ? 1 : []);
    if (isSyncedTable(table)) {
      global.SyncGuard?.pause?.('admin_wipe', { table });
      const r = await setTable(table, val, { source: 'wipe' });
      global.SyncGuard?.resume?.({ state: 'local_only' });
      return r;
    }
    return global.SqliteBridge?.setAuthoritative?.(table, val)
      || { ok: false, error: 'authoritative_write_unavailable', table };
  }

  async function restoreLocalExtensions(data) {
    if (!data || typeof data !== 'object') return;
    if (typeof global.extRestoreData === 'function') await global.extRestoreData(data);
    if (typeof global.extRestoreLedgerData === 'function') await global.extRestoreLedgerData(data);
    if (typeof global.extRestoreLeaveData === 'function') await global.extRestoreLeaveData(data);
  }

  async function restoreFromBackup(data, meta) {
    meta = meta || {};
    ensureBridge();
    if (!global.RestoreStaging?.stageBackup) {
      return { ok: false, error: 'no_restore_staging' };
    }

    const staged = global.RestoreStaging.stageBackup(data, meta);
    const comparison = global.RestoreStaging.compareWithLocal(staged);

    global.AuditLogger?.logSyncEvent?.('MANUAL_RESTORE', {
      summary: 'بدء استعادة نسخة احتياطية عبر محرك الدمج',
      source: meta.source || 'backup'
    });

    if (comparison.hasConflict) {
      if (!global.RolePolicy?.isManager?.(global.currentUser)) {
        global.notify?.('⛔ لا يمكن الاستعادة — تواصل مع المدير', 'danger');
        return { ok: false, error: 'manager_required', comparison };
      }
      global.SyncGuard?.pause?.('restore_conflict', comparison);
      return { ok: false, error: 'conflict', needsReview: true, comparison };
    }

    const merged = await global.RestoreStaging.applyStagedMerge({
      manual: true,
      branchId: meta.branchId,
      keepStaging: false
    });

    if (!merged.ok) return merged;

    Object.keys(global.RestoreStaging.SYNCED_MAP || {}).forEach(table => {
      if (global.Repository?.get) syncGlobalVar(table, global.Repository.get(table));
    });

    const localOnly = await applyLocalOnlyPayload(data);
    await restoreLocalExtensions(data);

    return { ok: true, merged, localOnly, comparison };
  }

  global.SyncedWrite = {
    LOCAL_ONLY_KEYS,
    ensureBridge,
    isSyncedTable,
    setTable,
    upsertRecord,
    wipeTable,
    restoreFromBackup,
    restoreLocalExtensions,
    applyLocalOnlyPayload,
    syncGlobalVar
  };
})(typeof window !== 'undefined' ? window : globalThis);
