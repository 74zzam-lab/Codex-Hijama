#!/usr/bin/env node
'use strict';

/**
 * External Existing-customer bootstrap authority regressions.
 *
 * Written failing-first against the defects reported from a real installed
 * Windows journey:
 *
 *  BUG-ORG/BRANCH  branch_select auto-completed with no operator click, then
 *                  device registration used BR-MAIN that nobody chose.
 *  BUG-BACKUP      restore failed with a generic message because the real
 *                  Main-process cause does not survive Electron IPC.
 *  BUG-NO-RESTORE  "بدء قاعدة جديدة" on the EXISTING path resolved the restore
 *                  gate and then demanded an Owner only a restore could supply.
 *  ERROR AUDIT     free-text (IPC wrapper) turned into diagnostic codes.
 *
 * The branch cases drive the REAL cloud/boot-flow-ui.js through the same module
 * graph the renderer loads, because the previous harnesses asserted on source
 * text and therefore could not observe the runtime gate decision.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const failures = [];
let passed = 0;

function check(cond, msg) {
  if (cond) { passed += 1; console.log(`PASS  ${msg}`); } else { failures.push(msg); console.error(`FAIL  ${msg}`); }
}

const BSC = require(path.join(root, 'cloud/business-setup-contract.js'));
const PC = require(path.join(root, 'cloud/publication-contract.js'));
const RVC = require(path.join(root, 'cloud/readback-verification-contract.js'));
const ISC = require(path.join(root, 'cloud/initial-sync-direction-contract.js'));
const ESC = require(path.join(root, 'cloud/existing-short-path-contract.js'));
const BCC = require(path.join(root, 'cloud/bootstrap-checklist-contract.js'));
const IPCERR = require(path.join(root, 'cloud/ipc-error-envelope.js'));

/* ------------------------------------------------------------------ *
 * Minimal DOM + renderer environment (same shape as stage-17 harness)
 * ------------------------------------------------------------------ */
function makeElement(tagOrId) {
  const children = [];
  const attrs = {};
  const classes = new Set();
  let textContent = '';
  const el = {
    id: typeof tagOrId === 'string' && !String(tagOrId).includes(' ') ? tagOrId : '',
    tagName: tagOrId,
    hidden: false,
    style: { cssText: '' },
    className: '',
    value: '',
    dataset: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: () => {},
    },
    appendChild(child) { children.push(child); return child; },
    append(...kids) { children.push(...kids); },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    getAttribute: (k) => attrs[k] ?? null,
    setAttribute: (k, v) => { attrs[k] = v; },
    removeAttribute: (k) => { delete attrs[k]; },
    focus: () => {},
    remove: () => {},
    get children() { return children; },
  };
  Object.defineProperty(el, 'textContent', {
    get: () => textContent,
    set: (v) => { textContent = v; if (v === '') children.length = 0; },
  });
  Object.defineProperty(el, 'innerHTML', { get: () => textContent, set: (v) => { textContent = v; } });
  return el;
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
    createElement: (tag) => makeElement(tag),
  };
}

function loadRuntimeModules(ctx) {
  const files = [
    'cloud/business-setup-contract.js',
    'cloud/publication-contract.js',
    'cloud/readback-verification-contract.js',
    'cloud/initial-sync-direction-contract.js',
    'cloud/existing-short-path-contract.js',
    'cloud/bootstrap-checklist-contract.js',
    'cloud/bootstrap-failure-policy-contract.js',
    'cloud/ipc-error-envelope.js',
    'cloud/ready-pure-evaluator.js',
    'cloud/setup-state-service.js',
    'cloud/bootstrap-coordinator.js',
    'cloud/bootstrap-gates.js',
    'cloud/setup-state-dom.js',
    'cloud/boot-flow-ui.js',
  ];
  for (const rel of files) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
  }
}

/**
 * @param {object} o
 *  licenseBranches   branches inside the recovered cloud license document
 *  discoveryBranches raw branchCandidates from post-Google discovery
 *  deviceConfig      local DeviceConfig (may hold a stale lockedBranchId)
 *  wizard            wizard state overrides
 */
function bootEnv(o = {}) {
  const snap = {
    license: {
      centerId: o.centerId || 'NJR-CLINIC-628E0049',
      centerName: 'Najran Clinic',
      activation: { consumed: true },
      branches: o.licenseBranches || [{ id: 'BR-MAIN', name: 'Main', active: true }],
    },
    meta: { centerId: o.centerId || 'NJR-CLINIC-628E0049' },
    deviceConfig: o.deviceConfig !== undefined ? o.deviceConfig : {},
    users: o.users || [],
    wizard: {
      path: 'existing',
      currentStep: 4,
      lang: 'ar',
      restoreChoice: null,
      syncDone: false,
      completedSteps: ['language', 'google', 'discovery', 'license_org_recovery'],
      wizardFlowVersion: 16,
      discoveryCompletedAt: '2026-08-15T09:00:00.000Z',
      ...(o.wizard || {}),
    },
    settings: {
      centerName: 'Najran Clinic',
      phone: '0500000000',
      backup: { providers: { google: { connected: true, oauth: true, email: o.googleEmail || 'owner@example.com' } } },
    },
  };
  const discovery = {
    ok: true,
    status: 'existing_business_found',
    organizationCandidates: [{ id: snap.license.centerId, centerId: snap.license.centerId }],
    licenseCandidates: [{ centerId: snap.license.centerId, verified: true }],
    backupCandidates: [],
    branchCandidates: o.discoveryBranches || [],
    syncCandidates: [],
  };
  const ctx = {
    console: { info: () => {}, warn: () => {}, error: () => {}, log: () => {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    document: makeDocument(),
    localStorage: (() => {
      const m = new Map();
      return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: (k) => { m.delete(k); },
      };
    })(),
    location: { search: '' },
    confirm: () => true,
    DB: {
      get: (key, fallback) => {
        if (key === '__tdw_boot_wizard__') return snap.wizard;
        if (key === '__tdw_meta__') return snap.meta;
        if (key === '__tdw_cloud_license__') return snap.license;
        if (key === '__tdw_device_config__') return snap.deviceConfig;
        if (key === 'users') return snap.users;
        if (key === 'settings') return snap.settings;
        return fallback === undefined ? null : fallback;
      },
      set: (key, val) => {
        if (key === '__tdw_boot_wizard__') snap.wizard = val;
        if (key === '__tdw_meta__') snap.meta = val;
        if (key === 'settings') snap.settings = val;
        if (key === '__tdw_device_config__') snap.deviceConfig = val;
        return { ok: true };
      },
    },
    users: snap.users,
    settings: snap.settings,
    BusinessSetupContract: BSC,
    PublicationContract: PC,
    ReadbackVerificationContract: RVC,
    InitialSyncDirectionContract: ISC,
    ExistingShortPathContract: ESC,
    BootstrapChecklistContract: BCC,
    LicenseCloud: { loadLocal: () => (snap.license?.centerId ? snap.license : null) },
    DeviceConfig: { load: () => snap.deviceConfig },
    CenterId: { getStoredCenterId: () => snap.license?.centerId || null },
    DriveAdapter: { isConnected: () => true },
    PostGoogleCloudDiscovery: {
      getCachedDiscovery: () => snap._discovery,
      hasDiscoveryResolved: () => true,
      STATUS_EXISTING: 'existing_business_found',
    },
    OwnerManagement: {
      isSystemBusy: () => false,
      getOwnerState: () => (snap.users.some((u) => u.role === 'owner') ? { state: 'OWNER_EXISTS' } : { state: 'NO_OWNER' }),
      isOwnerCreationInProgress: () => false,
    },
    RestoreReconciliation: { loadState: () => null },
    SyncEngine: { getReadiness: () => ({ ready: false, state: 'PENDING', missing: [] }) },
    licLoad: () => snap.license,
    LicenseActivationGate: { isConsumed: (lic) => !!(lic?.activation?.consumed), getConsumeCount: () => 0 },
    _snap: snap,
  };
  snap._discovery = discovery;
  ctx.global = ctx;
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  loadRuntimeModules(ctx);
  return ctx;
}

/* ================================================================== *
 * Defect reproduction, stable API only.
 *
 * These assertions use functions that exist in BOTH the pre-fix and post-fix
 * builds (validateStep / getSelectedBranchId / branchStepResolved) so they fail
 * against the source that shipped in the installed EXE and pass afterwards.
 * They are the executable form of the reported Windows behaviour.
 * ================================================================== */
function defectReproduction() {
  console.log('\n-- REPRO (stable API): reported installed-Windows behaviour --');

  // Reported: cloud recovery produced BR-MAIN, "اختيار الفرع" showed DONE with no
  // click, and the wizard advanced to device registration using BR-MAIN.
  {
    const ctx = bootEnv({
      licenseBranches: [{ id: 'BR-MAIN', name: 'Main', active: true }],
      discoveryBranches: [
        { id: 'BR-MAIN', source: 'license_discovery', verified: true },
        { id: 'BR-MAIN', source: 'data_discovery', verified: false },
      ],
    });
    const BF = ctx.BootFlow;
    check(BF.validateStep('branch_select') === false,
      'REPRO branch: recovered branch must NOT auto-complete branch_select');
    check(BF.getSelectedBranchId() === '',
      'REPRO branch: device step must NOT receive an unchosen BR-MAIN');
    check(BF.branchStepResolved() === false,
      'REPRO branch: branchStepResolved false without operator action');

    const model = BCC.buildChecklistModel(BF.getChecklistUiContext());
    const row = model.items.find((i) => i.id === 'branch_select');
    check(row && row.status === BCC.STATUS.REQUIRED,
      `REPRO branch: checklist row is REQUIRED (got ${row && row.status})`);
  }

  // Reported: stale local BR-MAIN on a new device must not become the branch.
  {
    const ctx = bootEnv({
      licenseBranches: [],
      discoveryBranches: [{ id: 'BR-MAIN', source: 'data_discovery', verified: false }],
      deviceConfig: { lockedBranchId: 'BR-MAIN' },
    });
    const BF = ctx.BootFlow;
    check(BF.getSelectedBranchId() === '',
      'REPRO branch: local-echo-only branch is never selected');
    check(BF.validateStep('branch_select') === false,
      'REPRO branch: local-echo-only branch does not resolve the gate');
  }

  // Reported: restore failed with a generic message + TDW-BOOT-Error-invoking-remote-me.
  {
    const BFPC = require(path.join(root, 'cloud/bootstrap-failure-policy-contract.js'));
    const wrapper = new Error(
      "Error invoking remote method 'backup:v2:setupCloudRestore': Error: setup_restore_requires_empty_database",
    );
    const n = BFPC.normalizeFailure(wrapper);
    check(!/Error-invoking-remote/i.test(String(n.code)),
      `REPRO restore: diagnostic code must not be wrapper text (got ${n.code})`);
    check(n.code === 'TDW-BOOT-RESTORE-DB-NOT-EMPTY',
      `REPRO restore: real Main cause recovered from wrapper (got ${n.code})`);
    check(!/غير متوقع/.test(String(n.message)),
      'REPRO restore: message is not "حدث خطأ غير متوقع"');
  }

  // Reported: restore UI sat at 13% with zero bytes downloaded.
  {
    const discoverySrc = fs.readFileSync(path.join(root, 'cloud/cloud-data-discovery.js'), 'utf8');
    const g = { IpcErrorEnvelope: IPCERR };
    const sandbox = { console, global: g, globalThis: g, window: g, setInterval, clearInterval, setTimeout, clearTimeout };
    vm.runInNewContext(discoverySrc, sandbox);
    const snap = g.CloudDataDiscovery.buildProgressState('download_db', {
      workflow: 'backup_v2', downloadedBytes: 0, totalBytes: 42600,
    });
    check(snap.percent === null,
      `REPRO progress: zero bytes must not render a percent (got ${snap.percent})`);
  }
}

/* ================================================================== *
 * BUG-ORG/BRANCH — the branch gate must never resolve without proof
 * ================================================================== */
function branchTests() {
  console.log('\n-- BUG-ORG/BRANCH: branch gate authority --');

  // 1. Exactly one genuine cloud branch, operator has not chosen it.
  //    The old working build required an explicit bind click even here.
  {
    const ctx = bootEnv({ licenseBranches: [{ id: 'BR-MAIN', name: 'Main', active: true }] });
    const BF = ctx.BootFlow;
    check(BF.eligibleBranchCount() === 1, 'one cloud branch → eligibleBranchCount 1');
    check(BF.validateStep('branch_select') === false,
      'one cloud branch + no click → branch_select NOT resolved');
    check(BF.getSelectedBranchId() === '',
      'one cloud branch + no click → no branch handed to device step');
    check(BF.validateStep('device') === false, 'device step blocked while branch unselected');
  }

  // 2. Two genuine cloud branches, no click.
  {
    const ctx = bootEnv({
      licenseBranches: [
        { id: 'BR-MAIN', name: 'Main', active: true },
        { id: 'BR-2', name: 'Second', active: true },
      ],
    });
    const BF = ctx.BootFlow;
    check(BF.eligibleBranchCount() === 2, 'two cloud branches → eligibleBranchCount 2');
    check(BF.validateStep('branch_select') === false, 'two cloud branches + no click → REQUIRED');
  }

  // 3. Duplicate evidence for the SAME branch (license + data_discovery echo).
  //    This is the reported "فروع: 2" case: two candidates, one real branch.
  {
    const ctx = bootEnv({
      licenseBranches: [{ id: 'BR-MAIN', name: 'Main', active: true }],
      discoveryBranches: [
        { id: 'BR-MAIN', source: 'license_discovery', verified: true },
        { id: 'BR-MAIN', source: 'data_discovery', verified: false },
      ],
    });
    const BF = ctx.BootFlow;
    check(BF.eligibleBranchCount() === 1, 'duplicate evidence de-duplicates to 1 branch');
    check(BF.validateStep('branch_select') === false,
      'duplicate evidence + no click → still REQUIRED (no count-based shortcut)');
    const diag = BF.branchGateDiagnostics();
    check(diag.discoveryCandidates.length === 2 && diag.eligibleBranchCount === 1,
      'diagnostics separate raw evidence (2) from eligible branches (1)');
  }

  // 4. data_discovery echo ONLY — a stale local BR-MAIN must not invent a branch.
  {
    const ctx = bootEnv({
      licenseBranches: [],
      discoveryBranches: [{ id: 'BR-MAIN', source: 'data_discovery', verified: false }],
      deviceConfig: { lockedBranchId: 'BR-MAIN' },
    });
    const BF = ctx.BootFlow;
    check(BF.eligibleBranchCount() === 0,
      'local data_discovery echo alone is not a cloud-authorized branch');
    check(BF.validateStep('branch_select') === false, 'echo-only → branch_select unresolved');
    check(BF.branchGateDiagnostics().reason === 'no_cloud_authorized_branch',
      'diagnostics report no cloud-authorized branch');
  }

  // 5. Stale lockedBranchId with NO completed device registration must not
  //    silently inherit the old device's branch.
  {
    const ctx = bootEnv({
      licenseBranches: [{ id: 'BR-MAIN', name: 'Main', active: true }, { id: 'BR-2', active: true }],
      deviceConfig: { lockedBranchId: 'BR-MAIN' },
    });
    const BF = ctx.BootFlow;
    check(BF.validateStep('branch_select') === false,
      'stale lockedBranchId without device registration → no inherited selection');
    check(BF.getSelectedBranchId() === '', 'stale lockedBranchId yields no selected branch');
  }

  // 6. Explicit operator selection resolves the gate with provenance=user.
  {
    const ctx = bootEnv({
      licenseBranches: [{ id: 'BR-MAIN', active: true }, { id: 'BR-2', active: true }],
    });
    const BF = ctx.BootFlow;
    ctx.document.getElementById('bf-branch-id').value = 'BR-2';
    return Promise.resolve(BF.selectExistingBranchOnly()).then((res) => {
      check(res?.ok === true && res.provenance === 'user', 'explicit click records provenance=user');
      check(BF.getSelectedBranchId() === 'BR-2', 'explicit click selects the clicked branch');
      check(BF.validateStep('branch_select') === true, 'explicit click resolves branch_select');
      check(BF.currentBranchSelection()?.branchId === 'BR-2', 'selection persisted');
    });
  }
}

function branchTestsPart2() {
  console.log('\n-- BUG-ORG/BRANCH: invalidation --');

  // 7. A selection made while only ONE branch was known must be invalidated
  //    synchronously when discovery later reports TWO — before any render.
  {
    const ctx = bootEnv({ licenseBranches: [{ id: 'BR-MAIN', active: true }] });
    const BF = ctx.BootFlow;
    ctx.document.getElementById('bf-branch-id').value = 'BR-MAIN';
    return Promise.resolve(BF.selectExistingBranchOnly()).then(() => {
      check(BF.validateStep('branch_select') === true, 'baseline: single-branch explicit selection resolves');
      // Discovery/recovery now reveals a second authorized branch.
      ctx._snap.license.branches = [{ id: 'BR-MAIN', active: true }, { id: 'BR-2', active: true }];
      // Still provable: the operator did click BR-MAIN and it is still eligible.
      check(BF.validateStep('branch_select') === true,
        'growing branch set keeps a still-valid explicit selection');

      // But an organization change must invalidate it.
      ctx._snap.license.centerId = 'OTHER-CENTER';
      ctx._snap.meta.centerId = 'OTHER-CENTER';
      check(BF.validateStep('branch_select') === false,
        'organization change invalidates the branch selection');
      const ui = BF.getChecklistUiContext();
      const model = BCC.buildChecklistModel(ui);
      const row = model.items.find((i) => i.id === 'branch_select');
      check(row && row.status !== BCC.STATUS.DONE,
        'checklist row is not DONE after invalidation (reconcile ran before render)');
    });
  }
}

function branchTestsPart3() {
  console.log('\n-- BUG-ORG/BRANCH: google account change + resume --');

  // 8. Changing Google account invalidates a prior selection.
  {
    const ctx = bootEnv({ licenseBranches: [{ id: 'BR-MAIN', active: true }, { id: 'BR-2', active: true }] });
    const BF = ctx.BootFlow;
    ctx.document.getElementById('bf-branch-id').value = 'BR-MAIN';
    return Promise.resolve(BF.selectExistingBranchOnly()).then(() => {
      check(BF.validateStep('branch_select') === true, 'baseline selection valid');
      ctx._snap.settings.backup.providers.google.email = 'other@example.com';
      check(BF.validateStep('branch_select') === false,
        'Google account change invalidates the branch selection');
    });
  }
}

function branchTestsPart4() {
  console.log('\n-- BUG-ORG/BRANCH: legitimate resume --');

  // 9. A device that already completed registration in THIS org stays valid
  //    across restart without re-selecting (matches old build's device bind).
  {
    const ctx = bootEnv({
      licenseBranches: [{ id: 'BR-MAIN', active: true }, { id: 'BR-2', active: true }],
      deviceConfig: {
        deviceUuid: 'DEV-9', deviceName: 'Reception-PC',
        lockedBranchId: 'BR-2', centerId: 'NJR-CLINIC-628E0049',
      },
      wizard: { branchSelection: undefined },
    });
    const BF = ctx.BootFlow;
    check(BF.validateStep('branch_select') === true,
      'already-registered device keeps branch resolved after restart');
    check(BF.getSelectedBranchId() === 'BR-2', 'resumed branch comes from the device registration');

    // ...but not when that device belongs to a different organization.
    ctx._snap.deviceConfig.centerId = 'SOME-OTHER-ORG';
    check(BF.validateStep('branch_select') === false,
      'device bound to another organization does not resolve the branch gate');
  }

  // 10. Legacy wizard state cannot forge a selection.
  {
    const ctx = bootEnv({
      licenseBranches: [{ id: 'BR-MAIN', active: true }, { id: 'BR-2', active: true }],
      wizard: {
        branchExplicitlySelected: true,
        pendingBranchId: 'BR-MAIN',
        completedSteps: ['language', 'google', 'discovery', 'license_org_recovery', 'branch_select'],
      },
    });
    const BF = ctx.BootFlow;
    check(BF.validateStep('branch_select') === false,
      'legacy branchExplicitlySelected + completedSteps do not prove selection');
  }
}

/* ================================================================== *
 * BUG-BACKUP-RESTORE + ERROR AUDIT — IPC fidelity
 * ================================================================== */

/**
 * Reproduce Electron's actual behaviour: `ipcRenderer.invoke` rejects in the
 * renderer with a NEW Error. Only `message` crosses; `code` and every other
 * custom property are dropped. Previous harnesses stubbed the bridge with a
 * plain async function that threw rich objects, so this loss was never tested.
 */
function simulateElectronInvoke(channel, mainHandler) {
  return async (...args) => {
    try {
      return await mainHandler(...args);
    } catch (error) {
      throw new Error(`Error invoking remote method '${channel}': Error: ${error.message}`);
    }
  };
}

function ipcTests() {
  console.log('\n-- BUG-BACKUP-RESTORE: Main cause must survive IPC --');

  const { encodeIpcError } = IPCERR;
  const BFPC = require(path.join(root, 'cloud/bootstrap-failure-policy-contract.js'));
  const discoverySrc = fs.readFileSync(path.join(root, 'cloud/cloud-data-discovery.js'), 'utf8');

  // Load cloud-data-discovery with the envelope available, to exercise the real
  // restoreErrorCode() used by the restore path.
  const g = {
    IpcErrorEnvelope: IPCERR,
    BootstrapFailurePolicyContract: BFPC,
    LicenseCloud: { loadLocal: () => ({ centerId: 'C1', branches: [{ id: 'BR-MAIN' }] }) },
    DeviceConfig: { load: () => ({ lockedBranchId: 'BR-MAIN' }) },
  };
  const sandbox = { console, global: g, globalThis: g, window: g, setInterval, clearInterval, setTimeout, clearTimeout };
  sandbox.global = g;
  vm.runInNewContext(discoverySrc, sandbox);
  const CD = g.CloudDataDiscovery;

  const cases = [
    ['setup_restore_requires_empty_database', 'TDW-BOOT-RESTORE-DB-NOT-EMPTY'],
    ['backup_password_required', 'TDW-BOOT-RESTORE-PASSWORD'],
    ['cloud_download_failed', 'TDW-BOOT-RESTORE-DOWNLOAD'],
    ['empty_cloud_backup', 'TDW-BOOT-RESTORE-EMPTY-FILE'],
    ['needs_reauth', 'TDW-BOOT-RESTORE-REAUTH'],
    ['legacy_backup_envelope_invalid', 'TDW-BOOT-RESTORE-LEGACY-ENVELOPE'],
    ['invalid_remote_backup_path', 'TDW-BOOT-RESTORE-REMOTE-PATH'],
  ];

  return (async () => {
    for (const [mainCode, expectedDiagnostic] of cases) {
      const invoke = simulateElectronInvoke('backup:v2:setupCloudRestore', async () => {
        const err = new Error(encodeIpcError(mainCode, { op: 'SRT-test', stage: 'target_classified' }));
        err.code = mainCode;
        throw err;
      });
      let caught = null;
      try { await invoke({ setupMode: true }); } catch (e) { caught = e; }

      check(caught != null && caught.code === undefined,
        `[${mainCode}] IPC boundary really does drop error.code`);

      // Exercise the production classifier used by the restore path.
      const recovered = CD.restoreErrorCode(caught);
      check(recovered === mainCode, `[${mainCode}] real cause recovered across IPC`);

      const normalized = BFPC.normalizeFailure({ ok: false, error: recovered });
      check(normalized.code === expectedDiagnostic,
        `[${mainCode}] normalized to ${expectedDiagnostic} (got ${normalized.code})`);
      check(!/Error-invoking-remote/i.test(normalized.code),
        `[${mainCode}] diagnostic code is not the IPC wrapper text`);
      check(normalized.message && !/غير متوقع/.test(normalized.message),
        `[${mainCode}] user message names the cause instead of "unexpected error"`);
    }

    // Regression for the exact observed defect: the wrapper text must never
    // become a diagnostic code, even with no envelope present (older Main).
    const bare = new Error(
      "Error invoking remote method 'backup:v2:setupCloudRestore': Error: Some unmapped failure text",
    );
    const n = BFPC.normalizeFailure(bare);
    check(n.code === 'TDW-BOOT-MAIN-UNREPORTED' || n.code === 'TDW-BOOT-UNCLASSIFIED',
      `unmapped IPC wrapper yields a stable code (got ${n.code})`);
    check(!/Error-invoking-remote-me/.test(n.code),
      'never reproduces the reported TDW-BOOT-Error-invoking-remote-me code');

    // A plain `throw new Error('code')` from an older Main build still decodes.
    const legacy = new Error(
      "Error invoking remote method 'backup:v2:setupCloudRestore': Error: cloud_download_stalled",
    );
    check(IPCERR.decodeIpcError(legacy).code === 'cloud_download_stalled',
      'bare code in wrapper message is still recovered');
  })();
}

/* ================================================================== *
 * Progress honesty — 13% with zero bytes
 * ================================================================== */
function progressTests() {
  console.log('\n-- BUG-BACKUP-RESTORE: progress must not imply byte download --');
  const discoverySrc = fs.readFileSync(path.join(root, 'cloud/cloud-data-discovery.js'), 'utf8');
  const g = { IpcErrorEnvelope: IPCERR };
  const sandbox = { console, global: g, globalThis: g, window: g, setInterval, clearInterval, setTimeout, clearTimeout };
  vm.runInNewContext(discoverySrc, sandbox);
  const CD = g.CloudDataDiscovery;

  // Known expected size, zero received bytes — previously rendered 13%.
  const zero = CD.buildProgressState('download_db', {
    workflow: 'backup_v2', downloadedBytes: 0, totalBytes: 42600,
  });
  check(zero.percent === null, 'zero received bytes → no numeric percent (was 13%)');
  check(zero.indeterminate === true, 'zero received bytes → indeterminate');

  const some = CD.buildProgressState('download_db', {
    workflow: 'backup_v2', downloadedBytes: 5632, totalBytes: 42600,
  });
  check(some.percent != null && some.indeterminate === false,
    'real bytes → determinate percent');
  check(some.downloadedBytes === 5632 && some.totalBytes === 42600,
    'download bytes reported separately from overall restore progress');
  check(`${some.stageIndex}/${some.stageCount}` === '3/9',
    'overall restore stage reported as 3/9 alongside byte counters');
}

/* ================================================================== *
 * BUG-NO-RESTORE/OWNER
 * ================================================================== */
function noRestoreOwnerTests() {
  console.log('\n-- BUG-NO-RESTORE/OWNER: empty start must not create an unreachable owner gate --');

  // EXISTING path, device already registered, no Owner recovered yet
  // (restore failed) — this is exactly the reported sequence.
  {
    const ctx = bootEnv({
      licenseBranches: [{ id: 'BR-MAIN', active: true }],
      users: [],
      deviceConfig: {
        deviceUuid: 'DEV-9', deviceName: 'Reception-PC',
        lockedBranchId: 'BR-MAIN', centerId: 'NJR-CLINIC-628E0049',
      },
    });
    const BF = ctx.BootFlow;
    check(BF.validateStep('device') === true, 'device registered in this org');
    const policy = BF.existingEmptyStartPolicy();
    check(policy.allowed === false, 'EXISTING + no recoverable Owner → empty start refused');
    check(policy.code === 'existing_empty_start_blocked_no_owner', 'refusal carries a specific code');
    check(/المالك/.test(policy.messageAr), 'refusal explains the Owner recovery requirement');

    // The contradictory state must be unreachable: restore resolved while
    // owner_auth can never resolve.
    const wizard = ctx._snap.wizard;
    wizard.restoreChoice = 'empty';
    check(BF.validateStep('restore') === true, 'restore gate would resolve for choice=empty');
    check(BF.ownerAuthStepResolved() === false, 'owner_auth cannot resolve without an Owner');
    check(BF.existingEmptyStartPolicy().allowed === false,
      'policy still refuses, so the UI never offers this dead end');
  }

  // EXISTING path with an Owner already present (e.g. restored) → allowed.
  {
    const ctx = bootEnv({
      licenseBranches: [{ id: 'BR-MAIN', active: true }],
      users: [{
        id: 'O1', role: 'owner', active: true, seedDefaultPassword: false,
        mustChangePassword: false, password: 'pbkdf2v2:x', hasUsableCredential: true,
      }],
    });
    check(ctx.BootFlow.existingEmptyStartPolicy().allowed === true,
      'EXISTING with recovered Owner → empty start permitted');
  }
}

/* ================================================================== *
 * ERROR AUDIT — no known cause may render as a generic message
 * ================================================================== */
function errorAuditTests() {
  console.log('\n-- ERROR AUDIT: every known code owns a specific message --');
  const BFPC = require(path.join(root, 'cloud/bootstrap-failure-policy-contract.js'));
  const registry = BFPC.buildDiagnosticCodeRegistry();
  const rawCodes = Object.keys(registry);
  check(rawCodes.length > 60, `policy registry covers ${rawCodes.length} raw codes`);

  const generic = [];
  const missingCode = [];
  for (const rawCode of rawCodes) {
    const n = BFPC.normalizeFailure({ ok: false, error: rawCode });
    if (!n.message || /غير متوقع|تعذّر إكمال العملية\.$/.test(n.message)) generic.push(rawCode);
    if (!n.code || !/^TDW-BOOT-/.test(n.code)) missingCode.push(rawCode);
    if (n.code === 'TDW-BOOT-UNCLASSIFIED') missingCode.push(rawCode);
  }
  check(generic.length === 0, `no known code yields a generic message (offenders: ${generic.join(', ') || 'none'})`);
  check(missingCode.length === 0, `every known code maps to a stable TDW code (offenders: ${missingCode.join(', ') || 'none'})`);

  // Outcome hygiene: requirement / user-action / cancelled must not be styled
  // as operational failures.
  const req = BFPC.normalizeFailure({ ok: false, error: 'step_required' });
  check(req.userActionRequired === true && req.retryable === false,
    'step_required is USER_ACTION, not a retryable operational error');
  const cancelled = BFPC.normalizeFailure({ ok: false, error: 'restore_cancelled' });
  check(cancelled.cancelled === true && cancelled.fatal === false,
    'cancelled restore is CANCELLED, not FATAL');
  const branchReq = BFPC.normalizeFailure({ ok: false, error: 'branch_selection_required' });
  check(branchReq.userActionRequired === true, 'branch selection is USER_ACTION');
}

/* ================================================================== *
 * BUG-A regression guard (must stay passing)
 * ================================================================== */
function bugARegressionGuard() {
  console.log('\n-- BUG-A guard: Google/RBAC behaviour preserved --');
  const bootSrc = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
  check(/googleSessionConnected/.test(bootSrc), 'Google session latch retained');
  check(/acceptLiveReconnect: true/.test(bootSrc), 'live reconnect acceptance retained');
  check(/فصل \/ تغيير حساب Google/.test(bootSrc), 'Google switch/disconnect action retained');

  const ctx = bootEnv({ licenseBranches: [{ id: 'BR-MAIN', active: true }] });
  const BF = ctx.BootFlow;
  check(BF.hasGoogle() === true, 'connected Google stays connected (no second request)');
  check(BF.validateStep('google') === true, 'google step resolved once connected');
  check(BF.validateStep('discovery') === true, 'discovery stays resolved after Google');
  const model = BCC.buildChecklistModel(BF.getChecklistUiContext());
  const googleRow = model.items.find((i) => i.id === 'google');
  check(googleRow?.status === BCC.STATUS.DONE, 'google checklist row DONE, not red');
  const discoveryRow = model.items.find((i) => i.id === 'discovery');
  check(discoveryRow?.status === BCC.STATUS.DONE, 'discovery checklist row DONE, not red');
}

/* ------------------------------------------------------------------ */
(async function main() {
  try {
    defectReproduction();
    await branchTests();
    await branchTestsPart2();
    await branchTestsPart3();
    await branchTestsPart4();
    await ipcTests();
    progressTests();
    noRestoreOwnerTests();
    errorAuditTests();
    bugARegressionGuard();
  } catch (error) {
    failures.push(`harness crash: ${error && error.stack ? error.stack : error}`);
    console.error(error);
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.error('\nFailing checks:');
    for (const f of failures) console.error(` - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('OK: external existing bootstrap authority regressions');
  }
})();
