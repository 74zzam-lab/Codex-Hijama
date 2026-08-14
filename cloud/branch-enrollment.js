/** Atomic branch enrollment for legacy V5 licences; V6 remains issuer-owned. */
(function (global) {
  'use strict';

  const PENDING_KEY = '__tdw_branch_creation_pending__';
  const IDEMPOTENCY_KEY = '__tdw_branch_idempotency__';

  function getEnrolledBranches(doc) {
    return (doc?.branches || []).filter((branch) => branch && branch.active !== false && !branch.pending);
  }

  function nextBranchId(enrolled) {
    const used = new Set((enrolled || []).map((branch) => branch?.id).filter(Boolean));
    if (!used.has('BR-MAIN')) return 'BR-MAIN';
    for (let number = 2; number <= 99; number += 1) {
      const id = 'BR' + String(number).padStart(2, '0');
      if (!used.has(id)) return id;
    }
    return 'BR' + String(used.size + 1).padStart(2, '0');
  }

  function canEnrollBranch(doc) {
    doc = doc || global.LicenseCloud?.loadLocal?.() || {};
    const max = global.LicenseLimits?.getMaxBranches?.(doc) || Number(doc?.limits?.maxBranches) || 1;
    const current = getEnrolledBranches(doc).length;
    if (current >= max) return { ok: false, error: 'branch_limit_reached', max, current };
    return { ok: true, max, current, remaining: max - current };
  }

  function loadPending() {
    try { return global.DB?.get?.(PENDING_KEY, null) || null; } catch { return null; }
  }

  async function savePending(value) {
    await Promise.resolve(global.DB?.set?.(PENDING_KEY, value));
    return value;
  }

  async function clearPending() {
    await Promise.resolve(global.DB?.set?.(PENDING_KEY, null));
  }

  async function signDoc(doc) {
    if (Number(doc?.schemaVersion) === 6) throw new Error('license_document_immutable_admin_signature_required');
    return global.LicenseCloud?.resignDoc?.(doc) || doc;
  }

  async function commitLicenseRevision(doc, baseVersion) {
    if (Number(doc?.schemaVersion) === 6) {
      return { ok: false, error: 'license_document_immutable_admin_signature_required', requiresAdminReissue: true };
    }
    const fresh = global.LicenseCloud?.loadLocal?.() || doc;
    const current = Number(fresh?.licenseVersion) || 0;
    if (baseVersion != null && current !== Number(baseVersion)) {
      return { ok: false, error: 'license_revision_conflict', expected: baseVersion, current };
    }
    const signed = await signDoc({ ...doc, licenseVersion: current + 1, updatedAt: new Date().toISOString() });
    global.LicenseCloud?.saveLocal?.(signed);
    if (!global.LicenseCloud?.pushToDrive) return { ok: true, doc: signed, remoteOk: true };
    try {
      const pushed = await global.LicenseCloud.pushToDrive(signed);
      return {
        ok: true,
        doc: pushed?.signed || signed,
        remoteOk: pushed?.ok !== false,
        remoteError: pushed?.ok === false ? (pushed.error || pushed.message || 'push_failed') : null
      };
    } catch (error) {
      return { ok: true, doc: signed, remoteOk: false, remoteError: error?.message || String(error) };
    }
  }

  async function enrollBranch(doc, options) {
    options = options || {};
    doc = doc || global.LicenseCloud?.loadLocal?.();
    if (!doc?.centerId) return { ok: false, error: 'no_center_id' };
    if (Number(doc.schemaVersion) === 6) {
      return { ok: false, error: 'license_document_immutable_admin_signature_required', requiresAdminReissue: true };
    }
    if (options.source !== 'owner_hub' && options.source !== 'activation_wizard') {
      return { ok: false, error: 'owner_hub_required' };
    }

    const pendingNow = loadPending();
    if (pendingNow?.status === 'BRANCH_CREATION_PENDING' && !options.resumePending && !options.forceNew) {
      return { ok: false, error: 'branch_creation_in_progress', pending: pendingNow };
    }

    const enrolled = getEnrolledBranches(doc);
    const requestedId = String(options.branchId || '').trim();
    const existing = requestedId && enrolled.find((branch) => String(branch.id) === requestedId);
    if (existing) return { ok: true, already: true, branch: existing, doc };
    if (options.source === 'activation_wizard' && enrolled.length > 0) {
      return { ok: false, error: 'activation_wizard_first_branch_only', current: enrolled.length };
    }

    if (options.idempotencyKey) {
      const previous = global.DB?.get?.(IDEMPOTENCY_KEY, {}) || {};
      const hit = previous[String(options.idempotencyKey)];
      const branch = enrolled.find((item) => item.id === hit?.branchId);
      if (branch) return { ok: true, already: true, branch, doc };
    }

    const gate = canEnrollBranch(doc);
    if (!gate.ok) return gate;
    const branchName = String(options.branchName || '').trim();
    if (!branchName) return { ok: false, error: 'branch_name_required' };
    const branchId = requestedId || nextBranchId(enrolled);
    if (enrolled.some((branch) => branch.id === branchId)) return { ok: false, error: 'branch_id_exists', branchId };

    const baseVersion = Number(doc.licenseVersion) || 0;
    const branch = {
      id: branchId,
      name: branchName,
      code: options.branchCode || (branchId === 'BR-MAIN' ? 'MAIN' : branchId.replace(/^BR-?/, '')),
      active: true,
      pending: true,
      configSource: options.configSource || 'org_defaults',
      copyFromBranchId: options.copyFromBranchId || null,
      enrolledAt: new Date().toISOString(),
      enrolledByDevice: options.deviceUuid || global.DeviceConfig?.load?.()?.deviceUuid || null
    };
    const pending = await savePending({
      status: 'BRANCH_CREATION_PENDING', branchId, branchName, baseVersion,
      idempotencyKey: options.idempotencyKey || null, startedAt: new Date().toISOString()
    });

    const committed = await commitLicenseRevision({ ...doc, branches: enrolled.concat(branch) }, baseVersion);
    if (!committed.ok) {
      await clearPending();
      return committed;
    }
    if (!committed.remoteOk && options.requireRemote !== false && global.DriveAdapter?.isConnected?.()) {
      await savePending({ ...pending, remoteError: committed.remoteError, updatedAt: new Date().toISOString() });
      return { ok: false, error: 'BRANCH_CREATION_PENDING', pending: true, branch, doc: committed.doc };
    }

    const finalized = (committed.doc.branches || []).map((item) => {
      if (!item || item.id !== branchId) return item;
      const { pending: ignored, ...rest } = item;
      void ignored;
      return { ...rest, active: true, finalizedAt: new Date().toISOString() };
    });
    let finalDoc = await signDoc({
      ...committed.doc,
      branches: finalized,
      licenseVersion: (Number(committed.doc.licenseVersion) || 0) + 1,
      updatedAt: new Date().toISOString()
    });
    global.LicenseCloud?.saveLocal?.(finalDoc);
    if (global.LicenseCloud?.pushToDrive) {
      const pushed = await global.LicenseCloud.pushToDrive(finalDoc).catch((error) => ({ ok: false, error: error?.message }));
      if (pushed?.ok === false && options.requireRemote !== false && global.DriveAdapter?.isConnected?.()) {
        await savePending({ ...pending, remoteError: pushed.error || 'push_failed', updatedAt: new Date().toISOString() });
        return { ok: false, error: 'BRANCH_CREATION_PENDING', pending: true, branch, doc: finalDoc };
      }
      finalDoc = pushed?.signed || finalDoc;
    }

    if (options.idempotencyKey) {
      const previous = global.DB?.get?.(IDEMPOTENCY_KEY, {}) || {};
      previous[String(options.idempotencyKey)] = { branchId, at: new Date().toISOString() };
      await Promise.resolve(global.DB?.set?.(IDEMPOTENCY_KEY, previous));
    }
    global.SyncState?.initBranchCheckpoint?.(branchId);
    await clearPending();
    return { ok: true, branch: finalized.find((item) => item?.id === branchId), doc: finalDoc, created: true, atomic: true };
  }

  global.BranchEnrollment = {
    PENDING_KEY, getEnrolledBranches, nextBranchId, canEnrollBranch,
    enrollBranch, loadPending, clearPending, commitLicenseRevision
  };
})(typeof window !== 'undefined' ? window : globalThis);
