/**
 * Center setup state for license, Google, branch and device.
 * Signed entitlements are immutable; mutable device state lives in SQLite.
 */
(function (global) {
  'use strict';

  function hasLegacyLicense() {
    return !!(typeof global.licLoad === 'function' && global.licLoad());
  }

  function hasCloudLicense() {
    return !!global.LicenseCloud?.loadLocal?.()?.centerId;
  }

  function hasGoogle() {
    return !!global.settings?.backup?.providers?.google?.connected;
  }

  function needsBranchSetup() {
    return global.DeviceConfig?.needsBranchSelection?.() !== false;
  }

  function getSetupState() {
    const doc = global.LicenseCloud?.loadLocal?.() || {};
    const config = global.DeviceConfig?.load?.() || {};
    return {
      hasLegacyLicense: hasLegacyLicense(),
      hasCloudLicense: !!doc.centerId,
      hasGoogle: hasGoogle(),
      centerId: doc.centerId || global.ConfigLayer?.getCenterId?.() || '',
      needsBranchSetup: needsBranchSetup(),
      branchLocked: !!(config.branchLocked && config.lockedBranchId),
      lockedBranchId: config.lockedBranchId || '',
      deviceName: config.deviceName || global.settings?.backup?.deviceName || '',
      cloudV2Enabled: !!(global.CloudMeta?.isCloudV2Enabled?.() || global.settings?.cloudV2Enabled),
      maxBranches: global.LicenseLimits?.getMaxBranches?.(doc) || 1,
      branchCount: (doc.branches || []).filter((branch) => branch && branch.active !== false).length,
      deviceCount: global.DeviceRegistry?.listDevices?.(doc)?.length || 0,
      isElectron: !!(global.BackupBridge?.isElectron?.() || global.cuppingElectron?.backup || global.tadawiElectron?.backup),
    };
  }

  async function ensureCloudLicenseFromLegacy() {
    const doc = global.LicenseCloud?.loadLocal?.();
    if (doc?.centerId) return { ok: true, doc };
    if (!hasLegacyLicense()) return { ok: false, error: 'no_license' };
    return {
      ok: false,
      error: 'legacy_license_admin_migration_required',
      message: 'Legacy licenses must be re-issued as a signed V6 license by the offline admin tool.',
    };
  }

  async function prepareForBranchSetup() {
    const state = getSetupState();
    if (!state.hasLegacyLicense && !state.hasCloudLicense) {
      return { ok: false, error: 'no_license' };
    }
    const migration = await ensureCloudLicenseFromLegacy();
    if (!migration.ok && !state.hasCloudLicense) return migration;
    if (!global.CloudMeta?.isCloudV2Enabled?.()) {
      const enabled = await Promise.resolve(global.CloudV2?.maybeAutoEnableCloudV2?.());
      if (enabled && !enabled.ok && enabled.reason === 'drive_not_connected' && !state.hasGoogle) {
        return { ok: false, error: 'google_required' };
      }
    }
    return { ok: true, state: getSetupState() };
  }

  async function removeBranch(branchId, options) {
    options = options || {};
    branchId = String(branchId || '').trim();
    if (!branchId) return { ok: false, error: 'branch_id_required' };
    const doc = global.LicenseCloud?.loadLocal?.();
    if (!doc?.centerId) return { ok: false, error: 'no_license' };
    const branches = (doc.branches || []).filter((branch) => branch && branch.active !== false);
    if (branches.length <= 1 && !options.allowLast) return { ok: false, error: 'last_branch' };
    const devices = global.DeviceRegistry?.getRegistered?.(doc)
      ?.filter((device) => device.active !== false && device.branchId === branchId) || [];
    if (devices.length && !options.force) return { ok: false, error: 'branch_has_devices', count: devices.length };
    return {
      ok: false,
      error: 'license_document_immutable_admin_signature_required',
      branchId,
      requiresAdminReissue: true,
    };
  }

  async function deactivateDevice(deviceUuid, options) {
    options = options || {};
    deviceUuid = String(deviceUuid || '').trim();
    if (!deviceUuid) return { ok: false, error: 'device_uuid_required' };
    const selfUuid = global.DeviceConfig?.load?.()?.deviceUuid;
    if (deviceUuid === selfUuid && !options.allowSelf) return { ok: false, error: 'cannot_deactivate_self' };
    if (!global.DeviceRegistry?.revokeDevice) return { ok: false, error: 'device_registry_unavailable' };
    return global.DeviceRegistry.revokeDevice(deviceUuid, {
      force: !!options.force,
      reason: 'center_setup_deactivate',
    });
  }

  function shouldAutoPromptSetup() {
    return false;
  }

  global.CenterSetup = {
    getSetupState,
    hasLegacyLicense,
    hasCloudLicense,
    hasGoogle,
    needsBranchSetup,
    ensureCloudLicenseFromLegacy,
    prepareForBranchSetup,
    removeBranch,
    deactivateDevice,
    shouldAutoPromptSetup,
  };
})(typeof window !== 'undefined' ? window : globalThis);
