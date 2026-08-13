/**
 * V2-5.9 — Single Source of Truth for post-activation sync/backup defaults.
 * After Google + License + Branch binding: enable Cloud Sync, V2 Sync, local/cloud backup,
 * initial sync resume — without conflicting duplicate toggles.
 */
(function (global) {
  'use strict';

  function hasGoogle() {
    const prov = global.settings?.backup?.providers?.google;
    if (global.DriveAdapter?.isConnected?.()) return true;
    return !!(prov?.connected && !prov?.userDisconnected && prov?.oauth !== false);
  }

  function hasLicense() {
    const cloud = global.LicenseCloud?.loadLocal?.();
    if (cloud?.centerId) return true;
    const lic = typeof global.licLoad === 'function' ? global.licLoad() : null;
    return !!(lic && global._licStatus !== 'expired' && global._licStatus !== 'blocked');
  }

  function hasBranchBinding() {
    const cfg = global.DeviceConfig?.load?.();
    return !!(cfg?.lockedBranchId && (cfg?.deviceName || cfg?.deviceUuid));
  }

  function isActivationBound() {
    return hasGoogle() && hasLicense() && hasBranchBinding();
  }

  function getState() {
    const settings = global.settings || global.DB?.get?.('settings', {}) || {};
    const backup = settings.backup || {};
    const google = backup.providers?.google || {};
    return {
      googleConnected: hasGoogle(),
      licenseReady: hasLicense(),
      branchBound: hasBranchBinding(),
      activationBound: isActivationBound(),
      cloudEnabled: !!backup.cloudEnabled,
      cloudDbEnabled: !!(backup.cloudDb && backup.cloudDb.enabled !== false && backup.cloudDb.enabled),
      cloudV2: !!(global.CloudMeta?.isCloudV2Enabled?.() || settings.cloudV2Enabled),
      syncRunning: !!global.SyncEngine?.isRunning?.(),
      googleEmail: google.email || ''
    };
  }

  /**
   * Apply defaults when Google+License+Branch are satisfied.
   * Idempotent. Does not wipe outbox. Does not invent empty license.
   */
  async function applyDefaults(options) {
    options = options || {};
    if (!hasGoogle() && typeof global.DriveAdapter?.ensureConnected === 'function') {
      try {
        await global.DriveAdapter.ensureConnected({
          acceptLiveReconnect: options.acceptLiveReconnect === true,
        });
      } catch { /* return the truthful activation state below */ }
    }
    if (!isActivationBound() && !options.force) {
      return { ok: false, skipped: true, reason: 'activation_incomplete', state: getState() };
    }
    if (!global.settings) global.settings = global.DB?.get?.('settings', {}) || {};
    if (!global.settings.backup) global.settings.backup = {};
    const b = global.settings.backup;
    if (!b.providers) b.providers = {};
    if (!b.providers.google) b.providers.google = {};
    if (!b.cloudDb) b.cloudDb = {};

    b.cloudEnabled = true;
    b.cloudDb.enabled = true;
    if (b.cloudDb.autoBackup !== false) b.cloudDb.autoBackup = true;
    // Local auto backup must have a positive interval or startAutoBackupTimer no-ops.
    if (b.localAuto !== false) b.localAuto = true;
    if (b.localEnabled !== false) b.localEnabled = true;
    if (!(parseInt(b.autoIntervalMin, 10) > 0)) b.autoIntervalMin = 60;
    if (!(parseInt(b.cloudDb.autoIntervalMin, 10) > 0) && b.cloudDb.autoBackup) {
      b.cloudDb.autoIntervalMin = 60;
    }
    const committed = typeof global.persistData === 'function'
      ? await global.persistData('settings', global.settings)
      : await global.SqliteBridge?.setAuthoritative?.('settings', global.settings);
    if (!committed || committed.ok === false) {
      return { ok: false, error: committed?.error || 'activation_settings_commit_failed', state: getState() };
    }

    if (typeof global.CloudV2?.maybeAutoEnableCloudV2 !== 'function') {
      return { ok: false, error: 'cloud_v2_initialization_unavailable', state: getState() };
    }
    let cloudV2Result;
    try {
      cloudV2Result = await global.CloudV2.maybeAutoEnableCloudV2();
    } catch (error) {
      return { ok: false, error: error?.code || error?.message || 'cloud_v2_initialization_failed', state: getState() };
    }
    if (cloudV2Result?.ok !== true) {
      return {
        ok: false,
        error: cloudV2Result?.error || cloudV2Result?.reason || 'cloud_v2_initialization_failed',
        cloudV2Result,
        state: getState()
      };
    }

    if (options.startSync !== false) {
      try {
        const resumed = await global.SyncGuard?.resume?.({ reason: 'activation_defaults' });
        if (resumed?.ok === false) {
          return { ok: false, error: resumed.error || resumed.reason || 'sync_guard_resume_failed', state: getState() };
        }
        if (global.SyncEngine?.start && !global.SyncEngine.isRunning?.()) {
          const started = await global.SyncEngine.start({
            pollIntervalMs: global.SyncState?.load?.()?.pollIntervalMs
          });
          if (started?.ok !== true) {
            return { ok: false, error: started?.error || started?.reason || 'sync_start_failed', state: getState() };
          }
        }
      } catch (error) {
        return { ok: false, error: error?.code || error?.message || 'sync_start_failed', state: getState() };
      }
    }

    // Actually start backup services — flags alone are not enough.
    if (options.startBackup !== false) {
      try {
        if (!global.BackupLayer?.start) {
          return { ok: false, error: 'backup_start_unavailable', state: getState() };
        }
        const backupStarted = await global.BackupLayer.start();
        if (backupStarted?.ok !== true) {
          return {
            ok: false,
            error: backupStarted?.error || backupStarted?.reason || 'backup_start_failed',
            backupStarted,
            state: getState()
          };
        }
        const api = global.cuppingElectron?.backup || global.tadawiElectron?.backup || global.BackupBridge;
        if (!api?.v2ScheduleConfigure) {
          return { ok: false, error: 'backup_schedule_unavailable', state: getState() };
        }
        if (api.v2ScheduleConfigure) {
          const password = typeof global.getBackupV2Password === 'function'
            ? await global.getBackupV2Password()
            : '';
          const identity = typeof global.getBackupV2IdentityMeta === 'function'
            ? global.getBackupV2IdentityMeta()
            : {};
          const scheduled = await api.v2ScheduleConfigure({
            enabled: true,
            intervalMinutes: 60,
            cloudEnabled: true,
            ...(password && password.length >= 8 ? { password } : {}),
            ...identity,
          });
          if (scheduled?.ok !== true) {
            return {
              ok: false,
              error: scheduled?.error || scheduled?.reason || 'backup_schedule_failed',
              scheduled,
              state: getState()
            };
          }
        }
      } catch (error) {
        return { ok: false, error: error?.code || error?.message || 'backup_start_failed', state: getState() };
      }
    }

    try {
      global.AuditLogger?.logSyncEvent?.('SETTINGS_CHANGED', {
        summary: 'V2-5.10 activation sync/backup defaults applied + services started',
        meta: { activationBound: true }
      });
    } catch { /* empty */ }

    return { ok: true, cloudV2Result, state: getState() };
  }

  global.ActivationSyncDefaults = {
    hasGoogle,
    hasLicense,
    hasBranchBinding,
    isActivationBound,
    getState,
    applyDefaults
  };
})(typeof window !== 'undefined' ? window : globalThis);
