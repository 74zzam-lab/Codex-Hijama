/**
 * Google account binding for a verified license.
 *
 * The issuer-owned license document is immutable. Mutable binding state is kept
 * in SQLite-backed KV and is included in normal backup/restore instead of being
 * written into the signed entitlement document.
 */
(function (global) {
  'use strict';

  const PENDING_CHANGE_KEY = '__tdw_pending_identity_change__';
  const RUNTIME_IDENTITY_KEY = '__tdw_license_identity_runtime__';

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function getConnectedGoogleEmail() {
    return normalizeEmail(global.settings?.backup?.providers?.google?.email || '');
  }

  function loadRuntimeIdentity(doc) {
    const value = global.DB?.get?.(RUNTIME_IDENTITY_KEY, null);
    if (!value || typeof value !== 'object') return {};
    if (doc?.centerId && value.centerId && String(value.centerId) !== String(doc.centerId)) return {};
    if (doc?.licenseId && value.licenseId && String(value.licenseId) !== String(doc.licenseId)) return {};
    return value;
  }

  function getOwnerIdentity(doc) {
    doc = doc || global.LicenseCloud?.loadLocal?.() || {};
    const issued = doc.ownerIdentity && typeof doc.ownerIdentity === 'object' ? doc.ownerIdentity : {};
    return { ...issued, ...loadRuntimeIdentity(doc) };
  }

  function getBoundGoogleEmail(doc) {
    return normalizeEmail(getOwnerIdentity(doc).boundGoogleEmail || '');
  }

  function getAuthorizedEmail(doc) {
    return normalizeEmail(getOwnerIdentity(doc).authorizedEmail || '');
  }

  async function digestEmail(email) {
    const norm = normalizeEmail(email);
    if (!norm || !global.crypto?.subtle) return '';
    const bytes = new TextEncoder().encode('OWNER-ID|' + norm);
    const digest = await global.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  }

  async function buildOwnerIdentityFromRecord(record) {
    const authorizedEmail = normalizeEmail(record?.customer?.email || record?.ownerEmail || '');
    return {
      authorizedEmail: authorizedEmail || null,
      authorizedEmailDigest: authorizedEmail ? await digestEmail(authorizedEmail) : null,
      boundGoogleEmail: null,
      boundAt: null,
      identityRevision: 0,
      lastChangedAt: null,
    };
  }

  async function persistRuntimeIdentity(doc, identity) {
    const state = {
      ...identity,
      centerId: doc?.centerId || null,
      licenseId: doc?.licenseId || null,
      schemaVersion: 1,
    };
    const result = await Promise.resolve(global.DB?.set?.(RUNTIME_IDENTITY_KEY, state));
    if (result && result.ok === false) return result;
    return { ok: true, identity: state };
  }

  async function verifyGoogleBinding(options) {
    options = options || {};
    const doc = global.LicenseCloud?.loadLocal?.();
    if (!doc?.centerId) return { ok: true, skipped: true, reason: 'no_cloud_license' };

    const connected = getConnectedGoogleEmail();
    if (!connected) {
      return options.allowOffline
        ? { ok: true, skipped: true, reason: 'google_not_connected' }
        : { ok: false, error: 'google_not_connected' };
    }

    const bound = getBoundGoogleEmail(doc);
    const authorized = getAuthorizedEmail(doc);
    if (!bound) {
      return authorized && connected !== authorized
        ? { ok: true, needsBind: true, email: connected, emailHint: authorized }
        : { ok: true, needsBind: true, email: connected };
    }
    if (connected !== bound) {
      return { ok: false, error: 'google_identity_transfer', expected: bound, actual: connected };
    }
    return { ok: true, email: connected };
  }

  async function bindGoogleAccount(email, options) {
    options = options || {};
    email = normalizeEmail(email);
    if (!email) return { ok: false, error: 'google_not_connected' };

    const doc = global.LicenseCloud?.loadLocal?.();
    if (!doc?.centerId) return { ok: true, skipped: true, reason: 'no_cloud_license' };
    const verified = await global.LicenseCloud?.verifyLicenseDoc?.(doc);
    if (verified?.ok !== true) return { ok: false, error: verified?.error || 'license_signature_invalid' };

    const identity = { ...getOwnerIdentity(doc) };
    const bound = normalizeEmail(identity.boundGoogleEmail);
    const authorized = normalizeEmail(identity.authorizedEmail);
    if (bound === email) return { ok: true, already: true, email };

    const pending = global.sessionStorage?.getItem?.(PENDING_CHANGE_KEY);
    if (bound && bound !== email && !pending && options.allowIdentityChange !== true) {
      return { ok: false, error: 'google_identity_transfer', expected: bound, actual: email };
    }
    if (authorized && email !== authorized && !bound && options.skipAuthorizedCheck !== true) {
      return { ok: false, error: 'google_email_mismatch', expected: authorized, actual: email };
    }

    identity.boundGoogleEmail = email;
    identity.boundEmailDigest = await digestEmail(email);
    identity.boundAt = bound ? (identity.boundAt || new Date().toISOString()) : new Date().toISOString();
    identity.lastChangedAt = bound ? new Date().toISOString() : (identity.lastChangedAt || null);
    identity.identityRevision = (Number(identity.identityRevision) || 0) + 1;
    const saved = await persistRuntimeIdentity(doc, identity);
    if (!saved.ok) return saved;
    try { global.sessionStorage?.removeItem?.(PENDING_CHANGE_KEY); } catch {}

    global.AuditLogger?.log?.({
      action: bound ? 'OWNER_IDENTITY_CHANGED' : 'OWNER_GOOGLE_BOUND',
      entity: 'license_identity',
      entityId: doc.licenseId || doc.centerId,
      summary: `Google account bound: ${email}`,
    });
    return { ok: true, bound: !bound, changed: !!bound, email };
  }

  function beginIdentityChange() {
    try {
      global.sessionStorage?.setItem?.(PENDING_CHANGE_KEY, '1');
      return { ok: true };
    } catch {
      return { ok: false, error: 'storage_unavailable' };
    }
  }

  function cancelIdentityChange() {
    try { global.sessionStorage?.removeItem?.(PENDING_CHANGE_KEY); } catch {}
  }

  async function onGoogleConnected(email) {
    const verify = await verifyGoogleBinding({ allowOffline: true });
    if (!verify.ok) return verify;
    if (verify.needsBind || verify.skipped) return bindGoogleAccount(email);
    if (getBoundGoogleEmail() && normalizeEmail(email) !== getBoundGoogleEmail()) return bindGoogleAccount(email);
    return { ok: true, email: normalizeEmail(email) };
  }

  function formatIdentityStatus(doc) {
    doc = doc || global.LicenseCloud?.loadLocal?.() || {};
    const identity = getOwnerIdentity(doc);
    const bound = getBoundGoogleEmail(doc);
    const authorized = getAuthorizedEmail(doc);
    const connected = getConnectedGoogleEmail();
    let state = 'unbound';
    if (bound && connected === bound) state = 'ok';
    else if (bound && connected && connected !== bound) state = 'mismatch';
    else if (bound) state = 'bound_offline';
    return {
      state,
      authorizedEmail: authorized || identity.authorizedEmail || '',
      boundGoogleEmail: bound,
      connectedGoogleEmail: connected,
      identityRevision: identity.identityRevision || 0,
    };
  }

  global.LicenseIdentity = {
    normalizeEmail,
    getConnectedGoogleEmail,
    getOwnerIdentity,
    getBoundGoogleEmail,
    getAuthorizedEmail,
    digestEmail,
    buildOwnerIdentityFromRecord,
    verifyGoogleBinding,
    bindGoogleAccount,
    onGoogleConnected,
    beginIdentityChange,
    cancelIdentityChange,
    formatIdentityStatus,
    persistRuntimeIdentity,
    PENDING_CHANGE_KEY,
    RUNTIME_IDENTITY_KEY,
  };
})(typeof window !== 'undefined' ? window : globalThis);
