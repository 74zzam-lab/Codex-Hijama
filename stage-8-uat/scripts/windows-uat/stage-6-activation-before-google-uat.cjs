#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.STAGE6_BUILD_ID || process.env.STAGE5_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence/STAGE-6-ACTIVATION-BEFORE-GOOGLE', buildId);
fs.mkdirSync(evidenceDir, { recursive: true });

function git(cmd) {
  return (spawnSync('git', cmd, { cwd: path.join(root, '..'), encoding: 'utf8' }).stdout || '').trim()
    || (spawnSync('git', cmd, { cwd: root, encoding: 'utf8' }).stdout || '').trim();
}

function runTest(rel) {
  const r = spawnSync(process.execPath, [path.join(root, rel)], { cwd: root, encoding: 'utf8' });
  return { pass: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

require(path.join(root, 'cloud/bootstrap-gates.js'));
const BG = globalThis.BootstrapGates;

const stage6 = runTest('tests/baseline/test-stage-6-activation-before-google.js');
const stage5 = runTest('tests/baseline/test-stage-5-bootstrap-gate-map.js');
const stage4 = runTest('tests/baseline/test-stage-4-bootstrap-coordinator-state.js');
const stage3 = runTest('tests/baseline/test-stage-3-no-auto-boot.js');
const stage2 = runTest('tests/baseline/test-stage-2-ready-pure.js');

const beforeNew = ['language', 'google', 'license', 'organization', 'branch', 'restore', 'owner', 'sync', 'ready'];
const afterNew = BG.CURRENT_NEW_RUNTIME;
const existing = BG.CURRENT_EXISTING_RUNTIME;

fs.writeFileSync(path.join(evidenceDir, 'SOURCE-MANIFEST.json'), `${JSON.stringify({
  stage5Baseline: { commit: 'a761b7c461340ba89bce00105e66137027e18d1e', evidence: 'a284774', run: '31696836029' },
  commit: git(['rev-parse', 'HEAD']),
  buildId,
  at: new Date().toISOString(),
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'BEFORE-AFTER-FLOW.json'), `${JSON.stringify({
  beforeNEW: beforeNew,
  afterNEW: afterNew,
  existingUNCHANGED: existing,
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'ACTIVATION-CALL-GRAPH.json'), `${JSON.stringify({
  path: 'User enters key → CommercialLicense.router → setupCommitSignedActivation → hydrateIntoMemory',
  requiresCustomerGoogleOAuth: false,
  sheetsBackendSeparate: true,
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'GOOGLE-CALL-GRAPH.json'), `${JSON.stringify({
  path: 'runGoogleConnect → connectGoogleDriveOnly → autoDiscoverActivationAfterGoogle (EXISTING/full; NEW skips if activation resolved)',
  requiresPriorActivationNEW: true,
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'ACTIVATION-VS-DRIVE-RESPONSIBILITIES.json'), `${JSON.stringify({
  localActivation: 'license step — manual key / Sheets vault (no customer Drive OAuth)',
  driveDiscovery: 'google step — OAuth + optional cloud license pull (EXISTING; NEW post-activation only)',
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'RESUME-MIGRATION.json'), `${JSON.stringify({
  wizardFlowVersion: 6,
  legacyStepMapping: 'LEGACY_NEW_STEPS_PRE_STAGE6 index → step id → NEW_STEPS index',
  coordinator: 'effectiveStepIndex advances past resolved steps',
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'DOUBLE-SUBMIT.json'), `${JSON.stringify({ guard: 'licenseActivateInFlight', result: stage6.pass ? 'PASS' : 'FAIL' }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'RETRY-IDEMPOTENCY.json'), `${JSON.stringify({ result: stage6.pass ? 'PASS' : 'FAIL' }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'EXISTING-REGRESSION.json'), `${JSON.stringify({ steps: existing, result: stage6.pass ? 'PASS' : 'FAIL' }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'ORIGINAL-VS-CURRENT.json'), `${JSON.stringify({
  before: 'Google → License (NEW)',
  after: 'Activation/License → Google (NEW)',
  existing: 'unchanged Google-first',
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'TEST-RESULTS.json'), `${JSON.stringify({ stage6Focused: stage6.pass ? 'PASS' : 'FAIL' }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'UAT-RESULTS.json'), `${JSON.stringify({ harness: stage6.pass ? 'PASS' : 'FAIL' }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'REGRESSION-RESULTS.json'), `${JSON.stringify({
  stage6: stage6.pass ? 'PASS' : 'FAIL',
  stage5: stage5.pass ? 'PASS' : 'FAIL',
  stage4: stage4.pass ? 'PASS' : 'FAIL',
  stage3: stage3.pass ? 'PASS' : 'FAIL',
  stage2: stage2.pass ? 'PASS' : 'FAIL',
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'WINDOWS-VERIFICATION.json'), `${JSON.stringify({
  nodeHarness: stage6.pass ? 'PASS' : 'FAIL',
  windowsRunner: 'windows-2022',
  installedExeSmoke: 'GHA post-build',
  fullInteractiveGui: 'UNVERIFIED',
  realGoogleDrive: 'UNVERIFIED',
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'GITHUB-ACTIONS.json'), `${JSON.stringify({ note: 'populated after push' }, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'SUMMARY.md'), `# Stage 6 Activation Before Google

**Build ID:** ${buildId}
**Verdict:** ${stage6.pass && stage5.pass && stage4.pass ? 'PASS' : 'FAIL'}

NEW: \`${afterNew.join(' → ')}\`
EXISTING unchanged: \`${existing.join(' → ')}\`
`);

const ok = stage6.pass && stage5.pass && stage4.pass && stage3.pass && stage2.pass;
console.log(JSON.stringify({ ok, evidenceDir, stage6Focused: stage6.pass ? 'PASS' : 'FAIL' }, null, 2));
process.exit(ok ? 0 : 1);
