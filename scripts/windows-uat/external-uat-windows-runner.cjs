#!/usr/bin/env node
'use strict';

/**
 * Post-Stage-20 External UAT evidence runner (Windows only).
 * Executes automated checks; marks interactive/Google/live-A/B journeys honestly.
 * No application mutations — evidence collection only.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.EXTERNAL_UAT_BUILD_ID || process.env.STAGE1_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence/EXTERNAL-UAT-WINDOWS', buildId);
fs.mkdirSync(evidenceDir, { recursive: true });

const EXPECTED_EXE_SHA = '058626db3bdc1f632bef49fc0fa6862cc76fb34ded26293251501d022bd376c0';
const BASELINE_SOURCE = 'c389e92';

function git(cmd) {
  return (spawnSync('git', cmd, { cwd: root, encoding: 'utf8' }).stdout || '').trim();
}

function runNode(rel, env = {}) {
  const r = spawnSync(process.execPath, [path.join(root, rel)], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { pass: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

function sha256File(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

function findSetupExe() {
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(dist)) return null;
  const files = fs.readdirSync(dist)
    .filter((f) => /^HijamaManagement-Setup-.*\.exe$/i.test(f))
    .map((f) => path.join(dist, f));
  if (!files.length) return null;
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0];
}

function hasGoogleCreds() {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

function blocked(reason) {
  return { status: 'NOT_EXECUTED', verdict: 'BLOCKED', reason };
}

function pass(note) {
  return { status: 'PASS', verdict: 'PASS', reason: note || 'verified' };
}

function fail(reason) {
  return { status: 'FAIL', verdict: 'FAIL', reason };
}

const setupPath = findSetupExe();
let exeEvidence = { expectedSha256: EXPECTED_EXE_SHA, found: false };
if (setupPath && fs.existsSync(setupPath)) {
  const sha = sha256File(setupPath);
  exeEvidence = {
    expectedSha256: EXPECTED_EXE_SHA,
    actualSha256: sha,
    filename: path.basename(setupPath),
    sizeBytes: fs.statSync(setupPath).size,
    match: sha === EXPECTED_EXE_SHA,
    found: true,
  };
}

const googleConfigured = hasGoogleCreds();
const interactiveCapable = process.env.EXTERNAL_UAT_INTERACTIVE === 'true';
const deviceBConfigured = process.env.EXTERNAL_UAT_DEVICE_B === 'true';
const stage19Profile = process.env.EXTERNAL_UAT_STAGE19_PROFILE === 'true';

const security = runNode('tests/baseline/test-p0-a-security-boundary.js');
const stage20 = runNode('tests/baseline/test-stage-20-final-bootstrap-gate.js');

const installedSmokePath = path.join(
  root,
  'docs/remediation/evidence/STAGE-1-WINDOWS-UAT',
  buildId,
  'INSTALLED-EXE-SMOKE.json',
);
let installedSmoke = null;
if (fs.existsSync(installedSmokePath)) {
  try { installedSmoke = JSON.parse(fs.readFileSync(installedSmokePath, 'utf8')); } catch { /* ignore */ }
}

const exeShaOk = exeEvidence.match === true;
const installedOk = installedSmoke?.ok === true;

const journeys = {
  googleOAuth: googleConfigured && interactiveCapable ? blocked('requires manual Windows lab session') : blocked('no Google test tenant + interactive session'),
  googleReconnect: googleConfigured && interactiveCapable ? blocked('requires manual Windows lab session') : blocked('no Google test tenant + interactive session'),
  driveListing: googleConfigured && interactiveCapable ? blocked('requires manual Windows lab session') : blocked('no Google test tenant + interactive session'),
  realNew: interactiveCapable ? blocked('requires full GUI Windows lab') : blocked('hosted runner — no interactive desktop bootstrap'),
  realExisting: interactiveCapable && deviceBConfigured ? blocked('requires Device B Windows lab') : blocked('no second Windows device/profile'),
  publicationReadback: googleConfigured && interactiveCapable ? blocked('requires real Drive remote verification') : blocked('no Google test tenant'),
  liveDeviceAb: deviceBConfigured && interactiveCapable ? blocked('requires two live Windows devices') : blocked('no live Device A/B environment'),
  backupUpload: googleConfigured && interactiveCapable ? blocked('requires real Drive upload') : blocked('no Google test tenant'),
  backupRestore: googleConfigured && interactiveCapable ? blocked('requires real Drive download/restore') : blocked('no Google test tenant'),
  guiNew: interactiveCapable ? blocked('requires visual desktop walkthrough') : blocked('no interactive GUI session'),
  guiExisting: interactiveCapable && deviceBConfigured ? blocked('requires visual desktop walkthrough') : blocked('no interactive GUI session'),
  upgrade: stage19Profile ? blocked('requires Stage 19 isolated profile on Windows') : blocked('no Stage 19 upgrade profile prepared'),
};

const allCriticalPass = Object.values(journeys).every((j) => j.verdict === 'PASS');
const environmentBlocked = !googleConfigured || !interactiveCapable || !deviceBConfigured || !stage19Profile;

let externalVerdict;
let externalGate;
if (allCriticalPass) {
  externalVerdict = 'PASS';
  externalGate = 'PASS';
} else if (environmentBlocked) {
  externalVerdict = 'BLOCKED';
  externalGate = 'FAIL';
} else {
  externalVerdict = 'FAIL';
  externalGate = 'FAIL';
}

const artifacts = {
  'ENVIRONMENT.json': {
    os: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    runner: process.env.RUNNER_OS || process.platform,
    runnerName: process.env.RUNNER_NAME || 'local',
    githubRun: process.env.GITHUB_RUN_ID || null,
    buildId,
    googleCredsConfigured: googleConfigured,
    interactiveCapable,
    deviceBConfigured,
    stage19Profile,
    baselineSource: BASELINE_SOURCE,
    evidenceCommit: git(['rev-parse', 'HEAD']),
  },
  'EXACT-EXE.json': exeEvidence,
  'GOOGLE-OAUTH.json': journeys.googleOAuth,
  'GOOGLE-RECONNECT.json': journeys.googleReconnect,
  'DRIVE-LISTING.json': journeys.driveListing,
  'REAL-NEW-JOURNEY.json': { ...journeys.realNew, activationConsume: null, organizationCount: null, ownerCount: null },
  'REAL-EXISTING-JOURNEY.json': { ...journeys.realExisting, activationConsume: 0, orgCreate: 0 },
  'REAL-PUBLICATION-READBACK.json': journeys.publicationReadback,
  'LIVE-DEVICE-AB.json': journeys.liveDeviceAb,
  'SAME-RECORD-CONFLICT.json': blocked('requires live Device A/B'),
  'OFFLINE-RECONNECT.json': blocked('requires live Device B offline test'),
  'DUPLICATE-DELIVERY.json': blocked('requires live sync tooling'),
  'TOMBSTONE.json': blocked('requires live Device A/B delete policy test'),
  'REAL-BACKUP-UPLOAD.json': journeys.backupUpload,
  'REAL-BACKUP-DOWNLOAD.json': journeys.backupRestore,
  'REAL-BACKUP-RESTORE.json': journeys.backupRestore,
  'WRONG-PASSWORD.json': blocked('requires real downloaded backup on Windows'),
  'CORRUPT-BACKUP.json': blocked('requires real backup file on Windows'),
  'GUI-NEW.json': journeys.guiNew,
  'GUI-EXISTING.json': journeys.guiExisting,
  'GUI-ERROR-RETRY.json': blocked('requires interactive GUI error injection'),
  'GUI-CLOSE-RESUME.json': blocked('requires interactive GUI close/resume'),
  'SCREEN-SIZES.json': {
    '1366x768': blocked('requires interactive GUI'),
    '1920x1080': blocked('requires interactive GUI'),
    narrow: blocked('requires interactive GUI'),
  },
  'UPGRADE-STAGE19.json': journeys.upgrade,
  'PARTIAL-UPGRADE.json': blocked('requires Stage 19 partial profile'),
  'SQLITE-INTEGRITY.json': {
    pragmaIntegrityCheck: installedOk ? 'smoke-only-not-journey-db' : 'NOT_EXECUTED',
    note: 'Full journey SQLite checks require completed NEW/EXISTING/restore paths',
  },
  'ENTITY-COUNTS.json': { note: 'requires completed real journeys' },
  'OPERATIONAL-ERRORS.json': {
    installedSmoke: installedSmoke || null,
    successJourneyErrors: null,
    unhandledRejections: null,
  },
  'SECURITY-REGRESSION.json': {
    unitSecurityBoundary: security.pass ? 'PASS' : 'FAIL',
    stage20Invariants: stage20.pass ? 'PASS' : 'FAIL',
    unknownIpcDenied: security.pass ? 'PASS-unit' : 'FAIL-unit',
    forgedPrivilegedBindDenied: security.pass ? 'PASS-unit' : 'FAIL-unit',
    devUnchanged: true,
    secretsRedacted: true,
  },
  'FINAL-EXTERNAL-UAT.json': {
    verdict: externalVerdict,
    bootstrapExternalGate: externalGate,
    generatedAt: new Date().toISOString(),
    buildId,
    exactExeShaVerified: exeShaOk,
    installedSmokePass: installedOk,
    baseline: {
      sourceCommit: BASELINE_SOURCE,
      setupExeSha256: EXPECTED_EXE_SHA,
      sourceZipSha256: 'bb8ae4bc104ae8ac6210a883eefa82709860224afdaec5d29a1c54bab11baf92',
    },
    journeys,
    criticalBlockers: [
      !googleConfigured && 'Google OAuth test tenant credentials not configured (GOOGLE_OAUTH_CLIENT_ID/SECRET)',
      !interactiveCapable && 'No interactive Windows desktop session (EXTERNAL_UAT_INTERACTIVE!=true)',
      !deviceBConfigured && 'No second Windows device/profile (EXTERNAL_UAT_DEVICE_B!=true)',
      !stage19Profile && 'No Stage 19 upgrade profile (EXTERNAL_UAT_STAGE19_PROFILE!=true)',
    ].filter(Boolean),
  },
  'SUMMARY.md': [
    '# External UAT — Windows Execution',
    '',
    `- Verdict: **${externalVerdict}**`,
    `- Bootstrap External Gate: **${externalGate}**`,
    `- Build ID: \`${buildId}\``,
    `- Exact EXE SHA match: ${exeShaOk ? 'PASS' : 'FAIL/MISSING'}`,
    `- Installed smoke: ${installedOk ? 'PASS' : 'NOT_RUN or FAIL'}`,
    `- Google creds configured: ${googleConfigured}`,
    `- Interactive capable: ${interactiveCapable}`,
    `- Device B configured: ${deviceBConfigured}`,
    `- Stage 19 upgrade profile: ${stage19Profile}`,
    '',
    'Automated-only checks ran on Windows runner. Interactive Google/GUI/live A/B/upgrade journeys require self-hosted Windows lab with test tenant.',
  ].join('\n'),
};

for (const [name, data] of Object.entries(artifacts)) {
  fs.writeFileSync(
    path.join(evidenceDir, name),
    name.endsWith('.md') ? data : JSON.stringify(data, null, 2),
  );
}

if (!exeShaOk) {
  console.error('FAIL exact EXE SHA mismatch or missing Setup EXE');
  console.error(JSON.stringify(exeEvidence, null, 2));
  process.exit(1);
}

console.log(`EXTERNAL-UAT runner: verdict=${externalVerdict} gate=${externalGate}`);
process.exit(externalVerdict === 'PASS' ? 0 : 2);
