(function (global) {
  'use strict';

  const CL = global.CommercialLicense || {};
  // Legacy V3/V4/V5 compatibility material. This intentionally restores the
  // historical offline licence format requested for existing customers.
  const LIC_SECRETS = ['TDW', '2026', 'Hj@', 'مة'];
  let _signingKey = null;

  async function getSigningKey() {
    if (_signingKey) return _signingKey;
    const material = new TextEncoder().encode(LIC_SECRETS.join('|') + '|TADAWI_OFFLINE_LIC_V4');
    const salt = new TextEncoder().encode('TadawiMadina_LIC_SALT_2026');
    const base = await global.crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveBits']);
    const bits = await global.crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, 256
    );
    _signingKey = await global.crypto.subtle.importKey(
      'raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
    );
    return _signingKey;
  }

  async function hmacSha256Hex(message) {
    const key = await getSigningKey();
    const sig = await global.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(message)));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function hmacTruncated(message, bits) {
    const hex = await hmacSha256Hex(message);
    const width = Math.ceil(bits / 4);
    return Number(BigInt('0x' + hex.slice(0, width)) & ((1n << BigInt(bits)) - 1n));
  }

  async function sha256Hex(message) {
    const digest = await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(message)));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function canonicalJson(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
  }

  async function computeRegistrySig(body) {
    // Registry files in the current product are immutable bundled assets and
    // keep their SHA-256 integrity format. V5 keys/bundles use HMAC separately.
    return sha256Hex('BUNDLED-REGISTRY-V2|' + canonicalJson(body));
  }

  function featureHashFromIds(ids) {
    const sorted = [...ids].sort();
    return sorted.join(',');
  }

  async function computeFeatureHash(ids) {
    const hex = await hmacSha256Hex('FH|' + featureHashFromIds(ids));
    return hex.slice(0, 4).toUpperCase();
  }

  CL.crypto = {
    getSigningKey, hmacSha256Hex, hmacTruncated, sha256Hex, canonicalJson,
    computeRegistrySig, computeFeatureHash, featureHashFromIds, LIC_SECRETS
  };
  global.CommercialLicense = CL;
})(typeof window !== 'undefined' ? window : global);
