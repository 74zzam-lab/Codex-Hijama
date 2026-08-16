const { app, BrowserWindow, ipcMain, Menu, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const uninstallPrep = require('./uninstall-prep');
const userdataMigration = require('./userdata-migration');
const pathGuard = require('./security/path-guard');
const V = require('./security/ipc-validate');
const windowPolicy = require('./security/window-policy');
const rbacSession = require('./rbac-session');
const passwordAuth = require('./security/password-auth');
const credentialVault = require('./security/secure-credential-vault');

/** Fixed userData path — preserves data across rebranding and reinstalls */
const USER_DATA_FOLDER = 'Cupping Center';
const APP_ROOT = path.join(__dirname, '..');
const MAIN_PRELOAD = path.join(__dirname, 'preload.js');
const PRINT_PRELOAD = path.join(__dirname, 'security', 'preload-print.js');

const IS_UNINSTALL_PREP = process.argv.includes('--uninstall-prep');
const IS_UNINSTALL_FULL = process.argv.includes('--uninstall-full');
const WIPE_ONLY_IDX = process.argv.indexOf('--uninstall-wipe-only');
const IS_UNINSTALL_WIPE_ONLY = WIPE_ONLY_IDX >= 0;
const WIPE_ONLY_TARGET = IS_UNINSTALL_WIPE_ONLY
  ? String(process.argv[WIPE_ONLY_IDX + 1] || '').trim()
  : '';
const USER_DATA_ARG_PREFIX = '--user-data-dir=';
const userDataArg = process.argv.find((arg) => String(arg || '').startsWith(USER_DATA_ARG_PREFIX));
const rawUserDataOverride = userDataArg ? String(userDataArg).slice(USER_DATA_ARG_PREFIX.length).trim() : '';
let USER_DATA_OVERRIDE = '';
if (rawUserDataOverride) {
  const resolved = path.resolve(rawUserDataOverride);
  if (path.isAbsolute(rawUserDataOverride) && resolved !== path.parse(resolved).root) {
    USER_DATA_OVERRIDE = resolved;
  }
}
if (WIPE_ONLY_TARGET) {
  app.commandLine.appendSwitch('user-data-dir', WIPE_ONLY_TARGET);
}
if (IS_UNINSTALL_PREP || IS_UNINSTALL_WIPE_ONLY) {
  app.commandLine.appendSwitch('disable-gpu');
}
const pkg = require('../package.json');
const branding = require('../branding.config.json');
const APP_VERSION = pkg.version || '2.0.0';
const APP_PUBLISHER = branding.company?.name || 'NajjarTech';
const APP_PRODUCT_NAME = branding.product?.name || pkg.build?.productName || 'Hijama Management System';
const APP_ICON_PATH = path.join(APP_ROOT, 'build', 'Program-Icon.ico');
const APP_ICON = fs.existsSync(APP_ICON_PATH) ? APP_ICON_PATH : undefined;

// Packaged apps always use a stable userData folder — except wipe-only mode,
// which must target the path passed by uninstall-prep (archive or live root).
// Must run BEFORE any BrowserWindow or DB open.
if (USER_DATA_OVERRIDE) {
  app.setPath('userData', USER_DATA_OVERRIDE);
} else if (app.isPackaged) {
  if (WIPE_ONLY_TARGET) {
    app.setPath('userData', WIPE_ONLY_TARGET);
  } else {
    app.setPath('userData', path.join(app.getPath('appData'), USER_DATA_FOLDER));
  }
} else if (WIPE_ONLY_TARGET) {
  app.setPath('userData', WIPE_ONLY_TARGET);
} else if (process.env.TDAWI_FORCE_USER_DATA_FOLDER === '1') {
  app.setPath('userData', path.join(app.getPath('appData'), USER_DATA_FOLDER));
}

app.setName(APP_PRODUCT_NAME);
passwordAuth.configureAttemptPersistence(require('./security/auth-attempt-store'));

if (process.platform === 'win32') {
  app.setAppUserModelId('com.tadawi.cuppingcenter');
}

app.setAboutPanelOptions({
  applicationName: APP_PRODUCT_NAME,
  applicationVersion: APP_VERSION,
  version: APP_VERSION,
  copyright: branding.company?.copyright || `Copyright © ${new Date().getFullYear()} ${APP_PUBLISHER}. All rights reserved.`,
  credits: `Developed by ${APP_PUBLISHER}\n${branding.company?.tagline || ''}\n${branding.product?.description || ''}\n\nSupport: ${branding.company?.supportEmail || ''}`,
  website: branding.company?.website || 'https://najjartech.com',
});

const {
  saveLocal: backupSaveLocal,
  connectGoogle: backupConnectGoogle,
  registerCloudAccount: backupRegisterCloudAccount,
  uploadCloud: backupUploadCloud,
  uploadSyncFile: backupUploadSyncFile,
  downloadSyncFile: backupDownloadSyncFile,
  disconnectCloud: backupDisconnectCloud,
  listCloudBackups: backupListCloudBackups,
  discoverCloudRestorePoints: backupDiscoverCloudRestorePoints,
  downloadCloudBackup: backupDownloadCloudBackup,
  deleteCloudBackup: backupDeleteCloudBackup,
  verifyCloudBackup: backupVerifyCloudBackup,
  startOAuth: backupStartOAuth,
  getCloudStatus: backupGetCloudStatus,
  listCloudProviders: backupListCloudProviders,
  pickLocalFolder: backupPickLocalFolder,
  uploadDbBackup: backupUploadDbBackup,
  listDbBackups: backupListDbBackups,
  restoreDbBackup: backupRestoreDbBackup,
  syncDbBackup: backupSyncDbBackup,
  verifyDbBackup: backupVerifyDbBackup,
} = require('./backup');
const { createDeviceCache } = require('./device-cache');

function getDeviceCache() {
  return createDeviceCache(app.getPath('userData'));
}
const {
  listPrinters,
  openCashDrawer,
  openCashDrawerDirect,
  printThermal,
  printA4,
  printWithDialog,
  exportA4Pdf,
  getDeviceStatus,
  writeRaw,
} = require('./devices');
const { sendWhatsApp, sendSMS, getMessagingStatus, gateway } = require('./messaging');

let mainWindow = null;
const IS_PROD = app.isPackaged;
// Customer production surface: only implemented providers are accepted.
const CLOUD_PROVIDERS = ['google', 'local-folder', 'local-vault'];

function assertTrustedSender(event) {
  try {
    const wc = event?.sender;
    if (!wc || wc.isDestroyed()) V.fail('IPC_SENDER', 'sender_destroyed');
    const url = wc.getURL?.() || '';
    if (!url) return;
    if (windowPolicy.isBlankUrl(url)) return;
    if (!windowPolicy.isAppLocalUrl(url, APP_ROOT)) {
      V.fail('IPC_SENDER', 'untrusted_sender');
    }
  } catch (err) {
    if (err.code) throw err;
  }
}

function handle(channel, handler) {
  ipcMain.handle(channel, V.guard(async (event, ...args) => {
    assertTrustedSender(event);
    rbacSession.assertChannelAllowed(event, channel);
    return handler(event, ...args);
  }));
}

async function runUninstallWipeOnlyWindow() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { win?.destroy(); } catch { /* ignore */ }
      reject(new Error('uninstall_wipe_timeout'));
    }, 90_000);

    const finish = (code) => {
      clearTimeout(timeout);
      try { win?.destroy(); } catch { /* ignore */ }
      resolve(code);
    };

    ipcMain.once('uninstall:wipeComplete', () => finish(0));

    const win = new BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      ...(APP_ICON ? { icon: APP_ICON } : {}),
      webPreferences: windowPolicy.secureWebPreferences({
        preloadPath: MAIN_PRELOAD,
        isProd: true,
        sandbox: true,
      }),
    });

    win.webContents.on('did-fail-load', () => finish(1));
    win.loadFile(path.join(APP_ROOT, 'index.html'), {
      query: { uninstallLicenseWipe: '1' },
    }).catch(() => finish(1));
  });
}

function hardenWindowForProduction(win) {
  if (!IS_PROD || !win?.webContents) return;

  win.setMenuBarVisibility(false);
  win.setAutoHideMenuBar(true);

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '').toLowerCase();
    const ctrl = !!(input.control || input.meta);
    const shift = !!input.shift;
    const blocked =
      key === 'f12' ||
      (ctrl && shift && (key === 'i' || key === 'j' || key === 'c')) ||
      (ctrl && key === 'u');
    if (blocked) event.preventDefault();
  });

  win.webContents.on('devtools-opened', () => {
    win.webContents.closeDevTools();
  });

  win.webContents.on('context-menu', (event) => {
    event.preventDefault();
  });
}

function attachWindowOpenPolicy(parentWin) {
  parentWin.webContents.setWindowOpenHandler(({ url, features }) => {
    const kind = windowPolicy.classifyWindowOpen(url, APP_ROOT);

    if (kind === 'external') {
      windowPolicy.openExternalSafe(url).catch(() => {});
      return { action: 'deny' };
    }

    if (kind === 'deny') {
      return { action: 'deny' };
    }

    let width = kind === 'print' ? 920 : 1024;
    let height = kind === 'print' ? 800 : 768;
    const wMatch = /width=(\d+)/i.exec(features || '');
    const hMatch = /height=(\d+)/i.exec(features || '');
    if (wMatch) width = parseInt(wMatch[1], 10) || width;
    if (hMatch) height = parseInt(hMatch[1], 10) || height;

    // Print / about:blank and queue display: limited print preload — never main preload
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        show: true,
        width,
        height,
        autoHideMenuBar: IS_PROD,
        webPreferences: windowPolicy.secureWebPreferences({
          preloadPath: PRINT_PRELOAD,
          isProd: IS_PROD,
          sandbox: true,
        }),
      },
    };
  });

  parentWin.webContents.on('did-create-window', (childWin) => {
    windowPolicy.attachNavigationGuards(childWin.webContents, { appRoot: APP_ROOT, isMain: false });
    if (IS_PROD) hardenWindowForProduction(childWin);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: `${APP_PRODUCT_NAME} — ${APP_PUBLISHER}`,
    ...(APP_ICON ? { icon: APP_ICON } : {}),
    autoHideMenuBar: IS_PROD,
    webPreferences: windowPolicy.secureWebPreferences({
      preloadPath: MAIN_PRELOAD,
      isProd: IS_PROD,
      sandbox: true,
    }),
  });

  if (IS_PROD) {
    Menu.setApplicationMenu(null);
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setAutoHideMenuBar(true);
    hardenWindowForProduction(mainWindow);
  }

  windowPolicy.attachNavigationGuards(mainWindow.webContents, { appRoot: APP_ROOT, isMain: true });
  attachWindowOpenPolicy(mainWindow);

  mainWindow.loadFile(path.join(APP_ROOT, 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    gateway.initGateway({}, mainWindow).catch(() => {});
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const ses = session.defaultSession;
  windowPolicy.applyPermissionPolicy(ses);
  windowPolicy.applyContentSecurityPolicy(ses, { appRoot: APP_ROOT });

  if (IS_UNINSTALL_WIPE_ONLY) {
    try {
      await runUninstallWipeOnlyWindow();
      app.exit(0);
    } catch {
      app.exit(1);
    }
    return;
  }
  if (IS_UNINSTALL_PREP) {
    try {
      const result = await uninstallPrep.runUninstallPrep({
        userDataRoot: app.getPath('userData'),
        execPath: process.execPath,
        fullRemoval: IS_UNINSTALL_FULL,
      });
      app.exit(result.ok ? 0 : 1);
    } catch {
      app.exit(1);
    }
    return;
  }

  // DATA-001..006: migrate legacy userData into canonical Cupping Center (once).
  if (!IS_UNINSTALL_WIPE_ONLY && !USER_DATA_OVERRIDE
      && (app.isPackaged || process.env.TDAWI_FORCE_USER_DATA_FOLDER === '1')) {
    try {
      const canonical = app.getPath('userData');
      const mig = userdataMigration.migrateUserDataIfNeeded({
        canonicalRoot: canonical,
        appData: app.getPath('appData'),
        localAppData: process.env.LOCALAPPDATA || '',
        log: (...args) => console.log(...args),
        integrityCheckDb: (dbPath) => {
          try {
            const Database = require('better-sqlite3');
            const db = new Database(dbPath, { readonly: true, fileMustExist: true });
            const row = db.prepare('PRAGMA integrity_check').get();
            const ok = row && String(row.integrity_check || Object.values(row)[0]).toLowerCase() === 'ok';
            try { db.close(); } catch { /* ignore */ }
            return { ok, detail: row };
          } catch (err) {
            return { ok: false, detail: String(err && err.message) };
          }
        },
      });
      if (!mig.ok) {
        console.error('[userdata-migration] blocked startup safely:', mig.error || mig);
      }
    } catch (err) {
      console.error('[userdata-migration] unexpected error (continuing with canonical path):', err.message);
    }
  }

  // MIG-P0B-001: never open/migrate a legacy database before a verified,
  // encrypted Backup V2 has been committed beside the SQLite safety copy.
  try {
    await require('./p0b-migration-preflight').prepareP0bMigrationBackup({
      userDataDir: app.getPath('userData'),
      appVersion: APP_VERSION,
    });
  } catch (error) {
    console.error('[p0b-migration] preflight backup blocked startup:', error.message);
    dialog.showErrorBox(
      'تعذر تأمين ترقية قاعدة البيانات',
      'لم يتم إنشاء نسخة Backup V2 الآمنة قبل الترقية. لم تُعدّل قاعدة البيانات. أعد تشغيل البرنامج أو تواصل مع الدعم.'
    );
    app.exit(1);
    return;
  }

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let _isQuitting = false;
function gracefulShutdown(reason) {
  if (_isQuitting) return;
  _isQuitting = true;
  try {
    console.log('[quit] gracefulShutdown:', reason || 'unknown');
  } catch { /* ignore */ }
  try {
    const dbService = require('./database/service');
    dbService.close?.();
  } catch { /* ignore */ }
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (!win.isDestroyed()) win.destroy();
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

app.on('before-quit', () => {
  gracefulShutdown('before-quit');
});
app.on('will-quit', () => {
  gracefulShutdown('will-quit');
});
app.on('quit', () => {
  gracefulShutdown('quit');
});

// ── Devices ──────────────────────────────────────────────
handle('devices:listPrinters', () => listPrinters());
handle('devices:printThermal', (_e, html, opts) => {
  const safeHtml = V.asHtml(html);
  return printThermal(safeHtml, V.asObject(opts));
});
handle('devices:printA4', (_e, html, opts) => {
  const safeHtml = V.asHtml(html);
  return printA4(safeHtml, V.asObject(opts));
});
handle('devices:exportA4Pdf', (_e, html, opts) => {
  const safeHtml = V.asHtml(html);
  return exportA4Pdf(safeHtml, V.asObject(opts));
});
handle('devices:printWithDialog', (_e, html, opts) => {
  const safeHtml = V.asHtml(html);
  return printWithDialog(safeHtml, V.asObject(opts));
});
handle('devices:openCashDrawer', (_e, opts) => openCashDrawer(V.asObject(opts)));
handle('devices:openCashDrawerDirect', (_e, opts) => openCashDrawerDirect(V.asObject(opts)));
handle('devices:getStatus', (_e, saved) => getDeviceStatus(V.asObject(saved)));
handle('devices:writeRaw', (_e, printerName, buffer) => {
  const name = V.asString(printerName, { name: 'printerName', max: 256, required: true, allowEmpty: false });
  return writeRaw(name, V.asBufferish(buffer));
});

// ── Messaging ────────────────────────────────────────────
handle('messaging:sendWhatsApp', (_e, phone, text, config, meta) =>
  sendWhatsApp(
    V.asString(phone, { name: 'phone', max: 40, required: true }),
    V.asString(text, { name: 'text', max: 10000, required: true }),
    V.asObject(config),
    V.asObject(meta)
  ));
handle('messaging:sendSMS', (_e, phone, text, config, meta) =>
  sendSMS(
    V.asString(phone, { name: 'phone', max: 40, required: true }),
    V.asString(text, { name: 'text', max: 2000, required: true }),
    V.asObject(config),
    V.asObject(meta)
  ));
handle('messaging:getStatus', (_e, config) => getMessagingStatus(V.asObject(config)));

// ── Communication gateway ────────────────────────────────
handle('communication:listProviders', () => gateway.listBuiltinProviders());
handle('communication:testProvider', (_e, provider) =>
  gateway.testProvider(
    credentialVault.hydrateCommunicationConfig({
      communication: { providers: [V.asObject(provider, { required: true })] },
    }).communication.providers[0]
  ));
handle('communication:send', (_e, config, payload) =>
  gateway.sendMessage(
    credentialVault.hydrateCommunicationConfig(V.asObject(config)),
    V.asObject(payload, { required: true })
  ));
handle('communication:getStatus', (_e, config) =>
  gateway.getGatewayStatus(credentialVault.hydrateCommunicationConfig(V.asObject(config))));
handle('communication:processQueue', (_e, config) =>
  gateway.processQueueNow(credentialVault.hydrateCommunicationConfig(V.asObject(config))));
handle('communication:getQueue', () => gateway.getQueueItems(80));
handle('communication:clearQueue', (_e, status) =>
  gateway.clearQueue(V.asOptionalString(status, { name: 'status', max: 40 })));
handle('communication:init', (_e, config) => {
  if (mainWindow) return gateway.initGateway(
    credentialVault.hydrateCommunicationConfig(V.asObject(config)),
    mainWindow
  );
  return { ok: false };
});
handle('communication:saveCredentials', (_e, payload) =>
  credentialVault.saveCommunicationCredentials(V.asObject(payload, { required: true, maxKeys: 4 })));
handle('communication:getCredentialStatus', () => credentialVault.getCredentialStatus());
handle('communication:deleteCredentials', (_e, providerId) =>
  credentialVault.deleteCommunicationCredentials(
    V.asOptionalString(providerId, { name: 'providerId', max: 160 })
  ));

// ── Backup ───────────────────────────────────────────────
handle('backup:saveLocal', async (_e, payload, filename, localPath) => {
  const data = V.asPayload(payload);
  const name = V.asString(filename, { name: 'filename', max: 200, required: true });
  const hint = V.asOptionalString(localPath, { name: 'localPath', max: 500 });
  return backupSaveLocal(data, name, hint);
});

handle('backup:connectGoogle', async (_e, email, provider) =>
  backupConnectGoogle(
    V.asEmail(email),
    V.asEnum(provider, CLOUD_PROVIDERS, { defaultValue: 'google' })
  ));

handle('backup:registerCloudAccount', async (_e, email, provider) =>
  backupRegisterCloudAccount(
    V.asEmail(email, { required: true }),
    V.asEnum(provider, CLOUD_PROVIDERS, { defaultValue: 'google' })
  ));

handle('backup:uploadCloud', async (_e, payload, filename, provider, meta) =>
  backupUploadCloud(
    V.asPayload(payload),
    V.asString(filename, { name: 'filename', max: 200, required: true }),
    V.asEnum(provider, CLOUD_PROVIDERS, { defaultValue: 'google' }),
    V.asObject(meta)
  ));

handle('backup:uploadActivationArtifact', async (_e, payload, remotePath, provider) => {
  const data = V.asPayload(payload, { name: 'activationArtifact', maxChars: 512 * 1024 });
  const remote = V.asString(remotePath, {
    name: 'remotePath', max: 500, required: true, allowEmpty: false,
  });
  const selectedProvider = V.asEnum(provider, ['google'], { defaultValue: 'google' });
  if (!/^NajjarTech\/[^/]{1,160}\/License\/license\.json$/.test(remote)) {
    V.fail('IPC_FORMAT', 'activation_remote_path_invalid');
  }
  let document;
  try {
    document = typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    V.fail('IPC_FORMAT', 'activation_artifact_invalid_json');
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    V.fail('IPC_TYPE', 'activation_artifact_must_be_object');
  }
  const centerId = V.asString(document.centerId, {
    name: 'centerId', max: 160, required: true, allowEmpty: false,
  });
  if (!/^[A-Za-z0-9_.:-]{2,160}$/.test(centerId)) {
    V.fail('IPC_FORMAT', 'activation_center_id_invalid');
  }
  const remoteCenterId = remote.split('/')[1] || '';
  if (remoteCenterId !== centerId) {
    V.fail('IPC_FORMAT', 'activation_center_path_mismatch');
  }
  V.asString(document.signature, {
    name: 'signature', max: 4096, required: true, allowEmpty: false,
  });
  const cryptographicVerification = await licenseVerifier.verifyLicenseDoc(document);
  if (cryptographicVerification?.ok !== true) {
    V.fail('IPC_AUTHZ', cryptographicVerification?.error || 'activation_signature_invalid');
  }
  const serialized = typeof data === 'string' ? data : JSON.stringify(document);
  return backupUploadCloud(serialized, 'license.json', selectedProvider, {
    remotePath: remote,
    overwrite: true,
    atomicReplace: true,
    activationArtifact: true,
  });
});

handle('backup:uploadSyncFile', async (_e, payload, filename, provider, folder) =>
  backupUploadSyncFile(
    V.asPayload(payload),
    V.asString(filename, { name: 'filename', max: 200, required: true }),
    V.asEnum(provider, CLOUD_PROVIDERS, { defaultValue: 'google' }),
    V.asOptionalString(folder, { name: 'folder', max: 200 })
  ));

handle('backup:downloadSyncFile', async (_e, filename, provider, folder) =>
  backupDownloadSyncFile(
    V.asString(filename, { name: 'filename', max: 200, required: true }),
    V.asEnum(provider, CLOUD_PROVIDERS, { defaultValue: 'google' }),
    V.asOptionalString(folder, { name: 'folder', max: 200 })
  ));

handle('backup:disconnectCloud', async (_e, provider) =>
  backupDisconnectCloud(V.asEnum(provider, CLOUD_PROVIDERS, { defaultValue: 'google' })));

handle('backup:listCloudBackups', async (_e, provider, prefix) =>
  backupListCloudBackups(
    V.asEnum(provider, CLOUD_PROVIDERS, { defaultValue: 'google' }),
    V.asOptionalString(prefix, { name: 'prefix', max: 200 })
  ));

handle('backup:discoverCloudRestorePoints', async (event, options) => {
  const opts = V.asObject(options || {}, { name: 'options' });
  let timeoutMs;
  if (opts.timeoutMs != null) {
    const n = Number(opts.timeoutMs);
    if (!Number.isFinite(n) || n < 1000 || n > 180000) V.fail('INVALID_TIMEOUT', 'timeoutMs_out_of_range');
    timeoutMs = Math.floor(n);
  }
  return backupDiscoverCloudRestorePoints({
    centerId: V.asOptionalString(opts.centerId, { name: 'centerId', max: 120 }),
    branchId: V.asOptionalString(opts.branchId, { name: 'branchId', max: 120 }),
    branchName: V.asOptionalString(opts.branchName, { name: 'branchName', max: 200 }),
    centerName: V.asOptionalString(opts.centerName, { name: 'centerName', max: 200 }),
    timeoutMs,
    progressSender: event.sender,
  });
});

handle('backup:downloadCloudBackup', async (_e, remotePath, provider) => {
  const rp = V.asString(remotePath, { name: 'remotePath', max: 1000, required: true });
  if (pathGuard.hasTraversal(rp)) V.fail('PATH_TRAVERSAL', 'remote_path_traversal');
  return backupDownloadCloudBackup(rp, V.asEnum(provider, CLOUD_PROVIDERS, { defaultValue: 'google' }));
});

handle('backup:deleteCloudBackup', async (_e, remotePath, provider) => {
  const rp = V.asString(remotePath, { name: 'remotePath', max: 1000, required: true });
  if (pathGuard.hasTraversal(rp)) V.fail('PATH_TRAVERSAL', 'remote_path_traversal');
  return backupDeleteCloudBackup(rp, V.asEnum(provider, CLOUD_PROVIDERS, { defaultValue: 'google' }));
});

handle('backup:verifyCloudBackup', async (_e, remotePath, expectedHash, provider) => {
  const rp = V.asString(remotePath, { name: 'remotePath', max: 1000, required: true });
  if (pathGuard.hasTraversal(rp)) V.fail('PATH_TRAVERSAL', 'remote_path_traversal');
  return backupVerifyCloudBackup(
    rp,
    V.asString(expectedHash, { name: 'expectedHash', max: 128, required: true }),
    V.asEnum(provider, CLOUD_PROVIDERS, { defaultValue: 'google' })
  );
});

handle('backup:startOAuth', async (_e, provider, opts) =>
  backupStartOAuth(
    V.asEnum(provider, CLOUD_PROVIDERS, { defaultValue: 'google' }),
    V.asObject(opts)
  ));

handle('backup:getCloudStatus', async (_e, provider) =>
  backupGetCloudStatus(V.asEnum(provider, CLOUD_PROVIDERS, { defaultValue: 'google' })));

handle('backup:listCloudProviders', async () => backupListCloudProviders());

handle('backup:pickLocalFolder', async () => backupPickLocalFolder());

handle('backup:uploadDbBackup', async (_e, password, meta) =>
  backupUploadDbBackup(
    V.asString(password, { name: 'password', max: 200, required: true, allowEmpty: false }),
    V.asObject(meta)
  ));

handle('backup:listDbBackups', async (_e, meta) => backupListDbBackups(V.asObject(meta)));

handle('backup:restoreDbBackup', async (_e, remotePath, password, relaunch) => {
  const rp = V.asString(remotePath, { name: 'remotePath', max: 1000, required: true });
  if (pathGuard.hasTraversal(rp)) V.fail('PATH_TRAVERSAL', 'remote_path_traversal');
  const result = await backupRestoreDbBackup(
    rp,
    V.asString(password, { name: 'password', max: 200, required: true, allowEmpty: false })
  );
  if (result.ok && result.needRestart && relaunch !== false) {
    app.relaunch();
    app.exit(0);
  }
  return result;
});

handle('backup:syncDbBackup', async (_e, password, meta) =>
  backupSyncDbBackup(
    V.asString(password, { name: 'password', max: 200, required: true, allowEmpty: false }),
    V.asObject(meta)
  ));

handle('backup:verifyDbBackup', async (_e, remotePath, expectedHash) => {
  const rp = V.asString(remotePath, { name: 'remotePath', max: 1000, required: true });
  if (pathGuard.hasTraversal(rp)) V.fail('PATH_TRAVERSAL', 'remote_path_traversal');
  return backupVerifyDbBackup(
    rp,
    V.asString(expectedHash, { name: 'expectedHash', max: 128, required: true })
  );
});

// Attachments lifecycle IPC (local blob store)
require('./attachments-ipc').registerAttachmentsIpc(handle);

// Hybrid Backup V2 (main-process; feature flag HYBRID_BACKUP_V2, default on)
const dbServiceForBackup = require('./database/service');
require('./backup-v2-ipc').registerBackupV2Ipc({
  handle,
  V,
  getUserDataPath: () => app.getPath('userData'),
  appVersion: APP_VERSION,
  app,
  closeDatabase: async () => {
    dbServiceForBackup.close?.();
  },
  reopenDatabase: async () => {
    dbServiceForBackup.ensureDb?.();
  },
  getLiveIdentity: () => {
    try {
      const userData = app.getPath('userData');
      const settingsPath = path.join(userData, 'settings', 'app.json');
      let settings = {};
      let databaseSnapshot = {};
      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) || {};
      }
      try {
        const snapshot = dbServiceForBackup.hydrate?.();
        databaseSnapshot = snapshot?.data || {};
        if (snapshot?.ok && snapshot.data?.settings && typeof snapshot.data.settings === 'object') {
          settings = { ...settings, ...snapshot.data.settings };
        }
      } catch { /* use file fallback */ }
      const cloud = settings.cloudV2 || settings.cloud || {};
      const meta = databaseSnapshot.__tdw_meta__ || {};
      const license = databaseSnapshot.__tdw_cloud_license__ || {};
      const centerId = String(
        cloud.centerId || settings.centerId || settings.organizationId
        || meta.centerId || meta.organizationId || license.centerId || license.organizationId || ''
      ).slice(0, 128);
      const branchId = String(cloud.branchId || settings.branchId || settings.activeBranchId || settings.defaultBranchId || '').slice(0, 128);
      const authorizedBranchIds = Array.isArray(license.branches)
        ? license.branches.filter((branch) => branch && branch.active !== false && branch.id)
          .map((branch) => String(branch.id).slice(0, 128))
        : [];
      return {
        centerId,
        organizationId: String(cloud.organizationId || meta.organizationId || license.organizationId || centerId || '').slice(0, 128),
        branchId,
        authorizedBranchIds: authorizedBranchIds.length ? authorizedBranchIds : (branchId ? [branchId] : []),
        deviceId: String(cloud.deviceId || settings.deviceId || '').slice(0, 128),
        centerName: String(settings.centerName || cloud.centerName || '').slice(0, 200),
        deviceName: String(settings.deviceName || cloud.deviceName || '').slice(0, 200),
      };
    } catch {
      return {};
    }
  },
  bootstrapFromLocalSnapshot: (snapshot, options) =>
    dbServiceForBackup.bootstrapFromLocalSnapshot(snapshot, options),
});

// ── Device cache ─────────────────────────────────────────
handle('cache:writeBranchConfig', async (_e, centerId, branchId, pack) =>
  getDeviceCache().writeBranchConfig(
    pathGuard.safeId(centerId, 'centerId'),
    pathGuard.safeId(branchId, 'branchId'),
    V.asObject(pack, { required: true })
  ));

handle('cache:readBranchConfig', async (_e, centerId, branchId) =>
  getDeviceCache().readBranchConfig(
    pathGuard.safeId(centerId, 'centerId'),
    pathGuard.safeId(branchId, 'branchId')
  ));

handle('cache:writeLicense', async (_e, centerId, doc) =>
  getDeviceCache().writeLicense(
    pathGuard.safeId(centerId, 'centerId'),
    V.asObject(doc, { required: true })
  ));

handle('cache:readLicense', async (_e, centerId) =>
  getDeviceCache().readLicense(pathGuard.safeId(centerId, 'centerId')));

handle('cache:writeVersions', async (_e, centerId, versions) =>
  getDeviceCache().writeVersions(
    pathGuard.safeId(centerId, 'centerId'),
    V.asObject(versions, { required: true })
  ));

handle('cache:readVersions', async (_e, centerId) =>
  getDeviceCache().readVersions(pathGuard.safeId(centerId, 'centerId')));

handle('cache:getStatus', async (_e, centerId) =>
  getDeviceCache().getStatus(pathGuard.safeId(centerId, 'centerId')));

const LICENSE_WIPE_FLAG = '.license-wipe-on-launch';

function rmDirSafe(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

function wipePersistentLicenseData(userDataRoot) {
  const root = userDataRoot || app.getPath('userData');
  // Prefer shared uninstall-prep helper when available
  if (typeof uninstallPrep.wipeChromiumLicenseStorage === 'function') {
    uninstallPrep.wipeChromiumLicenseStorage(root);
  }
  [
    'CloudVault', 'cache', 'Local Storage', 'Session Storage', 'IndexedDB',
    'Code Cache', 'GPUCache', 'blob_storage', 'databases', 'Service Worker',
    'Cookies', 'Network', 'WebStorage'
  ].forEach((sub) => rmDirSafe(path.join(root, sub)));
  [
    'cloud-oauth.config.json', 'cloud-oauth.developer.json',
    'communication-queue.json', LICENSE_WIPE_FLAG, 'Preferences', 'Local State'
  ].forEach((f) => {
    try {
      const p = path.join(root, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch { /* ignore */ }
  });
}

handle('app:consumeLicenseWipeFlag', () => {
  try {
    const flagPath = path.join(app.getPath('userData'), LICENSE_WIPE_FLAG);
    if (fs.existsSync(flagPath)) {
      fs.unlinkSync(flagPath);
      wipePersistentLicenseData();
      return { wipe: true };
    }
  } catch { /* ignore */ }
  return { wipe: false };
});

handle('app:wipePersistentLicenseData', () => {
  try {
    wipePersistentLicenseData();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

handle('app:writeUninstallCenterMeta', (_e, payload) => {
  try {
    const doc = uninstallPrep.writeUninstallCenterMeta(app.getPath('userData'), V.asObject(payload));
    return { ok: !!doc, meta: doc };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

handle('app:getRuntimeInfo', () => ({
  environment: app.isPackaged ? 'Production' : 'Development',
  appVersion: APP_VERSION,
  buildVersion: APP_VERSION,
  dbSchemaVersion: branding.product?.dbSchemaVersion ?? 3,
  electron: process.versions.electron,
  chromium: process.versions.chrome,
  node: process.versions.node,
  productName: APP_PRODUCT_NAME,
  company: APP_PUBLISHER,
  security: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  },
}));

handle('app:relaunch', async (_e, options) => {
  const opts = V.asObject(options || {}, { name: 'options' });
  setTimeout(() => {
    try {
      const extra = opts.reason ? [`--setup-relaunch=${String(opts.reason).slice(0, 64)}`] : [];
      app.relaunch({ args: process.argv.slice(1).concat(extra) });
    } catch {
      app.relaunch();
    }
    app.exit(0);
  }, 250);
  return { ok: true, relaunching: true };
});

handle('app:getDeviceFingerprintParts', () => {
  const os = require('os');
  const crypto = require('crypto');
  const hash = (s) => crypto.createHash('sha256').update(String(s || '')).digest('hex').slice(0, 16);
  return {
    ok: true,
    platform: process.platform,
    arch: process.arch,
    hostnameHash: hash(os.hostname()),
    userDataHash: hash(app.getPath('userData')),
  };
});

handle('app:openExternal', async (_e, url) => {
  const target = V.asString(url, { name: 'url', max: 2000, required: true, allowEmpty: false });
  return windowPolicy.openExternalSafe(target);
});

const dbService = require('./database/service');
const licenseEntitlements = require('./license-entitlements');
const { createLicenseIssuer } = require('./license-issuer');
const { createSyncOperationTransport } = require('./database/sync-operation-transport');
const syncOperationTransport = createSyncOperationTransport(dbService);
const setupActivation = require('./setup-activation');
const licenseVerifier = require('./license-verifier');
const licenseIssuer = createLicenseIssuer();

function assertDeveloperIssuerSession(event) {
  const current = rbacSession.getSession(event);
  if (!current?.isDev || current.userId !== '__dev__') {
    const error = new Error('developer_authentication_required');
    error.code = 'rbac_developer_required';
    throw error;
  }
  return current;
}

function lookupUsersFromKv() {
  try {
    return dbService.listUsersForAuthentication();
  } catch {
    return [];
  }
}

function databaseContextForEvent(event, options = {}) {
  const sessionState = rbacSession.getSession(event);
  const authority = dbService.readAuthorityIdentity();
  const sessionCenter = String(sessionState?.centerId || '').trim();
  const centerId = sessionCenter && sessionCenter !== '*'
    ? sessionCenter
    : String(authority.centerId || '').trim();
  const writeBranch = String(sessionState?.writeBranchId || '').trim();
  const deviceId = crypto.createHash('sha256')
    .update(String(app.getPath('userData')))
    .digest('hex')
    .slice(0, 32);
  return {
    centerId,
    branchId: writeBranch || null,
    actorId: sessionState?.userId || null,
    role: String(sessionState?.role || '').toLowerCase(),
    deviceId,
    aggregate: options.read === true
      && !writeBranch
      && ['owner', 'hq_admin'].includes(String(sessionState?.role || '')),
    trusted: options.trusted === true,
  };
}

handle('rbac:bindSession', (e, claim) => {
  const payload = V.asObject(claim, { name: 'claim', required: true, maxKeys: 40 });
  return rbacSession.bindSession(e, {
    ...payload,
    lookupUsers: lookupUsersFromKv,
  });
});
handle('rbac:authenticateDeveloper', (e, password) => {
  const secret = V.asString(password, {
    name: 'password', max: 512, required: true, allowEmpty: false,
  });
  const result = passwordAuth.authenticateDeveloper(secret, e?.sender?.id);
  if (!result.ok) return result;
  return rbacSession.issueAuthenticationProof(e, result);
});
handle('rbac:authenticateUser', (e, input) => {
  const payload = V.asObject(input, { name: 'credentials', required: true, maxKeys: 8 });
  const credentials = {
    userId: V.asString(payload.userId, { name: 'userId', max: 160, required: true, allowEmpty: false }),
    role: V.asString(payload.role, { name: 'role', max: 40, required: true, allowEmpty: false }),
    password: V.asString(payload.password, { name: 'password', max: 512, required: true, allowEmpty: false }),
  };
  const users = lookupUsersFromKv();
  const result = passwordAuth.authenticateUser(users, credentials, e?.sender?.id);
  if (!result.ok) return result;

  let passwordHash = null;
  if (result.needsUpgrade && result.upgradedHash) {
    const updatedUsers = users.map((user) => (
      user && String(user.id) === String(result.user.id)
        ? { ...user, password: result.upgradedHash, passwordKdfVersion: 2 }
        : user
    ));
    const upgraded = dbService.replaceOrganizationUsers(updatedUsers, {
      centerId: String(
        result.user.centerId || result.user.center_id || dbService.readAuthorityIdentity().centerId || ''
      ),
      actorId: String(result.user.id),
      deviceId: databaseContextForEvent(e).deviceId,
    });
    if (upgraded?.ok === false) return upgraded;
    passwordHash = result.upgradedHash;
  }

  const identity = {
    userId: String(result.user.id),
    role: String(result.user.role || '').toLowerCase(),
    sessionEpoch: Number(result.user.sessionEpoch) || 0,
    isDev: false,
    centerId: String(
      result.user.centerId || result.user.center_id || dbService.readAuthorityIdentity().centerId || ''
    ),
  };
  const proof = rbacSession.issueAuthenticationProof(e, identity);
  return {
    ...proof,
    userId: identity.userId,
    role: identity.role,
    sessionEpoch: identity.sessionEpoch,
    passwordHash,
  };
});
handle('rbac:clearSession', (e) => rbacSession.clearSession(e));
handle('rbac:setWriteBranch', (e, branchId) => {
  const branch = V.asString(branchId, { name: 'branchId', max: 160, required: true, allowEmpty: false });
  return rbacSession.setWriteBranch(e, branch);
});
handle('rbac:clearWriteBranch', (e) => rbacSession.clearWriteBranch(e));
handle('rbac:getSession', (e) => {
  const s = rbacSession.getSession(e);
  return s
    ? { ok: true, session: {
      userId: s.userId,
      role: s.role,
      sessionEpoch: s.sessionEpoch,
      centerId: s.centerId || null,
      writeBranchId: s.writeBranchId || null,
      boundAt: s.boundAt,
    } }
    : { ok: false, error: 'no_session' };
});

/** Sync native confirm — used by renderer window.confirm polyfill (logout, deletes, …). */
ipcMain.on('dialog:confirmSync', (event, message) => {
  try {
    assertTrustedSender(event);
    rbacSession.assertChannelAllowed(event, 'dialog:confirmSync');
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = dialog.showMessageBoxSync(win || undefined, {
      type: 'question',
      buttons: ['إلغاء', 'تأكيد'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      title: 'تأكيد',
      message: String(message || 'هل أنت متأكد؟').slice(0, 2000),
    });
    event.returnValue = res === 1;
  } catch {
    event.returnValue = false;
  }
});

/** Sync native prompt (simple single-line) — Electron has no window.prompt. */
ipcMain.on('dialog:promptSync', (event, message, defaultValue) => {
  try {
    assertTrustedSender(event);
    rbacSession.assertChannelAllowed(event, 'dialog:promptSync');
    const win = BrowserWindow.fromWebContents(event.sender);
    // MessageBox cannot collect text; return null and let renderer use async modal.
    // Kept as channel for future custom prompt window; currently always null.
    void win;
    void message;
    void defaultValue;
    event.returnValue = null;
  } catch {
    event.returnValue = null;
  }
});

handle('database:status', (e) => dbService.getStatus(databaseContextForEvent(e, { read: true })));
handle('database:hydrate', (e) => {
  const sessionState = rbacSession.getSession(e);
  if (!sessionState) {
    return dbService.hydratePreauth();
  }
  return dbService.hydrate(databaseContextForEvent(e, { read: true }));
});
handle('database:setupCommitActivation', async (_e, options) => {
  const opts = V.asObject(options, { name: 'options', required: true, maxKeys: 8 });
  const remotePath = V.asString(opts.remotePath, {
    name: 'remotePath', required: true, allowEmpty: false, max: 1024,
  });
  const legacyLicense = V.asObject(opts.legacyLicense, {
    name: 'legacyLicense', required: true, maxKeys: 40,
  });
  const verified = await setupActivation.verifyRemoteSetupActivation({ remotePath, legacyLicense });
  return dbService.commitSetupActivation({
    license: verified.license,
    legacyLicense: verified.legacyLicense,
    remotePath: verified.remotePath,
  });
});
handle('database:setupCommitSignedActivation', async (_e, options) => {
  const opts = V.asObject(options, { name: 'options', required: true, maxKeys: 4 });
  const license = V.asObject(opts.license, { name: 'license', required: true, maxKeys: 40 });
  const legacyLicense = V.asObject(opts.legacyLicense, {
    name: 'legacyLicense', required: true, maxKeys: 40,
  });
  const verified = await setupActivation.verifySignedSetupActivation({ license, legacyLicense });
  return dbService.commitSetupActivation({
    license: verified.license,
    legacyLicense: verified.legacyLicense,
    remotePath: verified.remotePath,
  });
});
handle('database:setupCommitOrganizationDevice', async (_e, options) => {
  const opts = V.asObject(options, { name: 'options', required: true, maxKeys: 12 });
  const centerName = V.asOptionalString(opts.centerName, { name: 'centerName', max: 160 })?.trim() || '';
  const branchId = V.asOptionalString(opts.branchId, { name: 'branchId', max: 64 })?.trim() || '';
  const deviceName = V.asOptionalString(opts.deviceName, { name: 'deviceName', max: 160 })?.trim() || '';
  const branchOnly = opts.branchOnly === true;
  const createBranch = V.asObject(opts.createBranch || {}, { name: 'createBranch', maxKeys: 8 });
  const remotePath = dbService.getSetupLicenseRemotePath();
  if (!remotePath) V.fail('SETUP_LICENSE_PATH_MISSING', 'setup_license_remote_path_missing');
  const verified = remotePath.startsWith('signed-token:')
    ? await setupActivation.verifySignedSetupActivation({ license: dbService.getStoredLicense() })
    : await setupActivation.verifyRemoteSetupActivation({ remotePath });
  let license = verified.license;
  let selectedBranchId = branchId;
  let publishedBranch = null;
  if (Object.keys(createBranch).length) {
    const published = await setupActivation.publishFirstSetupBranch(remotePath, license, {
      id: V.asOptionalString(createBranch.id, { name: 'branchId', max: 64 }) || '',
      name: V.asString(createBranch.name, { name: 'branchName', required: true, allowEmpty: false, max: 160 }),
      nameEn: V.asOptionalString(createBranch.nameEn, { name: 'branchNameEn', max: 160 }) || '',
      code: V.asOptionalString(createBranch.code, { name: 'branchCode', max: 64 }) || '',
      city: V.asOptionalString(createBranch.city, { name: 'branchCity', max: 160 }) || '',
      phone: V.asOptionalString(createBranch.phone, { name: 'branchPhone', max: 40 }) || '',
    });
    license = published.license;
    selectedBranchId = published.branch.id;
    publishedBranch = published.branch;
  }
  if (branchOnly) {
    const branch = publishedBranch || (Array.isArray(license.branches) ? license.branches : [])
      .find((item) => item && String(item.id) === selectedBranchId);
    return dbService.commitSetupBranchOnly({
      commandId: `setup-branch:${crypto.createHash('sha256').update(JSON.stringify({
        licenseId: license.licenseUuid || license.licenseId || '',
        branchId: selectedBranchId,
        centerName,
      })).digest('hex').slice(0, 32)}`,
      license,
      centerName,
      branch,
    });
  }
  return dbService.commitSetupOrganizationDevice({
    commandId: `setup-org-device:${crypto.createHash('sha256').update(JSON.stringify({
      licenseId: license.licenseUuid || license.licenseId || '',
      branchId: selectedBranchId,
      deviceName: deviceName.toLowerCase(),
      centerName,
    })).digest('hex').slice(0, 32)}`,
    license,
    centerName,
    branchId: selectedBranchId,
    deviceName,
  });
});
handle('database:setupCommitOwner', async (_e, options) => {
  const opts = V.asObject(options, { name: 'options', required: true, maxKeys: 10 });
  const username = V.asString(opts.username, {
    name: 'username', required: true, allowEmpty: false, max: 80,
  }).trim().toLowerCase();
  const fullName = V.asString(opts.fullName, {
    name: 'fullName', required: true, allowEmpty: false, max: 160,
  }).trim();
  const password = V.asString(opts.password, {
    name: 'password', required: true, allowEmpty: false, max: 256,
  });
  const recoveryCode = V.asString(opts.recoveryCode, {
    name: 'recoveryCode', required: true, allowEmpty: false, max: 256,
  }).trim();
  const email = V.asOptionalString(opts.email, { name: 'email', max: 254 }) || '';
  if (password.length < 8) V.fail('PASSWORD_WEAK', 'password_too_short');
  if (recoveryCode.length < 4) V.fail('RECOVERY_WEAK', 'recovery_code_too_short');
  const salt = crypto.randomBytes(16).toString('hex');
  const recoveryHash = crypto.createHash('sha256')
    .update(`${recoveryCode}|${salt}|tdw-owner-recovery-v1`)
    .digest('hex');
  const now = new Date().toISOString();
  return dbService.commitSetupOwner({
    commandId: `setup-owner:${crypto.createHash('sha256').update(username).digest('hex').slice(0, 32)}`,
    user: {
      id: `owner-${crypto.randomUUID()}`,
      username,
      fullName,
      email,
      password: passwordAuth.hashPasswordV2(password),
      role: 'owner',
      active: true,
      credentialRevision: 1,
      passwordChangedAt: now,
    },
    ownerProfile: {
      salt,
      recovery: { type: 'code', hash: `sha256:${recoveryHash}` },
      sessionEpoch: 1,
      createdAt: now,
    },
  });
});
handle('database:setupCommitGoogleConnection', async (_e, options) => {
  const opts = V.asObject(options || {}, { name: 'options', maxKeys: 12 });
  const connected = opts.connected === true;
  const userDisconnected = opts.userDisconnected === true;
  let email = V.asOptionalString(opts.email, { name: 'email', max: 320 }) || '';
  let hasRefreshToken = opts.hasRefreshToken === true;
  let oauth = opts.oauth !== false;
  if (connected && !userDisconnected) {
    // Main is the authority for live OAuth. Renderer cannot forge a Google
    // connection projection without a matching Main token.
    const live = await backupGetCloudStatus('google');
    if (!live?.connected || live?.needsReauth) {
      return { ok: false, error: 'setup_google_main_not_connected', live: { connected: !!live?.connected, needsReauth: !!live?.needsReauth } };
    }
    email = String(live.email || email || '').trim();
    hasRefreshToken = live.hasRefreshToken === true || hasRefreshToken;
    oauth = live.oauth !== false;
    if (!email) return { ok: false, error: 'setup_google_email_required' };
  }
  return dbService.commitSetupGoogleConnection({
    connected,
    userDisconnected,
    email,
    hasRefreshToken,
    oauth,
  });
});
handle('database:bootstrapFromLocal', (_e, snapshot, options) => {
  V.asObject(snapshot, { name: 'snapshot', required: true, maxKeys: 240 });
  return dbService.bootstrapFromLocalSnapshot(snapshot, V.asObject(options || {}));
});
handle('database:persistTable', (e, tableKey, records) => {
  const key = V.asString(tableKey, { name: 'tableKey', max: 64, required: true, allowEmpty: false });
  if (!Array.isArray(records)) V.fail('IPC_TYPE', 'records_must_be_array');
  if (records.length > 200000) V.fail('IPC_TOO_LARGE', 'records_too_many');
  const context = databaseContextForEvent(e);
  licenseEntitlements.assert(dbService.getStoredLicense(), { entity: key, ...context });
  if (!context.branchId) return { ok: false, error: 'write_branch_required' };
  for (const row of records) {
    const centerId = String(row?.centerId || row?.center_id || context.centerId || '');
    const branchId = String(row?.branchId || row?.branch_id || context.branchId || '');
    if (centerId !== context.centerId) return { ok: false, error: 'center_access_denied' };
    if (branchId !== context.branchId) return { ok: false, error: 'branch_access_denied' };
  }
  return dbService.persistTable(key, records, context);
});
handle('database:persistKv', (e, key, value) => {
  const k = V.asString(key, { name: 'key', max: 128, required: true, allowEmpty: false });
  rbacSession.assertKvWriteAllowed(e, k);
  const result = dbService.persistKv(k, value);
  if (k === 'users' && Array.isArray(value)) {
    result.invalidatedSessions = rbacSession.invalidateStaleUserSessions(value);
  }
  return result;
});
handle('database:seedUsersIfEmpty', (_e, users) => {
  if (!Array.isArray(users)) V.fail('IPC_TYPE', 'users_must_be_array');
  if (users.length > 5000) V.fail('IPC_TOO_LARGE', 'users_too_many');
  const candidate = users.find((user) => user?.centerId || user?.center_id);
  const centerId = String(candidate?.centerId || candidate?.center_id || dbService.readAuthorityIdentity().centerId || '');
  return dbService.seedUsersIfEmpty(users, { centerId, branchId: '__ORG__', trusted: true });
});
handle('database:enableSqlitePrimary', () => dbService.enableSqlitePrimary());
handle('database:migrateFromBackup', (_e, snapshot, options) => {
  V.asObject(snapshot, { name: 'snapshot', required: true, maxKeys: 200 });
  const requested = V.asObject(options || {});
  return dbService.migrateFromBackupObject(snapshot, {
    sourceLabel: 'authenticated-main-migration',
    dryRun: requested.dryRun === true,
  });
});
handle('database:querySafe', (e, request) => dbService.querySafe(
  V.asObject(request, { required: true }),
  databaseContextForEvent(e, { read: true })
));
handle('database:exportSnapshot', (e) => ({
  ok: true,
  data: dbService.exportSnapshot(databaseContextForEvent(e, { read: true })),
}));
handle('database:command', (e, request) => {
  const req = V.asObject(request, { required: true, maxKeys: 24 });
  rbacSession.assertDatabaseEntityWriteAllowed(e, req.entity);
  const context = databaseContextForEvent(e);
  licenseEntitlements.assert(dbService.getStoredLicense(), { entity: req.entity, ...context });
  if (!context.centerId) return { ok: false, error: 'center_context_required', rolledBack: true };
  const classification = dbService.catalog.classifyKey(req.entity);
  if (classification.branchOwned && !context.branchId) {
    return { ok: false, error: 'write_branch_required', rolledBack: true };
  }
  const incoming = Array.isArray(req.records) ? req.records : (req.record ? [req.record] : []);
  for (const row of incoming) {
    const claimedCenter = String(row?.centerId || row?.center_id || context.centerId || '');
    const claimedBranch = String(row?.branchId || row?.branch_id || context.branchId || '');
    if (claimedCenter !== context.centerId) return { ok: false, error: 'center_access_denied', rolledBack: true };
    if (classification.branchOwned && claimedBranch !== context.branchId) {
      return { ok: false, error: 'branch_access_denied', rolledBack: true };
    }
  }
  return dbService.command(req, context);
});
handle('database:commitFinancialCase', (e, request) => {
  const req = V.asObject(request, { required: true, maxKeys: 12 });
  V.asString(req.transactionId, { name: 'transactionId', max: 200, required: true, allowEmpty: false });
  V.asObject(req.caseRecord, { name: 'caseRecord', required: true, maxKeys: 160 });
  if (req.effects != null && !Array.isArray(req.effects)) V.fail('IPC_TYPE', 'effects_must_be_array');
  if (Array.isArray(req.effects) && req.effects.length > 10) V.fail('IPC_TOO_LARGE', 'financial_effects_too_many');
  rbacSession.assertDatabaseEntityWriteAllowed(e, 'cases');
  const context = databaseContextForEvent(e);
  licenseEntitlements.assert(dbService.getStoredLicense(), { entity: 'cases', ...context });
  return dbService.commitFinancialCase(req, context);
});
handle('database:voidFinancialCase', (e, request) => {
  const req = V.asObject(request, { required: true, maxKeys: 8 });
  V.asString(req.reversalId, { name: 'reversalId', max: 200, required: true, allowEmpty: false });
  V.asString(req.caseId, { name: 'caseId', max: 200, required: true, allowEmpty: false });
  V.asString(req.reason, { name: 'reason', max: 500, required: true, allowEmpty: false });
  rbacSession.assertDatabaseEntityWriteAllowed(e, 'cases');
  const context = databaseContextForEvent(e);
  licenseEntitlements.assert(dbService.getStoredLicense(), { entity: 'cases', ...context });
  return dbService.voidFinancialCase(req, context);
});
handle('database:finalizePayrollRun', (e, request) => {
  const req = V.asObject(request, { required: true, maxKeys: 10 });
  V.asString(req.runId, { name: 'runId', max: 200, required: true, allowEmpty: false });
  V.asString(req.periodKey, { name: 'periodKey', max: 7, required: true, allowEmpty: false });
  if (!Array.isArray(req.rows) || req.rows.length > 5000) V.fail('IPC_TYPE', 'payroll_rows_invalid');
  const context = databaseContextForEvent(e);
  licenseEntitlements.assert(dbService.getStoredLicense(), { group: 'payroll', ...context });
  return dbService.finalizePayrollRun(req, context);
});
handle('database:adjustFinalizedPayroll', (e, request) => {
  const req = V.asObject(request, { required: true, maxKeys: 10 });
  for (const key of ['adjustmentId', 'runId', 'employeeId', 'reason']) {
    V.asString(req[key], { name: key, max: key === 'reason' ? 500 : 200, required: true, allowEmpty: false });
  }
  const context = databaseContextForEvent(e);
  licenseEntitlements.assert(dbService.getStoredLicense(), { group: 'payroll', ...context });
  return dbService.adjustFinalizedPayroll(req, context);
});
handle('database:syncOp', async (e, request) => {
  const req = V.asObject(request, { required: true, maxKeys: 40 });
  const op = V.asString(req.op, { name: 'op', max: 64, required: true, allowEmpty: false });
  const context = databaseContextForEvent(e);
  licenseEntitlements.assert(dbService.getStoredLicense(), { group: 'sync', ...context });
  const safeUserOps = new Set(['syncPush', 'syncPull', 'counts', 'metaGet', 'listOpenConflicts']);
  const adminOps = new Set(['listDeadLetters', 'requeueDeadLetter', 'requeueDeadLetters', 'resolveConflict', 'audit']);
  if (!safeUserOps.has(op) && !adminOps.has(op)) return { ok: false, error: 'renderer_sync_op_denied' };
  if (adminOps.has(op) && !['admin', 'hq_admin', 'owner'].includes(context.role)) {
    return { ok: false, error: 'sync_admin_operation_denied' };
  }
  if (op === 'syncPush') return syncOperationTransport.pushPending(context, V.asObject(req.options || {}));
  if (op === 'syncPull') return syncOperationTransport.pullRemote(context, V.asObject(req.options || {}));
  return dbService.syncOp({ ...req, op }, context);
});

const cloudOAuthConfig = require('./cloud-oauth-config');

handle('cloudOAuth:getSettings', () => cloudOAuthConfig.getPublicSettings());
handle('cloudOAuth:saveSettings', (_e, payload) =>
  cloudOAuthConfig.saveDeveloperSettings(V.asObject(payload)));
handle('cloudOAuth:restoreDefaults', () => cloudOAuthConfig.restoreDeveloperDefaults());
handle('cloudOAuth:testConnection', () => cloudOAuthConfig.testConnection());

const licenseData = require('./license-data');
const licenseVaultProxy = require('./license-vault-proxy');
licenseData.configureWritableRoot(path.join(app.getPath('userData'), 'LicenseAdmin'));

handle('license:writeLicenseShard', (e, licenseId, record) => {
  assertDeveloperIssuerSession(e);
  const id = pathGuard.safeId(licenseId, 'licenseId');
  const file = licenseData.writeLicenseShard(id, V.asObject(record, { name: 'record', required: true, maxKeys: 80 }));
  return { ok: true, path: file };
});

handle('license:writeActivationBundle', (e, licenseId, bundle) => {
  assertDeveloperIssuerSession(e);
  const id = pathGuard.safeId(licenseId, 'licenseId');
  const file = licenseData.writeActivationBundle(id, V.asObject(bundle, { name: 'bundle', required: true, maxKeys: 80 }));
  return { ok: true, path: file };
});

handle('license:readActivationBundle', (_e, licenseId) => {
  try {
    const id = pathGuard.safeId(licenseId, 'licenseId');
    return licenseData.readActivationBundle(id);
  } catch {
    return null;
  }
});

handle('license:vaultRequest', async (_e, request) => {
  const input = V.asObject(request, { name: 'vaultRequest', required: true, maxKeys: 4 });
  const target = V.asString(input.url, { name: 'vaultUrl', required: true, allowEmpty: false, max: 2048 });
  const body = V.asObject(input.body, { name: 'vaultBody', required: true, maxKeys: 20 });
  const action = V.asString(body.action, { name: 'vaultAction', required: true, allowEmpty: false, max: 40 });
  if (!licenseVaultProxy.ALLOWED_ACTIONS.has(action)) {
    V.fail('IPC_FORMAT', 'license_vault_action_not_allowed');
  }
  try {
    return await licenseVaultProxy.request(target, body);
  } catch (error) {
    V.fail('IPC_FORMAT', error?.message || 'license_vault_request_invalid');
  }
});

handle('license:writeCustomPackage', (e, customPackage) => {
  assertDeveloperIssuerSession(e);
  const file = licenseData.writeCustomPackage(V.asObject(customPackage, { name: 'customPackage', required: true, maxKeys: 40 }));
  return { ok: true, path: file };
});

handle('license:updateLicenseIndex', (e, index) => {
  assertDeveloperIssuerSession(e);
  const file = licenseData.updateLicenseIndex(V.asObject(index, { name: 'index', required: true, maxKeys: 30 }));
  return { ok: true, path: file };
});

handle('license:appendPackageToRegistry', (e, packageDefinition) => {
  assertDeveloperIssuerSession(e);
  const file = licenseData.appendPackageToRegistry(V.asObject(packageDefinition, { name: 'packageDefinition', required: true, maxKeys: 50 }));
  return { ok: true, path: file };
});

handle('license:adminIssuerStatus', (e) => {
  assertDeveloperIssuerSession(e);
  return licenseIssuer.status();
});

handle('license:adminSelectSigningKey', async (e) => {
  assertDeveloperIssuerSession(e);
  const owner = BrowserWindow.fromWebContents(e.sender) || mainWindow || undefined;
  const selected = await dialog.showOpenDialog(owner, {
    title: 'Select the Ed25519 production license signing key',
    properties: ['openFile'],
    filters: [{ name: 'PEM private key', extensions: ['pem', 'key'] }],
  });
  if (selected.canceled || !selected.filePaths?.[0]) return { ok: false, canceled: true };
  return licenseIssuer.selectKeyPath(selected.filePaths[0]);
});

handle('license:adminIssueV6', (e, payload) => {
  assertDeveloperIssuerSession(e);
  return licenseIssuer.issue(V.asObject(payload, { name: 'license', required: true, maxKeys: 30 }));
});
