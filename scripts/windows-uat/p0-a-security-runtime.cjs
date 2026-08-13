#!/usr/bin/env node
'use strict';

/**
 * Phase P0-A production-runtime security proof.
 * Launches either source Electron or an installed executable with an isolated APPDATA,
 * exercises renderer -> preload -> main paths, closes the process, then relaunches the
 * same profile for restart/retest. No test-only IPC or production bypass is used.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const acorn = require('acorn');
const { spawn } = require('child_process');
const { _electron: electron } = require('playwright');
const { CHANNEL_POLICY } = require('../../electron/rbac-session');
const { hashPasswordV2 } = require('../../electron/security/password-auth');

const root = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const executablePath = arg('exe');
const profileRoot = path.resolve(arg('profile', path.join(root, '.codex-p0a', 'runtime-profile')));
const outputPath = path.resolve(arg('output', path.join(root, '.codex-p0a', 'p0-a-runtime.json')));
const mode = executablePath ? 'installed-exe' : 'source-electron';
const runtimeUserData = path.join(profileRoot, 'Cupping Center');
const receptionHash = 'pbkdf2:reception:54f155e640fc70b9fb5959af0459ccba1bba552c11afe44540236f3c92d43bf3';
const ownerHash = hashPasswordV2('1234');
const developerPassword = String(process.env.TDAWI_P0A_DEVELOPER_PASSWORD || '');

if (!developerPassword) {
  throw new Error('TDAWI_P0A_DEVELOPER_PASSWORD is required for the intentional developer-login scenario.');
}
const payload = `<img src=x onerror="parent.__p0aXss=(parent.__p0aXss||0)+1"><script>parent.__p0aXss=(parent.__p0aXss||0)+10</script><svg onload="parent.__p0aXss=(parent.__p0aXss||0)+100"></svg>`;

function seedRuntimeFixture() {
  const dbPath = path.join(runtimeUserData, 'database', 'tadawi.db');
  if (fs.existsSync(dbPath)) return { reused: true, dbPath };
  fs.mkdirSync(runtimeUserData, { recursive: true });

  const originalLoad = Module._load;
  Module._load = function p0aFixtureLoad(request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => runtimeUserData } };
    return originalLoad.call(this, request, parent, isMain);
  };
  const servicePath = path.join(root, 'electron', 'database', 'service.js');
  delete require.cache[require.resolve(servicePath)];
  let service;
  try {
    service = require(servicePath);
  } finally {
    Module._load = originalLoad;
  }

  const license = JSON.parse(fs.readFileSync(
    path.join(root, 'tools', 'license-admin', 'fixtures', 'TDW-PROD-TEST-000001.v6.json'),
    'utf8'
  ));
  const centerId = String(license.centerId);
  const branchId = String(license.branches?.[0]?.id || 'BR-MAIN');
  const remotePath = `NajjarTech/${centerId}/License/license.json`;
  const requireOk = (name, result) => {
    if (result?.ok !== true) throw new Error(`${name}:${result?.error || 'failed'}`);
    return result;
  };

  requireOk('fixture_activation', service.commitSetupActivation({
    license,
    legacyLicense: { ...license, migratedFixture: true },
    remotePath,
  }));
  requireOk('fixture_organization', service.commitSetupOrganizationDevice({
    commandId: 'p0a-fixture-organization',
    license,
    centerName: 'P0A Runtime Center',
    branchId,
    deviceName: 'P0A Runtime Device',
  }));
  requireOk('fixture_owner', service.commitSetupOwner({
    commandId: 'p0a-fixture-owner',
    user: {
      id: 'p0a-owner', fullName: 'P0A Owner', username: 'p0a-owner',
      password: ownerHash, role: 'owner', active: true, credentialRevision: 1,
    },
    ownerProfile: { sessionEpoch: 0, createdAt: new Date().toISOString() },
  }));

  const orgContext = { centerId, branchId: '__ORG__', actorId: 'p0a-owner', deviceId: 'p0a-fixture', trusted: true };
  const branchContext = { centerId, branchId, actorId: 'p0a-owner', deviceId: 'p0a-fixture', trusted: true };
  for (const user of [
    { id: 'p0a-admin', fullName: 'P0A Admin', username: 'p0a-admin', password: ownerHash, role: 'admin', active: true, sessionEpoch: 0, branchScope: [branchId], centerId },
    { id: 'p0a-reception', fullName: 'P0A Reception', username: 'reception', password: receptionHash, role: 'reception', active: true, sessionEpoch: 0, branchScope: [branchId], centerId },
    { id: 'p0a-xss-user', fullName: payload, username: 'p0a-xss-user', password: receptionHash, role: 'reception', active: true, sessionEpoch: 0, branchScope: [branchId], centerId },
  ]) {
    requireOk(`fixture_user_${user.id}`, service.command({
      commandId: `p0a-fixture-user-${user.id}`, entity: 'users', action: 'upsert', record: user,
    }, orgContext));
  }
  for (const [entity, record] of [
    ['clientsRegistry', { id: 'p0a-xss-client', name: payload, phone: '0500000000', nationality: payload }],
    ['doctors', { id: 'p0a-xss-doctor', name: payload, specialty: payload, active: true }],
    ['cases', { id: 'p0a-xss-case', name: payload, doctorName: payload, date: new Date().toISOString().slice(0, 10), total: 1 }],
  ]) {
    requireOk(`fixture_${entity}`, service.command({
      commandId: `p0a-fixture-${entity}`, entity, action: 'upsert', record,
    }, branchContext));
  }
  service.enableSqlitePrimary();
  service.close();
  return { reused: false, dbPath, centerId, branchId };
}

function visitAst(node, visitor) {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((item) => visitAst(item, visitor));
    else if (value && typeof value === 'object' && typeof value.type === 'string') visitAst(value, visitor);
  }
}

function propertyName(property) {
  if (!property?.key) return '';
  return String(property.key.name ?? property.key.value ?? '');
}

function discoverPreloadInvokeBindings() {
  const preloadPath = path.join(root, 'electron', 'preload.js');
  const source = fs.readFileSync(preloadPath, 'utf8');
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  let apiObject = null;
  visitAst(ast, (node) => {
    if (node.type === 'VariableDeclarator' && node.id?.name === 'cuppingApi' && node.init?.type === 'ObjectExpression') {
      apiObject = node.init;
    }
  });
  if (!apiObject) throw new Error('cuppingApi object not found in preload');

  const bindings = [];
  function collect(objectNode, prefix = []) {
    for (const property of objectNode.properties || []) {
      const name = propertyName(property);
      if (!name) continue;
      const currentPath = [...prefix, name];
      if (property.value?.type === 'ObjectExpression') {
        collect(property.value, currentPath);
        continue;
      }
      if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(property.value?.type)) continue;
      let channel = '';
      visitAst(property.value.body, (node) => {
        if (!channel
            && node.type === 'CallExpression'
            && node.callee?.type === 'Identifier'
            && node.callee.name === 'invoke'
            && typeof node.arguments?.[0]?.value === 'string') {
          channel = node.arguments[0].value;
        }
      });
      if (channel) bindings.push({ channel, path: currentPath });
    }
  }
  collect(apiObject);

  const byChannel = new Map();
  for (const binding of bindings) {
    if (!byChannel.has(binding.channel)) byChannel.set(binding.channel, binding);
  }
  const protectedPolicies = Object.entries(CHANNEL_POLICY).filter(([, policy]) => policy.public !== true);
  const missing = protectedPolicies.map(([channel]) => channel).filter((channel) => !byChannel.has(channel));
  if (missing.length) throw new Error(`protected preload bindings missing: ${missing.join(', ')}`);
  return protectedPolicies.map(([channel, policy]) => ({
    ...byChannel.get(channel),
    policy,
    timeoutMs: channel === 'app:wipePersistentLicenseData' ? 120000 : 10000,
    // Reaching this handler intentionally opens a native file picker. In the
    // unattended matrix, an open dialog at the timeout is runtime evidence
    // that the authorized request passed RBAC and reached the handler.
    interactiveDialog: channel === 'license:adminSelectSigningKey',
    lowRoleExpected: (!policy.roles || policy.roles.includes('reception'))
      && (policy.minRank == null || policy.minRank <= 2)
      && (!policy.permissions || policy.permissions.length === 0),
  })).sort((left, right) => {
    if (left.channel === 'app:wipePersistentLicenseData') return 1;
    if (right.channel === 'app:wipePersistentLicenseData') return -1;
    return left.channel.localeCompare(right.channel);
  });
}

const protectedIpcBindings = discoverPreloadInvokeBindings();

fs.mkdirSync(profileRoot, { recursive: true });
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const report = {
  schema: 'p0-a-runtime-v1',
  mode,
  executablePath: executablePath || null,
  profileRoot,
  startedAt: new Date().toISOString(),
  checks: [],
  stages: [],
  ipcCoverage: null,
  result: 'FAIL',
};

function check(name, pass, detail, stage = 'runtime') {
  report.checks.push({ name, pass: !!pass, stage, detail: detail == null ? null : detail });
  return !!pass;
}

function safeResult(value) {
  if (value == null) return value;
  try { return JSON.parse(JSON.stringify(value)); } catch { return String(value); }
}

function acceptNativePdfSaveDialog() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$shell = New-Object -ComObject WScript.Shell
$titles = @('حفظ أرشيف التقارير PDF', 'Save As', 'حفظ باسم')
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
  foreach ($title in $titles) {
    if ($shell.AppActivate($title)) {
      Start-Sleep -Milliseconds 500
      $shell.SendKeys('{ENTER}')
      exit 0
    }
  }
  Start-Sleep -Milliseconds 250
}
exit 2
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const completion = new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => resolve({ exitCode: null, error: String(error?.message || error), stdout, stderr }));
    child.on('exit', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
  return { child, completion };
}

async function launch(stageName) {
  const localAppData = path.join(profileRoot, 'LocalAppData');
  fs.mkdirSync(localAppData, { recursive: true });
  const env = {
    ...process.env,
    APPDATA: profileRoot,
    LOCALAPPDATA: localAppData,
    TDAWI_FORCE_USER_DATA_FOLDER: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '0',
  };
  const profileArg = `--user-data-dir=${runtimeUserData}`;
  const options = executablePath
    ? { executablePath: path.resolve(executablePath), args: [profileArg], env, timeout: 120000 }
    : { args: [root, profileArg], cwd: root, env, timeout: 120000 };
  const app = await electron.launch(options);
  const page = await app.firstWindow({ timeout: 120000 });
  const consoleMessages = [];
  const pageErrors = [];
  page.on('console', (message) => {
    const location = message.location();
    consoleMessages.push({
      type: message.type(),
      text: message.text().slice(0, 1000),
      url: String(location?.url || '').slice(0, 1000),
      lineNumber: location?.lineNumber ?? null,
    });
  });
  page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error).slice(0, 2000)));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!window.cuppingElectron?.rbac?.authenticateDeveloper && !!window.SafeRender, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const stage = { name: stageName, consoleMessages, pageErrors, startedAt: new Date().toISOString() };
  report.stages.push(stage);
  return { app, page, stage };
}

async function invoke(page, fn) {
  try { return { threw: false, value: await page.evaluate(fn) }; }
  catch (error) { return { threw: true, error: String(error?.message || error) }; }
}

async function authenticateDeveloper(page) {
  return page.evaluate(async (password) => {
    const api = window.cuppingElectron;
    await api.rbac.clearSession();
    const authenticated = await api.rbac.authenticateDeveloper(password);
    if (!authenticated?.ok || !authenticated.proof) return { authenticated, bound: null, session: null };
    const bound = await api.rbac.bindSession({ userId: '__dev__', role: 'admin', authProof: authenticated.proof });
    const session = await api.rbac.getSession();
    return { authenticated, bound, session };
  }, developerPassword);
}

async function runProtectedIpcMatrix(page) {
  const matrix = await page.evaluate(async ({ bindings, developerPassword: password }) => {
    const api = window.cuppingElectron;
    const RBAC_DENIAL = /rbac_(?:session_required|role_denied|rank_denied|permission_denied|channel_unregistered)|authentication_proof_required/i;
    function resolveApi(bindingPath) {
      return bindingPath.reduce((value, key) => value?.[key], api);
    }
    async function invoke(binding) {
      const fn = resolveApi(binding.path);
      if (typeof fn !== 'function') return { outcome: 'missing_api', error: binding.path.join('.') };
      try {
        const value = await Promise.race([
          Promise.resolve(fn()),
          new Promise((resolve) => setTimeout(() => resolve({ __p0aTimeout: true }), binding.timeoutMs || 10000)),
        ]);
        if (value?.__p0aTimeout) return { outcome: 'timeout' };
        return { outcome: 'returned', value };
      } catch (error) {
        return { outcome: 'threw', error: String(error?.message || error) };
      }
    }
    function denied(result) {
      return RBAC_DENIAL.test(String(result?.error || result?.value?.error || ''));
    }
    async function runAll(label) {
      const rows = [];
      for (const binding of bindings) {
        const result = await invoke(binding);
        rows.push({ channel: binding.channel, path: binding.path.join('.'), result, rbacDenied: denied(result) });
      }
      return { label, rows };
    }

    await api.rbac.clearSession();
    const unauthenticated = await runAll('unauthenticated');

    const lowAuth = await api.rbac.authenticateUser({ userId: 'p0a-reception', role: 'reception', password: '1234' });
    const lowBind = lowAuth?.proof
      ? await api.rbac.bindSession({ userId: 'p0a-reception', role: 'reception', authProof: lowAuth.proof })
      : null;
    const lowRole = await runAll('low-role');

    await api.rbac.clearSession();
    const ownerAuth = await api.rbac.authenticateUser({ userId: 'p0a-owner', role: 'owner', password: '1234' });
    const ownerBind = ownerAuth?.proof
      ? await api.rbac.bindSession({ userId: 'p0a-owner', role: 'owner', authProof: ownerAuth.proof })
      : null;
    const authorizedOwner = await runAll('authorized-owner');

    // A small, explicit subset of the protected surface is Developer/Admin
    // only. Validate those channels with the real trusted Developer proof,
    // while keeping Owner as the authorized subject for every other policy.
    await api.rbac.clearSession();
    const developerAuth = await api.rbac.authenticateDeveloper(password);
    const developerBind = developerAuth?.proof
      ? await api.rbac.bindSession({ userId: '__dev__', role: 'admin', authProof: developerAuth.proof })
      : null;
    const developerOnlyBindings = bindings.filter((binding) =>
      Array.isArray(binding.policy?.roles) && binding.policy.roles.includes('admin'));
    const authorizedDeveloper = { label: 'authorized-developer', rows: [] };
    for (const binding of developerOnlyBindings) {
      const result = await invoke(binding);
      authorizedDeveloper.rows.push({
        channel: binding.channel,
        path: binding.path.join('.'),
        result,
        rbacDenied: denied(result),
      });
    }
    const developerRows = new Map(authorizedDeveloper.rows.map((row) => [row.channel, row]));
    const authorized = {
      label: 'authorized-by-explicit-policy',
      rows: authorizedOwner.rows.map((row) => developerRows.get(row.channel) || row),
    };

    return {
      unauthenticated,
      lowRole,
      authorized,
      authorizedOwner,
      authorizedDeveloper,
      lowAuth,
      lowBind,
      ownerAuth,
      ownerBind,
      developerAuth,
      developerBind,
    };
  }, { bindings: protectedIpcBindings, developerPassword });

  const unauthenticatedPass = matrix.unauthenticated.rows.every((row) => row.rbacDenied === true);
  const lowRolePass = matrix.lowRole.rows.every((row) => {
    const policy = protectedIpcBindings.find((binding) => binding.channel === row.channel);
    return policy.lowRoleExpected
      ? !row.rbacDenied && !['missing_api', 'timeout'].includes(row.result.outcome)
      : row.rbacDenied;
  });
  const authorizedPass = matrix.authorized.rows.every((row) => {
    const binding = protectedIpcBindings.find((item) => item.channel === row.channel);
    const reachedInteractiveDialog = binding?.interactiveDialog === true && row.result.outcome === 'timeout';
    return !row.rbacDenied
      && row.result.outcome !== 'missing_api'
      && (row.result.outcome !== 'timeout' || reachedInteractiveDialog);
  });
  return {
    channelCount: protectedIpcBindings.length,
    bindings: protectedIpcBindings,
    unauthenticatedPass,
    lowRolePass,
    authorizedPass,
    ...matrix,
  };
}

async function renderPayloadCorpus(page, stageName, restored) {
  const result = await page.evaluate(async ({ xssPayload, fromRestore }) => {
    window.__p0aXss = 0;
    window.__p0aPayload = xssPayload;
    const surfaces = {};
    function status(id) {
      const host = document.getElementById(id);
      return {
        exists: !!host,
        scripts: host?.querySelectorAll?.('script').length || 0,
        inlineHandlers: host?.querySelectorAll?.('[onerror],[onload],[onclick]').length || 0,
      };
    }

    try {
      window.eval(`users = users.filter(u => u.id !== 'p0a-xss-user'); users.push({id:'p0a-xss-user',fullName:globalThis.__p0aPayload,username:'p0a-xss-user',role:'reception',active:true,empNum:globalThis.__p0aPayload}); renderUsersList()`);
      surfaces.users = status('usersListContainer');
    } catch (error) { surfaces.users = { error: String(error) }; }

    try {
      window.eval(`doctors = doctors.filter(d => d.id !== 'p0a-xss-doctor'); doctors.push({id:'p0a-xss-doctor',name:globalThis.__p0aPayload,specialty:globalThis.__p0aPayload,salary:0,housing:0,transport:0,otRate:0,active:true}); refreshDoctorsTable()`);
      surfaces.doctors = status('doctorsTableBody');
    } catch (error) { surfaces.doctors = { error: String(error) }; }

    try {
      window.eval(`clientsRegistry = clientsRegistry.filter(c => c.id !== 'p0a-xss-client'); clientsRegistry.push({id:'p0a-xss-client',name:globalThis.__p0aPayload,phone:'0500000000',nationality:globalThis.__p0aPayload,active:true,createdAt:new Date().toISOString()}); refreshClientsView(true)`);
      surfaces.clients = status('clientsTableBody');
    } catch (error) { surfaces.clients = { error: String(error) }; }

    try {
      const host = document.getElementById('owner-hub-body');
      if (host) host.innerHTML = `<section data-p0a-ownerhub>${xssPayload}</section>`;
      surfaces.ownerHub = status('owner-hub-body');
    } catch (error) { surfaces.ownerHub = { error: String(error) }; }

    try {
      openReportPreview(`<table><tbody><tr><td>${xssPayload}</td></tr></tbody></table>`, xssPayload);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const frame = document.getElementById('reportPreviewFrame');
      const frameDoc = frame?.contentDocument;
      surfaces.reports = {
        exists: !!frame,
        sandbox: frame?.getAttribute('sandbox') === 'allow-same-origin',
        scripts: frameDoc?.querySelectorAll?.('script').length || 0,
        inlineHandlers: frameDoc?.querySelectorAll?.('[onerror],[onload],[onclick]').length || 0,
      };
    } catch (error) { surfaces.reports = { error: String(error) }; }

    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      restored: fromRestore,
      executionCount: Number(window.__p0aXss || 0),
      surfaces,
      suspiciousResources: [...document.querySelectorAll('[src],[href]')]
        .filter((element) => /(?:^|\/)x$/i.test(element.getAttribute('src') || element.getAttribute('href') || ''))
        .map((element) => element.outerHTML.slice(0, 500)),
      safeRenderMetrics: { ...(window.SafeRender?.metrics || {}) },
    };
  }, { xssPayload: payload, fromRestore: restored });
  check(`${stageName}:stored-xss-execution-zero`, result.executionCount === 0, result, stageName);
  check(`${stageName}:entity-renderers-strip-executable-markup`, Object.values(result.surfaces).every((surface) => !surface.error && !surface.inlineHandlers && !surface.scripts && !surface.srcdocHasScript) && result.suspiciousResources.length === 0, result, stageName);
  check(`${stageName}:report-preview-sandboxed`, result.surfaces.reports?.sandbox === true, result.surfaces.reports, stageName);
  return result;
}

async function firstRun() {
  const { app, page, stage } = await launch('first-run');
  try {
    const cleanErrorBaseline = stage.consoleMessages.filter((item) => item.type === 'error').length;
    check('first-run:no-load-page-errors', stage.pageErrors.length === 0, stage.pageErrors, 'first-run');
    check('first-run:no-load-console-errors', cleanErrorBaseline === 0, stage.consoleMessages.filter((item) => item.type === 'error'), 'first-run');

    const forged = await page.evaluate(async () => {
      const api = window.cuppingElectron;
      await api.rbac.clearSession();
      const dev = await api.rbac.bindSession({ userId: '__dev__', role: 'admin', branchScope: ['*'] });
      const owner = await api.rbac.bindSession({ userId: '3', role: 'owner', branchScope: ['*'] });
      return { dev, owner, session: await api.rbac.getSession() };
    });
    check('forged-dev-bind-denied', forged.dev?.ok === false && !forged.session?.session, forged, 'first-run');
    check('forged-owner-bind-denied', forged.owner?.ok === false, forged.owner, 'first-run');

    const preAuthCloud = await page.evaluate(async () => {
      const api = window.cuppingElectron;
      async function attempt(call) {
        try { return { threw: false, value: await call() }; }
        catch (error) { return { threw: true, error: String(error?.message || error) }; }
      }
      return {
        generic: await attempt(() => api.backup.uploadCloud({ arbitrary: true }, '../arbitrary.json', 'google', { remotePath: '../arbitrary.json' })),
        constrainedInvalid: await attempt(() => api.backup.uploadActivationArtifact({ centerId: '../bad', signature: 'fake' }, '../arbitrary.json', 'google')),
      };
    });
    const cloudDenied = (attempt) => attempt?.threw || attempt?.value?.ok === false;
    check('preauth-generic-cloud-upload-denied', cloudDenied(preAuthCloud.generic), preAuthCloud.generic, 'first-run');
    check('preauth-constrained-activation-rejects-invalid-path-payload', cloudDenied(preAuthCloud.constrainedInvalid), preAuthCloud.constrainedInvalid, 'first-run');

    const permissions = await page.evaluate(async () => {
      async function query(name) {
        try { return { state: (await navigator.permissions.query({ name })).state }; }
        catch (error) { return { deniedByException: true, error: String(error?.name || error) }; }
      }
      let media = { unavailable: true };
      if (navigator.mediaDevices?.getUserMedia) {
        try {
          await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
          media = { granted: true };
        } catch (error) {
          media = { granted: false, error: String(error?.name || error) };
        }
      }
      return { geolocation: await query('geolocation'), camera: await query('camera'), microphone: await query('microphone'), media };
    });
    check('runtime-permissions-deny-camera-microphone-geolocation',
      ['denied', undefined].includes(permissions.geolocation?.state)
        && ['denied', undefined].includes(permissions.camera?.state)
        && ['denied', undefined].includes(permissions.microphone?.state)
        && permissions.media?.granted !== true,
      permissions, 'first-run');

    const dev = await authenticateDeveloper(page);
    check('intentional-developer-password-authentication', dev.authenticated?.ok === true && !!dev.authenticated?.proof, dev.authenticated, 'first-run');
    check('intentional-developer-proof-bind', dev.bound?.ok === true && dev.session?.session?.userId === '__dev__', dev, 'first-run');
    const developerBranch = await page.evaluate(() => window.cuppingElectron.rbac.setWriteBranch('BR-MAIN'));
    check('intentional-developer-explicit-write-branch', developerBranch?.ok === true, developerBranch, 'first-run');

    const seeded = await page.evaluate(() => window.cuppingElectron.database.hydrate());
    check('stored-payload-corpus-persisted',
      seeded?.ok === true
        && seeded.data?.users?.some((item) => item.id === 'p0a-xss-user')
        && seeded.data?.clientsRegistry?.some((item) => item.id === 'p0a-xss-client')
        && seeded.data?.doctors?.some((item) => item.id === 'p0a-xss-doctor')
        && seeded.data?.cases?.some((item) => item.id === 'p0a-xss-case'),
      seeded?.status,
      'first-run');

    const lowRole = await page.evaluate(async () => {
      const api = window.cuppingElectron;
      await api.rbac.clearSession();
      const authenticated = await api.rbac.authenticateUser({ userId: 'p0a-reception', role: 'reception', password: '1234' });
      const bound = authenticated?.proof
        ? await api.rbac.bindSession({ userId: 'p0a-reception', role: 'reception', authProof: authenticated.proof })
        : null;
      async function attempt(call) {
        try { return { threw: false, value: await call() }; }
        catch (error) { return { threw: true, error: String(error?.message || error) }; }
      }
      const users = await attempt(() => api.database.persistKv('users', []));
      const settings = await attempt(() => api.database.persistKv('settings', { compromised: true }));
      const license = await attempt(() => api.cache.writeLicense('P0A-CENTER', { compromised: true }));
      const branchPack = await attempt(() => api.cache.writeBranchConfig('P0A-CENTER', 'P0A-BRANCH', { users: [] }));
      const unknownSurface = typeof api.invoke === 'undefined' && typeof api.ipcRenderer === 'undefined';
      const session = await api.rbac.getSession();
      return { authenticated, bound, users, settings, license, branchPack, unknownSurface, session };
    });
    const denied = (attempt) => attempt?.threw || attempt?.value?.ok === false;
    check('low-role-protected-kv-denied', denied(lowRole.users) && denied(lowRole.settings), lowRole, 'first-run');
    check('low-role-license-and-branch-cache-denied', denied(lowRole.license) && denied(lowRole.branchPack), lowRole, 'first-run');
    check('preload-has-no-generic-ipc-surface', lowRole.unknownSurface === true, lowRole, 'first-run');
    check('legacy-user-password-upgraded-in-main', /^pbkdf2v2:/.test(String(lowRole.authenticated?.passwordHash || '')), lowRole.authenticated, 'first-run');

    const ipcCoverage = await runProtectedIpcMatrix(page);
    report.ipcCoverage = ipcCoverage;
    check('ipc-protected-channels-unauthenticated-denied-100-percent', ipcCoverage.unauthenticatedPass, ipcCoverage, 'first-run');
    check('ipc-protected-channels-low-role-policy-result-100-percent', ipcCoverage.lowRolePass, ipcCoverage, 'first-run');
    check('ipc-protected-channels-authorized-subject-reaches-handler-100-percent', ipcCoverage.authorizedPass, ipcCoverage, 'first-run');

    // The matrix intentionally reaches the real Owner-only persistent-license
    // wipe handler. Reload the isolated renderer so subsequent UI scenarios
    // rehydrate from authoritative SQLite instead of using its cleared stores.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.cuppingElectron?.rbac?.authenticateDeveloper && !!window.SafeRender, null, { timeout: 120000 });
    await page.waitForTimeout(1200);
    const legacyBranchState = await page.evaluate(() => window.LegacyBranchMigration?.detectLegacyRecords?.());
    check('post-ipc-matrix-sqlite-rehydrate-has-no-legacy-branch-records', legacyBranchState?.legacyTotal === 0, legacyBranchState, 'first-run');
    await page.evaluate(() => window.cuppingElectron.rbac.clearSession());
    const uiLogin = await page.evaluate(async (password) => {
      if (window.SetupStateDom) window.SetupStateDom.needsBootFlow = () => false;
      if (window.BootFlow) window.BootFlow.needsBootScreen = () => false;
      const role = document.getElementById('login-role');
      const user = document.getElementById('login-username');
      const input = document.getElementById('login-password');
      role.value = 'admin';
      filterLoginUsers();
      user.value = [...user.options].find((option) => option.value)?.value || '1';
      input.value = password;
      let loginError = null;
      try { await doLogin(); } catch (error) { loginError = String(error?.message || error); }
      return {
        session: await window.cuppingElectron.rbac.getSession(),
        currentUser: window.currentUser ? { id: window.currentUser.id, role: window.currentUser.role, isDev: window.currentUser.isDev } : null,
        loginHidden: document.getElementById('loginScreen')?.classList.contains('hidden'),
        loginError,
        legacyBranchState: window.LegacyBranchMigration?.detectLegacyRecords?.(),
      };
    }, developerPassword);
    check('intentional-developer-existing-ui-flow',
      uiLogin.session?.session?.userId === '__dev__'
        && uiLogin.currentUser?.isDev === true
        && uiLogin.loginHidden
        && uiLogin.loginError == null,
      uiLogin,
      'first-run');

    await renderPayloadCorpus(page, 'first-run', false);

    const printMarker = path.join(profileRoot, 'P0A-PRINT-PAYLOAD-EXECUTED.txt');
    const printResult = await page.evaluate(async ({ marker, xssPayload }) => {
      const markerJs = JSON.stringify(marker);
      const hostile = `<!DOCTYPE html><html><body><h1>P0A PRINT</h1>${xssPayload}<script>require('fs').writeFileSync(${markerJs},'executed')</script></body></html>`;
      async function attempt(call) {
        try { return { threw: false, value: await call() }; }
        catch (error) { return { threw: true, error: String(error?.message || error) }; }
      }
      const thermal = await attempt(() => window.cuppingElectron.devices.printThermal(hostile, { isFullDocument: true, printerName: '__P0A_MISSING_PRINTER__' }));
      const a4 = await attempt(() => window.cuppingElectron.devices.printA4(hostile, { isFullDocument: true, printerName: '__P0A_MISSING_PRINTER__' }));
      return { thermal, a4 };
    }, { marker: printMarker, xssPayload: payload });
    await page.waitForTimeout(800);
    check('print-payload-execution-zero', !fs.existsSync(printMarker), printResult, 'first-run');
    check('thermal-and-a4-secure-window-path-ran', !!printResult.thermal && !!printResult.a4, printResult, 'first-run');

    const pdfPath = path.join(profileRoot, 'P0A-NATIVE-SAFE.pdf');
    if (fs.existsSync(pdfPath)) fs.rmSync(pdfPath, { force: true });
    const saveDialog = acceptNativePdfSaveDialog();
    const pdfExportPromise = page.evaluate(async ({ marker, xssPayload, outputWithoutExtension }) => {
      const markerJs = JSON.stringify(marker);
      const hostile = `<!DOCTYPE html><html><body><h1>P0A NATIVE PDF</h1>${xssPayload}<script>require('fs').writeFileSync(${markerJs},'executed')</script></body></html>`;
      try {
        const value = await window.cuppingElectron.devices.exportA4Pdf(hostile, {
          isFullDocument: true,
          documentTitle: outputWithoutExtension,
        });
        return { outcome: 'returned', value };
      } catch (error) {
        return { outcome: 'threw', error: String(error?.message || error) };
      }
    }, {
      marker: printMarker,
      xssPayload: payload,
      outputWithoutExtension: pdfPath.slice(0, -4),
    });
    const pdfExport = await Promise.race([
      pdfExportPromise,
      new Promise((resolve) => setTimeout(() => resolve({ outcome: 'timeout' }), 55000)),
    ]);
    const saveDialogResult = await Promise.race([
      saveDialog.completion,
      new Promise((resolve) => setTimeout(() => resolve({ exitCode: null, error: 'automation_timeout' }), 3000)),
    ]);
    if (saveDialogResult.exitCode == null && !saveDialog.child.killed) saveDialog.child.kill();
    await page.waitForTimeout(800);
    const pdfBytes = fs.existsSync(pdfPath) ? fs.readFileSync(pdfPath) : Buffer.alloc(0);
    const nativePdf = {
      pdfExport,
      saveDialog: saveDialogResult,
      path: pdfPath,
      exists: fs.existsSync(pdfPath),
      size: pdfBytes.length,
      magic: pdfBytes.subarray(0, 5).toString('ascii'),
      payloadMarkerExists: fs.existsSync(printMarker),
    };
    check(
      'native-save-as-pdf-hostile-document-generated-safely',
      pdfExport?.value?.ok === true
        && nativePdf.exists
        && nativePdf.size > 1000
        && nativePdf.magic === '%PDF-'
        && nativePdf.payloadMarkerExists === false
        && saveDialogResult.exitCode === 0,
      nativePdf,
      'first-run'
    );

    const secret = `P0A-API-SECRET-${Date.now()}`;
    const patientMessage = `P0A-PATIENT-MESSAGE-${Date.now()}`;
    const queueRuntime = await page.evaluate(async ({ apiSecret, message }) => {
      const api = window.cuppingElectron;
      const saved = await api.communication.saveCredentials({ providers: [{ id: 'p0a-provider', apiKey: apiSecret, secret: apiSecret }], webhookSecret: apiSecret });
      const config = { communication: { queue: { enabled: true }, providers: [{ id: 'p0a-provider', slug: 'custom', baseUrl: 'http://127.0.0.1:9', channels: ['whatsapp'], active: true }] } };
      const sent = await api.communication.send(config, { channel: 'whatsapp', phone: '966500000001', message, allowQueue: true });
      const status = await api.communication.getCredentialStatus();
      return { saved, sent, status };
    }, { apiSecret: secret, message: patientMessage });
    await page.waitForTimeout(500);
    const userData = runtimeUserData;
    const vaultFile = path.join(userData, 'SecurityVault', 'communication-credentials.json');
    const queueFile = path.join(userData, 'communication-queue.json');
    const vaultRaw = fs.existsSync(vaultFile) ? fs.readFileSync(vaultFile, 'utf8') : '';
    const queueRaw = fs.existsSync(queueFile) ? fs.readFileSync(queueFile, 'utf8') : '';
    check('communication-secret-encrypted-at-rest', queueRuntime.status?.ok === true && vaultRaw && !vaultRaw.includes(secret), { queueRuntime, vaultFile }, 'first-run');
    check('communication-queue-encrypted-at-rest', queueRaw && !queueRaw.includes(patientMessage) && !queueRaw.includes('966500000001'), { queueRuntime, queueFile, queuePrefix: queueRaw.slice(0, 120) }, 'first-run');

    const throttle = await page.evaluate(async () => {
      const api = window.cuppingElectron;
      await api.rbac.clearSession();
      const attempts = [];
      for (let i = 0; i < 5; i += 1) attempts.push(await api.rbac.authenticateUser({ userId: 'p0a-missing', role: 'reception', password: 'wrong' }));
      return attempts;
    });
    check('authentication-failure-threshold-reached', throttle.length === 5 && throttle.every((item) => item?.ok === false), throttle, 'first-run');

    const inlineStart = stage.consoleMessages.length;
    const csp = await page.evaluate(async () => {
      window.__p0aInline = 0;
      const script = document.createElement('script');
      script.textContent = 'window.__p0aInline += 1';
      document.body.appendChild(script);
      const button = document.createElement('button');
      button.setAttribute('onclick', 'window.__p0aInline += 10');
      document.body.appendChild(button);
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { executed: window.__p0aInline };
    });
    const cspMessages = stage.consoleMessages.slice(inlineStart).filter((item) => /content security policy|refused to execute inline/i.test(item.text));
    check('csp-blocks-inline-script-and-handler', csp.executed === 0 && cspMessages.length >= 1, { csp, cspMessages }, 'first-run');
    check('first-run:no-unhandled-page-errors-after-injection', stage.pageErrors.length === 0, stage.pageErrors, 'first-run');
  } finally {
    stage.finishedAt = new Date().toISOString();
    await app.close().catch(() => {});
  }
}

async function restartRun() {
  const { app, page, stage } = await launch('restart-retest');
  try {
    const state = await page.evaluate(async () => {
      const api = window.cuppingElectron;
      const session = await api.rbac.getSession();
      const forged = await api.rbac.bindSession({ userId: '__dev__', role: 'admin', branchScope: ['*'] });
      const throttle = await api.rbac.authenticateUser({ userId: 'p0a-missing', role: 'reception', password: 'wrong' });
      return {
        session,
        forged,
        throttle,
      };
    });
    check('restart-main-session-not-restored-from-renderer-storage', !state.session?.session, state.session, 'restart-retest');
    check('restart-forged-dev-still-denied', state.forged?.ok === false, state.forged, 'restart-retest');
    check('restart-authentication-throttle-persists', state.throttle?.error === 'auth_rate_limited', state.throttle, 'restart-retest');

    const dev = await authenticateDeveloper(page);
    check('restart-intentional-developer-login-still-works', dev.bound?.ok === true && dev.session?.session?.userId === '__dev__', dev, 'restart-retest');
    await page.evaluate(() => window.cuppingElectron.rbac.setWriteBranch('BR-MAIN'));
    const persisted = await page.evaluate(async () => {
      const hydrated = await window.cuppingElectron.database.hydrate();
      return {
        users: Array.isArray(hydrated?.data?.users) ? hydrated.data.users.length : null,
        doctors: Array.isArray(hydrated?.data?.doctors) ? hydrated.data.doctors.length : null,
        cases: Array.isArray(hydrated?.data?.cases) ? hydrated.data.cases.length : null,
      };
    });
    check('restart-stored-payload-corpus-present', Number(persisted.users) >= 2 && Number(persisted.doctors) >= 1 && Number(persisted.cases) >= 1, persisted, 'restart-retest');
    await renderPayloadCorpus(page, 'restart-retest', true);
    check('restart:no-unhandled-page-errors', stage.pageErrors.length === 0, stage.pageErrors, 'restart-retest');
    const unexpectedErrors = stage.consoleMessages.filter((item) => item.type === 'error' && !/content security policy|refused to execute inline/i.test(item.text));
    check('restart:no-unexpected-console-errors', unexpectedErrors.length === 0, unexpectedErrors, 'restart-retest');
  } finally {
    stage.finishedAt = new Date().toISOString();
    await app.close().catch(() => {});
  }
}

(async () => {
  try {
    report.fixture = seedRuntimeFixture();
    await firstRun();
    await restartRun();
  } catch (error) {
    report.fatal = String(error?.stack || error);
  }
  report.finishedAt = new Date().toISOString();
  report.result = !report.fatal && report.checks.length > 0 && report.checks.every((item) => item.pass) ? 'PASS' : 'FAIL';
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`P0-A runtime ${report.result}: ${report.checks.filter((item) => item.pass).length}/${report.checks.length}`);
  console.log(outputPath);
  if (report.result !== 'PASS') {
    for (const item of report.checks.filter((entry) => !entry.pass)) console.error(`FAIL ${item.name}: ${JSON.stringify(item.detail)}`);
    if (report.fatal) console.error(report.fatal);
    process.exit(1);
  }
})().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
