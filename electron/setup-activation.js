'use strict';

/**
 * Narrow pre-auth setup activation boundary.
 *
 * The renderer supplies only a Drive path and a compatibility projection. The
 * main process downloads the authoritative license again, verifies its
 * signature/expiry/Google identity, normalizes the legacy projection, then
 * commits through one SQLite transaction. This does not grant generic KV or
 * settings write access to an unauthenticated renderer.
 */

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRemoteLicensePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.length > 1024) return null;
  if (normalized.split('/').includes('..')) return null;
  if (!/(?:^|\/)license\.json$/i.test(normalized)) return null;
  if (!/^(?:NajjarTech|NajjarTech Hijama Management)\//i.test(normalized)) return null;
  return normalized;
}

function loadLicenseVerifier() {
  return require('./license-verifier');
}

function parseDownloadedJson(downloaded) {
  if (!downloaded?.ok) {
    const error = new Error(downloaded?.message || downloaded?.error || 'license_download_failed');
    error.code = downloaded?.needsReauth ? 'oauth_unauthorized' : 'license_download_failed';
    throw error;
  }
  try {
    const raw = downloaded.text || downloaded.payload || '';
    return JSON.parse(String(raw));
  } catch {
    const error = new Error('license_json_invalid');
    error.code = 'license_json_invalid';
    throw error;
  }
}

function assertActiveLicense(document) {
  const expiry = String(document?.expiresAt || document?.expiry || '');
  const expiryMs = Date.parse(expiry);
  if (!expiry || Number.isNaN(expiryMs)) {
    const error = new Error('license_expiry_invalid');
    error.code = 'license_expiry_invalid';
    throw error;
  }
  if (expiryMs < Date.now()) {
    const error = new Error('license_expired');
    error.code = 'license_expired';
    throw error;
  }
  if (!String(document?.centerId || '').trim()) {
    const error = new Error('license_center_missing');
    error.code = 'license_center_missing';
    throw error;
  }
}

function assertGoogleIdentity(document, status) {
  if (!status?.connected || status?.needsReauth) {
    const error = new Error(status?.needsReauth ? 'oauth_unauthorized' : 'drive_not_connected');
    error.code = status?.needsReauth ? 'oauth_unauthorized' : 'drive_not_connected';
    throw error;
  }
  const connected = normalizeEmail(status.email);
  const bound = normalizeEmail(document?.ownerIdentity?.boundGoogleEmail);
  const authorized = normalizeEmail(document?.ownerIdentity?.authorizedEmail);
  if ((bound && bound !== connected) || (authorized && authorized !== connected)) {
    const error = new Error(bound ? 'google_identity_transfer' : 'google_email_mismatch');
    error.code = bound ? 'google_identity_transfer' : 'google_email_mismatch';
    throw error;
  }
}

function normalizeLegacyLicense(document, candidate = {}) {
  const expiry = String(document.expiresAt || document.expiry || '');
  const issued = String(document.issuedAt || document.issueDate || new Date().toISOString().slice(0, 10));
  const licenseId = String(document.licenseUuid || document.licenseId || '');
  const multiDevice = Number(document?.limits?.maxDevices) === 0 || Number(document?.limits?.maxDevices) >= 2;
  const candidateId = String(candidate.licenseId || '');
  if (candidateId && candidateId !== licenseId && candidateId !== String(document.licenseId || '')) {
    const error = new Error('legacy_license_mismatch');
    error.code = 'legacy_license_mismatch';
    throw error;
  }
  const fingerprint = multiDevice ? 'DEVICE_ANY' : String(candidate.fingerprint || candidate.device || '').trim();
  if (!multiDevice && !fingerprint) {
    const error = new Error('device_fingerprint_required');
    error.code = 'device_fingerprint_required';
    throw error;
  }
  const edition = candidate.edition === 'custom' ? 'custom' : 'full';
  const normalized = {
    type: 'renew',
    licType: 'renew',
    licenseId,
    start: issued,
    activationDate: issued,
    expiry,
    issued,
    fingerprint,
    device: fingerprint,
    deviceMode: multiDevice ? 'any' : 'locked',
    boundDevice: '',
    v: 5,
    fromCloudBootstrap: true,
    edition,
    commercialMeta: {
      licenseId: document.licenseId,
      packageId: document.packageId,
      centerId: document.centerId,
      devices: document.limits?.maxDevices,
      branches: document.limits?.maxBranches,
    },
  };
  if (edition === 'custom') {
    normalized.features = candidate.features && typeof candidate.features === 'object'
      ? JSON.parse(JSON.stringify(candidate.features))
      : {};
    normalized.featureSig = String(candidate.featureSig || '');
  }
  return normalized;
}

async function verifyRemoteSetupActivation(options = {}, dependencies = {}) {
  const remotePath = normalizeRemoteLicensePath(options.remotePath);
  if (!remotePath) {
    const error = new Error('invalid_remote_license_path');
    error.code = 'invalid_remote_license_path';
    throw error;
  }
  const googleDrive = dependencies.googleDrive || require('./cloud-providers/google-drive');
  const status = await googleDrive.getStatus();
  const downloaded = await googleDrive.downloadBackup(remotePath);
  const document = parseDownloadedJson(downloaded);
  const verifier = dependencies.licenseVerifier || loadLicenseVerifier();
  const verified = await verifier.verifyLicenseDoc(document);
  if (verified?.ok !== true) {
    const error = new Error(verified?.error || 'signature_invalid');
    error.code = verified?.error || 'signature_invalid';
    throw error;
  }
  assertActiveLicense(document);
  assertGoogleIdentity(document, status);
  return {
    ok: true,
    remotePath,
    license: document,
    legacyLicense: normalizeLegacyLicense(document, options.legacyLicense || {}),
  };
}

async function verifySignedSetupActivation(options = {}, dependencies = {}) {
  const document = options.license;
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    const error = new Error('license_json_invalid');
    error.code = 'license_json_invalid';
    throw error;
  }
  const verifier = dependencies.licenseVerifier || loadLicenseVerifier();
  const verified = await verifier.verifyLicenseDoc(document);
  if (verified?.ok !== true) {
    const error = new Error(verified?.error || 'signature_invalid');
    error.code = verified?.error || 'signature_invalid';
    throw error;
  }
  assertActiveLicense(document);
  return {
    ok: true,
    remotePath: `signed-token:${String(document.licenseId || '')}`,
    license: document,
    legacyLicense: normalizeLegacyLicense(document, options.legacyLicense || {}),
  };
}

function normalizeSetupBranchInput(value = {}) {
  const name = String(value.name || '').trim();
  const requestedId = String(value.id || '').trim();
  const id = requestedId || 'BR-MAIN';
  if (!name) {
    const error = new Error('branch_name_required');
    error.code = 'branch_name_required';
    throw error;
  }
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(id)) {
    const error = new Error('branch_id_invalid');
    error.code = 'branch_id_invalid';
    throw error;
  }
  return {
    id,
    name,
    nameEn: String(value.nameEn || '').trim(),
    code: String(value.code || (id === 'BR-MAIN' ? 'MAIN' : id.replace(/^BR-?/i, ''))).trim(),
    city: String(value.city || '').trim(),
    phone: String(value.phone || '').trim(),
  };
}

async function publishFirstSetupBranch(remotePath, document, branchInput, dependencies = {}) {
  const signedTokenPath = String(remotePath || '').startsWith('signed-token:');
  const normalizedPath = signedTokenPath
    ? `NajjarTech/${String(document?.centerId || '')}/License/license.json`
    : normalizeRemoteLicensePath(remotePath);
  if (!normalizedPath) {
    const error = new Error('invalid_remote_license_path');
    error.code = 'invalid_remote_license_path';
    throw error;
  }
  const branch = normalizeSetupBranchInput(branchInput);
  const active = (Array.isArray(document?.branches) ? document.branches : [])
    .filter((item) => item && item.active !== false && !item.pending);
  const existing = active.find((item) => String(item.id) === branch.id);
  if (existing && Number(document?.schemaVersion) === 6) {
    return { ok: true, license: document, branch: existing, already: true };
  }
  if (Number(document?.schemaVersion) === 6) {
    const error = new Error('license_branch_entitlement_missing_admin_reissue_required');
    error.code = 'license_branch_entitlement_missing_admin_reissue_required';
    throw error;
  }
  let nextBranches;
  if (existing) {
    nextBranches = (document.branches || []).map((item) => item?.id === branch.id ? { ...item, ...branch, active: true } : item);
  } else {
    if (active.length > 0) {
      const error = new Error('activation_wizard_first_branch_only');
      error.code = 'activation_wizard_first_branch_only';
      throw error;
    }
    const maxBranches = Number(document?.limits?.maxBranches) || 1;
    if (active.length >= maxBranches) {
      const error = new Error('branch_limit_reached');
      error.code = 'branch_limit_reached';
      throw error;
    }
    nextBranches = (document.branches || []).concat({ ...branch, active: true });
  }
  const legacyCrypto = dependencies.legacyCrypto || require('./legacy-license-crypto');
  const { signature: ignoredSignature, ...body } = document;
  void ignoredSignature;
  body.branches = nextBranches;
  body.centerName = body.centerName || branch.name;
  body.licenseVersion = (Number(body.licenseVersion) || 0) + 1;
  body.updatedAt = new Date().toISOString();
  const signed = { ...body, signature: legacyCrypto.signHex(legacyCrypto.canonicalJson(body)) };
  const verifier = dependencies.licenseVerifier || loadLicenseVerifier();
  const verified = await verifier.verifyLicenseDoc(signed);
  if (verified?.ok !== true) {
    const error = new Error(verified?.error || 'signature_invalid');
    error.code = verified?.error || 'signature_invalid';
    throw error;
  }
  const googleDrive = dependencies.googleDrive || require('./cloud-providers/google-drive');
  const status = await googleDrive.getStatus();
  if (status?.connected && !status?.needsReauth) {
    const uploaded = await googleDrive.atomicReplaceJson(normalizedPath, signed, { activationArtifact: true });
    if (uploaded?.ok !== true) {
      const error = new Error(uploaded?.error || uploaded?.message || 'branch_license_upload_failed');
      error.code = uploaded?.error || 'branch_license_upload_failed';
      throw error;
    }
  }
  return {
    ok: true,
    license: signed,
    branch: signed.branches.find((item) => item?.id === branch.id),
    already: !!existing,
    remotePath: normalizedPath
  };
}

module.exports = {
  loadLicenseVerifier,
  normalizeRemoteLicensePath,
  parseDownloadedJson,
  assertActiveLicense,
  assertGoogleIdentity,
  normalizeLegacyLicense,
  verifyRemoteSetupActivation,
  verifySignedSetupActivation,
  normalizeSetupBranchInput,
  publishFirstSetupBranch,
};
