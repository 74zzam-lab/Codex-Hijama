'use strict';

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

function vaultPath() {
  const dir = path.join(app.getPath('userData'), 'SecurityVault');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'communication-credentials.json');
}

function requireSecureStorage(storage = safeStorage) {
  if (!storage?.isEncryptionAvailable?.()) {
    const error = new Error('secure_storage_unavailable');
    error.code = 'secure_storage_unavailable';
    throw error;
  }
  return storage;
}

function readVault(storage = safeStorage) {
  const file = vaultPath();
  if (!fs.existsSync(file)) return { v: 1, providers: {}, webhookSecret: '' };
  const secure = requireSecureStorage(storage);
  try {
    const wrapped = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (wrapped?.v !== 1 || wrapped?.alg !== 'safeStorage' || !wrapped.enc) return { v: 1, providers: {}, webhookSecret: '' };
    return JSON.parse(secure.decryptString(Buffer.from(wrapped.enc, 'base64')));
  } catch {
    return { v: 1, providers: {}, webhookSecret: '' };
  }
}

function writeVault(data, storage = safeStorage) {
  const secure = requireSecureStorage(storage);
  const file = vaultPath();
  const temp = `${file}.${process.pid}.tmp`;
  const enc = secure.encryptString(JSON.stringify(data)).toString('base64');
  fs.writeFileSync(temp, JSON.stringify({ v: 1, alg: 'safeStorage', enc }), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
  return { ok: true };
}

function saveCommunicationCredentials(payload, storage = safeStorage) {
  const current = readVault(storage);
  const providers = Array.isArray(payload?.providers) ? payload.providers : [];
  for (const provider of providers) {
    const id = String(provider?.id || '').replace(/[^a-zA-Z0-9_.:-]/g, '');
    if (!id) continue;
    const existing = current.providers[id] || {};
    current.providers[id] = {
      apiKey: provider.apiKey == null ? String(existing.apiKey || '') : String(provider.apiKey || ''),
      secret: provider.secret == null ? String(existing.secret || '') : String(provider.secret || ''),
    };
  }
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'webhookSecret')) {
    current.webhookSecret = String(payload.webhookSecret || '');
  }
  current.updatedAt = new Date().toISOString();
  writeVault(current, storage);
  return getCredentialStatus(storage);
}

function getCredentialStatus(storage = safeStorage) {
  if (!storage?.isEncryptionAvailable?.()) return { ok: false, error: 'secure_storage_unavailable', providers: {}, webhookSecret: false };
  const data = readVault(storage);
  const providers = {};
  for (const [id, value] of Object.entries(data.providers || {})) {
    providers[id] = { apiKey: !!value?.apiKey, secret: !!value?.secret };
  }
  return { ok: true, providers, webhookSecret: !!data.webhookSecret };
}

function deleteCommunicationCredentials(providerId, storage = safeStorage) {
  const data = readVault(storage);
  if (providerId) delete data.providers[String(providerId)];
  else {
    data.providers = {};
    data.webhookSecret = '';
  }
  writeVault(data, storage);
  return { ok: true };
}

function hydrateCommunicationConfig(config, storage = safeStorage) {
  const clone = JSON.parse(JSON.stringify(config || {}));
  let secrets = { providers: {}, webhookSecret: '' };
  try { secrets = readVault(storage); } catch { /* keep stripped config */ }
  const communication = clone.communication || (clone.communication = {});
  communication.providers = (communication.providers || []).map((provider) => ({
    ...provider,
    apiKey: provider.apiKey || secrets.providers?.[provider.id]?.apiKey || '',
    secret: provider.secret || secrets.providers?.[provider.id]?.secret || '',
  }));
  communication.webhookSecret = communication.webhookSecret || secrets.webhookSecret || '';
  return clone;
}

module.exports = {
  vaultPath,
  requireSecureStorage,
  readVault,
  writeVault,
  saveCommunicationCredentials,
  getCredentialStatus,
  deleteCommunicationCredentials,
  hydrateCommunicationConfig,
};
