'use strict';

const crypto = require('crypto');

const LEGACY_SECRET_PARTS = ['TDW', '2026', 'Hj@', 'مة'];
const LEGACY_MATERIAL_SUFFIX = '|TADAWI_OFFLINE_LIC_V4';
const LEGACY_SALT = 'TadawiMadina_LIC_SALT_2026';

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}

function signingKey() {
  const material = LEGACY_SECRET_PARTS.join('|') + LEGACY_MATERIAL_SUFFIX;
  return crypto.pbkdf2Sync(material, LEGACY_SALT, 150000, 32, 'sha256');
}

function signHex(message) {
  return crypto.createHmac('sha256', signingKey()).update(String(message), 'utf8').digest('hex');
}

function verifyDocument(document) {
  if (!document || typeof document !== 'object' || !document.signature) {
    return { ok: false, error: 'signature_missing' };
  }
  const { signature, ...body } = document;
  const expected = signHex(canonicalJson(body));
  const actualBuffer = Buffer.from(String(signature), 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const ok = actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  return ok
    ? { ok: true, format: 'legacy_hmac' }
    : { ok: false, error: 'signature_invalid' };
}

module.exports = { canonicalJson, signHex, verifyDocument };
