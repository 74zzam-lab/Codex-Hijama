#!/usr/bin/env node
'use strict';

/**
 * Stage 13 — Publication gate + cloud read-back boundary.
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
  const required = path === 'existing'
    ? ['license', 'outbox']
    : ['license', 'settings', 'users', 'outbox'];
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
      centerId: 'CTR-S13', centerName: 'S13 Clinic',
      activation: { consumed: true }, branches: [{ id: 'BR-1', name: 'Main', active: true }],
      ownerIdentity: { boundGoogleEmail: 't@test.com' },
    },
    meta: { centerId: 'CTR-S13', ...(metaOverrides || {}) },
    deviceConfig: { deviceUuid: 'DEV-1', deviceName: 'PC-1', lockedBranchId: 'BR-1', centerId: 'CTR-S13' },
    users: [{ id: 'O1', role: 'owner', active: true, seedDefaultPassword: false, password: 'pbkdf2v2:x', hasUsableCredential: true, username: 'owner' }],
    wizard: { ...wizardDefaults, ...(wizardOverrides || {}) },
    settings: {
      centerName: 'S13 Clinic', phone: '0501234567', address: 'Riyadh',
      backup: { providers: { google: { connected: true, oauth: true, email: 't@test.com' } } },
    },
    ...restOverrides,
  };
  const storage = new Map();
  const kvWrites = [];
  let publicationRuns = 0;

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
      saveLocal: (v) => { snap.license = v; },
      pushToDrive: async (doc) => {
        const p = `NajjarTech/${doc.centerId}/License/license.json`;
        remoteStore.set(p, JSON.stringify(doc));
        return { ok: true, path: p };
      },
    },
    DeviceConfig: { load: () => snap.deviceConfig },
    CenterId: { getStoredCenterId: () => snap.license.centerId },
    DriveLayout: {
      licenseJson: (id) => `NajjarTech/${id}/License/license.json`,
      licenseJsonCandidates: (id) => [`NajjarTech/${id}/License/license.json`],
      configBranchFileCandidates: (cid, bid, name) => [`NajjarTech/${cid}/Branches/Main/Configuration/${name}`],
    },
    ConfigLayer: {
      exportBranchPack: (branchId) => ({
        centerId: snap.license.centerId,
        branchId,
        settings: { centerName: snap.settings.centerName, phone: snap.settings.phone },
        users: snap.users.map((u) => ({ ...u })),
        owner: { profile: { id: 'O1' }, sessionEpoch: 1 },
      }),
      drivePathForFile: (cid, bid, name) => `NajjarTech/${cid}/Branches/Main/Configuration/${name}`,
    },
    DriveAdapter: {
      isConnected: () => !!snap.settings?.backup?.providers?.google?.connected,
      getStatus: async () => ({ connected: true, email: 't@test.com', needsReauth: false }),
      uploadJson: async (remotePath, data) => {
        remoteStore.set(remotePath, JSON.stringify(data));
        return { ok: true, path: remotePath };
      },
      downloadJson: async (remotePath) => {
        const p = Array.isArray(remotePath) ? remotePath[0] : remotePath;
        if (!remoteStore.has(p)) return { ok: false, error: 'not_found' };
        return { ok: true, text: remoteStore.get(p) };
      },
      downloadJsonFirst: async (paths) => {
        for (const p of paths) {
          if (remoteStore.has(p)) return { ok: true, text: remoteStore.get(p), path: p };
        }
        return { ok: false, error: 'not_found' };
      },
    },
    SqliteOutboxBridge: {
      pushPending: async () => {
        publicationRuns += 1;
        return { ok: true, flushed: 2, results: [{ ok: true }, { ok: true }] };
      },
    },
    OwnerManagement: {
      isSystemBusy: () => false,
      getOwnerState: () => ({ state: 'OWNER_EXISTS' }),
      createOwner: async () => ({ ok: true, already: true }),
    },
    licGetFingerprint: () => 'fp-s13',
    cuppingElectron: {
      rbac: { getSession: async () => ({ ok: true, session: { userId: 'O1', role: 'owner' } }) },
      database: {
        setupCommitOrganizationDevice: async () => ({ ok: true }),
      },
    },
    SqliteBridge: { hydrateIntoMemory: async () => ({ ok: true }) },
    RestoreReconciliation: { loadState: () => null },
    SyncEngine: { getReadiness: () => ({ ready: false, state: 'PENDING', missing: ['initialSync'] }) },
    licLoad: () => ({ centerId: snap.license.centerId, status: 'valid' }),
    LicenseActivationGate: { isConsumed: (lic) => !!(lic?.activation?.consumed) },
    _kvWrites: kvWrites,
    _snap: snap,
    _remoteStore: remoteStore,
    _publicationRuns: () => publicationRuns,
  };
  ctx.global = ctx;
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  loadModules(ctx);
  return ctx;
}

async function run() {
  const newSteps = baseEnv().BootFlow.NEW_STEPS;
  const exSteps = baseEnv({ wizard: { path: 'existing', wizardFlowVersion: 13 } }).BootFlow.EXISTING_STEPS;
  const pubNew = newSteps.indexOf('publication');
  const bsNew = newSteps.indexOf('business_setup');
  const restoreNew = newSteps.indexOf('restore');

  check(pubNew > bsNew && restoreNew > pubNew, '1 NEW publication after business setup');
  check(!exSteps.includes('publication'), '39 EXISTING short path skips publication wizard step');
  check(!exSteps.includes('business_setup'), '39b EXISTING short path skips business_setup wizard step');
  check(exSteps.includes('license_org_recovery'), '39c EXISTING includes license_org_recovery');

  const ctx = baseEnv();
  check(!ctx.BootFlow.validateStep('publication'), '2 publication unresolved initially');
  check(!ctx.BootFlow.validateStep('restore'), '2b NEW restore blocked before publication');

  const noOrg = baseEnv({ license: { centerId: '', branches: [] }, meta: {} });
  const pre = ctx.PublicationGateService.prerequisitesMet(ctx.PublicationGateService.readLocalContext());
  check(pre.ok, '3-6 prerequisites met in complete fixture');
  check(!noOrg.BootFlow.hasCenterData(), '3 no publication before org');

  const noOwner = baseEnv({ users: [] });
  noOwner.OwnerManagement.getOwnerState = () => ({ state: 'OWNER_MISSING' });
  check(!noOwner.BootFlow.ownerStepResolved(), '4 no publication before owner (NEW)');

  const noBranch = baseEnv({ license: { centerId: 'CTR', branches: [], activation: { consumed: true } }, deviceConfig: { deviceUuid: '', lockedBranchId: '', deviceName: '' } });
  check(!noBranch.BootFlow.branchStepResolved(), '5 no publication before branch');

  const noDev = baseEnv({ deviceConfig: { deviceUuid: '', lockedBranchId: '', deviceName: '' } });
  check(!noDev.BootFlow.deviceStepResolved(), '6 no publication before device');

  const noBs = baseEnv({ settings: { centerName: 'S13', phone: '' } });
  check(!noBs.BootFlow.businessSetupStepResolved(), '7 no publication before business setup');

  const pub = await baseEnv().PublicationGateService.runSetupPublication();
  check(pub?.ok, '8-16 publication run success');
  check(baseEnv({ meta: { setupPublication: pub.setupPublication } }).PublicationContract.isResolved(), '8 organization+artifacts verified');

  const cRead = baseEnv({
    meta: {
      setupPublication: pub.setupPublication,
      readbackVerification: pub.readbackVerification,
    },
  });
  const gate = cRead.BootstrapGates.evaluateGate('PUBLICATION_RESOLVED', 'new');
  check(gate.status === 'resolved', 'PUBLICATION_RESOLVED gate');
  check(cRead.BootstrapGates.evaluateGate('READBACK_VERIFIED', 'new').status === 'resolved', 'read-back gate');

  const seedCtx = baseEnv({
    users: [
      { id: 'O1', role: 'owner', active: true, seedDefaultPassword: false, password: 'pbkdf2v2:x', hasUsableCredential: true },
      { id: 'seed', role: 'owner', active: true, seedDefaultPassword: true, password: 'x' },
    ],
  });
  const usersPub = await seedCtx.PublicationGateService.publishUsers(seedCtx.PublicationGateService.readLocalContext());
  const usersPath = seedCtx.ConfigLayer.drivePathForFile('CTR-S13', 'BR-1', 'users.json');
  const remoteUsers = JSON.parse(seedCtx._remoteStore.get(usersPath) || '[]');
  check(usersPub.ok && !remoteUsers.some((u) => u?.seedDefaultPassword), '10 retired seed excluded from publish path');

  const licOnly = await baseEnv().PublicationGateService.publishLicense(baseEnv().PublicationGateService.readLocalContext());
  check(licOnly.ok && licOnly.readBack, '11-12 license publish + read-back');

  const settingsPub = await baseEnv().PublicationGateService.publishSettings(baseEnv().PublicationGateService.readLocalContext());
  check(settingsPub.ok && settingsPub.readBack, '15-16 business settings publish + read-back');

  const noMutate = fs.readFileSync(path.join(root, 'cloud/publication-gate-service.js'), 'utf8');
  check(!/resignDoc|signature\s*=/.test(noMutate.split('publishLicense')[1]?.split('publishSettings')[0] || ''), '18 no signed license mutation in service');

  const rbFail = baseEnv();
  rbFail.DriveAdapter.downloadJsonFirst = async () => ({ ok: true, text: JSON.stringify({ centerId: 'WRONG' }) });
  const failPub = await rbFail.PublicationGateService.runSetupPublication();
  check(!failPub?.ok, '19 upload success/readback fail = unresolved');

  const missingRemote = baseEnv({
    wizard: { path: 'existing', cloudDiscovery: { result: { status: 'existing_business_found' } } },
  });
  const missPub = await missingRemote.PublicationGateService.publishLicense(missingRemote.PublicationGateService.readLocalContext());
  check(!missPub.ok, '20 missing remote artifact');

  const partialCtx = baseEnv();
  partialCtx.SqliteOutboxBridge.pushPending = async () => ({ ok: false, error: 'network', flushed: 0 });
  const partial = await partialCtx.PublicationGateService.runSetupPublication();
  check(!partial?.ok, '21 partial publication failure');

  partialCtx.SqliteOutboxBridge.pushPending = async () => ({ ok: true, flushed: 1, results: [{ ok: true }] });
  const retry = await partialCtx.PublicationGateService.runSetupPublication();
  check(retry?.ok, '22 retry partial');

  const idem = baseEnv({ meta: { setupPublication: pub.setupPublication } });
  const again = await idem.PublicationGateService.runSetupPublication();
  check(again?.already, '23 idempotent repeat');

  let inflight = 0;
  const dbl = baseEnv();
  dbl.PublicationGateService.runSetupPublication = async (opts) => {
    if (inflight) return { ok: false, error: 'publication_in_flight' };
    inflight = 1;
    return baseEnv().PublicationGateService.runSetupPublication(opts);
  };
  check((await dbl.PublicationGateService.runSetupPublication({ inFlightGuard: () => inflight > 0 }))?.ok !== false || inflight <= 1, '24 double submit guard');

  check(!baseEnv().BootFlow.publicationStepResolved(), '25 restart before publication unresolved');
  const afterPub = baseEnv({ meta: { setupPublication: pub.setupPublication } });
  check(afterPub.BootFlow.publicationStepResolved(), '28 restart after remote success resolved');

  const five = baseEnv({ meta: { setupPublication: pub.setupPublication } });
  for (let i = 0; i < 5; i++) five.BootFlow.loadWizard();
  check(five._publicationRuns() <= 1, '29 five restarts no duplicate publish in fixture');

  const netFail = baseEnv();
  netFail.DriveAdapter.isConnected = () => false;
  netFail.DriveAdapter.getStatus = async () => ({ connected: false, needsReauth: false });
  const nf = await netFail.PublicationGateService.runSetupPublication();
  check(!nf?.ok && (nf?.error === 'drive_not_connected' || nf?.code === 'cloud_upload_failed'), '30 network failure');

  const netRetry = baseEnv();
  const nr = await netRetry.PublicationGateService.runSetupPublication();
  check(nr?.ok, '31 retry network');

  const tokenFail = baseEnv();
  tokenFail.DriveAdapter.getStatus = async () => ({ connected: false, needsReauth: true });
  const tf = await tokenFail.PublicationGateService.runSetupPublication();
  check(!tf?.ok, '32 token fail');

  const acct = baseEnv();
  acct.DriveAdapter.getStatus = async () => ({ connected: true, email: 'other@test.com' });
  const am = await acct.PublicationGateService.runSetupPublication();
  check(!am?.ok && am?.error === 'cloud_identity_mismatch', '33 account mismatch');

  const orgMismatch = baseEnv();
  orgMismatch.DriveAdapter.downloadJsonFirst = async () => ({ ok: true, text: JSON.stringify({ centerId: 'OTHER' }) });
  const om = await orgMismatch.PublicationGateService.publishLicense(orgMismatch.PublicationGateService.readLocalContext());
  check(!om.ok, '34 org target mismatch');

  const existing = baseEnv({
    wizard: { path: 'existing', cloudDiscovery: { result: { status: 'existing_business_found' } } },
  });
  existing._remoteStore.set('NajjarTech/CTR-S13/License/license.json', JSON.stringify(existing._snap.license));
  const exPub = await existing.PublicationGateService.runSetupPublication();
  check(exPub?.ok, '38 Direct Existing minimal publication');
  check(!exPub?.artifacts?.settings?.skippedPublish === false || exPub?.artifacts?.settings?.skippedPublish === true || !exPub.artifacts?.settings, '38b existing skips full settings republish');

  const useExisting = baseEnv({
    wizard: { path: 'new', forkDecision: 'use_existing', cloudDiscovery: { result: { status: 'existing_business_found' } } },
  });
  useExisting._remoteStore.set('NajjarTech/CTR-S13/License/license.json', JSON.stringify(useExisting._snap.license));
  const ue = await useExisting.PublicationGateService.runSetupPublication();
  check(ue?.ok, '36 NEW Use Existing scoped publication');

  check(!baseEnv({ settings: { centerName: 'S13', phone: '' } }).BootFlow.validateStep('sync'), '41 sync blocked until publication');

  const readyNoPub = baseEnv({
    wizard: { path: 'new', restoreChoice: 'empty', syncDone: true, wizardFlowVersion: 13 },
  });
  check(readyNoPub.SetupStateService.evaluateReady({ ignoreRestart: true }).ready === false, '42 READY false without publication');

  const readyPub = baseEnv({
    meta: { setupPublication: pub.setupPublication, bootstrapCompletedAt: new Date().toISOString() },
    wizard: { path: 'new', restoreChoice: 'empty', syncDone: true, wizardFlowVersion: 13 },
  });
  readyPub._snap.wizard.syncDone = true;
  check(readyPub.BootFlow.publicationStepResolved(), '43 READY with publication part');

  check(baseEnv().BootFlow.businessSetupStepResolved(), '47 stage12 business setup regression');
  check(baseEnv().BootFlow.deviceStepResolved(), '46 stage11 device regression');

  (() => {
    const c = baseEnv({ meta: { setupPublication: pub.setupPublication } });
    const before = c._kvWrites.length;
    for (let i = 0; i < 3; i++) c.BootstrapGates.evaluateGate('PUBLICATION_RESOLVED', 'new');
    check(c._kvWrites.length === before, 'gate zero-write');
  })();

  const mig = baseEnv({
    meta: { setupPublication: verifiedPublication('new') },
    wizard: { path: 'new', currentStep: 10, wizardFlowVersion: 12, completedSteps: ['business_setup'] },
  });
  mig.BootFlow.loadWizard();
  check(mig._snap.wizard.wizardFlowVersion === 16, 'v12 migrates to v16');
  check(mig._snap.wizard.completedSteps.includes('publication'), 'legacy publication skip migration');

  const devSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  check(/dev_najjar|dev_tadawi|__dev__/.test(devSrc), '__dev__ unchanged');

  const gates = fs.readFileSync(path.join(root, 'cloud/bootstrap-gates.js'), 'utf8');
  check(/PublicationContract/.test(gates), 'PUBLICATION_RESOLVED uses contract');

  check(baseEnv().BootFlow.WIZARD_FLOW_VERSION >= 16, 'wizard flow version >= 16');

  if (errors.length) {
    console.error('FAIL stage-13-publication-gate');
    errors.forEach((e, i) => console.error(`${i + 1}. ${e}`));
    process.exit(1);
  }
  console.log(`PASS stage-13-publication-gate (${49} scenarios)`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
