/**
 * Cloud V2 bootstrap — init (migrations, repository, meta, boot flow).
 */
(function (global) {
  'use strict';

  async function init(options) {
    options = options || {};
    global.DbBridge?.install?.();

    if (!global.Repository && global.RepositoryFactory && global.DB) {
      global.Repository = global.RepositoryFactory.createRepository(
        global.RepositoryFactory.createLocalStorageAdapter(global.DB)
      );
    }

    const meta = global.CloudMeta?.loadMeta?.() || {};
    const enabled = options.force === true || global.CloudMeta?.isCloudV2Enabled?.() || meta.cloudV2Enabled;

    if (!enabled && !options.alwaysMigrateMeta) {
      return { ok: true, cloudV2: false, skipped: true };
    }

    global.DeviceConfig?.ensureDeviceUuid?.();

    let mig = { ok: true, ran: [] };
    try {
      global._migrationRunning = true;
      mig = global.MigrationRunner?.runMigrations?.() || { ok: true, ran: [] };
    } finally {
      global._migrationRunning = false;
    }

    const centerId = global.CenterId?.getStoredCenterId?.() || meta.centerId || '';
    if (centerId) {
      global.DeviceConfig?.ensureDeviceConfig?.({ centerId });
      global.DriveFolderRegistry?.ensureRegistry?.(centerId);
    }

    if (enabled) {
      global.BranchScope?.initSessionBranch?.();
      if (global.LicenseCloud?.loadLocal?.()) {
        // Setup/branch binding owns durable registration. Startup only schedules
        // heartbeat so a pre-auth launch cannot create or duplicate a device.
        global.DeviceRegistry?.startHeartbeat?.();
      }
      global.BranchLockUI?.maybePromptBranchLock?.();
      setTimeout(() => {
        try { global.LegacyBranchMigrationUI?.maybePrompt?.(); } catch { /* empty */ }
      }, 1200);

      if (typeof stopLegacyDriveSync === 'function') stopLegacyDriveSync('Cloud V2 active');
      else if (typeof stopDriveSyncTimers === 'function') {
        try { stopDriveSyncTimers(); } catch { /* empty */ }
      }
    }
    let versions = global.VersionsIndex?.syncFromRepository?.(
      global.Repository,
      centerId,
      global.BranchScope?.getActiveBranchId?.()
    ) || global.VersionsIndex?.loadLocal?.(centerId);
    if (versions && centerId && !versions.centerId) {
      versions.centerId = centerId;
      global.VersionsIndex?.saveLocal?.(versions);
    }

    if (enabled) {
      try {
        const deviceCache = await global.DeviceCache?.snapshotFromLocal?.(
          global.BranchScope?.getActiveBranchId?.(),
        );

        let analysis = null;
        if (global.DataStateAnalyzer?.analyze && global.DriveAdapter?.isConnected?.()) {
          analysis = await global.DataStateAnalyzer.analyze({
            branchId: global.BranchScope?.getActiveBranchId?.()
          });
          if (analysis?.ok === false) {
            return { ok: false, error: analysis.error || 'data_state_analysis_failed', analysis, deviceCache };
          }
          if (analysis?.blocked) {
            const blocked = await global.SyncGuard?.blockUnsafe?.(analysis);
            return {
              ok: false,
              error: blocked?.error || 'sync_requires_resolution',
              analysis,
              deviceCache,
            };
          }
          if (!analysis?.offline) {
            const resumed = await global.SyncGuard?.resume?.(analysis);
            if (resumed?.ok === false) {
              return { ok: false, error: resumed.error || 'sync_guard_resume_failed', analysis, deviceCache };
            }
          }
        }

        let syncStart = null;
        if (!global.SyncGuard?.isPaused?.()) {
          syncStart = await global.SyncEngine?.start?.({
            pollIntervalMs: global.SyncState?.load?.()?.pollIntervalMs,
          });
          if (!syncStart || syncStart.ok !== true) {
            return { ok: false, error: syncStart?.error || 'sync_start_failed', syncStart, analysis, deviceCache };
          }
        }

        const backupStart = await global.BackupLayer?.start?.();
        if (!backupStart || backupStart.ok !== true) {
          return { ok: false, error: backupStart?.error || 'backup_start_failed', backupStart, syncStart, analysis, deviceCache };
        }

        const auditFlush = await global.AuditLogger?.flushToDrive?.();
        if (auditFlush?.ok === false && !auditFlush?.skipped && !auditFlush?.offline) {
          return { ok: false, error: auditFlush.error || 'audit_flush_failed', auditFlush, backupStart, syncStart, analysis, deviceCache };
        }

        let bootstrap = null;
        const cfg = global.DeviceConfig?.load?.() || {};
        if (cfg.branchLocked && !global.CloudBootstrap?.isBootstrapComplete?.()) {
          bootstrap = await global.CloudBootstrap?.runNewDeviceBootstrap?.({
            branchId: global.BranchScope?.getActiveBranchId?.(),
            startSync: false
          });
          if (!bootstrap || bootstrap.ok !== true) {
            return { ok: false, error: bootstrap?.error || 'device_bootstrap_failed', bootstrap, backupStart, syncStart, analysis, deviceCache };
          }
        }
      } catch (error) {
        return { ok: false, error: error?.code || error?.message || 'cloud_v2_runtime_initialization_failed' };
      }
    }

    return {
      ok: mig.ok !== false,
      cloudV2: !!enabled,
      meta: global.CloudMeta?.loadMeta?.(),
      migrations: mig,
      centerId,
      repository: !!global.Repository,
      deviceUuid: global.DeviceConfig?.load?.()?.deviceUuid || null,
      activeBranchId: global.BranchScope?.getActiveBranchId?.() || null,
      versions: global.VersionsIndex?.toDriveJson?.(versions) || versions,
      sync: global.SyncEngine?.getStatus?.() || null,
      backup: global.BackupLayer?.getStatus?.() || null
    };
  }

  function getMaxDevicesFromLicense() {
    return null;
  }

  function canUseCloudV2Sync() {
    const lic = global.LicenseCloud?.loadLocal?.();
    if (global.LicenseLimits?.isCloudSyncEligible?.(lic)) return true;
    const legacy = typeof global.licLoad === 'function' ? global.licLoad() : null;
    if (!legacy) return false;
    if (legacy.devices === 0 || legacy.device === 'DEVICE_ANY') return true;
    const feats = legacy.features || {};
    if (Object.keys(feats).some(k => feats[k] && /cloud|drive|multi|owner/i.test(k))) return true;
    if (Number(legacy.commercialMeta?.devices) === 0) return true;
    return false;
  }

  function isDriveConnectedForV2() {
    const prov = global.settings?.backup?.providers?.google;
    if (prov?.userDisconnected) return false;
    if (global.DriveAdapter?.isConnected?.()) return true;
    return !!(global.settings?.backup?.cloudEnabled && prov?.connected);
  }

  /** Auto-enable when license allows cloud sync + Google Drive is linked. */
  async function maybeAutoEnableCloudV2() {
    if (global.settings?.cloudV2UserDisabled) {
      return { ok: false, skipped: true, reason: 'user_disabled' };
    }
    if (global.CloudMeta?.isCloudV2Enabled?.()) {
      return { ok: true, already: true };
    }
    if (!canUseCloudV2Sync()) {
      return { ok: false, skipped: true, reason: 'cloud_sync_not_in_license' };
    }
    if (!isDriveConnectedForV2()) {
      return { ok: false, skipped: true, reason: 'drive_not_connected' };
    }

    const previousMeta = global.CloudMeta?.loadMeta?.() || {};
    const nextMeta = { ...previousMeta, cloudV2Enabled: true, updatedAt: new Date().toISOString() };
    const metaCommitted = await global.DB?.set?.('__tdw_meta__', nextMeta);
    if (!metaCommitted || metaCommitted.ok !== true) {
      return { ok: false, error: metaCommitted?.error || 'cloud_v2_meta_commit_failed' };
    }
    if (global.settings) {
      global.settings.cloudV2Enabled = true;
      if (!global.settings.cloudV2) global.settings.cloudV2 = {};
      global.settings.cloudV2.enabled = true;
      global.settings.cloudV2.autoEnabled = true;
      const committed = typeof global.persistData === 'function'
        ? await global.persistData('settings', global.settings)
        : await global.SqliteBridge?.setAuthoritative?.('settings', global.settings);
      if (!committed || committed.ok === false) {
        await global.DB?.set?.('__tdw_meta__', previousMeta);
        return { ok: false, error: committed?.error || 'cloud_v2_settings_commit_failed' };
      }
    }

    const result = await init({ force: true });
    if (!result || result.ok !== true) {
      return { ok: false, error: result?.error || 'cloud_v2_initialization_failed', init: result || null };
    }
    if (typeof global.notify === 'function') {
      global.notify('✅ Cloud V2 — مزامنة ونسخ بين الأجهزة (حتى مع فرع واحد)', 'success');
    }
    global.OwnerHub?.applyNavVisibility?.();
    if (typeof document !== 'undefined') {
      if (typeof global.renderCloudV2BackupStatus === 'function') global.renderCloudV2BackupStatus();
      if (typeof global.loadCloudV2PollIntervalUI === 'function') global.loadCloudV2PollIntervalUI();
    }
    return { ok: true, autoEnabled: true, ...result };
  }

  async function afterLicenseActivation(record, resolved) {
    if (!record || !global.LicenseCloud) return null;
    const existing = global.LicenseCloud.loadLocal?.() || null;
    const doc = await global.LicenseCloud.buildFromRecord(record, {
      centerName: global.settings?.centerName || existing?.centerName,
      features: resolved?.featureKeys ? Object.keys(resolved.featureKeys).filter(k => resolved.featureKeys[k]) : [],
      mergeLocal: true
    });
    // Keep activation consumed block from commitActivation
    if (existing?.activation?.consumed) {
      doc.activation = existing.activation;
    }
    if ((!doc.branches || !doc.branches.length) && existing?.branches?.length) {
      doc.branches = existing.branches;
    }
    if (!doc.branches || !doc.branches.filter((b) => b && b.active !== false).length) {
      const name = doc.centerName || 'الفرع الرئيسي';
      doc.branches = global.LicenseCloud.defaultBranches?.(1, name) || [
        { id: 'BR-MAIN', name, code: 'MAIN', active: true }
      ];
    }

    let signed = doc;
    if (global.LicenseCloud.resignDoc) {
      signed = await global.LicenseCloud.resignDoc({ ...doc, updatedAt: new Date().toISOString() });
    }
    global.LicenseCloud.saveLocal(signed);

    if (record && !record.centerId) {
      record.centerId = signed.centerId;
      const CL = global.CommercialLicense;
      if (CL?.store?.saveLicense) CL.store.saveLicense(record);
    }

    let drivePush = null;
    try {
      drivePush = typeof global.LicenseCloud.ensurePushedToDrive === 'function'
        ? await global.LicenseCloud.ensurePushedToDrive({ doc: signed })
        : await global.LicenseCloud.pushToDrive?.(signed);
    } catch (e) {
      drivePush = { ok: false, error: e.message || String(e) };
    }

    const auto = await maybeAutoEnableCloudV2();
    if (auto?.ok || auto?.autoEnabled) {
      const initialized = await init({ force: true });
      if (!initialized || initialized.ok !== true) {
        return { doc: signed, drivePush, auto: { ok: false, error: initialized?.error || 'cloud_v2_initialization_failed' } };
      }
      setTimeout(() => global.BranchLockUI?.maybePromptBranchLock?.(), 600);
    }
    return { doc: signed, drivePush, auto };
  }

  global.CloudV2 = { init, afterLicenseActivation, maybeAutoEnableCloudV2, getMaxDevicesFromLicense, canUseCloudV2Sync, isDriveConnectedForV2 };
})(typeof window !== 'undefined' ? window : globalThis);
