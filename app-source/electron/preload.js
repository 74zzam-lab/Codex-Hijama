const { contextBridge, ipcRenderer } = require('electron');

/**
 * Explicit channel allowlist — no generic invoke(channel) API.
 * Keep in sync with electron/main.js handlers.
 */
const ALLOWED_INVOKE = new Set([
  'app:getRuntimeInfo',
  'app:relaunch',
  'app:consumeLicenseWipeFlag',
  'app:wipePersistentLicenseData',
  'app:writeUninstallCenterMeta',
  'app:openExternal',
  'app:getDeviceFingerprintParts',
  'database:status',
  'database:hydrate',
  'database:setupCommitActivation',
  'database:setupCommitSignedActivation',
  'database:setupCommitOrganizationDevice',
  'database:setupCommitOwner',
  'database:bootstrapFromLocal',
  'database:persistTable',
  'database:persistKv',
  'database:seedUsersIfEmpty',
  'database:enableSqlitePrimary',
  'database:migrateFromBackup',
  'database:querySafe',
  'database:exportSnapshot',
  'database:syncOp',
  'database:commitFinancialCase',
  'database:voidFinancialCase',
  'database:finalizePayrollRun',
  'database:adjustFinalizedPayroll',
  'cloudOAuth:getSettings',
  'cloudOAuth:saveSettings',
  'cloudOAuth:restoreDefaults',
  'cloudOAuth:testConnection',
  'backup:saveLocal',
  'backup:uploadCloud',
  'backup:uploadActivationArtifact',
  'backup:uploadSyncFile',
  'backup:downloadSyncFile',
  'backup:connectGoogle',
  'backup:registerCloudAccount',
  'backup:disconnectCloud',
  'backup:listCloudBackups',
  'backup:discoverCloudRestorePoints',
  'backup:downloadCloudBackup',
  'backup:deleteCloudBackup',
  'backup:verifyCloudBackup',
  'backup:startOAuth',
  'backup:getCloudStatus',
  'backup:listCloudProviders',
  'backup:pickLocalFolder',
  'backup:uploadDbBackup',
  'backup:listDbBackups',
  'backup:restoreDbBackup',
  'backup:syncDbBackup',
  'backup:verifyDbBackup',
  'backup:v2:health',
  'backup:v2:ensureSecret',
  'backup:v2:rotateSecret',
  'backup:v2:create',
  'backup:v2:verify',
  'backup:v2:inspect',
  'backup:v2:restore',
  'backup:v2:setupLocalRestore',
  'backup:v2:listLocal',
  'backup:v2:pickLatest',
  'backup:v2:restoreLatest',
  'backup:v2:pickFile',
  'backup:v2:gate',
  'backup:v2:stageRemote',
  'backup:v2:downloadAndRestore',
  'backup:v2:setupCloudRestore',
  'backup:v2:prune',
  'backup:v2:formatPolicy',
  'backup:v2:scheduleStatus',
  'backup:v2:scheduleConfigure',
  'cache:writeBranchConfig',
  'cache:readBranchConfig',
  'cache:writeLicense',
  'cache:readLicense',
  'cache:writeVersions',
  'cache:readVersions',
  'cache:getStatus',
  'devices:listPrinters',
  'devices:printThermal',
  'devices:printA4',
  'devices:exportA4Pdf',
  'devices:printWithDialog',
  'devices:openCashDrawer',
  'devices:openCashDrawerDirect',
  'devices:getStatus',
  'devices:writeRaw',
  'messaging:sendWhatsApp',
  'messaging:sendSMS',
  'messaging:getStatus',
  'communication:listProviders',
  'communication:testProvider',
  'communication:send',
  'communication:getStatus',
  'communication:processQueue',
  'communication:getQueue',
  'communication:clearQueue',
  'communication:init',
  'communication:saveCredentials',
  'communication:getCredentialStatus',
  'communication:deleteCredentials',
  'license:readActivationBundle',
  'license:vaultRequest',
  'license:writeLicenseShard',
  'license:writeActivationBundle',
  'license:writeCustomPackage',
  'license:updateLicenseIndex',
  'license:appendPackageToRegistry',
  'license:adminIssuerStatus',
  'license:adminSelectSigningKey',
  'license:adminIssueV6',
  'rbac:bindSession',
  'rbac:authenticateUser',
  'rbac:authenticateDeveloper',
  'rbac:clearSession',
  'rbac:getSession',
  'rbac:setWriteBranch',
  'rbac:clearWriteBranch',
  'database:command',
  'attachments:validate',
  'attachments:hashBuffer',
  'attachments:writeLocal',
  'attachments:readLocal',
  'attachments:existsLocal',
]);

const ALLOWED_SEND = new Set(['uninstall:wipeComplete']);
const ALLOWED_SEND_SYNC = new Set(['dialog:confirmSync', 'dialog:promptSync']);
const ALLOWED_ON = new Set(['communication:webhook', 'communication:queueUpdate', 'backup:discoveryProgress', 'backup:downloadProgress']);

function invoke(channel, ...args) {
  if (!ALLOWED_INVOKE.has(channel)) {
    return Promise.reject(new Error('ipc_channel_denied:' + channel));
  }
  return ipcRenderer.invoke(channel, ...args);
}

function send(channel, ...args) {
  if (!ALLOWED_SEND.has(channel)) {
    throw new Error('ipc_channel_denied:' + channel);
  }
  ipcRenderer.send(channel, ...args);
}

function sendSync(channel, ...args) {
  if (!ALLOWED_SEND_SYNC.has(channel)) {
    throw new Error('ipc_channel_denied:' + channel);
  }
  return ipcRenderer.sendSync(channel, ...args);
}

function on(channel, cb) {
  if (!ALLOWED_ON.has(channel)) {
    throw new Error('ipc_channel_denied:' + channel);
  }
  ipcRenderer.removeAllListeners(channel);
  ipcRenderer.on(channel, (_e, data) => cb(data));
}

const cuppingApi = {
  app: {
    getRuntimeInfo: () => invoke('app:getRuntimeInfo'),
    relaunchApp: (options) => invoke('app:relaunch', options || {}),
    consumeLicenseWipeFlag: () => invoke('app:consumeLicenseWipeFlag'),
    wipePersistentLicenseData: () => invoke('app:wipePersistentLicenseData'),
    writeUninstallCenterMeta: (payload) => invoke('app:writeUninstallCenterMeta', payload),
    signalUninstallWipeComplete: () => send('uninstall:wipeComplete'),
    openExternal: (url) => invoke('app:openExternal', url),
    getDeviceFingerprintParts: () => invoke('app:getDeviceFingerprintParts'),
  },
  rbac: {
    authenticateUser: (credentials) => invoke('rbac:authenticateUser', credentials),
    authenticateDeveloper: (password) => invoke('rbac:authenticateDeveloper', password),
    bindSession: (claim) => invoke('rbac:bindSession', claim),
    clearSession: () => invoke('rbac:clearSession'),
    getSession: () => invoke('rbac:getSession'),
    setWriteBranch: (branchId) => invoke('rbac:setWriteBranch', branchId),
    clearWriteBranch: () => invoke('rbac:clearWriteBranch'),
  },
  dialogs: {
    confirmSync: (message) => sendSync('dialog:confirmSync', message),
    promptSync: (message, defaultValue) => sendSync('dialog:promptSync', message, defaultValue),
  },
  cloudOAuth: {
    getSettings: () => invoke('cloudOAuth:getSettings'),
    saveSettings: (payload) => invoke('cloudOAuth:saveSettings', payload),
    restoreDefaults: () => invoke('cloudOAuth:restoreDefaults'),
    testConnection: () => invoke('cloudOAuth:testConnection'),
  },
  backup: {
    saveLocal: (payload, filename, localPath) =>
      invoke('backup:saveLocal', payload, filename, localPath),
    create: (payload, filename, localPath) =>
      invoke('backup:saveLocal', payload, filename, localPath),
    uploadCloud: (payload, filename, provider, meta) =>
      invoke('backup:uploadCloud', payload, filename, provider, meta),
    uploadActivationArtifact: (payload, remotePath, provider) =>
      invoke('backup:uploadActivationArtifact', payload, remotePath, provider),
    uploadSyncFile: (payload, filename, provider, folder) =>
      invoke('backup:uploadSyncFile', payload, filename, provider, folder),
    downloadSyncFile: (filename, provider, folder) =>
      invoke('backup:downloadSyncFile', filename, provider, folder),
    connectGoogle: (email, provider) => invoke('backup:connectGoogle', email, provider),
    registerCloudAccount: (email, provider) => invoke('backup:registerCloudAccount', email, provider),
    disconnectCloud: (provider) => invoke('backup:disconnectCloud', provider),
    listCloudBackups: (provider, prefix) => invoke('backup:listCloudBackups', provider, prefix),
    discoverCloudRestorePoints: (options) => invoke('backup:discoverCloudRestorePoints', options),
    onDiscoveryProgress: (cb) => on('backup:discoveryProgress', cb),
    onDownloadProgress: (cb) => on('backup:downloadProgress', cb),
    downloadCloudBackup: (remotePath, provider) => invoke('backup:downloadCloudBackup', remotePath, provider),
    deleteCloudBackup: (remotePath, provider) => invoke('backup:deleteCloudBackup', remotePath, provider),
    verifyCloudBackup: (remotePath, expectedHash, provider) =>
      invoke('backup:verifyCloudBackup', remotePath, expectedHash, provider),
    startOAuth: (provider, opts) => invoke('backup:startOAuth', provider, opts),
    getCloudStatus: (provider) => invoke('backup:getCloudStatus', provider),
    listCloudProviders: () => invoke('backup:listCloudProviders'),
    pickLocalFolder: () => invoke('backup:pickLocalFolder'),
    uploadDbBackup: (password, meta) => invoke('backup:uploadDbBackup', password, meta),
    listDbBackups: (meta) => invoke('backup:listDbBackups', meta),
    restoreDbBackup: (remotePath, password, relaunch) =>
      invoke('backup:restoreDbBackup', remotePath, password, relaunch),
    restore: (remotePath, password, relaunch) =>
      invoke('backup:restoreDbBackup', remotePath, password, relaunch),
    syncDbBackup: (password, meta) => invoke('backup:syncDbBackup', password, meta),
    verifyDbBackup: (remotePath, expectedHash) =>
      invoke('backup:verifyDbBackup', remotePath, expectedHash),
    v2Health: () => invoke('backup:v2:health'),
    v2EnsureSecret: () => invoke('backup:v2:ensureSecret'),
    v2RotateSecret: () => invoke('backup:v2:rotateSecret'),
    v2Create: (options) => invoke('backup:v2:create', options),
    v2Verify: (options) => invoke('backup:v2:verify', options),
    v2Inspect: (options) => invoke('backup:v2:inspect', options),
    v2Restore: (options) => invoke('backup:v2:restore', options),
    v2SetupLocalRestore: (options) => invoke('backup:v2:setupLocalRestore', options),
    v2ListLocal: (options) => invoke('backup:v2:listLocal', options),
    v2PickLatest: (options) => invoke('backup:v2:pickLatest', options),
    v2RestoreLatest: (options) => invoke('backup:v2:restoreLatest', options),
    v2PickFile: (options) => invoke('backup:v2:pickFile', options || {}),
    v2Gate: () => invoke('backup:v2:gate'),
    v2StageRemote: (options) => invoke('backup:v2:stageRemote', options),
    v2DownloadAndRestore: (options) => invoke('backup:v2:downloadAndRestore', options),
    v2SetupCloudRestore: (options) => invoke('backup:v2:setupCloudRestore', options),
    v2Prune: (options) => invoke('backup:v2:prune', options),
    v2FormatPolicy: () => invoke('backup:v2:formatPolicy'),
    v2ScheduleStatus: () => invoke('backup:v2:scheduleStatus'),
    v2ScheduleConfigure: (options) => invoke('backup:v2:scheduleConfigure', options),
  },
  cache: {
    writeBranchConfig: (centerId, branchId, pack) =>
      invoke('cache:writeBranchConfig', centerId, branchId, pack),
    readBranchConfig: (centerId, branchId) =>
      invoke('cache:readBranchConfig', centerId, branchId),
    writeLicense: (centerId, doc) =>
      invoke('cache:writeLicense', centerId, doc),
    readLicense: (centerId) =>
      invoke('cache:readLicense', centerId),
    writeVersions: (centerId, versions) =>
      invoke('cache:writeVersions', centerId, versions),
    readVersions: (centerId) =>
      invoke('cache:readVersions', centerId),
    getStatus: (centerId) =>
      invoke('cache:getStatus', centerId),
  },
  devices: {
    listPrinters: () => invoke('devices:listPrinters'),
    printThermal: (html, opts) => invoke('devices:printThermal', html, opts),
    printA4: (html, opts) => invoke('devices:printA4', html, opts),
    exportA4Pdf: (html, opts) => invoke('devices:exportA4Pdf', html, opts),
    printWithDialog: (html, opts) => invoke('devices:printWithDialog', html, opts),
    openCashDrawer: (opts) => invoke('devices:openCashDrawer', opts),
    openCashDrawerDirect: (opts) => invoke('devices:openCashDrawerDirect', opts),
    getStatus: (saved) => invoke('devices:getStatus', saved),
    writeRaw: (printerName, buffer) =>
      invoke('devices:writeRaw', printerName, buffer),
  },
  print: {
    receipt: (html, opts) => invoke('devices:printThermal', html, opts),
    a4: (html, opts) => invoke('devices:printA4', html, opts),
    pdf: (html, opts) => invoke('devices:exportA4Pdf', html, opts),
  },
  messaging: {
    sendWhatsApp: (phone, text, config, meta) =>
      invoke('messaging:sendWhatsApp', phone, text, config, meta),
    sendSMS: (phone, text, config, meta) =>
      invoke('messaging:sendSMS', phone, text, config, meta),
    getStatus: (config) => invoke('messaging:getStatus', config),
  },
  communication: {
    listProviders: () => invoke('communication:listProviders'),
    testProvider: (provider) => invoke('communication:testProvider', provider),
    send: (config, payload) => invoke('communication:send', config, payload),
    getStatus: (config) => invoke('communication:getStatus', config),
    processQueue: (config) => invoke('communication:processQueue', config),
    getQueue: () => invoke('communication:getQueue'),
    clearQueue: (status) => invoke('communication:clearQueue', status),
    init: (config) => invoke('communication:init', config),
    saveCredentials: (payload) => invoke('communication:saveCredentials', payload),
    getCredentialStatus: () => invoke('communication:getCredentialStatus'),
    deleteCredentials: (providerId) => invoke('communication:deleteCredentials', providerId),
    onWebhook: (cb) => on('communication:webhook', cb),
    onQueueUpdate: (cb) => on('communication:queueUpdate', cb),
  },
  license: {
    readActivationBundle: (licenseId) => invoke('license:readActivationBundle', licenseId),
    vaultRequest: (request) => invoke('license:vaultRequest', request),
    writeLicenseShard: (licenseId, record) => invoke('license:writeLicenseShard', licenseId, record),
    writeActivationBundle: (licenseId, bundle) => invoke('license:writeActivationBundle', licenseId, bundle),
    writeCustomPackage: (customPackage) => invoke('license:writeCustomPackage', customPackage),
    updateLicenseIndex: (index) => invoke('license:updateLicenseIndex', index),
    appendPackageToRegistry: (packageDefinition) => invoke('license:appendPackageToRegistry', packageDefinition),
    adminIssuerStatus: () => invoke('license:adminIssuerStatus'),
    adminSelectSigningKey: () => invoke('license:adminSelectSigningKey'),
    adminIssueV6: (payload) => invoke('license:adminIssueV6', payload),
  },
  database: {
    status: () => invoke('database:status'),
    hydrate: () => invoke('database:hydrate'),
    setupCommitActivation: (options) => invoke('database:setupCommitActivation', options || {}),
    setupCommitSignedActivation: (options) => invoke('database:setupCommitSignedActivation', options || {}),
    setupCommitOrganizationDevice: (options) => invoke('database:setupCommitOrganizationDevice', options || {}),
    setupCommitOwner: (options) => invoke('database:setupCommitOwner', options || {}),
    bootstrapFromLocal: (snapshot, options) => invoke('database:bootstrapFromLocal', snapshot, options || {}),
    persistTable: (tableKey, records) => invoke('database:persistTable', tableKey, records),
    persistKv: (key, value) => invoke('database:persistKv', key, value),
    seedUsersIfEmpty: (users) => invoke('database:seedUsersIfEmpty', users),
    enableSqlitePrimary: () => invoke('database:enableSqlitePrimary'),
    migrateFromBackup: (snapshot, options) => invoke('database:migrateFromBackup', snapshot, options),
    querySafe: (request) => invoke('database:querySafe', request || {}),
    exportSnapshot: () => invoke('database:exportSnapshot'),
    syncOp: (request) => invoke('database:syncOp', request || {}),
    command: (request) => invoke('database:command', request || {}),
    commitFinancialCase: (request) => invoke('database:commitFinancialCase', request || {}),
    voidFinancialCase: (request) => invoke('database:voidFinancialCase', request || {}),
    finalizePayrollRun: (request) => invoke('database:finalizePayrollRun', request || {}),
    adjustFinalizedPayroll: (request) => invoke('database:adjustFinalizedPayroll', request || {}),
  },
  attachments: {
    validate: (meta, buffer) => invoke('attachments:validate', meta, buffer),
    hashBuffer: (buffer) => invoke('attachments:hashBuffer', buffer).then((r) => r?.sha256 || r),
    writeLocal: (sha256, buffer) => invoke('attachments:writeLocal', sha256, buffer),
    readLocal: (sha256) => invoke('attachments:readLocal', sha256),
    existsLocal: (sha256) => invoke('attachments:existsLocal', sha256),
  },
};

contextBridge.exposeInMainWorld('cuppingElectron', cuppingApi);
// Stable alias matching roadmap naming (same typed surface, no generic invoke).
contextBridge.exposeInMainWorld('tadawi', cuppingApi);

contextBridge.exposeInMainWorld('cashDrawer', {
  open: (opts) => invoke('devices:openCashDrawer', opts || {}),
});
