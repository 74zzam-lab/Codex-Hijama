/**
 * Secure OAuth token storage. Persistence fails closed without OS safeStorage.
 */
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

function tokensRoot() {
  const dir = path.join(app.getPath('userData'), 'CloudVault', 'tokens');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function tokenPath(providerId) {
  return path.join(tokensRoot(), `${providerId.replace(/[^a-z0-9_-]/gi, '')}.json`);
}

function encryptPayload(obj, secureStorage = safeStorage) {
  const plain = JSON.stringify(obj);
  if (!secureStorage?.isEncryptionAvailable?.()) {
    const error = new Error('secure_storage_unavailable');
    error.code = 'secure_storage_unavailable';
    throw error;
  }
  return { v: 3, enc: secureStorage.encryptString(plain).toString('base64'), alg: 'safeStorage' };
}

function decryptPayload(wrapped, secureStorage = safeStorage) {
  if (!wrapped) return null;
  if (wrapped.alg !== 'safeStorage') {
    const error = new Error('insecure_token_format_rejected');
    error.code = 'insecure_token_format_rejected';
    throw error;
  }
  if (!secureStorage?.isEncryptionAvailable?.()) return null;
  return JSON.parse(secureStorage.decryptString(Buffer.from(wrapped.enc, 'base64')));
}

function invalidateInsecureTokens(file, providerId) {
  try { fs.unlinkSync(file); } catch { /* leave unreadable and never decrypt */ }
  const marker = path.join(tokensRoot(), `${String(providerId).replace(/[^a-z0-9_-]/gi, '')}.reconnect-required.json`);
  try {
    fs.writeFileSync(marker, JSON.stringify({
      reason: 'insecure_legacy_token_invalidated',
      invalidatedAt: new Date().toISOString(),
    }), { encoding: 'utf8', mode: 0o600 });
  } catch { /* marker is advisory only */ }
}

function saveTokens(providerId, tokens) {
  const file = tokenPath(providerId);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(encryptPayload(tokens), null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
  return { ok: true };
}

function loadTokens(providerId) {
  const file = tokenPath(providerId);
  if (!fs.existsSync(file)) return null;
  try {
    const wrapped = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (wrapped?.alg !== 'safeStorage') {
      invalidateInsecureTokens(file, providerId);
      return null;
    }
    return decryptPayload(wrapped);
  } catch (error) {
    if (error?.code === 'insecure_token_format_rejected') invalidateInsecureTokens(file, providerId);
    return null;
  }
}

function deleteTokens(providerId) {
  const file = tokenPath(providerId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

module.exports = {
  saveTokens,
  loadTokens,
  deleteTokens,
  encryptPayload,
  decryptPayload,
  invalidateInsecureTokens,
};
