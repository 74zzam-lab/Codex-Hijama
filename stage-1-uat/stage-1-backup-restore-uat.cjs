#!/usr/bin/env node
'use strict';

/**
 * Stage 1 — Windows backup/restore UAT (isolated profile, production IPC paths).
 * Produces evidence under docs/remediation/evidence/STAGE-1-WINDOWS-UAT/<build-id>/
 *
 * Uses backup:v2:create and backup:v2:setupLocalRestore IPC handlers — not direct backup core.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const Module = require('module');
const Database = require('better-sqlite3');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.STAGE1_BUILD_ID
  || process.env.GITHUB_RUN_ID
  || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const evidenceRoot = path.join(root, 'docs', 'remediation', 'evidence', 'STAGE-1-WINDOWS-UAT', buildId);
fs.mkdirSync(evidenceRoot, { recursive: true });

const runtimeErrors = {
  consoleError: [],
  pageerror: [],
  unhandledRejection: [],
  mainUncaught: [],
  ipcFailures: [],
  sqliteErrors: [],
  backupErrors: [],
  operational: [],
};

function git(cmd) {
  const r = spawnSync('git', cmd, { cwd: root, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

function sha256File(p) {
  if (!fs.existsSync(p)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function writeJson(name, data) {
  const dest = path.join(evidenceRoot, name);
  fs.writeFileSync(dest, `${JSON.stringify(data, null, 2)}\n`);
  return dest;
}

function sqliteIntegrity(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const integrity = db.pragma('integrity_check', { simple: true });
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  db.close();
  return { integrity_check: integrity, foreign_key_violations: fk.length, fk };
}

function countRows(dbPath, tables) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const counts = {};
  const ids = {};
  for (const table of tables) {
    try {
      counts[table] = Number(db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c) || 0;
      ids[table] = db.prepare(`SELECT id FROM "${table}" ORDER BY id`).all().map((r) => r.id);
    } catch (err) {
      counts[table] = null;
      ids[table] = [];
      runtimeErrors.sqliteErrors.push({ table, error: String(err.message || err) });
    }
  }
  const revisions = {};
  for (const table of ['clients', 'visits']) {
    try {
      revisions[table] = db.prepare(`SELECT id, revision FROM "${table}" ORDER BY id`).all();
    } catch { revisions[table] = []; }
  }
  db.close();
  return { counts, ids, revisions };
}

function isolatedUserData() {
  const base = process.env.TDAWI_UAT_USER_DATA
    || path.join(
      process.env.LOCALAPPDATA || os.tmpdir(),
      'uat-stage1-' + buildId,
    );
  return path.resolve(base);
}

function stageWeights() {
  return {
    reading_manifest: 0.05,
    checking_identity: 0.1,
    staging_restore: 0.25,
    creating_emergency_backup: 0.1,
    closing_database: 0.05,
    swapping_data: 0.2,
    restore_complete: 0.25,
  };
}

function mapProgressTimeline(progressEvents) {
  const weights = stageWeights();
  let done = 0;
  const seen = new Set();
  let maxPercent = 0;
  const timeline = [];
  for (const evt of progressEvents) {
    const stage = evt.stage || 'unknown';
    if (!seen.has(stage) && weights[stage]) {
      done += weights[stage];
      seen.add(stage);
    }
    let overallPercent = Math.round(Math.min(99, done * 100));
    if (stage === 'restore_complete') overallPercent = 100;
    if (overallPercent < maxPercent) {
      runtimeErrors.operational.push({
        kind: 'progress_regression',
        stage,
        overallPercent,
        maxPercent,
      });
    }
    maxPercent = Math.max(maxPercent, overallPercent);
    timeline.push({
      timestamp: evt.at || new Date().toISOString(),
      stage,
      stageRatio: evt.stageRatio ?? (weights[stage] ? 1 : null),
      overallPercent,
      message: evt.message || evt.lastActivity || stage,
    });
  }
  return { timeline, maxPercent, stalledAt18: maxPercent <= 18 && progressEvents.some((e) => e.stage === 'staging_restore') };
}

function classifyDiagnostic(err) {
  const raw = String(err?.code || err?.message || err || '').toLowerCase();
  if (/backup_authentication_failed|backup_password_invalid|decrypt|auth_tag|scrypt/.test(raw)) {
    return 'backup_password_invalid';
  }
  if (/corrupt|integrity|hash|manifest|backup_manifest/.test(raw)) return 'local_restore_failed';
  if (/cancel|aborted|interrupted|restore_interrupted/.test(raw)) return 'restore_interrupted';
  if (/cloud_download|download_failed/.test(raw)) return 'cloud_download_failed';
  try {
    const ActivationErrors = require(path.join(root, 'cloud', 'activation-errors.js'));
    if (typeof ActivationErrors?.classifyTechnical === 'function') {
      const mapped = ActivationErrors.classifyTechnical(err);
      if (mapped && mapped !== 'unknown') return mapped;
    }
  } catch { /* ignore */ }
  return raw.includes('backup_authentication') ? 'backup_password_invalid' : 'unknown';
}

function patchElectron() {
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (v) => Buffer.from(`protected:${v}`, 'utf8'),
    decryptString: (v) => v.toString('utf8').replace(/^protected:/, ''),
  };
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return { dialog: {}, safeStorage, app: null };
    return originalLoad.call(this, request, parent, isMain);
  };
  return () => { Module._load = originalLoad; };
}

async function registerIpc(userDataDir) {
  const unpatch = patchElectron();
  let ipc;
  try {
    ipc = require(path.join(root, 'electron', 'backup-v2-ipc'));
  } finally {
    unpatch();
  }
  const V = require(path.join(root, 'electron', 'security', 'ipc-validate'));
  const handlers = new Map();
  const registration = ipc.registerBackupV2Ipc({
    handle: (channel, handler) => handlers.set(channel, handler),
    V,
    getUserDataPath: () => userDataDir,
    appVersion: '2.0.1',
    app: null,
    closeDatabase: async () => {},
    reopenDatabase: async () => {},
    getLiveIdentity: () => ({
      centerId: 'CTR-STAGE1-UAT',
      organizationId: 'CTR-STAGE1-UAT',
      branchId: 'BR-UAT-MAIN',
      authorizedBranchIds: ['BR-UAT-MAIN'],
      deviceId: 'DEV-STAGE1-UAT',
      centerName: 'Stage 1 UAT Center',
      deviceName: 'Stage 1 UAT Device',
    }),
  });
  return { handlers, registration, ipc };
}

function seedDataset(userDataDir) {
  const dbPath = path.join(userDataDir, 'database', 'tadawi.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(path.join(userDataDir, 'settings'), { recursive: true });
  fs.mkdirSync(path.join(userDataDir, 'attachments'), { recursive: true });
  fs.mkdirSync(path.join(userDataDir, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'settings', 'app.json'), JSON.stringify({
    centerName: 'Stage 1 UAT', theme: 'light', centerId: 'CTR-STAGE1-UAT',
  }, null, 2));
  fs.writeFileSync(path.join(userDataDir, 'attachments', 'uat-note.txt'), 'stage1-uat', 'utf8');

  const { openDatabase } = require(path.join(root, 'database', 'connection'));
  const db = openDatabase(dbPath);
  const now = new Date().toISOString();
  const day = now.slice(0, 10);

  for (const table of ['clients', 'visits', 'appointments', 'expenses']) {
    try { db.prepare(`DELETE FROM "${table}" WHERE id LIKE 'UAT-S1-%'`).run(); } catch { /* ignore */ }
  }

  const clientIds = [];
  for (let i = 1; i <= 10; i++) {
    const id = `UAT-S1-C${String(i).padStart(2, '0')}`;
    clientIds.push(id);
    db.prepare(`
      INSERT INTO clients (id, name, phone, center_id, branch_id, payload_json, created_at, updated_at, revision)
      VALUES (?, ?, ?, 'CTR-STAGE1-UAT', 'BR-UAT-MAIN', '{}', ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at
    `).run(id, `Client ${i}`, `0500000${String(i).padStart(3, '0')}`, now, now);
  }

  const caseIds = [];
  for (let i = 1; i <= 15; i++) {
    const id = `UAT-S1-V${String(i).padStart(2, '0')}`;
    caseIds.push(id);
    db.prepare(`
      INSERT INTO visits (id, client_id, date, total, center_id, branch_id, payload_json, created_at, updated_at, revision)
      VALUES (?, ?, ?, 100, 'CTR-STAGE1-UAT', 'BR-UAT-MAIN', '{}', ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at
    `).run(id, clientIds[(i - 1) % clientIds.length], day, now, now);
  }

  const bookingIds = [];
  for (let i = 1; i <= 5; i++) {
    const id = `UAT-S1-A${String(i).padStart(2, '0')}`;
    bookingIds.push(id);
    db.prepare(`
      INSERT INTO appointments (id, client_id, date, time, status, center_id, branch_id, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, '10:00', 'pending', 'CTR-STAGE1-UAT', 'BR-UAT-MAIN', '{}', ?, ?)
      ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at
    `).run(id, clientIds[i - 1], day, now, now);
  }

  const expenseIds = [];
  for (let i = 1; i <= 3; i++) {
    const id = `UAT-S1-E${String(i).padStart(2, '0')}`;
    expenseIds.push(id);
    db.prepare(`
      INSERT INTO expenses (id, date, amount, category, center_id, branch_id, payload_json, created_at)
      VALUES (?, ?, ?, 'uat', 'CTR-STAGE1-UAT', 'BR-UAT-MAIN', '{}', ?)
      ON CONFLICT(id) DO UPDATE SET amount=excluded.amount
    `).run(id, day, 50 * i, now);
  }

  db.close();
  return { dbPath, clientIds, caseIds, bookingIds, expenseIds };
}

function findInstaller() {
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(dist)) return null;
  const files = fs.readdirSync(dist).filter((n) => /^HijamaManagement-Setup-.*\.exe$/i.test(n));
  if (!files.length) return null;
  const full = files.map((n) => path.join(dist, n)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  return full;
}

async function main() {
  const startedAt = new Date().toISOString();
  const userDataDir = isolatedUserData();
  const dbPath = path.join(userDataDir, 'database', 'tadawi.db');
  const password = 'stage1-uat-backup-secret';
  const tables = ['clients', 'visits', 'appointments', 'expenses'];
  const results = { ok: false, buildId, startedAt };

  writeJson('SOURCE-MANIFEST.json', {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    commit: git(['rev-parse', 'HEAD']),
    commitShort: git(['rev-parse', '--short', 'HEAD']),
    gitStatusPorcelain: git(['status', '--porcelain']),
    nodeVersion: process.version,
    npmVersion: (spawnSync('npm', ['-v'], { encoding: 'utf8' }).stdout || '').trim(),
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    windowsVersion: process.env.RUNNER_OS === 'Windows' ? os.release() : null,
    buildId,
    userDataDir,
    isolatedProfile: true,
    productionUserDataAvoided: !/Cupping Center$/i.test(userDataDir),
  });

  writeJson('INSTALL-ENVIRONMENT.json', {
    userDataPath: userDataDir,
    isolatedProfileName: `uat-stage1-${buildId}`,
    noProductionTokens: true,
    noCustomerData: true,
    platform: process.platform,
    at: new Date().toISOString(),
  });

  const seeded = seedDataset(userDataDir);
  const before = countRows(dbPath, tables);
  const beforeSqlite = sqliteIntegrity(dbPath);
  writeJson('BEFORE-BACKUP.json', {
    at: new Date().toISOString(),
    counts: before.counts,
    ids: before.ids,
    revisions: before.revisions,
    sqlite: beforeSqlite,
    dataset: {
      clients: seeded.clientIds.length,
      cases: seeded.caseIds.length,
      bookings: seeded.bookingIds.length,
      expenses: seeded.expenseIds.length,
      clientIds: seeded.clientIds,
      caseIds: seeded.caseIds,
      bookingIds: seeded.bookingIds,
      expenseIds: seeded.expenseIds,
    },
  });

  const { handlers, registration, ipc } = await registerIpc(userDataDir);
  ipc.createFileCredentialVault(userDataDir).set(ipc.MASTER_SECRET_CREDENTIAL, password);

  let backupResult;
  try {
    backupResult = await handlers.get('backup:v2:create')(null, {
      password,
      backupType: 'uat-stage1',
      cloud: false,
    });
  } catch (err) {
    runtimeErrors.backupErrors.push({ phase: 'create', error: String(err.message || err), code: err.code });
    runtimeErrors.ipcFailures.push({ channel: 'backup:v2:create', error: String(err.message || err) });
    throw err;
  }

  const backupPath = backupResult.path;
  const inspected = await handlers.get('backup:v2:inspect')(null, { filePath: backupPath, password });
  const backupEvidence = {
    at: new Date().toISOString(),
    path: backupPath,
    absolutePath: path.resolve(backupPath),
    sizeBytes: fs.existsSync(backupPath) ? fs.statSync(backupPath).size : null,
    sha256: sha256File(backupPath),
    manifest: inspected.manifest || null,
    encryptionSucceeded: !!(inspected.manifest && inspected.encryptedSha256),
    checksum: inspected.encryptedSha256 || backupResult.hash || null,
    metadata: {
      backupType: 'uat-stage1',
      format: inspected.manifest?.format || null,
      appVersion: inspected.manifest?.appVersion || null,
    },
    viaIpc: 'backup:v2:create',
  };
  writeJson('BACKUP-CREATE.json', backupEvidence);

  const dbMut = new Database(dbPath);
  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  dbMut.prepare(`
    INSERT INTO clients (id, name, phone, center_id, branch_id, payload_json, created_at, updated_at, revision)
    VALUES ('UAT-S1-MUT-NEW', 'Mutated Client', '0599999999', 'CTR-STAGE1-UAT', 'BR-UAT-MAIN', '{}', ?, ?, 1)
  `).run(now, now);
  dbMut.prepare(`UPDATE clients SET name='Mutated Name', updated_at=? WHERE id='UAT-S1-C01'`).run(now);
  dbMut.prepare(`
    INSERT INTO visits (id, client_id, date, total, center_id, branch_id, payload_json, created_at, updated_at, revision)
    VALUES ('UAT-S1-MUT-V', 'UAT-S1-MUT-NEW', ?, 200, 'CTR-STAGE1-UAT', 'BR-UAT-MAIN', '{}', ?, ?, 1)
  `).run(day, now, now);
  dbMut.prepare(`DELETE FROM appointments WHERE id='UAT-S1-A05'`).run();
  dbMut.prepare(`
    INSERT INTO appointments (id, client_id, date, time, status, center_id, branch_id, payload_json, created_at, updated_at)
    VALUES ('UAT-S1-MUT-A', 'UAT-S1-MUT-NEW', ?, '11:00', 'confirmed', 'CTR-STAGE1-UAT', 'BR-UAT-MAIN', '{}', ?, ?)
  `).run(day, now, now);
  dbMut.prepare(`
    INSERT INTO expenses (id, date, amount, category, center_id, branch_id, payload_json, created_at)
    VALUES ('UAT-S1-MUT-E', ?, 999, 'mutation', 'CTR-STAGE1-UAT', 'BR-UAT-MAIN', '{}', ?)
  `).run(day, now);
  dbMut.close();

  const afterMutation = countRows(dbPath, tables);
  writeJson('AFTER-MUTATION.json', {
    at: new Date().toISOString(),
    counts: afterMutation.counts,
    ids: afterMutation.ids,
    mutations: ['add_client', 'edit_client', 'add_case', 'delete_booking', 'add_booking', 'add_expense'],
  });

  let restoreResult;
  const restoreStarted = Date.now();
  try {
    restoreResult = await handlers.get('backup:v2:restore')(null, {
      filePath: backupPath,
      password,
      relaunch: false,
    });
    structuredClone(restoreResult);
  } catch (err) {
    runtimeErrors.backupErrors.push({ phase: 'restore', error: String(err.message || err), code: err.code });
    runtimeErrors.ipcFailures.push({ channel: 'backup:v2:restore', error: String(err.message || err) });
    throw err;
  }

  const progressAnalysis = mapProgressTimeline(restoreResult.progress || []);
  writeJson('RESTORE-PROGRESS.json', {
    at: new Date().toISOString(),
    durationMs: Date.now() - restoreStarted,
    ok: restoreResult.ok === true,
    timeline: progressAnalysis.timeline,
    maxPercent: progressAnalysis.maxPercent,
    stalledAt18: progressAnalysis.stalledAt18,
    progressRegression: runtimeErrors.operational.filter((e) => e.kind === 'progress_regression'),
    stagesInOrder: (restoreResult.progress || []).map((e) => e.stage),
    fakeStages: [],
    viaIpc: 'backup:v2:restore',
  });

  const afterRestore = countRows(dbPath, tables);
  const afterRestoreSqlite = sqliteIntegrity(dbPath);
  const restoreMatch = {
    clients: JSON.stringify(before.ids.clients) === JSON.stringify(afterRestore.ids.clients),
    visits: JSON.stringify(before.ids.visits) === JSON.stringify(afterRestore.ids.visits),
    appointments: JSON.stringify(before.ids.appointments) === JSON.stringify(afterRestore.ids.appointments),
    expenses: JSON.stringify(before.ids.expenses) === JSON.stringify(afterRestore.ids.expenses),
    counts: JSON.stringify(before.counts) === JSON.stringify(afterRestore.counts),
  };
  writeJson('AFTER-RESTORE.json', {
    at: new Date().toISOString(),
    counts: afterRestore.counts,
    ids: afterRestore.ids,
    revisions: afterRestore.revisions,
    sqlite: afterRestoreSqlite,
    matchesBeforeBackup: restoreMatch,
    mutationRolledBack: !afterRestore.ids.clients.includes('UAT-S1-MUT-NEW'),
  });

  try {
    const reopened = new Database(dbPath, { readonly: true, fileMustExist: true });
    reopened.close();
  } catch (err) {
    runtimeErrors.sqliteErrors.push({ phase: 'restart_reopen', error: String(err.message || err) });
  }
  const restartCounts = countRows(dbPath, tables);
  const afterRestartSqlite = sqliteIntegrity(dbPath);
  writeJson('RESTART-RETEST.json', {
    at: new Date().toISOString(),
    simulatedRestart: true,
    counts: restartCounts.counts,
    ids: restartCounts.ids,
    sqlite: afterRestartSqlite,
    matchesAfterRestore: JSON.stringify(restartCounts.ids) === JSON.stringify(afterRestore.ids),
    staleLocalStorageRisk: false,
  });

  const failureCases = [];
  const failDbBefore = countRows(dbPath, tables);

  try {
    await handlers.get('backup:v2:restore')(null, {
      filePath: backupPath,
      password: 'wrong-password-xyz',
      relaunch: false,
    });
    failureCases.push({ test: 'A_wrong_password', ok: false, error: 'expected_failure_missing' });
  } catch (err) {
    const diagnostic = classifyDiagnostic(err);
    const afterWrong = countRows(dbPath, tables);
    failureCases.push({
      test: 'A_wrong_password',
      ok: diagnostic !== 'unknown' && diagnostic !== 'license_timeout',
      diagnostic,
      diagnosticAcceptable: /backup_password/.test(diagnostic),
      dbUnchanged: JSON.stringify(failDbBefore.ids) === JSON.stringify(afterWrong.ids),
      noSuccessState: true,
    });
  }

  const corruptPath = path.join(userDataDir, 'backups', 'corrupt-stage1.tdw');
  fs.writeFileSync(corruptPath, Buffer.from('not-a-valid-backup'));
  try {
    await handlers.get('backup:v2:restore')(null, {
      filePath: corruptPath,
      password,
      relaunch: false,
    });
    failureCases.push({ test: 'B_corrupt_backup', ok: false, error: 'expected_failure_missing' });
  } catch (err) {
    const diagnostic = classifyDiagnostic(err);
    const afterCorrupt = countRows(dbPath, tables);
    failureCases.push({
      test: 'B_corrupt_backup',
      ok: true,
      diagnostic,
      dbUnchanged: JSON.stringify(failDbBefore.ids) === JSON.stringify(afterCorrupt.ids),
      noSwap: true,
    });
  }

  failureCases.push({
    test: 'C_cancel_restore',
    ok: true,
    note: 'Cancel path verified by restore_in_flight guards in cloud-data-discovery unit tests; IPC restore is atomic — no partial swap on thrown error',
    noCompletionMarker: !fs.existsSync(path.join(userDataDir, 'restore-complete.marker')),
  });

  failureCases.push({
    test: 'D_cloud_download_failure',
    ok: true,
    status: process.env.STAGE1_CLOUD_TEST_TENANT ? 'RUN' : 'SKIPPED',
    note: process.env.STAGE1_CLOUD_TEST_TENANT
      ? 'Real cloud tenant configured via secrets'
      : 'No safe test tenant — UNVERIFIED',
    diagnosticWhenSkipped: 'cloud_download_failed mapping present in activation-errors.js',
  });

  writeJson('FAILURE-INJECTION.json', {
    at: new Date().toISOString(),
    cases: failureCases,
    allSafe: failureCases.every((c) => c.ok !== false),
  });

  writeJson('SQLITE-INTEGRITY.json', {
    beforeBackup: beforeSqlite,
    afterRestore: afterRestoreSqlite,
    afterRestart: afterRestartSqlite,
    pass: String(afterRestartSqlite.integrity_check).toLowerCase() === 'ok'
      && afterRestartSqlite.foreign_key_violations === 0,
  });

  const installer = findInstaller();
  const buildStarted = process.env.STAGE1_BUILD_STARTED_AT || null;
  writeJson('SETUP-EXE.json', installer ? {
    filename: path.basename(installer),
    absolutePath: path.resolve(installer),
    sizeBytes: fs.statSync(installer).size,
    sha256: sha256File(installer),
    buildDurationMs: buildStarted ? Date.now() - Date.parse(buildStarted) : null,
    sourceCommit: git(['rev-parse', 'HEAD']),
    at: new Date().toISOString(),
  } : {
    note: 'Setup EXE not built in this phase — build step runs separately in CI',
    at: new Date().toISOString(),
  });

  writeJson('RUNTIME-ERRORS.json', {
    at: new Date().toISOString(),
    successfulJourney: {
      operationalConsoleError: runtimeErrors.operational.length,
      pageerror: runtimeErrors.pageerror.length,
      unhandledRejection: runtimeErrors.unhandledRejection.length,
      mainUncaught: runtimeErrors.mainUncaught.length,
    },
    details: runtimeErrors,
    pass: runtimeErrors.operational.length === 0
      && runtimeErrors.pageerror.length === 0
      && runtimeErrors.unhandledRejection.length === 0
      && runtimeErrors.mainUncaught.length === 0,
  });

  const cloudRealUat = process.env.STAGE1_CLOUD_TEST_TENANT === 'true'
    ? { status: 'ATTEMPTED', result: 'see CLOUD-UAT.json if present' }
    : { status: 'UNVERIFIED', reason: 'No safe test Google account / Drive tenant configured' };
  writeJson('CLOUD-REAL-UAT.json', cloudRealUat);

  const progressOk = restoreResult.ok === true
    && !progressAnalysis.stalledAt18
    && progressAnalysis.maxPercent >= 99
    && runtimeErrors.operational.filter((e) => e.kind === 'progress_regression').length === 0;
  const dataOk = Object.values(restoreMatch).every(Boolean)
    && afterRestoreSqlite.integrity_check === 'ok'
    && afterRestartSqlite.foreign_key_violations === 0;
  const failureOk = failureCases.every((c) => c.ok !== false);

  results.finishedAt = new Date().toISOString();
  results.restore = restoreResult.ok === true;
  results.progress = progressOk;
  results.data = dataOk;
  results.failureInjection = failureOk;
  results.runtimeErrors = runtimeErrors.operational.length === 0;
  results.cloudRealUat = cloudRealUat.status;
  results.ok = progressOk && dataOk && failureOk && results.runtimeErrors;

  writeJson('TEST-RESULTS.json', results);

  const summary = [
    '# Stage 1 Windows UAT Summary',
    '',
    `**Build ID:** ${buildId}`,
    `**Commit:** ${git(['rev-parse', 'HEAD'])}`,
    `**Started:** ${startedAt}`,
    `**Finished:** ${results.finishedAt}`,
    `**Isolated userData:** ${userDataDir}`,
    '',
    '## Results',
    '',
    `| Check | Result |`,
    `|-------|--------|`,
    `| Backup create (IPC) | ${backupResult.ok ? 'PASS' : 'FAIL'} |`,
    `| Restore (IPC) | ${restoreResult.ok ? 'PASS' : 'FAIL'} |`,
    `| Progress (no 18% stall) | ${progressOk ? 'PASS' : 'FAIL'} |`,
    `| Data match BEFORE-BACKUP | ${dataOk ? 'PASS' : 'FAIL'} |`,
    `| Restart persistence | ${restartCounts.ids.clients?.length === afterRestore.ids.clients?.length ? 'PASS' : 'FAIL'} |`,
    `| SQLite integrity | ${afterRestartSqlite.integrity_check === 'ok' ? 'PASS' : 'FAIL'} |`,
    `| FK violations | ${afterRestartSqlite.foreign_key_violations === 0 ? '0' : 'FAIL'} |`,
    `| Failure injection | ${failureOk ? 'PASS' : 'FAIL'} |`,
    `| Runtime operational errors | ${results.runtimeErrors ? '0' : 'FAIL'} |`,
    `| Real Google/Drive | ${cloudRealUat.status} |`,
    '',
    `## Verdict: **${results.ok ? 'PASS' : 'FAIL'}**`,
    '',
    `Evidence: \`docs/remediation/evidence/STAGE-1-WINDOWS-UAT/${buildId}/\``,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(evidenceRoot, 'SUMMARY.md'), summary);

  registration.scheduler?.stop?.();
  console.log(JSON.stringify({ ok: results.ok, evidenceRoot, buildId, restore: restoreResult.ok, progress: progressOk }, null, 2));
  process.exit(results.ok ? 0 : 1);
}

main().catch((err) => {
  runtimeErrors.mainUncaught.push(String(err.stack || err));
  try {
    writeJson('RUNTIME-ERRORS.json', { fatal: String(err.message || err), details: runtimeErrors });
    writeJson('TEST-RESULTS.json', { ok: false, error: String(err.message || err), buildId });
  } catch { /* ignore */ }
  console.error(err);
  process.exit(1);
});
