/**
 * Renderer repository facade.
 *
 * SQLite in the main process is the runtime authority. The adapter exists only
 * for pre-cutover import and isolated browser tests; it is never written after
 * SqliteBridge reports primary mode.
 */
(function (global) {
  'use strict';

  const REVISIONS_KEY = '__tdw_repo_revisions__';
  const SYNCED_TABLES = Object.freeze([
    'cases', 'clientsRegistry', 'bookings', 'users', 'doctors', 'settings',
    'expenses', 'packages', 'services', 'attendance', 'inventoryItems',
    'inventorySuppliers', 'inventoryMovements', 'otRecords', 'nextSessions',
    'employeeLeaveRequests', 'employeeLedgerAccruals', 'employeeLedgerPayments',
    'employeeLedgerEntries', 'messageLog',
  ]);
  const SYNCED_SET = new Set(SYNCED_TABLES);

  function createLocalStorageAdapter(db) {
    const store = db || global.DB;
    const raw = store?.__tdwBridged ? store.raw : store;
    if (!raw?.get || !raw?.set) throw new Error('Repository requires DB.get/set');
    return {
      name: 'bootstrap-localStorage',
      bootstrapOnly: true,
      get(key, def) { return raw.get(key, def); },
      set(key, value) {
        if (global.SqliteBridge?.isPrimary?.()) {
          throw new Error('operational_local_storage_write_denied');
        }
        return raw.set(key, value);
      },
      remove(key) {
        if (global.SqliteBridge?.isPrimary?.()) {
          throw new Error('operational_local_storage_write_denied');
        }
        try { localStorage.removeItem(key); } catch { /* empty */ }
      },
    };
  }

  function isSyncedTable(table) {
    return SYNCED_SET.has(String(table || ''));
  }

  function defaultFor(table) {
    return ['settings'].includes(table) ? {} : [];
  }

  function authoritativeData(adapter, table) {
    const snapshot = global.SqliteBridge?.getSnapshot?.();
    if (global.SqliteBridge?.isPrimary?.() && snapshot?.data) {
      return snapshot.data[table] ?? defaultFor(table);
    }
    return adapter.get(table, defaultFor(table));
  }

  function assertWrite(record, options) {
    const branchId = record?.branchId || options?.branchId || null;
    if (!global.BranchScope?.assertWriteAllowed) return { ok: true, branchId };
    return global.BranchScope.assertWriteAllowed(global.currentUser, branchId, {
      allowOwnerModeWrite: options?.allowOwnerModeWrite === true,
    });
  }

  function createRepository(adapter) {
    adapter = adapter || createLocalStorageAdapter();
    const repository = {
      adapter,
      storageAdapter: adapter,
      SYNCED_TABLES,
      _revisions: {},

      init() {
        const stored = adapter.get(REVISIONS_KEY, {});
        this._revisions = stored && typeof stored === 'object' ? { ...stored } : {};
        return this;
      },

      tableKey(table) { return String(table || ''); },

      get(table, id, options) {
        let data = authoritativeData(adapter, this.tableKey(table));
        if (id == null) {
          if (options?.enforceScope === true && Array.isArray(data)) {
            const user = global.RbacGuard?.resolveAuthoritativeUser?.(global.currentUser) || global.currentUser;
            if (user && !user.isDev) data = global.BranchScope?.filterByUserScope?.(data, user) || data;
          }
          return data;
        }
        const row = Array.isArray(data)
          ? data.find((item) => item && String(item.id) === String(id)) || null
          : (data && typeof data === 'object' ? data[id] ?? null : null);
        if (row && options?.enforceScope === true) {
          const user = global.RbacGuard?.resolveAuthoritativeUser?.(global.currentUser) || global.currentUser;
          if (user && !user.isDev && !global.BranchScope?.userCanAccessBranch?.(user, row.branchId)) return null;
        }
        return row;
      },

      getScoped(table, id) { return this.get(table, id, { enforceScope: true }); },

      query(table, predicate, options) {
        const data = this.get(table, null, options);
        if (!Array.isArray(data)) return data;
        if (typeof predicate === 'function') return data.filter(predicate);
        if (predicate && typeof predicate === 'object') {
          return data.filter((row) => row && Object.keys(predicate).every((key) => row[key] === predicate[key]));
        }
        return data.slice();
      },

      queryScoped(table, predicate) { return this.query(table, predicate, { enforceScope: true }); },

      upsert(table, record, options) {
        options = options || {};
        if (!record?.id) return { ok: false, error: 'missing_id' };
        const stamped = global.BranchScope?.ensureRecordBranch
          ? global.BranchScope.ensureRecordBranch({ ...record }, options.branchId)
          : { ...record };
        const access = assertWrite(stamped, options);
        if (!access.ok) return access;
        if (global.SqliteBridge?.isPrimary?.()) {
          return global.SqliteBridge.upsertRecord(table, stamped, options);
        }
        const data = asMutableArray(authoritativeData(adapter, table));
        const index = data.findIndex((item) => item && String(item.id) === String(stamped.id));
        if (index >= 0) data[index] = stamped; else data.push(stamped);
        adapter.set(table, data);
        this.bumpRevision(table);
        return { ok: true, record: stamped, bootstrapLocal: true };
      },

      set(table, id, record, options) { return this.upsert(table, { ...record, id: id || record?.id }, options); },

      setAll(table, value, options) {
        options = options || {};
        const list = Array.isArray(value) ? value : value;
        const sample = Array.isArray(list) ? list[0] : null;
        const access = assertWrite(sample, options);
        if (!access.ok) return access;
        if (global.SqliteBridge?.isPrimary?.()) {
          return global.SqliteBridge.setAuthoritative(table, list, options);
        }
        adapter.set(table, list);
        this.bumpRevision(table);
        return { ok: true, bootstrapLocal: true };
      },

      delete(table, id, options) {
        options = options || {};
        const current = this.get(table, id);
        const access = assertWrite(current || { id, branchId: options.branchId }, options);
        if (!access.ok) return access;
        if (global.SqliteBridge?.isPrimary?.()) {
          return global.SqliteBridge.deleteRecord(table, id, options);
        }
        const next = asMutableArray(this.get(table)).filter((item) => item && String(item.id) !== String(id));
        adapter.set(table, next);
        this.bumpRevision(table);
        return { ok: true, deleted: current ? 1 : 0, bootstrapLocal: true };
      },

      getRevision(table) {
        const revision = global.SqliteBridge?.getSnapshot?.()?.revision;
        return Number(revision ?? this._revisions[table]) || 0;
      },

      bumpRevision(table) {
        const next = (Number(this._revisions[table]) || 0) + 1;
        this._revisions[table] = next;
        // Pre-cutover compatibility only. Main SQLite owns runtime revisions.
        if (!global.SqliteBridge?.isPrimary?.()) adapter.set(REVISIONS_KEY, this._revisions);
        return next;
      },

      getAllRevisions() { return { ...this._revisions }; },
      _defaultFor: defaultFor,
    };
    return repository.init();
  }

  function asMutableArray(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  global.RepositoryFactory = {
    REVISIONS_KEY, SYNCED_TABLES, createLocalStorageAdapter, createRepository, isSyncedTable,
  };
  if (!global.Repository && global.DB) {
    global.Repository = createRepository(createLocalStorageAdapter(global.DB));
  }
})(typeof window !== 'undefined' ? window : globalThis);
