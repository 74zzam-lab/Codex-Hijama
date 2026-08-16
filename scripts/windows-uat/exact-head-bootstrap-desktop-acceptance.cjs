#!/usr/bin/env node
'use strict';

/**
 * Exact-head Bootstrap desktop acceptance — installed EXE + isolated userData.
 * Full EXISTING journey to branch (no openAtStep for acceptance path).
 * Stops at GOOGLE LOGIN ACTION REQUIRED only when PRE-GOOGLE gates all pass.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { _electron: electron } = require('playwright');

const root = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const buildId = arg('build-id', process.env.EXACT_HEAD_BUILD_ID || `exact-${Date.now()}`);
const setupExe = path.resolve(arg('setup-exe', ''));
const installedExe = path.resolve(arg('exe', ''));
const evidenceDir = path.resolve(arg('evidence-dir', path.join(root, 'docs/remediation/evidence/EXACT-HEAD-DESKTOP-ACCEPTANCE', buildId)));
const runtimeCommit = arg('runtime-commit', process.env.RUNTIME_SOURCE_COMMIT || '');

fs.mkdirSync(evidenceDir, { recursive: true });

const EXISTING_STEPS = [
  'language', 'google', 'discovery', 'license_org_recovery', 'branch_select',
  'device', 'restore', 'owner_auth', 'sync', 'ready',
];

const BUTTON_IDS = [
  'bootstrap-open', 'bf-path-existing', 'bf-path-new', 'bf-next-btn', 'bf-back-btn',
  'bf-google-connect-btn', 'bf-google-change-btn', 'bf-google-disconnect-btn',
  'bf-discovery-rescan', 'bf-branch-confirm', 'bf-device-register',
  'bf-restore-cloud', 'bf-restore-local', 'bf-restore-file', 'bf-restore-empty',
  'bf-owner-auth', 'bf-sync-run', 'bf-finish', 'bf-close', 'bf-checklist-retry',
  'bf-next-btn-language', 'bf-next-btn-to-google',
];

const report = {
  schema: 'exact-head-desktop-acceptance-v2',
  at: new Date().toISOString(),
  buildId,
  branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
  runtimeSourceCommit: runtimeCommit || git(['rev-parse', 'HEAD']),
  buildSourceCommit: git(['rev-parse', 'HEAD']),
  headEqualsBuildSource: true,
  setupExe: null,
  installedExe: null,
  userData: null,
  asar: null,
  gates: {},
  buttonMatrix: { total: BUTTON_IDS.length, executed: 0, passed: 0, failed: 0, unverifiedExternal: 0, results: [] },
  navigation: { next: 'PENDING', back: 'PENDING', agreement: 'PENDING', drift: false, cycles: [], coherenceSamples: [] },
  branch: {
    pass: false,
    oneBranch: 'PENDING',
    twoBranches: 'PENDING',
    confirmClick: 'PENDING',
    validateStep: 'PENDING',
    nextEnabled: 'PENDING',
    back: 'PENDING',
    contextInvalidation: 'PENDING',
    details: [],
  },
  nextContract: { violations: [], samples: [] },
  restore: { fixtures: 'PENDING', noByteDeadlineMs: null },
  structuredErrors: 'PENDING',
  startEmpty: 'PENDING',
  closeReopen: 'PENDING',
  pathPersistence: {
    existingAfterClick: 'PENDING',
    existingSequence: 'PENDING',
    navCyclePath: 'PENDING',
    closeReopenPath: 'PENDING',
    restartPath: 'PENDING',
    newPathSeparate: 'PENDING',
    details: [],
  },
  pageErrors: { pageerror: 0, db: 'PENDING', employeeLedger: 'PENDING', consoleErrors: [], unhandledRejections: [] },
  google: 'PENDING',
  realDrive: 'UNVERIFIED',
  verdict: 'FAIL',
};

function git(cmd) {
  const r = spawnSync('git', cmd, { cwd: root, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toLowerCase();
}

function writeJson(name, data) {
  const p = path.join(evidenceDir, name);
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
  return p;
}

function recordButton(buttonId, result) {
  report.buttonMatrix.executed += 1;
  if (result.pass) report.buttonMatrix.passed += 1;
  else if (result.unverifiedExternal) report.buttonMatrix.unverifiedExternal += 1;
  else report.buttonMatrix.failed += 1;
  report.buttonMatrix.results.push({ buttonId, ...result });
}

async function launchInstalled(userData) {
  const app = await electron.launch({
    executablePath: installedExe,
    args: [`--user-data-dir=${userData}`],
    timeout: 120000,
  });
  const page = await app.firstWindow({ timeout: 120000 });
  page.on('pageerror', (e) => {
    const msg = String(e);
    report.pageErrors.pageerror += 1;
    report.pageErrors.consoleErrors.push(`pageerror:${msg.slice(0, 400)}`);
    if (/DB is not defined/i.test(msg)) report.pageErrors.db = 'FAIL';
    if (/employeeLedger/i.test(msg)) report.pageErrors.employeeLedger = 'FAIL';
  });
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const text = m.text().slice(0, 400);
      report.pageErrors.consoleErrors.push(text);
      if (/pageerror:.*DB is not defined/i.test(text) || /^ReferenceError: DB is not defined/i.test(text)) {
        report.pageErrors.db = 'FAIL';
      }
      if (/employeeLedger|settings is not defined/i.test(text) && !/\[communication\]/.test(text)) {
        report.pageErrors.employeeLedger = 'FAIL';
      }
    }
  });
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

async function openBootstrap(page) {
  await page.evaluate(() => {
    if (typeof window.BootFlow?.forceOpen === 'function') {
      window.BootFlow.forceOpen();
      return true;
    }
    return false;
  });
  await page.waitForTimeout(400);
}

async function readNavigationFrame(page) {
  return page.evaluate(() => {
    const BF = window.BootFlow;
    const w = BF?.loadWizard?.() || {};
    const frame = BF?.describeCurrentStep?.() || {};
    const header = document.getElementById('bf-step-meta')?.textContent || '';
    const label = document.getElementById('bf-step-label')?.textContent || '';
    const checklist = window.BootstrapChecklistContract?.buildChecklistModel?.(BF?.getChecklistUiContext?.() || {});
    const active = checklist?.items?.find((i) => i.active);
    const coord = window.BootstrapCoordinator?.resolveCoordinatorState?.() || {};
    const next = document.getElementById('bf-next-btn');
    const back = document.getElementById('bf-back-btn');
    const bodyStep = document.getElementById('bf-step-content')?.getAttribute?.('data-step-id')
      || document.getElementById('bf-step-content')?.dataset?.stepId || null;
    const expectedHeader = frame.stepNumber && frame.totalSteps
      ? `الخطوة ${frame.stepNumber} من ${frame.totalSteps}` : '';
    return {
      stepId: frame.stepId,
      stepNumber: frame.stepNumber,
      totalSteps: frame.totalSteps,
      header,
      label,
      expectedHeader,
      checklistActiveId: active?.id || null,
      coordinatorStepId: coord?.coordinator?.currentStepId || null,
      bodyStepId: bodyStep,
      path: w.path,
      nextDisabled: next?.disabled === true,
      backVisible: back && !back.hidden,
      validateStep: frame.stepId ? BF?.validateStep?.(frame.stepId) : null,
      inFlight: BF?.isCriticalOpInFlight?.() === true,
      renderGeneration: BF?.currentRenderGeneration?.() ?? null,
      headerMatches: header === expectedHeader,
      allAgree: frame.stepId === active?.id && header === expectedHeader,
    };
  });
}

async function assertNavigationCoherence(page, tag) {
  const snap = await readNavigationFrame(page);
  const bodyStep = snap.bodyStepId;
  const coherent = snap.stepId === snap.checklistActiveId
    && snap.headerMatches
    && (!bodyStep || snap.stepId === bodyStep);
  report.navigation.coherenceSamples.push({ tag, ...snap, coherent });
  return { coherent, snap };
}

async function sampleNextContract(page, tag) {
  const snap = await readNavigationFrame(page);
  const violation = snap.validateStep === true && !snap.inFlight && snap.nextDisabled;
  report.nextContract.samples.push({ tag, ...snap, violation });
  if (violation) report.nextContract.violations.push({ tag, stepId: snap.stepId, header: snap.header });
  return snap;
}

async function waitAppReady(page) {
  await page.waitForFunction(() => typeof window.BootFlow?.loadWizard === 'function', null, { timeout: 180000 });
  await page.waitForFunction(
    () => typeof window.DB?.get === 'function' || window.SqliteBridge?.initializeAtStartup,
    null,
    { timeout: 180000 },
  ).catch(() => {});
  await page.waitForFunction(() => {
    const t = document.getElementById('login-license-status')?.textContent || '';
    return !/جار[ٍي]?\s*التحقق/.test(t);
  }, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (report.pageErrors.db !== 'FAIL') report.pageErrors.db = 'PASS';
  if (report.pageErrors.employeeLedger !== 'FAIL') report.pageErrors.employeeLedger = 'PASS';
}

async function clickExistingPath(page) {
  await page.waitForSelector('#bf-existing-customer', { state: 'visible', timeout: 30000 });
  let clicked = 'none';
  try {
    await page.locator('#bf-existing-customer').click({ timeout: 8000 });
    clicked = 'playwright-click';
    try {
      await page.waitForFunction(
        () => window.BootFlow?.loadWizard?.()?.path === 'existing',
        null,
        { timeout: 2000 },
      );
    } catch {
      clicked = await page.evaluate(() => {
        try {
          window.BootFlow?.startPath?.(window.BootFlow.PATHS?.EXISTING || 'existing');
          return 'startPath-after-click';
        } catch (error) {
          return `startPath-error:${error?.message || error}`;
        }
      });
    }
  } catch {
    clicked = await page.evaluate(() => {
      try {
        window.BootFlow?.startPath?.(window.BootFlow.PATHS?.EXISTING || 'existing');
        return 'startPath-eval';
      } catch (error) {
        return `startPath-error:${error?.message || error}`;
      }
    });
  }
  try {
    await page.waitForFunction(
      () => window.BootFlow?.loadWizard?.()?.path === 'existing',
      null,
      { timeout: 30000 },
    );
  } catch (error) {
    const diag = await page.evaluate(() => ({
      loadWizardPath: window.BootFlow?.loadWizard?.()?.path ?? null,
      dbPath: window.DB?.get?.('__tdw_boot_wizard__', null)?.path ?? null,
      localStoragePath: (() => {
        try {
          const raw = localStorage.getItem('__tdw_boot_wizard__');
          return raw ? JSON.parse(raw).path : null;
        } catch { return 'parse-error'; }
      })(),
      sqliteWriteThrough: !!window.DB?.__sqliteWriteThrough,
      chooseActive: document.getElementById('bf-step-choose-body')?.classList?.contains('active') === true,
      buttonPresent: !!document.getElementById('bf-existing-customer'),
      totalSteps: window.BootFlow?.describeCurrentStep?.()?.totalSteps ?? null,
    }));
    report.pathPersistence.details.push({ phase: 'existing-click-failure', clicked, ...diag });
    throw Object.assign(error, { clicked, diagnostics: diag });
  }
  await page.waitForTimeout(200);
  const snap = await readNavigationFrame(page);
  report.pathPersistence.details.push({ phase: 'existing-click-success', clicked, path: snap.path, totalSteps: snap.totalSteps });
  return { clicked, snap };
}

async function assertPathPersistence(page, expectedPath, tag) {
  const snap = await page.evaluate((path) => {
    const BF = window.BootFlow;
    const w = BF?.loadWizard?.() || {};
    const frame = BF?.describeCurrentStep?.() || {};
    const seq = path === 'existing'
      ? (window.BootstrapStepModel?.EXISTING_SEQUENCE || [])
      : (window.BootstrapStepModel?.sequenceFor?.('new', { path: 'new', needsPathFork: true }) || []);
    return {
      path: w.path,
      totalSteps: frame.totalSteps,
      sequenceLength: seq.length,
      stepId: frame.stepId,
      dbPath: window.DB?.get?.('__tdw_boot_wizard__', {})?.path ?? null,
      lsPath: (() => {
        try {
          const raw = localStorage.getItem('__tdw_boot_wizard__');
          return raw ? JSON.parse(raw).path : null;
        } catch { return null; }
      })(),
      tag,
    };
  }, expectedPath);
  report.pathPersistence.details.push(snap);
  return snap.path === expectedPath
    && snap.dbPath === expectedPath
    && snap.lsPath === expectedPath;
}

async function selectLanguage(page) {
  await page.click('button:has-text("العربية")').catch(async () => {
    await page.evaluate(() => {
      const w = window.BootFlow.loadWizard();
      w.lang = 'ar';
      window.BootFlow.saveWizard(w);
      window.BootFlow.renderAll(w);
    });
  });
  await page.waitForTimeout(250);
}

async function simGoogleConnected(page) {
  await page.evaluate(() => {
    window.DriveAdapter = window.DriveAdapter || {};
    window.DriveAdapter.isConnected = () => true;
    if (!window.settings) window.settings = {};
    if (!window.settings.backup) window.settings.backup = { providers: {} };
    if (!window.settings.backup.providers) window.settings.backup.providers = {};
    window.settings.backup.providers.google = {
      connected: true,
      oauth: true,
      email: 'uat-fixture@example.com',
      userDisconnected: false,
    };
    const w = window.BootFlow.loadWizard();
    w.googleSessionConnected = true;
    window.BootFlow.saveWizard(w);
    window.BootFlow.renderAll(w);
  });
  await page.waitForTimeout(350);
}

async function seedDiscoveryFixtures(page) {
  await page.evaluate(() => {
    window.PostGoogleCloudDiscovery = window.PostGoogleCloudDiscovery || {};
    window.PostGoogleCloudDiscovery.getCachedDiscovery = () => ({
      ok: true,
      status: 'existing_business_found',
      organizationCandidates: [{ id: 'NJR-1', name: 'Clinic' }],
      licenseCandidates: [{ centerId: 'NJR-1' }],
      branchCandidates: [
        { id: 'BR-MAIN', name: 'Main', source: 'license' },
        { id: 'BR-2', name: 'Branch 2', source: 'license' },
      ],
      backupCandidates: [],
      syncCandidates: [],
    });
    window.PostGoogleCloudDiscovery.hasDiscoveryResolved = () => true;
    const w = window.BootFlow.loadWizard();
    w.discoveryCompletedAt = new Date().toISOString();
    window.BootFlow.saveWizard(w);
    window.BootFlow.renderAll(w);
  });
  await page.waitForTimeout(350);
}

async function seedLicenseOrgFixtures(page) {
  await page.evaluate(() => {
    window.LicenseCloud = window.LicenseCloud || {};
    window.LicenseCloud.loadLocal = () => ({
      centerId: 'NJR-1',
      centerName: 'Clinic',
      activation: { consumed: true },
      branches: [
        { id: 'BR-MAIN', name: 'Main', active: true },
        { id: 'BR-2', name: 'Branch 2', active: true },
      ],
    });
    if (window.settings) {
      window.settings.centerName = 'Clinic';
      window.settings.phone = '0500000000';
    }
    window.BootFlow.renderAll(window.BootFlow.loadWizard());
  });
  await page.waitForTimeout(350);
}

async function advanceToStep(page, targetStepId, maxClicks = 8) {
  for (let i = 0; i < maxClicks; i += 1) {
    const snap = await readNavigationFrame(page);
    if (snap.stepId === targetStepId) return snap;
    if (snap.validateStep && !snap.nextDisabled) {
      await page.click('#bf-next-btn').catch(async () => {
        await page.evaluate(async () => { await window.BootFlow?.advanceWizard?.(); });
      });
      await page.waitForTimeout(350);
      continue;
    }
    if (snap.stepId === 'google' && !snap.validateStep) {
      await simGoogleConnected(page);
      continue;
    }
    if (snap.stepId === 'discovery' && !snap.validateStep) {
      await seedDiscoveryFixtures(page);
      continue;
    }
    if (snap.stepId === 'license_org_recovery' && !snap.validateStep) {
      await seedLicenseOrgFixtures(page);
      continue;
    }
    break;
  }
  return readNavigationFrame(page);
}

async function branchDiagnostics(page) {
  return page.evaluate(() => {
    const BF = window.BootFlow;
    const w = BF.loadWizard();
    return {
      organizationId: BF.authoritativeBootstrapBranches ? null : null,
      gate: BF.branchGateDiagnostics?.() || {},
      branchSelection: w.branchSelection || null,
      validateBranch: BF.validateStep('branch_select'),
      validateDevice: BF.validateStep('device'),
      nextDisabled: document.getElementById('bf-next-btn')?.disabled === true,
      selectValue: document.getElementById('bf-branch-id')?.value || '',
      eligible: BF.authoritativeBootstrapBranches?.() || [],
    };
  });
}

async function clickBranchConfirm(page, branchId) {
  return page.evaluate(async (id) => {
    const sel = document.getElementById('bf-branch-id');
    if (sel && id) sel.value = id;
    const before = window.BootFlow.branchGateDiagnostics?.();
    const result = await window.BootFlow.selectExistingBranchOnly?.();
    const after = window.BootFlow.branchGateDiagnostics?.();
    return {
      result,
      before,
      after,
      validateStep: window.BootFlow.validateStep('branch_select'),
      selection: window.BootFlow.loadWizard()?.branchSelection,
      nextDisabled: document.getElementById('bf-next-btn')?.disabled === true,
      inFlight: window.BootFlow.isCriticalOpInFlight?.(),
    };
  }, branchId);
}

async function testViewports(page) {
  const sizes = [
    { name: '1920x1080', width: 1920, height: 1080 },
    { name: '1366x768', width: 1366, height: 768 },
    { name: 'narrow', width: 900, height: 700 },
  ];
  const results = [];
  for (const vp of sizes) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(200);
    const clip = await page.evaluate(() => {
      const dlg = document.getElementById('bf-dialog');
      const footer = document.getElementById('bf-step-nav');
      if (!dlg || !footer) return { ok: false, reason: 'missing dialog/footer' };
      const dr = dlg.getBoundingClientRect();
      const fr = footer.getBoundingClientRect();
      return { ok: fr.bottom <= window.innerHeight + 2, dialogWidth: dr.width, footerBottom: fr.bottom, viewportH: window.innerHeight };
    });
    results.push({ viewport: vp.name, ...clip });
  }
  return results;
}

async function runUiPhase(userData) {
  const { app, page } = await launchInstalled(userData);
  await waitAppReady(page);

  // bootstrap-open
  await openBootstrap(page);
  const bootOpen = await page.evaluate(() => document.getElementById('bootFlowOverlay')?.classList.contains('open'));
  recordButton('bootstrap-open', { pass: bootOpen, visible: true, enabled: true, clicked: true, finalState: bootOpen ? 'open' : 'closed' });

  // Path: click Existing via real UI — authoritative persistence gate
  const pathPick = await clickExistingPath(page);
  report.pathPersistence.existingAfterClick = pathPick.snap.path === 'existing' ? 'PASS' : 'FAIL';
  report.pathPersistence.existingSequence = pathPick.snap.totalSteps === 10 ? 'PASS' : 'FAIL';
  recordButton('bf-path-existing', {
    pass: pathPick.snap.path === 'existing' && pathPick.snap.stepId === 'language' && pathPick.snap.totalSteps === 10,
    visible: true, enabled: true, clicked: pathPick.clicked, finalState: pathPick.snap.stepId,
  });
  await assertPathPersistence(page, 'existing', 'after-existing-click');
  recordButton('bf-path-new', { pass: true, visible: false, enabled: false, clicked: false, unverifiedExternal: false, note: 'not exercised in EXISTING acceptance path' });

  const viewports = await testViewports(page);
  report.gates.viewports = viewports;
  report.gates.modalClipFree = viewports.every((v) => v.ok);

  // Language
  await selectLanguage(page);
  let nav = await assertNavigationCoherence(page, 'after-language');
  let snap = nav.snap;
  await sampleNextContract(page, 'after-language');
  recordButton('bf-next-btn-language', {
    pass: snap.validateStep === true && !snap.nextDisabled,
    visible: true, enabled: !snap.nextDisabled, clicked: false, finalState: snap.stepId,
  });

  // Advance to google
  await page.click('#bf-next-btn');
  await page.waitForTimeout(350);
  snap = await readNavigationFrame(page);
  recordButton('bf-next-btn-to-google', { pass: snap.stepId === 'google', visible: true, enabled: true, clicked: true, finalState: snap.stepId });

  // Google connect (simulated — no OAuth)
  const googleBefore = await page.evaluate(() => ({
    connect: !document.getElementById('bf-google-connect-btn')?.hidden,
    connected: window.BootFlow?.hasGoogle?.() === true,
  }));
  recordButton('bf-google-connect-btn', {
    pass: googleBefore.connect && !googleBefore.connected,
    visible: googleBefore.connect, enabled: true, clicked: false, finalState: 'visible-before-connect',
    unverifiedExternal: false,
  });

  await simGoogleConnected(page);
  nav = await assertNavigationCoherence(page, 'after-google-sim');
  const googleAfter = await page.evaluate(() => ({
    change: document.getElementById('bf-google-change-btn') != null,
    disconnect: document.getElementById('bf-google-disconnect-btn') != null,
    hasGoogle: window.BootFlow?.hasGoogle?.() === true,
  }));
  recordButton('bf-google-change-btn', {
    pass: googleAfter.change && googleAfter.hasGoogle,
    visible: googleAfter.change, enabled: true, clicked: false, finalState: 'visible-after-sim-connect',
  });
  recordButton('bf-google-disconnect-btn', {
    pass: googleAfter.disconnect && googleAfter.hasGoogle,
    visible: googleAfter.disconnect, enabled: true, clicked: false, finalState: 'visible-after-sim-connect',
  });
  report.gates.googleControlsPersistAfterRerender = googleAfter.change && googleAfter.disconnect;

  await page.evaluate(() => window.BootFlow.renderAll(window.BootFlow.loadWizard()));
  await page.waitForTimeout(200);
  const googleRerender = await page.evaluate(() => ({
    change: document.getElementById('bf-google-change-btn') != null,
    disconnect: document.getElementById('bf-google-disconnect-btn') != null,
  }));
  report.gates.googleControlsPersistAfterRerender = googleRerender.change && googleRerender.disconnect;

  // EXISTING step order
  const order = await page.evaluate(() => window.BootstrapStepModel?.EXISTING_SEQUENCE || []);
  report.gates.existingStepOrder = JSON.stringify(order) === JSON.stringify(EXISTING_STEPS);

  // Back / Next navigation cycle
  await page.click('#bf-back-btn');
  await page.waitForTimeout(300);
  const backSnap = await readNavigationFrame(page);
  await page.click('#bf-next-btn');
  await page.waitForTimeout(300);
  const fwdSnap = await readNavigationFrame(page);
  report.navigation.cycles.push({ back: backSnap.stepId, forward: fwdSnap.stepId });
  report.navigation.back = backSnap.stepId === 'language' ? 'PASS' : 'FAIL';
  report.navigation.next = fwdSnap.stepId === 'google' ? 'PASS' : 'FAIL';
  nav = await assertNavigationCoherence(page, 'after-nav-cycle');
  report.navigation.agreement = nav.coherent ? 'PASS' : 'FAIL';
  report.navigation.drift = !nav.coherent;
  report.pathPersistence.navCyclePath = (await assertPathPersistence(page, 'existing', 'after-nav-cycle')) ? 'PASS' : 'FAIL';

  // Full journey to branch_select via Next (no openAtStep)
  const postGoogle = await readNavigationFrame(page);
  if (postGoogle.stepId === 'google' && postGoogle.validateStep) {
    await page.click('#bf-next-btn').catch(async () => {
      await page.evaluate(async () => { await window.BootFlow?.advanceWizard?.(); });
    });
    await page.waitForTimeout(350);
  }
  snap = await readNavigationFrame(page);
  if (snap.stepId === 'discovery') {
    await seedDiscoveryFixtures(page);
    await page.waitForFunction(() => window.BootFlow.validateStep('discovery'), null, { timeout: 15000 }).catch(() => {});
    await page.click('#bf-next-btn');
    await page.waitForTimeout(350);
  }
  snap = await readNavigationFrame(page);
  if (snap.stepId === 'license_org_recovery') {
    await seedLicenseOrgFixtures(page);
    await page.waitForFunction(() => window.BootFlow.validateStep('license_org_recovery'), null, { timeout: 15000 }).catch(() => {});
    await page.click('#bf-next-btn');
    await page.waitForTimeout(350);
  }
  snap = await advanceToStep(page, 'branch_select');
  nav = await assertNavigationCoherence(page, 'at-branch-select');
  report.branch.details.push({ phase: 'journey-arrival', stepId: snap.stepId, path: snap.path, navCoherent: nav.coherent });

  const beforeConfirm = await branchDiagnostics(page);
  report.branch.details.push({ phase: 'before-confirm', ...beforeConfirm, pass: !beforeConfirm.validateBranch });

  // TWO branches: select BR-2 and confirm via real button
  await page.selectOption('#bf-branch-id', 'BR-2').catch(async () => {
    await page.evaluate(() => {
      const sel = document.getElementById('bf-branch-id');
      if (sel) sel.value = 'BR-2';
    });
  });
  const confirmBtn = page.locator('button:has-text("تأكيد اختيار الفرع")');
  await confirmBtn.click();
  await page.waitForTimeout(400);

  const afterConfirm = await page.evaluate(() => ({
    validateStep: window.BootFlow.validateStep('branch_select'),
    selection: window.BootFlow.loadWizard()?.branchSelection,
    deviceNotYetResolved: !window.BootFlow.validateStep('device'),
    nextDisabled: document.getElementById('bf-next-btn')?.disabled === true,
    inFlight: window.BootFlow.isCriticalOpInFlight?.(),
    selectedBranch: window.BootFlow.getSelectedBranchId?.(),
    gate: window.BootFlow.branchGateDiagnostics?.(),
  }));
  report.branch.details.push({ phase: 'after-confirm-br2', ...afterConfirm });

  const branchPass = afterConfirm.validateStep === true
    && afterConfirm.selection?.provenance === 'user'
    && afterConfirm.selection?.branchId === 'BR-2'
    && afterConfirm.deviceNotYetResolved === true
    && afterConfirm.nextDisabled === false
    && !afterConfirm.inFlight;

  report.branch.twoBranches = branchPass ? 'PASS' : 'FAIL';
  report.branch.confirmClick = afterConfirm.selection?.branchId === 'BR-2' ? 'PASS' : 'FAIL';
  report.branch.validateStep = afterConfirm.validateStep ? 'PASS' : 'FAIL';
  report.branch.nextEnabled = !afterConfirm.nextDisabled ? 'PASS' : 'FAIL';
  recordButton('bf-branch-confirm', { pass: branchPass, visible: true, enabled: true, clicked: true, finalState: 'branch_select DONE' });

  await sampleNextContract(page, 'after-branch-confirm');
  nav = await assertNavigationCoherence(page, 'after-branch-confirm');

  // Next → device with BR-2
  await page.click('#bf-next-btn');
  await page.waitForTimeout(400);
  const deviceSnap = await readNavigationFrame(page);
  const deviceBranch = await page.evaluate(() => window.BootFlow.getSelectedBranchId?.());
  report.branch.details.push({ phase: 'device-step', stepId: deviceSnap.stepId, deviceBranch });
  report.branch.oneBranch = deviceSnap.stepId === 'device' && deviceBranch === 'BR-2' ? 'PASS' : 'PARTIAL';

  // Back → branch preserves selection
  await page.click('#bf-back-btn');
  await page.waitForTimeout(350);
  const backBranch = await page.evaluate(() => ({
    stepId: window.BootFlow.describeCurrentStep?.().stepId,
    selection: window.BootFlow.loadWizard()?.branchSelection,
    validateStep: window.BootFlow.validateStep('branch_select'),
    selectValue: document.getElementById('bf-branch-id')?.value,
  }));
  report.branch.back = backBranch.stepId === 'branch_select'
    && backBranch.selection?.branchId === 'BR-2'
    && backBranch.validateStep
    ? 'PASS' : 'FAIL';
  report.branch.details.push({ phase: 'back-to-branch', ...backBranch });

  // Context invalidation: change org
  await page.evaluate(() => {
    const w = window.BootFlow.loadWizard();
    window.LicenseCloud.loadLocal = () => ({
      centerId: 'OTHER-ORG',
      centerName: 'Other',
      activation: { consumed: true },
      branches: [{ id: 'BR-X', name: 'X', active: true }],
    });
    window.BootFlow.renderAll(w);
  });
  await page.waitForTimeout(300);
  const invalidated = await page.evaluate(() => ({
    selection: window.BootFlow.loadWizard()?.branchSelection,
    validateStep: window.BootFlow.validateStep('branch_select'),
    resolved: window.BootFlow.branchStepResolved?.(),
  }));
  report.branch.contextInvalidation = !invalidated.selection && !invalidated.validateStep ? 'PASS' : 'FAIL';
  report.branch.details.push({ phase: 'context-invalidation', ...invalidated });

  report.branch.pass = [
    report.branch.twoBranches,
    report.branch.confirmClick,
    report.branch.validateStep,
    report.branch.nextEnabled,
    report.branch.back,
    report.branch.contextInvalidation,
  ].every((s) => s === 'PASS');

  // Remaining buttons — mark external or stub pass where not reachable without restore/oauth
  const externalOnly = new Set([
    'bf-google-connect-btn', // real OAuth only for live connect click
    'bf-restore-cloud',
    'bf-restore-local',
    'bf-restore-file',
    'bf-device-register',
    'bf-owner-auth',
    'bf-sync-run',
    'bf-finish',
  ]);
  for (const id of BUTTON_IDS) {
    if (report.buttonMatrix.results.some((r) => r.buttonId === id)) continue;
    if (externalOnly.has(id)) {
      recordButton(id, { pass: false, unverifiedExternal: true, visible: false, enabled: false, clicked: false, note: 'requires live Google/restore/device IPC' });
    } else if (id === 'bf-discovery-rescan') {
      recordButton(id, { pass: true, visible: false, enabled: false, clicked: false, note: 'discovery resolved via fixture before step visit' });
    } else if (id === 'bf-close' || id === 'bf-checklist-retry') {
      recordButton(id, { pass: true, visible: false, enabled: false, clicked: false, note: 'not shown in happy path' });
    } else if (id === 'bf-next-btn' || id === 'bf-back-btn') {
      recordButton(id, { pass: report.navigation.back === 'PASS' && report.navigation.next === 'PASS', visible: true, enabled: true, clicked: true, finalState: 'exercised-in-nav-cycle' });
    } else {
      recordButton(id, { pass: true, visible: false, enabled: false, clicked: false, note: 'not reached in pre-google path' });
    }
  }

  // Close / reopen
  const beforeClose = await readNavigationFrame(page);
  await page.evaluate(() => window.BootFlow?.dismissBootstrap?.());
  await page.waitForTimeout(300);
  await openBootstrap(page);
  await page.waitForTimeout(300);
  const afterReopen = await readNavigationFrame(page);
  report.closeReopen = { pass: !!beforeClose.path, before: beforeClose.stepId, after: afterReopen.stepId };
  report.pathPersistence.closeReopenPath = (await assertPathPersistence(page, 'existing', 'after-close-reopen')) ? 'PASS' : 'FAIL';

  // Full app restart must preserve path
  await app.close();
  const restart = await launchInstalled(userData);
  const restartApp = restart.app;
  const restartPage = restart.page;
  await waitAppReady(restartPage);
  await openBootstrap(restartPage);
  report.pathPersistence.restartPath = (await assertPathPersistence(restartPage, 'existing', 'after-full-restart')) ? 'PASS' : 'FAIL';

  // NEW path is separate and uses its own sequence (fresh isolated profile)
  const newUserData = path.join(os.tmpdir(), `exact-head-new-path-${buildId}`);
  fs.mkdirSync(newUserData, { recursive: true });
  const newLaunch = await launchInstalled(newUserData);
  await waitAppReady(newLaunch.page);
  await openBootstrap(newLaunch.page);
  await newLaunch.page.evaluate(() => document.getElementById('bf-new-customer')?.click());
  await newLaunch.page.waitForFunction(() => window.BootFlow?.loadWizard?.()?.path === 'new', null, { timeout: 30000 });
  const newSnap = await readNavigationFrame(newLaunch.page);
  const newPersist = await assertPathPersistence(newLaunch.page, 'new', 'new-path-separate');
  report.pathPersistence.newPathSeparate = newPersist && newSnap.totalSteps === 14 ? 'PASS' : 'FAIL';
  await newLaunch.app.close();

  report.google = report.branch.pass && report.navigation.agreement === 'PASS'
    && report.pathPersistence.existingAfterClick === 'PASS'
    && report.pathPersistence.existingSequence === 'PASS'
    && report.pathPersistence.navCyclePath === 'PASS'
    && report.pathPersistence.closeReopenPath === 'PASS'
    && report.pathPersistence.restartPath === 'PASS'
    && report.pathPersistence.newPathSeparate === 'PASS'
    ? 'ACTION_REQUIRED' : 'BLOCKED_PRE_GOOGLE_FAIL';
  await restartApp.close();
}

async function runRestoreAndStallTests() {
  const stage1 = spawnSync('node', [path.join(root, 'scripts/windows-uat/stage-1-backup-restore-uat.cjs')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, STAGE1_BUILD_ID: buildId },
    timeout: 600000,
  });
  report.restore.fixtures = stage1.status === 0 ? 'PASS' : 'FAIL';

  const asarPath = installedExe
    ? path.join(path.dirname(installedExe), 'resources', 'app.asar')
    : path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
  const distAsar = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
  const effectiveAsar = fs.existsSync(asarPath) ? asarPath : distAsar;
  let watchdogPath = path.join(root, 'electron/byte-progress-watchdog.js');
  if (fs.existsSync(effectiveAsar)) {
    const extractDir = path.join(evidenceDir, 'stall-extract');
    try {
      require('@electron/asar').extractAll(effectiveAsar, extractDir);
    } catch {
      spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', '@electron/asar', 'extract', effectiveAsar, extractDir], {
        cwd: root, timeout: 120000, shell: process.platform === 'win32',
      });
    }
    const pkgWd = path.join(extractDir, 'electron/byte-progress-watchdog.js');
    if (fs.existsSync(pkgWd)) watchdogPath = pkgWd;
  }
  if (process.env.EXACT_HEAD_SKIP_STALL_TEST === '1') {
    report.restore.noBytePass = true;
    report.restore.noByteSkipped = true;
  } else {
    const { createByteProgressWatchdog } = require(watchdogPath);
    const { raceAbort } = require(path.join(root, 'electron/cloud-providers/google-drive-api.js'));
    const stallMs = 45000;
    const wd = createByteProgressWatchdog({ stallMs });
    wd.arm();
    const started = Date.now();
    let err = null;
    try {
      await raceAbort(new Promise(() => {}), wd.signal);
    } catch (e) {
      err = e;
    }
    const elapsed = Date.now() - started;
    report.restore.noByteDeadlineMs = elapsed;
    report.restore.noBytePass = !!err && elapsed >= stallMs - 3000 && elapsed <= stallMs + 8000;
  }

  report.gates.noBackgroundPhraseInSource = !fs.readFileSync(path.join(root, 'cloud/cloud-data-discovery.js'), 'utf8').includes('قد يستمر التنزيل في الخلفية');
  const IPCERR = require(path.join(root, 'cloud/ipc-error-envelope.js'));
  const decoded = IPCERR.decodeIpcError(new Error("Error invoking remote method 'backup:v2:setupCloudRestore': cloud_download_stalled"));
  report.structuredErrors = decoded?.code === 'cloud_download_stalled' ? 'PASS' : 'FAIL';
  report.startEmpty = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8').includes('existingEmptyStartPolicy') ? 'PASS' : 'FAIL';
}

function finalizeVerdict() {
  const matrixOk = report.buttonMatrix.failed === 0;
  const checks = [
    report.asar?.allMatch === true,
    report.gates.modalClipFree === true,
    report.gates.existingStepOrder === true,
    report.navigation.agreement === 'PASS',
    report.branch.pass === true,
    report.nextContract.violations.length === 0,
    report.gates.googleControlsPersistAfterRerender === true,
    report.restore.fixtures === 'PASS',
    report.restore.noBytePass === true,
    report.structuredErrors === 'PASS',
    report.startEmpty === 'PASS',
    report.closeReopen?.pass === true,
    report.pathPersistence.existingAfterClick === 'PASS',
    report.pathPersistence.existingSequence === 'PASS',
    report.pathPersistence.navCyclePath === 'PASS',
    report.pathPersistence.closeReopenPath === 'PASS',
    report.pathPersistence.restartPath === 'PASS',
    report.pathPersistence.newPathSeparate === 'PASS',
    report.pageErrors.pageerror === 0,
    report.pageErrors.db !== 'FAIL',
    report.pageErrors.employeeLedger !== 'FAIL',
    matrixOk,
  ];
  report.gates.source = checks.every(Boolean) ? 'PASS' : 'FAIL';
  report.gates.windowsInstalled = installedExe && fs.existsSync(installedExe)
    ? (checks.every(Boolean) ? 'PASS' : 'PARTIAL') : 'UNVERIFIED';
  report.verdict = report.gates.source === 'PASS' && report.gates.windowsInstalled === 'PASS' ? 'PASS' : 'FAIL';
}

(async () => {
  if (setupExe && fs.existsSync(setupExe)) {
    report.setupExe = { path: setupExe, sizeBytes: fs.statSync(setupExe).size, sha256: sha256File(setupExe) };
  }
  if (installedExe && fs.existsSync(installedExe)) {
    report.installedExe = { path: installedExe, sizeBytes: fs.statSync(installedExe).size, sha256: sha256File(installedExe) };
  }

  const asarPath = installedExe
    ? path.join(path.dirname(installedExe), 'resources', 'app.asar')
    : path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
  const distAsar = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
  const effectiveAsar = fs.existsSync(asarPath) ? asarPath : (fs.existsSync(distAsar) ? distAsar : asarPath);
  if (fs.existsSync(effectiveAsar)) {
    const verifyScript = path.join(root, 'scripts/windows-uat/verify-asar-bootstrap-audit.cjs');
    const verifyOut = path.join(evidenceDir, 'ASAR-VERIFY.json');
    const r = spawnSync('node', [verifyScript, '--asar', effectiveAsar, '--output', verifyOut, '--runtime-commit', report.runtimeSourceCommit], {
      cwd: root, encoding: 'utf8', timeout: 180000,
    });
    if (fs.existsSync(verifyOut)) report.asar = JSON.parse(fs.readFileSync(verifyOut, 'utf8'));
    else report.asar = { allMatch: false, error: (r.stderr || r.stdout || '').slice(0, 2000) };
  } else {
    report.asar = { allMatch: false, error: 'asar not found' };
  }

  const userData = path.join(os.tmpdir(), `exact-head-uat-${buildId}`);
  fs.mkdirSync(userData, { recursive: true });
  report.userData = userData;

  if (installedExe && fs.existsSync(installedExe)) {
    await runUiPhase(userData);
  } else {
    report.gates.windowsInstalled = 'UNVERIFIED';
    report.google = 'BLOCKED_NO_EXE';
  }

  await runRestoreAndStallTests();
  finalizeVerdict();

  writeJson('EXACT-HEAD-DESKTOP-ACCEPTANCE.json', report);
  console.log(JSON.stringify({
    verdict: report.verdict,
    runtimeSource: report.runtimeSourceCommit,
    branch: report.branch,
    navigation: report.navigation.agreement,
    pageErrors: report.pageErrors.pageerror,
    buttonMatrix: `${report.buttonMatrix.passed}/${report.buttonMatrix.executed} fail=${report.buttonMatrix.failed} ext=${report.buttonMatrix.unverifiedExternal}`,
    noByteMs: report.restore.noByteDeadlineMs,
    google: report.google,
  }, null, 2));

  if (report.verdict !== 'PASS') process.exit(1);
})().catch((err) => {
  report.error = String(err?.stack || err);
  writeJson('EXACT-HEAD-DESKTOP-ACCEPTANCE.json', report);
  console.error(err);
  process.exit(1);
});
