/**
 * Restore Staging — backup restore via temp staging + comparison + merge (no direct overwrite).
 */
(function (global) {
  'use strict';

  const STAGING_KEY = '__tdw_restore_staging__';

  const SYNCED_MAP = {
    cases: 'cases',
    clientsRegistry: 'clientsRegistry',
    bookings: 'bookings',
    users: 'users',
    doctors: 'doctors',
    settings: 'settings',
    expenses: 'expenses',
    packages: 'packages',
    services: 'services',
    attendance: 'attendance',
    inventoryItems: 'inventoryItems',
    inventorySuppliers: 'inventorySuppliers',
    inventoryMovements: 'inventoryMovements',
    otRecords: 'otRecords',
    nextSessions: 'nextSessions',
    employeeLeaveRequests: 'employeeLeaveRequests',
    employeeLedgerAccruals: 'employeeLedgerAccruals',
    employeeLedgerPayments: 'employeeLedgerPayments',
    employeeLedgerEntries: 'employeeLedgerEntries',
    messageLog: 'messageLog'
  };

  function stageBackup(data, meta) {
    meta = meta || {};
    const staged = {
      stagedAt: new Date().toISOString(),
      source: meta.source || 'backup',
      fileName: meta.fileName || '',
      data: data || {},
      tables: {}
    };
    Object.keys(SYNCED_MAP).forEach(key => {
      if (data[key] != null) {
        const rows = Array.isArray(data[key]) ? data[key] : (key === 'settings' ? [data[key]] : []);
        staged.tables[key] = rows;
      }
    });
    global.DB?.set?.(STAGING_KEY, staged);
    return staged;
  }

  function loadStaging() {
    return global.DB?.get?.(STAGING_KEY, null);
  }

  function clearStaging() {
    global.DB?.set?.(STAGING_KEY, null);
  }

  function compareWithLocal(staged, branchId) {
    branchId = branchId || global.BranchScope?.getActiveBranchId?.() || 'BR-MAIN';
    const perTable = {};
    let hasConflict = false;
    let canSafeMerge = true;

    Object.keys(staged.tables || {}).forEach(table => {
      const remote = staged.tables[table];
      const local = global.DataStateAnalyzer?.getLocalRecords?.(table, branchId)
        || global.Repository?.get?.(table) || [];
      const localRows = Array.isArray(local) ? local : (table === 'settings' ? [local] : []);
      const merge = global.RecordMerger?.mergeRecords?.(localRows, remote, {
        table,
        branchId,
        enqueueConflicts: false,
        preserveOtherBranches: true
      }) || { hasConflict: false, safeAutoMerge: true, stats: {} };

      perTable[table] = {
        localCount: localRows.length,
        stagedCount: remote.length,
        hasConflict: merge.hasConflict,
        safeAutoMerge: merge.safeAutoMerge,
        stats: merge.stats,
        mergePreview: merge.merged
      };
      if (merge.hasConflict) { hasConflict = true; canSafeMerge = false; }
    });

    return { ok: true, perTable, hasConflict, canSafeMerge, branchId };
  }

  async function applyStagedMerge(options) {
    options = options || {};
    const staged = loadStaging();
    if (!staged) return { ok: false, error: 'no_staging' };
    const branchId = options.branchId || global.BranchScope?.getActiveBranchId?.() || 'BR-MAIN';
    const comparison = compareWithLocal(staged, branchId);

    if (comparison.hasConflict && !options.force && !global.RolePolicy?.isManager?.()) {
      return { ok: false, error: 'conflict_manager_required', comparison };
    }

    const results = [];
    for (const table of Object.keys(staged.tables || {})) {
      const t = comparison.perTable[table];
      if (!t) continue;
      if (t.hasConflict && !options.force) {
        results.push({ table, ok: false, skipped: true, reason: 'conflict' });
        continue;
      }
      const applied = await global.RecordMerger?.applyMergeToRepository?.(table, { merged: t.mergePreview }, {
        source: options.manual ? 'manual' : 'safe_auto',
        branchId
      });
      results.push({ table, ok: !!applied?.ok });
    }

    global.AuditLogger?.logSyncEvent?.('MANUAL_RESTORE', {
      summary: `استعادة من نسخة احتياطية — ${results.filter(r => r.ok).length} جدول`,
      source: staged.source,
      fileName: staged.fileName
    });

    if (!options.keepStaging) clearStaging();
    return { ok: true, results, comparison };
  }

  async function stageAndPrompt(backupData, meta) {
    const staged = stageBackup(backupData, meta);
    const comparison = compareWithLocal(staged);

    global.AuditLogger?.logSyncEvent?.('MANUAL_RESTORE', {
      summary: 'تم تحميل نسخة احتياطية للمراجعة قبل الاستعادة',
      source: meta?.source || 'backup'
    });

    if (comparison.hasConflict) {
      if (global.RolePolicy?.isManager?.()) {
        global.notify?.('⚠️ النسخة الاحتياطية تحتوي على بيانات متعارضة — راجع قبل الاستعادة', 'warning');
        global.DataStateUI?.open?.({
          ok: true,
          state: 'conflict',
          blocked: true,
          requiresUserDecision: true,
          branchId: comparison.branchId
        });
      } else {
        global.notify?.('⛔ لا يمكن الاستعادة — تواصل مع المدير', 'danger');
        return { ok: false, error: 'manager_required', comparison };
      }
    }

    return { ok: true, staged, comparison, needsReview: comparison.hasConflict || !comparison.canSafeMerge };
  }

  global.RestoreStaging = {
    STAGING_KEY,
    SYNCED_MAP,
    stageBackup,
    loadStaging,
    clearStaging,
    compareWithLocal,
    applyStagedMerge,
    stageAndPrompt
  };
})(typeof window !== 'undefined' ? window : globalThis);
