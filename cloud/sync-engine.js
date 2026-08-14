/**
 * Sync Engine — Push on write + Poll every 60s (Cloud V2 Sprint 4).
 */
(function (global) {
  'use strict';

  const PUSH_DEBOUNCE_MS = 2000;
  const DEFAULT_POLL_MS = 15000;

  const CONFIG_FIELD_FILES = {
    settingsVersion: 'settings.json',
    pricesVersion: 'prices.json',
    servicesVersion: 'services.json',
    packagesVersion: 'packages.json',
    usersVersion: 'users.json'
  };

  const TABLE_LAYER = {
    settings: { layer: 'config', file: 'settings.json', table: 'settings' },
    services: { layer: 'config', file: 'services.json', table: 'services' },
    packages: { layer: 'config', file: 'packages.json', table: 'packages' },
    users: { layer: 'config', file: 'users.json', table: 'users' },
    cases: { layer: 'operational', file: 'cases.json', table: 'cases' },
    clientsRegistry: { layer: 'operational', file: 'clients.json', table: 'clientsRegistry' },
    bookings: { layer: 'operational', file: 'bookings.json', table: 'bookings' },
    expenses: { layer: 'operational', file: 'expenses.json', table: 'expenses' },
    attendance: { layer: 'operational', file: 'attendance.json', table: 'attendance' },
    doctors: { layer: 'operational', file: 'doctors.json', table: 'doctors' },
    inventoryItems: { layer: 'operational', file: 'inventory-items.json', table: 'inventoryItems' },
    inventorySuppliers: { layer: 'operational', file: 'inventory-suppliers.json', table: 'inventorySuppliers' },
    inventoryMovements: { layer: 'operational', file: 'inventory-movements.json', table: 'inventoryMovements' },
    otRecords: { layer: 'operational', file: 'overtime.json', table: 'otRecords' },
    nextSessions: { layer: 'operational', file: 'next-sessions.json', table: 'nextSessions' },
    employeeLeaveRequests: { layer: 'operational', file: 'employee-leave-requests.json', table: 'employeeLeaveRequests' },
    employeeLedgerAccruals: { layer: 'operational', file: 'employee-ledger-accruals.json', table: 'employeeLedgerAccruals' },
    employeeLedgerPayments: { layer: 'operational', file: 'employee-ledger-payments.json', table: 'employeeLedgerPayments' },
    employeeLedgerEntries: { layer: 'operational', file: 'employee-ledger-entries.json', table: 'employeeLedgerEntries' },
    messageLog: { layer: 'operational', file: 'message-log.json', table: 'messageLog' }
  };

  let _pollTimer = null;
  let _basePollInterval = DEFAULT_POLL_MS;
  let _pollFailures = 0;
  let _pushTimers = new Map();
  let _running = false;
  let _handlers = { online: null, offline: null };

  const BENIGN_SYNC_ERRORS = new Set([
    'no_center_id', 'no_remote_versions', 'no_versions_path', 'not_found',
    'offline', 'drive_not_connected', 'no_backup_bridge'
  ]);

  function isBenignSyncError(msg) {
    if (!msg) return true;
    const m = String(msg).toLowerCase();
    if (BENIGN_SYNC_ERRORS.has(m)) return true;
    return /^(no_remote_versions|no_versions_path|not_found|offline|no_center_id)$/i.test(m);
  }

  function isEnabled() {
    if (!global.CloudMeta?.isCloudV2Enabled?.()) return false;
    return global.DriveAdapter?.isConnected?.() !== false && global.DriveAdapter?.isConnected?.();
  }

  function getCenterId() {
    return global.ConfigLayer?.getCenterId?.() || global.CenterId?.getStoredCenterId?.() || '';
  }

  function getBranchId(branchId) {
    return branchId || global.BranchScope?.getActiveBranchId?.() || 'BR-MAIN';
  }

  /** Device-locked branch only — prevents cross-branch pull on poll */
  function getSyncBranchScope() {
    const user = global.RbacGuard?.resolveAuthoritativeUser?.(global.currentUser) || global.currentUser;
    const active = global.BranchScope?.getActiveBranchId?.() || null;
    const canSwitch = !!(user && (
      user.isDev || ['owner', 'admin', 'manager'].includes(String(user.role || '').toLowerCase()) ||
      global.RbacGuard?.can?.(user, 'branches.switch')
    ));
    if (canSwitch && active) return active;
    if (global.DeviceConfig?.isBranchLocked?.()) {
      return global.DeviceConfig.getLockedBranchId() || null;
    }
    return null;
  }

  function shouldSyncBranch(branchId) {
    if (!branchId) return true;
    const scope = getSyncBranchScope();
    if (!scope) return true;
    return branchId === scope;
  }

  function checkSyncGuard(options) {
    options = options || {};
    if (!global.CloudMeta?.isCloudV2Enabled?.()) return { ok: true, skipped: true };
    if (options.force) return { ok: true, forced: true };
    // V2-4: revoked/pending devices must not push/pull
    try {
      const deviceId =
        global.DeviceConfig?.getDeviceId?.() ||
        global.DeviceConfig?.load?.()?.deviceUuid ||
        global.LicenseIdentity?.getDeviceId?.();
      if (deviceId && global.DeviceRegistry?.canSync) {
        const cs = global.DeviceRegistry.canSync(null, deviceId);
        if (cs && cs.ok === false) {
          return { ok: false, blocked: true, reason: cs.error || 'device_sync_blocked', ...cs };
        }
      }
    } catch { /* empty */ }
    return global.SyncGuard?.canSync?.(options) || { ok: true };
  }

  function blockIfUnsafePull(result, table) {
    if (result?.blocked || result?.hasConflict) {
      global.SyncGuard?.pause?.('conflict', { table, result });
      global.SyncState?.setError?.('sync_blocked_conflict');
      return { ok: false, blocked: true, table, ...result };
    }
    return result;
  }

  function schedulePush(table, branchId, options) {
    options = options || {};
    if (!global.CloudMeta?.isCloudV2Enabled?.()) return;
    branchId = getBranchId(branchId);
    const key = `${table}:${branchId}`;
    if (_pushTimers.has(key)) clearTimeout(_pushTimers.get(key));

    // The authoritative SQLite command already committed the exact record event.
    // This debounce only asks Main to drain that durable outbox.
    _pushTimers.set(key, setTimeout(() => {
      _pushTimers.delete(key);
      flushPending().catch(err => queueFailedPush(table, branchId, err));
    }, PUSH_DEBOUNCE_MS));
  }

  function queueFailedPush(table, branchId, err) {
    const msg = err?.message || String(err || 'push_failed');
        if (!isBenignSyncError(msg)) {
          const handled = global.DriveErrors?.handleFailure?.({ message: msg }) || {};
          if (!handled.classified?.pauseSync) global.SyncState?.setError?.(msg);
        }
  }

  async function pushTable(table, branchId, options) {
    // P0-D: retained solely for an explicit supervised legacy migration. It is
    // never used by normal writes, retry, polling, or startup.
    if (options?.legacyMigration !== true) {
      return { ok: false, blocked: true, error: 'legacy_full_table_writer_disabled' };
    }
    if (global.LegacyBranchMigration?.isPushBlocked?.()) {
      return { ok: false, blocked: true, reason: 'legacy_branch_migration_required' };
    }
    const guard = checkSyncGuard();
    if (!guard.ok && !guard.skipped) return { ok: false, blocked: true, reason: guard.reason };
    if (!isEnabled()) return { ok: false, skipped: true };
    if (global.LicenseIdentity?.verifyGoogleBinding) {
      const idCheck = await global.LicenseIdentity.verifyGoogleBinding();
    if (!idCheck.ok) {
      const handled = global.DriveErrors?.handleFailure?.(idCheck) || {};
      global.SyncState?.setError?.(idCheck.error || 'google_identity_transfer');
      return { ok: false, error: idCheck.error, identity: idCheck, ...handled };
    }
      if (idCheck.needsBind && global.LicenseIdentity.getConnectedGoogleEmail?.()) {
        await global.LicenseIdentity.bindGoogleAccount(global.LicenseIdentity.getConnectedGoogleEmail());
      }
    }
    branchId = getBranchId(branchId);
    const centerId = getCenterId();
    if (!centerId) return { ok: false, error: 'no_center_id' };

    const meta = TABLE_LAYER[table];
    if (!meta) return { ok: false, error: 'unknown_table' };

    let remotePath;
    let payload;

    if (meta.layer === 'config' || (meta.file === 'settings.json' && table === 'settings')) {
      const pack = global.ConfigLayer?.exportBranchPack?.(branchId);
      if (!pack) return { ok: false, error: 'no_config_pack' };
      if (table === 'settings') {
        const paths = [
          { path: global.ConfigLayer.drivePathForFile(centerId, branchId, 'settings.json'), data: pack.settings },
          { path: global.ConfigLayer.drivePathForFile(centerId, branchId, 'prices.json'), data: pack.prices }
        ];
        for (const item of paths) {
          const r = await global.DriveAdapter.uploadJson(item.path, item.data, { overwrite: true });
          if (!r?.ok) {
            queueFailedPush(table, branchId, new Error(r?.message || r?.error || 'upload_failed'));
            return r;
          }
        }
      } else if (table === 'users') {
        const files = [
          { name: 'users.json', data: pack.users },
          { name: 'owner.json', data: pack.owner }
        ];
        for (const item of files) {
          remotePath = global.ConfigLayer?.drivePathForFile?.(centerId, branchId, item.name);
          const up = await global.DriveAdapter.uploadJson(remotePath, item.data, { overwrite: true });
          if (!up?.ok) {
            queueFailedPush(table, branchId, new Error(up?.message || up?.error || 'upload_failed'));
            return up;
          }
        }
      } else {
        if (meta.file === 'settings.json') payload = pack.settings;
        else if (meta.file === 'prices.json') payload = pack.prices;
        else if (meta.file === 'services.json') payload = pack.services;
        else if (meta.file === 'packages.json') payload = pack.packages;
        else if (meta.file === 'users.json') payload = pack.users;
        remotePath = global.ConfigLayer?.drivePathForFile?.(centerId, branchId, meta.file);
        const up = await global.DriveAdapter.uploadJson(remotePath, payload, { overwrite: true });
        if (!up?.ok) {
          queueFailedPush(table, branchId, new Error(up?.message || up?.error || 'upload_failed'));
          return up;
        }
      }
    } else {
      payload = global.OperationalLayer?.exportTable?.(table, branchId);
      remotePath = global.OperationalLayer?.drivePathForTable?.(centerId, branchId, table);
      const upOp = await global.DriveAdapter.uploadJson(remotePath, payload, { overwrite: true });
      if (!upOp?.ok) {
        queueFailedPush(table, branchId, new Error(upOp?.message || upOp?.error || 'upload_failed'));
        return upOp;
      }
    }

    global.SyncState?.dequeuePush?.(meta.layer, meta.table || table, branchId);
    global.SyncState?.touchPush?.();
    global.AuditLogger?.logSyncEvent?.('LOCAL_PUSH', {
      entity: table,
      entityId: branchId,
      summary: `رفع ${table} إلى Google Drive`
    });

    const versions = global.VersionsIndex?.toDriveJson?.(
      global.VersionsIndex?.syncFromRepository?.(global.Repository, centerId, branchId)
    );
    const versionPublication = await global.DriveAdapter.uploadVersions(centerId, versions, branchId);
    if (versionPublication?.ok !== true) {
      const error = versionPublication?.error || versionPublication?.message || 'version_publication_failed';
      queueFailedPush(table, branchId, new Error(error));
      return {
        ok: false,
        error,
        dataPublished: true,
        versionPublished: false,
        retryRequired: true,
        table,
        branchId,
      };
    }
    global.DeviceCache?.snapshotFromLocal?.(branchId).catch(() => {});

    emit('synced', { direction: 'push', table, branchId });
    return { ok: true, table, branchId, remotePath, versionPublished: true };
  }

  async function pushConfigField(field, branchId) {
    branchId = getBranchId(branchId);
    const file = CONFIG_FIELD_FILES[field];
    if (!file) return { ok: false, error: 'unknown_field' };
    const tableMap = {
      settingsVersion: 'settings',
      pricesVersion: 'settings',
      servicesVersion: 'services',
      packagesVersion: 'packages',
      usersVersion: 'users'
    };
    return pushTable(tableMap[field] || 'settings', branchId);
  }

  async function pullConfigFile(branchId, fileName, options) {
    options = options || {};
    const guard = checkSyncGuard();
    if (!guard.ok && !guard.skipped) return { ok: false, blocked: true, reason: guard.reason };
    branchId = getBranchId(branchId);
    const centerId = getCenterId();
    const paths = global.DriveLayout?.configBranchFileCandidates?.(centerId, branchId, fileName)
      || [global.ConfigLayer?.drivePathForFile?.(centerId, branchId, fileName)];
    const dl = global.DriveAdapter?.downloadJsonFirst
      ? await global.DriveAdapter.downloadJsonFirst(paths)
      : await global.DriveAdapter.downloadJson(paths[0]);
    if (!dl?.ok) return dl;

    const pack = { branchId };
    if (fileName === 'settings.json') pack.settings = dl.data;
    else if (fileName === 'prices.json') pack.prices = dl.data;
    else if (fileName === 'services.json') pack.services = dl.data;
    else if (fileName === 'packages.json') pack.packages = dl.data;
    else if (fileName === 'users.json') pack.users = dl.data;
    else if (fileName === 'owner.json') pack.owner = dl.data;
    else return { ok: false, error: 'unknown_config_file' };

    const importConfig = global.ConfigLayer?.importBranchPackAuthoritative
      || global.ConfigLayer?.importBranchPack;
    const imported = blockIfUnsafePull(await importConfig?.(pack, {
      branchId,
      mergeUsers: true,
      remote: true,
      preferRemote: options.preferRemote === true,
      skipVersionBump: true
    }), fileName);
    if (imported?.ok === true && fileName === 'users.json') {
      try {
        const owner = await pullConfigFile(branchId, 'owner.json');
        if (owner?.ok === true) imported.ownerPulled = true;
        else imported.ownerMissing = true;
      } catch {
        imported.ownerMissing = true;
      }
    }
    return imported;
  }

  async function pullOperationalTable(branchId, table) {
    const guard = checkSyncGuard();
    if (!guard.ok && !guard.skipped) return { ok: false, blocked: true, reason: guard.reason };
    branchId = getBranchId(branchId);
    const centerId = getCenterId();
    const canonical = global.OperationalLayer?.drivePathForTable?.(centerId, branchId, table);
    const legacyCandidates = global.DriveLayout?.operationalBranchFileCandidates?.(centerId, branchId, table) || [];
    const paths = [...new Set([canonical, ...legacyCandidates].filter(Boolean))];
    const dl = global.DriveAdapter?.downloadJsonFirst
      ? await global.DriveAdapter.downloadJsonFirst(paths)
      : await global.DriveAdapter.downloadJson(paths[0]);
    if (!dl?.ok) return dl;
    const importOperational = global.OperationalLayer?.importTableAuthoritative
      || global.OperationalLayer?.importTable;
    return blockIfUnsafePull(await importOperational?.(table, dl.data, branchId, {
      remote: true,
      source: 'cloud_pull'
    }), table);
  }

  async function pullBranchDatabase(branchId) {
    const guard = checkSyncGuard();
    if (!guard.ok && !guard.skipped) return { ok: false, blocked: true, reason: guard.reason };
    branchId = getBranchId(branchId);
    const tables = global.OperationalLayer?.OPERATIONAL_TABLES || [];
    const results = [];
    for (const table of tables) {
      try {
        const r = await pullOperationalTable(branchId, table);
        results.push({ table, ok: r?.ok === true, error: r?.ok === true ? null : (r?.error || r?.reason || 'pull_failed') });
      } catch (e) {
        results.push({ table, ok: false, error: e.message });
      }
    }
    const failed = results.filter(item => item.ok !== true);
    return { ok: failed.length === 0, branchId, results, failed };
  }

  async function applyRemoteVersions(remote, options) {
    options = options || {};
    const centerId = getCenterId();
    const local = global.VersionsIndex?.loadLocal?.(centerId);
    const changes = global.VersionsIndex?.diff?.(remote, local) || [];
    const pulled = [];
    const failed = [];
    const scopeBranch = options.branchId || getSyncBranchScope();

    for (const ch of changes) {
      if (ch.branchId && scopeBranch && ch.branchId !== scopeBranch) continue;
      if (ch.layer === 'branch') {
        const file = CONFIG_FIELD_FILES[ch.field];
        if (file && ch.branchId) {
          const result = await pullConfigFile(ch.branchId, file, { preferRemote: true });
          const item = { type: 'config', file, branchId: ch.branchId, result };
          if (result?.ok === true) pulled.push(item);
          else failed.push(item);
        } else if (ch.field === 'databaseVersion' && ch.branchId) {
          const result = await pullBranchDatabase(ch.branchId);
          const item = { type: 'operational', branchId: ch.branchId, result };
          if (result?.ok === true) pulled.push(item);
          else failed.push(item);
        }
      } else if (ch.layer === 'config') {
        const file = CONFIG_FIELD_FILES[ch.field];
        if (file) {
          const bid = scopeBranch || getBranchId();
          const result = await pullConfigFile(bid, file, { preferRemote: true });
          const item = { type: 'config', file, branchId: bid, result };
          if (result?.ok === true) pulled.push(item);
          else failed.push(item);
        }
      }
    }

    if (failed.length === 0 && remote && typeof remote === 'object') {
      global.VersionsIndex?.saveLocal?.({ ...local, ...remote, centerId: centerId || local?.centerId });
    }

    return { ok: failed.length === 0, changes: changes.length, pulled, failed };
  }

  async function poll(options) {
    options = options || {};
    if (!global.CloudMeta?.isCloudV2Enabled?.()) return { ok: false, skipped: true };
    const guard = checkSyncGuard(options);
    if (!guard.ok && !guard.skipped) return { ok: false, blocked: true, reason: guard.reason };
    if (_running) return { ok: false, busy: true };
    _running = true;
    try {
      const centerId = getCenterId();
      if (!centerId) return { ok: false, error: 'no_center_id' };

      if (!global.DriveAdapter?.isConnected?.()) {
        global.SyncState?.setOnline?.(false);
        global.SyncState?.clearError?.();
        return { ok: false, offline: true };
      }

      if (global.LicenseIdentity?.verifyGoogleBinding) {
        const idCheck = await global.LicenseIdentity.verifyGoogleBinding();
    if (!idCheck.ok) {
      const handled = global.DriveErrors?.handleFailure?.(idCheck) || {};
      global.SyncState?.setError?.(idCheck.error || 'google_identity_transfer');
      return { ok: false, error: idCheck.error, identity: idCheck, ...handled };
    }
      }

      global.SyncState?.setOnline?.(true);
      const result = await global.SqliteOutboxBridge?.pullRemote?.({
        includeOrganization: true,
      }) || { ok: false, error: 'operation_sync_bridge_unavailable' };
      global.SyncState?.touchPoll?.();
      emit('synced', { direction: 'poll', ...result });
      return result;
    } catch (e) {
      const msg = e.message || String(e);
        if (!isBenignSyncError(msg)) {
          const handled = global.DriveErrors?.handleFailure?.({ message: msg }) || {};
          if (!handled.classified?.pauseSync) global.SyncState?.setError?.(msg);
        }
      return { ok: false, error: msg };
    } finally {
      _running = false;
    }
  }

  async function flushPending() {
    if (!isEnabled()) return { ok: false, skipped: true };
    const restoreState = global.RestoreReconciliation?.loadState?.();
    if (restoreState?.pushBlocked === true || restoreState?.pushAllowed === false) {
      return {
        ok: false,
        blocked: true,
        reason: 'restore_reconcile_required',
        flushed: 0,
        results: []
      };
    }
    const guard = checkSyncGuard();
    const blocked = !!(guard && guard.ok === false && !guard.skipped);
    const results = [];
    if (blocked) {
      return {
        ok: false,
        blocked: true,
        reason: guard.reason || 'device_sync_blocked',
        flushed: 0,
        results,
      };
    }
    // P0-D: Main owns paths and publishes each immutable record operation.
    if (global.SqliteOutboxBridge?.pushPending) {
      try {
        const published = await global.SqliteOutboxBridge.pushPending({
          includeOrganization: true,
          limit: 50,
        });
        for (const scope of published?.scopes || []) {
          for (const row of scope.results || []) results.push({ ...row, source: 'immutable_operation_log' });
        }
        if (published?.ok === false && results.length === 0) {
          results.push({ ok: false, source: 'immutable_operation_log', error: published.error || 'publish_failed' });
        }
      } catch (err) {
        results.push({ ok: false, source: 'immutable_operation_log', error: String(err.message || err).slice(0, 200) });
      }
    } else {
      results.push({ ok: false, source: 'immutable_operation_log', error: 'operation_sync_bridge_unavailable' });
    }

    const failed = results.filter(item => item.ok !== true);
    return { ok: failed.length === 0, flushed: results.length - failed.length, failed, results };
  }

  function setPollIntervalMs(ms) {
    const interval = Math.max(5000, Math.min(300000, Number(ms) || DEFAULT_POLL_MS));
    const s = global.SyncState?.load?.() || global.SyncState?.defaultState?.() || {};
    s.pollIntervalMs = interval;
    global.SyncState?.save?.(s);
    if (global.CloudMeta?.isCloudV2Enabled?.()) {
      start({ pollIntervalMs: interval });
    }
    return interval;
  }

  function start(options) {
    options = options || {};
    stop();
    if (!global.CloudMeta?.isCloudV2Enabled?.()) return { ok: false, skipped: true };

    const interval = Number(options.pollIntervalMs)
      || global.SyncState?.load?.()?.pollIntervalMs
      || DEFAULT_POLL_MS;
    _basePollInterval = Math.max(5000, interval);
    _pollFailures = 0;

    const scheduleNextPoll = (delayOverride) => {
      if (_pollTimer) clearTimeout(_pollTimer);
      const exponent = Math.min(_pollFailures, 5);
      const backoff = Math.min(5 * 60 * 1000, _basePollInterval * (2 ** exponent));
      const jitter = 0.85 + Math.random() * 0.3;
      const delay = Math.max(1000, Number(delayOverride) || Math.round(backoff * jitter));
      _pollTimer = setTimeout(async () => {
        let result;
        try { result = await poll(); }
        catch (error) { result = { ok: false, error: error?.message || String(error) }; }
        if (result?.ok || result?.busy || result?.skipped || result?.offline) _pollFailures = 0;
        else _pollFailures += 1;
        scheduleNextPoll();
      }, delay);
    };
    scheduleNextPoll(3000);

    if (typeof window !== 'undefined') {
      _handlers.online = () => {
        global.SyncState?.setOnline?.(true);
        _pollFailures = 0;
        flushPending().catch(() => {});
        poll().catch(() => {});
      };
      _handlers.offline = () => global.SyncState?.setOnline?.(false);
      window.addEventListener('online', _handlers.online);
      window.addEventListener('offline', _handlers.offline);
    }

    setTimeout(() => { flushPending().catch(() => {}); }, 3000);

    return { ok: true, pollIntervalMs: interval };
  }

  function stop() {
    if (_pollTimer) {
      clearTimeout(_pollTimer);
      _pollTimer = null;
    }
    _pushTimers.forEach(t => clearTimeout(t));
    _pushTimers.clear();
    _pollFailures = 0;
    if (typeof window !== 'undefined' && _handlers.online) {
      window.removeEventListener('online', _handlers.online);
      window.removeEventListener('offline', _handlers.offline);
      _handlers.online = null;
      _handlers.offline = null;
    }
  }

  function isRunning() {
    return !!_pollTimer;
  }

  const READINESS_LABELS_AR = Object.freeze({
    cloud_v2_disabled: 'تفعيل Cloud V2',
    google_not_connected: 'ربط حساب Google',
    center_id: 'Center ID / تفعيل الترخيص',
    branch_id: 'ربط الفرع',
    device_id: 'تسجيل الجهاز',
    device_sync_blocked: 'الجهاز محظور من المزامنة',
    sync_guard_blocked: 'حارس المزامنة موقوف — اضغط استئناف',
    unsafe: 'حارس المزامنة أوقف المزامنة بعد تحليل البيانات — اضغط استئناف المزامنة',
    UNSAFE: 'حارس المزامنة أوقف المزامنة بعد تحليل البيانات — اضغط استئناف المزامنة',
    analysis_required: 'يلزم تحليل/تأكيد مصدر البيانات قبل المزامنة',
    sync_paused: 'المزامنة موقوفة مؤقتاً',
    conflict: 'يوجد تعارض بيانات يحتاج قراراً',
    no_analysis: 'لا يوجد تحليل بيانات معتمد بعد',
  });

  function normalizeMissingCode(code) {
    const raw = String(code || '').trim();
    if (!raw) return 'sync_guard_blocked';
    const lower = raw.toLowerCase();
    if (lower === 'unsafe') return 'unsafe';
    return raw;
  }

  /**
   * Detailed readiness — never a vague "not ready" without reasons.
   */
  function getReadiness(options) {
    options = options || {};
    const missing = [];
    const googleOk = !!global.DriveAdapter?.isConnected?.()
      || !!(global.settings?.backup?.providers?.google?.connected
        && !global.settings?.backup?.providers?.google?.userDisconnected);
    const cloudV2 = !!global.CloudMeta?.isCloudV2Enabled?.();
    const centerId = getCenterId();
    const branchId = getSyncBranchScope() || getBranchId();
    const deviceId =
      global.DeviceConfig?.getDeviceId?.()
      || global.DeviceConfig?.load?.()?.deviceUuid
      || global.LicenseIdentity?.getDeviceId?.()
      || null;

    if (!cloudV2) missing.push('cloud_v2_disabled');
    if (!googleOk) missing.push('google_not_connected');
    if (!centerId) missing.push('center_id');
    if (!branchId) missing.push('branch_id');
    if (!deviceId) missing.push('device_id');

    try {
      if (deviceId && global.DeviceRegistry?.canSync) {
        const cs = global.DeviceRegistry.canSync(null, deviceId);
        if (cs && cs.ok === false) missing.push(cs.error || 'device_sync_blocked');
      }
    } catch { /* empty */ }

    const guard = checkSyncGuard({ force: !!options.force });
    let guardPaused = false;
    if (guard && guard.ok === false && !guard.skipped) {
      guardPaused = true;
      missing.push(normalizeMissingCode(guard.reason || 'sync_guard_blocked'));
    }

    const missingNorm = missing.map(normalizeMissingCode);
    const missingLabelsAr = missingNorm.map((code) => READINESS_LABELS_AR[code] || code);
    const hardMissing = missingNorm.filter((c) => !['unsafe', 'UNSAFE', 'sync_paused', 'analysis_required', 'sync_guard_blocked', 'no_analysis'].includes(c));
    // Guard pause alone is recoverable — expose resume hint but allow force paths.
    const ready = hardMissing.length === 0 && !guardPaused && cloudV2 && googleOk && !!centerId;
    const recoverablePause = hardMissing.length === 0 && guardPaused && cloudV2 && googleOk && !!centerId;
    return {
      ready,
      ok: ready,
      recoverablePause,
      missing: missingNorm,
      missingLabelsAr,
      state: ready
        ? (isRunning() ? 'RUNNING' : 'READY_NOT_STARTED')
        : (recoverablePause ? 'SYNC_PAUSED_RECOVERABLE' : 'WAITING_FOR_PREREQUISITES'),
      enabled: isEnabled(),
      running: isRunning(),
      cloudV2,
      googleConnected: googleOk,
      centerId: centerId || null,
      branchId: branchId || null,
      deviceId: deviceId || null,
      messageAr: ready
        ? (isRunning() ? 'محرك المزامنة يعمل' : 'محرك المزامنة جاهز — لم يُبدأ بعد')
        : (recoverablePause
          ? `المزامنة موقوفة مؤقتاً — ${missingLabelsAr.join('؛ ')}. اضغط «استئناف المزامنة».`
          : `محرك المزامنة غير جاهز — المتطلبات الناقصة: ${missingLabelsAr.join('؛ ')}`),
    };
  }

  function resumeFromGuard(reason) {
    try {
      global.SyncGuard?.resume?.({ reason: reason || 'manual_resume' }, 'sync');
    } catch { /* empty */ }
    return getReadiness({ force: false });
  }

  /**
   * One-shot pull + flush (manual "مزامنة الآن" and BootFlow initial sync).
   */
  async function runOnce(options) {
    options = options || {};
    const readiness = getReadiness(options);
    if (!readiness.ready && !options.force) {
      return {
        ok: false,
        error: 'sync_engine_not_ready',
        readiness,
        message: readiness.messageAr,
      };
    }
    if (!isEnabled() && !options.force) {
      return { ok: false, skipped: true, reason: 'cloud_v2_or_drive_disabled', readiness };
    }

    const guard = checkSyncGuard(options);
    if (guard && !guard.ok && !guard.skipped && !options.force) {
      return { ok: false, blocked: true, ...guard, readiness };
    }

    const direction = ['pull', 'push', 'both'].includes(options.direction) ? options.direction : 'both';
    let pull = { ok: true, skipped: true, reason: 'direction_push_only' };
    let push = { ok: true, skipped: true, reason: 'direction_pull_only' };
    if (direction !== 'push') {
      try {
        pull = await poll(options);
      } catch (err) {
        pull = { ok: false, error: err.message || String(err) };
      }
    }
    if (direction !== 'pull') {
      try {
        push = await flushPending();
      } catch (err) {
        push = { ok: false, error: err.message || String(err) };
      }
    }

    const pullOk = direction === 'push' || pull?.ok === true;
    const pushOk = direction === 'pull' || push?.ok === true;
    const ok = pullOk && pushOk;
    return {
      ok,
      pull,
      push,
      readiness: getReadiness({ force: true }),
      at: new Date().toISOString(),
    };
  }

  function getStatus() {
    return {
      enabled: isEnabled(),
      running: isRunning(),
      readiness: getReadiness(),
      ...global.SyncState?.getStatus?.()
    };
  }

  const _events = {};

  function on(event, handler) {
    if (!_events[event]) _events[event] = [];
    _events[event].push(handler);
  }

  function emit(event, data) {
    (_events[event] || []).forEach(fn => { try { fn(data); } catch { /* empty */ } });
  }

  global.SyncEngine = {
    PUSH_DEBOUNCE_MS,
    DEFAULT_POLL_MS,
    schedulePush,
    push: pushTable,
    pushTable,
    poll,
    flushPending,
    start,
    stop,
    isRunning,
    runOnce,
    getReadiness,
    setPollIntervalMs,
    getSyncBranchScope,
    shouldSyncBranch,
    checkSyncGuard,
    getStatus,
    resumeFromGuard,
    on,
    pullConfigFile,
    pullOperationalTable,
    pullBranchDatabase,
    applyRemoteVersions
  };
})(typeof window !== 'undefined' ? window : globalThis);
