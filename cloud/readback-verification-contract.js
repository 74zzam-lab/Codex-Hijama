/**
 * Stage 14 — Read-back verification contract (read-only gate evaluation).
 * Authority: __tdw_meta__.readbackVerification with identity/content/revision proof.
 */
(function (global) {
  'use strict';

  const STATES = Object.freeze({
    PENDING: 'PENDING',
    IN_PROGRESS: 'IN_PROGRESS',
    VERIFIED: 'VERIFIED',
    FAILED: 'FAILED',
    STALE: 'STALE',
    CONFLICT: 'CONFLICT',
  });

  const ARTIFACT_STATES = Object.freeze({
    NOT_REQUIRED: 'NOT_REQUIRED',
    PENDING: 'PENDING',
    FOUND: 'FOUND',
    IDENTITY_VERIFIED: 'IDENTITY_VERIFIED',
    CONTENT_VERIFIED: 'CONTENT_VERIFIED',
    STALE: 'STALE',
    MISMATCH: 'MISMATCH',
    MISSING: 'MISSING',
    DUPLICATE: 'DUPLICATE',
    CONFLICT: 'CONFLICT',
    FAILED: 'FAILED',
  });

  const VERIFIED_ARTIFACT_STATES = new Set([
    ARTIFACT_STATES.CONTENT_VERIFIED,
    ARTIFACT_STATES.IDENTITY_VERIFIED,
  ]);

  function readMeta() {
    try { return global.DB?.get?.('__tdw_meta__', {}) || {}; } catch { return {}; }
  }

  function readVerificationRecord() {
    const rec = readMeta().readbackVerification;
    return rec && typeof rec === 'object' ? rec : null;
  }

  function readLocalBinding() {
    const lic = global.LicenseCloud?.loadLocal?.() || {};
    const cfg = global.DeviceConfig?.load?.() || {};
    const settings = global.settings || global.DB?.get?.('settings', {}) || {};
    const w = global.DB?.get?.('__tdw_boot_wizard__', {}) || {};
    const email = String(
      settings?.backup?.providers?.google?.email
      || lic.ownerIdentity?.boundGoogleEmail
      || '',
    ).trim().toLowerCase();
    return {
      organizationId: String(lic.centerId || readMeta().centerId || '').trim(),
      branchId: String(cfg.lockedBranchId || lic.branches?.[0]?.id || '').trim(),
      deviceId: String(cfg.deviceUuid || '').trim(),
      googleAccount: email,
      path: w.path || 'new',
      centerName: String(settings.centerName || lic.centerName || '').trim(),
      phone: String(settings.phone || '').trim(),
      licenseCenterId: String(lic.centerId || '').trim(),
      activationCenterId: String(lic.activation?.centerId || lic.centerId || '').trim(),
      forkDecision: w.forkDecision || null,
      discoveryStatus: String(w.cloudDiscovery?.result?.status || w.cloudDiscovery?.status || '').trim(),
    };
  }

  function buildBindingFingerprint(binding) {
    const b = binding || {};
    return [
      b.organizationId || '',
      b.branchId || '',
      b.deviceId || '',
      b.googleAccount || '',
      b.centerName || '',
      b.phone || '',
      b.contentBinding || '',
    ].join('|');
  }

  function bindingMatches(record, binding) {
    if (!record?.binding || !binding) return false;
    const rb = record.binding;
    if (rb.organizationId && binding.organizationId && rb.organizationId !== binding.organizationId) return false;
    if (rb.branchId && binding.branchId && rb.branchId !== binding.branchId) return false;
    if (rb.deviceId && binding.deviceId && rb.deviceId !== binding.deviceId) return false;
    if (rb.googleAccount && binding.googleAccount && rb.googleAccount !== binding.googleAccount) return false;
    if (rb.contentBinding && binding.contentBinding && rb.contentBinding !== binding.contentBinding) return false;
    return true;
  }

  function artifactVerifiedState(entry) {
    if (!entry || typeof entry !== 'object') return ARTIFACT_STATES.PENDING;
    const st = String(entry.state || '').trim();
    if (st && ARTIFACT_STATES[st]) return ARTIFACT_STATES[st];
    if (entry.ok === true && entry.readBack === true) return ARTIFACT_STATES.CONTENT_VERIFIED;
    if (entry.error === 'cloud_stale_read') return ARTIFACT_STATES.STALE;
    if (entry.error === 'cloud_duplicate_artifact') return ARTIFACT_STATES.DUPLICATE;
    if (entry.error === 'cloud_revision_conflict') return ARTIFACT_STATES.CONFLICT;
    if (entry.error === 'cloud_identity_mismatch') return ARTIFACT_STATES.MISMATCH;
    if (entry.error === 'cloud_artifact_missing') return ARTIFACT_STATES.MISSING;
    if (entry.error === 'cloud_content_mismatch') return ARTIFACT_STATES.MISMATCH;
    if (entry.ok === false) return ARTIFACT_STATES.FAILED;
    return ARTIFACT_STATES.PENDING;
  }

  function requiredArtifacts(record) {
    if (Array.isArray(record?.requiredArtifacts) && record.requiredArtifacts.length) {
      return record.requiredArtifacts.slice();
    }
    const PC = global.PublicationContract;
    const path = record?.path || readLocalBinding().path;
    return PC?.requiredArtifactsForPath?.(path) || [];
  }

  function allRequiredContentVerified(record) {
    const required = requiredArtifacts(record);
    if (!required.length) return false;
    return required.every((id) => {
      const st = artifactVerifiedState(record?.artifacts?.[id]);
      return VERIFIED_ARTIFACT_STATES.has(st);
    });
  }

  function publicationPrerequisitesMet() {
    const PC = global.PublicationContract;
    if (!PC?.isResolved) return false;
    const meta = readMeta();
    return PC.isResolved({
      meta,
      path: readLocalBinding().path,
      setupPublication: meta.setupPublication,
    });
  }

  function isVerified(snapshot) {
    const meta = snapshot?.meta || readMeta();
    if (meta.bootstrapCompletedAt) return true;
    if (!publicationPrerequisitesMet()) return false;
    const rec = snapshot?.readbackVerification || meta.readbackVerification;
    if (!rec || rec.state !== STATES.VERIFIED) return false;
    const binding = readLocalBinding();
    const bound = {
      ...binding,
      contentBinding: rec.binding?.contentBinding || '',
    };
    if (!bindingMatches(rec, bound)) return false;
    const liveBinding = global.PublicationGateService?.buildVerificationBinding?.(
      global.PublicationGateService?.readLocalContext?.() || {},
      bound.googleAccount,
    );
    if (rec.binding?.contentBinding && liveBinding?.contentBinding
      && rec.binding.contentBinding !== liveBinding.contentBinding) {
      return false;
    }
    return allRequiredContentVerified(rec);
  }

  function getState(snapshot) {
    const meta = snapshot?.meta || readMeta();
    if (meta.bootstrapCompletedAt) return STATES.VERIFIED;
    const rec = snapshot?.readbackVerification || meta.readbackVerification;
    if (!rec?.state) return STATES.PENDING;
    return rec.state;
  }

  function buildEmptyResult() {
    return {
      ok: false,
      state: STATES.PENDING,
      organizationId: null,
      branchId: null,
      deviceId: null,
      verifiedArtifacts: [],
      missingArtifacts: [],
      mismatchedArtifacts: [],
      staleArtifacts: [],
      conflictingArtifacts: [],
      duplicateArtifacts: [],
      identityMismatch: false,
      revisionConflicts: [],
      diagnostics: [],
    };
  }

  function summarize(record) {
    if (!record) return buildEmptyResult();
    const artifacts = record.artifacts || {};
    const required = requiredArtifacts(record);
    const verifiedArtifacts = [];
    const missingArtifacts = [];
    const mismatchedArtifacts = [];
    const staleArtifacts = [];
    const conflictingArtifacts = [];
    const duplicateArtifacts = [];
    const revisionConflicts = [];
    const diagnostics = Array.isArray(record.diagnostics) ? record.diagnostics.slice() : [];

    for (const id of required) {
      const entry = artifacts[id];
      const st = artifactVerifiedState(entry);
      if (VERIFIED_ARTIFACT_STATES.has(st)) verifiedArtifacts.push(id);
      else if (st === ARTIFACT_STATES.MISSING) missingArtifacts.push(id);
      else if (st === ARTIFACT_STATES.STALE) staleArtifacts.push(id);
      else if (st === ARTIFACT_STATES.DUPLICATE) duplicateArtifacts.push(id);
      else if (st === ARTIFACT_STATES.CONFLICT) {
        conflictingArtifacts.push(id);
        if (entry?.revisionConflict) revisionConflicts.push({ artifact: id, ...entry.revisionConflict });
      } else if (st === ARTIFACT_STATES.MISMATCH) mismatchedArtifacts.push(id);
      else missingArtifacts.push(id);
    }

    const identityMismatch = mismatchedArtifacts.length > 0
      || record.identityMismatch === true
      || diagnostics.some((d) => d?.code === 'cloud_identity_mismatch');

    return {
      ok: record.state === STATES.VERIFIED && verifiedArtifacts.length === required.length,
      state: record.state || STATES.PENDING,
      organizationId: record.binding?.organizationId || null,
      branchId: record.binding?.branchId || null,
      deviceId: record.binding?.deviceId || null,
      verifiedArtifacts,
      missingArtifacts,
      mismatchedArtifacts,
      staleArtifacts,
      conflictingArtifacts,
      duplicateArtifacts,
      identityMismatch,
      revisionConflicts,
      diagnostics,
    };
  }

  function buildContract() {
    return {
      gateId: 'READBACK_VERIFIED',
      authority: '__tdw_meta__.readbackVerification',
      artifactStates: Object.values(ARTIFACT_STATES),
      states: Object.values(STATES),
      requiresPublicationResolved: true,
      bindingFields: ['organizationId', 'branchId', 'deviceId', 'googleAccount', 'contentBinding'],
      notBasedOn: ['wizard.readbackVerified flag alone', 'upload return without remote proof', 'in-memory upload cache'],
      invalidatesOn: ['organizationId change', 'branchId change', 'deviceId change', 'googleAccount change', 'business setup content change'],
    };
  }

  const ReadbackVerificationContract = {
    STATES,
    ARTIFACT_STATES,
    readMeta,
    readVerificationRecord,
    readLocalBinding,
    buildBindingFingerprint,
    bindingMatches,
    artifactVerifiedState,
    requiredArtifacts,
    allRequiredContentVerified,
    publicationPrerequisitesMet,
    isVerified,
    getState,
    buildEmptyResult,
    summarize,
    buildContract,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ReadbackVerificationContract;
  }
  global.ReadbackVerificationContract = ReadbackVerificationContract;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global);
