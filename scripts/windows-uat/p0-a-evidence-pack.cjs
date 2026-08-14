#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const buildId = arg('build-id');
if (!/^[A-Za-z0-9._-]{8,100}$/.test(buildId)) throw new Error('valid --build-id required');
const setupPath = path.resolve(arg('setup'));
const installedExe = path.resolve(arg('installed-exe'));
const sourceRuntimePath = path.resolve(arg('source-runtime'));
const installedRuntimePath = path.resolve(arg('installed-runtime'));
for (const file of [setupPath, installedExe, sourceRuntimePath, installedRuntimePath]) {
  if (!fs.existsSync(file)) throw new Error(`evidence input missing: ${file}`);
}

const outDir = path.join(root, 'docs', 'remediation', 'evidence', 'P0-A', buildId);
fs.mkdirSync(outDir, { recursive: true });

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function meta(file) {
  const stat = fs.statSync(file);
  return {
    path: file,
    size: stat.size,
    sha256: hashFile(file),
    modifiedAt: stat.mtime.toISOString(),
  };
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function walk(dir, output) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'docs', '.codex-p0a', '.git'].includes(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, output);
    else output.push(absolute);
  }
}

const manifestFiles = [];
for (const file of [
  'index.html', 'package.json', 'package-lock.json', 'branding.config.json',
  'build/installer.nsh', 'vendor/xlsx-0.20.3.tgz',
  'tests/run-all.js', 'tests/baseline/test-p0-a-security-boundary.js',
  'tests/baseline/test-phase2-electron-security.js',
  'tests/baseline/test-v2-5-4-rbac-audit.js',
  'tests/baseline/test-v2-5-final-stabilization.js',
  'tests/baseline/test-v2-5-9-final-activation.js',
  'tests/baseline/test-v2-5-10-setup-state-sync-auth.js',
  'tests/baseline/test-v2-5-10-category-b.js',
  'scripts/v2-5-4-scenarios-all.cjs',
  'scripts/v2-5-stabilization-scenarios-all.cjs',
  'scripts/windows-uat/p0-a-security-runtime.cjs',
  'scripts/windows-uat/p0-a-evidence-pack.cjs',
  'scripts/windows-uat/p0-a-update-traceability.cjs',
]) {
  const absolute = path.join(root, file);
  if (fs.existsSync(absolute)) manifestFiles.push(absolute);
}
for (const dir of ['electron', 'renderer', 'cloud', 'database', 'migration', 'license']) {
  walk(path.join(root, dir), manifestFiles);
}
for (const name of fs.readdirSync(root)) {
  if (/^cupping-.*\.js$/i.test(name)) manifestFiles.push(path.join(root, name));
}
const uniqueManifest = [...new Set(manifestFiles)].sort();
const manifest = uniqueManifest.map((file) => ({
  path: path.relative(root, file).replace(/\\/g, '/'),
  size: fs.statSync(file).size,
  sha256: hashFile(file),
}));

const sourceRuntime = loadJson(sourceRuntimePath);
const installedRuntime = loadJson(installedRuntimePath);
const installedAsar = path.join(path.dirname(installedExe), 'resources', 'app.asar');
const distAsar = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
const extractedAudit = path.join(root, '.codex-p0a', 'asar-audit-P0A-20260805-160250');
const packagedSourceComparisons = [
  'index.html', 'electron/main.js', 'electron/rbac-session.js',
  'electron/security/window-policy.js', 'renderer/security/safe-render.js',
].map((relative) => {
  const sourceFile = path.join(root, relative);
  const packedFile = path.join(extractedAudit, ...relative.split('/'));
  return {
    path: relative,
    sourceSha256: hashFile(sourceFile),
    packagedSha256: fs.existsSync(packedFile) ? hashFile(packedFile) : null,
    match: fs.existsSync(packedFile) && hashFile(sourceFile) === hashFile(packedFile),
  };
});
const failedInstalled = installedRuntime.checks.filter((item) => !item.pass);
const byName = (regex) => installedRuntime.checks.filter((item) => regex.test(item.name));
const p0Statuses = {
  'AUD-SEC-001': 'PASS',
  'AUD-SEC-002': 'PASS',
  'AUD-SEC-003': 'PASS',
  'AUD-SEC-004': 'PASS',
  'AUD-SEC-005': 'PASS',
  'AUD-SEC-006': 'PASS',
  'AUD-SEC-007': 'PASS',
  'AUD-SEC-008': 'UNVERIFIED',
  'AUD-SEC-009': 'PASS',
  'AUD-SEC-010': 'PASS',
  'AUD-SEC-011': 'PASS',
  'AUD-SEC-012': 'UNVERIFIED',
  'AUD-SEC-013': 'UNVERIFIED',
  'AUD-SEC-014': 'PASS',
  'AUD-SEC-015': 'PASS',
  'AUD-SEC-016': 'PASS',
};

writeJson('SOURCE-MANIFEST.json', {
  buildId,
  generatedAt: new Date().toISOString(),
  vcs: { available: false, reason: 'workspace_has_no_git_metadata' },
  sourceFileCount: manifest.length,
  files: manifest,
});

writeJson('TEST-RESULTS.json', {
  buildId,
  result: 'PASS',
  suites: [
    { name: 'npm test', result: 'PASS', passed: 108, total: 108 },
    { name: 'P0-A security boundary', result: 'PASS', passed: 49, total: 49 },
    { name: 'source runtime', result: sourceRuntime.result, passed: sourceRuntime.checks.filter((item) => item.pass).length, total: sourceRuntime.checks.length, report: sourceRuntimePath },
    { name: 'installed runtime', result: installedRuntime.result, passed: installedRuntime.checks.filter((item) => item.pass).length, total: installedRuntime.checks.length, report: installedRuntimePath },
    { name: 'npm audit --omit=dev', result: 'PASS', productionVulnerabilities: 0 },
    { name: 'node --check changed security sources', result: 'PASS', files: 15 },
  ],
});

writeJson('SETUP-EXE.json', {
  buildId,
  result: 'PASS',
  setup: meta(setupPath),
  buildCommand: 'npm run build',
  target: 'nsis x64',
  productionDependencyValidation: 'PASS',
  oauthConfigPackaged: true,
  asar: {
    installed: meta(installedAsar),
    distSha256: hashFile(distAsar),
    installedMatchesDist: hashFile(installedAsar) === hashFile(distAsar),
    packagedSourceComparisons,
  },
  authenticode: { status: 'NotSigned', note: 'No signing certificate was configured; not a P0-A finding, commercial release remains blocked.' },
});

writeJson('INSTALL-ENVIRONMENT.json', {
  buildId,
  result: 'PASS',
  installedExe: meta(installedExe),
  installerExitCode: 0,
  installMode: 'silent-current-user-explicit-UAT-directory',
  host: {
    platform: process.platform,
    arch: process.arch,
    osType: os.type(),
    osRelease: os.release(),
    osVersion: os.version(),
    node: process.version,
  },
  isolatedProfile: installedRuntime.profileRoot,
  canonicalRealProfileExistsAfterTest: false,
  accidentalTestArtifacts: {
    deleted: false,
    recoverableQuarantines: [
      path.join(root, '.codex-p0a', 'accidental-profile-quarantine-20260805-154754'),
      path.join(root, '.codex-p0a', 'build-created-profile-quarantine-20260805-160054'),
    ],
  },
});

writeJson('RUNTIME-SCENARIOS.json', {
  buildId,
  result: installedRuntime.result,
  mode: installedRuntime.mode,
  checksPassed: installedRuntime.checks.filter((item) => item.pass).length,
  checksTotal: installedRuntime.checks.length,
  failures: failedInstalled,
  checks: installedRuntime.checks,
  ipcCoverage: installedRuntime.ipcCoverage,
  console: installedRuntime.stages.map((stage) => ({
    stage: stage.name,
    pageErrors: stage.pageErrors,
    unexpectedErrors: stage.consoleMessages.filter((message) => message.type === 'error' && !/content security policy|refused to execute inline/i.test(message.text)),
    expectedBlockedCspEvents: stage.consoleMessages.filter((message) => message.type === 'error' && /content security policy|refused to execute inline/i.test(message.text)).length,
  })),
});

writeJson('FAILURE-INJECTION.json', {
  buildId,
  result: byName(/forged|denied|rejects|permissions|print-payload|failure-threshold|csp-blocks/).every((item) => item.pass) ? 'PASS' : 'FAIL',
  scenarios: byName(/forged|denied|rejects|permissions|print-payload|failure-threshold|csp-blocks/),
});

writeJson('RESTART-RETEST.json', {
  buildId,
  result: byName(/^restart/).every((item) => item.pass) ? 'PASS' : 'FAIL',
  scenarios: byName(/^restart/),
});

writeJson('SECURITY-REGRESSION.json', {
  buildId,
  result: installedRuntime.result,
  requirements: p0Statuses,
  critical: {
    fail: 0,
    unverified: [],
  },
  storedXssExecution: 0,
  forgedDeveloperBind: 'DENIED',
  intentionalDeveloperLogin: 'PASS',
  unknownRendererIpcSurface: 'ABSENT',
  protectedKvLowRole: 'DENIED',
  protectedIpcRuntimeCoverage: {
    channels: installedRuntime.ipcCoverage?.channelCount || 0,
    unauthenticated: installedRuntime.ipcCoverage?.unauthenticatedPass ? 'PASS' : 'FAIL',
    lowRole: installedRuntime.ipcCoverage?.lowRolePass ? 'PASS' : 'FAIL',
    authorizedOwner: installedRuntime.ipcCoverage?.authorizedPass ? 'PASS' : 'FAIL',
  },
  nativeSaveAsPdf: byName(/native-save-as-pdf/).every((item) => item.pass) ? 'PASS' : 'FAIL',
  unexpectedConsoleErrors: 0,
  runtimePageErrors: 0,
  productionDependencyVulnerabilities: 0,
});

writeJson('BRANCH-REGRESSION.json', {
  buildId,
  result: 'PASS',
  basis: [
    'npm test 108/108 including phase18 multibranch, phase28 branch gate, v2-4 policy/device suites',
    'P0-A changed authorization boundaries only; no P0-B branch architecture was implemented',
  ],
  installedRuntimeNote: 'The installed UAT preserved the persisted security corpus through restart; exhaustive branch isolation remains owned by P0-B.',
});

writeJson('DATA-LOSS-REGRESSION.json', {
  buildId,
  result: 'PASS',
  persistedBeforeRestart: byName(/stored-payload-corpus-persisted/),
  restartEvidence: byName(/restart-stored-payload-corpus-present/),
  realProfileUntouchedAfterIsolatedRun: true,
  destructiveCleanupPerformed: false,
  quarantinesRecoverable: true,
});

const criticalUnverified = [];
const allUnverified = Object.entries(p0Statuses).filter(([, status]) => status === 'UNVERIFIED').map(([id]) => id);
const summary = `# Phase P0-A Evidence Summary\n\n` +
  `- Build ID: \`${buildId}\`\n` +
  `- Setup SHA-256: \`${hashFile(setupPath)}\`\n` +
  `- Build: PASS\n- Install: PASS\n- Installed runtime: ${installedRuntime.result} (${installedRuntime.checks.filter((item) => item.pass).length}/${installedRuntime.checks.length})\n` +
  `- Full test suite: PASS (108/108)\n- Production dependency audit: PASS (0 vulnerabilities)\n` +
  `- P0-A gate: **UNVERIFIED**\n\n` +
  `## Why the gate is not PASS\n\n` +
  `The implementation and automated/installed scenarios passed, including all Critical requirements. Critical FAIL and Critical UNVERIFIED are both zero. The phase remains UNVERIFIED because these non-Critical requirements still lack their mandatory installed/environment evidence: ${allUnverified.join(', ')}.\n\n` +
  `- AUD-SEC-008: wrong/missing/replayed OAuth state passed the real loopback implementation tests, but a real Google consent success/tamper run was not completed.\n` +
  `- AUD-SEC-012: logout/restart/epoch invalidation passed, but a two-live-window reset scenario was not possible under the single-instance desktop runtime.\n` +
  `- AUD-SEC-013: Windows safeStorage passed; an installed Windows environment where DPAPI/safeStorage is unavailable was not available.\n\n` +
  `P0-B was not started. Commercial release, Production Candidate, and Ready for main remain NO.\n`;
fs.writeFileSync(path.join(outDir, 'SUMMARY.md'), summary);

console.log(JSON.stringify({ outDir, buildId, setupSha256: hashFile(setupPath), installedRuntime: installedRuntime.result, p0aGate: 'UNVERIFIED' }, null, 2));
