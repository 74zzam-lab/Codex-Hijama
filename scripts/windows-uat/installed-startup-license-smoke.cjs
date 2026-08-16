#!/usr/bin/env node
'use strict';

/**
 * Installed EXE startup smoke: process must reach login/bootstrap with license verification settled.
 */
const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const exe = path.resolve(arg('exe', ''));
const userData = path.resolve(arg('user-data', ''));
const output = path.resolve(arg('output', path.join(process.cwd(), 'INSTALLED-STARTUP-LICENSE-SMOKE.json')));
const timeoutMs = Number(arg('timeout-ms', '45000')) || 45000;

if (!exe || !fs.existsSync(exe)) throw new Error(`exe missing: ${exe}`);
if (!userData) throw new Error('user-data required');

const report = {
  schema: 'installed-startup-license-smoke-v1',
  at: new Date().toISOString(),
  exe,
  userData,
  timeoutMs,
  result: 'FAIL',
  finalState: 'FAIL',
  licensePending: true,
  samples: [],
};

async function sample(page) {
  return page.evaluate(() => {
    const text = document.getElementById('login-license-status')?.textContent || '';
    const pending = /جار[ٍي]?\s*التحقق/.test(text);
    const loginHidden = document.getElementById('loginScreen')?.classList.contains('hidden');
    const bootOpen = document.getElementById('bootFlowOverlay')?.classList.contains('open');
    const ready = window.SetupStateService?.evaluateReady?.({ ignoreRestart: true })?.ready === true;
    const needsBoot = window.BootFlow?.needsBootScreen?.() === true;
    return {
      text,
      pending,
      loginHidden,
      bootOpen,
      ready,
      needsBoot,
      licStatus: typeof _licStatus !== 'undefined' ? _licStatus : null,
      hasLicCheck: typeof window.licCheck === 'function',
      hasFinalize: typeof window.finalizeLicCheckUi === 'function',
      earlyBooted: window.__loginLicenseEarlyBooted === true,
    };
  });
}

(async () => {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const app = await electron.launch({
    executablePath: exe,
    args: [`--user-data-dir=${userData}`],
    timeout: 120000,
  });
  const page = await app.firstWindow({ timeout: 120000 });
  page.on('pageerror', (err) => {
    report.pageErrors = report.pageErrors || [];
    report.pageErrors.push(String(err?.stack || err).slice(0, 500));
  });
  await page.waitForLoadState('domcontentloaded');
  const deadline = Date.now() + timeoutMs;
  let settled = null;
  while (Date.now() < deadline) {
    const snap = await sample(page);
    report.samples.push({ atMs: Date.now(), ...snap });
    if (!snap.pending) {
      settled = snap;
      break;
    }
    await page.waitForTimeout(500);
  }
  if (!settled) settled = report.samples[report.samples.length - 1] || null;
  report.licensePending = !!(settled && settled.pending);
  if (settled?.ready) report.finalState = 'LOGIN_READY';
  else if (settled?.bootOpen || settled?.needsBoot) report.finalState = 'BOOTSTRAP_REQUIRED';
  else if (settled && !settled.pending) report.finalState = 'LOGIN_READY';
  report.result = settled && !settled.pending ? 'PASS' : 'FAIL';
  report.ok = report.result === 'PASS';
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  await app.close();
  if (!report.ok) process.exit(1);
})().catch((err) => {
  report.error = String(err?.stack || err);
  try { fs.writeFileSync(output, JSON.stringify(report, null, 2)); } catch { /* empty */ }
  console.error(err);
  process.exit(1);
});
