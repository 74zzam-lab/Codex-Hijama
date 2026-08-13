#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const discoveryPath = path.join(root, 'electron/cloud-data-discovery.js');
const driveApiPath = path.join(root, 'electron/cloud-providers/google-drive-api.js');
const googleDrivePath = path.join(root, 'electron/cloud-providers/google-drive.js');
const rendererPath = path.join(root, 'cloud/cloud-data-discovery.js');
const bootFlowPath = path.join(root, 'cloud/boot-flow-ui.js');

const results = [];
async function check(name, operation) {
  try {
    await operation();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.stack || error.message });
    console.error(`FAIL  ${name}: ${error.message}`);
  }
}

function loadDiscoveryWithMocks(driveApi, googleDrive) {
  const previousApi = require.cache[driveApiPath];
  const previousDrive = require.cache[googleDrivePath];
  delete require.cache[discoveryPath];
  require.cache[driveApiPath] = { id: driveApiPath, filename: driveApiPath, loaded: true, exports: driveApi };
  require.cache[googleDrivePath] = { id: googleDrivePath, filename: googleDrivePath, loaded: true, exports: googleDrive };
  const moduleUnderTest = require(discoveryPath);
  return {
    moduleUnderTest,
    restore() {
      delete require.cache[discoveryPath];
      if (previousApi) require.cache[driveApiPath] = previousApi;
      else delete require.cache[driveApiPath];
      if (previousDrive) require.cache[googleDrivePath] = previousDrive;
      else delete require.cache[googleDrivePath];
    },
  };
}

function loadRendererDiscovery(cloudOperation) {
  let running = true;
  let starts = 0;
  let stops = 0;
  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    AbortController,
    Promise,
    Date,
    DB: { get: () => null },
    SqliteBridge: { isPrimary: () => true },
    SyncState: { load: () => ({ pollIntervalMs: 1234 }) },
    SyncEngine: {
      isRunning: () => running,
      stop: () => { stops += 1; running = false; },
      start: () => { starts += 1; running = true; },
    },
    cuppingElectron: {
      backup: {
        discoverCloudRestorePoints: cloudOperation,
        v2ListLocal: async () => ({ ok: true, files: [] }),
        onDiscoveryProgress: () => {},
      },
    },
    module: { exports: {} },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(rendererPath, 'utf8'), context, { filename: rendererPath });
  return { api: context.CloudDataDiscovery, state: () => ({ running, starts, stops }) };
}

(async () => {
  await check('paginates every Drive page and retries transient failures', async () => {
    let call = 0;
    let transientInjected = false;
    const driveApi = {
      listFiles: async (_oauth, options) => {
        if (!transientInjected) {
          transientInjected = true;
          const error = new Error('429 rate limit');
          error.code = 429;
          throw error;
        }
        call += 1;
        const page = options.pageToken ? Number(options.pageToken) : 1;
        return {
          files: [{ id: `f${page}`, name: `Backup-${page}.tdw`, modifiedTime: `2026-08-0${page}T00:00:00Z` }],
          nextPageToken: page < 3 ? String(page + 1) : null,
        };
      },
    };
    const googleDrive = {
      getAuthedClient: async () => ({ oauth2: {} }),
      resolveFolderPath: async () => 'folder-id',
    };
    const loaded = loadDiscoveryWithMocks(driveApi, googleDrive);
    try {
      const listed = await loaded.moduleUnderTest.listFolderShallow(googleDrive, 'Backups/V2', {
        pageSize: 1,
        maxPages: 10,
        retryAttempts: 3,
        retryDelayMs: 1,
      });
      assert.strictEqual(listed.items.length, 3);
      assert.strictEqual(listed.pages, 3);
      assert.strictEqual(listed.truncated, false);
      assert.strictEqual(call, 3);
    } finally {
      loaded.restore();
    }
  });

  await check('reports truncation instead of treating a partial page scan as complete', async () => {
    const driveApi = {
      listFiles: async (_oauth, options) => ({
        files: [{ id: String(options.pageToken || '1'), name: 'Backup-page.tdw' }],
        nextPageToken: options.pageToken ? '3' : '2',
      }),
    };
    const googleDrive = {
      getAuthedClient: async () => ({ oauth2: {} }),
      resolveFolderPath: async () => 'folder-id',
    };
    const loaded = loadDiscoveryWithMocks(driveApi, googleDrive);
    try {
      const listed = await loaded.moduleUnderTest.listFolderShallow(googleDrive, 'Backups/V2', {
        pageSize: 1,
        maxPages: 2,
      });
      assert.strictEqual(listed.truncated, true);
      assert.strictEqual(listed.truncationReason, 'max_pages');
    } finally {
      loaded.restore();
    }
  });

  await check('discovers global backup roots without a local center id', async () => {
    const driveApi = {
      listFiles: async () => ({
        files: [{ id: 'backup-1', name: 'Tadawi-Backup-V2-2026.tdw', modifiedTime: '2026-08-10T00:00:00Z' }],
        nextPageToken: null,
      }),
    };
    const googleDrive = {
      getStatus: async () => ({ connected: true, needsReauth: false }),
      getAuthedClient: async () => ({ oauth2: {} }),
      resolveFolderPath: async () => 'folder-id',
      findFileByPath: async () => null,
    };
    const loaded = loadDiscoveryWithMocks(driveApi, googleDrive);
    try {
      const result = await loaded.moduleUnderTest.discoverCloudRestorePoints({ timeoutMs: 10000 });
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.status, 'ready');
      assert.strictEqual(result.centerId, null);
      assert.ok(result.restorePoints.length > 0);
    } finally {
      loaded.restore();
    }
  });

  await check('restores a previously running sync engine after discovery success and failure', async () => {
    for (const operation of [
      async () => ({ ok: true, status: 'not_found', restorePoints: [] }),
      async () => { throw new Error('injected_discovery_failure'); },
    ]) {
      const runtime = loadRendererDiscovery(operation);
      await runtime.api.discoverAllSources({ timeoutMs: 1000 });
      assert.deepStrictEqual(runtime.state(), { running: true, starts: 1, stops: 1 });
    }
  });

  await check('restores sync immediately when discovery is cancelled', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const runtime = loadRendererDiscovery(() => pending);
    const operation = runtime.api.discoverAllSources({ timeoutMs: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    runtime.api.cancelDiscovery();
    assert.deepStrictEqual(runtime.state(), { running: true, starts: 1, stops: 1 });
    release({ ok: true, status: 'not_found', restorePoints: [] });
    await operation;
    assert.deepStrictEqual(runtime.state(), { running: true, starts: 1, stops: 1 });
  });

  await check('license discovery catch no longer hard-codes a timeout diagnosis', async () => {
    const source = fs.readFileSync(bootFlowPath, 'utf8');
    const catchStart = source.indexOf('async function autoDiscoverActivationAfterGoogle');
    const catchEnd = source.indexOf('async function runGoogleConnect', catchStart);
    const functionSource = source.slice(catchStart, catchEnd);
    assert.ok(!/setStatusFromErr\(e,\s*['"]license_timeout['"]\)/.test(functionSource));
    assert.ok(/setStatusFromErr\(e\)/.test(functionSource));
  });

  const failed = results.filter((entry) => !entry.ok);
  if (failed.length) process.exit(1);
  console.log(`P0-C discovery integrity PASS: ${results.length}/${results.length}`);
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

