#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const bootSrc = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
const discoverySrc = fs.readFileSync(path.join(root, 'cloud/cloud-data-discovery.js'), 'utf8');
const policySrc = fs.readFileSync(path.join(root, 'cloud/bootstrap-failure-policy-contract.js'), 'utf8');

const errors = [];

function loadPolicy() {
  const sandbox = { console, global: {}, window: {} };
  sandbox.global = sandbox;
  vm.runInNewContext(policySrc, sandbox);
  return sandbox.BootstrapFailurePolicyContract;
}

function loadDiscovery(extra = {}) {
  const g = {
    LicenseCloud: { loadLocal: () => ({ centerId: 'CTR-1', branches: [{ id: 'BR-MAIN' }] }) },
    DeviceConfig: { load: () => ({ lockedBranchId: 'BR-MAIN' }) },
    RestoreReconciliation: {
      createMandatoryPreRestoreSnapshot: async () => ({ ok: true, skipped: true }),
      afterRestoreDataSourceSelected: async () => ({ ok: true }),
    },
    SqliteBridge: { hydrateIntoMemory: async () => ({ ok: true }) },
    BootstrapFailurePolicyContract: loadPolicy(),
    ...extra,
  };
  const sandbox = { console, global: g, globalThis: g, window: g, setInterval, clearInterval, setTimeout, clearTimeout };
  vm.runInNewContext(discoverySrc, sandbox);
  return sandbox.global.CloudDataDiscovery;
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    errors.push(`${name}: ${error.message}`);
    console.error(`FAIL  ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  await check('BUG-EXT-015 heartbeat does not reset byte stall timer', () => {
    assert.match(discoverySrc, /lastByteProgressAt/);
    assert.match(discoverySrc, /touchByteProgress/);
    assert.doesNotMatch(discoverySrc, /heartbeatRatio/);
    assert.doesNotMatch(discoverySrc, /touchActivity\(\)/);
  });

  await check('BUG-EXT-015 restoreBridge prefers v2SetupCloudRestore', () => {
    assert.match(discoverySrc, /function restoreBridge\(\)/);
    assert.match(discoverySrc, /DOWNLOAD_ACTIVITY_STALL_MS/);
    assert.match(discoverySrc, /stageRatio: 0\.05/);
    assert.doesNotMatch(discoverySrc, /stageRatio: 0\.3\s*\n\s*\}\);/);
  });

  await check('BUG-EXT-015 progress monotonic + indeterminate contract', () => {
    const CD = loadDiscovery();
    const a = CD.buildProgressState('download_db', { workflow: 'backup_v2', stageRatio: 0.4, downloadedBytes: 100, totalBytes: 500 });
    const b = CD.buildProgressState('download_db', { workflow: 'backup_v2', stageRatio: 0.9, downloadedBytes: 450, totalBytes: 500 });
    assert.ok(b.percent >= a.percent);
    const ind = CD.buildProgressState('download_db', { workflow: 'backup_v2', stageRatio: 0.05, indeterminate: true });
    assert.strictEqual(ind.indeterminate, true);
    assert.strictEqual(ind.percent, null);
  });

  await check('BUG-EXT-015 small backup download completes in harness', async () => {
    let progressEvents = [];
    const CD = loadDiscovery({
      cuppingElectron: {
        backup: {
          onDownloadProgress: (cb) => { progressEvents.push(cb); },
          v2SetupCloudRestore: async () => {
            const cb = progressEvents[progressEvents.length - 1];
            cb?.({ remotePath: 'CuppingCenter-Backups/V2/file.tdw', downloadedBytes: 49500, totalBytes: 49500, percent: 100, stage: 'download_complete' });
            return { ok: true, native: true, progress: [{ stage: 'restore_complete' }], database: { ok: true } };
          },
          discoverCloudRestorePoints: async () => ({ ok: true }),
        },
      },
    });
    const point = { kind: 'backup_file', path: 'CuppingCenter-Backups/V2/file.tdw', sizeBytes: 49500, validation: 'metadata_ok', name: 'Tadawi-Backup-V2.tdw' };
    const snaps = [];
    const result = await CD.confirmedCloudRestore(point, {
      password: 'test-password-1234',
      onProgress: (s) => snaps.push(s),
    });
    assert.strictEqual(result.ok, true);
    assert.ok(snaps.some((s) => (s.percent != null && s.percent >= 30) || s.stageId === 'checksums'));
  });

  await check('BUG-EXT-015 stalled provider becomes retryable policy', () => {
    const BFPC = loadPolicy();
    const n = BFPC.normalizeFailure({ error: 'cloud_download_stalled' });
    assert.strictEqual(n.retryable, true);
    assert.match(n.message, /تنزيل|اتصال/i);
  });

  await check('BUG-EXT-012 step_required never maps to generic unknown', () => {
    const BFPC = loadPolicy();
    const n = BFPC.normalizeFailure({ message: 'step_required' }, { code: 'step_required' });
    assert.strictEqual(n.code, 'TDW-BOOT-STEP-REQUIRED');
    assert.match(n.message, /أكمل|المتطلبات/i);
    assert.notStrictEqual(n.message, 'تعذّر إكمال العملية.');
  });

  await check('BUG-EXT-012 discovery success clears red checklist path', () => {
    assert.match(bootSrc, /clearChecklistStepError\('discovery'\)/);
    assert.match(bootSrc, /clearTransientBootstrapState/);
    assert.match(bootSrc, /discoveryCodes\.includes\(normalized\.code\)/);
  });

  await check('BUG-EXT-012 diagnostic lookup maps correlation id', () => {
    const BFPC = loadPolicy();
    const rec = BFPC.recordDiagnostic({
      correlationId: 'TDW-BOOT-ERR-TEST-0001',
      stepId: 'discovery',
      code: 'TDW-BOOT-DISCOVERY-FAILED',
      operation: 'runDiscoveryGate',
    });
    const looked = BFPC.lookupDiagnostic('TDW-BOOT-ERR-TEST-0001');
    assert.strictEqual(looked.step, 'discovery');
    assert.strictEqual(rec.correlationId, 'TDW-BOOT-ERR-TEST-0001');
  });

  await check('BUG-EXT-013 branch reconcile after license recovery', () => {
    assert.match(bootSrc, /reconcileBranchSelectionAfterDiscovery/);
    assert.match(bootSrc, /runLicenseOrgRecovery[\s\S]*reconcileBranchSelectionAfterDiscovery/);
  });

  await check('BUG-EXT-013 two branches unresolved without explicit selection', () => {
    assert.match(bootSrc, /isBranchExplicitlySelected/);
    assert.match(bootSrc, /branchExplicitlySelected = true/);
    assert.match(bootSrc, /branchCount > 1/);
  });

  await check('BUG-EXT-013 one branch auto-select policy preserved', () => {
    assert.match(bootSrc, /branches\.length === 1/);
    assert.match(bootSrc, /branchCount <= 1/);
  });

  await check('BUG-EXT-014 google session latch + acceptLiveReconnect after recovery', () => {
    assert.match(bootSrc, /googleSessionConnected/);
    assert.match(bootSrc, /refreshGoogleConnectionState\(\{ acceptLiveReconnect: true \}\)/);
  });

  await check('BUG-EXT-011 modal width + wizard open retry contract', () => {
    assert.match(bootSrc, /min\(960px/);
    assert.match(bootSrc, /tryOpen/);
    assert.match(bootSrc, /فصل \/ تغيير حساب Google/);
  });

  await check('BUG-EXT-011 modal RTL no clipping contract', () => {
    assert.match(bootSrc, /direction:rtl/);
    assert.match(bootSrc, /inset-inline:auto/);
    assert.match(bootSrc, /@media \(max-width:1024px\)/);
  });

  await check('selected backup identity preserved in restore UI', () => {
    assert.match(bootSrc, /selectedCloudPoint = point/);
    assert.match(bootSrc, /confirmedCloudRestore\(selectedCloudPoint/);
  });

  await check('Stage 1–20 + focused defect regression hooks present', () => {
    const stageTests = [
      'test-p0-c-restore-truth-and-boot-gate.js',
      'test-stage-14-readback-hardening.js',
      'test-stage-16-existing-short-path.js',
      'test-stage-17-bootstrap-checklist-ui.js',
      'test-stage-18-bootstrap-failure-policy.js',
      'test-stage-19-bootstrap-dismiss-resume.js',
      'test-stage-20-final-bootstrap-gate.js',
      'test-post-stage-20-external-defects.js',
      'test-bootstrap-red-message-truthfulness.js',
    ];
    for (const t of stageTests) {
      assert.ok(fs.existsSync(path.join(root, 'tests/baseline', t)), `missing ${t}`);
    }
  });

  if (errors.length) {
    console.error(`\n${errors.length} failing checks`);
  } else {
    console.log('\nOK: external existing bootstrap runtime defect regressions');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
