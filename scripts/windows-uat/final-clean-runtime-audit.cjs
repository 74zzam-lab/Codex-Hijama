#!/usr/bin/env node
'use strict';

/**
 * Final clean-runtime proof for setup Owner session, activation failure truth,
 * post-activation service failures, V5 generator idempotency and restart durability.
 * Runs the real Electron renderer/preload/main path with an isolated user-data folder.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { _electron: electron } = require('playwright');
const { hashPasswordV2 } = require('../../electron/security/password-auth');

const root = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const buildId = arg('build-id', `source-${Date.now()}`);
const executablePath = arg('exe', '');
const profileRoot = path.resolve(arg('profile', path.join(root, '.codex-validation', 'final-clean-runtime', buildId)));
const outputPath = path.resolve(arg('output', path.join(profileRoot, 'FINAL-CLEAN-RUNTIME.json')));
const runtimeUserData = path.join(profileRoot, 'Cupping Center');
const developerPassword = String(process.env.TDAWI_FINAL_DEVELOPER_PASSWORD || '');
if (!developerPassword) throw new Error('TDAWI_FINAL_DEVELOPER_PASSWORD is required');

const report = {
  schema: 'final-clean-runtime-v1', buildId, profileRoot,
  mode: executablePath ? 'installed-exe' : 'source-electron',
  executablePath: executablePath ? path.resolve(executablePath) : null,
  startedAt: new Date().toISOString(), checks: [], stages: [], result: 'FAIL',
};
function check(name, pass, detail, boundary = 'actual-electron') {
  report.checks.push({ name, pass: !!pass, boundary, detail: detail ?? null });
  return !!pass;
}
function requireOk(name, value) {
  if (value?.ok !== true) throw new Error(`${name}:${value?.error || value?.message || 'failed'}`);
  return value;
}

function loadService() {
  const originalLoad = Module._load;
  Module._load = function finalAuditFixtureLoad(request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => runtimeUserData } };
    return originalLoad.call(this, request, parent, isMain);
  };
  const servicePath = path.join(root, 'electron', 'database', 'service.js');
  delete require.cache[require.resolve(servicePath)];
  try { return require(servicePath); }
  finally { Module._load = originalLoad; }
}

function seedFixture() {
  fs.mkdirSync(runtimeUserData, { recursive: true });
  const service = loadService();
  const license = JSON.parse(fs.readFileSync(
    path.join(root, 'tools', 'license-admin', 'fixtures', 'TDW-PROD-TEST-000001.v6.json'), 'utf8',
  ));
  const centerId = String(license.centerId);
  const branchId = String(license.branches?.[0]?.id || 'BR-MAIN');
  requireOk('activation', service.commitSetupActivation({
    license, legacyLicense: { ...license, licenseId: license.licenseUuid || license.licenseId },
    remotePath: `NajjarTech/${centerId}/License/license.json`,
  }));
  const organizationRequest = {
    commandId: 'final-clean-fixture-organization', license,
    centerName: 'Final Clean Runtime Center', branchId, deviceName: 'Final Clean Runtime Device',
  };
  const organization = requireOk('organization', service.commitSetupOrganizationDevice(organizationRequest));
  const ownerRequest = {
    commandId: 'final-clean-fixture-owner',
    user: {
      id: 'final-owner', fullName: 'Final Owner', username: 'final-owner',
      password: hashPasswordV2('1234'), role: 'owner', active: true, credentialRevision: 1,
    },
    ownerProfile: { sessionEpoch: 0, createdAt: new Date().toISOString() },
  };
  requireOk('owner', service.commitSetupOwner(ownerRequest));
  const organizationReplay = requireOk('organization-replay', service.commitSetupOrganizationDevice(organizationRequest));
  const ownerReplay = requireOk('owner-replay', service.commitSetupOwner(ownerRequest));
  service.enableSqlitePrimary();
  const preauth = service.hydratePreauth();
  const db = service.ensureDb();
  const setupCommandCount = db.prepare(`
    SELECT COUNT(*) AS c FROM p0b_commands
    WHERE command_id LIKE 'final-clean-fixture-%'
  `).get().c;
  const ownerCount = (preauth.data?.users || []).filter((user) => user?.active !== false && user?.role === 'owner').length;
  const branchCount = (preauth.data?.__tdw_cloud_license__?.branches || []).filter((branch) => branch?.active !== false).length;
  check('fixture_device_registry_typed_once', organization.deviceRegistry?.registered?.length === 1, organization.deviceRegistry, 'real-sqlite');
  check('fixture_owner_credential_ready', preauth.data?.users?.[0]?.hasUsableCredential === true, preauth.data?.users, 'real-sqlite');
  check('repeated_setup_callbacks_are_idempotent',
    organizationReplay.deviceRegistry?.registered?.length === 1
      && ownerReplay.already === true
      && ownerCount === 1
      && branchCount === 1
      && setupCommandCount === 5,
    { ownerCount, branchCount, deviceCount: organizationReplay.deviceRegistry?.registered?.length, setupCommandCount },
    'real-sqlite');
  service.close();
  return { centerId, branchId };
}

async function launch(name) {
  const localAppData = path.join(profileRoot, 'LocalAppData');
  fs.mkdirSync(localAppData, { recursive: true });
  const launchOptions = {
    ...(executablePath
      ? { executablePath: path.resolve(executablePath), args: [`--user-data-dir=${runtimeUserData}`] }
      : { args: [root, `--user-data-dir=${runtimeUserData}`] }),
    cwd: root,
    timeout: 120000,
    env: {
      ...process.env, APPDATA: profileRoot, LOCALAPPDATA: localAppData,
      TDAWI_FORCE_USER_DATA_FOLDER: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '0',
    },
  };
  const app = await electron.launch(launchOptions);
  const page = await app.firstWindow({ timeout: 120000 });
  const stage = { name, startedAt: new Date().toISOString(), console: [], pageErrors: [] };
  report.stages.push(stage);
  page.on('console', (message) => stage.console.push({ type: message.type(), text: message.text().slice(0, 1500) }));
  page.on('pageerror', (error) => stage.pageErrors.push(String(error?.stack || error).slice(0, 3000)));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.BootFlow && window.CommercialLicense?.drawer
    && window.cuppingElectron?.rbac?.authenticateDeveloper && window.authenticateSetupOwner, null, { timeout: 120000 });
  await page.waitForTimeout(1200);
  return { app, page, stage };
}

async function ownerSessionScenario(page, afterRestart = false) {
  const before = await page.evaluate(async () => {
    await window.cuppingElectron.rbac.clearSession();
    window.BootFlow.openAtStep('owner', { path: 'existing' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      session: await window.cuppingElectron.rbac.getSession(),
      ownerValid: window.BootFlow.validateStep('owner'),
      passwordField: !!document.getElementById('bf-owner-password'),
      text: document.getElementById('bf-step-content')?.textContent || '',
    };
  });
  check(`${afterRestart ? 'restart_' : ''}owner_requires_real_session`,
    before.session?.ok === false && before.ownerValid === false && before.passwordField === true, before);

  const authenticated = await page.evaluate(async () => {
    const input = document.getElementById('bf-owner-password');
    if (input) input.value = '1234';
    document.querySelector('#bf-step-actions button')?.click();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const session = await window.cuppingElectron.rbac.getSession();
      if (session?.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const session = await window.cuppingElectron.rbac.getSession();
    window.BootFlow.openAtStep('owner', { path: 'existing' });
    return {
      session,
      ownerValid: window.BootFlow.validateStep('owner'),
      text: document.getElementById('bf-step-content')?.textContent || '',
    };
  });
  check(`${afterRestart ? 'restart_' : ''}owner_password_binds_main_session`,
    authenticated.session?.ok === true
      && authenticated.session?.session?.userId === 'final-owner'
      && authenticated.ownerValid === true,
    authenticated);
}

async function activationFailureScenario(page) {
  const value = await page.evaluate(async () => {
    const router = window.CommercialLicense.router;
    const original = {
      isV5Key: router.isV5Key,
      isV6Input: router.isV6Input,
      applyActivation: router.applyActivation,
    };
    window.BootFlow.openAtStep('license', { path: 'existing' });
    router.isV5Key = () => true;
    router.isV6Input = () => false;
    router.applyActivation = async () => ({ ok: false, error: 'forced_activation_failure' });
    const input = document.getElementById('bf-license-key');
    input.value = 'TDWI2-FAILURE-INJECTION';
    const button = document.querySelector('#bf-step-actions button');
    button.click();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && /جارٍ/.test(document.getElementById('bf-wizard-status')?.textContent || '')) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const status = document.getElementById('bf-wizard-status');
    const result = { text: status?.textContent || '', errorClass: status?.classList.contains('bf-status-error') || false };
    Object.assign(router, original);
    return result;
  });
  check('failed_activation_never_uses_stale_valid_license',
    value.errorClass === true && !/الترخيص صالح|تم التفعيل بنجاح/.test(value.text), value);
}

async function activationDefaultsFailureScenario(page) {
  const value = await page.evaluate(async () => {
    const names = ['settings', 'persistData', 'CloudV2', 'SyncGuard', 'SyncEngine', 'BackupLayer', 'cuppingElectron'];
    const saved = Object.fromEntries(names.map((name) => [name, window[name]]));
    try {
      window.settings = { backup: { providers: { google: { connected: true, oauth: true } } } };
      window.persistData = async () => ({ ok: true });
      window.CloudV2 = { maybeAutoEnableCloudV2: async () => ({ ok: true }) };
      window.SyncGuard = { resume: async () => ({ ok: true }) };
      window.SyncEngine = { isRunning: () => true };
      window.BackupLayer = { start: async () => { throw new Error('injected_backup_start_failure'); } };
      return await window.ActivationSyncDefaults.applyDefaults({ force: true, startSync: true, startBackup: true });
    } finally {
      for (const name of names) window[name] = saved[name];
    }
  });
  check('backup_start_failure_propagates',
    value?.ok === false && /injected_backup_start_failure/.test(String(value?.error)), value, 'actual-renderer-controlled-failure');
}

async function activationUploadFailureScenario(page) {
  const value = await page.evaluate(async () => {
    const key = '__tdw_license_activation_state__';
    const previousState = window.DB.get(key, null);
    const doc = window.LicenseCloud.loadLocal();
    const originalPush = window.LicenseCloud.ensurePushedToDrive;
    const originalEnsure = window.DriveAdapter.ensureConnected;
    const originalConnected = window.DriveAdapter.isConnected;
    try {
      window.DriveAdapter.ensureConnected = async () => true;
      window.DriveAdapter.isConnected = () => true;
      window.LicenseCloud.ensurePushedToDrive = async () => ({ ok: false, error: 'injected_activation_upload_failure' });
      const result = await window.LicenseActivationGate.commitActivation({
        licenseId: doc.licenseId,
        centerId: doc.centerId,
        branches: 2,
        deviceBinding: 'DEVICE_ANY',
        productKey: 'TDWI2-FAILURE-INJECTION',
      }, { productKey: 'TDWI2-FAILURE-INJECTION' });
      const stored = window.DB.get(key, null);
      return { result, stored };
    } finally {
      window.LicenseCloud.ensurePushedToDrive = originalPush;
      window.DriveAdapter.ensureConnected = originalEnsure;
      window.DriveAdapter.isConnected = originalConnected;
      await Promise.resolve(window.DB.set(key, previousState));
    }
  });
  check('activation_upload_failure_leaves_no_local_consumption',
    value?.result?.ok === false && value?.stored?.consumed !== true,
    value,
    'actual-renderer-controlled-failure');
}

async function bootCompletionDurabilityFailureScenario(page) {
  const value = await page.evaluate(async () => {
    const bootKey = '__tdw_boot_complete__';
    const wizardKey = '__tdw_boot_wizard__';
    const previousBoot = localStorage.getItem(bootKey);
    const previousWizard = window.BootFlow.loadWizard();
    const previousSettings = window.settings;
    const previousSet = window.DB.set;
    const previousConnected = window.DriveAdapter?.isConnected;
    try {
      const wizard = {
        ...previousWizard,
        path: 'existing',
        restoreChoice: 'empty',
        syncDone: true,
      };
      await Promise.resolve(previousSet.call(window.DB, wizardKey, wizard));
      window.settings = {
        ...(previousSettings || {}),
        centerName: previousSettings?.centerName || 'Final Clean Runtime Center',
        backup: {
          ...(previousSettings?.backup || {}),
          providers: {
            ...(previousSettings?.backup?.providers || {}),
            google: { connected: true, oauth: true, userDisconnected: false },
          },
        },
      };
      if (window.DriveAdapter) window.DriveAdapter.isConnected = () => true;
      window.DB.set = () => { throw new Error('injected_boot_completion_persistence_failure'); };
      localStorage.removeItem(bootKey);
      let result = null;
      let error = null;
      try {
        result = await Promise.resolve(window.BootFlow.markBootComplete());
      } catch (caught) {
        error = String(caught?.message || caught);
      }
      return { result, error, bootFlag: localStorage.getItem(bootKey) };
    } finally {
      window.DB.set = previousSet;
      window.settings = previousSettings;
      if (window.DriveAdapter) window.DriveAdapter.isConnected = previousConnected;
      await Promise.resolve(previousSet.call(window.DB, wizardKey, previousWizard));
      if (previousBoot === null) localStorage.removeItem(bootKey);
      else localStorage.setItem(bootKey, previousBoot);
    }
  });
  check('boot_completion_persistence_failure_blocks_ready',
    value?.result === false && value?.error === null && value?.bootFlag !== '1',
    value,
    'actual-renderer-controlled-failure');
}

async function discoveryResumeFailureScenario(page) {
  const value = await page.evaluate(async () => {
    const engine = window.SyncEngine;
    const original = {
      isRunning: engine.isRunning,
      stop: engine.stop,
      start: engine.start,
    };
    let running = true;
    try {
      engine.isRunning = () => running;
      engine.stop = () => { running = false; };
      engine.start = () => { throw new Error('injected_discovery_sync_resume_failure'); };
      const result = await window.CloudDataDiscovery.discoverAllSources({ timeoutMs: 3000 });
      return { result, running };
    } finally {
      Object.assign(engine, original);
    }
  });
  check('discovery_sync_resume_failure_is_reported',
    value?.result?.ok === false
      && value?.result?.error === 'injected_discovery_sync_resume_failure'
      && value?.running === false,
    value,
    'actual-renderer-controlled-failure');
}

async function discoveryStopFailureScenario(page) {
  const value = await page.evaluate(async () => {
    const engine = window.SyncEngine;
    const original = {
      isRunning: engine.isRunning,
      stop: engine.stop,
      start: engine.start,
    };
    try {
      engine.isRunning = () => true;
      engine.stop = () => { throw new Error('injected_discovery_sync_stop_failure'); };
      engine.start = () => ({ ok: true });
      return await window.CloudDataDiscovery.discoverAllSources({ timeoutMs: 3000 });
    } finally {
      Object.assign(engine, original);
    }
  });
  check('discovery_sync_stop_failure_is_reported',
    value?.ok === false && value?.error === 'injected_discovery_sync_stop_failure',
    value,
    'actual-renderer-controlled-failure');
}

async function cloudV2InitFailureScenario(page) {
  const value = await page.evaluate(async () => {
    const savedSettings = window.settings;
    const targets = [
      [window.CloudMeta, 'isCloudV2Enabled'],
      [window.CloudMeta, 'setCloudV2Enabled'],
      [window.DriveAdapter, 'isConnected'],
      [window.BackupLayer, 'start'],
      [window.SyncGuard, 'isPaused'],
      [window.DataStateAnalyzer, 'analyze'],
      [window.DeviceRegistry, 'registerDevice'],
      [window.DeviceRegistry, 'startHeartbeat'],
      [window.LicenseCloud, 'pushToDrive'],
    ];
    const originals = targets.map(([owner, name]) => [owner, name, owner?.[name]]);
    const originalPersist = window.persistData;
    const unhandled = [];
    const onUnhandled = (event) => {
      unhandled.push(String(event?.reason?.message || event?.reason || 'unhandled'));
      event.preventDefault();
    };
    window.addEventListener('unhandledrejection', onUnhandled);
    try {
      window.settings = {
        ...(savedSettings || {}),
        cloudV2Enabled: false,
        cloudV2UserDisabled: false,
        backup: {
          ...(savedSettings?.backup || {}),
          cloudEnabled: true,
          providers: {
            ...(savedSettings?.backup?.providers || {}),
            google: { connected: true, oauth: true, userDisconnected: false },
          },
        },
      };
      window.CloudMeta.isCloudV2Enabled = () => false;
      window.CloudMeta.setCloudV2Enabled = () => ({ cloudV2Enabled: true });
      window.DriveAdapter.isConnected = () => true;
      window.persistData = async () => ({ ok: true });
      window.SyncGuard.isPaused = () => true;
      window.DataStateAnalyzer.analyze = async () => ({ ok: true, offline: true, blocked: false });
      window.DeviceRegistry.registerDevice = async () => ({ ok: true });
      window.DeviceRegistry.startHeartbeat = () => ({ ok: true });
      window.LicenseCloud.pushToDrive = async () => ({ ok: true });
      window.BackupLayer.start = async () => { throw new Error('injected_cloud_v2_backup_start_failure'); };
      const result = await window.CloudV2.maybeAutoEnableCloudV2();
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { result, unhandled };
    } finally {
      window.removeEventListener('unhandledrejection', onUnhandled);
      window.settings = savedSettings;
      window.persistData = originalPersist;
      for (const [owner, name, original] of originals) {
        if (owner) owner[name] = original;
      }
    }
  });
  check('cloud_v2_initialization_failure_has_no_false_success_or_unhandled_rejection',
    value?.result?.ok === false
      && value?.result?.error === 'injected_cloud_v2_backup_start_failure'
      && value?.unhandled?.length === 0,
    value,
    'actual-renderer-controlled-failure');
}

async function licensePullCommitFailureScenario(page) {
  const value = await page.evaluate(async () => {
    const doc = window.LicenseCloud.loadLocal();
    const original = {
      ensureConnected: window.DriveAdapter.ensureConnected,
      isConnected: window.DriveAdapter.isConnected,
      downloadJsonFirst: window.DriveAdapter.downloadJsonFirst,
      set: window.DB.set,
    };
    try {
      window.DriveAdapter.ensureConnected = async () => true;
      window.DriveAdapter.isConnected = () => true;
      window.DriveAdapter.downloadJsonFirst = async (paths) => ({ ok: true, data: doc, path: paths?.[0] });
      window.DB.set = (key, data) => key === '__tdw_cloud_license__'
        ? Promise.resolve({ ok: false, error: 'injected_license_pull_commit_failure' })
        : original.set.call(window.DB, key, data);
      return await window.CloudBootstrap.fetchLicenseFromDrive(doc.centerId, { persist: true });
    } finally {
      window.DriveAdapter.ensureConnected = original.ensureConnected;
      window.DriveAdapter.isConnected = original.isConnected;
      window.DriveAdapter.downloadJsonFirst = original.downloadJsonFirst;
      window.DB.set = original.set;
    }
  });
  check('license_pull_local_commit_failure_is_reported',
    value?.ok === false && value?.error === 'injected_license_pull_commit_failure',
    value,
    'actual-renderer-controlled-failure');
}

async function v5GeneratorScenario(page) {
  const auth = await page.evaluate(async (password) => {
    await window.cuppingElectron.rbac.clearSession();
    const authenticated = await window.cuppingElectron.rbac.authenticateDeveloper(password);
    const bound = authenticated?.proof
      ? await window.cuppingElectron.rbac.bindSession({ userId: '__dev__', role: 'admin', authProof: authenticated.proof })
      : null;
    return { authenticated, bound, session: await window.cuppingElectron.rbac.getSession() };
  }, developerPassword);
  check('intentional_developer_login_preserved',
    auth.authenticated?.ok === true && auth.bound?.ok === true && auth.session?.session?.userId === '__dev__', auth);

  await page.evaluate(() => window.CommercialLicense.drawer.open());
  await page.waitForSelector('.lic-v2-pkg-card', { timeout: 30000 });
  const generated = await page.evaluate(async () => {
    document.querySelector('.lic-v2-pkg-card')?.click();
    const next = () => document.getElementById('lic-v2-next')?.click();
    next(); next(); next(); next();
    next(); next();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !document.getElementById('lic-v2-generated-key')) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return {
      key: document.getElementById('lic-v2-generated-key')?.textContent || '',
      body: document.getElementById('lic-v2-body')?.textContent || '',
      nextDisabled: document.getElementById('lic-v2-next')?.disabled || false,
    };
  });
  const indexPath = path.join(runtimeUserData, 'LicenseAdmin', 'data', 'license-registry', 'index.json');
  const registry = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const records = Array.isArray(registry) ? registry : (registry.entries || registry.licenses || registry.records || []);
  check('v5_generator_double_click_persists_once', records.length === 1, { generated, indexPath, records: records.length });
  check('v5_generator_output_is_v5', /^TDW(?!6\.)/i.test(generated.key) && !/V6/.test(generated.body), generated);
  return generated.key;
}

async function activationPublicationSinglePathScenario(page, productKey) {
  const value = await page.evaluate(async (key) => {
    const owners = [
      [window.CommercialLicense.validator, 'validateKey'],
      [window.LicenseActivationGate, 'preActivateCheck'],
      [window.LicenseActivationGate, 'commitActivation'],
      [window.CloudV2, 'afterLicenseActivation'],
      [window.LicenseCloud, 'ensurePushedToDrive'],
      [window.DriveAdapter, 'ensureConnected'],
      [window.DriveAdapter, 'isConnected'],
      [window, 'licFetchRealTime'],
    ];
    const originals = owners.map(([owner, name]) => [owner, name, owner?.[name]]);
    const originalNotify = window.notify;
    const notifications = [];
    let afterCalls = 0;
    let finalPushCalls = 0;
    try {
      window.CommercialLicense.validator.validateKey = async () => ({
        ok: true,
        payload: {
          expiry: '2035-01-01', issue: '2026-01-01', issued: '2026-01-01',
          licenseId: 'FINAL-SINGLE-PATH', device: 'DEVICE_ANY', licType: 'new',
          edition: 'PRO', features: {}, commercial: true,
        },
        record: {
          licenseId: 'FINAL-SINGLE-PATH', licenseUuid: 'FINAL-SINGLE-PATH',
          centerId: 'CTR-PROD-TEST', deviceBinding: 'DEVICE_ANY', branches: 2,
        },
        bundle: { ok: true },
      });
      window.LicenseActivationGate.preActivateCheck = async () => ({ ok: true });
      window.LicenseActivationGate.commitActivation = async () => ({ ok: true, drivePush: { ok: true } });
      window.CloudV2.afterLicenseActivation = async () => {
        afterCalls += 1;
        return { drivePush: { ok: false, error: 'injected_duplicate_post_commit_upload_failure' } };
      };
      window.LicenseCloud.ensurePushedToDrive = async () => {
        finalPushCalls += 1;
        return { ok: false, error: 'injected_duplicate_final_upload_failure' };
      };
      window.DriveAdapter.ensureConnected = async () => true;
      window.DriveAdapter.isConnected = () => true;
      window.licFetchRealTime = async () => new Date('2026-08-11T00:00:00.000Z');
      window.notify = (message, type) => notifications.push({ message: String(message), type: String(type || '') });
      const result = await window.CommercialLicense.router.applyActivation(key, null, null);
      return { result, afterCalls, finalPushCalls, notifications };
    } finally {
      for (const [owner, name, original] of originals) {
        if (owner) owner[name] = original;
      }
      window.notify = originalNotify;
    }
  }, productKey);
  check('activation_uses_one_publication_path_after_gate_commit',
    value?.result?.ok === true
      && value?.afterCalls === 0
      && value?.finalPushCalls === 0
      && !value?.notifications?.some((item) => item.type === 'warning' || /failed|فشل/i.test(item.message)),
    value,
    'actual-renderer-controlled-failure');
}

function inspectSqliteAfterRestart() {
  const service = loadService();
  const db = service.ensureDb();
  const preauth = service.hydratePreauth();
  const registry = preauth.data?.__tdw_device_registry__;
  const shadows = db.prepare(`
    SELECT COUNT(*) AS c FROM kv_store
    WHERE key IN ('__tdw_owner_profile__','__tdw_owner_setup__','__tdw_device_registry__')
  `).get().c;
  const integrity = service.getStatus().integrity;
  check('restart_typed_setup_authority_survives',
    registry?.registered?.length === 1 && preauth.data?.__tdw_owner_setup__?.status === 'complete',
    { registry, ownerSetup: preauth.data?.__tdw_owner_setup__ }, 'real-sqlite-restart');
  check('restart_no_setup_kv_shadows', shadows === 0, { shadows }, 'real-sqlite-restart');
  check('restart_sqlite_integrity', integrity?.ok === true, integrity, 'real-sqlite-restart');
  service.close();
}

(async () => {
  fs.mkdirSync(profileRoot, { recursive: true });
  seedFixture();
  let runtime = await launch('first-launch');
  await ownerSessionScenario(runtime.page, false);
  await activationFailureScenario(runtime.page);
  await activationDefaultsFailureScenario(runtime.page);
  await activationUploadFailureScenario(runtime.page);
  await bootCompletionDurabilityFailureScenario(runtime.page);
  await discoveryResumeFailureScenario(runtime.page);
  await discoveryStopFailureScenario(runtime.page);
  await cloudV2InitFailureScenario(runtime.page);
  await licensePullCommitFailureScenario(runtime.page);
  const generatedKey = await v5GeneratorScenario(runtime.page);
  await activationPublicationSinglePathScenario(runtime.page, generatedKey);
  await runtime.app.close();

  runtime = await launch('restart');
  await ownerSessionScenario(runtime.page, true);
  await runtime.app.close();
  inspectSqliteAfterRestart();

  for (const stage of report.stages) {
    check(`${stage.name}_no_page_errors`, stage.pageErrors.length === 0, stage.pageErrors);
    const severe = stage.console.filter((row) => row.type === 'error');
    check(`${stage.name}_no_console_errors`, severe.length === 0, severe);
    const securityWarnings = stage.console.filter((row) => /Blocked unsafe UI action|action_argument_denied/i.test(row.text));
    check(`${stage.name}_no_console_security_warnings`, securityWarnings.length === 0, securityWarnings);
  }
  report.finishedAt = new Date().toISOString();
  report.result = report.checks.every((item) => item.pass) ? 'PASS' : 'FAIL';
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}${os.EOL}`, 'utf8');
  console.log(JSON.stringify({ result: report.result, outputPath, checks: report.checks.length }, null, 2));
  process.exitCode = report.result === 'PASS' ? 0 : 1;
})().catch((error) => {
  report.finishedAt = new Date().toISOString();
  report.result = 'FAIL';
  report.fatal = String(error?.stack || error);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}${os.EOL}`, 'utf8');
  console.error(error?.stack || error);
  process.exit(1);
});
