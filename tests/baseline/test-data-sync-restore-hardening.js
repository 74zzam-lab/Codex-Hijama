#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const errors = [];
const check = (condition, message) => { if (!condition) errors.push(message); };

const repository = read('cloud/repository.js');
const operational = read('cloud/operational-layer.js');
const sync = read('cloud/sync-engine.js');
const staging = read('cloud/restore-staging.js');
const sqlite = read('cupping-sqlite-bridge.js');
const databaseService = read('electron/database/service.js');
const config = read('cloud/config-layer.js');
const discovery = read('cloud/cloud-data-discovery.js');
const boot = read('cloud/boot-flow-ui.js');
const ipc = read('electron/backup-v2-ipc.js');
const preload = read('electron/preload.js');
const rbac = read('electron/rbac-session.js');
const owner = read('cloud/owner-management.js');
const hub = read('cloud/owner-hub.js');
const index = read('index.html');

const businessTables = [
  'cases', 'clientsRegistry', 'bookings', 'doctors', 'expenses', 'attendance',
  'inventoryItems', 'inventorySuppliers', 'inventoryMovements', 'otRecords',
  'nextSessions', 'employeeLeaveRequests', 'employeeLedgerAccruals',
  'employeeLedgerPayments', 'employeeLedgerEntries', 'messageLog'
];
for (const table of businessTables) {
  check(repository.includes(`'${table}'`), `repository missing ${table}`);
  check(operational.includes(`${table}:`) || operational.includes(`'${table}'`), `operational mapping missing ${table}`);
  check(sync.includes(`${table}:`) || sync.includes(`'${table}'`), `sync mapping missing ${table}`);
  check(staging.includes(`${table}:`) || staging.includes(`'${table}'`), `restore staging missing ${table}`);
  check(sqlite.includes(`'${table}'`), `SQLite bridge missing ${table}`);
}

check(/__tdwBranchState/.test(config), 'branch state is not embedded in cloud settings');
for (const key of ['budget', 'invoiceCounter', 'clientFileCounter', 'luxQueue']) {
  check(config.includes(key), `branch state missing ${key}`);
  check(sqlite.includes(`'${key}'`), `SQLite branch state missing ${key}`);
}
check(/runTypedCommand/.test(sqlite) && /db\.command/.test(sqlite), 'SQLite writes do not use the typed command boundary');
check(/db\.transaction/.test(databaseService) && /syncPlatform\.enqueue/.test(databaseService), 'data and outbox are not committed in one SQLite transaction');
check(/baseRevision \+ 1/.test(databaseService) && /new_revision/.test(databaseService), 'typed SQLite commands do not publish record revisions');
check(/legacy_full_table_writer_disabled/.test(sync) && /SqliteOutboxBridge\.pushPending/.test(sync),
  'manual sync must flush immutable outbox operations and keep full-table writer disabled');
check(/direction === 'pull'/.test(sync) && /direction === 'push'/.test(sync), 'runOnce direction is not honored');

check(/v2SetupLocalRestore/.test(preload) && /v2SetupCloudRestore/.test(preload), 'setup restore IPC is not exposed');
check(/setupLocalRestore/.test(ipc) && /setupCloudRestore/.test(ipc), 'setup restore IPC handlers missing');
check(/backup:v2:setupLocalRestore/.test(rbac) && /backup:v2:setupCloudRestore/.test(rbac), 'pre-login restore RBAC routes missing');
check(/readLegacyBackupSnapshot/.test(ipc) && /pbkdf2Sync/.test(ipc), 'legacy encrypted restore compatibility missing');
check(/point\.path/.test(discovery) && /v2SetupCloudRestore/.test(discovery), 'selected cloud point is not executed');
check(/finalizeSetupData/.test(boot), 'setup does not finalize restored data into SQLite');

check(/hasUsableOwnerCredential/.test(owner), 'owner secure credential invariant missing');
check(/owner\.json/.test(config), 'owner cloud document missing');
check(/overview|branches/.test(hub) && /devices|owners/.test(hub) && /advanced/.test(hub), 'OwnerHub sections missing');
check(/bk-section-nav/.test(index) && /openBackupSection/.test(index), 'backup page section navigation missing');

async function runtimeChecks() {
  const store = new Map();
  const localStorage = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); }
  };
  const DB = {
    get(key, fallback) {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    },
    set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  };
  let bootstrapCalls = 0;
  const database = {
    status: async () => ({ ok: true, sqlitePrimary: false }),
    bootstrapFromLocal: async () => { bootstrapCalls += 1; return { ok: true }; },
    hydrate: async () => ({ ok: true, data: {}, status: { sqlitePrimary: false } }),
    persistKv: async () => ({ ok: true })
  };
  const sb = {
    console, DB, localStorage,
    cuppingElectron: { database },
    setTimeout, clearTimeout, structuredClone,
  };
  sb.window = sb;
  sb.globalThis = sb;
  vm.runInNewContext(sqlite, sb, { filename: 'cupping-sqlite-bridge.js', timeout: 3000 });

  const empty = sb.SqliteBridge.collectSnapshotFromLocal();
  check(empty.__tdw_owner_profile__ === null, 'fresh install invents an owner profile');
  const deferred = await sb.SqliteBridge.initializeAtStartup();
  check(deferred?.deferred === true, 'fresh empty install should remain available for setup restore');
  check(bootstrapCalls === 0, 'fresh empty install was prematurely promoted to SQLite primary');

  DB.set('users', [{
    id: 'owner-1', username: 'owner1', role: 'owner', active: true,
    password: `pbkdf2:owner1:${'a'.repeat(64)}`,
    mustChangePassword: false, seedDefaultPassword: false
  }]);
  await sb.SqliteBridge.initializeAtStartup();
  check(bootstrapCalls === 1, 'existing secure owner/data is not migrated on startup');

  const splitSb = { console, DB: { get() {}, set() {} } };
  splitSb.window = splitSb;
  splitSb.globalThis = splitSb;
  vm.runInNewContext(read('cloud/settings-split.js'), splitSb, { timeout: 2000 });
  const filtered = splitSb.SettingsSplit.filterUsersForBranch([
    { id: 'good', active: true, password: `pbkdf2:owner:${'b'.repeat(64)}` },
    { id: 'plain', active: true, password: 'plain-password', temporaryPassword: 'secret' }
  ], 'BR-MAIN');
  check(/^pbkdf2:/.test(filtered[0]?.password || ''), 'portable PBKDF2 owner hash was stripped from cloud');
  check(filtered[1]?.password === undefined, 'plaintext/legacy user password was uploaded');
  check(filtered[1]?.temporaryPassword === undefined, 'temporary password was uploaded');
}

runtimeChecks().then(() => {
  if (errors.length) {
    console.error('FAIL: data/sync/restore hardening');
    errors.forEach((error) => console.error(' -', error));
    process.exit(1);
  }
  console.log('PASS: data/sync/restore hardening');
}).catch((error) => {
  console.error('FAIL: data/sync/restore hardening exception', error);
  process.exit(1);
});
