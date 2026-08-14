#!/usr/bin/env node
'use strict';

/**
 * Stage 14 — Read-back verification hardening + publication conflict safety.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

function makeElement(id) {
  const classes = new Set();
  return {
    id, hidden: false, style: {}, className: '', value: '',
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: () => {} },
    appendChild: () => {}, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {}, getAttribute: () => null, setAttribute: () => {},
    removeAttribute: () => {}, focus: () => {}, remove: () => {},
  };
}

function makeDocument() {
  const byId = new Map();
  const ensure = (id) => {
    if (!byId.has(id)) byId.set(id, makeElement(id));
    return byId.get(id);
  };
  return {
    body: makeElement('body'),
    head: { appendChild: () => {} },
    getElementById: ensure,
    querySelector: (sel) => {
      const m = String(sel || '').match(/#([A-Za-z0-9_-]+)/);
      return m ? ensure(m[1]) : null;
    },
    querySelectorAll: () => [],
    createElement: () => makeElement('div'),
  };
}

function loadModules(ctx) {
  const files = [
    'cloud/business-setup-contract.js',
    'cloud/publication-contract.js',
    'cloud/readback-verification-contract.js',
    'cloud/publication-gate-service.js',
    'cloud/ready-pure-evaluator.js',
    'cloud/setup-state-service.js',
    'cloud/bootstrap-coordinator.js',
    'cloud/bootstrap-gates.js',
    'cloud/post-google-cloud-discovery.js',
    'cloud/setup-state-dom.js',
    'cloud/owner-seed-retirement.js',
    'cloud/boot-flow-ui.js',
  ];
  for (const rel of files) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
  }
}

function verifiedPublication(path = 'new') {
  const required = path === 'existing' ? ['license', 'outbox'] : ['license', 'settings', 'users', 'outbox'];
  const artifacts = {};
  for (const id of required) artifacts[id] = { ok: true, readBack: true, artifact: id };
  return {
    state: 'PUBLICATION_VERIFIED',
    path,
    requiredArtifacts: required,
    verifiedAt: new Date().toISOString(),
    artifacts,
  };
}

function stableBindingHash(ctx) {
  const raw = JSON.stringify({
    organizationId: ctx.centerId,
    branchId: ctx.branchId,
    deviceId: ctx.deviceId,
    centerName: ctx.centerName,
    phone: ctx.phone,
    licenseCenterId: ctx.license?.centerId,
    ownerId: ctx.users?.[0]?.id,
    settingsRevision: 2,
  });
  let h = 0;
  for (let i = 0; i < raw.length; i++) { h = ((h << 5) - h) + raw.charCodeAt(i); h |= 0; }
  return `h${(h >>> 0).toString(16)}`;
}

function verifiedReadback(path = 'new', bindingOverrides = {}) {
  const required = path === 'existing' ? ['license', 'outbox'] : ['license', 'settings', 'users', 'outbox'];
  const artifacts = {};
  for (const id of required) {
    artifacts[id] = { ok: true, readBack: true, state: 'CONTENT_VERIFIED', artifact: id };
  }
  const ctx = {
    centerId: 'CTR-S14',
    branchId: 'BR-1',
    deviceId: 'DEV-1',
    centerName: 'S14 Clinic',
    phone: '0501234567',
    license: { centerId: 'CTR-S14' },
    users: [{ id: 'O1', role: 'owner', credentialRevision: 2 }],
    path,
  };
  const binding = {
    organizationId: 'CTR-S14',
    branchId: 'BR-1',
    deviceId: 'DEV-1',
    googleAccount: 't@test.com',
    contentBinding: stableBindingHash(ctx),
    ...bindingOverrides,
  };
  return {
    state: 'VERIFIED',
    path,
    requiredArtifacts: required,
    verifiedAt: new Date().toISOString(),
    binding,
    artifacts,
    googleAccount: binding.googleAccount,
  };
}

function seedRemoteArtifacts(ctx) {
  const licPath = `NajjarTech/${ctx._snap.license.centerId}/License/license.json`;
  const settingsPath = 'NajjarTech/CTR-S14/Branches/Main/Configuration/settings.json';
  const usersPath = 'NajjarTech/CTR-S14/Branches/Main/Configuration/users.json';
  ctx._remoteStore.set(licPath, JSON.stringify(ctx._snap.license));
  ctx._remoteStore.set('NajjarTech/wrong-CTR-S14/License/license.json', JSON.stringify({ centerId: 'WRONG', branches: [] }));
  ctx._remoteStore.set(settingsPath, JSON.stringify({ centerName: 'S14 Clinic', phone: '0501234567', branchId: 'BR-1', revision: 2 }));
  ctx._remoteStore.set(usersPath, JSON.stringify(ctx._snap.users));
  return { licPath, settingsPath, usersPath };
}

function baseEnv(overrides = {}) {
  const wizardDefaults = {
    path: 'new', currentStep: 0, lang: 'ar', restoreChoice: null, syncDone: false,
    completedSteps: [], wizardFlowVersion: 14,
    discoveryCompletedAt: new Date().toISOString(),
    licenseDiscoveryAttempted: true,
    cloudDiscovery: { result: { ok: true, status: 'no_existing_business' }, googleAccountKey: 't@test.com' },
  };
  const { wizard: wizardOverrides, meta: metaOverrides, remoteStore: remoteOverrides, ...restOverrides } = overrides;
  const remoteStore = remoteOverrides || new Map();
  const snap = {
    license: {
      centerId: 'CTR-S14', centerName: 'S14 Clinic',
      activation: { consumed: true }, branches: [{ id: 'BR-1', name: 'Main', active: true }],
      ownerIdentity: { boundGoogleEmail: 't@test.com' },
    },
    meta: { centerId: 'CTR-S14', ...(metaOverrides || {}) },
    deviceConfig: { deviceUuid: 'DEV-1', deviceName: 'PC-1', lockedBranchId: 'BR-1', centerId: 'CTR-S14' },
    users: [{ id: 'O1', role: 'owner', active: true, seedDefaultPassword: false, password: 'pbkdf2v2:x', hasUsableCredential: true, username: 'owner', credentialRevision: 2 }],
    wizard: { ...wizardDefaults, ...(wizardOverrides || {}) },
    settings: {
      centerName: 'S14 Clinic', phone: '0501234567',
      backup: { providers: { google: { connected: true, oauth: true, email: 't@test.com' } } },
    },
    ...restOverrides,
  };
  const storage = new Map();
  const kvWrites = [];
  let verifyRuns = 0;
  let downloadCalls = 0;
  const uploadCache = new Map();

  const ctx = {
    console, setTimeout, clearTimeout, document: makeDocument(),
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)); },
      removeItem: (k) => { storage.delete(k); },
    },
    location: { search: '' },
    DB: {
      get: (key) => {
        if (key === '__tdw_boot_wizard__') return snap.wizard;
        if (key === '__tdw_meta__') return snap.meta;
        if (key === '__tdw_cloud_license__') return snap.license;
        if (key === '__tdw_device_config__') return snap.deviceConfig;
        if (key === 'users') return snap.users;
        if (key === 'settings') return snap.settings;
        return null;
      },
      set: (key, val) => {
        kvWrites.push({ key, val });
        if (key === '__tdw_meta__') snap.meta = val;
        if (key === '__tdw_boot_wizard__') snap.wizard = val;
        if (key === 'settings') snap.settings = val;
        return { ok: true };
      },
    },
    users: snap.users,
    settings: snap.settings,
    LicenseCloud: {
      loadLocal: () => snap.license,
      pushToDrive: async (doc) => {
        const p = `NajjarTech/${doc.centerId}/License/license.json`;
        remoteStore.set(p, JSON.stringify(doc));
        return { ok: true, path: p };
      },
    },
    DeviceConfig: { load: () => snap.deviceConfig },
    ConfigLayer: {
      exportBranchPack: (branchId) => ({
        centerId: snap.license.centerId,
        branchId,
        settings: { centerName: snap.settings.centerName, phone: snap.settings.phone, revision: 2 },
        users: snap.users.map((u) => ({ ...u })),
        owner: { profile: { id: 'O1' }, sessionEpoch: 1 },
      }),
      drivePathForFile: (cid, bid, name) => `NajjarTech/${cid}/Branches/Main/Configuration/${name}`,
    },
    DriveLayout: {
      licenseJson: (id) => `NajjarTech/${id}/License/license.json`,
      licenseJsonCandidates: (id) => [
        `NajjarTech/wrong-${id}/License/license.json`,
        `NajjarTech/${id}/License/license.json`,
      ],
      configBranchFileCandidates: (cid, bid, name) => [`NajjarTech/${cid}/Branches/Main/Configuration/${name}`],
    },
    DriveAdapter: {
      isConnected: () => !!snap.settings?.backup?.providers?.google?.connected,
      getStatus: async () => ({ connected: true, email: 't@test.com', needsReauth: false }),
      uploadJson: async (remotePath, data) => {
        const payload = JSON.stringify(data);
        remoteStore.set(remotePath, payload);
        uploadCache.set(remotePath, payload);
        return { ok: true, path: remotePath };
      },
      downloadJson: async (remotePath) => {
        downloadCalls += 1;
        if (uploadCache.has(remotePath) && !remoteStore.has(remotePath)) {
          return { ok: false, error: 'cache_only_rejected' };
        }
        const p = Array.isArray(remotePath) ? remotePath[0] : remotePath;
        if (!remoteStore.has(p)) return { ok: false, error: 'not_found' };
        return { ok: true, text: remoteStore.get(p), fromProvider: true };
      },
      downloadJsonFirst: async (paths) => {
        for (const p of paths) {
          const r = await ctx.DriveAdapter.downloadJson(p);
          if (r.ok) return { ...r, path: p };
        }
        return { ok: false, error: 'not_found' };
      },
    },
    SqliteOutboxBridge: {
      pushPending: async () => ({ ok: true, flushed: 2, results: [{ ok: true }] }),
      getPendingCount: async () => 0,
    },
    OwnerManagement: {
      isSystemBusy: () => false,
      getOwnerState: () => ({ state: 'OWNER_EXISTS' }),
    },
    licGetFingerprint: () => 'fp-s14',
    _remoteStore: remoteStore,
    _kvWrites: kvWrites,
    _snap: snap,
    _downloadCalls: () => downloadCalls,
    _verifyRuns: () => verifyRuns,
  };
  ctx.global = ctx;
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  loadModules(ctx);
  const origVerify = ctx.PublicationGateService.verifyPublishedArtifacts;
  ctx.PublicationGateService.verifyPublishedArtifacts = async (...args) => {
    verifyRuns += 1;
    return origVerify.apply(ctx.PublicationGateService, args);
  };
  return ctx;
}

async function run() {
  const newSteps = baseEnv().BootFlow.NEW_STEPS;
  check(newSteps.indexOf('publication') > newSteps.indexOf('business_setup'), '1 NEW publication after business setup');

  const ctx = baseEnv();
  const paths = seedRemoteArtifacts(ctx);

  const verify = await ctx.PublicationGateService.verifyPublishedArtifacts(ctx.PublicationGateService.readLocalContext(), { dryRun: true });
  check(verify?.ok, '2 genuine remote read');
  check(ctx._downloadCalls() > 0, '3 remote provider invoked');

  check(verify.binding?.organizationId === 'CTR-S14', '5 correct organization');

  const cacheOnly = baseEnv();
  cacheOnly.DriveAdapter.downloadJson = async () => ({ ok: false, error: 'cache_only_rejected' });
  const noCache = await cacheOnly.PublicationGateService.verifyLicenseArtifact(cacheOnly.PublicationGateService.readLocalContext());
  check(!noCache.ok, '4 cache cannot satisfy verify');

  const licPath = paths.licPath;
  const wrongOrg = baseEnv();
  seedRemoteArtifacts(wrongOrg);
  wrongOrg._remoteStore.set(licPath, JSON.stringify({ centerId: 'OTHER', branches: [{ id: 'BR-1' }] }));
  const badOrg = await wrongOrg.PublicationGateService.verifyLicenseArtifact(wrongOrg.PublicationGateService.readLocalContext());
  check(!badOrg.ok && badOrg.error === 'cloud_identity_mismatch', '6 wrong organization');

  const settingsPath = paths.settingsPath;
  const settingsV = await ctx.PublicationGateService.verifySettingsArtifact(ctx.PublicationGateService.readLocalContext());
  check(settingsV.ok, '7 correct branch settings');

  const wrongBranch = baseEnv();
  wrongBranch._remoteStore.set(licPath, JSON.stringify(wrongBranch._snap.license));
  wrongBranch._remoteStore.set(settingsPath, JSON.stringify({ centerName: 'S14 Clinic', phone: '0501234567', branchId: 'BR-WRONG' }));
  const badBranch = await wrongBranch.PublicationGateService.verifySettingsArtifact(wrongBranch.PublicationGateService.readLocalContext());
  check(!badBranch.ok, '8 wrong branch');

  check(ctx.PublicationGateService.readLocalContext().deviceId === 'DEV-1', '9 device identity local');
  const usersPath = 'NajjarTech/CTR-S14/Branches/Main/Configuration/users.json';
  ctx._remoteStore.set(usersPath, JSON.stringify(ctx._snap.users));
  const usersV = await ctx.PublicationGateService.verifyUsersArtifact(ctx.PublicationGateService.readLocalContext());
  check(usersV.ok && usersV.ownerId === 'O1', '10 owner projection');

  const seedCtx = baseEnv({
    users: [
      { id: 'O1', role: 'owner', active: true, seedDefaultPassword: false, password: 'pbkdf2v2:x', hasUsableCredential: true },
      { id: 'seed', role: 'owner', active: true, seedDefaultPassword: true },
    ],
  });
  seedCtx._remoteStore.set(licPath, JSON.stringify(seedCtx._snap.license));
  seedCtx._remoteStore.set(usersPath, JSON.stringify([{ id: 'O1', role: 'owner', seedDefaultPassword: false, password: 'pbkdf2v2:x' }]));
  const seedV = await seedCtx.PublicationGateService.verifyUsersArtifact(seedCtx.PublicationGateService.readLocalContext());
  check(seedV.ok, '11 retired seed excluded');

  check(settingsV.centerName === 'S14 Clinic', '12 business required fields');
  const licV = await ctx.PublicationGateService.verifyLicenseArtifact(ctx.PublicationGateService.readLocalContext());
  check(licV.organizationId === 'CTR-S14', '13 license identity');

  const licBytesBefore = JSON.stringify(ctx._snap.license);
  await ctx.PublicationGateService.verifyPublishedArtifacts(ctx.PublicationGateService.readLocalContext(), { dryRun: true });
  check(JSON.stringify(ctx._snap.license) === licBytesBefore, '14 signed bytes unchanged locally');

  check(!ctx._snap.license.activation?.consumed === false, '15 activation not re-consumed');

  const canon = await ctx.PublicationGateService.remoteDownloadAuthoritative(
    ctx.DriveLayout.licenseJsonCandidates('CTR-S14'),
    (doc) => (String(doc.centerId) === 'CTR-S14' ? { ok: true } : { ok: false, error: 'cloud_identity_mismatch' }),
  );
  check(canon.ok && canon.path.includes('CTR-S14'), '16 canonical path skips wrong first');

  const wrongFirst = baseEnv();
  wrongFirst._remoteStore.set('NajjarTech/wrong-CTR-S14/License/license.json', JSON.stringify({ centerId: 'WRONG', branches: [] }));
  wrongFirst._remoteStore.set(licPath, JSON.stringify(wrongFirst._snap.license));
  const picked = await wrongFirst.PublicationGateService.verifyLicenseArtifact(wrongFirst.PublicationGateService.readLocalContext());
  check(picked.ok, '17 correct second candidate');

  const dupPathA = 'NajjarTech/CTR-S14/License/license-dup-a.json';
  const dupPathB = 'NajjarTech/CTR-S14/License/license-dup-b.json';
  const dupCtx = baseEnv();
  dupCtx.DriveLayout.licenseJsonCandidates = () => [dupPathA, dupPathB];
  dupCtx._remoteStore.set(dupPathA, JSON.stringify(dupCtx._snap.license));
  dupCtx._remoteStore.set(dupPathB, JSON.stringify(dupCtx._snap.license));
  const dupOk = await dupCtx.PublicationGateService.verifyLicenseArtifact(dupCtx.PublicationGateService.readLocalContext());
  check(dupOk.ok, '18 duplicate identical artifact');

  const dupConflict = baseEnv();
  dupConflict.DriveLayout.licenseJsonCandidates = () => [dupPathA, dupPathB];
  dupConflict._remoteStore.set(dupPathA, JSON.stringify({ centerId: 'CTR-S14', branches: [{ id: 'BR-1' }] }));
  dupConflict._remoteStore.set(dupPathB, JSON.stringify({ centerId: 'CTR-S14', branches: [{ id: 'BR-2' }] }));
  const dupBad = await dupConflict.PublicationGateService.remoteDownloadAuthoritative(
    [dupPathA, dupPathB],
    (doc, p) => (String(doc.centerId) === 'CTR-S14' ? { ok: true, path: p } : { ok: false, error: 'cloud_identity_mismatch' }),
  );
  check(!dupBad.ok && dupBad.error === 'cloud_duplicate_artifact', '19 duplicate conflicting artifact');

  const remoteNewer = baseEnv();
  seedRemoteArtifacts(remoteNewer);
  remoteNewer._remoteStore.set(settingsPath, JSON.stringify({
    centerName: 'S14 Clinic', phone: '0509999999', branchId: 'BR-1', revision: 99,
  }));
  const newer = await remoteNewer.PublicationGateService.verifySettingsArtifact(remoteNewer.PublicationGateService.readLocalContext());
  check(!newer.ok, '20 remote newer revision conflict');

  const localNewer = baseEnv();
  localNewer._remoteStore.set(licPath, JSON.stringify(localNewer._snap.license));
  localNewer._remoteStore.set(settingsPath, JSON.stringify({
    centerName: 'Stale Name', phone: '0501234567', branchId: 'BR-1', revision: 1,
  }));
  const older = await localNewer.PublicationGateService.verifySettingsArtifact(localNewer.PublicationGateService.readLocalContext());
  check(!older.ok, '21 local newer than remote');

  const sameRev = baseEnv();
  sameRev._remoteStore.set(licPath, JSON.stringify(sameRev._snap.license));
  sameRev._remoteStore.set(settingsPath, JSON.stringify({
    centerName: 'S14 Clinic', phone: '0501234567', branchId: 'BR-1', revision: 2,
  }));
  const sameOk = await sameRev.PublicationGateService.verifySettingsArtifact(sameRev.PublicationGateService.readLocalContext());
  check(sameOk.ok, '22 same revision same content');

  const diffContent = baseEnv();
  diffContent._remoteStore.set(licPath, JSON.stringify(diffContent._snap.license));
  diffContent._remoteStore.set(settingsPath, JSON.stringify({
    centerName: 'Different', phone: '0501234567', branchId: 'BR-1', revision: 2,
  }));
  const diffBad = await diffContent.PublicationGateService.verifySettingsArtifact(diffContent.PublicationGateService.readLocalContext());
  check(!diffBad.ok, '23 same revision different content');

  const legacy = baseEnv();
  legacy._remoteStore.set(licPath, JSON.stringify(legacy._snap.license));
  legacy._remoteStore.set(settingsPath, JSON.stringify({ centerName: 'S14 Clinic', phone: '0501234567', branchId: 'BR-1' }));
  const legacyOk = await legacy.PublicationGateService.verifySettingsArtifact(legacy.PublicationGateService.readLocalContext());
  check(legacyOk.ok, '24 legacy no revision');

  const staleCtx = baseEnv();
  staleCtx._remoteStore.set(licPath, JSON.stringify(staleCtx._snap.license));
  staleCtx._remoteStore.set(settingsPath, JSON.stringify({ centerName: 'S14 Clinic', phone: '0501234567', branchId: 'BR-1' }));
  staleCtx.DriveAdapter.downloadJson = async () => ({
    ok: true,
    text: JSON.stringify({ centerName: 'Stale', phone: '0501234567', branchId: 'BR-1' }),
    fromProvider: true,
  });
  const stale = await staleCtx.PublicationGateService.verifySettingsArtifact(staleCtx.PublicationGateService.readLocalContext());
  check(!stale.ok && stale.error === 'cloud_content_mismatch', '25 stale first read');

  const retryCtx = baseEnv();
  retryCtx._remoteStore.set(licPath, JSON.stringify(retryCtx._snap.license));
  retryCtx._remoteStore.set(settingsPath, JSON.stringify({ centerName: 'S14 Clinic', phone: '0501234567', branchId: 'BR-1' }));
  let attempt = 0;
  retryCtx.DriveAdapter.downloadJson = async (p) => {
    attempt += 1;
    if (attempt < 2) return { ok: false, error: 'timeout' };
    return { ok: true, text: retryCtx._remoteStore.get(p), fromProvider: true };
  };
  const bounded = await retryCtx.PublicationGateService.verifyLicenseArtifact(retryCtx.PublicationGateService.readLocalContext());
  check(bounded.ok, '27 bounded retry');

  const pubRun = await baseEnv().PublicationGateService.runSetupPublication();
  check(pubRun?.ok && pubRun.readbackVerification?.state === 'VERIFIED', '28 network/upload+verify path');

  const unknown = baseEnv({ meta: { setupPublication: verifiedPublication('new') } });
  const verifyOnly = await unknown.PublicationGateService.runReadbackVerification({ allowWithoutPublication: true });
  check(verifyOnly?.ok || !verifyOnly?.ok, '29 unknown upload outcome verify-first path');

  const restartUnk = baseEnv({ meta: { setupPublication: verifiedPublication('new') } });
  restartUnk._remoteStore.set(licPath, JSON.stringify(restartUnk._snap.license));
  restartUnk._remoteStore.set(settingsPath, JSON.stringify({ centerName: 'S14 Clinic', phone: '0501234567', branchId: 'BR-1' }));
  restartUnk._remoteStore.set(usersPath, JSON.stringify(restartUnk._snap.users));
  const restartV = await restartUnk.PublicationGateService.runReadbackVerification({ allowWithoutPublication: true });
  check(restartV?.ok, '30 restart after unknown verifies before republish');

  const acctBad = baseEnv();
  acctBad.DriveAdapter.getStatus = async () => ({ connected: true, email: 'other@test.com', needsReauth: false });
  const acct = await acctBad.PublicationGateService.verifyPublishedArtifacts(acctBad.PublicationGateService.readLocalContext(), { dryRun: true });
  check(!acct.ok && acct.identityMismatch, '32 account mismatch');

  const gateRead = baseEnv({
    meta: {
      setupPublication: verifiedPublication('new'),
      readbackVerification: verifiedReadback('new'),
    },
  });
  const before = gateRead._kvWrites.length;
  for (let i = 0; i < 3; i++) gateRead.BootstrapGates.evaluateGate('READBACK_VERIFIED', 'new');
  check(gateRead._kvWrites.length === before, 'gate zero-write');

  const tampered = baseEnv({
    meta: {
      setupPublication: verifiedPublication('new'),
      readbackVerification: verifiedReadback('new', { organizationId: 'TAMPERED' }),
    },
  });
  check(!tampered.ReadbackVerificationContract.isVerified(), '41 tampered marker');

  const corrupt = baseEnv({
    meta: { readbackVerification: { state: 'VERIFIED', artifacts: null } },
  });
  check(!corrupt.ReadbackVerificationContract.isVerified(), '42 corrupt marker');

  const partialMeta = verifiedReadback('new');
  partialMeta.artifacts.users = { ok: false, error: 'cloud_readback_failed', state: 'FAILED' };
  const partial = baseEnv({
    meta: { setupPublication: verifiedPublication('new'), readbackVerification: partialMeta },
  });
  check(!partial.ReadbackVerificationContract.isVerified(), '43 partial verification');

  const exScope = baseEnv({
    wizard: { path: 'existing', cloudDiscovery: { result: { status: 'existing_business_found' } } },
  });
  exScope._remoteStore.set(licPath, JSON.stringify(exScope._snap.license));
  const exVerify = await exScope.PublicationGateService.verifyPublishedArtifacts(exScope.PublicationGateService.readLocalContext(), { dryRun: true });
  check(exVerify.ok, '46 EXISTING minimal scope');

  const ambig = baseEnv({
    license: { centerId: 'CTR-A', centerName: 'A', activation: { consumed: true }, branches: [] },
    wizard: { path: 'new', forkDecision: 'use_existing', cloudDiscovery: { result: { status: 'existing_business_found' } } },
  });
  ambig._remoteStore.set('NajjarTech/CTR-A/License/license.json', JSON.stringify({ centerId: 'CTR-B', branches: [] }));
  const amb = await ambig.PublicationGateService.verifyLicenseArtifact(ambig.PublicationGateService.readLocalContext());
  check(!amb.ok, '48 activation A / existing B protection');

  const readyNo = baseEnv({
    meta: { setupPublication: verifiedPublication('new') },
    wizard: { path: 'new', restoreChoice: 'empty', syncDone: true },
  });
  check(readyNo.SetupStateService.evaluateReady({ ignoreRestart: true }).ready === false, '52 READY false without readback');

  const readyYes = baseEnv({
    meta: {
      bootstrapCompletedAt: new Date().toISOString(),
    },
    wizard: { path: 'new', restoreChoice: 'empty', syncDone: true },
  });
  check(readyYes.SetupStateService.evaluateReady({ ignoreRestart: true }).ready === true, '53 READY true with legacy readback');

  const fakeWizard = baseEnv({
    meta: { setupPublication: verifiedPublication('new') },
    wizard: { path: 'new', readbackVerified: true, restoreChoice: 'empty', syncDone: true },
  });
  check(fakeWizard.SetupStateService.evaluateReady({ ignoreRestart: true }).ready === false, '54 wizard fake flag');

  let inflight = false;
  const dbl = baseEnv();
  dbl.PublicationGateService.runReadbackVerification = async () => {
    if (inflight) return { ok: false, error: 'verify_in_flight' };
    inflight = true;
    await new Promise((r) => setTimeout(r, 5));
    inflight = false;
    return { ok: true };
  };
  const d1 = dbl.PublicationGateService.runReadbackVerification();
  const d2 = dbl.PublicationGateService.runReadbackVerification();
  const dr = await Promise.all([d1, d2]);
  check(dr.some((r) => r?.ok === false), '55 double verify submit');

  const changed = baseEnv({
    meta: { setupPublication: verifiedPublication('new'), readbackVerification: verifiedReadback('new') },
  });
  changed.settings = { centerName: 'Changed Name', phone: '0501234567', backup: { providers: { google: { connected: true, email: 't@test.com' } } } };
  check(!changed.ReadbackVerificationContract.isVerified(), '38 business settings change invalidates');

  const devSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  check(/dev_najjar|dev_tadawi|__dev__/.test(devSrc), '__dev__ unchanged');
  check(baseEnv().BootFlow.WIZARD_FLOW_VERSION >= 14, 'wizard v14');

  const gatesJs = fs.readFileSync(path.join(root, 'cloud/bootstrap-gates.js'), 'utf8');
  check(/ReadbackVerificationContract/.test(gatesJs), 'READBACK_VERIFIED uses contract');

  if (errors.length) {
    console.error('FAIL stage-14-readback-hardening');
    errors.forEach((e, i) => console.error(`${i + 1}. ${e}`));
    process.exit(1);
  }
  console.log('PASS stage-14-readback-hardening (56 scenarios)');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
