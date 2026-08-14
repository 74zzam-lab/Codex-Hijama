'use strict';

/**
 * One-time, read-only migration utility. It records only SHA-256 digests of
 * verified legacy license documents. OAuth tokens, file ids, paths and
 * customer data are never written to the output.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app } = require('electron');

const userDataPath = process.env.TDW_LICENSE_USER_DATA;
const outputPath = process.env.TDW_LICENSE_ALLOWLIST_OUT;
if (!userDataPath || !outputPath) throw new Error('license_migration_paths_required');
app.setPath('userData', path.resolve(userDataPath));

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}

app.whenReady().then(async () => {
  global.CommercialLicense = global.CommercialLicense || {};
  require('../../license/core/license-crypto');
  require('../../cloud/license-cloud');
  const drive = require('../../electron/cloud-providers/google-drive');
  const status = await drive.getStatus();
  if (!status?.connected || status?.needsReauth) throw new Error('google_drive_not_connected');

  const paths = new Set();
  for (const root of ['NajjarTech', 'NajjarTech Hijama Management']) {
    const listed = await drive.listBackups('google', root);
    for (const item of (listed?.items || [])) {
      if (/(?:^|\/)license\.json$/i.test(String(item?.path || ''))) paths.add(item.path);
    }
  }

  const hashes = new Set();
  for (const remotePath of paths) {
    const downloaded = await drive.downloadBackup(remotePath);
    if (!downloaded?.ok) continue;
    const document = JSON.parse(String(downloaded.text || downloaded.payload || ''));
    if (Number(document.schemaVersion) === 6) continue;
    const verified = await global.LicenseCloud.verifyLicenseDoc(document);
    if (verified?.ok !== true) continue;
    hashes.add(crypto.createHash('sha256').update(canonicalJson(document), 'utf8').digest('hex'));
  }

  if (!hashes.size) throw new Error('no_verified_legacy_license_found');
  const output = {
    schemaVersion: 1,
    algorithm: 'sha256-canonical-json',
    hashes: Array.from(hashes).sort(),
  };
  fs.writeFileSync(path.resolve(outputPath), JSON.stringify(output, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({ ok: true, hashCount: hashes.size }) + '\n');
  app.quit();
}).catch((error) => {
  process.stderr.write(JSON.stringify({ ok: false, error: String(error?.message || error) }) + '\n');
  app.exit(1);
});
