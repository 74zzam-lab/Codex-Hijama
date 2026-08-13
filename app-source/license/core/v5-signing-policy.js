'use strict';

const fs = require('fs');
const path = require('path');

/** Intentional Legacy V5 signing paths retained in customer runtime by product decision. */
const V5_SIGNING_ALLOWLIST = Object.freeze([
  'index.html',
  'license/core/license-crypto.js',
  'license/core/license-codec-v5.js',
  'license/migrations/migrate-1.0.0-to-1.1.0.mjs',
  'license/engine/license-generator-v2.js',
  'license/engine/license-downgrade.js',
  'license/engine/license-upgrade.js',
  'electron/legacy-license-crypto.js',
]);

function isV5SigningAllowlisted(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  return V5_SIGNING_ALLOWLIST.some((rel) => normalized.endsWith(rel));
}

function assertV5SigningPolicy(root, scanFiles) {
  const markers = ['LIC_SECRETS', 'TADAWI_OFFLINE_LIC_V4', 'createHmac(', "subtle.sign('HMAC'"];
  let foundInAllowlist = false;
  for (const file of scanFiles) {
    const rel = file.replace(root + path.sep, '').replace(/\\/g, '/');
    if (rel.endsWith('license/core/v5-signing-policy.js')) continue;
    const src = fs.readFileSync(file, 'utf8');
    if (/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(src)) {
      throw new Error(`private key material must not ship in ${rel}`);
    }
    for (const marker of markers) {
      if (!src.includes(marker)) continue;
      if (isV5SigningAllowlisted(rel)) {
        foundInAllowlist = true;
        continue;
      }
      throw new Error(`forbidden signing marker "${marker}" outside V5 allowlist: ${rel}`);
    }
  }
  const cryptoPath = path.join(root, 'license/core/license-crypto.js');
  if (!fs.existsSync(cryptoPath)) throw new Error('license-crypto.js missing');
  const cryptoSrc = fs.readFileSync(cryptoPath, 'utf8');
  if (!cryptoSrc.includes('LIC_SECRETS') || !cryptoSrc.includes('TADAWI_OFFLINE_LIC_V4')) {
    throw new Error('intentional V5 signing material missing from license-crypto.js');
  }
  if (!foundInAllowlist) throw new Error('V5 signing markers not found in allowlisted files');
}

module.exports = {
  V5_SIGNING_ALLOWLIST,
  isV5SigningAllowlisted,
  assertV5SigningPolicy,
};
