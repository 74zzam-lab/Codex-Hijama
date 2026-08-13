'use strict';

const crypto = require('crypto');
const allowlist = require('../license/legacy-license-allowlist.json');
const legacyCrypto = require('./legacy-license-crypto');

const PRODUCTION_KEY_ID = 'prod-ed25519-2026-a7f929f51598';
const PRODUCTION_PUBLIC_KEY_SPKI_B64 = 'MCowBQYDK2VwAyEA+S+OvcvOUAdkH5Xcrh0s4wZ43kaGmyWEisCmRTy87WA=';

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}

function verifyV6(document) {
  if (document?.keyId !== PRODUCTION_KEY_ID) return { ok: false, error: 'license_key_id_invalid' };
  if (!document?.signature) return { ok: false, error: 'signature_missing' };
  const { signature, ...body } = document;
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(PRODUCTION_PUBLIC_KEY_SPKI_B64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const sig = Buffer.from(String(signature).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const ok = crypto.verify(null, Buffer.from(canonicalJson(body), 'utf8'), publicKey, sig);
    return ok ? { ok: true, format: 'v6' } : { ok: false, error: 'signature_invalid' };
  } catch {
    return { ok: false, error: 'signature_invalid' };
  }
}

function verifyLegacy(document) {
  const signed = legacyCrypto.verifyDocument(document);
  if (signed.ok) return signed;
  const digest = crypto.createHash('sha256').update(canonicalJson(document), 'utf8').digest('hex');
  const allowed = Array.isArray(allowlist?.hashes) && allowlist.hashes.includes(digest);
  return allowed
    ? { ok: true, format: 'legacy_allowlisted', migrationRequired: true }
    : { ok: false, error: signed.error || 'legacy_license_not_allowlisted' };
}

async function verifyLicenseDoc(document) {
  if (!document || typeof document !== 'object') return { ok: false, error: 'license_json_invalid' };
  return Number(document.schemaVersion) === 6 ? verifyV6(document) : verifyLegacy(document);
}

async function resignDoc() {
  const error = new Error('license_document_immutable_admin_signature_required');
  error.code = 'license_document_immutable_admin_signature_required';
  throw error;
}

module.exports = {
  PRODUCTION_KEY_ID,
  PRODUCTION_PUBLIC_KEY_SPKI_B64,
  canonicalJson,
  verifyLicenseDoc,
  resignDoc,
};
