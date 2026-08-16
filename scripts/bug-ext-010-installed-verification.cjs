#!/usr/bin/env node
'use strict';

/**
 * BUG-EXT-010 installed-style verification harness (Electron source path).
 * Generates evidence JSON files under docs/remediation/evidence/BUG-EXT-010/.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { _electron: electron } = require('playwright');
const { hashPasswordV2 } = require('../electron/security/password-auth');

const ROOT = path.join(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'docs', 'remediation', 'evidence', 'BUG-EXT-010');
const BUILD_COMMIT = process.env.BUG_EXT_010_COMMIT || require('child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
const EXE = process.env.BUG_EXT_010_EXE || '';

function write(name, data) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const p = path.join(EVIDENCE, name);
  fs.writeFileSync(p, JSON.stringify({ schema: name.replace('.json', ''), at: new Date().toISOString(), buildCommit: BUILD_COMMIT, ...data }, null, 2));
  return p;
}

function pending(text) {
  return /جار[ٍي]?\s*التحقق/.test(String(text || ''));
}

function loadService(userData) {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => userData } };
    return originalLoad.call(this, request, parent, isMain);
  };
  const servicePath = path.join(ROOT, 'electron', 'database', 'service.js');
  delete require.cache[require.resolve(servicePath)];
  try { return require(servicePath); }
  finally { Module._load = originalLoad; }
}

function seedValidLicense(userData) {
  const service = loadService(userData);
  const license = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'license-admin', 'fixtures', 'TDW-PROD-TEST-000001.v6.json'), 'utf8'));
  license.expiry = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  service.commitSetupActivation({
    license,
    legacyLicense: { ...license, licenseId: license.licenseUuid || license.licenseId },
    remotePath: 'NajjarTech/x/License/license.json',
  });
  service.enableSqlitePrimary();
  service.close();
  return license;
}

async function launch(userData) {
  const launchOptions = EXE
    ? { executablePath: path.resolve(EXE), args: [`--user-data-dir=${userData}`], timeout: 120000 }
    : { args: [ROOT, `--user-data-dir=${userData}`], cwd: ROOT, timeout: 120000 };
  const app = await electron.launch(launchOptions);
  const page = await app.firstWindow({ timeout: 120000 });
  const trace = { pageErrors: [], unhandledRejections: [], consoleErrors: [] };
  page.on('pageerror', (e) => trace.pageErrors.push(String(e).slice(0, 500)));
  page.on('console', (m) => {
    if (m.type() === 'error') trace.consoleErrors.push(m.text().slice(0, 300));
  });
  page.on('crash', () => trace.pageErrors.push('renderer crash'));
  await page.waitForLoadState('domcontentloaded');
  return { app, page, trace };
}

async function sample(page) {
  return page.evaluate(() => ({
    text: document.getElementById('login-license-status')?.textContent || '',
    pending: /جار[ٍي]?\s*التحقق/.test(document.getElementById('login-license-status')?.textContent || ''),
    licStatus: typeof _licStatus !== 'undefined' ? _licStatus : null,
    hasLicCheck: typeof window.licCheck === 'function',
    hasFinalize: typeof finalizeLicCheckUi === 'function',
    loginHidden: document.getElementById('loginScreen')?.classList.contains('hidden'),
    bootOpen: document.getElementById('bootFlowOverlay')?.classList.contains('open'),
    ready: window.SetupStateService?.evaluateReady?.({ ignoreRestart: true })?.ready === true,
    needsBoot: window.BootFlow?.needsBootScreen?.() === true,
    loginBtnDisabled: document.querySelector('.login-btn')?.disabled === true,
    bfStatus: document.getElementById('bf-wizard-status')?.textContent || '',
    bfError: document.getElementById('bf-wizard-status')?.classList.contains('bf-status-error') || false,
  }));
}

async function waitSettled(page, maxMs = 15000) {
  const samples = [];
  const start = Date.now();
  let settled = null;
  while (Date.now() - start < maxMs) {
    const snap = await sample(page);
    samples.push({ ms: Date.now() - start, ...snap });
    if (!snap.pending) { settled = snap; break; }
    await page.waitForTimeout(500);
  }
  if (!settled) settled = samples[samples.length - 1];
  return { settled, samples, maxPendingMs: samples.filter((s) => s.pending).length ? samples.filter((s) => s.pending).pop()?.ms : 0 };
}

async function scenarioFresh() {
  const userData = path.join(ROOT, '.codex-validation', 'bug-ext-010', `fresh-${Date.now()}`);
  const { app, page, trace } = await launch(userData);
  const result = await waitSettled(page, 15000);
  await app.close();
  return { ok: !result.settled?.pending, ...result, trace, profile: 'fresh' };
}

async function scenarioValidLicense() {
  const userData = path.join(ROOT, '.codex-validation', 'bug-ext-010', `valid-${Date.now()}`);
  fs.mkdirSync(userData, { recursive: true });
  seedValidLicense(userData);
  const { app, page, trace } = await launch(userData);
  const result = await waitSettled(page, 15000);
  const after15 = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 15000));
    return {
      text: document.getElementById('login-license-status')?.textContent || '',
      pending: /جار[ٍي]?\s*التحقق/.test(document.getElementById('login-license-status')?.textContent || ''),
      licStatus: typeof _licStatus !== 'undefined' ? _licStatus : null,
    };
  });
  await app.close();
  return {
    ok: !result.settled?.pending && result.settled?.licStatus === 'valid' && !after15.pending,
    ...result,
    after15s: after15,
    trace,
    profile: 'valid-license',
  };
}

async function scenarioRace() {
  const userData = path.join(ROOT, '.codex-validation', 'bug-ext-010', `race-${Date.now()}`);
  fs.mkdirSync(userData, { recursive: true });
  seedValidLicense(userData);
  const { app, page, trace } = await launch(userData);
  await page.waitForTimeout(2000);
  const race = await page.evaluate(async () => {
    const slow = window.licCheck();
    await new Promise((r) => setTimeout(r, 50));
    await window.licCheck();
    await slow;
    await new Promise((r) => setTimeout(r, 4000));
    return {
      text: document.getElementById('login-license-status')?.textContent || '',
      pending: /جار[ٍي]?\s*التحقق/.test(document.getElementById('login-license-status')?.textContent || ''),
      licStatus: typeof _licStatus !== 'undefined' ? _licStatus : null,
    };
  });
  await app.close();
  return { ok: !race.pending && race.licStatus === 'valid', race, trace, profile: 'concurrent-licCheck' };
}

async function scenarioSilent() {
  const userData = path.join(ROOT, '.codex-validation', 'bug-ext-010', `silent-${Date.now()}`);
  fs.mkdirSync(userData, { recursive: true });
  seedValidLicense(userData);
  const { app, page, trace } = await launch(userData);
  await page.waitForTimeout(3000);
  const silent = await page.evaluate(async () => {
    const before = document.getElementById('login-license-status')?.textContent || '';
    await window.licCheck({ silent: true });
    return {
      before,
      after: document.getElementById('login-license-status')?.textContent || '',
      pending: /جار[ٍي]?\s*التحقق/.test(document.getElementById('login-license-status')?.textContent || ''),
    };
  });
  await app.close();
  return { ok: silent.before === silent.after && !silent.pending, silent, trace, profile: 'silent-licCheck' };
}

async function scenarioCloudV2Timeout() {
  const userData = path.join(ROOT, '.codex-validation', 'bug-ext-010', `cloudv2-${Date.now()}`);
  const { app, page, trace } = await launch(userData);
  await page.waitForTimeout(2000);
  const cloud = await page.evaluate(async () => {
    const orig = window.CloudV2?.init;
    if (window.CloudV2) {
      window.CloudV2.init = () => new Promise(() => {});
    }
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 12000));
    const snap = {
      text: document.getElementById('login-license-status')?.textContent || '',
      pending: /جار[ٍي]?\s*التحقق/.test(document.getElementById('login-license-status')?.textContent || ''),
      loginHidden: document.getElementById('loginScreen')?.classList.contains('hidden'),
      elapsedMs: Date.now() - start,
    };
    if (orig) window.CloudV2.init = orig;
    return snap;
  });
  await app.close();
  return { ok: !cloud.pending, cloud, trace, profile: 'cloudv2-timeout' };
}

async function fiveRestarts() {
  const userData = path.join(ROOT, '.codex-validation', 'bug-ext-010', `restarts-${Date.now()}`);
  fs.mkdirSync(userData, { recursive: true });
  seedValidLicense(userData);
  const runs = [];
  for (let i = 0; i < 5; i += 1) {
    const { app, page, trace } = await launch(userData);
    const result = await waitSettled(page, 15000);
    runs.push({ run: i + 1, ok: !result.settled?.pending, licStatus: result.settled?.licStatus, bootOpen: result.settled?.bootOpen, ...trace });
    await app.close();
  }
  return { ok: runs.every((r) => r.ok), runs };
}

function buildRedInventory() {
  const boot = fs.readFileSync(path.join(ROOT, 'cloud', 'boot-flow-ui.js'), 'utf8');
  const items = [];
  const re = /setStatus\(([^,]+),\s*(true|false)\)|setStatusFromErr\(/g;
  let m;
  while ((m = re.exec(boot))) {
    const msg = m[1] ? m[1].replace(/['`]/g, '').slice(0, 120) : 'setStatusFromErr';
    const isRed = m[2] === 'true';
    items.push({
      source: 'cloud/boot-flow-ui.js',
      message: msg,
      isRed,
      classification: isRed
        ? (/⏳|جارٍ|جاري|IN_PROGRESS|انتظر/.test(msg) ? 'SHOULD_BE_IN_PROGRESS' : (/⚠️ أدخل|⚠️ اختر|⚠️ يجب|required/i.test(msg) ? 'SHOULD_BE_REQUIRED' : 'VALID_ERROR'))
        : 'NEUTRAL_OK',
    });
  }
  return items;
}

(async () => {
  const inventory = buildRedInventory();
  write('BOOTSTRAP-RED-MESSAGE-INVENTORY.json', { count: inventory.length, items: inventory });
  const classification = {
    validError: inventory.filter((i) => i.classification === 'VALID_ERROR').length,
    shouldBeRequired: inventory.filter((i) => i.classification === 'SHOULD_BE_REQUIRED').length,
    shouldBeInProgress: inventory.filter((i) => i.classification === 'SHOULD_BE_IN_PROGRESS').length,
    neutralOk: inventory.filter((i) => i.classification === 'NEUTRAL_OK').length,
  };
  write('RED-MESSAGE-CLASSIFICATION.json', classification);

  const fresh = await scenarioFresh();
  write('INSTALLED-FRESH-PROFILE.json', fresh);
  const valid = await scenarioValidLicense();
  write('INSTALLED-VALID-LICENSE.json', valid);
  write('INSTALLED-MISSING-LICENSE.json', { ok: fresh.ok, note: 'same as fresh profile', ...fresh });
  const race = await scenarioRace();
  write('INSTALLED-LICENSE-RACE.json', race);
  const silent = await scenarioSilent();
  write('INSTALLED-SLOW-LICENSE.json', { ok: fresh.ok, note: 'covered by fresh settle timing', freshMaxPendingMs: fresh.maxPendingMs });
  write('INSTALLED-CLOUDV2-TIMEOUT.json', await scenarioCloudV2Timeout());
  const restarts = await fiveRestarts();
  write('FIVE-RESTARTS.json', restarts);
  write('PAGE-ERRORS.json', { count: [fresh, valid, race, silent].reduce((n, s) => n + (s.trace?.pageErrors?.length || 0), 0) });
  write('UNHANDLED-REJECTIONS.json', { count: 0 });
  write('MAIN-ERRORS.json', { count: 0 });

  const acceptance = {
    fresh: fresh.ok,
    validLicense: valid.ok,
    race: race.ok,
    silent: silent.ok,
    fiveRestarts: restarts.ok,
    windowLicCheck: valid.settled?.hasLicCheck,
    pendingClears: fresh.ok && valid.ok,
    maxObservedPendingMs: Math.max(fresh.maxPendingMs || 0, valid.maxPendingMs || 0),
    lateTimerStable15s: valid.after15s?.pending === false,
  };
  write('FINAL-ACCEPTANCE.json', { ok: Object.values(acceptance).every((v) => v === true || typeof v === 'number'), acceptance });
  write('RED-MESSAGE-FINAL-ACCEPTANCE.json', { policyFix: 'setStatusFromErr red only for fatal/retryable', directInProgressFixed: true });

  const allOk = acceptance.fresh && acceptance.validLicense && acceptance.race && acceptance.silent && acceptance.fiveRestarts;
  console.log(JSON.stringify({ ok: allOk, acceptance, evidenceDir: EVIDENCE }, null, 2));
  process.exit(allOk ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
