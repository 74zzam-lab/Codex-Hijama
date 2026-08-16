#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');

function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}: ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

check('button matrix exists and covers required controls', () => {
  const matrix = JSON.parse(fs.readFileSync(
    path.join(root, 'docs/remediation/evidence/EXTERNAL-EXISTING-FINAL-RUNTIME/BOOTSTRAP-BUTTON-STATE-MATRIX.json'),
    'utf8',
  ));
  assert.strictEqual(matrix.schema, 'bootstrap-button-state-matrix-v1');
  const ids = matrix.buttons.map((b) => b.buttonId);
  for (const required of [
    'bf-next-btn', 'bf-back-btn', 'bf-google-connect-btn', 'bf-google-change-btn',
    'bf-google-disconnect-btn', 'bf-restore-cloud', 'bf-path-existing', 'bf-path-new',
  ]) {
    assert.ok(ids.includes(required), `missing ${required}`);
  }
  assert.strictEqual(matrix.restoreStall.thresholdMs, 45000);
  assert.strictEqual(matrix.restoreStall.forbidBackgroundClaim, true);
});

check('boot-flow Next uses validateStep + inFlight guard', () => {
  const boot = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
  const start = boot.indexOf('function renderNavButtons');
  const end = boot.indexOf('function renderAll', start);
  const body = boot.slice(start, end);
  assert.match(body, /bf-next-btn/);
  assert.match(body, /bf-back-btn/);
  assert.match(body, /validateStep\(step\)/);
  assert.match(body, /inFlight/);
  assert.match(body, /next\.disabled = !stepOk \|\| inFlight/);
});

check('Google change/disconnect visible when connected; connect hidden', () => {
  const boot = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
  assert.match(boot, /bf-google-change-btn/);
  assert.match(boot, /bf-google-disconnect-btn/);
  assert.match(boot, /تبديل حساب Google/);
  assert.match(boot, /فصل حساب Google/);
  const start = boot.indexOf("case 'google': {\n        const isNew");
  assert.ok(start > 0, 'google renderStepUI case');
  const end = boot.indexOf("case 'discovery': {", start);
  const body = boot.slice(start, end);
  assert.match(body, /if \(!connected\)/);
  assert.match(body, /bf-google-connect-btn/);
});

check('runGoogleConnect finally re-renders step UI after connect', () => {
  const boot = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
  const start = boot.indexOf('async function runGoogleConnect');
  const end = boot.indexOf('async function disconnectGoogleDuringSetup', start);
  const body = boot.slice(start, end);
  assert.match(body, /finally[\s\S]*renderStepUI\(w\)/);
});

check('no misleading background restore claim', () => {
  const src = fs.readFileSync(path.join(root, 'cloud/cloud-data-discovery.js'), 'utf8');
  assert.doesNotMatch(src, /قد يستمر التنزيل في الخلفية/);
  assert.match(src, /ستُلغى العملية تلقائياً|توقف تنزيل النسخة من Google Drive/);
});

check('download progress resets stall only on byte growth', () => {
  const src = fs.readFileSync(path.join(root, 'cloud/cloud-data-discovery.js'), 'utf8');
  assert.match(src, /Only real byte growth resets the stall clock/);
  assert.match(src, /if \(downloadedBytes > lastDownloadBytes\)/);
});

check('setup restore skips provider getStatus resolve and races whole download', () => {
  const ipc = fs.readFileSync(path.join(root, 'electron/backup-v2-ipc.js'), 'utf8');
  assert.match(ipc, /skipProviderResolve:\s*true/);
  assert.match(ipc, /raceAbort\(/);
  const svc = fs.readFileSync(path.join(root, 'electron/cloud-providers/cloud-service.js'), 'utf8');
  assert.match(svc, /skipProviderResolve/);
  assert.match(svc, /raceAbort\(resolveActiveProviderKey/);
});

check('stall policy Arabic terminal message', () => {
  const policySrc = fs.readFileSync(path.join(root, 'cloud/bootstrap-failure-policy-contract.js'), 'utf8');
  const sandbox = { console, global: {} };
  sandbox.global = sandbox;
  vm.runInNewContext(policySrc, sandbox);
  const n = sandbox.BootstrapFailurePolicyContract.normalizeFailure({ code: 'cloud_download_stalled' });
  assert.match(n.message, /45 ثانية/);
  assert.doesNotMatch(n.message, /الخلفية/);
});

if (process.exitCode) process.exit(process.exitCode);
console.log('OK desktop button/restore remediation assertions');
