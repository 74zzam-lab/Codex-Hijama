/**
 * Stage 2 — Pure READY evaluator (read-only, derived from Source of Truth).
 * No writes, no repair, no seeding. Observes snapshot and returns diagnostics.
 */
(function (global) {
  'use strict';

  const GATE_ORDER = Object.freeze([
    'database',
    'organization',
    'license',
    'owner',
    'branch',
    'device',
    'businessSetup',
    'dataSource',
    'initialSync',
    'google',
  ]);

  const STATES = Object.freeze({
    READY: 'READY',
    DATABASE_REQUIRED: 'DATABASE_REQUIRED',
    CENTER_REQUIRED: 'CENTER_REQUIRED',
    LICENSE_REQUIRED: 'LICENSE_REQUIRED',
    OWNER_REQUIRED: 'OWNER_REQUIRED',
    BRANCH_REQUIRED: 'BRANCH_REQUIRED',
    DEVICE_REQUIRED: 'DEVICE_REQUIRED',
    DATA_SOURCE_REQUIRED: 'DATA_SOURCE_REQUIRED',
    SYNC_INITIALIZING: 'SYNC_INITIALIZING',
    GOOGLE_REQUIRED: 'GOOGLE_REQUIRED',
    RESTORE_IN_PROGRESS: 'RESTORE_IN_PROGRESS',
    OWNER_PASSWORD_CHANGE_REQUIRED: 'OWNER_PASSWORD_CHANGE_REQUIRED',
    RESTART_REQUIRED: 'RESTART_REQUIRED',
    UNINITIALIZED: 'UNINITIALIZED',
  });

  function isUsableOwnerUser(user) {
    if (!user || user.active === false) return false;
    if (!['owner', 'hq_admin'].includes(String(user.role || '').toLowerCase())) return false;
    if (user.mustChangePassword === true || user.seedDefaultPassword === true) return false;
    return user.hasUsableCredential === true
      || /^(?:pbkdf2:|pbkdf2v2:|b64:)/i.test(String(user.password || ''));
  }

  function licenseLooksValid(license, legacyLicense, licenseStatus) {
    if (!license || typeof license !== 'object') return false;
    const centerId = String(license.centerId || license.center_id || '').trim();
    if (!centerId) return false;
    if (licenseStatus === 'expired' || licenseStatus === 'blocked') return false;
    if (legacyLicense && legacyLicense.status === 'expired') return false;
    const activation = license.activation || null;
    if (activation && activation.consumed === false) return false;
    return true;
  }

  function branchResolved(license, deviceConfig) {
    const branches = (license?.branches || []).filter((b) => b && b.active !== false);
    if (branches.length > 0) return true;
    const locked = String(deviceConfig?.lockedBranchId || '').trim();
    return !!locked;
  }

  function deviceResolved(deviceConfig) {
    const cfg = deviceConfig || {};
    return !!(String(cfg.lockedBranchId || '').trim()
      && (String(cfg.deviceName || '').trim() || String(cfg.deviceUuid || '').trim()));
  }

  function businessSetupResolved(snapshot) {
    const settings = snapshot.settings || {};
    const snap = {
      centerName: String(settings.centerName || snapshot.license?.centerName || '').trim(),
      phone: String(settings.phone || '').trim(),
    };
    if (typeof global !== 'undefined' && global.BusinessSetupContract?.isResolved) {
      return global.BusinessSetupContract.isResolved(snap);
    }
    return !!(snap.centerName && snap.phone && snap.centerName !== 'مركز الحجامة');
  }

  function organizationResolved(snapshot) {
    const centerId = String(
      snapshot.license?.centerId
      || snapshot.meta?.centerId
      || snapshot.organization?.centerId
      || '',
    ).trim();
    const centerName = String(
      snapshot.organization?.centerName
      || snapshot.license?.centerName
      || snapshot.settings?.centerName
      || '',
    ).trim();
    return !!(centerId && centerName);
  }

  function dataSourceResolved(snapshot) {
    const choice = String(snapshot.wizard?.restoreChoice || '').trim();
    if (['empty', 'cloud', 'skip_existing', 'local', 'file'].includes(choice)) return true;
    if (snapshot.restoreReconcile?.pullDone === true && snapshot.restoreReconcile?.pushAllowed === true) {
      return true;
    }
    if (snapshot.meta?.bootstrapCompletedAt) return true;
    return false;
  }

  /**
   * Authoritative initial sync / bootstrap completion — not wizard-only syncDone.
   */
  function initialSyncResolved(snapshot) {
    if (snapshot.meta?.bootstrapCompletedAt) return { ok: true, source: 'meta.bootstrapCompletedAt' };
    if (snapshot.restoreReconcile?.pullDone === true && snapshot.restoreReconcile?.pushAllowed === true) {
      return { ok: true, source: 'restore_reconcile' };
    }
    if (snapshot.meta?.setupActivationCommittedAt && snapshot.deviceConfig?.lockedBranchId) {
      const choice = String(snapshot.wizard?.restoreChoice || '');
      if (choice === 'skip_existing' || choice === 'empty') {
        return { ok: true, source: 'activation_committed_local_path' };
      }
    }
  // Legacy derived indicator — UI-only, not authoritative alone.
    if (snapshot.wizard?.syncDone === true && snapshot.legacyAllowWizardSyncDone === true) {
      return { ok: true, source: 'legacy_wizard_syncDone', legacy: true };
    }
    return { ok: false, source: null };
  }

  function mapState(missing, blocked) {
    if (blocked.includes('restore_in_progress')) return STATES.RESTORE_IN_PROGRESS;
    if (blocked.includes('owner_password_change')) return STATES.OWNER_PASSWORD_CHANGE_REQUIRED;
    if (blocked.includes('restart')) return STATES.RESTART_REQUIRED;
    if (missing.includes('database')) return STATES.DATABASE_REQUIRED;
    if (missing.includes('google')) return STATES.GOOGLE_REQUIRED;
    if (missing.includes('license')) return STATES.LICENSE_REQUIRED;
    if (missing.includes('organization')) return STATES.CENTER_REQUIRED;
    if (missing.includes('branch')) return STATES.BRANCH_REQUIRED;
    if (missing.includes('device')) return STATES.DEVICE_REQUIRED;
    if (missing.includes('businessSetup')) return STATES.CENTER_REQUIRED;
    if (missing.includes('dataSource')) return STATES.DATA_SOURCE_REQUIRED;
    if (missing.includes('owner')) return STATES.OWNER_REQUIRED;
    if (missing.includes('initialSync')) return STATES.SYNC_INITIALIZING;
    return STATES.UNINITIALIZED;
  }

  /**
   * @param {object} snapshot Read-only observation of device state
   * @param {object} [options] { ignoreRestart, allowLegacyWizardSyncDone }
   */
  function evaluateReadyPure(snapshot, options) {
    options = options || {};
    snapshot = snapshot || {};
    const resolved = [];
    const missing = [];
    const invalid = [];
    const source = {};

    const db = snapshot.database || {};
    if (db.accessible === true && db.integrityOk !== false) {
      resolved.push('database');
      source.database = { accessible: true, integrityOk: db.integrityOk !== false };
    } else {
      missing.push('database');
      if (db.error) invalid.push({ gate: 'database', reason: db.error });
    }

    const license = snapshot.license || null;
    const legacyLicense = snapshot.legacyLicense || null;
    const licenseStatus = snapshot.licenseStatus || null;
    if (licenseLooksValid(license, legacyLicense, licenseStatus)) {
      resolved.push('license');
      source.license = { centerId: license.centerId, valid: true };
    } else {
      missing.push('license');
      if (license && licenseStatus === 'expired') {
        invalid.push({ gate: 'license', reason: 'license_expired' });
      } else if (license && licenseStatus === 'blocked') {
        invalid.push({ gate: 'license', reason: 'license_blocked' });
      }
    }

    if (organizationResolved(snapshot)) {
      resolved.push('organization');
      source.organization = {
        centerId: license?.centerId || snapshot.meta?.centerId,
        centerName: snapshot.organization?.centerName || snapshot.settings?.centerName,
      };
    } else {
      missing.push('organization');
    }

    const users = Array.isArray(snapshot.users) ? snapshot.users : [];
    const owner = users.find(isUsableOwnerUser);
    if (owner) {
      resolved.push('owner');
      source.owner = { id: owner.id, role: owner.role };
    } else {
      missing.push('owner');
    }

    const deviceConfig = snapshot.deviceConfig || {};
    if (branchResolved(license, deviceConfig)) {
      resolved.push('branch');
      source.branch = {
        licenseBranches: (license?.branches || []).filter((b) => b && b.active !== false).length,
        lockedBranchId: deviceConfig.lockedBranchId || null,
      };
    } else {
      missing.push('branch');
    }

    if (deviceResolved(deviceConfig)) {
      resolved.push('device');
      source.device = {
        deviceUuid: deviceConfig.deviceUuid || null,
        lockedBranchId: deviceConfig.lockedBranchId || null,
      };
    } else {
      missing.push('device');
    }

    if (businessSetupResolved(snapshot)) {
      resolved.push('businessSetup');
      source.businessSetup = {
        centerName: snapshot.settings?.centerName || snapshot.license?.centerName,
        phone: snapshot.settings?.phone || null,
      };
    } else {
      missing.push('businessSetup');
    }

    if (dataSourceResolved(snapshot)) {
      resolved.push('dataSource');
      source.dataSource = {
        restoreChoice: snapshot.wizard?.restoreChoice || null,
        bootstrapCompletedAt: snapshot.meta?.bootstrapCompletedAt || null,
      };
    } else {
      missing.push('dataSource');
    }

    const sync = initialSyncResolved({
      ...snapshot,
      legacyAllowWizardSyncDone: options.allowLegacyWizardSyncDone === true,
    });
    if (sync.ok) {
      resolved.push('initialSync');
      source.initialSync = { via: sync.source, legacy: !!sync.legacy };
    } else {
      missing.push('initialSync');
    }

    if (snapshot.googleConnected === true) {
      resolved.push('google');
      source.google = { connected: true };
    } else {
      missing.push('google');
    }

    const blocked = [];
    if (snapshot.restoreInProgress === true) blocked.push('restore_in_progress');
    if (snapshot.ownerPasswordChangeRequired === true) blocked.push('owner_password_change');
    if (!options.ignoreRestart && snapshot.restartRequired === true) blocked.push('restart');

    const ready = missing.length === 0 && invalid.length === 0 && blocked.length === 0;
    const allMissing = [...missing, ...blocked];

    return {
      ready,
      isReady: ready,
      resolved,
      missing: allMissing,
      invalid,
      blocked,
      source,
      state: ready ? STATES.READY : mapState(missing, blocked),
      gates: GATE_ORDER,
      pure: true,
      at: new Date().toISOString(),
    };
  }

  function buildSnapshotFromChecks(checks, extras) {
    extras = extras || {};
    return {
      database: extras.database || { accessible: true, integrityOk: true },
      license: extras.license || null,
      legacyLicense: extras.legacyLicense || null,
      licenseStatus: extras.licenseStatus || null,
      meta: extras.meta || {},
      organization: extras.organization || {},
      settings: extras.settings || {},
      deviceConfig: extras.deviceConfig || {},
      users: extras.users || [],
      wizard: {
        restoreChoice: checks.dataSource ? (extras.wizard?.restoreChoice || 'empty') : null,
        syncDone: !!checks.syncDone,
        ...(extras.wizard || {}),
      },
      googleConnected: !!checks.google,
      restoreInProgress: !!extras.restoreInProgress,
      ownerPasswordChangeRequired: !!checks.ownerPasswordChangeRequired,
      restartRequired: !!(extras.restart?.required),
      restoreReconcile: extras.restoreReconcile || null,
    };
  }

  const api = {
    STATES,
    GATE_ORDER,
    evaluateReadyPure,
    buildSnapshotFromChecks,
    isUsableOwnerUser,
    licenseLooksValid,
    branchResolved,
    deviceResolved,
    organizationResolved,
    dataSourceResolved,
    initialSyncResolved,
  };

  global.ReadyPureEvaluator = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
