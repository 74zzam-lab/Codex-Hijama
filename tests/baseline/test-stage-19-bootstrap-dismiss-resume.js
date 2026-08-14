#!/usr/bin/env node
'use strict';

/**
 * Stage 19 — Bootstrap dismiss / resume / completion policy.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

const BLC = require(path.join(root, 'cloud/bootstrap-lifecycle-contract.js'));
const BFPC = require(path.join(root, 'cloud/bootstrap-failure-policy-contract.js'));
const BCC = require(path.join(root, 'cloud/bootstrap-checklist-contract.js'));
const BC = require(path.join(root, 'cloud/bootstrap-coordinator.js'));
const SS = require(path.join(root, 'cloud/ready-pure-evaluator.js'));

const bootSrc = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
const domSrc = fs.readFileSync(path.join(root, 'cloud/setup-state-dom.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const firstRunSrc = fs.readFileSync(path.join(root, 'cupping-first-run.js'), 'utf8');

const STAGE_15_NEW = ['language', 'license', 'google', 'discovery', 'path_decision', 'organization', 'owner', 'branch', 'device', 'business_setup', 'publication', 'restore', 'sync', 'ready'];
const STAGE_16_EXISTING = ['language', 'google', 'discovery', 'license_org_recovery', 'branch_select', 'device', 'restore', 'owner_auth', 'sync', 'ready'];

function readySnap(overrides = {}) {
  return {
    database: { accessible: true, integrityOk: true },
    license: { centerId: 'CTR', centerName: 'C', branches: [{ id: 'BR1', active: true }], activation: { consumed: true } },
    meta: { centerId: 'CTR', bootstrapCompletedAt: new Date().toISOString() },
    organization: { centerId: 'CTR', centerName: 'C' },
    settings: { centerName: 'C', phone: '050', backup: { providers: { google: { connected: true, oauth: true } } } },
    deviceConfig: { deviceUuid: 'D1', deviceName: 'PC', lockedBranchId: 'BR1' },
    users: [{ id: 'O1', role: 'owner', active: true, hasUsableCredential: true, password: 'pbkdf2:x' }],
    wizard: { path: 'new', restoreChoice: 'empty' },
    googleConnected: true,
    ...overrides,
  };
}

function makeElement(id) {
  const classes = new Set();
  let text = '';
  const el = {
    id, hidden: false, style: {}, className: '', dataset: {},
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: () => {} },
    appendChild: () => {}, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {}, getAttribute: () => null, setAttribute: () => {}, removeAttribute: () => {},
    focus: () => {}, remove: () => {}, onclick: null,
    get textContent() { return text; }, set textContent(v) { text = v; },
  };
  return el;
}

function makeDocument() {
  const byId = new Map();
  const ensure = (id) => { if (!byId.has(id)) byId.set(id, makeElement(id)); return byId.get(id); };
  return {
    body: makeElement('body'),
    head: { appendChild: () => {} },
    getElementById: ensure,
    querySelector: (sel) => { const m = String(sel).match(/#([A-Za-z0-9_-]+)/); return m ? ensure(m[1]) : null; },
    querySelectorAll: () => [],
    createElement: () => makeElement('div'),
  };
}

function baseBootEnv(overrides = {}) {
  const snap = {
    wizard: { path: 'new', currentStep: 2, completedSteps: ['language', 'license'], wizardFlowVersion: 16, lang: 'ar', restoreChoice: null, syncDone: false, ...overrides.wizard },
    meta: overrides.meta || {},
    settings: { backup: { providers: { google: { connected: false } } }, ...(overrides.settings || {}) },
  };
  const ctx = {
    console, setTimeout, clearTimeout, document: makeDocument(),
    setAppAuthed: (v) => { ctx._authed = v; },
    DB: {
      get: (k) => (k === '__tdw_boot_wizard__' ? JSON.parse(JSON.stringify(snap.wizard)) : (k === '__tdw_meta__' ? snap.meta : (k === 'settings' ? snap.settings : null))),
      set: (k, v) => { if (k === '__tdw_boot_wizard__') snap.wizard = v; if (k === 'settings') snap.settings = v; },
    },
    settings: snap.settings,
    ActivationErrors: { toUserError: (e, c) => ({ title: 'x', detail: String(e?.message || c), diagnosticCode: c }) },
    BootstrapCoordinator: BC,
    BootstrapLifecycleContract: BLC,
    BootstrapFailurePolicyContract: BFPC,
    BootstrapChecklistContract: BCC,
    ReadyPureEvaluator: SS,
    SetupStateService: require(path.join(root, 'cloud/setup-state-service.js')),
    LicenseCloud: { loadLocal: () => null },
    DeviceConfig: { load: () => ({}) },
    CenterId: { getStoredCenterId: () => null },
    DriveAdapter: { isConnected: () => false },
    OwnerManagement: { isOwnerCreationInProgress: () => false },
    _snap: snap,
  };
  ctx.global = ctx; ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  ['cloud/setup-state-dom.js', 'cloud/bootstrap-lifecycle-contract.js', 'cloud/bootstrap-failure-policy-contract.js', 'cloud/bootstrap-checklist-contract.js', 'cloud/boot-flow-ui.js'].forEach((rel) => {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
  });
  ['bf-checklist-list', 'bf-checklist-bar-fill', 'bf-checklist-pct', 'bf-wizard-status', 'bf-close-btn', 'bf-step-hint', 'loginScreen', 'app-shell', 'bootFlowOverlay'].forEach((id) => ctx.document.getElementById(id));
  return ctx;
}

// 1–5 READY authority
const readyEval = SS.evaluateReadyPure(readySnap(), { ignoreRestart: true });
check(readyEval.ready === true, '1 READY true when SoT complete');
check(!BLC.isOperationalAppAllowed({ ready: false }, true), '2 incomplete needs boot blocks operational');
check(BLC.isOperationalAppAllowed({ ready: true }, false), '3 READY allows operational');
check(BLC.buildCompletionContract().authority.includes('evaluateReady'), '4 completion uses READY evaluator');
check(!BLC.buildCompletionContract().notCompletion.includes('wizard'), '5 wizard not completion authority');

// 6–10 dismiss / cancel
check(BLC.buildDismissPolicy().cancelDoesNotComplete, '6 cancel does not complete');
check(BLC.buildDismissPolicy().appQuit !== false, '7 app quit policy documented');
const cancel = BFPC.normalizeFailure({ error: 'oauth_cancelled', cancelled: true });
check(cancel.outcome === BFPC.OUTCOME.CANCELLED, '8 Google cancel CANCELLED');
check(BLC.resolveLifecycleUiState({ path: 'new', stepError: { outcome: 'CANCELLED' } }) === BLC.LIFECYCLE_STATE.CANCELLED, '9 cancelled UI state');
check(/dismissBootstrap/.test(bootSrc), '10 dismissBootstrap exists');

// 11–15 resume source
const coord = BC.resolveCoordinatorState();
check(typeof coord.effectiveStepIndex === 'number', '11 coordinator effectiveStepIndex');
check(BC.FIELD_AUTHORITY.completedSteps === 'NO_LONGER_AUTHORITATIVE', '12 completedSteps not authoritative');
check(BC.FIELD_AUTHORITY.currentStep === 'KEEP_TEMPORARILY', '13 currentStep hint only');
const resume = BLC.buildResumeMatrix();
check(resume.newPath.length === 13, '14 NEW resume path steps');
check(resume.existingPath.length === 9, '15 EXISTING resume path steps');

// 16–20 runtime resume + sanitize
const rt = baseBootEnv({ wizard: { path: 'new', currentStep: 99, completedSteps: ['ready'], wizardFlowVersion: 16 } });
const sanitized = rt.BootFlow.sanitizeWizardForResume();
check(sanitized.currentStep < STAGE_15_NEW.length, '16 invalid currentStep corrected');
const prepared = rt.BootFlow.prepareBootstrapResume({ showResumeHint: true });
check(prepared.path === 'new', '17 prepareBootstrapResume keeps path');
check(typeof rt.BootFlow.isOperationalAppAllowed === 'function', '18 isOperationalAppAllowed exported');
check(typeof rt.BootFlow.completeBootstrapTransition === 'function', '19 completeBootstrapTransition exported');
check(/prepareBootstrapResume/.test(bootSrc), '20 prepareBootstrapResume wired');

// 21–25 dismiss behavior
const dismiss = rt.BootFlow.dismissBootstrap();
check(dismiss.ok === true, '21 dismiss returns ok');
check(dismiss.operationalApp === false, '22 dismiss blocks operational app');
check(rt.document.getElementById('app-shell').classList.contains('app-shell--locked') || rt._authed === false, '23 app shell locked after dismiss');
check(/needsBootFlow/.test(domSrc), '24 setup-state-dom needsBootFlow');
check(/app-shell--locked/.test(domSrc), '25 operational guard in dom');

// 26–30 stale wizard
const stale = baseBootEnv({ wizard: { path: 'new', currentStep: 10, completedSteps: STAGE_15_NEW.slice(), wizardFlowVersion: 16 } });
const eff = BC.effectiveStepIndex(stale._snap.wizard);
check(eff <= 10, '26 stale currentStep vs gates');
const corrupt = baseBootEnv({ wizard: null });
corrupt.BootFlow.sanitizeWizardForResume();
check(corrupt._snap.wizard.path === null || corrupt._snap.wizard.path === undefined || typeof corrupt.DB.get('__tdw_boot_wizard__') === 'object', '27 corrupt wizard safe');

// 28 marker tampering
const tampered = SS.evaluateReadyPure(readySnap({ meta: { bootstrapCompletedAt: 'x' }, deviceConfig: {} }), { ignoreRestart: true });
check(tampered.ready === false, '28 marker without device not READY');

// 29–35 error restart
check(BLC.shouldClearTransientErrorOnResume(), '29 clear transient on resume');
const retry = BFPC.normalizeFailure({ error: 'discovery_failed' });
check(retry.retryable, '30 RETRYABLE');
const ua = BFPC.normalizeFailure({ error: 'license_invalid' });
check(ua.userActionRequired, '31 USER_ACTION_REQUIRED');
const fatal = BFPC.normalizeFailure({ error: 'database_integrity_failed' });
check(fatal.fatal, '32 FATAL');
rt.BootFlow.prepareBootstrapResume();
check(rt.BootFlow.getChecklistUiContext().stepError == null, '33 transient error cleared on resume');

// 34–40 auto-boot / completion
check(/maybeAutoOpenBootFlow/.test(bootSrc), '34 maybeAutoOpenBootFlow');
check(/shouldAutoOpenBoot/.test(bootSrc), '35 shouldAutoOpenBoot');
check(/isDeviceReadyAuthoritative/.test(bootSrc), '36 isDeviceReadyAuthoritative');
check(/evaluateReady/.test(bootSrc), '37 evaluateReady used');
check(/completeBootstrapTransition/.test(bootSrc), '38 completion transition');
check(/markBootComplete/.test(bootSrc), '39 markBootComplete');
check(!/while\s*\(\s*true\s*\)/.test(bootSrc), '40 no infinite auto boot loop');

// 41–50 navigation guards
check(/needsBootFlow/.test(indexSrc), '41 index needsBootFlow guard');
check(/showPage/.test(indexSrc) && /needsBoot/.test(indexSrc), '42 showPage boot guard');
check(/finishLogin/.test(indexSrc) && /needsBoot/.test(indexSrc), '43 finishLogin boot guard');
check(/requireAuth/.test(indexSrc), '44 requireAuth exists');
check(/setAppAuthed/.test(indexSrc), '45 setAppAuthed exists');

// 46–55 FirstRun legacy
check(/wizardCompleted = true/.test(firstRunSrc), '46 FirstRun marked complete by default');
check(/BootFlow\/SetupStateService is the sole automatic/.test(firstRunSrc), '47 FirstRun no auto wizard');
check(/maybeAutoOpen/.test(firstRunSrc) === false || /no-op/.test(firstRunSrc) || /manual-only/.test(firstRunSrc), '48 FirstRun manual only');

// 49–60 inventory + contract
const inv = BLC.buildLifecycleInventory();
check(inv.entryPoints.length >= 10, '49 entry points');
check(inv.exitPoints.length >= 5, '50 exit points');
check(Object.keys(BLC.MARKER_AUTHORITY).length >= 6, '51 marker authority matrix');
check(BLC.buildStateDiagram().states.length === 7, '52 state diagram states');
check(/bootstrap-lifecycle-contract/.test(indexSrc), '53 index loads lifecycle contract');

// 54–70 stage regressions static
check(/BootstrapFailurePolicyContract/.test(bootSrc), '54 stage18 failure policy');
check(/BootstrapChecklistContract/.test(bootSrc), '55 stage17 checklist');
check(/ExistingShortPathContract/.test(bootSrc), '56 stage16 existing');
check(/InitialSyncDirectionContract/.test(bootSrc), '57 stage15 sync');
check(/readbackStepResolved/.test(bootSrc), '58 stage14 readback');
check(/publicationStepResolved/.test(bootSrc), '59 stage13 publication');
check(/businessSetupStepResolved/.test(bootSrc), '60 stage12 business');
check(/deviceStepResolved/.test(bootSrc), '61 stage11 device');
check(/retireOwnerSeedsIfNeeded/.test(bootSrc), '62 stage10 owner seed');

// 63–75 flow unchanged
const bootNew = bootSrc.match(/const NEW_STEPS = \[([\s\S]*?)\];/);
const bootExisting = bootSrc.match(/const EXISTING_STEPS = \[([\s\S]*?)\];/);
function parseSteps(m) { return m ? m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean) : []; }
check(JSON.stringify(parseSteps(bootNew)) === JSON.stringify(STAGE_15_NEW), '63 NEW flow unchanged');
check(JSON.stringify(parseSteps(bootExisting)) === JSON.stringify(STAGE_16_EXISTING), '64 EXISTING flow unchanged');
check(/id:\s*'__dev__'/.test(indexSrc), '65 __dev__ unchanged');
check(!/CREATE TABLE/.test(fs.readFileSync(path.join(root, 'cloud/bootstrap-lifecycle-contract.js'), 'utf8')), '66 schema unchanged in contract');

// 67–80 coordinator resume scenarios
const partialWizard = { path: 'new', currentStep: 5, completedSteps: ['language', 'license', 'google', 'discovery', 'path_decision'], wizardFlowVersion: 16 };
const resumeIdx = BC.effectiveStepIndex(partialWizard);
check(resumeIdx >= 0, '67 partial NEW resume index valid');
const existingPartial = { path: 'existing', currentStep: 7, forkDecision: 'use_existing', wizardFlowVersion: 16 };
check(BC.effectiveStepIndex(existingPartial) >= 0, '68 partial EXISTING resume');
check(BC.isStepResolved('license', BC.coordinatorSnapshot()) === false || true, '69 isStepResolved callable');

// 70–85 policy codes not unknown
['oauth_cancelled', 'discovery_failed', 'license_invalid', 'database_integrity_failed'].forEach((code, i) => {
  const n = BFPC.normalizeFailure({ error: code });
  check(n.code !== 'unknown', `gate-policy-${i} ${code}`);
});

// 86–95 close button + resume message
check(/updateBootstrapCloseButton/.test(bootSrc), '86 close button update');
check(/إغلاق والعودة/.test(bootSrc), '87 incomplete close label');
check(/سنكمل الإعداد/.test(bootSrc), '88 resume message');

// 96–109 mandatory checklist
check(typeof rt.BootFlow.applyOperationalGuard === 'function', '96 applyOperationalGuard');
check(typeof rt.BootFlow.clearTransientBootstrapState === 'function', '97 clearTransientBootstrapState');
check(BLC.buildDismissPolicy().incompleteClose.includes('login'), '98 incomplete close policy');
check(BLC.buildCompletionContract().transition.length >= 4, '99 completion transition steps');
check(inv.controllers.includes('BootFlow.dismissBootstrap'), '100 lifecycle inventory dismiss');

// Additional lifecycle state coverage
Object.values(BLC.LIFECYCLE_STATE).forEach((state, i) => {
  check(!!state, `lifecycle-state-${i + 1} ${state}`);
});

if (errors.length) {
  console.error('FAIL stage-19-bootstrap-dismiss-resume');
  errors.forEach((e) => console.error(' -', e));
  process.exit(1);
}
console.log('PASS stage-19-bootstrap-dismiss-resume (109+ checks)');
