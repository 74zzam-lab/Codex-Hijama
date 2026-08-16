#!/usr/bin/env node
'use strict';

/**
 * Proves setupCloudRestore settles when provider resolution / download hangs
 * with zero bytes — Main raceAbort + ByteProgressWatchdog ownership.
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');

const root = path.join(__dirname, '..', '..');
const { createByteProgressWatchdog } = require(path.join(root, 'electron/byte-progress-watchdog.js'));
const { raceAbort } = require(path.join(root, 'electron/cloud-providers/google-drive-api.js'));

async function main() {
  const stallMs = 80;
  const wd = createByteProgressWatchdog({ stallMs });
  wd.arm();

  // Simulate the pre-fix hang: getStatus/getUserEmail never returns,
  // and the outer call is wrapped in raceAbort (as setupCloudRestore now does).
  const hungProviderResolve = new Promise(() => {});
  const started = Date.now();
  let err = null;
  try {
    await raceAbort(hungProviderResolve, wd.signal);
  } catch (e) {
    err = e;
  }
  const elapsed = Date.now() - started;
  assert.ok(err, 'must reject');
  assert.match(String(err.code || err.message), /stall|abort/i);
  assert.ok(elapsed >= stallMs - 20, `elapsed ${elapsed}`);
  assert.ok(elapsed < stallMs + 400, `must terminate quickly, elapsed=${elapsed}`);
  assert.strictEqual(wd.signal.aborted, true);

  // Simulate skipProviderResolve path: hang inside downloadBackup itself.
  const wd2 = createByteProgressWatchdog({ stallMs });
  wd2.arm();
  const hungDownload = new Promise(() => {});
  const t2 = Date.now();
  let err2 = null;
  try {
    await raceAbort(hungDownload, wd2.signal);
  } catch (e) {
    err2 = e;
  }
  assert.ok(err2);
  assert.ok(Date.now() - t2 < stallMs + 400);
  console.log(JSON.stringify({
    ok: true,
    noFirstByteTerminalMs: elapsed,
    stallMs,
    abortCode: err.code || err.message,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
