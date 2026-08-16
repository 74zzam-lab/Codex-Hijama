#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');

function loadFresh(relative) {
  const resolved = require.resolve(path.join(root, relative));
  delete require.cache[resolved];
  return require(resolved);
}

async function check(name, operation) {
  try {
    await operation();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}: ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  await check('BUG-1 setupCommitGoogleConnection is public and allowlisted', async () => {
    const rbac = loadFresh('electron/rbac-session.js');
    assert.strictEqual(rbac.sessionAllowsChannel(null, 'database:setupCommitGoogleConnection').ok, true);
    const preload = fs.readFileSync(path.join(root, 'electron/preload.js'), 'utf8');
    assert.match(preload, /database:setupCommitGoogleConnection/);
    assert.match(preload, /setupCommitGoogleConnection/);
    const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
    assert.match(main, /handle\('database:setupCommitGoogleConnection'/);
  });

  await check('BUG-1 Google connect path never calls persistData for settings', async () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(html, /async function commitGoogleConnectionForSetup/);
    assert.match(html, /setupCommitGoogleConnection/);
    const saveStart = html.indexOf('async function saveGoogleOAuthFromResult');
    const saveEnd = html.indexOf('function licUpdateLoginDriveBootstrapPanel', saveStart);
    assert.ok(saveStart > 0 && saveEnd > saveStart, 'saveGoogleOAuthFromResult bounds');
    const saveBody = html.slice(saveStart, saveEnd);
    assert.match(saveBody, /commitGoogleConnectionForSetup/);
    assert.doesNotMatch(saveBody, /persistData\('settings'/);
    const syncStart = html.indexOf('async function syncCloudStatusFromElectron');
    const syncEnd = html.indexOf('function formatBackupDateTime', syncStart);
    assert.ok(syncStart > 0 && syncEnd > syncStart, 'syncCloudStatusFromElectron bounds');
    const syncBody = html.slice(syncStart, syncEnd);
    assert.match(syncBody, /commitGoogleConnectionForSetup/);
    assert.doesNotMatch(syncBody, /persistData\('settings'/);
  });

  await check('BUG-1 DriveAdapter ensureConnected uses setup Google commit', async () => {
    const src = fs.readFileSync(path.join(root, 'cloud/drive-adapter.js'), 'utf8');
    assert.match(src, /commitGoogleConnectionForSetup/);
  });

  await check('BUG-1 discovery refreshes Google with acceptLiveReconnect before gate', async () => {
    const src = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
    const start = src.indexOf('async function runDiscoveryGate');
    const end = src.indexOf('async function runGoogleConnect', start);
    const body = src.slice(start, end);
    assert.match(body, /refreshGoogleConnectionState\(\{\s*acceptLiveReconnect:\s*true/);
  });

  await check('BUG-1 rbac_session_required has Arabic policy message (not generic unexpected)', async () => {
    loadFresh('cloud/bootstrap-failure-policy-contract.js');
    const n = global.BootstrapFailurePolicyContract.normalizeFailure(
      { code: 'rbac_session_required' },
      { stepId: 'discovery' },
    );
    assert.strictEqual(n.rawCode, 'rbac_session_required');
    assert.match(n.code, /RBAC/i);
    assert.doesNotMatch(n.message, /غير متوقع/);
    assert.match(n.message, /جلسة/);
  });

  await check('BUG-2 Main ByteProgressWatchdog aborts after stall without first byte', async () => {
    const { createByteProgressWatchdog } = loadFresh('electron/byte-progress-watchdog.js');
    const events = [];
    const watchdog = createByteProgressWatchdog({
      stallMs: 80,
      onStall: (err) => events.push(err.code),
    });
    watchdog.arm();
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(watchdog.signal.aborted, true);
    assert.strictEqual(watchdog.getState().stalled, true);
    assert.ok(events.includes('cloud_download_stalled'));
    watchdog.disarm();
  });

  await check('BUG-2 Main watchdog resets only on real byte growth', async () => {
    const { createByteProgressWatchdog } = loadFresh('electron/byte-progress-watchdog.js');
    const watchdog = createByteProgressWatchdog({ stallMs: 120 });
    watchdog.arm();
    watchdog.touch(0);
    watchdog.touch(0);
    await new Promise((r) => setTimeout(r, 60));
    assert.strictEqual(watchdog.signal.aborted, false);
    watchdog.touch(10);
    await new Promise((r) => setTimeout(r, 60));
    assert.strictEqual(watchdog.signal.aborted, false);
    await new Promise((r) => setTimeout(r, 120));
    assert.strictEqual(watchdog.signal.aborted, true);
    watchdog.disarm();
  });

  await check('BUG-2 downloadFileWithProgress and setupCloudRestore wire AbortSignal', async () => {
    const api = fs.readFileSync(path.join(root, 'electron/cloud-providers/google-drive-api.js'), 'utf8');
    assert.match(api, /signal/);
    assert.match(api, /abortError/);
    const ipc = fs.readFileSync(path.join(root, 'electron/backup-v2-ipc.js'), 'utf8');
    assert.match(ipc, /createByteProgressWatchdog/);
    assert.match(ipc, /signal:\s*watchdog\.signal/);
    assert.match(ipc, /cloud_download_stalled/);
    const drive = fs.readFileSync(path.join(root, 'electron/cloud-providers/google-drive.js'), 'utf8');
    assert.match(drive, /stalled/);
    assert.match(drive, /options\.signal/);
  });

  await check('BUG-2 provider abort maps to structured cloud_download_stalled', async () => {
    const ipc = fs.readFileSync(path.join(root, 'electron/backup-v2-ipc.js'), 'utf8');
    assert.match(ipc, /RETRYABLE_SETUP_RESTORE_CODES[\s\S]*cloud_download_stalled/);
    loadFresh('cloud/bootstrap-failure-policy-contract.js');
    const n = global.BootstrapFailurePolicyContract.normalizeFailure({ code: 'cloud_download_stalled' });
    assert.strictEqual(n.retryable, true);
    assert.match(n.message, /Google Drive/);
  });

  if (process.exitCode) process.exit(process.exitCode);
  console.log('All focused BUG-1/BUG-2 checks passed.');
})();
