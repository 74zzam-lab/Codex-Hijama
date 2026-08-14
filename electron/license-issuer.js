'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { canonicalJson, PRODUCTION_KEY_ID, PRODUCTION_PUBLIC_KEY_SPKI_B64 } = require('./license-verifier');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function text(value, max, fallback = '') {
  const result = String(value == null ? fallback : value).trim();
  if (result.length > max) fail('license_issuer_value_too_long');
  return result;
}

function integer(value, min, max, fallback) {
  const number = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) fail('license_issuer_limit_invalid');
  return number;
}

function normalizeFeatures(value) {
  if (!Array.isArray(value)) fail('license_issuer_features_invalid');
  const features = [...new Set(value.map((item) => text(item, 120)).filter(Boolean))];
  if (!features.length || features.length > 500) fail('license_issuer_features_invalid');
  return features;
}

function normalizeBranches(value, maxBranches, centerName) {
  const source = Array.isArray(value) ? value : [];
  const branches = source.slice(0, maxBranches).map((item, index) => {
    const input = item && typeof item === 'object' ? item : {};
    const fallbackId = index === 0 ? 'BR-MAIN' : `BR-${String(index + 1).padStart(2, '0')}`;
    const id = text(input.id, 64, fallbackId);
    if (!/^[A-Za-z0-9_-]{2,64}$/.test(id)) fail('license_issuer_branch_id_invalid');
    return {
      id,
      name: text(input.name, 160, index === 0 ? centerName || 'Main Branch' : `Branch ${index + 1}`),
      nameEn: text(input.nameEn, 160),
      code: text(input.code, 64, index === 0 ? 'MAIN' : String(index + 1).padStart(2, '0')),
      active: input.active !== false,
    };
  });
  if (!branches.length) {
    branches.push({ id: 'BR-MAIN', name: centerName || 'Main Branch', nameEn: '', code: 'MAIN', active: true });
  }
  return branches;
}

function normalizeIssueInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('license_issuer_payload_invalid');
  const issuedAt = text(value.issuedAt, 40, new Date().toISOString());
  const expiresAt = text(value.expiresAt, 40);
  if (!Number.isFinite(Date.parse(issuedAt))) fail('license_issuer_issue_date_invalid');
  if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    fail('license_issuer_expiry_invalid');
  }
  const licenseId = text(value.licenseId, 160);
  const centerId = text(value.centerId, 160);
  if (!licenseId) fail('license_issuer_license_id_required');
  if (!centerId) fail('license_issuer_center_id_required');
  const centerName = text(value.centerName, 160, text(value.customerName, 160, 'Center Name'));
  const maxBranches = integer(value.maxBranches, 1, 15, 1);
  const maxUsers = integer(value.maxUsers, 0, 100000, 10);
  const maxDevices = integer(value.maxDevices, 0, 10000, 0);
  const boundGoogleEmail = text(value.boundGoogleEmail, 320).toLowerCase();
  const deviceMode = text(value.deviceMode, 40, 'any');
  const fingerprintHash = text(value.fingerprintHash, 256);
  if (!['any', 'single-device', 'bound'].includes(deviceMode)) fail('license_issuer_device_mode_invalid');
  if (deviceMode !== 'any' && !fingerprintHash) fail('license_issuer_fingerprint_required');
  return {
    schemaVersion: 6,
    licenseId,
    customerId: text(value.customerId, 160, centerId),
    customerName: text(value.customerName, 160, centerName),
    packageId: text(value.packageId, 80, 'PRO'),
    issuedAt: new Date(issuedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    deviceBinding: deviceMode === 'any'
      ? { mode: 'any' }
      : { mode: 'single-device', fingerprintHash, maxDrift: 2 },
    features: normalizeFeatures(value.features),
    limits: {
      branches: maxBranches,
      users: maxUsers,
      maxBranches,
      maxUsers,
      maxDevices,
    },
    nonce: crypto.randomBytes(16).toString('hex'),
    keyId: PRODUCTION_KEY_ID,
    centerId,
    centerName,
    ownerIdentity: boundGoogleEmail
      ? { authorizedEmail: boundGoogleEmail, boundGoogleEmail }
      : {},
    branches: normalizeBranches(value.branches, maxBranches, centerName),
    licenseVersion: 6,
    status: 'active',
  };
}

function encodeToken(signedLicense) {
  const { signature, ...body } = signedLicense;
  const payload = Buffer.from(canonicalJson(body), 'utf8').toString('base64url');
  return `TDW6.${payload}.${signature}`;
}

function createLicenseIssuer(options = {}) {
  const expectedPublicKey = String(options.publicKeySpkiB64 || PRODUCTION_PUBLIC_KEY_SPKI_B64);
  let selectedKeyPath = '';

  function resolveKeyPath() {
    return selectedKeyPath || String(process.env.TADAWI_LICENSE_PRIVATE_KEY || '').trim();
  }

  function loadMatchingPrivateKey() {
    const keyPath = resolveKeyPath();
    if (!keyPath) fail('license_signing_key_required');
    let privateKey;
    try {
      privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath, 'utf8'));
    } catch {
      fail('license_signing_key_invalid');
    }
    const publicKey = crypto.createPublicKey(privateKey)
      .export({ type: 'spki', format: 'der' }).toString('base64');
    if (publicKey !== expectedPublicKey) fail('license_signing_key_mismatch');
    return { privateKey, keyPath };
  }

  function selectKeyPath(keyPath) {
    const candidate = text(keyPath, 4096);
    if (!candidate) fail('license_signing_key_required');
    selectedKeyPath = candidate;
    try {
      loadMatchingPrivateKey();
    } catch (error) {
      selectedKeyPath = '';
      throw error;
    }
    return status();
  }

  function status() {
    try {
      const loaded = loadMatchingPrivateKey();
      return { ok: true, configured: true, source: selectedKeyPath ? 'selected' : 'environment', keyFile: loaded.keyPath.split(/[\\/]/).pop() };
    } catch (error) {
      return { ok: true, configured: false, error: error.code || error.message };
    }
  }

  function issue(value) {
    const body = normalizeIssueInput(value);
    const { privateKey } = loadMatchingPrivateKey();
    const signature = crypto.sign(null, Buffer.from(canonicalJson(body), 'utf8'), privateKey).toString('base64url');
    const license = { ...body, signature };
    return { ok: true, license, token: encodeToken(license) };
  }

  return { status, selectKeyPath, issue };
}

module.exports = { createLicenseIssuer, normalizeIssueInput, encodeToken };
