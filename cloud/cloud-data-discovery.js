/**
 * V2-5.10 — Fast Cloud Data Discovery + Confirmed Restore (renderer).
 * Discovery is metadata-only. Restore starts only after explicit user confirm.
 * SyncEngine must NOT start during discovery.
 */
(function (global) {
  'use strict';

  const DISCOVERY_TIMEOUT_MS = 180000;
  const NO_PROGRESS_WATCHDOG_MS = 30000;
  const DOWNLOAD_ACTIVITY_STALL_MS = 45000;
  const RESTORE_OPERATION_TIMEOUT_MS = 600000;
  const RESTORE_HEARTBEAT_MS = 2000;

  const BACKUP_V2_RESTORE_STAGES = [
    { id: 'verify_point', label: 'التحقق من النسخة', weight: 5 },
    { id: 'local_safety', label: 'تجهيز نسخة الأمان المحلية', weight: 5 },
    { id: 'download_db', label: 'تنزيل ملف Backup V2', weight: 25 },
    { id: 'checksums', label: 'التحقق من الأرشيف والبصمات', weight: 10 },
    { id: 'staging', label: 'فك النسخة إلى Staging', weight: 15 },
    { id: 'sqlite_integrity', label: 'SQLite integrity check', weight: 8 },
    { id: 'atomic_swap', label: 'Atomic swap', weight: 7 },
    { id: 'hydrate_memory', label: 'تحميل البيانات المستعادة', weight: 5 },
    { id: 'restart_prep', label: 'تجهيز إعادة التشغيل', weight: 5 },
  ];

  const CHECKPOINT_RESTORE_STAGES = [
    { id: 'verify_point', label: 'التحقق من نقطة المزامنة', weight: 10 },
    { id: 'preserve_reference', label: 'حفظ مرجع الحالة المحلية', weight: 10 },
    { id: 'download_state', label: 'سحب حالة المزامنة السحابية', weight: 30 },
    { id: 'apply_checkpoint', label: 'تطبيق حالة المزامنة', weight: 30 },
    { id: 'reconcile', label: 'مواءمة ما بعد السحب', weight: 15 },
    { id: 'restart_prep', label: 'تجهيز إعادة التشغيل', weight: 5 },
  ];

  // Compatibility export for existing consumers; the runtime now selects the
  // truthful list for the actual restore workflow.
  const RESTORE_STAGES = BACKUP_V2_RESTORE_STAGES;

  let discoveryOpId = 0;
  let restoreOpId = 0;
  let discoveryLock = false;
  let restoreLock = false;
  let activeAbort = null;
  let lastDiscovery = null;
  let activeDiscoverySyncState = null;

  function resumeDiscoverySync(state) {
    if (!state?.wasRunning) return { ok: true, required: false, resumed: false };
    if (state.resumeResult) return state.resumeResult;
    try {
      if (!global.SyncEngine?.isRunning?.()) {
        const started = global.SyncEngine?.start?.({ pollIntervalMs: global.SyncState?.load?.()?.pollIntervalMs });
        if (!started || started.ok !== true) {
          const error = new Error(started?.error || (started?.skipped ? 'sync_resume_skipped' : 'sync_resume_failed'));
          error.code = started?.error || (started?.skipped ? 'sync_resume_skipped' : 'sync_resume_failed');
          throw error;
        }
      }
      if (!global.SyncEngine?.isRunning?.()) throw new Error('sync_resume_not_running');
      state.resumed = true;
      state.resumeResult = { ok: true, required: true, resumed: true };
    } catch (error) {
      state.resumeResult = {
        ok: false,
        required: true,
        resumed: false,
        error: error?.code || error?.message || 'sync_resume_failed',
      };
    }
    return state.resumeResult;
  }

  function withDiscoverySyncResume(result, state) {
    const syncResume = resumeDiscoverySync(state);
    if (syncResume.ok !== true) {
      return {
        ok: false,
        error: syncResume.error || 'sync_resume_failed',
        syncResume,
        discovery: result || null,
      };
    }
    return { ...(result || {}), syncResume };
  }

  function electronBackupBridge() {
    return global.cuppingElectron?.backup
      || global.tadawiElectron?.backup
      || global.tadawi?.backup
      || null;
  }

  function bridge() {
    const electronBackup = electronBackupBridge();
    // Prefer Electron IPC when BackupBridge lacks discovery (older wrappers).
    if (electronBackup?.discoverCloudRestorePoints) return electronBackup;
    if (global.BackupBridge?.discoverCloudRestorePoints) return global.BackupBridge;
    return global.BackupBridge || electronBackup || null;
  }

  /** Native V2 cloud restore must use Electron IPC (v2SetupCloudRestore + download progress). */
  function restoreBridge() {
    const electronBackup = electronBackupBridge();
    if (electronBackup?.v2SetupCloudRestore) return electronBackup;
    const b = bridge();
    if (b?.v2SetupCloudRestore) return b;
    return electronBackup || b || null;
  }

  function recordRestoreDiagnostic(entry) {
    try {
      global.BootstrapFailurePolicyContract?.recordDiagnostic?.({
        ...entry,
        domain: 'restore',
      });
    } catch { /* dev-only registry */ }
  }

  function formatBytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
    return `${(v / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatWhen(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return String(iso);
    }
  }

  function getIdentity() {
    const lic = global.LicenseCloud?.loadLocal?.() || global.LicenseV6?.getActiveLicense?.() || null;
    const centerId = lic?.centerId
      || global.CenterId?.get?.()
      || global.DeviceConfig?.load?.()?.centerId
      || null;
    const branchId = global.DeviceConfig?.load?.()?.lockedBranchId
      || global.BranchScope?.getActiveBranchId?.()
      || lic?.branchId
      || null;
    const centerName = lic?.centerName || lic?.organizationName || global.DeviceConfig?.load?.()?.centerName || '';
    const branchName = (lic?.branches || []).find((b) => b && b.id === branchId)?.name
      || global.DeviceConfig?.load?.()?.branchName
      || '';
    return { lic, centerId, branchId, branchName, centerName };
  }

  function probeLocalDatabase() {
    const started = Date.now();
    try {
      const clients = global.DB?.get?.('clients');
      const hasData = Array.isArray(clients) ? clients.length > 0
        : !!(global.DB?.get?.('settings') || global.SqliteBridge?.isPrimary?.());
      const pathHint = global.cuppingElectron?.getUserDataPath?.()
        || global.tadawiElectron?.getUserDataPath?.()
        || 'localStorage / SQLite';
      return {
        ok: true,
        available: true,
        status: hasData ? 'valid' : 'empty_or_new',
        path: pathHint,
        modifiedAt: null,
        durationMs: Date.now() - started,
        message: hasData ? 'بيانات محلية موجودة' : 'لا توجد بيانات تشغيلية محلية غنية',
      };
    } catch (err) {
      return {
        ok: false,
        available: false,
        status: 'error',
        durationMs: Date.now() - started,
        message: err.message || String(err),
      };
    }
  }

  async function probeLocalBackups() {
    const started = Date.now();
    const b = bridge();
    try {
      if (b?.v2ListLocal) {
        const listed = await b.v2ListLocal();
        const files = listed?.files || [];
        const newest = files[0] || null;
        return {
          ok: true,
          available: files.length > 0,
          status: files.length ? 'ready' : 'not_found',
          count: files.length,
          newest,
          durationMs: Date.now() - started,
          message: files.length ? `وُجدت ${files.length} نسخة محلية` : 'لا توجد نسخ Backup V2 محلية',
        };
      }
      return {
        ok: true,
        available: false,
        status: 'unavailable',
        durationMs: Date.now() - started,
        message: 'قائمة النسخ المحلية غير متاحة',
      };
    } catch (err) {
      return {
        ok: false,
        available: false,
        status: 'error',
        durationMs: Date.now() - started,
        message: err.message || String(err),
      };
    }
  }

  /**
   * Parallel Fast Discovery for all data-source cards.
   * Must NOT start SyncEngine, download DB, decrypt, or hydrate.
   */
  async function discoverAllSources(options = {}) {
    if (discoveryLock) {
      return { ok: false, error: 'discovery_in_flight', last: lastDiscovery };
    }
    discoveryLock = true;
    const opId = ++discoveryOpId;
    const abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    activeAbort = abort;
    const started = Date.now();
    const identity = getIdentity();

    // Hard rule: never start sync during discovery
    const syncWasRunning = !!global.SyncEngine?.isRunning?.();
    const syncState = { wasRunning: syncWasRunning, resumed: false };
    activeDiscoverySyncState = syncState;
    if (global.SyncEngine?.stop && syncWasRunning) {
      try {
        global.SyncEngine.stop();
        if (global.SyncEngine?.isRunning?.()) throw new Error('sync_pause_not_stopped');
      } catch (error) {
        const syncResume = resumeDiscoverySync(syncState);
        discoveryLock = false;
        if (activeAbort === abort) activeAbort = null;
        if (activeDiscoverySyncState === syncState) activeDiscoverySyncState = null;
        return {
          ok: false,
          error: syncResume.ok === true
            ? (error?.code || error?.message || 'sync_pause_failed')
            : (syncResume.error || 'sync_resume_failed'),
          pauseError: error?.code || error?.message || 'sync_pause_failed',
          syncResume,
        };
      }
    }

    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const timeoutMs = options.timeoutMs || DISCOVERY_TIMEOUT_MS;
    const emitDiscovery = (snap) => {
      if (!onProgress) return;
      try { onProgress(snap); } catch { /* observer only */ }
    };

    emitDiscovery(buildDiscoveryProgressState({
      label: 'بدء الفحص — سحابة / محلي / نسخ',
      elapsedMs: 0,
      budgetMs: timeoutMs,
      percent: 3,
    }));

    const tick = setInterval(() => {
      if (opId !== discoveryOpId) return;
      emitDiscovery(buildDiscoveryProgressState({
        label: 'جارٍ الفحص…',
        elapsedMs: Date.now() - started,
        budgetMs: timeoutMs,
      }));
    }, 400);

    const electronBackup = global.cuppingElectron?.backup || global.tadawiElectron?.backup || null;
    if (electronBackup?.onDiscoveryProgress) {
      electronBackup.onDiscoveryProgress((payload) => {
        if (opId !== discoveryOpId) return;
        emitDiscovery(buildDiscoveryProgressState({
          ...payload,
          elapsedMs: payload.elapsedMs || (Date.now() - started),
          budgetMs: payload.budgetMs || timeoutMs,
        }));
      });
    }

    const cloudPromise = (async () => {
      const b = bridge();
      if (!b?.discoverCloudRestorePoints) {
        // Fallback: connection-only probe — never recursive listCloudBackups
        const connected = !!global.DriveAdapter?.isConnected?.();
        return {
          ok: true,
          status: connected ? 'ipc_missing' : 'offline',
          message: connected
            ? 'قناة اكتشاف السحابة غير متاحة في هذه النسخة — حدّث التطبيق.'
            : 'حساب Google غير متصل.',
          restorePoints: [],
          newest: null,
          downloadedFullBackup: false,
          durationMs: 0,
          googleConnected: connected,
        };
      }
      return b.discoverCloudRestorePoints({
        centerId: identity.centerId,
        branchId: identity.branchId,
        branchName: identity.branchName,
        centerName: identity.centerName,
        timeoutMs,
      });
    })();

    try {
      const [cloud, localDb, localBackup] = await Promise.all([
        cloudPromise.catch((err) => ({
          ok: false,
          status: 'error',
          message: err.message || String(err),
          restorePoints: [],
          newest: null,
          downloadedFullBackup: false,
        })),
        Promise.resolve().then(probeLocalDatabase),
        probeLocalBackups(),
      ]);

      clearInterval(tick);
      emitDiscovery(buildDiscoveryProgressState({
        label: 'اكتمل الفحص',
        elapsedMs: Date.now() - started,
        budgetMs: timeoutMs,
        percent: 100,
        foundCount: cloud?.restorePoints?.length || 0,
      }));

      if (opId !== discoveryOpId) {
        return withDiscoverySyncResume({ ok: false, error: 'stale_discovery', ignored: true }, syncState);
      }

      // Guard: discovery must never have downloaded a full backup
      if (cloud?.downloadedFullBackup) {
        cloud.status = 'error';
        cloud.message = 'اكتشاف غير آمن: تم تنزيل نسخة كاملة أثناء الفحص.';
      }

      const result = {
        ok: true,
        opId,
        identity,
        durationMs: Date.now() - started,
        cloud,
        localDb,
        localBackup,
        filePick: { available: true, status: 'ready', message: 'اختيار ملف Backup / Database' },
        emptyStart: { available: true, status: 'ready', message: 'البدء بدون بيانات سابقة' },
        syncEngineStarted: false,
        downloadedFullBackup: !!cloud?.downloadedFullBackup,
        instrumentation: cloud?.instrumentation || null,
      };
      lastDiscovery = result;
      return withDiscoverySyncResume(result, syncState);
    } catch (err) {
      clearInterval(tick);
      const syncResume = resumeDiscoverySync(syncState);
      if (syncResume.ok !== true) {
        return {
          ok: false,
          error: syncResume.error || 'sync_resume_failed',
          syncResume,
          discoveryError: err?.code || err?.message || String(err),
        };
      }
      throw err;
    } finally {
      clearInterval(tick);
      resumeDiscoverySync(syncState);
      if (opId === discoveryOpId) {
        discoveryLock = false;
        if (activeAbort === abort) activeAbort = null;
        if (activeDiscoverySyncState === syncState) activeDiscoverySyncState = null;
      }
    }
  }

  function buildDiscoveryProgressState(extra = {}) {
    const budgetMs = extra.budgetMs || DISCOVERY_TIMEOUT_MS;
    const elapsedMs = extra.elapsedMs || 0;
    const percent = extra.percent != null
      ? extra.percent
      : Math.min(92, Math.round((elapsedMs / budgetMs) * 88));
    return {
      phase: extra.phase || 'discovery',
      stageLabel: extra.label || 'فحص مصادر البيانات',
      stageIndex: extra.foldersDone || 0,
      stageCount: extra.foldersTotal || null,
      percent,
      elapsedMs,
      lastActivity: extra.folder
        ? `Drive: ${extra.folder}`
        : (extra.label || 'فحص بيانات وصفية — بلا تنزيل'),
      foundCount: extra.foundCount || 0,
      budgetMs,
    };
  }

  function buildProgressState(stageId, extra = {}) {
    const stages = extra.workflow === 'checkpoint'
      ? CHECKPOINT_RESTORE_STAGES
      : BACKUP_V2_RESTORE_STAGES;
    const idx = stages.findIndex((s) => s.id === stageId);
    const safeIdx = idx >= 0 ? idx : 0;
    const totalWeight = stages.reduce((a, s) => a + s.weight, 0);
    let doneWeight = 0;
    for (let i = 0; i < safeIdx; i += 1) doneWeight += stages[i].weight;
    const stage = stages[safeIdx];
    const hasByteProgress = Number(extra.downloadedBytes) > 0 || Number(extra.totalBytes) > 0;
    const stageRatio = Number.isFinite(extra.stageRatio)
      ? extra.stageRatio
      : (hasByteProgress ? 0.15 : 0.05);
    const ratio = Math.min(0.99, (doneWeight + (stage?.weight || 0) * stageRatio) / totalWeight);
    const indeterminate = extra.indeterminate === true
      || (!hasByteProgress && stageRatio <= 0.05 && (stage?.id === 'download_db' || stage?.id === 'download_state'));
    return {
      stageId: stage?.id || stageId,
      stageLabel: stage?.label || stageId,
      stageIndex: safeIdx + 1,
      stageCount: stages.length,
      percent: indeterminate ? null : Math.round(ratio * 100),
      indeterminate: !!indeterminate,
      elapsedMs: extra.elapsedMs || 0,
      downloadedBytes: extra.downloadedBytes || 0,
      totalBytes: extra.totalBytes || null,
      filesDone: extra.filesDone || 0,
      filesTotal: extra.filesTotal || null,
      lastActivity: extra.lastActivity || stage?.label || '',
      diagnosticId: extra.diagnosticId || null,
    };
  }

  function restoreErrorCode(error) {
    return String(error?.code || error?.error || error?.message || error || 'restore_failed');
  }

  function isPasswordFailure(error) {
    return /password|decrypt|authentication|auth_tag|scrypt/i.test(restoreErrorCode(error));
  }

  function isNativeFormatFailure(error) {
    return /magic|manifest|archive|version_unsupported|invalid.*format|unexpected token/i.test(restoreErrorCode(error));
  }

  async function requestRestorePassword(message) {
    if (typeof global.openBackupPasswordModal === 'function') {
      return global.openBackupPasswordModal(message || 'أدخل كلمة مرور النسخة الاحتياطية:');
    }
    return '';
  }

  async function applyLegacySetupBackup(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: 'invalid_legacy_backup' };
    }
    const portableKeys = [
      'cases', 'clientsRegistry', 'bookings', 'users', 'doctors', 'settings',
      'expenses', 'packages', 'services', 'attendance', 'inventoryItems',
      'inventorySuppliers', 'inventoryMovements', 'otRecords', 'nextSessions',
      'employeeLeaveRequests', 'employeeLedgerAccruals', 'employeeLedgerPayments',
      'employeeLedgerEntries', 'messageLog', 'activityLog', 'hardwareLog',
      'backupLog', 'backupRegistry', 'cashDrawerSession', 'importHistory',
      'systemLogs', 'logCounter', 'communicationWebhookLog', 'communicationQueue',
      'importStudioLog', 'luxQueue', 'devContact',
      'invoiceCounter', 'clientFileCounter', 'budget',
      '__tdw_owner_profile__', '__tdw_owner_session_epoch__', '__tdw_owner_setup__'
    ];
    const hasBusinessData = portableKeys.some((key) => Array.isArray(data[key]) && data[key].length > 0);
    const hasSettings = data.settings && typeof data.settings === 'object';
    if (!hasBusinessData && !hasSettings) return { ok: false, error: 'empty_legacy_backup' };

    if (data.ownerProfile && !data.__tdw_owner_profile__) data.__tdw_owner_profile__ = data.ownerProfile;
    if (data.license?.meta) localStorage.setItem('__tdw_lic_meta__', String(data.license.meta));
    if (data.license?.data) localStorage.setItem('__tdw_lic__', String(data.license.data));
    const db = global.cuppingElectron?.database || global.tadawi?.database;
    if (!db?.bootstrapFromLocal) return { ok: false, error: 'database_bootstrap_unavailable' };
    const committed = await db.bootstrapFromLocal(data, { sourceLabel: 'legacy-cloud-setup-restore' });
    if (committed?.ok !== true) {
      return { ok: false, error: committed?.error || 'legacy_backup_commit_failed', committed };
    }
    return { ok: true, mode: 'legacy_cloud_backup_sqlite', committed };
  }

  async function restoreCloudBackupFile(point, options, emit) {
    const b = restoreBridge();
    const identity = getIdentity();
    const electronBackup = electronBackupBridge();
    let detachDownloadProgress = null;
    let lastDownloadBytes = 0;
    const attachDownloadProgress = (remotePath, onActivity) => {
      if (!emit || typeof emit !== 'function') return;
      const listenerApi = electronBackup?.onDownloadProgress || b?.onDownloadProgress;
      if (!listenerApi) return;
      listenerApi((payload) => {
        if (remotePath && payload?.remotePath && payload.remotePath !== remotePath) return;
        try { onActivity?.(); } catch { /* empty */ }
        const downloadedBytes = Number(payload?.downloadedBytes) || 0;
        lastDownloadBytes = Math.max(lastDownloadBytes, downloadedBytes);
        const totalBytes = Number(payload?.totalBytes) || Number(point?.sizeBytes) || null;
        const ratio = totalBytes
          ? Math.min(0.98, downloadedBytes / totalBytes)
          : (Number(payload?.percent) > 0 ? Math.min(0.98, Number(payload.percent) / 100) : null);
        emit('download_db', {
          stageRatio: ratio != null ? ratio : 0.35,
          downloadedBytes,
          totalBytes,
          indeterminate: ratio == null && downloadedBytes <= 0,
          lastActivity: payload?.stage === 'download_complete'
            ? 'اكتمل تنزيل ملف Backup V2'
            : `تنزيل Backup V2 — ${totalBytes ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}` : formatBytes(downloadedBytes)}`,
        });
        if (payload?.stage === 'download_complete') {
          emit('download_db', {
            stageRatio: 1,
            downloadedBytes: totalBytes || downloadedBytes,
            totalBytes,
            lastActivity: 'اكتمل تنزيل ملف Backup V2',
          });
        }
      });
      detachDownloadProgress = () => {
        try { global.cuppingElectron?.backup?.onDownloadProgress?.(() => {}); } catch { /* empty */ }
        try { b?.onDownloadProgress?.(() => {}); } catch { /* empty */ }
      };
    };
    let password = options.password
      || (typeof global.getBackupV2Password === 'function' ? await global.getBackupV2Password() : '');

    async function invokeNativeRestore(restorePassword) {
      let heartbeat = null;
      let heartbeatRatio = 0.08;
      let stallTimer = null;
      let lastActivityAt = Date.now();
      const touchActivity = () => { lastActivityAt = Date.now(); };
      attachDownloadProgress(point.path, touchActivity);
      const bumpHeartbeat = () => {
        heartbeatRatio = Math.min(0.92, heartbeatRatio + 0.04);
        emit('download_db', {
          stageRatio: heartbeatRatio,
          downloadedBytes: lastDownloadBytes || undefined,
          totalBytes: point?.sizeBytes || null,
          lastActivity: 'تنزيل/استعادة Backup V2 — العملية مستمرة',
        });
        touchActivity();
      };
      try {
        bumpHeartbeat();
        heartbeat = setInterval(bumpHeartbeat, RESTORE_HEARTBEAT_MS);
        const restorePromise = b.v2SetupCloudRestore({
          remotePath: point.path,
          password: restorePassword,
          setupMode: true,
          relaunch: false,
          expectedSizeBytes: point.sizeBytes || null,
          ...(typeof global.getBackupV2IdentityMeta === 'function'
            ? global.getBackupV2IdentityMeta()
            : { centerId: identity.centerId, branchId: identity.branchId }),
        });
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            const err = new Error('cloud_restore_timeout');
            err.code = 'cloud_restore_timeout';
            reject(err);
          }, RESTORE_OPERATION_TIMEOUT_MS);
        });
        const stallPromise = new Promise((_, reject) => {
          stallTimer = setInterval(() => {
            if (Date.now() - lastActivityAt > DOWNLOAD_ACTIVITY_STALL_MS) {
              clearInterval(stallTimer);
              stallTimer = null;
              const err = new Error('cloud_download_stalled');
              err.code = 'cloud_download_stalled';
              err.retryable = true;
              reject(err);
            }
          }, RESTORE_HEARTBEAT_MS);
        });
        return await Promise.race([restorePromise, timeoutPromise, stallPromise]);
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        if (stallTimer) clearInterval(stallTimer);
        if (detachDownloadProgress) detachDownloadProgress();
        detachDownloadProgress = null;
      }
    }

    if (b?.v2SetupCloudRestore && point?.path) {
      let nativeResult;
      try {
        nativeResult = await invokeNativeRestore(password);
      } catch (error) {
        nativeResult = { ok: false, error: restoreErrorCode(error), detail: error };
      }
      if (nativeResult?.ok !== true && /backup_password_required|password_too_short/i.test(restoreErrorCode(nativeResult))) {
        password = await requestRestorePassword('أدخل كلمة مرور Backup V2 للاستعادة من السحابة:');
        if (!password) return { ok: false, canceled: true, error: 'backup_password_required' };
        try {
          nativeResult = await invokeNativeRestore(password);
        } catch (error) {
          nativeResult = { ok: false, error: restoreErrorCode(error), detail: error };
        }
      }
      if (nativeResult?.ok === true) {
        const hydrated = await global.SqliteBridge?.hydrateIntoMemory?.();
        if (hydrated && hydrated.ok !== true) {
          return { ok: false, error: hydrated.error || 'restored_database_hydrate_failed', nativeResult };
        }
        return { ...nativeResult, mode: 'backup_v2_cloud', native: true, needsRestart: false, restartRequired: true };
      }
      if (isPasswordFailure(nativeResult)) {
        password = await requestRestorePassword('كلمة مرور النسخة غير صحيحة. أدخل كلمة مرور Backup V2:');
        if (!password) return { ok: false, canceled: true, error: 'backup_password_required' };
        try {
          nativeResult = await invokeNativeRestore(password);
        } catch (error) {
          nativeResult = { ok: false, error: restoreErrorCode(error), detail: error };
        }
        if (nativeResult?.ok === true) {
          const hydrated = await global.SqliteBridge?.hydrateIntoMemory?.();
          if (hydrated && hydrated.ok !== true) {
            return { ok: false, error: hydrated.error || 'restored_database_hydrate_failed', nativeResult };
          }
          return { ...nativeResult, mode: 'backup_v2_cloud', native: true, needsRestart: false, restartRequired: true };
        }
      }
      if (!isNativeFormatFailure(nativeResult)) return nativeResult;
    }

    if (!b?.downloadCloudBackup || !point?.path) return { ok: false, error: 'cloud_download_unavailable' };
    const downloaded = await b.downloadCloudBackup(point.path, 'google');
    if (!downloaded?.ok) return { ok: false, error: downloaded?.message || 'cloud_download_failed' };
    const raw = downloaded.text || downloaded.payload;
    if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: 'legacy_backup_payload_missing' };
    let data;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?._meta?.encrypted) {
        if (!password) password = await requestRestorePassword();
        data = await global.decryptBackupPayload(raw, password);
      } else {
        data = parsed;
      }
    } catch (error) {
      if (!isPasswordFailure(error) && !/operationerror/i.test(String(error?.name || ''))) {
        return { ok: false, error: 'legacy_backup_invalid', detail: restoreErrorCode(error) };
      }
      password = await requestRestorePassword('أدخل كلمة مرور النسخة الاحتياطية القديمة:');
      if (!password) return { ok: false, canceled: true, error: 'backup_password_required' };
      try {
        data = await global.decryptBackupPayload(raw, password);
      } catch (retryError) {
        return { ok: false, error: 'backup_password_invalid', detail: restoreErrorCode(retryError) };
      }
    }
    const applied = await applyLegacySetupBackup(data);
    return { ...applied, native: false, needsRestart: false, restartRequired: applied.ok === true };
  }

  /**
   * Confirmed restore only — after user presses استعادة هذه البيانات.
   */
  async function confirmedCloudRestore(point, options = {}) {
    if (restoreLock) return { ok: false, error: 'restore_in_flight' };
    if (!point) return { ok: false, error: 'no_restore_point' };

    restoreLock = true;
    const opId = ++restoreOpId;
    const started = Date.now();
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const diagnosticId = `RST-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const workflow = point.kind === 'backup_file' ? 'backup_v2' : 'checkpoint';
    let lastProgressAt = Date.now();
    let watchdog = null;
    let maxPercent = 0;
    let lastStageRatio = 0.05;
    let lastDownloadBytes = 0;

    const emit = (stageId, extra = {}) => {
      lastProgressAt = Date.now();
      if (Number.isFinite(extra.stageRatio)) lastStageRatio = extra.stageRatio;
      if (Number(extra.downloadedBytes) > 0) lastDownloadBytes = Number(extra.downloadedBytes);
      const snap = buildProgressState(stageId, {
        ...extra,
        workflow,
        elapsedMs: Date.now() - started,
        diagnosticId,
      });
      if (snap.percent != null) {
        if (snap.percent < maxPercent) snap.percent = maxPercent;
        else maxPercent = snap.percent;
      }
      recordRestoreDiagnostic({
        correlationId: diagnosticId,
        stageId,
        percent: snap.percent,
        downloadedBytes: snap.downloadedBytes,
        totalBytes: snap.totalBytes,
        lastActivity: snap.lastActivity,
        remotePath: point?.path || null,
        remoteId: point?.id || point?.fileId || null,
        selectedName: point?.name || null,
        expectedBytes: point?.sizeBytes || null,
      });
      try { onProgress(snap); } catch { /* empty */ }
      return snap;
    };

    try {
      // Preserve current DB — never wipe on start
      const preSnapshot = {
        license: !!global.LicenseCloud?.loadLocal?.(),
        deviceId: global.DeviceConfig?.load?.()?.deviceId || null,
        branchId: global.DeviceConfig?.load?.()?.lockedBranchId || null,
        centerId: getIdentity().centerId,
      };

      emit('verify_point', { lastActivity: 'تحقق من نقطة الاستعادة' });
      if (point.validation && point.validation !== 'metadata_ok' && point.validation !== 'ready') {
        return {
          ok: false,
          error: 'invalid_restore_point',
          message: 'النسخة غير صالحة للاستعادة.',
          diagnosticId,
          preserved: preSnapshot,
        };
      }

      emit(workflow === 'backup_v2' ? 'local_safety' : 'preserve_reference', {
        lastActivity: workflow === 'backup_v2'
          ? 'تجهيز مسار نسخة الأمان قبل الاستبدال'
          : 'حفظ مرجع الحالة المحلية قبل سحب نقطة المزامنة'
      });
      if (workflow === 'checkpoint') {
        const safety = await global.RestoreReconciliation?.createMandatoryPreRestoreSnapshot?.({
          allowEmptySkip: true,
          password: options.password,
        });
        if (!safety || safety.ok !== true) {
          return {
            ok: false,
            error: safety?.error || 'pre_restore_snapshot_required',
            diagnosticId,
            preserved: preSnapshot,
            detail: safety || null,
          };
        }
        preSnapshot.safety = safety;
      }

      watchdog = setInterval(() => {
        const idleMs = Date.now() - lastProgressAt;
        if (idleMs > NO_PROGRESS_WATCHDOG_MS && idleMs < DOWNLOAD_ACTIVITY_STALL_MS) {
          emit(workflow === 'backup_v2' ? 'download_db' : 'download_state', {
            lastActivity: 'تحذير: لا يوجد تحديث منذ أكثر من 30 ثانية — قد يستمر التنزيل في الخلفية',
            stageRatio: lastStageRatio,
            downloadedBytes: lastDownloadBytes || undefined,
            totalBytes: point?.sizeBytes || null,
          });
        }
      }, RESTORE_HEARTBEAT_MS);

      let restoreResult = { ok: false };

      emit(workflow === 'backup_v2' ? 'download_db' : 'download_state', {
        lastActivity: workflow === 'backup_v2' ? 'تنزيل ملف النسخة المؤكد' : 'سحب حالة المزامنة المؤكدة',
        stageRatio: 0.05,
        indeterminate: true,
        downloadedBytes: 0,
        totalBytes: point?.sizeBytes || null,
      });
      if (point.kind === 'backup_file' && point.path) {
        restoreResult = await restoreCloudBackupFile(point, options, emit);
        if (restoreResult?.ok !== true) {
          return {
            ok: false,
            error: restoreResult?.error || 'cloud_backup_restore_failed',
            diagnosticId,
            preserved: preSnapshot,
            detail: restoreResult,
            downloadedBytes: lastDownloadBytes,
            expectedBytes: point?.sizeBytes || null,
          };
        }
      } else if (global.CloudBootstrap?.hydrateFromDrive) {
        emit('apply_checkpoint', { lastActivity: 'تطبيق حالة المزامنة السحابية محليًا' });
        const hydrated = await global.CloudBootstrap.hydrateFromDrive(null, {
          allowMissingLicense: true,
          skipAnalysis: true,
          skipSafeAuto: false,
          markComplete: true,
          force: true,
        });
        restoreResult = {
          ok: hydrated?.ok === true,
          mode: 'cloud_hydrate',
          hydrate: hydrated,
          pointKind: point.kind,
        };
        if (hydrated?.ok !== true) {
          return {
            ok: false,
            error: hydrated?.error || (hydrated?.blocked ? 'unsafe_data_state' : 'checkpoint_hydrate_failed'),
            diagnosticId,
            preserved: preSnapshot,
            detail: hydrated,
          };
        }
      } else {
        return {
          ok: false,
          error: 'restore_path_unavailable',
          diagnosticId,
          preserved: preSnapshot,
        };
      }

      if (restoreResult.native) {
        const provenStages = new Set((restoreResult.progress || []).map((item) => item?.stage));
        if (provenStages.has('staging_restore')) emit('checksums', { stageRatio: 1 });
        if (provenStages.has('staging_restore')) emit('staging', { stageRatio: 1 });
        if (restoreResult.database?.ok === true) emit('sqlite_integrity', { stageRatio: 1 });
        if (provenStages.has('restore_complete')) emit('atomic_swap', { stageRatio: 1 });
        emit('hydrate_memory', { stageRatio: 1, lastActivity: 'تم تحميل قاعدة البيانات المستعادة في الذاكرة' });
      }

      // Reconciliation AFTER restore — pull newer only, never push, never during discovery
      emit('reconcile', { lastActivity: 'مواءمة ما بعد الاستعادة' });
      if (!restoreResult.native && global.RestoreReconciliation?.afterRestoreDataSourceSelected) {
        const reconciled = await global.RestoreReconciliation.afterRestoreDataSourceSelected('cloud');
        if (reconciled?.ok !== true) {
          return {
            ok: false,
            error: reconciled?.error || 'restore_reconcile_incomplete',
            diagnosticId,
            preserved: preSnapshot,
            detail: reconciled || null,
          };
        }
      }

      emit('restart_prep', { stageRatio: 1, lastActivity: 'جاهز لإعادة التشغيل' });

      if (opId !== restoreOpId) {
        return { ok: false, error: 'stale_restore', ignored: true, diagnosticId };
      }

      return {
        ok: restoreResult.ok !== false,
        diagnosticId,
        durationMs: Date.now() - started,
        preserved: preSnapshot,
        result: restoreResult,
        point,
      };
    } catch (err) {
      return {
        ok: false,
        error: err.message || String(err),
        diagnosticId,
        preserved: {
          license: !!global.LicenseCloud?.loadLocal?.(),
          deviceId: global.DeviceConfig?.load?.()?.deviceId || null,
          branchId: global.DeviceConfig?.load?.()?.lockedBranchId || null,
        },
      };
    } finally {
      if (watchdog) clearInterval(watchdog);
      if (opId === restoreOpId) restoreLock = false;
    }
  }

  function cancelDiscovery() {
    discoveryOpId += 1;
    discoveryLock = false;
    try { activeAbort?.abort?.(); } catch { /* empty */ }
    activeAbort = null;
    const syncResume = resumeDiscoverySync(activeDiscoverySyncState);
    activeDiscoverySyncState = null;
    return syncResume;
  }

  function cancelRestore() {
    restoreOpId += 1;
    restoreLock = false;
  }

  global.CloudDataDiscovery = {
    DISCOVERY_TIMEOUT_MS,
    RESTORE_STAGES,
    BACKUP_V2_RESTORE_STAGES,
    CHECKPOINT_RESTORE_STAGES,
    discoverAllSources,
    confirmedCloudRestore,
    buildProgressState,
    buildDiscoveryProgressState,
    formatBytes,
    formatWhen,
    cancelDiscovery,
    cancelRestore,
    getLastDiscovery: () => lastDiscovery,
    isDiscoveryLocked: () => discoveryLock,
    isRestoreLocked: () => restoreLock,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.CloudDataDiscovery;
  }
})(typeof window !== 'undefined' ? window : globalThis);
