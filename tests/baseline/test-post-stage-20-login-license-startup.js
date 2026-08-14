#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const boot = fs.readFileSync(path.join(root, 'cloud', 'boot-flow-ui.js'), 'utf8');
const errors = [];

function check(ok, name, detail) {
  if (!ok) errors.push(name + (detail ? `: ${detail}` : ''));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  check(/earlyClearLoginLicensePending/.test(html), 'early login safety net present');
  check(/async function licCheck\(options\)/.test(html), 'licCheck supports silent option');
  check(html.includes('licStatusLooksPending(el?.textContent)'), 'licCheck timeout inspects pending text');
  check(/window\.licCheck = licCheck/.test(html), 'window.licCheck exported');
  check(/withTimeout\(\s*tdwCloudV2\(\)\.init/.test(html), 'startup cloudV2 init has timeout');
  check(/global\.licCheck\(\{ silent: true \}\)/.test(boot), 'refreshGoogleConnectionState uses silent licCheck');
  check(/await withTimeout\(licCheck\(\), 4000, 'licCheck'\)/.test(html), 'Stage 20 startup timeout licCheck retained');
  check(html.includes('connected: !!p.connected'), 'BUG-EXT-009 transient google catch preserved');
  check(html.indexOf('cloud/boot-flow-ui.js') < html.indexOf('async function licCheck'), 'boot-flow script loads before licCheck');
  check((html.match(/window\.licCheck\s*=/g) || []).length === 1, 'single window.licCheck export');

  for (const rel of ['cloud/boot-flow-ui.js', 'cloud/bootstrap-coordinator.js', 'cloud/cloud-data-discovery.js']) {
    try {
      new Function(fs.readFileSync(path.join(root, rel), 'utf8'));
    } catch (e) {
      check(false, `syntax ${rel}`, e.message);
    }
  }

  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  inlineScripts.forEach((chunk, idx) => {
    try {
      new Function(chunk);
    } catch (e) {
      check(false, `inline script #${idx + 1} syntax`, e.message);
    }
  });

  const status = { textContent: 'جارٍ التحقق من الترخيص...', style: {} };
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    JSON,
    Math,
    Error,
    document: {
      getElementById(id) {
        if (id === 'login-license-status') return status;
        return null;
      },
      querySelector() { return null; }
    },
    _licStatus: 'none',
    _licBlocked: false,
    _licDaysLeft: null,
    _licExpiringSoon: false,
    licLog() {},
    licLoad() {
      if (sandbox.__throwLoad) throw sandbox.__throwLoad;
      return sandbox.__lic;
    },
    licLoadMeta() { return sandbox.__meta || {}; },
    licSaveMeta() {},
    licGetFingerprint() { return 'fp-test'; },
    licFingerprintMatch(stored, current) {
      return stored === current || stored === 'DEVICE_ANY';
    },
    licUpdateLoginDevNotice() {},
    licUpdateLoginDriveBootstrapPanel() {},
    fetchNetworkTimeQuick: async () => null,
    _licApplyLoginRestrictions() {},
    __lic: null,
    __meta: {},
    __throwLoad: null,
  };

  const chunk = html.slice(html.indexOf('let _licCheckSeq = 0;'), html.indexOf('// Apply login restrictions based on license status'));
  vm.runInNewContext(`${chunk}\nthis.licCheck = licCheck; this.finalizeLicCheckUi = finalizeLicCheckUi;`, sandbox);

  async function expectSettled(name, fn) {
    status.textContent = 'جارٍ التحقق من الترخيص...';
    status.style = {};
    sandbox._licStatus = 'none';
    sandbox.__lic = null;
    sandbox.__meta = {};
    sandbox.__throwLoad = null;
    sandbox.fetchNetworkTimeQuick = async () => null;
    await fn();
    const pending = /جار[ٍي]?\s*التحقق/.test(status.textContent || '');
    check(!pending, `${name} loading clears`, status.textContent);
  }

  await expectSettled('valid local license', async () => {
    sandbox.__lic = { expiry: '2099-12-31', fingerprint: 'fp-test', device: 'DEVICE_ANY' };
    await sandbox.licCheck();
    check(sandbox._licStatus === 'valid', 'valid local license status');
  });

  await expectSettled('missing license', async () => {
    await sandbox.licCheck();
    check(sandbox._licStatus === 'none', 'missing license status none');
  });

  await expectSettled('invalid license fingerprint', async () => {
    sandbox.__lic = { expiry: '2099-12-31', fingerprint: 'other-device' };
    await sandbox.licCheck();
    check(sandbox._licStatus === 'blocked', 'invalid license blocked');
  });

  await expectSettled('expired license', async () => {
    sandbox.__lic = { expiry: '2000-01-01', fingerprint: 'fp-test', device: 'DEVICE_ANY' };
    await sandbox.licCheck();
    check(sandbox._licStatus === 'expired', 'expired license status');
  });

  await expectSettled('sqlite failure', async () => {
    sandbox.__throwLoad = new Error('sqlite_read_failed');
    await sandbox.licCheck();
  });

  await expectSettled('timeout/no-response', async () => {
    sandbox.fetchNetworkTimeQuick = () => new Promise(() => {});
    sandbox.__lic = { expiry: '2099-12-31', fingerprint: 'fp-test', device: 'DEVICE_ANY' };
    await sandbox.licCheck();
  });

  await expectSettled('superseded check', async () => {
    sandbox.__lic = { expiry: '2099-12-31', fingerprint: 'fp-test', device: 'DEVICE_ANY' };
    const slow = sandbox.licCheck();
    await sleep(10);
    await sandbox.licCheck();
    await slow;
  });

  status.textContent = '✓ settled';
  sandbox.__lic = null;
  await sandbox.licCheck({ silent: true });
  check(status.textContent === '✓ settled', 'silent licCheck preserves settled text', status.textContent);

  status.textContent = 'جاري التحقق من الترخيص';
  sandbox.finalizeLicCheckUi('manual-finalize');
  check(!/جار/.test(status.textContent), 'finalizeLicCheckUi clears pending variant');

  if (errors.length) {
    console.error('FAIL: post-stage-20 login license startup');
    for (const e of errors) console.error(' -', e);
    process.exit(1);
  }
  console.log('OK: post-stage-20 login license startup');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
