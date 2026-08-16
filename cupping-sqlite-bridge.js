/**
 * Renderer SQLite bridge — V2-5.9 authoritative SoT (no optimistic operational cache).
 *
 * Path:
 *   UI action → SQLite transaction (+ outbox) → success → mirror cache + memory
 * On failure:
 *   no success UI, no divergent cache, no outbox (tx rolled back), reload last commit
 */
(function (global) {
  'use strict';

  const CORE_TABLES = ['clientsRegistry', 'cases', 'bookings', 'doctors', 'attendance', 'expenses'];
  const KV_MIRROR = [
    'users', 'settings', 'packages', 'services', 'otRecords', 'budget', 'invoiceCounter',
    'clientFileCounter', 'nextSessions', 'employeeLeaveRequests', 'employeeLedgerAccruals',
    'employeeLedgerPayments', 'employeeLedgerEntries', 'importHistory',
    'messageLog', 'backupLog', 'backupRegistry', 'activityLog', 'hardwareLog',
    'cashDrawerSession',
    'payrollPeriods', 'payrollEntries', 'commissions', 'invoices', 'payments', 'attachments',
    // Durable operational/support state. Backup V2 archives SQLite, therefore
    // these must not remain stranded in Chromium localStorage.
    'systemLogs', 'logCounter', 'communicationWebhookLog', 'communicationQueue',
    'importStudioLog', 'luxQueue', 'backupUploadQueue', 'backupOpCounter',
    'preImportBackup', 'devContact', 'tablePageSize', 'logsPageSize',
    // V2-5.10 Category B: inventory synced tables → SQLite KV until dedicated tables land
    'inventoryItems', 'inventorySuppliers', 'inventoryMovements',
    '__tdw_owner_profile__', '__tdw_owner_session_epoch__', '__tdw_owner_setup__',
    // sync/attachment meta (not LS-only)
    '__tdw_conflict_queue__',
    '__tdw_conflict_archive__',
    '__tdw_conflict_archive__',
    '__tdw_attachment_manifest__',
    '__tdw_meta__', '__tdw_cloud_license__', '__tdw_drive_folders__',
    '__tdw_repo_revisions__', '__tdw_versions__', '__tdw_sync_state__',
    '__tdw_branch_summaries__', '__tdw_audit_log__', '__tdw_audit_pending_drive__',
    '__tdw_branch_idempotency__',
    '__tdw_device_config__', '__tdw_branch_creation_pending__',
    '__tdw_device_registry__', '__tdw_license_activation_state__',
    'commercial_license_data_v2', 'commercial_license_audit_v2',
  ];
  const OPERATIONAL_KEYS = new Set(CORE_TABLES.concat([
    'users', 'settings', 'packages', 'services', '__tdw_device_registry__',
    'inventoryItems', 'inventorySuppliers', 'inventoryMovements',
    'otRecords', 'nextSessions', 'employeeLeaveRequests',
    'employeeLedgerAccruals', 'employeeLedgerPayments', 'employeeLedgerEntries',
    'messageLog',
    'cashDrawerSession', 'budget', 'invoiceCounter', 'clientFileCounter', 'luxQueue',
    'payrollPeriods', 'payrollEntries', 'commissions', 'invoices', 'payments', 'attachments',
    '__tdw_conflict_queue__',
    '__tdw_attachment_manifest__',
  ]));
  const BRANCH_STATE_KEYS = new Set([
    'budget', 'invoiceCounter', 'clientFileCounter', 'luxQueue', 'cashDrawerSession',
  ]);
  const OWNER_STATE_KEYS = new Set([
    '__tdw_owner_profile__', '__tdw_owner_session_epoch__', '__tdw_owner_setup__'
  ]);
  const UI_ONLY_KEYS = new Set([
    '__tdw_ui_theme__', '__tdw_ui_lang__', '__tdw_last_tab__', '__tdw_wizard_ui__',
    // BootFlow navigation is pre-auth UI state. Keeping it in the explicit
    // UI-only cache prevents SQLite cutover from making every Next/Back click
    // a denied, silently discarded operational write.
    '__tdw_boot_wizard__',
  ]);
  const KV_ZERO_DEFAULT_KEYS = new Set([
    'invoiceCounter', 'clientFileCounter', 'logCounter', 'backupOpCounter',
    '__tdw_owner_session_epoch__'
  ]);
  const KV_NULL_DEFAULT_KEYS = new Set([
    'cashDrawerSession', 'preImportBackup', 'devContact',
    '__tdw_owner_profile__', '__tdw_owner_setup__'
  ]);
  const KV_OBJECT_DEFAULT_KEYS = new Set([
    'settings', 'luxQueue', '__tdw_attachment_manifest__', '__tdw_meta__',
    '__tdw_cloud_license__', '__tdw_drive_folders__', '__tdw_repo_revisions__',
    '__tdw_versions__', '__tdw_sync_state__', '__tdw_branch_summaries__',
    '__tdw_branch_idempotency__', '__tdw_device_registry__',
    '__tdw_license_activation_state__'
  ]);

  function defaultForKv(key) {
    if (KV_ZERO_DEFAULT_KEYS.has(key) || key.endsWith('Counter')) return 0;
    if (KV_NULL_DEFAULT_KEYS.has(key)) return null;
    if (KV_OBJECT_DEFAULT_KEYS.has(key)) return {};
    return [];
  }

  const state = {
    ready: false,
    sqlitePrimary: false,
    lastError: null,
    status: null,
    lastCommitted: {},
    pendingKeys: new Set(),
    data: {},
    revision: 0,
    subscribers: new Set(),
  };

  function api() {
    return global.cuppingElectron?.database || global.tadawi?.database || null;
  }

  function rawSet(k, v) {
    if (!UI_ONLY_KEYS.has(k)) return false;
    // Never call DB.set here — it may be the sqlite write-through wrapper and recurse.
    if (typeof DB !== 'undefined' && DB.__rawSet) {
      DB.__rawSet(k, v);
    } else {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* empty */ }
    }
    state.data[k] = v;
    return true;
  }

  /** UI-only keys are Chromium-local; never let a stale in-memory cache shadow them. */
  function seedUiOnlyFromLocalStorage() {
    if (typeof DB === 'undefined') return;
    for (const k of UI_ONLY_KEYS) {
      try {
        const raw = localStorage.getItem(k);
        if (raw) state.data[k] = JSON.parse(raw);
      } catch { /* empty */ }
    }
  }

  function setUiOnly(key, value) {
    if (!UI_ONLY_KEYS.has(key)) return { ok: false, error: 'not_ui_only_key' };
    return rawSet(key, value) ? { ok: true, uiOnly: true } : { ok: false, error: 'ui_only_write_failed' };
  }

  function syncMemory(tableKey, value) {
    if (tableKey === 'clientsRegistry') global.clientsRegistry = value;
    else if (tableKey === 'cases') global.cases = value;
    else if (tableKey === 'bookings') global.bookings = value;
    else if (tableKey === 'doctors') global.doctors = value;
    else if (tableKey === 'attendance') global.attendance = value;
    else if (tableKey === 'expenses') global.expenses = value;
    else if (tableKey === 'users') global.users = value;
    else if (tableKey === 'services') global.services = value;
    else if (tableKey === 'packages') global.packages = value;
    else if (tableKey === 'settings' && value && !Array.isArray(value)) global.settings = value;
    state.data[tableKey] = value;
  }

  function publishState(data, revision) {
    state.data = { ...state.data, ...(data || {}) };
    state.revision = Number(revision) || state.revision || 0;
    try { global.applyAuthoritativeState?.(state.data, state.revision); } catch { /* empty */ }
    for (const subscriber of state.subscribers) {
      try { subscriber({ data: state.data, revision: state.revision }); } catch { /* empty */ }
    }
  }

  function rememberCommit(key, value) {
    try {
      state.lastCommitted[key] = typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
    } catch {
      state.lastCommitted[key] = value;
    }
  }

  function restoreLastCommit(key) {
    if (!Object.prototype.hasOwnProperty.call(state.lastCommitted, key)) return false;
    const prev = state.lastCommitted[key];
    syncMemory(key, prev);
    publishState({ [key]: prev }, state.revision);
    return true;
  }

  function collectSnapshotFromLocal() {
    const snap = {};
    const read = (k, def) => {
      if (typeof DB !== 'undefined' && (DB.__rawSet || DB.get)) {
        try {
          if (DB.get) return DB.get(k, def);
        } catch { /* empty */ }
      }
      try {
        const raw = localStorage.getItem(k);
        return raw ? JSON.parse(raw) : def;
      } catch { return def; }
    };
    snap.clientsRegistry = read('clientsRegistry', []);
    snap.cases = read('cases', []);
    snap.bookings = read('bookings', []);
    snap.doctors = read('doctors', []);
    snap.attendance = read('attendance', []);
    snap.expenses = read('expenses', []);
    for (const k of KV_MIRROR) snap[k] = read(k, defaultForKv(k));
    if (typeof buildFullBackupObject === 'function') {
      try {
        const full = buildFullBackupObject();
        return { ...snap, ...full };
      } catch { /* use snap */ }
    }
    return snap;
  }

  function hasMeaningfulLocalSnapshot(snapshot) {
    snapshot = snapshot || {};
    const coreHasRows = CORE_TABLES.some((key) => Array.isArray(snapshot[key]) && snapshot[key].length > 0);
    const users = Array.isArray(snapshot.users) ? snapshot.users : [];
    const hasUsableUser = users.some((user) => {
      const password = String(user?.password || '');
      return user && user.active !== false
        && String(user.role || '').toLowerCase() === 'owner'
        && user.mustChangePassword !== true && user.seedDefaultPassword !== true
        && /^(?:pbkdf2:|pbkdf2v2:|b64:)/.test(password);
    });
    let completedSetup = false;
    try { completedSetup = localStorage.getItem('__tdw_boot_complete__') === '1'; } catch { /* empty */ }
    const ownerProfile = snapshot.__tdw_owner_profile__;
    const hasOwnerProfile = !!(ownerProfile && !Array.isArray(ownerProfile)
      && typeof ownerProfile === 'object' && Object.keys(ownerProfile).length > 0);
    return coreHasRows || hasUsableUser || completedSetup || hasOwnerProfile;
  }

  /** Load SQLite before any login/setup decision, or migrate an existing LS install once. */
  async function initializeAtStartup(options) {
    options = options || {};
    const db = api();
    if (!db) return { ok: false, skipped: true, error: 'database_api_unavailable' };
    const status = await db.status();
    if (status?.sqlitePrimary) {
      return hydrateIntoMemory();
    }

    const snapshot = collectSnapshotFromLocal();
    if (options.bootstrapIfMeaningful !== false && hasMeaningfulLocalSnapshot(snapshot)) {
      const migrated = await db.bootstrapFromLocal?.(snapshot, {
        sourceLabel: 'startup-localStorage-upgrade',
      });
      if (migrated?.ok) return hydrateIntoMemory();
      if (!migrated?.skipped && migrated?.error !== 'sqlite_primary_already_enabled') return migrated;
    }
    state.status = status;
    return { ok: true, deferred: true, status };
  }

  /** Persist the complete restored/setup state before the terminal setup relaunch. */
  async function finalizeSetupData() {
    const db = api();
    if (!db) return { ok: false, error: 'database_api_unavailable' };
    const status = await db.status();
    if (status?.sqlitePrimary) {
      // A verified Backup V2 restore already swapped the authoritative database.
      // Pre-login setup must never rewrite a primary DB through privileged channels.
      return hydrateIntoMemory();
    }

    const snapshot = collectSnapshotFromLocal();
    const migrated = await db.bootstrapFromLocal?.(snapshot, {
      sourceLabel: 'completed-first-setup',
      force: true,
    });
    if (!migrated?.ok) return migrated || { ok: false, error: 'setup_sqlite_bootstrap_failed' };
    return hydrateIntoMemory();
  }

  async function migrateAndEnable(options) {
    const db = api();
    if (!db) return { ok: false, error: 'database_api_unavailable' };
    const snapshot = options?.snapshot || collectSnapshotFromLocal();
    const report = await db.migrateFromBackup(snapshot, {
      sourceLabel: options?.sourceLabel || 'localStorage',
      dryRun: !!options?.dryRun,
    });
    if (!report?.ok) return report;
    if (options?.dryRun) return report;
    try { await db.enableSqlitePrimary?.(); } catch { /* empty */ }
    return hydrateIntoMemory();
  }

  async function ensureSqlitePrimaryEnabled() {
    const db = api();
    if (!db) return { ok: false, error: 'database_api_unavailable' };
    if (state.sqlitePrimary) return { ok: true, already: true };
    try {
      const st = await db.enableSqlitePrimary?.();
      state.status = st || (await db.status?.());
      state.sqlitePrimary = !!(state.status && state.status.sqlitePrimary);
      if (state.sqlitePrimary) installWriteThrough();
      return { ok: !!state.sqlitePrimary, status: state.status };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  async function hydrateIntoMemory() {
    const db = api();
    if (!db) return { ok: false, error: 'database_api_unavailable' };
    const res = await db.hydrate();
    if (!res?.ok) return res;
    const data = res.data || {};
    state.status = res.status;
    state.sqlitePrimary = !!(res.status && res.status.sqlitePrimary);
    if (!state.sqlitePrimary) {
      try {
        await db.enableSqlitePrimary?.();
        const st = await db.status?.();
        state.status = st;
        state.sqlitePrimary = !!(st && st.sqlitePrimary);
      } catch { /* empty */ }
    }

    const apply = (k, v) => {
      rememberCommit(k, v);
      syncMemory(k, v);
    };
    apply('clientsRegistry', data.clientsRegistry || []);
    apply('cases', data.cases || []);
    apply('bookings', data.bookings || []);
    apply('doctors', data.doctors || []);
    apply('attendance', data.attendance || []);
    apply('expenses', data.expenses || []);
    for (const k of KV_MIRROR) {
      if (data[k] !== undefined) apply(k, data[k]);
    }
    // Pre-auth Google connection projection (written by setupCommitGoogleConnection
    // before a centerId exists). Apply onto settings so discovery/hasGoogle work
    // after restart without an RBAC session.
    const setupGoogle = data.__tdw_setup_google__;
    const setupShadow = data.__tdw_setup_settings_shadow__;
    if (setupShadow?.backup && (!data.settings || typeof data.settings !== 'object')) {
      apply('settings', setupShadow);
    } else if (setupGoogle && typeof setupGoogle === 'object') {
      const current = (data.settings && typeof data.settings === 'object')
        ? data.settings
        : (global.settings || {});
      const next = {
        ...current,
        backup: {
          ...(current.backup || {}),
          providers: {
            ...(current.backup?.providers || {}),
            google: {
              ...(current.backup?.providers?.google || {}),
              ...setupGoogle,
            },
          },
          cloudProvider: 'google',
          cloudEnabled: setupGoogle.connected === true,
          cloudDb: {
            ...(current.backup?.cloudDb || {}),
            enabled: setupGoogle.connected === true
              ? true
              : !!(current.backup?.cloudDb || {}).enabled,
          },
        },
      };
      apply('settings', next);
    }

    publishState(data, res.revision);
    // One-time cutover cleanup. Removal happens only after verified SQLite hydrate;
    // operational data is never written back to Chromium storage.
    if (state.sqlitePrimary) {
      for (const key of new Set(CORE_TABLES.concat(KV_MIRROR, Array.from(OPERATIONAL_KEYS)))) {
        try { localStorage.removeItem(key); } catch { /* empty */ }
      }
    }

    state.ready = true;
    installWriteThrough();
    seedUiOnlyFromLocalStorage();
    return { ok: true, status: state.status, report: res, sqlitePrimary: state.sqlitePrimary };
  }

  function commandId() {
    try { return crypto.randomUUID(); } catch { return `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  }

  function recordsForValue(key, value) {
    if (Array.isArray(value)) return value;
    if (CORE_TABLES.includes(key) === false && (OPERATIONAL_KEYS.has(key) || KV_MIRROR.includes(key))) {
      return [{ id: '__singleton__', value }];
    }
    return [];
  }

  async function runTypedCommand(key, value, options) {
    const db = api();
    if (!db?.command) return { ok: false, error: 'typed_database_command_unavailable' };
    const records = recordsForValue(key, value);
    if (!records.length && Array.isArray(value) === false) {
      return { ok: false, error: 'operational_records_required' };
    }
    return db.command({
      commandId: options?.commandId || commandId(),
      entity: key,
      action: records.length === 1 && options?.single === true ? 'upsert' : 'replaceAll',
      ...(records.length === 1 && options?.single === true ? { record: records[0] } : { records }),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Authoritative operational commit. Cache/memory updated ONLY after SQLite success.
   */
  async function commitOperational(tableKey, records, options) {
    options = options || {};
    const db = api();
    if (!db) return { ok: false, error: 'database_api_unavailable' };
    if (!state.sqlitePrimary) {
      const en = await ensureSqlitePrimaryEnabled();
      if (!en.ok) return { ok: false, error: en.error || 'sqlite_primary_required' };
    }
    if (global.LegacyBranchMigration?.isPushBlocked?.()) {
      return { ok: false, error: 'legacy_branch_migration_required' };
    }
    const list = Array.isArray(records) ? records : [];
    state.pendingKeys.add(tableKey);
    try {
      const res = await runTypedCommand(tableKey, list, options);
      if (res && res.ok === false) {
        state.lastError = res.error || 'commit_failed';
        restoreLastCommit(tableKey);
        return { ok: false, error: state.lastError, res };
      }
      const hydrated = await hydrateIntoMemory();
      if (hydrated?.ok === false) return hydrated;
      state.lastError = null;
      global.SyncEngine?.schedulePush?.(tableKey, global.BranchContexts?.getOperationalWriteBranch?.(), { skipEnqueue: true });
      return { ...res, ok: true, tableKey, authoritative: true };
    } catch (e) {
      state.lastError = String(e?.message || e);
      restoreLastCommit(tableKey);
      return { ok: false, error: state.lastError };
    } finally {
      state.pendingKeys.delete(tableKey);
    }
  }

  async function commitKv(key, value, options) {
    options = options || {};
    const db = api();
    if (!db) return { ok: false, error: 'database_api_unavailable' };
    if (!state.sqlitePrimary) {
      const en = await ensureSqlitePrimaryEnabled();
      if (!en.ok) return { ok: false, error: en.error || 'sqlite_primary_required' };
    }
    state.pendingKeys.add(key);
    try {
      const isOperational = OPERATIONAL_KEYS.has(key)
        || BRANCH_STATE_KEYS.has(key)
        || OWNER_STATE_KEYS.has(key)
        || ['users', 'settings', 'packages', 'services'].includes(key);
      const res = isOperational
        ? await runTypedCommand(key, value, options)
        : await db.persistKv(key, value);
      if (res && res.ok === false) {
        state.lastError = res.error || 'kv_persist_failed';
        restoreLastCommit(key);
        return { ok: false, error: state.lastError };
      }
      if (isOperational) {
        const hydrated = await hydrateIntoMemory();
        if (hydrated?.ok === false) return hydrated;
      } else {
        rememberCommit(key, value);
        syncMemory(key, value);
        publishState({ [key]: value }, state.revision);
      }
      state.lastError = null;
      return { ...res, ok: true, key, authoritative: true };
    } catch (e) {
      state.lastError = String(e?.message || e);
      restoreLastCommit(key);
      return { ok: false, error: state.lastError };
    } finally {
      state.pendingKeys.delete(key);
    }
  }

  /**
   * Async authoritative setter for UI call sites.
   */
  async function setAuthoritative(key, value, options) {
    options = options || {};
    if (UI_ONLY_KEYS.has(key)) {
      rawSet(key, value);
      return { ok: true, uiOnly: true };
    }
    if (CORE_TABLES.includes(key)) return commitOperational(key, Array.isArray(value) ? value : [], options);
    if (KV_MIRROR.includes(key) || OPERATIONAL_KEYS.has(key)) return commitKv(key, value, options);
    return { ok: false, error: 'unclassified_persistence_key_denied', key };
  }

  async function deleteRecord(key, entityId, options) {
    const db = api();
    if (!db?.command) return { ok: false, error: 'typed_database_command_unavailable' };
    state.pendingKeys.add(key);
    try {
      const res = await db.command({
        commandId: options?.commandId || commandId(),
        entity: key,
        action: 'delete',
        entityId: String(entityId || ''),
        timestamp: new Date().toISOString(),
      });
      if (res?.ok === false) return res;
      const hydrated = await hydrateIntoMemory();
      return hydrated?.ok === false ? hydrated : res;
    } finally {
      state.pendingKeys.delete(key);
    }
  }

  async function upsertRecord(key, record, options) {
    const db = api();
    if (!db?.command) return { ok: false, error: 'typed_database_command_unavailable' };
    if (!record?.id) return { ok: false, error: 'entity_id_required' };
    state.pendingKeys.add(key);
    try {
      const res = await db.command({
        commandId: options?.commandId || commandId(),
        entity: key,
        action: 'upsert',
        record,
        timestamp: new Date().toISOString(),
      });
      if (res?.ok === false) return res;
      const hydrated = await hydrateIntoMemory();
      return hydrated?.ok === false ? hydrated : res;
    } finally {
      state.pendingKeys.delete(key);
    }
  }

  function installWriteThrough() {
    if (typeof DB === 'undefined') return;
    if (!DB.__rawGet) {
      const readCandidate = DB.raw?.get ? DB.raw.get.bind(DB.raw) : DB.get.bind(DB);
      DB.__rawGet = readCandidate;
    }
    if (!DB.__rawSet) {
      // Prefer unbridged raw if DbBridge wrapped DB.
      const candidate = DB.raw?.set ? DB.raw.set.bind(DB.raw) : DB.set.bind(DB);
      DB.__rawSet = candidate;
    }
    if (DB.__sqliteWriteThrough) {
      // Re-install to drop optimistic paths after upgrades.
      DB.__sqliteWriteThrough = false;
    }
    const baseRaw = DB.__rawSet;
    const baseRead = DB.__rawGet;
    DB.get = function sqliteAuthoritativeGet(k, def) {
      // BootFlow wizard path and other UI-only keys must read the Chromium-local
      // mirror. state.data can hold a stale snapshot from an earlier hydrate while
      // localStorage already has startPath('existing'|'new').
      if (UI_ONLY_KEYS.has(k)) {
        try {
          const raw = localStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw);
            state.data[k] = parsed;
            return parsed;
          }
        } catch { /* empty */ }
        const value = baseRead(k, def);
        if (value !== def) state.data[k] = value;
        return value;
      }
      if (state.sqlitePrimary && Object.prototype.hasOwnProperty.call(state.data, k)) {
        const value = state.data[k];
        return value === undefined ? def : value;
      }
      return baseRead(k, def);
    };
    DB.set = function sqliteAuthoritativeSet(k, v) {
      if (UI_ONLY_KEYS.has(k)) {
        baseRaw(k, v);
        state.data[k] = v;
        return Promise.resolve({ ok: true, uiOnly: true });
      }
      const db = api();
      // Once SQLite is primary, every classified write uses one awaited contract.
      // Renderer callers cannot opt out of ownership checks or claim a trusted source.
      if (db && state.sqlitePrimary) return setAuthoritative(k, v);

      // Pre-cutover/bootstrap compatibility. This path is permanently unreachable
      // after SQLite has been enabled and is intentionally excluded from runtime use.
      if (!db || !state.sqlitePrimary) {
        baseRaw(k, v);
        rememberCommit(k, v);
        return Promise.resolve({ ok: true, bootstrapLocal: true });
      }
      return Promise.resolve({ ok: false, error: 'persistence_state_unreachable' });
    };
    DB.__sqliteWriteThrough = true;
    DB.__noOptimisticOperational = true;
    seedUiOnlyFromLocalStorage();
    DB.commitOperational = commitOperational;
    DB.setAuthoritative = setAuthoritative;
    DB.upsertRecord = upsertRecord;
    DB.deleteRecord = deleteRecord;
    DB.restoreLastCommit = restoreLastCommit;
    try { global.BootFlow?.installWizardDbReadAuthority?.(); } catch { /* empty */ }
  }

  async function status() {
    const db = api();
    if (!db) return { ok: false, error: 'database_api_unavailable' };
    state.status = await db.status();
    state.sqlitePrimary = !!(state.status && state.status.sqlitePrimary);
    return state.status;
  }

  function isPrimary() {
    return !!state.sqlitePrimary;
  }

  global.SqliteBridge = {
    setUiOnly,
    seedUiOnlyFromLocalStorage,
    migrateAndEnable,
    initializeAtStartup,
    finalizeSetupData,
    hydrateIntoMemory,
    ensureSqlitePrimaryEnabled,
    commitOperational,
    commitKv,
    setAuthoritative,
    upsertRecord,
    deleteRecord,
    restoreLastCommit,
    status,
    isPrimary,
    collectSnapshotFromLocal,
    CORE_TABLES,
    KV_MIRROR,
    OPERATIONAL_KEYS,
    BRANCH_STATE_KEYS,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      state.subscribers.add(listener);
      return () => state.subscribers.delete(listener);
    },
    getSnapshot: () => ({ data: state.data, revision: state.revision }),
    getState: () => ({
      ready: state.ready,
      sqlitePrimary: state.sqlitePrimary,
      lastError: state.lastError,
      pending: Array.from(state.pendingKeys),
      hasLastCommitted: Object.keys(state.lastCommitted),
    }),
    getLastError: () => state.lastError,
  };
})(typeof window !== 'undefined' ? window : global);
