'use strict';

// Real Drive download + real Backup V2 restore in a disposable profile.
// The live profile is read-only and is never used as a restore target.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { app } = require('electron');

const sourceUserData = path.resolve(process.env.TDW_CURRENT_USER_DATA || '');
const reportPath = process.env.TDW_CURRENT_REPORT ? path.resolve(process.env.TDW_CURRENT_REPORT) : '';
if (!sourceUserData || !fs.existsSync(sourceUserData)) throw new Error('TDW_CURRENT_USER_DATA_required');
const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tdw-real-cloud-restore-'));

function writeReport(report) {
  const rendered = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, rendered, 'utf8');
  }
  process.stdout.write(rendered);
}

app.setPath('userData', sourceUserData);

app.whenReady().then(async () => {
  const report = {
    generatedAt: new Date().toISOString(),
    liveProfileMutated: false,
    disposableProfile: true,
    googleConnected: false,
    selected: null,
    restore: null,
    restart: null,
    bootstrapTarget: null,
  };
  let registration;
  let service;
  try {
    // Decrypt through the source profile's OS-bound vault, then re-encrypt in
    // the disposable profile. Raw credential files are never copied or logged.
    const tokenStore = require('../../electron/cloud-providers/token-store');
    const backupIpc = require('../../electron/backup-v2-ipc');
    const tokens = tokenStore.loadTokens('google');
    const secret = backupIpc.createFileCredentialVault(sourceUserData)
      .get(backupIpc.MASTER_SECRET_CREDENTIAL);
    if (!tokens || !secret) throw new Error('source_secure_material_unavailable');
    app.setPath('userData', isolatedRoot);
    tokenStore.saveTokens('google', tokens);
    backupIpc.createFileCredentialVault(isolatedRoot)
      .set(backupIpc.MASTER_SECRET_CREDENTIAL, secret);

    const google = require('../../electron/cloud-providers/google-drive');
    const status = await google.getStatus();
    report.googleConnected = status?.connected === true && status?.needsReauth !== true;
    if (!report.googleConnected) throw new Error('isolated_google_not_connected');
    const listed = await google.listBackups('google', 'NajjarTech');
    const candidates = (listed?.items || [])
      .filter((item) => /\.tdw$/i.test(String(item?.name || item?.path || '')))
      .sort((a, b) => new Date(b.modifiedAt || b.modifiedTime || 0) - new Date(a.modifiedAt || a.modifiedTime || 0));
    const selected = candidates[0];
    if (!selected?.path) throw new Error('cloud_backup_not_found');
    report.selected = {
      rank: 1,
      modifiedAt: selected.modifiedAt || selected.modifiedTime || null,
      sizeBytes: Number(selected.size || selected.sizeBytes) || 0,
    };

    const handlers = new Map();
    const V = require('../../electron/security/ipc-validate');
    service = require('../../electron/database/service');
    const sourceDb = new Database(path.join(sourceUserData, 'database', 'tadawi.db'), { readonly: true, fileMustExist: true });
    const sourceKv = (key) => {
      const row = sourceDb.prepare('SELECT value_json FROM kv_store WHERE key=?').get(key);
      return row ? JSON.parse(row.value_json) : null;
    };
    const setupLicense = sourceKv('__tdw_cloud_license__');
    const setupLegacyLicense = sourceKv('commercial_license_data_v2');
    const setupDevice = sourceKv('__tdw_device_config__');
    sourceDb.close();
    const activationCommit = service.commitSetupActivation({
      license: setupLicense,
      legacyLicense: setupLegacyLicense,
      remotePath: 'NajjarTech/license.json',
    });
    const setupBranchId = setupDevice?.lockedBranchId
      || setupLicense?.branches?.find((branch) => branch?.active !== false)?.id;
    const deviceCommit = activationCommit?.ok && setupBranchId
      ? service.commitSetupOrganizationDevice({
          license: setupLicense,
          centerName: setupLicense?.centerName || 'Isolated Runtime Center',
          branchId: setupBranchId,
          deviceName: setupDevice?.deviceName || 'Isolated restore device',
        })
      : { ok: false, error: 'bootstrap_identity_unavailable' };
    report.bootstrapTarget = {
      activationCommitted: activationCommit?.ok === true,
      deviceCommitted: deviceCommit?.ok === true,
      classification: require('../../electron/backup-v2-core')
        .classifySetupRestoreTarget(path.join(isolatedRoot, 'database', 'tadawi.db')).classification,
    };
    registration = backupIpc.registerBackupV2Ipc({
      handle: (channel, handler) => handlers.set(channel, handler),
      V,
      getUserDataPath: () => isolatedRoot,
      appVersion: 'isolated-runtime',
      app: null,
      closeDatabase: async () => service.close(),
      reopenDatabase: async () => service.ensureDb(),
      getLiveIdentity: () => ({
        centerId: setupLicense?.centerId || '',
        organizationId: setupLicense?.organizationId || setupLicense?.centerId || '',
        branchId: setupBranchId || '',
        authorizedBranchIds: (setupLicense?.branches || []).filter((branch) => branch?.active !== false).map((branch) => branch.id),
      }),
      bootstrapFromLocalSnapshot: (snapshot, options) => service.bootstrapFromLocalSnapshot(snapshot, options),
    });

    const restored = await handlers.get('backup:v2:setupCloudRestore')(null, {
      remotePath: selected.path,
      setupMode: true,
      relaunch: false,
    });
    structuredClone(restored);
    service.close();

    const dbPath = path.join(isolatedRoot, 'database', 'tadawi.db');
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const count = (table) => Number(db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c) || 0;
    const kvKeys = db.prepare('SELECT key FROM kv_store').all().map((row) => row.key);
    report.restore = {
      ok: restored?.ok === true,
      cloneable: true,
      quickCheck: db.pragma('quick_check', { simple: true }),
      clients: count('clients'),
      employees: count('employees'),
      users: count('users'),
      hasCloudLicense: kvKeys.includes('__tdw_cloud_license__'),
      hasRuntimeLicense: kvKeys.includes('commercial_license_data_v2'),
    };
    db.close();

    service.ensureDb();
    const preauth = service.hydratePreauth();
    const storedLicense = service.getStoredLicense();
    report.restart = {
      ok: preauth?.ok === true,
      visibleUsers: Array.isArray(preauth?.data?.users) ? preauth.data.users.length : 0,
      usableCredentials: Array.isArray(preauth?.data?.users)
        ? preauth.data.users.filter((user) => user.hasUsableCredential === true).length
        : 0,
      licensePresent: !!storedLicense?.centerId,
      licenseHasExpiry: !!(storedLicense?.expiresAt || storedLicense?.expiry),
    };
    writeReport(report);
  } finally {
    try { registration?.scheduler?.stop?.(); } catch {}
    try { service?.close?.(); } catch {}
    try { fs.rmSync(isolatedRoot, { recursive: true, force: true }); } catch {}
    app.quit();
  }
}).catch((error) => {
  try {
    writeReport({
      generatedAt: new Date().toISOString(),
      liveProfileMutated: false,
      disposableProfile: true,
      ok: false,
      error: String(error?.code || error?.message || error).slice(0, 200),
    });
  } catch {}
  try { fs.rmSync(isolatedRoot, { recursive: true, force: true }); } catch {}
  app.exit(1);
});
