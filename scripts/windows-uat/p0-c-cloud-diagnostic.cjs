'use strict';

/**
 * Read-only installed-profile diagnostic for P0-C cloud recovery.
 *
 * This intentionally emits no OAuth tokens, email addresses, file IDs, paths,
 * or backup names. It proves which production Google Drive stage fails while
 * keeping customer data out of the evidence log.
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const userDataPath = process.env.TDW_P0C_USER_DATA;
if (!userDataPath) {
  throw new Error('TDW_P0C_USER_DATA_required');
}

app.setPath('userData', path.resolve(userDataPath));

function safeError(error) {
  const raw = String(error?.code || error?.message || error || 'unknown_error');
  return raw
    .replace(/ya29\.[A-Za-z0-9_.-]+/g, '[REDACTED_TOKEN]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/[?&](?:code|state|access_token|refresh_token)=[^&\s]+/gi, '')
    .slice(0, 240);
}

async function timed(stage, operation) {
  const startedAt = Date.now();
  try {
    const value = await operation();
    return { stage, ok: true, durationMs: Date.now() - startedAt, value };
  } catch (error) {
    return { stage, ok: false, durationMs: Date.now() - startedAt, error: safeError(error) };
  }
}

function summarizeStatus(status) {
  return {
    connected: status?.connected === true,
    needsReauth: status?.needsReauth === true,
    hasRefreshToken: status?.hasRefreshToken === true,
    tokenExpired: status?.tokenExpired === true,
    provider: status?.provider || 'google',
    error: status?.message ? safeError(status.message) : null,
  };
}

function summarizeList(result) {
  return {
    ok: result?.ok === true,
    needsReauth: result?.needsReauth === true,
    itemCount: Array.isArray(result?.items) ? result.items.length : 0,
    licenseCount: Array.isArray(result?.items)
      ? result.items.filter((item) => /(?:^|\/)license\.json$/i.test(String(item?.path || item?.name || ''))).length
      : 0,
    error: result?.message || result?.error ? safeError(result.message || result.error) : null,
  };
}

app.whenReady().then(async () => {
  const googleDrive = require('../../electron/cloud-providers/google-drive');
  const setupActivation = require('../../electron/setup-activation');
  global.CommercialLicense = global.CommercialLicense || {};
  require('../../license/core/license-crypto');
  require('../../license/core/legacy-license-allowlist');
  require('../../cloud/license-cloud');
  const report = {
    generatedAt: new Date().toISOString(),
    userDataProfile: path.basename(path.resolve(userDataPath)),
    stages: [],
  };

  const status = await timed('google_status', () => googleDrive.getStatus());
  report.stages.push({
    stage: status.stage,
    ok: status.ok,
    durationMs: status.durationMs,
    ...(status.ok ? { result: summarizeStatus(status.value) } : { error: status.error }),
  });

  if (status.ok && status.value?.connected === true && status.value?.needsReauth !== true) {
    const licensePaths = new Set();
    let verifiedSetupPayload = null;
    for (const root of ['NajjarTech', 'NajjarTech Hijama Management']) {
      const listed = await timed(`list:${root}`, () => googleDrive.listBackups('google', root));
      report.stages.push({
        stage: listed.stage,
        ok: listed.ok,
        durationMs: listed.durationMs,
        ...(listed.ok ? { result: summarizeList(listed.value) } : { error: listed.error }),
      });
      if (listed.ok && Array.isArray(listed.value?.items)) {
        for (const item of listed.value.items) {
          if (/(?:^|\/)license\.json$/i.test(String(item?.path || item?.name || '')) && item?.path) {
            licensePaths.add(item.path);
          }
        }
      }
    }

    const verification = { discovered: licensePaths.size, valid: 0, invalid: 0, downloadErrors: 0 };
    const setupVerification = { attempted: 0, valid: 0, failed: 0, errors: [] };
    for (const licensePath of licensePaths) {
      const downloaded = await timed('license_download', () => googleDrive.downloadBackup(licensePath));
      if (!downloaded.ok || downloaded.value?.ok !== true) {
        verification.downloadErrors += 1;
        continue;
      }
      try {
        const document = JSON.parse(downloaded.value.text || downloaded.value.payload || '');
        const verified = await global.LicenseCloud.verifyLicenseDoc(document);
        if (verified?.ok === true) verification.valid += 1;
        else verification.invalid += 1;
      } catch {
        verification.invalid += 1;
      }

      setupVerification.attempted += 1;
      const exact = await timed('setup_activation_verify', () => (
        setupActivation.verifyRemoteSetupActivation({ remotePath: licensePath })
      ));
      if (exact.ok && exact.value?.ok === true) {
        setupVerification.valid += 1;
        verifiedSetupPayload ||= exact.value;
      } else {
        setupVerification.failed += 1;
        setupVerification.errors.push(exact.ok
          ? safeError(exact.value?.error || 'setup_activation_verification_failed')
          : exact.error);
      }
    }
    report.stages.push({ stage: 'license_signature_verification', ok: verification.invalid === 0 && verification.downloadErrors === 0, result: verification });
    report.stages.push({
      stage: 'setup_activation_verification',
      ok: setupVerification.attempted > 0 && setupVerification.failed === 0,
      result: setupVerification,
    });

    const sandboxRoot = process.env.TDW_P0C_COMMIT_SANDBOX;
    if (sandboxRoot && verifiedSetupPayload) {
      const sourceDatabase = path.join(path.resolve(userDataPath), 'database', 'tadawi.db');
      const sandboxUserData = path.resolve(sandboxRoot);
      const sandboxDatabaseDir = path.join(sandboxUserData, 'database');
      fs.mkdirSync(sandboxDatabaseDir, { recursive: true });
      fs.copyFileSync(sourceDatabase, path.join(sandboxDatabaseDir, 'tadawi.db'));
      app.setPath('userData', sandboxUserData);
      const databaseService = require('../../electron/database/service');
      const committed = await timed('setup_activation_commit_sandbox', () => databaseService.commitSetupActivation({
        license: verifiedSetupPayload.license,
        legacyLicense: verifiedSetupPayload.legacyLicense,
      }));
      report.stages.push({
        stage: committed.stage,
        ok: committed.ok && committed.value?.ok === true,
        durationMs: committed.durationMs,
        ...(committed.ok ? {
          result: {
            ok: committed.value?.ok === true,
            error: committed.value?.error ? safeError(committed.value.error) : null,
            rolledBack: committed.value?.rolledBack === true,
            authoritative: committed.value?.authoritative === true,
            setupActivation: committed.value?.setupActivation === true,
          },
        } : { error: committed.error }),
      });
      if (committed.ok && committed.value?.ok === true) {
        const firstBranch = (verifiedSetupPayload.license?.branches || [])
          .find((item) => item && item.active !== false && !item.pending);
        const organizationDevice = await timed('setup_organization_device_commit_sandbox', () => (
          databaseService.commitSetupOrganizationDevice({
            commandId: `p0c-diagnostic-${Date.now()}`,
            license: verifiedSetupPayload.license,
            centerName: verifiedSetupPayload.license.centerName || 'Diagnostic Center',
            ...(firstBranch ? { branchId: firstBranch.id, deviceName: 'P0C-Diagnostic-Device' } : {}),
          })
        ));
        report.stages.push({
          stage: organizationDevice.stage,
          ok: organizationDevice.ok && organizationDevice.value?.ok === true,
          durationMs: organizationDevice.durationMs,
          ...(organizationDevice.ok ? {
            result: {
              ok: organizationDevice.value?.ok === true,
              error: organizationDevice.value?.error ? safeError(organizationDevice.value.error) : null,
              organizationCommitted: organizationDevice.value?.setupOrganizationDevice === true,
              deviceBindingCovered: !!firstBranch,
              branchBound: !!organizationDevice.value?.deviceConfig?.lockedBranchId,
            },
          } : { error: organizationDevice.error }),
        });
      }
      databaseService.close();
    }
  }

  const rendered = `${JSON.stringify(report, null, 2)}\n`;
  if (process.env.TDW_P0C_REPORT_PATH) {
    fs.writeFileSync(path.resolve(process.env.TDW_P0C_REPORT_PATH), rendered, 'utf8');
  }
  process.stdout.write(rendered);
  app.quit();
}).catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: safeError(error) })}\n`);
  app.exit(1);
});
