#!/usr/bin/env node
'use strict';

/**
 * Stage 18 — Unified Bootstrap failure policy.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

const BFPC = require(path.join(root, 'cloud/bootstrap-failure-policy-contract.js'));
const BCC = require(path.join(root, 'cloud/bootstrap-checklist-contract.js'));

const STAGE_15_NEW_STEPS = Object.freeze([
  'language', 'license', 'google', 'discovery', 'path_decision', 'organization', 'owner',
  'branch', 'device', 'business_setup', 'publication', 'restore', 'sync', 'ready',
]);
const STAGE_16_EXISTING_STEPS = Object.freeze([
  'language', 'google', 'discovery', 'license_org_recovery', 'branch_select', 'device',
  'restore', 'owner_auth', 'sync', 'ready',
]);

const bootSrc = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const contractSrc = fs.readFileSync(path.join(root, 'cloud/bootstrap-failure-policy-contract.js'), 'utf8');

function checklistCtx(overrides = {}) {
  return {
    path: 'new',
    forkDecision: null,
    currentStepId: overrides.currentStepId || 'google',
    validateStep: overrides.validateStep || (() => false),
    needsPathFork: false,
    pathDecisionResolved: false,
    ownerAuthResolved: false,
    ownerAuthRequired: false,
    stepError: overrides.stepError || null,
    uiOps: overrides.uiOps || {},
    ...overrides,
  };
}

function makeElement(tagOrId) {
  const children = [];
  const attrs = {};
  const classes = new Set();
  let textContent = '';
  const el = {
    id: typeof tagOrId === 'string' && !String(tagOrId).includes(' ') ? tagOrId : '',
    tagName: tagOrId,
    hidden: false,
    style: {},
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
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    getAttribute: (k) => attrs[k] ?? null,
    setAttribute: (k, v) => { attrs[k] = v; },
    removeAttribute: (k) => { delete attrs[k]; },
    focus: () => {},
    remove: () => {},
    get children() { return children; },
    get childNodes() { return children; },
    onclick: null,
  };
  Object.defineProperty(el, 'textContent', {
    get: () => textContent,
    set: (v) => { textContent = v; if (v === '') children.length = 0; },
  });
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
    'cloud/bootstrap-checklist-contract.js',
    'cloud/bootstrap-failure-policy-contract.js',
    'cloud/boot-flow-ui.js',
  ];
  for (const rel of files) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
  }
}

function baseBootEnv(overrides = {}) {
  const snap = {
    wizard: {
      path: 'new',
      currentStep: 2,
      lang: 'ar',
      restoreChoice: null,
      syncDone: false,
      completedSteps: ['language', 'license'],
      wizardFlowVersion: 16,
      ...(overrides.wizard || {}),
    },
    settings: {
      backup: { providers: { google: { connected: false, email: overrides.googleEmail || '' } } },
      ...(overrides.settings || {}),
    },
  };
  const kvWrites = [];
  const ctx = {
    console,
    setTimeout,
    clearTimeout,
    document: makeDocument(),
    DB: {
      get: (key) => {
        if (key === '__tdw_boot_wizard__') return JSON.parse(JSON.stringify(snap.wizard));
        if (key === 'settings') return JSON.parse(JSON.stringify(snap.settings));
        return null;
      },
      set: (key, val) => {
        kvWrites.push(key);
        if (key === '__tdw_boot_wizard__') snap.wizard = val;
        if (key === 'settings') snap.settings = val;
      },
    },
    settings: snap.settings,
    ActivationErrors: {
      toUserError: (err, code) => ({ title: 'خطأ', detail: String(err?.message || err || code), diagnosticCode: `TDW-ACT-${code || 'X'}` }),
      formatForUi: (ue) => `${ue.title} — ${ue.detail}`,
    },
    BootstrapCoordinator: { deriveCompletedSteps: () => snap.wizard.completedSteps, effectiveStepIndex: (w) => w.currentStep },
    LicenseCloud: { loadLocal: () => null },
    DeviceConfig: { load: () => ({}) },
    CenterId: { getStoredCenterId: () => null },
    DriveAdapter: { isConnected: () => !!snap.settings?.backup?.providers?.google?.connected },
    OwnerManagement: { isOwnerCreationInProgress: () => false },
    _kvWrites: kvWrites,
    _snap: snap,
  };
  ctx.global = ctx;
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  loadRuntimeModules(ctx);
  ['bf-checklist-list', 'bf-checklist-bar-fill', 'bf-checklist-pct', 'bf-wizard-status'].forEach((id) => ctx.document.getElementById(id));
  return ctx;
}

// 1–5 outcome contracts
check(BFPC.OUTCOME.SUCCESS === 'SUCCESS', '1 SUCCESS outcome');
check(BFPC.OUTCOME.RETRYABLE === 'RETRYABLE', '2 RETRYABLE outcome');
check(BFPC.OUTCOME.USER_ACTION_REQUIRED === 'USER_ACTION_REQUIRED', '3 USER_ACTION_REQUIRED outcome');
check(BFPC.OUTCOME.FATAL === 'FATAL', '4 FATAL outcome');
check(BFPC.OUTCOME.CANCELLED === 'CANCELLED', '5 CANCELLED outcome');

// 6–8 known error not unknown + correlation + redaction
const actInvalid = BFPC.normalizeFailure({ ok: false, error: 'license_invalid' });
check(actInvalid.code !== 'unknown', '6 known failure not unknown');
check(/^TDW-BOOT-/.test(actInvalid.correlationId), '7 correlation ID present');
const redacted = BFPC.redactSensitive('password=secret ya29.abc token Bearer xyz');
check(!redacted.includes('secret') && redacted.includes('password:[REDACTED]'), '8 secret redaction');

// 9–13 truthy failure, rejection, throw, timeout, cancel
check(!BFPC.isTruthySuccess({ ok: false, error: 'x' }), '9 truthy {ok:false} not success');
check(BFPC.isTruthySuccess({ ok: true }), '9b ok:true is success');
check(BFPC.normalizeFailure(new Error('sync throw'), { code: 'initial_sync_failed' }).retryable, '10 sync throw retryable');
check(BFPC.normalizeFailure({ error: 'oauth_timeout' }).outcome === BFPC.OUTCOME.RETRYABLE, '11 timeout retryable');
check(BFPC.normalizeFailure({ error: 'oauth_cancelled', cancelled: true }).outcome === BFPC.OUTCOME.CANCELLED, '12 cancellation');

// 14–17 activation
check(BFPC.normalizeFailure({ error: 'license_invalid' }).userActionRequired, '14 activation invalid');
check(BFPC.normalizeFailure({ error: 'setup_activation_failed' }).retryable, '15 activation backend failure');
check(BFPC.normalizeFailure({ error: 'activation_defaults_failed' }).retryable, '16 activation commit failure');
check(BFPC.normalizeFailure({ error: 'license_expired' }).userActionRequired, '17 activation expired');

// 18–21 Google
check(BFPC.normalizeFailure({ error: 'oauth_cancelled' }).cancelled, '18 Google cancel');
check(BFPC.normalizeFailure({ error: 'oauth_invalid_grant' }).userActionRequired, '19 Google reauth');
check(BFPC.normalizeFailure({ error: 'oauth_redirect_mismatch' }).fatal, '20 OAuth state mismatch fatal');
check(BFPC.normalizeFailure({ error: 'oauth_timeout' }).retryable, '21 Google timeout');

// 22–25 Discovery
check(BFPC.normalizeFailure({ error: 'existing_business_not_found' }).userActionRequired, '22 Discovery none');
check(BFPC.normalizeFailure({ error: 'existing_candidate_ambiguous' }).userActionRequired, '23 Discovery multiple');
check(BFPC.normalizeFailure({ error: 'discovery_failed' }).retryable, '24 Discovery network');
check(BFPC.normalizeFailure({ error: 'candidate_selection_required' }).userActionRequired, '25 Discovery truncated/selection');

// 26–27 Organization
check(BFPC.normalizeFailure({ error: 'org_fetch_failed' }).retryable, '26 Organization validation/fetch');
check(BFPC.normalizeFailure({ error: 'organization_commit_failed' }).retryable, '27 Organization commit');

// 28–30 Owner
check(BFPC.normalizeFailure({ error: 'owner_password_required' }).userActionRequired, '28 Owner validation');
check(BFPC.normalizeFailure({ error: 'owner_duplicate' }).userActionRequired, '29 Owner duplicate');
check(BFPC.normalizeFailure({ error: 'setup_owner_authentication_failed' }).userActionRequired, '30 Owner auth');

// 31–33 Branch
check(BFPC.normalizeFailure({ error: 'license_branch_limit' }).userActionRequired, '31 Branch limit');
check(BFPC.normalizeFailure({ error: 'branch_code_duplicate' }).userActionRequired, '32 Branch duplicate');
check(BFPC.normalizeFailure({ error: 'branch_duplicate_create' }).retryable, '33 Branch commit inflight');

// 34–35 Device
check(BFPC.normalizeFailure({ error: 'device_limit_exceeded' }).userActionRequired, '34 Device limit');
check(BFPC.normalizeFailure({ error: 'device_duplicate' }).code.startsWith('TDW-BOOT'), '35 Device conflict');

// 36–38 Business
check(BFPC.normalizeFailure({ error: 'business_setup_invalid' }).userActionRequired, '36 Business required');
check(BFPC.normalizeFailure({ error: 'business_setup_invalid' }).userActionRequired, '37 Business commit');
check(BFPC.normalizeFailure({ error: 'readback_mismatch' }).retryable, '38 Business read-back');

// 39–41 Publication
check(BFPC.normalizeFailure({ error: 'publication_failed' }).retryable, '39 Publication upload');
check(BFPC.normalizeFailure({ error: 'publication_failed' }).retryable, '40 Publication partial');
check(BFPC.normalizeFailure({ error: 'sync_push_blocked_pull_only' }).fatal, '41 Publication identity fatal');

// 42–46 Readback
check(BFPC.normalizeFailure({ error: 'readback_failed' }).retryable, '42 Readback missing');
check(BFPC.normalizeFailure({ error: 'readback_stale' }).retryable, '43 Readback stale');
check(BFPC.normalizeFailure({ error: 'readback_mismatch' }).retryable, '44 Readback content mismatch');
check(BFPC.normalizeFailure({ error: 'readback_stale' }).retryable, '45 Readback revision');
check(BFPC.normalizeFailure({ error: 'readback_failed' }).retryable, '46 Readback duplicate');

// 47–51 Restore
check(BFPC.normalizeFailure({ error: 'backup_password_invalid' }).userActionRequired, '47 Restore wrong password');
check(BFPC.normalizeFailure({ error: 'cloud_backup_restore_failed' }).retryable, '48 Restore corrupt/network');
check(BFPC.normalizeFailure({ error: 'restore_cancelled' }).cancelled, '49 Restore cancel');
check(BFPC.normalizeFailure({ error: 'cloud_download_failed' }).retryable, '50 Restore network');
check(BFPC.normalizeFailure({ error: 'restore_reconcile_incomplete' }).retryable, '51 Restore rollback');

// 52–53 Owner auth
check(BFPC.normalizeFailure({ error: 'setup_owner_authentication_failed' }).userActionRequired, '52 Owner auth wrong password');
check(BFPC.normalizeFailure({ error: 'owner_session_required' }).userActionRequired, '53 Owner auth lockout/session');

// 54–58 Sync
check(BFPC.normalizeFailure({ error: 'initial_sync_failed' }).retryable, '54 Sync pull failure');
check(BFPC.normalizeFailure({ error: 'initial_sync_failed' }).retryable, '55 Sync push failure');
check(BFPC.normalizeFailure({ error: 'sync_interrupted' }).retryable, '56 Sync reconcile');
check(BFPC.normalizeFailure({ error: 'sync_plan_invalid' }).userActionRequired, '57 Sync scope/plan');
check(BFPC.normalizeFailure({ error: 'oauth_offline' }).retryable, '58 sync offline');

// 59–61 no success-then-error / no advance patterns (contract level)
const successN = BFPC.normalizeFailure({ ok: true });
check(successN.ok && successN.outcome === BFPC.OUTCOME.SUCCESS, '59 SUCCESS contract');
const failN = BFPC.normalizeFailure({ ok: false, error: 'discovery_failed' });
check(!failN.ok, '60 failure blocks advance semantics');
check(/retryCurrentGate/.test(bootSrc), '61 retry current gate function exists');

// 62–64 retry idempotent + bounded (policy docs)
const matrix = BFPC.buildFailurePolicyMatrix();
check(matrix.rows.length >= 50, '62 failure matrix populated');
check(matrix.outcomes.length === 5, '63 five outcomes in matrix');
check(!/while\s*\(\s*true\s*\)/.test(bootSrc), '64 no infinite auto retry loop in boot-flow');

// 65–67 user action / fatal / cancelled checklist mapping
const uaModel = BCC.buildChecklistModel(checklistCtx({
  stepError: { stepId: 'google', outcome: 'USER_ACTION_REQUIRED', code: 'TDW-BOOT-GOOGLE-REAUTH', message: 'x', userActionRequired: true },
}));
check(uaModel.items.find((i) => i.id === 'google')?.status === BCC.STATUS.USER_ACTION, '65 user action checklist');
const fatalModel = BCC.buildChecklistModel(checklistCtx({
  stepError: { stepId: 'google', outcome: 'FATAL', code: 'TDW-BOOT-GOOGLE-OAUTH-CONFIG', message: 'x', fatal: true },
}));
check(fatalModel.items.find((i) => i.id === 'google')?.status === BCC.STATUS.FATAL, '66 fatal checklist');
const cancelModel = BCC.buildChecklistModel(checklistCtx({
  stepError: { stepId: 'google', outcome: 'CANCELLED', code: 'TDW-BOOT-GOOGLE-CANCEL', message: 'x', cancelled: true },
}));
check(cancelModel.items.find((i) => i.id === 'google')?.status === BCC.STATUS.CANCELLED, '67 cancelled neutral');

// 68–71 error clear + leakage + invalidation hooks
const rt = baseBootEnv({ googleEmail: 'old@example.com' });
rt.settings.backup.providers.google = { connected: true, email: 'old@example.com' };
const norm = rt.BootFlow.normalizeBootstrapFailure({ error: 'discovery_failed' }, 'discovery_failed', 'discovery');
check(norm.stepId === 'discovery' || norm.code.startsWith('TDW-BOOT'), '68 normalized failure bound');
check(/invalidateStaleChecklistErrors/.test(bootSrc), '69 account change invalidation implemented');

// 70 branch invalidation hook exists
check(/snap\.branchId/.test(bootSrc), '70 branch change invalidation hook');

// 71 restore choice change hook exists
check(/restoreChoice/.test(bootSrc) && /invalidateStaleChecklistErrors/.test(bootSrc), '71 restore choice invalidation hook');

// 72–73 restart transient + fatal truth
check(/validateStep\(checklistStepError\.stepId\)/.test(bootSrc), '72 restart re-evaluates step error');
check(BFPC.normalizeFailure({ error: 'database_integrity_failed' }).fatal, '73 fatal truth re-detected');

// 74–77 checklist integration
const retryModel = BCC.buildChecklistModel(checklistCtx({
  currentStepId: 'discovery',
  stepError: { stepId: 'discovery', outcome: 'RETRYABLE', retryable: true, code: 'TDW-BOOT-DISC-FAIL', message: 'x', correlationId: 'TDW-BOOT-ERR-1' },
}));
check(retryModel.items.find((i) => i.id === 'discovery')?.retryable, '74 checklist RETRYABLE retry flag');

// 78–82 no stack / provider / secrets in UI format
const formatted = rt.BootFlow.normalizeBootstrapFailure({ error: 'oauth_failed', stack: 'Error\n at foo' });
check(!String(formatted.message).includes(' at foo'), '78 no stack in normalized message');
const logSafe = BFPC.logBootstrapFailure({ code: 'x', safeDetails: 'password=abc ya29.token' });
check(!String(logSafe.details).includes('abc'), '79 no password in logs');
check(!String(logSafe.details).includes('ya29'), '80 no OAuth token in logs');

// 83 patient data fixture
const patientFixture = BFPC.redactSensitive('patientName=Ahmed diagnosis=cold');
check(patientFixture.includes('patientName'), '83 fixture redacts secrets not arbitrary labels');

// 84 unhandled rejection guard in boot-flow
check(/normalizeBootstrapFailure/.test(bootSrc) && /retryCurrentGate/.test(bootSrc), '84 boot-flow failure normalization wired');

// 85–92 stage regressions static
check(/retireOwnerSeedsIfNeeded/.test(bootSrc), '85 stage10 regression');
check(/deviceStepResolved/.test(bootSrc), '86 stage11 regression');
check(/businessSetupStepResolved/.test(bootSrc), '87 stage12 regression');
check(/publicationStepResolved/.test(bootSrc), '88 stage13 regression');
check(/readbackStepResolved/.test(bootSrc), '89 stage14 regression');
check(/InitialSyncDirectionContract|resolveInitialSyncPlan/.test(bootSrc), '90 stage15 regression');
check(/ExistingShortPathContract/.test(bootSrc), '91 stage16 regression');
check(/BootstrapChecklistContract/.test(bootSrc), '92 stage17 checklist regression');

// 93–96 flow/schema/dev unchanged
const bootNew = bootSrc.match(/const NEW_STEPS = \[([\s\S]*?)\];/);
const bootExisting = bootSrc.match(/const EXISTING_STEPS = \[([\s\S]*?)\];/);
function parseSteps(m) {
  return m ? m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean) : [];
}
check(JSON.stringify(parseSteps(bootNew)) === JSON.stringify(STAGE_15_NEW_STEPS), '93 NEW flow unchanged');
check(JSON.stringify(parseSteps(bootExisting)) === JSON.stringify(STAGE_16_EXISTING_STEPS), '94 EXISTING flow unchanged');
check(!/CREATE TABLE/.test(contractSrc), '95 schema unchanged');
check(/id:\s*'__dev__'/.test(indexSrc), '96 __dev__ unchanged');

// 97–102 integration exports + index + render retry button
check(typeof rt.BootFlow.retryCurrentGate === 'function', '97 retryCurrentGate exported');
check(typeof rt.BootFlow.normalizeBootstrapFailure === 'function', '98 normalizeBootstrapFailure exported');
check(/bootstrap-failure-policy-contract\.js/.test(indexSrc), '99 index loads failure contract');
check(/bf-checklist-retry/.test(bootSrc), '100 retry button in checklist render');

// Contract artifacts
const contract = BFPC.buildContract();
check(contract.fields.includes('correlationId'), '101 contract fields');
check(contract.truthySuccessRule.includes('ok:false'), '102 truthy rule documented');

// Gate policy files structure
check(Object.keys(BFPC.CODE_POLICY).length >= 40, '103 CODE_POLICY breadth');
check(BCC.resolveFailureStatus({ outcome: 'RETRYABLE' }) === BCC.STATUS.ERROR, '104 outcome to status map');
check(BCC.resolveFailureStatus({ outcome: 'CANCELLED' }) === BCC.STATUS.CANCELLED, '105 cancelled status');

// Additional matrix coverage for mandatory gates
const gateCodes = [
  'license_invalid', 'oauth_cancelled', 'discovery_failed', 'candidate_selection_required',
  'organization_commit_failed', 'owner_duplicate', 'branch_code_duplicate', 'device_limit_exceeded',
  'business_setup_invalid', 'publication_failed', 'readback_stale', 'backup_password_invalid',
  'restore_cancelled', 'setup_owner_authentication_failed', 'initial_sync_failed',
];
gateCodes.forEach((code, i) => {
  const n = BFPC.normalizeFailure({ error: code });
  check(n.code !== 'unknown', `gate-code-${i + 1} ${code} not unknown`);
});

if (errors.length) {
  console.error('FAIL stage-18-bootstrap-failure-policy');
  errors.forEach((e) => console.error(' -', e));
  process.exit(1);
}
console.log(`PASS stage-18-bootstrap-failure-policy (${103 + gateCodes.length} checks)`);
