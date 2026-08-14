/**
 * Operational Layer — per-branch table export/import (Cloud V2 Sprint 4).
 * Phase 1: record-level merge via RecordMerger (includes inventory).
 */
(function (global) {
  'use strict';

  const TABLE_FILES = {
    cases: 'cases.json',
    clientsRegistry: 'clients.json',
    bookings: 'bookings.json',
    expenses: 'expenses.json',
    attendance: 'attendance.json',
    doctors: 'doctors.json',
    inventoryItems: 'inventory-items.json',
    inventorySuppliers: 'inventory-suppliers.json',
    inventoryMovements: 'inventory-movements.json',
    otRecords: 'overtime.json',
    nextSessions: 'next-sessions.json',
    employeeLeaveRequests: 'employee-leave-requests.json',
    employeeLedgerAccruals: 'employee-ledger-accruals.json',
    employeeLedgerPayments: 'employee-ledger-payments.json',
    employeeLedgerEntries: 'employee-ledger-entries.json',
    messageLog: 'message-log.json'
  };

  const OPERATIONAL_TABLES = Object.keys(TABLE_FILES);

  function getCenterId() {
    return global.ConfigLayer?.getCenterId?.() || '';
  }

  function drivePathForTable(centerId, branchId, table) {
    const file = TABLE_FILES[table] || `${table}.json`;
    const base = String(file).replace(/\.json$/i, '');
    // V2-4: prefer identity-stable path (centerId/branchId) so rename does not move sync root
    if (global.DriveLayout?.idBranchRoot) {
      return `${global.DriveLayout.idBranchRoot(centerId, branchId)}/Operational/${base}.json`;
    }
    return global.DriveLayout?.operationalBranchFile?.(centerId, branchId, base)
      || `${centerId}/Operational/branches/${branchId}/${file}`;
  }

  function exportTable(table, branchId) {
    branchId = branchId || global.BranchScope?.getActiveBranchId?.() || 'BR-MAIN';
    const repo = global.Repository;
    let rows = repo?.get?.(table) || global.DB?.get?.(repo?.tableKey?.(table) || table, []);
    if (global.SettingsSplit?.filterRecordsForBranch) {
      rows = global.SettingsSplit.filterRecordsForBranch(rows, branchId);
    } else if (global.BranchScope?.filterByBranch) {
      rows = global.BranchScope.filterByBranch(rows, branchId);
    }
    if (Array.isArray(rows)) {
      rows = rows.map(r => global.BranchScope?.ensureRecordBranch?.({ ...r }, branchId) || r);
    }
    return {
      centerId: getCenterId(),
      branchId,
      table,
      exportedAt: new Date().toISOString(),
      revision: repo?.getRevision?.(table) || 0,
      records: Array.isArray(rows) ? rows : []
    };
  }

  async function importTable(table, payload, branchId, options) {
    options = options || {};
    branchId = branchId || payload?.branchId || global.BranchScope?.getActiveBranchId?.() || 'BR-MAIN';
    const records = Array.isArray(payload?.records) ? payload.records : (Array.isArray(payload) ? payload : []);
    const repo = global.Repository;

    const incoming = records.map(r => {
      const row = { ...r, branchId: r.branchId || branchId };
      return global.BranchScope?.ensureRecordBranch?.(row, branchId) || row;
    });

    const existing = repo?.get?.(table) || global.DB?.get?.(repo?.tableKey?.(table) || table, []) || [];

    if (global.RecordMerger?.mergeRecords && options.skipMerge !== true) {
      const mergeResult = global.RecordMerger.mergeRecords(existing, incoming, {
        table,
        branchId,
        enqueueConflicts: options.enqueueConflicts !== false,
        preserveOtherBranches: true
      });

      if (mergeResult.hasConflict) {
        global.SyncGuard?.pause?.('conflict', { table, conflicts: mergeResult.conflicts });
        return {
          ok: false,
          blocked: true,
          hasConflict: true,
          table,
          branchId,
          conflicts: mergeResult.conflicts,
          stats: mergeResult.stats
        };
      }

      if (!global.SqliteBridge?.setAuthoritative) {
        return { ok: false, error: 'authoritative_write_unavailable', table, branchId };
      }
      const committed = await global.SqliteBridge.setAuthoritative(table, mergeResult.merged);
      if (committed?.ok === false) {
        return { ok: false, error: committed.error || 'authoritative_import_failed', table, branchId };
      }

      return {
        ok: true,
        table,
        branchId,
        count: incoming.length,
        merged: true,
        stats: mergeResult.stats
      };
    }

    const otherBranches = Array.isArray(existing)
      ? existing.filter(r => r && r.branchId && r.branchId !== branchId)
      : [];
    const merged = otherBranches.concat(incoming);

    if (!global.SqliteBridge?.setAuthoritative) {
      return { ok: false, error: 'authoritative_write_unavailable', table, branchId };
    }
    const committed = await global.SqliteBridge.setAuthoritative(table, merged);
    if (committed?.ok === false) {
      return { ok: false, error: committed.error || 'authoritative_import_failed', table, branchId };
    }

    global.AuditLogger?.logSyncEvent?.('SYSTEM_ERROR', {
      entity: table,
      summary: 'importTable بدون RecordMerger — مسار legacy',
      meta: { branchId, count: records.length }
    });

    return { ok: true, table, branchId, count: records.length, legacy: true };
  }

  function exportAllOperational(branchId) {
    branchId = branchId || global.BranchScope?.getActiveBranchId?.() || 'BR-MAIN';
    const out = {};
    OPERATIONAL_TABLES.forEach(t => { out[t] = exportTable(t, branchId); });
    return out;
  }

  async function importTableAuthoritative(table, payload, branchId, options) {
    return importTable(table, payload, branchId, { ...(options || {}), remote: true });
  }

  global.OperationalLayer = {
    TABLE_FILES,
    OPERATIONAL_TABLES,
    drivePathForTable,
    exportTable,
    importTable,
    importTableAuthoritative,
    exportAllOperational
  };
})(typeof window !== 'undefined' ? window : globalThis);
