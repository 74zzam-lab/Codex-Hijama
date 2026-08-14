'use strict';

// Read-only production-profile diagnostic. It never uploads, deletes, applies,
// or prints OAuth tokens, Drive paths, file IDs, user names, or license keys.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { app } = require('electron');

const userDataPath = process.env.TDW_CURRENT_USER_DATA;
if (!userDataPath) throw new Error('TDW_CURRENT_USER_DATA_required');
app.setPath('userData', path.resolve(userDataPath));

function safeError(error) {
  return String(error?.code || error?.message || error || 'unknown')
    .replace(/ya29\.[A-Za-z0-9_.-]+/g, '[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .slice(0, 200);
}

function countKinds(items) {
  const counts = { total: items.length, backupV2: 0, license: 0, config: {}, operations: 0, versions: 0 };
  for (const item of items) {
    const name = String(item?.name || path.basename(String(item?.path || ''))).toLowerCase();
    const full = String(item?.path || '').toLowerCase();
    if (name.endsWith('.tdw')) counts.backupV2 += 1;
    if (name === 'license.json') counts.license += 1;
    if (name === 'versions.json') counts.versions += 1;
    if (/operations\//.test(full) && name.endsWith('.json')) counts.operations += 1;
    for (const config of ['settings.json', 'prices.json', 'services.json', 'packages.json', 'users.json', 'owner.json']) {
      if (name === config) counts.config[config] = (counts.config[config] || 0) + 1;
    }
  }
  return counts;
}

function inspectDatabaseBuffer(buffer) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tdw-cloud-inspect-'));
  const dbPath = path.join(tempRoot, 'inspect.db');
  try {
    fs.writeFileSync(dbPath, buffer, { mode: 0o600 });
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      const counts = {};
      for (const { name } of tableRows) {
        try { counts[name] = Number(db.prepare(`SELECT COUNT(*) AS c FROM "${String(name).replace(/"/g, '""')}"`).get().c); }
        catch { counts[name] = null; }
      }
      const kvKeys = counts.kv_store
        ? db.prepare('SELECT key FROM kv_store ORDER BY key').all().map((row) => row.key)
        : [];
      return {
        quickCheck: db.pragma('quick_check', { simple: true }),
        counts,
        hasCloudLicense: kvKeys.includes('__tdw_cloud_license__'),
        hasRuntimeLicense: kvKeys.includes('commercial_license_data_v2'),
      };
    } finally { db.close(); }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function summarizeLegacySnapshot(snapshot) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const counts = {};
  for (const key of ['clients', 'visits', 'employees', 'users', 'invoices', 'expenses', 'income', 'attendance', 'commissions', 'inventory']) {
    if (Array.isArray(source[key])) counts[key] = source[key].length;
  }
  return {
    counts,
    hasLicense: !!(source.license || source.licenseData || source.__tdw_cloud_license__ || source.commercial_license_data_v2),
  };
}

function inspectLegacyEnvelope(buffer, password) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
  if (!text.startsWith('{')) return null;
  let envelope;
  try { envelope = JSON.parse(text); } catch { return { json: false }; }
  const encrypted = envelope?._meta?.encrypted === true;
  const result = {
    json: true,
    encrypted,
    format: String(envelope?._meta?.format || envelope?._meta?.version || 'legacy-json'),
  };
  if (!encrypted) return { ...result, snapshot: summarizeLegacySnapshot(envelope) };
  if (!password) return result;
  try {
    const salt = Buffer.from(String(envelope?.salt || ''), 'base64');
    const iv = Buffer.from(String(envelope?.iv || ''), 'base64');
    const packed = Buffer.from(String(envelope?.data || ''), 'base64');
    const tag = packed.subarray(Math.max(0, packed.length - 16));
    const ciphertext = packed.subarray(0, Math.max(0, packed.length - 16));
    const key = crypto.pbkdf2Sync(String(password), salt, 250000, 32, 'sha256');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    result.decryptedWithCurrentSecret = true;
    result.snapshot = summarizeLegacySnapshot(JSON.parse(plaintext));
  } catch (error) {
    result.decryptedWithCurrentSecret = false;
    result.decryptError = safeError(error);
  }
  return result;
}

app.whenReady().then(async () => {
  const google = require('../../electron/cloud-providers/google-drive');
  const backupV2 = require('../../electron/backup-v2-core');
  const backupIpc = require('../../electron/backup-v2-ipc');
  const report = { generatedAt: new Date().toISOString(), readOnly: true, google: null, roots: [], backups: [] };
  const status = await google.getStatus();
  report.google = {
    connected: status?.connected === true,
    needsReauth: status?.needsReauth === true,
    hasRefreshToken: status?.hasRefreshToken === true,
  };
  const all = [];
  if (report.google.connected && !report.google.needsReauth) {
    for (const root of ['NajjarTech', 'NajjarTech Hijama Management', 'Backups/V2']) {
      const started = Date.now();
      const listed = await google.listBackups('google', root);
      const items = Array.isArray(listed?.items) ? listed.items : [];
      report.roots.push({ root, ok: listed?.ok === true, durationMs: Date.now() - started, ...countKinds(items) });
      for (const item of items) {
        if (!all.some((existing) => existing.id && item.id && existing.id === item.id)) all.push(item);
      }
    }
  }

  let secret = '';
  try { secret = backupIpc.createFileCredentialVault(userDataPath).get(backupIpc.MASTER_SECRET_CREDENTIAL) || ''; } catch {}
  const candidates = all
    .filter((item) => /\.tdw$/i.test(String(item?.name || item?.path || '')))
    .sort((a, b) => new Date(b.modifiedTime || b.modifiedAt || 0) - new Date(a.modifiedTime || a.modifiedAt || 0))
    .slice(0, 8);
  for (const [index, item] of candidates.entries()) {
    const row = {
      rank: index + 1,
      sizeBytes: Number(item.size || item.sizeBytes) || 0,
      modifiedAt: item.modifiedTime || item.modifiedAt || null,
      downloaded: false,
      decryptedWithCurrentSecret: false,
    };
    try {
      const downloaded = await google.downloadBackup(item.path);
      if (downloaded?.ok) {
        row.downloaded = true;
        const buffer = Buffer.isBuffer(downloaded.buffer)
          ? downloaded.buffer
          : Buffer.from(downloaded.payload || downloaded.text || '', 'utf8');
        row.downloadedBytes = buffer.length;
        if (secret) {
          try {
            const inspected = backupV2.inspectEncryptedBackup(buffer, secret);
            row.decryptedWithCurrentSecret = true;
            row.format = 'backup-v2';
            row.identity = {
              centerIdPresent: !!(inspected.manifest?.source?.centerId || inspected.manifest?.source?.organizationId),
              branchIdPresent: !!inspected.manifest?.source?.branchId,
              createdAt: inspected.manifest?.createdAt || null,
            };
            row.database = inspectDatabaseBuffer(inspected.entries[backupV2.DATABASE_PATH]);
          } catch (error) {
            const legacy = inspectLegacyEnvelope(buffer, secret);
            if (legacy) {
              row.format = 'legacy-json';
              row.legacy = legacy;
              row.error = legacy.decryptedWithCurrentSecret === false ? 'legacy_backup_password_required' : undefined;
            } else {
              row.error = safeError(error);
            }
          }
        }
      } else row.error = safeError(downloaded?.message || downloaded?.error);
    } catch (error) { row.error = safeError(error); }
    report.backups.push(row);
  }
  report.currentSecretAvailable = !!secret;
  const rendered = `${JSON.stringify(report, null, 2)}\n`;
  if (process.env.TDW_CURRENT_REPORT) fs.writeFileSync(path.resolve(process.env.TDW_CURRENT_REPORT), rendered, 'utf8');
  process.stdout.write(rendered);
  app.quit();
}).catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: safeError(error) })}\n`);
  app.exit(1);
});
