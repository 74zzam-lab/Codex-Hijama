/**
 * License Activation Gate — one-time product key via Spreadsheet vault.
 * After first activation: additional devices pull license from Google Drive (no key, no fingerprint lock).
 */
(function (global) {
  'use strict';

  const ERR_AR = {
    activation_already_used: 'هذا الترخيص مُفعَّل مسبقاً على جهاز آخر. استعد من Google Drive (نفس حساب المركز) أو تواصل مع المطور.',
    activation_google_required: 'اربط Google Drive أولاً — التفعيل الأول يُسجَّل على السحابة لمنع إعادة الاستخدام.',
    drive_license_not_found: 'لم يُعثر على ترخيص على Drive — اربط Google وسحب الترخيص من المركز.',
    vault_unreachable: 'تعذّر الوصول لبوابة الترخيص السحابية — سيتم المتابعة بالتفعيل المحلي إن أمكن.',
    failed_to_fetch: 'تعذّر الاتصال بـ Google Sheets Vault — تحقق من الإنترنت أو من إعدادات المطوّر.'
  };

  function fpMatch(stored, current) {
    if (!stored) return true;
    if (typeof global.licFingerprintMatch === 'function') {
      return global.licFingerprintMatch(stored, current);
    }
    return stored === current;
  }

  function getDeviceIdentity() {
    const fingerprint = typeof global.licGetFingerprint === 'function'
      ? global.licGetFingerprint()
      : '';
    const deviceUuid = global.DeviceConfig?.ensureDeviceUuid?.()
      || global.DeviceConfig?.load?.()?.deviceUuid
      || '';
    return { fingerprint, deviceUuid };
  }

  function getActivationBlock(doc) {
    // Activation consumption is operational state. The signed license document is
    // immutable in the customer runtime and must never be stamped/re-signed here.
    return global.DB?.get?.('__tdw_license_activation_state__', null)
      || doc?.activation
      || null;
  }

  function isConsumed(doc) {
    const a = getActivationBlock(doc);
    if (a && a.consumed) return true;
    // Backward-compat: pulled legacy cloud licenses may have centerId without activation block.
    // Treat them as activated-for-use to avoid false "not activated" after pull.
    return !!(doc?.centerId && (doc?.licenseId || doc?.packageId || doc?.subscriptionId));
  }

  /** @deprecated Informational/audit only — not used for permissions or device gating. */
  function isPrimaryDevice(doc, identity) {
    identity = identity || getDeviceIdentity();
    const a = getActivationBlock(doc);
    if (!a?.consumed) return true;
    if (a.primaryDeviceUuid && identity.deviceUuid && a.primaryDeviceUuid === identity.deviceUuid) return true;
    return fpMatch(a.primaryDeviceFingerprint, identity.fingerprint);
  }

  async function fetchRemoteLicenseDoc(centerId) {
    centerId = centerId || global.LicenseCloud?.loadLocal?.()?.centerId
      || global.CenterId?.getStoredCenterId?.();
    if (!centerId || !global.DriveAdapter?.isConnected?.()) {
      return { ok: false, offline: true };
    }
    const path = global.LicenseCloud?.drivePath?.(centerId);
    if (!path) return { ok: false, error: 'no_path' };
    const dl = await global.DriveAdapter.downloadJson(path);
    if (!dl?.ok || !dl.data) return dl || { ok: false, error: 'not_found' };
    const verify = await global.LicenseCloud?.verifyLicenseDoc?.(dl.data);
    if (verify && verify.ok === false) return verify;
    return { ok: true, doc: dl.data };
  }

  async function preActivateCheck(record, options) {
    options = options || {};
    const identity = getDeviceIdentity();
    const requiresGoogle = options.requireGoogle !== false && (
      (record?.branches || 1) > 1
      || record?.deviceBinding === 'DEVICE_ANY'
      || global.LicenseLimits?.hasCloudSyncFeature?.(global.LicenseCloud?.loadLocal?.())
    );

    if (requiresGoogle) {
      const ready = typeof global.DriveAdapter?.ensureConnected === 'function'
        ? await global.DriveAdapter.ensureConnected()
        : !!global.DriveAdapter?.isConnected?.();
      if (!ready) {
        return { ok: false, error: 'activation_google_required', message: ERR_AR.activation_google_required };
      }
    }

    let vaultResult = null;
    const vaultActivate = global.GoogleSheetsOps?.activate || global.LicenseVaultClient?.activateOnVault;
    if ((record?.licenseId || options.productKey || record?.productKey) && vaultActivate) {
      vaultResult = await vaultActivate.call(global.GoogleSheetsOps || global.LicenseVaultClient, {
        licenseId: record?.licenseId,
        productKey: options.productKey || record?.productKey,
        deviceReference: record?.customer?.deviceReference,
        packageLabel: global.LicenseVaultClient?.packageLabelFromBundle?.(options.bundle, record) || ''
      });
      if (!vaultResult.ok && !vaultResult.skipped) {
        // Soft-skip network/CSP/rate-limit so local V5 keys with a local bundle still activate.
        const softNet = vaultResult.soft
          || vaultResult.error === 'vault_unreachable'
          || vaultResult.code === 'vault_unreachable'
          || vaultResult.code === 'network_timeout'
          || vaultResult.code === 'rate_limit'
          || /failed to fetch/i.test(String(vaultResult.message || ''));
        if (softNet) {
          vaultResult = { ok: true, skipped: true, reason: 'vault_unreachable', soft: true };
        } else {
          const vaultMsg = {
            activation_already_used: ERR_AR.activation_already_used,
            not_found: 'الترخيص غير مسجّل في Spreadsheet — أضف صفاً في جدول التفعيلات',
            vault_unreachable: ERR_AR.vault_unreachable,
            failed_to_fetch: ERR_AR.failed_to_fetch
          };
          const rawMsg = vaultResult.message || vaultResult.error || '';
          const mapped = vaultMsg[vaultResult.error]
            || vaultMsg[vaultResult.code]
            || (/failed to fetch/i.test(String(rawMsg)) ? ERR_AR.failed_to_fetch : null)
            || rawMsg;
          return {
            ok: false,
            error: vaultResult.error || vaultResult.code || 'vault_rejected',
            message: mapped
          };
        }
      }
      if (vaultResult.recovery) {
        return {
          ok: true,
          recovery: true,
          source: 'vault',
          identity,
          vaultBundle: vaultResult.bundle || null
        };
      }
    }

    return {
      ok: true,
      firstActivation: true,
      identity,
      vaultBundle: vaultResult?.bundle || null
    };
  }

  async function commitActivation(record, lic) {
    const identity = getDeviceIdentity();
    const centerId = record?.centerId || global.CenterId?.ensureCenterId?.(record?.centerId);
    const activation = {
      consumed: true,
      consumedAt: new Date().toISOString(),
      primaryDeviceFingerprint: identity.fingerprint || null,
      primaryDeviceUuid: identity.deviceUuid || null,
      productKeyHash: record?.productKey ? String(record.productKey).slice(-12) : null
    };
    const cloudRequired = (Number(record?.branches) || 1) > 1
      || record?.deviceBinding === 'DEVICE_ANY';

    let doc = global.LicenseCloud?.loadLocal?.() || null;
    if (!doc && record && global.LicenseCloud?.buildFromRecord) {
      try {
        doc = await global.LicenseCloud.buildFromRecord(record, {
          centerName: record?.customer?.company || record?.customer?.name || ''
        });
      } catch (error) {
        return { ok: false, error: error?.message || 'license_document_build_failed' };
      }
    }
    if (!doc) return { ok: false, error: 'verified_license_required' };
    const verified = await global.LicenseCloud?.verifyLicenseDoc?.(doc);
    if (verified?.ok !== true) {
      return { ok: false, error: verified?.error || 'license_signature_invalid' };
    }
    if (!doc.centerId) return { ok: false, error: 'license_center_entitlement_missing' };
    if (!Array.isArray(doc.branches) || !doc.branches.some((b) => b && b.active !== false)) {
      if (Number(doc.schemaVersion) === 6) {
        return { ok: false, error: 'license_branch_entitlement_missing_admin_reissue_required' };
      }
      const centerName = doc.centerName || record?.customer?.company || record?.customer?.name
        || global.settings?.centerName || 'الفرع الرئيسي';
      doc.branches = global.LicenseCloud?.defaultBranches?.(
        1, centerName
      ) || [{ id: 'BR-MAIN', name: centerName, code: 'MAIN', active: true }];
      doc.centerName = doc.centerName || centerName;
    }
    // Retired bootstrap builder kept unreachable for source compatibility. A
    // customer runtime may consume, but never issue or alter, entitlements.
    if (false) {
      const centerName = doc.centerName || record?.customer?.company || record?.customer?.name
        || global.settings?.centerName || 'الفرع الرئيسي';
      doc.branches = global.LicenseCloud?.defaultBranches?.(1, centerName) || [
        { id: 'BR-MAIN', name: centerName, code: 'MAIN', active: true }
      ];
      doc.centerName = doc.centerName || centerName;
    }

    if (Number(doc.schemaVersion) !== 6 && global.LicenseCloud?.resignDoc) {
      doc = await global.LicenseCloud.resignDoc({ ...doc, activation, updatedAt: new Date().toISOString() });
    } else if (Number(doc.schemaVersion) !== 6 && global.LicenseCloud?.verifyLicenseDoc) {
      const CL = global.CommercialLicense;
      if (CL?.crypto?.hmacSha256Hex && CL.crypto.canonicalJson) {
        const { signature, ...body } = doc;
        body.updatedAt = new Date().toISOString();
        const sig = await CL.crypto.hmacSha256Hex(CL.crypto.canonicalJson(body));
        doc = { ...body, signature: sig };
      }
    }

    let drivePush = null;
    if (typeof global.DriveAdapter?.ensureConnected === 'function') {
      await global.DriveAdapter.ensureConnected().catch(() => false);
    }
    try {
      drivePush = typeof global.LicenseCloud?.ensurePushedToDrive === 'function'
        ? await global.LicenseCloud.ensurePushedToDrive({ doc })
        : await global.LicenseCloud?.pushToDrive?.(doc);
    } catch (e) {
      drivePush = { ok: false, error: e.message || String(e) };
    }
    if (drivePush && drivePush.ok === false) {
      console.warn('LicenseActivationGate: pushToDrive failed', drivePush);
      if (cloudRequired) {
        return {
          ok: false,
          error: drivePush.error || 'activation_drive_upload_failed',
          activation,
          doc,
          identity,
          drivePush
        };
      }
    }
    if (cloudRequired && drivePush?.ok !== true) {
      return {
        ok: false,
        error: drivePush?.error || 'activation_drive_upload_unverified',
        activation,
        doc,
        identity,
        drivePush,
      };
    }

    const localLicenseCommit = typeof global.LicenseCloud?.saveLocalCommitted === 'function'
      ? await global.LicenseCloud.saveLocalCommitted(doc)
      : { ok: true, legacy: true, doc: global.LicenseCloud?.saveLocal?.(doc) };
    if (localLicenseCommit?.ok !== true) {
      return {
        ok: false,
        error: localLicenseCommit?.error || 'license_local_commit_failed',
        activation,
        doc,
        identity,
        drivePush,
        remoteCommitted: drivePush?.ok === true,
      };
    }

    const activationCommit = await Promise.resolve(global.DB?.set?.('__tdw_license_activation_state__', {
      ...activation,
      centerId: doc.centerId,
      licenseId: doc.licenseId || record?.licenseId || null,
      schemaVersion: 1,
    }));
    if (!activationCommit || activationCommit.ok === false) {
      return {
        ok: false,
        error: activationCommit?.error || 'activation_state_commit_failed',
        activation,
        doc,
        identity,
        drivePush,
        remoteCommitted: drivePush?.ok === true,
      };
    }

    if (global.DeviceConfig?.ensureDeviceConfig) {
      await Promise.resolve(global.DeviceConfig.ensureDeviceConfig({ centerId: doc.centerId || centerId }));
    }

    if (record) {
      record.activationConsumed = true;
      record.primaryDeviceFingerprint = identity.fingerprint || null;
      record.primaryDeviceUuid = identity.deviceUuid || null;
      record.activatedAt = activation.consumedAt;
      record.deviceBinding = 'DEVICE_ANY';
      if (!record.centerId) record.centerId = doc.centerId || centerId;
      global.CommercialLicense?.store?.saveLicense?.(record);
    }

    if (typeof global.licLoadMeta === 'function' && typeof global.licSaveMeta === 'function') {
      const meta = global.licLoadMeta();
      meta.activationConsumed = true;
      meta.primaryDeviceFingerprint = identity.fingerprint || null;
      meta.primaryDeviceUuid = identity.deviceUuid || null;
      meta.activatedAt = activation.consumedAt;
      global.licSaveMeta(meta);
    }

    // Phase 24: first successful activation marks owner setup required
    // unless owner profile already exists.
    try { global.OwnerSetupState?.ensureFromActivation?.(); } catch { /* empty */ }

    if (typeof global.AuditLogger?.log === 'function') {
      global.AuditLogger.log({
        action: 'LICENSE_ACTIVATED',
        entity: 'license',
        entityId: record?.licenseId || doc.licenseId,
        summary: `License activated — center ${doc.centerId || centerId || '—'}`
      });
    }

    if (global.LicenseVaultClient?.patchActivationOnVault) {
      const productKey = lic?.productKey || record?.productKey || '';
      if (productKey) {
        await global.LicenseVaultClient.patchActivationOnVault({
          productKey,
          centerId: doc.centerId || centerId || '',
          licenseId: record?.licenseId || '',
          packageLabel: global.LicenseVaultClient.packageLabelFromBundle?.(null, record) || ''
        }).catch(() => {});
      }
    }

    return { ok: true, activation, doc, identity, drivePush };
  }

  async function tryRecoverFromDrive(options) {
    options = options || {};
    if (typeof global.DriveAdapter?.ensureConnected === 'function') {
      await global.DriveAdapter.ensureConnected().catch(() => false);
    }
    if (!global.DriveAdapter?.isConnected?.()) {
      return { ok: false, error: 'drive_not_connected' };
    }

    let doc = null;

    if (options.centerId) {
      const r = await fetchRemoteLicenseDoc(options.centerId);
      if (r?.ok) doc = r.doc;
    } else if (global.CloudBootstrap?.discoverAndFetchLicenseFromDrive) {
      const found = await global.CloudBootstrap.discoverAndFetchLicenseFromDrive();
      if (found?.ok) doc = found.license || global.LicenseCloud?.loadLocal?.();
    }

    if (!doc) return { ok: false, error: 'drive_license_not_found', message: ERR_AR.drive_license_not_found };
    if (!isConsumed(doc)) return { ok: false, error: 'not_yet_activated', doc };

    global.LicenseCloud?.saveLocal?.(doc);
    if (global.LicenseLegacyBridge?.applyCloudLicenseToLegacy) {
      await global.LicenseLegacyBridge.applyCloudLicenseToLegacy(doc);
    }
    return { ok: true, recovered: true, doc };
  }

  function formatPrimaryDeviceLabel(doc) {
    doc = doc || global.LicenseCloud?.loadLocal?.() || {};
    const a = getActivationBlock(doc);
    if (!a?.consumed) {
      if (doc?.centerId && (doc?.licenseId || doc?.packageId || doc?.subscriptionId)) {
        return '✓ مُفعَّل (تم السحب من Google)';
      }
      return '— (لم يُفعَّل بعد)';
    }
    if (a.consumedAt) return '✓ مُفعَّل — الأجهزة تسحب من Google';
    return '✓ مُفعَّل';
  }

  function formatActivationLabel(doc) {
    return formatPrimaryDeviceLabel(doc);
  }

  global.LicenseActivationGate = {
    ERR_AR,
    getDeviceIdentity,
    isConsumed,
    isPrimaryDevice,
    preActivateCheck,
    commitActivation,
    tryRecoverFromDrive,
    formatPrimaryDeviceLabel,
    formatActivationLabel
  };
})(typeof window !== 'undefined' ? window : globalThis);
