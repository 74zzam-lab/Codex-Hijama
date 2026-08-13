/**
 * license.json — cloud license document build / verify / local cache.
 */
(function (global) {
  'use strict';

  const LOCAL_LICENSE_KEY = '__tdw_cloud_license__';

  function canonicalJson(value) {
    const CL = global.CommercialLicense;
    if (CL?.crypto?.canonicalJson) return CL.crypto.canonicalJson(value);
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }

  async function sha256Hex(message) {
    const digest = await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(message)));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function verifyLicenseDoc(doc) {
    if (!doc?.signature) return { ok: false, error: 'signature_missing' };
    const CL = global.CommercialLicense;
    if (Number(doc.schemaVersion) === 6) {
      if (!CL?.v6Verify?.verifyPayload) return { ok: false, error: 'v6_verifier_unavailable' };
      return CL.v6Verify.verifyPayload(doc);
    }
    if (typeof CL?.crypto?.hmacSha256Hex === 'function') {
      const { signature, ...body } = doc;
      const expected = await CL.crypto.hmacSha256Hex(canonicalJson(body));
      if (signature === expected) return { ok: true, format: 'legacy_hmac' };
    }
    const digest = await sha256Hex(canonicalJson(doc));
    const allowed = Array.isArray(CL?.legacyLicenseAllowlist) && CL.legacyLicenseAllowlist.includes(digest);
    return allowed
      ? { ok: true, format: 'legacy_allowlisted', migrationRequired: true }
      : { ok: false, error: 'legacy_license_not_allowlisted' };
  }

  function legacyMojibakeDefaultBranches(count, centerName) {
    const n = Math.max(1, Math.min(15, Number(count) || 1));
    if (n === 1) {
      return [{ id: 'BR-MAIN', name: centerName || 'الفرع الرئيسي', code: 'MAIN', active: true }];
    }
    const names = ['الرياض', 'جدة', 'مكة', 'المدينة', 'الدمام', 'الخبر', 'تبوك', 'أبها', 'الطائف', 'بريدة', 'حائل', 'نجران', 'جازان', 'عرعر', 'الجبيل'];
    const out = [];
    for (let i = 0; i < n; i++) {
      const code = 'BR' + String(i + 1).padStart(2, '0');
      out.push({ id: code, name: 'فرع ' + (names[i] || (i + 1)), code: code.replace('BR', ''), active: true });
    }
    return out;
  }

  function defaultBranches(count, centerName) {
    const n = Math.max(1, Math.min(15, Number(count) || 1));
    const names = ['الرياض', 'جدة', 'مكة', 'المدينة', 'الدمام', 'الخبر', 'تبوك', 'أبها', 'الطائف', 'بريدة', 'حائل', 'نجران', 'جازان', 'عرعر', 'الجبيل'];
    if (n === 1) {
      return [{ id: 'BR-MAIN', name: centerName || 'الفرع الرئيسي', code: 'MAIN', active: true }];
    }
    return Array.from({ length: n }, (_, index) => {
      const id = 'BR' + String(index + 1).padStart(2, '0');
      return { id, name: 'فرع ' + (names[index] || (index + 1)), code: id.slice(2), active: true };
    });
  }

  async function buildFromRecord(record, options) {
    options = options || {};
    const requestedCenterId = String(record.centerId || options.centerId || '').trim();
    const centerId = options.persistCenterId === false
      ? requestedCenterId
      : (global.CenterId?.ensureCenterId(requestedCenterId) || requestedCenterId);
    const features = options.features || record.features || [];
    const existing = options.mergeLocal ? loadLocal() : null;
    const ownerIdentity = record.ownerIdentity
      || (global.LicenseIdentity?.buildOwnerIdentityFromRecord
        ? await global.LicenseIdentity.buildOwnerIdentityFromRecord(record)
        : null)
      || existing?.ownerIdentity
      || null;
    const body = {
      schemaVersion: 2,
      centerId,
      centerName: record.customer?.company || record.customer?.name || options.centerName || global.settings?.centerName || '',
      licenseId: record.licenseId,
      licenseUuid: record.licenseUuid,
      packageId: record.packageId,
      subscriptionId: record.subscriptionId,
      expiresAt: record.expiryDate,
      features: Array.isArray(features) ? features : [],
      ownerIdentity,
      limits: {
        maxDevices: Number(record.devices) || 0,
        maxBranches: Number(record.branches) || 1,
        maxUsers: Number(record.maxUsers) || 10
      },
      branches: Array.isArray(options.branches)
        ? options.branches
        : (existing?.centerId === centerId && Array.isArray(existing.branches) ? existing.branches : []),
      activation: existing?.centerId === centerId && existing?.activation
        ? existing.activation
        : { consumed: false, primaryDeviceFingerprint: null, primaryDeviceUuid: null },
      devices: { registered: existing?.devices?.registered || record.devicesRegistered || [] },
      licenseVersion: Number(existing?.licenseVersion || record.licenseVersion) || 1,
      issuedAt: record.issueDate || new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString()
    };
    const signature = await global.CommercialLicense.crypto.hmacSha256Hex(canonicalJson(body));
    return { ...body, signature };
  }

  function saveLocal(doc) {
    global.DB?.set?.(LOCAL_LICENSE_KEY, doc);
    if (doc?.centerId && global.CloudMeta) {
      const meta = global.CloudMeta.loadMeta();
      meta.centerId = doc.centerId;
      global.CloudMeta.saveMeta(meta);
    }
    return doc;
  }

  async function saveLocalCommitted(doc) {
    if (!global.DB?.set) return { ok: false, error: 'license_local_store_unavailable' };
    const previousDoc = loadLocal();
    const committed = await Promise.resolve(global.DB.set(LOCAL_LICENSE_KEY, doc));
    if (!committed || committed.ok === false) {
      return { ok: false, error: committed?.error || 'license_local_commit_failed' };
    }
    if (doc?.centerId && global.CloudMeta) {
      const meta = global.CloudMeta.loadMeta();
      meta.centerId = doc.centerId;
      try {
        const metaResult = await Promise.resolve(global.DB.set('__tdw_meta__', {
          ...meta,
          updatedAt: new Date().toISOString(),
        }));
        if (!metaResult || metaResult.ok !== true) {
          const rolledBack = await Promise.resolve(global.DB.set(LOCAL_LICENSE_KEY, previousDoc));
          return {
            ok: false,
            error: metaResult?.error || 'license_meta_commit_failed',
            rolledBack: rolledBack?.ok === true,
          };
        }
      } catch (error) {
        const rolledBack = await Promise.resolve(global.DB.set(LOCAL_LICENSE_KEY, previousDoc));
        return {
          ok: false,
          error: error?.code || error?.message || 'license_meta_commit_failed',
          rolledBack: rolledBack?.ok === true,
        };
      }
    }
    return { ok: true, doc, committed };
  }

  function loadLocal() {
    return global.DB?.get?.(LOCAL_LICENSE_KEY, null);
  }

  function drivePath(centerId) {
    return global.DriveLayout?.licenseJson?.(centerId) || '';
  }

  function canSign() {
    const CL = global.CommercialLicense;
    return !!(CL?.crypto?.hmacSha256Hex && CL.crypto.canonicalJson);
  }

  async function resignDoc(doc) {
    if (!doc || typeof doc !== 'object') return doc;
    if (Number(doc.schemaVersion) === 6) {
      throw new Error('license_document_immutable_admin_signature_required');
    }
    if (!canSign()) throw new Error('legacy_license_signer_unavailable');
    const { signature, ...body } = doc;
    body.updatedAt = body.updatedAt || new Date().toISOString();
    const sig = await global.CommercialLicense.crypto.hmacSha256Hex(canonicalJson(body));
    return { ...body, signature: sig };
  }

  async function pushToDrive(doc) {
    doc = doc || loadLocal();
    if (!doc?.centerId) return { ok: false, error: 'no_center_id' };

    if (typeof global.DriveAdapter?.ensureConnected === 'function') {
      try { await global.DriveAdapter.ensureConnected(); } catch { /* empty */ }
    }
    if (!global.DriveAdapter?.isConnected?.()) return { ok: false, offline: true, error: 'drive_not_connected' };

    const path = drivePath(doc.centerId);
    if (!path) return { ok: false, error: 'no_path' };

    // Stamp updatedAt only when we can re-sign — unsigned stamp breaks remote verify/pull.
    const checked = await verifyLicenseDoc(doc);
    if (checked?.ok !== true) return { ok: false, error: checked?.error || 'signature_invalid' };
    let toUpload = JSON.parse(JSON.stringify(doc));
    if (Number(toUpload.schemaVersion) !== 6) {
      toUpload = await resignDoc({ ...toUpload, updatedAt: new Date().toISOString() });
    }
    const upload = await global.DriveAdapter.uploadJson(path, toUpload, {
      overwrite: true,
      activationArtifact: true,
    });
    if (upload && upload.ok === false) {
      return { ...upload, path, centerId: toUpload.centerId, signed: toUpload };
    }
    const localCommit = await saveLocalCommitted(toUpload);
    if (localCommit.ok !== true) {
      return {
        ok: false,
        error: localCommit.error || 'license_local_commit_failed',
        remoteCommitted: true,
        path,
        centerId: toUpload.centerId,
        signed: toUpload,
        upload: upload || null,
      };
    }
    return { ok: true, path, centerId: toUpload.centerId, signed: toUpload, localCommit, ...(upload || {}) };
  }

  /** Ensure first branch exists then push signed license.json to Drive. */
  async function ensurePushedToDrive(options) {
    options = options || {};
    let doc = options.doc || loadLocal();
    if (!doc?.centerId) return { ok: false, error: 'no_center_id' };

    if (!Array.isArray(doc.branches) || !doc.branches.filter((b) => b && b.active !== false).length) {
      if (Number(doc.schemaVersion) === 6) {
        return { ok: false, error: 'license_branch_entitlement_missing_admin_reissue_required' };
      }
      const name = doc.centerName || global.settings?.centerName || 'الفرع الرئيسي';
      // limits.maxBranches is capacity, not a request to pre-create placeholder
      // branches. Activation creates only the real first branch.
      doc.branches = defaultBranches(1, name);
      doc = await resignDoc({ ...doc, updatedAt: new Date().toISOString() });
    }

    const push = await pushToDrive(doc);
    return push;
  }

  global.LicenseCloud = {
    LOCAL_LICENSE_KEY,
    buildFromRecord,
    verifyLicenseDoc,
    resignDoc,
    saveLocal,
    saveLocalCommitted,
    loadLocal,
    drivePath,
    pushToDrive,
    ensurePushedToDrive,
    defaultBranches
  };
})(typeof window !== 'undefined' ? window : globalThis);
