'use strict';

/**
 * Backup V2 IPC wiring (Hybrid). Main-process only — no CSP impact.
 * Feature flag: HYBRID_BACKUP_V2 (default enabled).
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { dialog, safeStorage } = require('electron');
const backupV2 = require('./backup-v2-core');
const { BackupV2Scheduler } = require('./backup-v2-scheduler');
const { copyWithResume, uploadWithResume } = require('./backup-v2-transfer');
const backupMain = require('./backup');
const { encodeIpcError } = require('../cloud/ipc-error-envelope');
const { createByteProgressWatchdog, DEFAULT_STALL_MS } = require('./byte-progress-watchdog');
const MASTER_SECRET_CREDENTIAL = 'backup-v2-master-secret-v1';
const SETUP_RESTORE_DIAGNOSTIC_LIMIT = 40;

/** Setup-restore failures the operator can meaningfully retry as-is. */
const RETRYABLE_SETUP_RESTORE_CODES = new Set([
  'cloud_download_failed',
  'cloud_download_stalled',
  'backup_download_stalled',
  'cloud_download_incomplete',
  'backup_size_mismatch',
  'legacy_backup_read_failed',
  'legacy_setup_restore_failed',
  'cloud_backup_restore_failed',
  'restored_database_hydrate_failed',
]);

/**
 * Map a raw Main/provider error onto a stable setup-restore code.
 * Classification happens BEFORE anything is normalized away, so the operator
 * sees the real cause instead of a generic wrapper.
 */
function classifySetupRestoreFailure(raw, providerStatus) {
  const text = String(raw?.code || raw?.error || raw?.message || raw || '').toLowerCase();
  const status = Number(providerStatus) || null;
  if (status === 401 || /unauthorized|invalid_grant|needs_reauth/.test(text)) return 'needs_reauth';
  if (status === 403 || /forbidden|insufficient|permission/.test(text)) return 'backup_download_forbidden';
  if (status === 404 || /not_?found|no_such_file/.test(text)) return 'backup_file_not_found';
  if (status === 429 || (status && status >= 500) || /rate_?limit|timeout|econn|socket|network/.test(text)) {
    return 'cloud_download_failed';
  }
  if (/stall/.test(text)) return 'cloud_download_stalled';
  if (/abort/.test(text)) return 'cloud_download_stalled';
  if (/size_mismatch|expected_size|length_mismatch/.test(text)) return 'backup_size_mismatch';
  if (/checksum|sha256|hash_mismatch/.test(text)) return 'backup_checksum_failed';
  if (/password|decrypt|auth_tag|scrypt|authentication_failed/.test(text)) {
    return /required/.test(text) ? 'backup_password_required' : 'backup_decrypt_failed';
  }
  if (/magic|manifest|archive|unsupported|invalid.*format|unexpected token/.test(text)) return 'backup_archive_invalid';
  if (/integrity/.test(text)) return 'backup_sqlite_integrity_failed';
  if (/empty/.test(text)) return 'empty_cloud_backup';
  return null;
}

function generateBackupMasterSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function isBackupV2Enabled() {
  const raw = process.env.HYBRID_BACKUP_V2;
  if (raw == null || raw === '') return true;
  return raw !== '0' && raw !== 'false';
}

function asIdentity(opts = {}) {
  const centerId = String(opts.centerId || opts.organizationId || '').slice(0, 128);
  const organizationId = String(opts.organizationId || opts.centerId || '').slice(0, 128);
  const branchId = String(opts.branchId || '').slice(0, 128);
  const authorizedBranchIds = Array.isArray(opts.authorizedBranchIds)
    ? opts.authorizedBranchIds.map((v) => String(v).slice(0, 128)).filter(Boolean)
    : (branchId ? [branchId] : []);
  return {
    centerId,
    organizationId,
    branchId,
    authorizedBranchIds,
    deviceId: String(opts.deviceId || '').slice(0, 128),
    centerName: String(opts.centerName || '').slice(0, 200),
    deviceName: String(opts.deviceName || '').slice(0, 200),
    allowMissingSourceMetadata: opts.allowMissingSourceMetadata === true,
  };
}

function cloudBackupV2Path(identity, filename) {
  const center = String(identity?.centerId || identity?.organizationId || '')
    .replace(/[<>:"|?*\\/]/g, '_')
    .trim();
  return center
    ? `NajjarTech/${center}/Backups/V2/${filename}`
    : `Backups/V2/${filename}`;
}

function createFileCredentialVault(userDataDir) {
  const storePath = path.join(userDataDir, 'settings', 'backup-v2-credentials.json');
  function readAll() {
    try {
      return JSON.parse(fs.readFileSync(storePath, 'utf8'));
    } catch {
      return {};
    }
  }
  function writeAll(data) {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, `${JSON.stringify(data)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
  return {
    has(key) {
      try { return Boolean(this.get(key)); } catch { return false; }
    },
    get(key) {
      const all = readAll();
      const entry = all[key];
      if (!entry) return null;
      if (entry && typeof entry === 'object' && entry.encrypted === true && entry.data) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('secure_storage_unavailable');
        return safeStorage.decryptString(Buffer.from(String(entry.data), 'base64'));
      }
      // One-time migration from the previous plaintext credential file.
      if (typeof entry === 'string') {
        const legacy = entry;
        this.set(key, legacy);
        return legacy;
      }
      return null;
    },
    set(key, value) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('secure_storage_unavailable');
      const all = readAll();
      const encrypted = safeStorage.encryptString(String(value || ''));
      all[key] = { encrypted: true, scheme: 'electron-safeStorage', data: encrypted.toString('base64') };
      writeAll(all);
    },
    remove(key) {
      const all = readAll();
      delete all[key];
      writeAll(all);
    },
  };
}

function readLegacyBackupSnapshot(filePath, password) {
  const raw = fs.readFileSync(filePath);
  const first = raw.toString('utf8', 0, Math.min(raw.length, 128)).trimStart()[0];
  if (first !== '{') return null;

  let envelope;
  try {
    envelope = JSON.parse(raw.toString('utf8'));
  } catch {
    const err = new Error('legacy_backup_invalid_json');
    err.code = 'legacy_backup_invalid_json';
    throw err;
  }
  if (!envelope || typeof envelope !== 'object') return null;
  if (envelope._meta?.encrypted !== true) return envelope;
  if (!envelope.salt || !envelope.iv || !envelope.data) {
    const err = new Error('legacy_backup_envelope_invalid');
    err.code = 'legacy_backup_envelope_invalid';
    throw err;
  }

  try {
    const salt = Buffer.from(String(envelope.salt), 'base64');
    const iv = Buffer.from(String(envelope.iv), 'base64');
    const encrypted = Buffer.from(String(envelope.data), 'base64');
    if (salt.length !== 16 || iv.length !== 12 || encrypted.length <= 16) {
      throw new Error('invalid_legacy_envelope_lengths');
    }
    const authTag = encrypted.subarray(encrypted.length - 16);
    const ciphertext = encrypted.subarray(0, encrypted.length - 16);
    const key = crypto.pbkdf2Sync(String(password || ''), salt, 250000, 32, 'sha256');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch (cause) {
    const err = new Error('legacy_backup_password_invalid');
    err.code = 'legacy_backup_password_invalid';
    err.cause = cause;
    throw err;
  }
}

const SETUP_PRESERVED_KV_KEYS = Object.freeze([
  '__tdw_cloud_license__', 'commercial_license_data_v2', '__tdw_device_config__',
  '__tdw_meta__', '__tdw_drive_folders__',
]);

function parseDatabaseJson(value, fallback = null) {
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function captureSetupRestoreState(databasePath) {
  if (!fs.existsSync(databasePath)) return { kv: {}, deviceRegistries: [], authorityCenterId: '' };
  let db;
  try {
    db = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 5000 });
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    const kv = {};
    if (tables.has('kv_store')) {
      const placeholders = SETUP_PRESERVED_KV_KEYS.map(() => '?').join(',');
      for (const row of db.prepare(`SELECT key,value_json FROM kv_store WHERE key IN (${placeholders})`).all(...SETUP_PRESERVED_KV_KEYS)) {
        const value = parseDatabaseJson(row.value_json, undefined);
        if (value !== undefined) kv[row.key] = value;
      }
    }
    const deviceRegistries = tables.has('p0b_entities')
      ? db.prepare(`
          SELECT center_id,branch_id,payload_json,revision,updated_at
          FROM p0b_entities
          WHERE entity_type='__tdw_device_registry__' AND deleted_at IS NULL
        `).all().map((row) => ({ ...row, payload: parseDatabaseJson(row.payload_json, {}) }))
      : [];
    const authority = tables.has('meta')
      ? db.prepare("SELECT value FROM meta WHERE key='authorityCenterId'").get()
      : null;
    return { kv, deviceRegistries, authorityCenterId: String(authority?.value || '') };
  } finally {
    try { db?.close(); } catch { /* best effort */ }
  }
}

function applySetupRestoreState(databasePath, state) {
  const preserved = state && typeof state === 'object' ? state : { kv: {}, deviceRegistries: [] };
  let db;
  try {
    db = new Database(databasePath, { fileMustExist: true, timeout: 5000 });
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = DELETE');
    db.pragma('synchronous = FULL');
    db.transaction(() => {
      const kvGet = db.prepare('SELECT value_json FROM kv_store WHERE key=?');
      const kvPut = db.prepare(`
        INSERT INTO kv_store(key,value_json,updated_at) VALUES(?,?,?)
        ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at
      `);
      for (const [key, currentValue] of Object.entries(preserved.kv || {})) {
        let value = currentValue;
        if (key === '__tdw_meta__') {
          const stagedValue = parseDatabaseJson(kvGet.get(key)?.value_json, {}) || {};
          value = { ...stagedValue, ...(currentValue || {}) };
        }
        kvPut.run(key, JSON.stringify(value), new Date().toISOString());
      }

      const existingDevice = db.prepare(`
        SELECT payload_json,revision FROM p0b_entities
        WHERE center_id=? AND branch_id=? AND entity_type='__tdw_device_registry__' AND entity_id='__singleton__'
      `);
      const upsertDevice = db.prepare(`
        INSERT INTO p0b_entities(center_id,branch_id,entity_type,entity_id,payload_json,revision,deleted_at,updated_at)
        VALUES(?,?,'__tdw_device_registry__','__singleton__',?,?,NULL,?)
        ON CONFLICT(center_id,branch_id,entity_type,entity_id) DO UPDATE SET
          payload_json=excluded.payload_json,revision=excluded.revision,deleted_at=NULL,updated_at=excluded.updated_at
      `);
      for (const current of preserved.deviceRegistries || []) {
        const existing = existingDevice.get(current.center_id, current.branch_id);
        const existingPayload = parseDatabaseJson(existing?.payload_json, {}) || {};
        const currentPayload = current.payload || {};
        const registered = new Map();
        for (const device of existingPayload.value?.registered || []) {
          if (device?.deviceUuid) registered.set(String(device.deviceUuid), device);
        }
        for (const device of currentPayload.value?.registered || []) {
          if (device?.deviceUuid) registered.set(String(device.deviceUuid), device);
        }
        const merged = {
          ...existingPayload,
          ...currentPayload,
          centerId: current.center_id,
          branchId: current.branch_id,
          revision: Math.max(Number(existing?.revision) || 0, Number(current.revision) || 0) + 1,
          value: {
            ...(existingPayload.value || {}),
            ...(currentPayload.value || {}),
            registered: [...registered.values()],
            updatedAt: new Date().toISOString(),
          },
        };
        upsertDevice.run(
          current.center_id,
          current.branch_id,
          JSON.stringify(merged),
          merged.revision,
          new Date().toISOString(),
        );
      }
      if (preserved.authorityCenterId) {
        db.prepare(`
          INSERT INTO meta(key,value) VALUES('authorityCenterId',?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value
        `).run(preserved.authorityCenterId);
      }
    })();
    const quickCheck = db.pragma('quick_check', { simple: true });
    if (String(quickCheck).toLowerCase() !== 'ok') throw new Error('setup_identity_merge_integrity_failed');
    return { ok: true, preservedKeys: Object.keys(preserved.kv || {}), deviceRegistryCount: (preserved.deviceRegistries || []).length };
  } finally {
    try { db?.close(); } catch { /* best effort */ }
  }
}

function registerBackupV2Ipc({
  handle,
  V,
  getUserDataPath,
  appVersion,
  app,
  closeDatabase,
  reopenDatabase,
  applySecurityMaterial,
  rollbackSecurityMaterial,
  getCurrentSecurityMaterial,
  getLiveIdentity,
  bootstrapFromLocalSnapshot,
}) {
  if (!isBackupV2Enabled()) return { enabled: false, scheduler: null };

  let scheduler = null;
  const credentialVault = createFileCredentialVault(getUserDataPath());

  function ensureMasterSecret() {
    const existing = credentialVault.get(MASTER_SECRET_CREDENTIAL);
    if (existing) return { secret: existing, newlyCreated: false };
    const secret = generateBackupMasterSecret();
    credentialVault.set(MASTER_SECRET_CREDENTIAL, secret);
    return { secret, newlyCreated: true };
  }

  handle('backup:v2:ensureSecret', async () => {
    const secured = ensureMasterSecret();
    return {
      ok: true,
      recoverySecret: secured.secret,
      newlyCreated: secured.newlyCreated,
      entropyBits: 256,
      storage: 'electron-safeStorage',
    };
  });

  handle('backup:v2:rotateSecret', async () => {
    const secret = generateBackupMasterSecret();
    credentialVault.set(MASTER_SECRET_CREDENTIAL, secret);
    return {
      ok: true,
      recoverySecret: secret,
      rotated: true,
      entropyBits: 256,
      legacyBackupsRequirePreviousSecret: true,
    };
  });

  function resolveIdentity(opts = {}) {
    const fromLive = typeof getLiveIdentity === 'function' ? (getLiveIdentity() || {}) : {};
    return asIdentity({ ...fromLive, ...opts });
  }

  function defaultBackupDir() {
    return path.join(getUserDataPath(), 'Backups', 'V2');
  }

  function setupRestoreDiagnosticDir() {
    return path.join(getUserDataPath(), 'Backups', 'V2', 'diagnostics');
  }

  /**
   * Setup-restore tracing. Records the boundary a failure came from so the real
   * cause is recoverable after the fact — Electron IPC only carries the message.
   * Secrets are never recorded: passwords are reduced to a boolean.
   */
  function createSetupRestoreTrace(kind) {
    const operationId = `SRT-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const trace = {
      operationId,
      kind,
      startedAt: new Date().toISOString(),
      stages: [],
      outcome: null,
    };
    const mark = (stage, fields) => {
      trace.stages.push({ stage, at: new Date().toISOString(), ...(fields || {}) });
      return stage;
    };
    const flush = () => {
      try {
        const dir = setupRestoreDiagnosticDir();
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, `${operationId}.json`),
          JSON.stringify(trace, null, 2),
          { mode: 0o600 },
        );
        const files = fs.readdirSync(dir).filter((f) => /^SRT-.*\.json$/.test(f)).sort();
        for (const stale of files.slice(0, Math.max(0, files.length - SETUP_RESTORE_DIAGNOSTIC_LIMIT))) {
          try { fs.unlinkSync(path.join(dir, stale)); } catch { /* best effort */ }
        }
      } catch { /* diagnostics must never break restore */ }
    };
    // Facts accumulated during the operation, reported on both success and
    // failure. Never contains a password, token, or file content.
    const facts = {
      downloadedBytes: 0,
      expectedBytes: null,
      tempFileSize: null,
      providerStatus: null,
      decryptReached: false,
      sqliteReached: false,
    };
    const setFacts = (patch) => Object.assign(facts, patch || {});

    /** Throw a failure whose code survives Electron IPC serialization. */
    const fail = (code, fields) => {
      const stage = fields?.stage || trace.stages[trace.stages.length - 1]?.stage || 'unknown';
      trace.outcome = { ok: false, code, stage, ...facts };
      mark('failed', { code, stage });
      flush();
      const err = new Error(encodeIpcError(code, { op: operationId, stage }));
      err.code = code;
      err.stage = stage;
      err.operationId = operationId;
      err.structured = {
        ok: false,
        code,
        stage,
        operationId,
        retryable: RETRYABLE_SETUP_RESTORE_CODES.has(code),
        ...facts,
      };
      if (fields?.details) err.details = fields.details;
      return err;
    };
    const succeed = (fields) => {
      trace.outcome = { ok: true, ...facts, ...(fields || {}) };
      mark('completed');
      flush();
    };
    return { operationId, trace, mark, fail, succeed, flush, facts, setFacts };
  }

  function resolveSetupRestorePassword(opts = {}, trace = null) {
    let password = '';
    let source = 'none';
    if (typeof opts.password === 'string' && opts.password.length) {
      password = V.asString(opts.password, {
        name: 'password', required: true, allowEmpty: false, max: 256,
      });
      source = 'operator';
    } else {
      // Same-device recovery can use the Main-owned safeStorage secret without
      // ever exposing it to the pre-auth Renderer. A new device still receives
      // backup_password_required and asks the operator for the recovery secret.
      try {
        password = credentialVault.get(MASTER_SECRET_CREDENTIAL) || '';
        if (password) source = 'master_secret';
      } catch { password = ''; }
    }
    trace?.mark('password_resolved', { passwordProvided: !!password, passwordSource: source });
    if (!password) {
      if (trace) throw trace.fail('backup_password_required', { stage: 'password_resolved' });
      const err = new Error('backup_password_required');
      err.code = 'backup_password_required';
      throw err;
    }
    if (String(password).length < 8) {
      if (trace) throw trace.fail('password_too_short', { stage: 'password_resolved' });
      const err = new Error('password_too_short');
      err.code = 'password_too_short';
      throw err;
    }
    return String(password);
  }

  async function runRestore(filePath, password, opts = {}) {
    const identity = resolveIdentity(opts);
    const progress = [];
    try {
      const result = await backupV2.restoreBackupFile({
        filePath,
        password,
        userDataDir: opts.targetUserDataDir || getUserDataPath(),
        expectedIdentity: identity,
        closeDatabase: closeDatabase || undefined,
        reopenDatabase: reopenDatabase || undefined,
        applySecurityMaterial: applySecurityMaterial || undefined,
        rollbackSecurityMaterial: rollbackSecurityMaterial || undefined,
        currentSecurityMaterial: typeof getCurrentSecurityMaterial === 'function'
          ? getCurrentSecurityMaterial()
          : undefined,
        prepareStagedDatabase: typeof opts.prepareStagedDatabase === 'function'
          ? opts.prepareStagedDatabase
          : undefined,
        onProgress: (evt) => progress.push(evt),
        unrestorableReport: Array.isArray(opts.unrestorableReport) ? opts.unrestorableReport : [],
      });
      result.progress = progress;
      if (result.ok && result.needRestart && opts.relaunch !== false && app) {
        setTimeout(() => {
          try {
            app.relaunch();
            app.exit(0);
          } catch { /* ignore */ }
        }, 250);
      }
      return result;
    } catch (error) {
      const friendly = backupV2.friendlyBackupError(error);
      const err = new Error(friendly.message);
      err.code = friendly.code;
      err.progress = progress;
      throw err;
    }
  }

  handle('backup:v2:health', async () => {
    const databasePath = path.join(getUserDataPath(), 'database', 'tadawi.db');
    return {
      ...backupV2.databaseHealth(databasePath),
      gate: backupV2.readRestoreGate(getUserDataPath()),
      rowCounts: backupV2.countDatabaseRows(databasePath),
    };
  });

  handle('backup:v2:create', async (_e, options) => {
    const opts = V.asObject(options, { name: 'options' });
    const password = opts.password
      ? V.asString(opts.password, { name: 'password', required: true, allowEmpty: false, max: 256 })
      : ensureMasterSecret().secret;
    if (password.length < 8) {
      const err = new Error('password_too_short');
      err.code = 'password_too_short';
      throw err;
    }
    const identity = resolveIdentity(opts);
    const userDataDir = getUserDataPath();
    const outDir = opts.outputDir
      ? V.asString(opts.outputDir, { name: 'outputDir', required: true, allowEmpty: false })
      : defaultBackupDir();
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(outDir, `Tadawi-Backup-V2-${stamp}.tdw`);
    const createOpts = {
      userDataDir,
      outputPath: filePath,
      password,
      appVersion: appVersion || '2.0.0',
      backupType: opts.backupType || 'manual',
      centerId: identity.centerId,
      organizationId: identity.organizationId,
      branchId: identity.branchId,
      branchIds: identity.authorizedBranchIds,
      deviceId: identity.deviceId,
      centerName: identity.centerName,
      deviceName: identity.deviceName,
      scopeType: opts.scopeType || 'organization',
      retentionCount: Number(opts.retentionCount) || 20,
    };

    const uploadRequested = opts.cloud === true || opts.upload === true;
    if (!uploadRequested) {
      const created = await backupV2.createBackupFile(createOpts);
      const pruned = backupV2.pruneLocalBackups(outDir, createOpts.retentionCount, { keepPath: created.path });
      return { ...created, localOk: true, cloudOk: false, cloudSkipped: true, pruned: pruned.pruned };
    }

    return backupV2.createBackupWithUpload({
      ...createOpts,
      upload: async ({ path: localPath, buffer, filename, hash, manifest }) => {
        // Stage with resume support, then upload binary to Drive via existing provider.
        const stageDir = path.join(outDir, 'upload-staging');
        fs.mkdirSync(stageDir, { recursive: true });
        const staged = path.join(stageDir, filename);
        uploadWithResume(localPath, staged, { resume: true });
        const remotePath = cloudBackupV2Path(identity, filename);
        const uploaded = await backupMain.uploadCloud(buffer, filename, 'google', {
          remotePath,
          overwrite: false,
          sha256: hash,
          manifest,
        });
        if (!uploaded?.ok) {
          const err = new Error(uploaded?.message || 'cloud_upload_failed');
          err.code = uploaded?.needsReauth ? 'needs_reauth' : 'cloud_upload_failed';
          if (/quota|storageExceeded/i.test(String(uploaded?.message || ''))) err.code = 'quota_exceeded';
          throw err;
        }
        const committedRemotePath = uploaded.remotePath || uploaded.path || remotePath;
        const verified = await backupMain.verifyCloudBackup(committedRemotePath, hash, 'google');
        if (!verified?.ok || verified.hash !== hash) {
          const err = new Error(verified?.message || 'remote_hash_mismatch');
          err.code = 'remote_hash_mismatch';
          throw err;
        }
        // Commit remote only after provider ack; remove staging partials.
        try { fs.unlinkSync(staged); } catch { /* ignore */ }
        try { fs.unlinkSync(`${staged}.partial`); } catch { /* ignore */ }
        return {
          ok: true,
          remotePath: committedRemotePath,
          id: uploaded.id || null,
          expectedHash: hash,
          remoteHash: verified.hash,
          filename,
        };
      },
      pruneAfterUpload: async () => backupV2.pruneLocalBackups(outDir, createOpts.retentionCount, { keepPath: filePath }).pruned,
    });
  });

  handle('backup:v2:prune', async (_e, options) => {
    const opts = V.asObject(options || {}, { name: 'options' });
    const dir = opts.dir
      ? V.asString(opts.dir, { name: 'dir', required: true, allowEmpty: false })
      : defaultBackupDir();
    const retention = Number(opts.retentionCount) || 20;
    return backupV2.pruneLocalBackups(dir, retention);
  });

  handle('backup:v2:formatPolicy', async () => backupV2.backupFormatPolicy());

  handle('backup:v2:verify', async (_e, options) => {
    const opts = V.asObject(options, { name: 'options', required: true });
    const filePath = V.asString(opts.filePath, { name: 'filePath', required: true, allowEmpty: false });
    const password = V.asString(opts.password, { name: 'password', required: true, allowEmpty: false, max: 256 });
    return backupV2.verifyBackupFile(filePath, password, opts);
  });

  handle('backup:v2:inspect', async (_e, options) => {
    const opts = V.asObject(options, { name: 'options', required: true });
    const filePath = V.asString(opts.filePath, { name: 'filePath', required: true, allowEmpty: false });
    const password = V.asString(opts.password, { name: 'password', required: true, allowEmpty: false, max: 256 });
    const buf = fs.readFileSync(filePath);
    const inspected = backupV2.inspectEncryptedBackup(buf, password, opts);
    return {
      ok: true,
      manifest: inspected.manifest,
      database: inspected.database,
      encryptedSha256: inspected.encryptedSha256,
      encryptedSize: inspected.encryptedSize,
    };
  });

  handle('backup:v2:restore', async (_e, options) => {
    const opts = V.asObject(options, { name: 'options', required: true });
    const filePath = V.asString(opts.filePath, { name: 'filePath', required: true, allowEmpty: false });
    const password = V.asString(opts.password, { name: 'password', required: true, allowEmpty: false, max: 256 });
    return runRestore(filePath, password, opts);
  });

  handle('backup:v2:setupLocalRestore', async (_e, options) => {
    const opts = V.asObject(options, { name: 'options', required: true });
    if (opts.setupMode !== true) {
      const err = new Error('setup_mode_required');
      err.code = 'setup_mode_required';
      throw err;
    }
    const filePath = V.asString(opts.filePath, { name: 'filePath', required: true, allowEmpty: false });
    const password = resolveSetupRestorePassword(opts);
    if (!/\.(?:tdw|json)$/i.test(filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      const err = new Error('invalid_local_backup_path');
      err.code = 'invalid_local_backup_path';
      throw err;
    }
    const databasePath = path.join(getUserDataPath(), 'database', 'tadawi.db');
    const target = backupV2.classifySetupRestoreTarget(databasePath);
    if (target.ok !== true || target.replaceAllowed !== true) {
      const err = new Error('setup_restore_requires_empty_database');
      err.code = 'setup_restore_requires_empty_database';
      err.targetClassification = target;
      throw err;
    }
    const setupRestoreState = captureSetupRestoreState(databasePath);
    const legacySnapshot = readLegacyBackupSnapshot(filePath, password);
    if (legacySnapshot) {
      if (typeof bootstrapFromLocalSnapshot !== 'function') {
        const err = new Error('legacy_setup_restore_unavailable');
        err.code = 'legacy_setup_restore_unavailable';
        throw err;
      }
      const migrated = await bootstrapFromLocalSnapshot(legacySnapshot, {
        force: true,
        sourceLabel: 'first-setup-legacy-local-backup'
      });
      if (migrated?.ok !== true) {
        const err = new Error(migrated?.error || 'legacy_setup_restore_failed');
        err.code = migrated?.error || 'legacy_setup_restore_failed';
        throw err;
      }
      return { ok: true, legacy: true, needRestart: false, migration: migrated };
    }
    return runRestore(filePath, password, {
      ...opts,
      relaunch: false,
      prepareStagedDatabase: (stagedDatabasePath) => applySetupRestoreState(stagedDatabasePath, setupRestoreState),
    });
  });

  handle('backup:v2:listLocal', async (_e, options) => {
    const opts = V.asObject(options || {}, { name: 'options' });
    const dir = opts.dir
      ? V.asString(opts.dir, { name: 'dir', required: true, allowEmpty: false })
      : defaultBackupDir();
    return { ok: true, dir, files: backupV2.listLocalBackupFiles(dir) };
  });

  handle('backup:v2:pickLatest', async (_e, options) => {
    const opts = V.asObject(options, { name: 'options', required: true });
    const password = V.asString(opts.password, { name: 'password', required: true, allowEmpty: false, max: 256 });
    const identity = resolveIdentity(opts);
    const localDir = opts.dir
      ? V.asString(opts.dir, { name: 'dir', required: true, allowEmpty: false })
      : defaultBackupDir();
    const local = backupV2.listLocalBackupFiles(localDir);
    const cloud = Array.isArray(opts.cloudCandidates) ? opts.cloudCandidates : [];
    const picked = backupV2.pickLatestAuthorizedBackup(
      [...local, ...cloud],
      password,
      identity,
      opts
    );
    if (!picked.ok) {
      const err = new Error('no_authorized_backup');
      err.code = 'no_authorized_backup';
      err.details = picked;
      throw err;
    }
    return picked;
  });

  handle('backup:v2:restoreLatest', async (_e, options) => {
    const opts = V.asObject(options, { name: 'options', required: true });
    const password = V.asString(opts.password, { name: 'password', required: true, allowEmpty: false, max: 256 });
    const identity = resolveIdentity(opts);
    const localDir = opts.dir
      ? V.asString(opts.dir, { name: 'dir', required: true, allowEmpty: false })
      : defaultBackupDir();
    const local = backupV2.listLocalBackupFiles(localDir);
    const cloud = Array.isArray(opts.cloudCandidates) ? opts.cloudCandidates : [];
    const picked = backupV2.pickLatestAuthorizedBackup([...local, ...cloud], password, identity, opts);
    if (!picked.ok || !picked.selected?.filePath) {
      const err = new Error('no_authorized_backup');
      err.code = 'no_authorized_backup';
      throw err;
    }
    return runRestore(picked.selected.filePath, password, { ...opts, selected: picked.selected });
  });

  handle('backup:v2:pickFile', async (_e, options) => {
    const opts = V.asObject(options || {}, { name: 'options' });
    const extensions = opts.allowLegacy === true ? ['tdw', 'json'] : ['tdw'];
    const result = await dialog.showOpenDialog({
      title: 'اختر نسخة Backup V2',
      filters: [{ name: opts.allowLegacy === true ? 'Tadawi Backup' : 'Tadawi Backup V2', extensions }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths?.length) return { ok: false, canceled: true };
    return { ok: true, filePath: result.filePaths[0] };
  });

  handle('backup:v2:gate', async () => backupV2.readRestoreGate(getUserDataPath()));

  handle('backup:v2:stageRemote', async (_e, options) => {
    const opts = V.asObject(options, { name: 'options', required: true });
    const sourcePath = V.asString(opts.sourcePath, { name: 'sourcePath', required: true, allowEmpty: false });
    const password = opts.password
      ? V.asString(opts.password, { name: 'password', required: true, allowEmpty: false, max: 256 })
      : null;
    const stageDir = path.join(getUserDataPath(), 'Backups', 'V2', 'staging');
    fs.mkdirSync(stageDir, { recursive: true });
    const destPath = path.join(stageDir, path.basename(sourcePath).replace(/[^\w.\-]+/g, '_'));
    const progress = [];
    const staged = copyWithResume(sourcePath, destPath, {
      resume: opts.resume !== false,
      failAfterBytes: opts.failAfterBytes,
      onProgress: (evt) => progress.push(evt),
    });
    if (password) {
      backupV2.verifyBackupFile(staged.path, password, opts);
    }
    return { ...staged, progress };
  });

  handle('backup:v2:downloadAndRestore', async (_e, options) => {
    const opts = V.asObject(options, { name: 'options', required: true });
    const sourcePath = V.asString(opts.sourcePath, { name: 'sourcePath', required: true, allowEmpty: false });
    const password = V.asString(opts.password, { name: 'password', required: true, allowEmpty: false, max: 256 });
    const stageDir = path.join(getUserDataPath(), 'Backups', 'V2', 'staging');
    fs.mkdirSync(stageDir, { recursive: true });
    const destPath = path.join(stageDir, path.basename(sourcePath).replace(/[^\w.\-]+/g, '_'));
    const progress = [];
    const staged = copyWithResume(sourcePath, destPath, {
      resume: opts.resume !== false,
      onProgress: (evt) => progress.push(evt),
    });
    const restored = await runRestore(staged.path, password, opts);
    return { ...restored, staged, downloadProgress: progress };
  });

  // Setup-only restore: cloud discovery returns a Drive path, not a local file.
  // Keep this pre-login route constrained to a genuinely empty SQLite target.
  /**
   * Collapse any throw into a structured, serializable result.
   *
   * Electron replaces a thrown Error with `Error invoking remote method '<ch>':
   * …` in the renderer and drops every custom property, so the real cause was
   * unrecoverable. Returning a plain object keeps `code`, `stage` and the byte
   * facts intact. Nothing sensitive is included.
   */
  function toStructuredSetupRestoreFailure(error, trace) {
    if (error?.structured) return error.structured;
    const code = classifySetupRestoreFailure(error) || String(error?.code || 'cloud_backup_restore_failed');
    const stage = error?.stage || 'unknown';
    try { trace?.mark?.('failed_unclassified', { code, stage }); trace?.flush?.(); } catch { /* diagnostics only */ }
    return {
      ok: false,
      code,
      stage,
      operationId: trace?.operationId || null,
      retryable: RETRYABLE_SETUP_RESTORE_CODES.has(code),
      // Preserve a safe technical reason even when unclassified.
      technicalReason: String(error?.code || error?.message || 'unknown').slice(0, 200),
      ...(trace?.facts || {}),
    };
  }

  handle('backup:v2:setupCloudRestore', async (event, options) => {
    const trace = createSetupRestoreTrace('cloud');
    try {
      return await runSetupCloudRestore(event, options, trace);
    } catch (error) {
      return toStructuredSetupRestoreFailure(error, trace);
    }
  });

  async function runSetupCloudRestore(event, options, trace) {
    trace.mark('handler_entered');
    const opts = V.asObject(options, { name: 'options', required: true });
    if (opts.setupMode !== true) throw trace.fail('setup_mode_required', { stage: 'handler_entered' });
    const remotePath = V.asString(opts.remotePath, { name: 'remotePath', required: true, allowEmpty: false, max: 1024 });
    const password = resolveSetupRestorePassword(opts, trace);
    const normalized = remotePath.replace(/\\/g, '/');
    if (!/\.(?:tdw|json)$/i.test(normalized) || normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw trace.fail('invalid_remote_backup_path', { stage: 'remote_path_validated' });
    }
    trace.setFacts({ expectedBytes: Number(opts.expectedSizeBytes) > 0 ? Number(opts.expectedSizeBytes) : null });
    trace.mark('remote_path_validated', {
      remoteName: path.basename(normalized),
      expectedBytes: trace.facts.expectedBytes,
    });
    const databasePath = path.join(getUserDataPath(), 'database', 'tadawi.db');
    const target = backupV2.classifySetupRestoreTarget(databasePath);
    trace.mark('target_classified', {
      classification: target?.classification || null,
      replaceAllowed: target?.replaceAllowed === true,
      bootstrapRows: target?.bootstrapRows ?? null,
      meaningfulRows: target?.meaningfulRows ?? null,
      reasons: Array.isArray(target?.reasons) ? target.reasons.join(',') : null,
    });
    if (target.ok !== true || target.replaceAllowed !== true) {
      const err = trace.fail('setup_restore_requires_empty_database', { stage: 'target_classified' });
      err.targetClassification = target;
      throw err;
    }
    const setupRestoreState = captureSetupRestoreState(databasePath);
    const stageDir = path.join(getUserDataPath(), 'Backups', 'V2', 'staging');
    fs.mkdirSync(stageDir, { recursive: true });
    const safeName = path.basename(normalized).replace(/[^\w.\-]+/g, '_');
    const destPath = path.join(stageDir, `${Date.now()}-${safeName || 'setup.tdw'}`);
    const partialPath = `${destPath}.partial`;
    const sendDownloadProgress = (payload) => {
      try {
        event?.sender?.send?.('backup:downloadProgress', {
          remotePath: normalized,
          ...payload,
        });
      } catch { /* observer only */ }
    };
    sendDownloadProgress({ stage: 'download_start', downloadedBytes: 0, percent: 0 });
    trace.mark('provider_call_started');
    let observedBytes = 0;
    let progressEvents = 0;
    let headersReceived = false;
    let providerHttpStatus = null;
    // Arm BEFORE token refresh / provider resolve / remote lookup / media fetch.
    // Any hang in that chain must still abort within stallMs.
    const { raceAbort } = require('./cloud-providers/google-drive-api');
    const watchdog = createByteProgressWatchdog({
      stallMs: Number(opts.stallMs) > 0 ? Number(opts.stallMs) : DEFAULT_STALL_MS,
    });
    const watchdogState = watchdog.arm();
    trace.mark('watchdog_armed', {
      stallMs: watchdog.stallMs,
      armedAt: watchdogState.armedAt,
    });
    let downloaded;
    try {
      downloaded = await raceAbort(
        backupMain.downloadCloudBackup(normalized, 'google', {
          destPartialPath: partialPath,
          totalBytes: Number(opts.expectedSizeBytes) > 0 ? Number(opts.expectedSizeBytes) : null,
          signal: watchdog.signal,
          skipProviderResolve: true,
          onResponseHeaders: (meta) => {
            headersReceived = true;
            providerHttpStatus = Number(meta?.httpStatus) || providerHttpStatus;
            trace.mark('download_headers_received', {
              httpStatus: providerHttpStatus,
              contentLength: meta?.contentLength ?? null,
            });
          },
          onProgress: (evt) => {
            progressEvents += 1;
            const bytes = Number(evt?.downloadedBytes) || 0;
            if (bytes > observedBytes) {
              if (observedBytes <= 0 && bytes > 0) {
                trace.mark('first_byte', { downloadedBytes: bytes });
              }
              observedBytes = bytes;
              watchdog.touch(bytes);
            }
            if (evt?.httpStatus) providerHttpStatus = Number(evt.httpStatus) || providerHttpStatus;
            sendDownloadProgress(evt);
          },
        }),
        watchdog.signal,
      );
    } catch (error) {
      watchdog.disarm();
      try { if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath); } catch { /* best effort */ }
      const state = watchdog.getState();
      const classified = classifySetupRestoreFailure(error, providerHttpStatus)
        || (state.stalled || state.aborted ? 'cloud_download_stalled' : null)
        || 'cloud_download_failed';
      throw trace.fail(classified, {
        stage: 'provider_call_started',
        details: {
          watchdog: state,
          headersReceived,
          providerAbortObserved: state.aborted === true,
        },
      });
    }
    watchdog.disarm();
    const providerStatus = Number(downloaded?.status || downloaded?.httpStatus || providerHttpStatus) || null;
    trace.setFacts({
      downloadedBytes: observedBytes || Number(downloaded?.downloadedBytes) || 0,
      providerStatus,
      headersReceived,
      watchdog: watchdog.getState(),
    });
    trace.mark('provider_call_returned', {
      providerOk: downloaded?.ok === true,
      progressEvents,
      observedBytes,
      providerStatus,
      needsReauth: downloaded?.needsReauth === true,
      streamed: !!downloaded?.streamedPath,
      stalled: downloaded?.stalled === true,
      aborted: downloaded?.aborted === true,
      providerAbortObserved: watchdog.getState().aborted === true,
    });
    if (!downloaded?.ok) {
      try { if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath); } catch { /* best effort */ }
      const classified = classifySetupRestoreFailure(downloaded, providerStatus)
        || (downloaded?.stalled || downloaded?.aborted || downloaded?.code === 'cloud_download_stalled'
          ? 'cloud_download_stalled'
          : null)
        || (downloaded?.needsReauth ? 'needs_reauth' : 'cloud_download_failed');
      throw trace.fail(classified, {
        stage: 'provider_call_returned',
        details: downloaded?.message || null,
      });
    }
    let buffer = null;
    if (downloaded.streamedPath) {
      if (!fs.existsSync(downloaded.streamedPath)) {
        throw trace.fail('cloud_download_incomplete', { stage: 'provider_call_returned' });
      }
      fs.renameSync(downloaded.streamedPath, destPath);
      sendDownloadProgress({
        stage: 'download_complete',
        downloadedBytes: downloaded.downloadedBytes || fs.statSync(destPath).size,
        percent: 100,
      });
    } else {
      buffer = Buffer.isBuffer(downloaded.buffer)
        ? downloaded.buffer
        : Buffer.from(downloaded.payload || downloaded.text || '', 'utf8');
      if (!buffer.length) {
        throw trace.fail('empty_cloud_backup', { stage: 'provider_call_returned' });
      }
      fs.writeFileSync(partialPath, buffer, { mode: 0o600 });
      fs.renameSync(partialPath, destPath);
      sendDownloadProgress({
        stage: 'download_complete',
        downloadedBytes: buffer.length,
        percent: 100,
      });
    }
    const stagedBytes = (() => {
      try { return fs.statSync(destPath).size; } catch { return 0; }
    })();
    trace.setFacts({ tempFileSize: stagedBytes, downloadedBytes: observedBytes || stagedBytes });
    trace.mark('staged_file_ready', { stagedBytes });
    if (trace.facts.expectedBytes && stagedBytes && stagedBytes !== trace.facts.expectedBytes) {
      throw trace.fail('backup_size_mismatch', { stage: 'staged_file_ready' });
    }
    let legacySnapshot = null;
    try {
      trace.setFacts({ decryptReached: true });
      legacySnapshot = readLegacyBackupSnapshot(destPath, password);
    } catch (error) {
      throw trace.fail(
        classifySetupRestoreFailure(error) || String(error?.code || 'legacy_backup_read_failed'),
        { stage: 'legacy_classification' },
      );
    }
    trace.mark('format_classified', { format: legacySnapshot ? 'legacy_json' : 'backup_v2_archive' });
    if (legacySnapshot) {
      if (typeof bootstrapFromLocalSnapshot !== 'function') {
        throw trace.fail('legacy_setup_restore_unavailable', { stage: 'format_classified' });
      }
      const migrated = await bootstrapFromLocalSnapshot(legacySnapshot, {
        force: true,
        sourceLabel: 'first-setup-legacy-cloud-backup'
      });
      if (migrated?.ok !== true) {
        throw trace.fail(String(migrated?.error || 'legacy_setup_restore_failed'), { stage: 'legacy_migration' });
      }
      trace.succeed({ mode: 'legacy', stagedBytes });
      return {
        ok: true,
        legacy: true,
        needRestart: false,
        migration: migrated,
        operationId: trace.operationId,
        stagedPath: destPath,
        remotePath: normalized,
        downloadedBytes: buffer?.length || downloaded.downloadedBytes || stagedBytes
      };
    }
    let restored;
    try {
      trace.setFacts({ sqliteReached: true });
      restored = await runRestore(destPath, password, {
        ...opts,
        relaunch: false,
        prepareStagedDatabase: (stagedDatabasePath) => applySetupRestoreState(stagedDatabasePath, setupRestoreState),
      });
    } catch (error) {
      throw trace.fail(
        classifySetupRestoreFailure(error) || String(error?.code || 'cloud_backup_restore_failed'),
        { stage: 'restore_pipeline' },
      );
    }
    if (restored?.ok !== true) {
      throw trace.fail(
        classifySetupRestoreFailure(restored) || String(restored?.error || 'cloud_backup_restore_failed'),
        { stage: 'restore_pipeline' },
      );
    }
    trace.succeed({ mode: 'backup_v2', stagedBytes });
    return {
      ...restored,
      operationId: trace.operationId,
      stage: 'completed',
      stagedPath: destPath,
      remotePath: normalized,
      downloadedBytes: buffer?.length || downloaded.downloadedBytes || stagedBytes,
      expectedBytes: trace.facts.expectedBytes,
      tempFileSize: stagedBytes,
    };
  }

  handle('backup:v2:scheduleStatus', async () => {
    if (!scheduler) return { ok: false, enabled: false, error: 'scheduler_not_started' };
    return { ok: true, ...scheduler.status() };
  });

  handle('backup:v2:scheduleConfigure', async (_e, options) => {
    if (!scheduler) {
      const err = new Error('scheduler_not_started');
      err.code = 'scheduler_not_started';
      throw err;
    }
    const opts = V.asObject(options || {}, { name: 'options' });
    return { ok: true, ...scheduler.configure(opts) };
  });

  // Start scheduler (idempotent)
  try {
    const userDataDir = getUserDataPath();
    scheduler = new BackupV2Scheduler({
      userDataDir,
      credentialVault,
      runBackup: async (password, meta = {}) => {
        const identity = resolveIdentity(meta);
        const outDir = meta.localPath && String(meta.localPath).trim()
          ? String(meta.localPath).trim()
          : defaultBackupDir();
        fs.mkdirSync(outDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filePath = path.join(outDir, `Tadawi-Backup-V2-scheduled-${stamp}.tdw`);
        const retentionCount = Number(meta.retentionCount) || 20;
        const createOpts = {
          userDataDir,
          outputPath: filePath,
          password,
          appVersion: appVersion || '2.0.0',
          backupType: 'scheduled',
          centerId: identity.centerId,
          organizationId: identity.organizationId,
          branchId: identity.branchId,
          branchIds: identity.authorizedBranchIds,
          deviceId: identity.deviceId,
          centerName: identity.centerName || meta.centerName,
          deviceName: identity.deviceName || meta.deviceName,
          retentionCount,
        };
        if (meta.cloudEnabled === true) {
          return backupV2.createBackupWithUpload({
            ...createOpts,
            upload: async ({ buffer, filename, hash, manifest }) => {
              const remotePath = cloudBackupV2Path(identity, filename);
              const uploaded = await backupMain.uploadCloud(buffer, filename, 'google', {
                remotePath,
                overwrite: false,
                sha256: hash,
                manifest,
              });
              if (!uploaded?.ok) {
                const err = new Error(uploaded?.message || 'cloud_upload_failed');
                err.code = /quota|storageExceeded/i.test(String(uploaded?.message || ''))
                  ? 'quota_exceeded'
                  : 'cloud_upload_failed';
                throw err;
              }
              const committedRemotePath = uploaded.remotePath || uploaded.path || remotePath;
              const verified = await backupMain.verifyCloudBackup(committedRemotePath, hash, 'google');
              if (!verified?.ok || verified.hash !== hash) {
                const err = new Error(verified?.message || 'remote_hash_mismatch');
                err.code = 'remote_hash_mismatch';
                throw err;
              }
              return {
                ok: true,
                remotePath: committedRemotePath,
                id: uploaded.id || null,
                expectedHash: hash,
                remoteHash: verified.hash,
              };
            },
            pruneAfterUpload: async () => backupV2.pruneLocalBackups(outDir, retentionCount, { keepPath: filePath }).pruned,
          });
        }
        const created = await backupV2.createBackupFile(createOpts);
        const pruned = backupV2.pruneLocalBackups(outDir, retentionCount, { keepPath: created.path });
        return { ...created, localOk: true, cloudOk: false, cloudSkipped: true, pruned: pruned.pruned };
      },
    });
    scheduler.start();
  } catch (error) {
    console.error('[backup-v2] scheduler start failed:', error.message);
    scheduler = null;
  }

  return { enabled: true, scheduler };
}

module.exports = {
  isBackupV2Enabled,
  registerBackupV2Ipc,
  backupV2,
  asIdentity,
  cloudBackupV2Path,
  createFileCredentialVault,
  readLegacyBackupSnapshot,
  captureSetupRestoreState,
  applySetupRestoreState,
  MASTER_SECRET_CREDENTIAL,
  generateBackupMasterSecret,
};
