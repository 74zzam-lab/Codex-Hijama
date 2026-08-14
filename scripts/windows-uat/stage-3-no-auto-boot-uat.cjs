#!/usr/bin/env node
'use strict';

/**
 * Stage 3 evidence pack — No Auto-Boot for READY devices.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.STAGE3_BUILD_ID || process.env.STAGE2_BUILD_ID || process.env.STAGE1_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence/STAGE-3-NO-AUTO-BOOT', buildId);
fs.mkdirSync(evidenceDir, { recursive: true });

function git(cmd) {
  const r = spawnSync('git', cmd, { cwd: root, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

function runTest(rel) {
  const r = spawnSync(process.execPath, [path.join(root, rel)], { cwd: root, encoding: 'utf8' });
  return { pass: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

const stage2Ref = {
  commit: 'afa8e290fff539f42d544063567096c3e475c3b7',
  githubRun: '31688652938',
  zipSha256: 'e60c2ec8f94b2efc302336c222ff977b405679b218da03c1f6297014331db0f9',
};

const startupMap = {
  flow: [
    'index.html startup()',
    'SqliteBridge.initializeAtStartup',
    'SetupStateService.evaluateReady (early gate)',
    'BootFlow.onAppStartupAfterRelaunch',
    'ensureUserLoginScreenVisible',
    'SetupStateDom.applyDomVisibility',
    'cloud init',
    'BootFlow.maybeAutoOpenBootFlow',
  ],
  decisionRule: 'evaluateReady().ready === true → skip automatic BootFlow open',
  writers: {
    evaluateReady: 'cloud/setup-state-service.js',
    needsBootFlow: 'cloud/setup-state-service.js getState + cloud/setup-state-dom.js',
    shouldAutoOpenBoot: 'cloud/boot-flow-ui.js',
    autoOpenCallSite: 'index.html startup → BootFlow.maybeAutoOpenBootFlow',
  },
};

const autoBootEntryPoints = [
  { file: 'index.html', function: 'startup', condition: 'BootFlow.maybeAutoOpenBootFlow', auto: true, guardedBy: 'evaluateReady().ready' },
  { file: 'index.html', function: 'finishLogin', condition: 'SetupStateDom.needsBootFlow', auto: true, guardedBy: 'evaluateReady().ready via getState' },
  { file: 'index.html', function: 'showPage', condition: 'SetupStateDom.needsBootFlow', auto: true, guardedBy: 'evaluateReady().ready via getState' },
  { file: 'cloud/boot-flow-ui.js', function: 'forceOpen', condition: 'manual / URL ?boot=1', auto: false },
  { file: 'index.html', function: 'openBootWizardFromLogin', condition: 'user click CTA', auto: false },
  { file: 'cupping-first-run.js', function: 'shouldShowSetupWizard', condition: 'forceWizard only + READY guard', auto: false },
];

const stage3 = runTest('tests/baseline/test-stage-3-no-auto-boot.js');
const stage2 = runTest('tests/baseline/test-stage-2-ready-pure.js');
const stage1Tests = [
  'tests/baseline/test-v2-5-10-cloud-discovery-restore.js',
  'tests/baseline/test-p0-c-restore-truth-and-boot-gate.js',
  'tests/baseline/test-current-restore-license-login.js',
  'tests/baseline/test-current-setup-restore-runtime.js',
  'tests/baseline/test-v2-5-8-auth-activation-ui.js',
].map((name) => ({ name, ...runTest(name) }));

fs.writeFileSync(path.join(evidenceDir, 'SOURCE-MANIFEST.json'), `${JSON.stringify({
  branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
  commit: git(['rev-parse', 'HEAD']),
  commitShort: git(['rev-parse', '--short', 'HEAD']),
  stage2Baseline: stage2Ref,
  buildId,
  at: new Date().toISOString(),
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'STARTUP-DECISION-MAP.json'), `${JSON.stringify(startupMap, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'AUTO-BOOT-ENTRY-POINTS.json'), `${JSON.stringify({ entryPoints: autoBootEntryPoints }, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'READY-STARTUP-TRACE.json'), `${JSON.stringify({
  expected: ['DB ready', 'evaluateReady', 'ready=true', 'bootstrap auto-open skipped', 'internal login initialized'],
  instrumentation: 'BootFlow.getStage3BootTrace()',
  metrics: {
    evaluateReadyCalls: '>= 1 on READY profile',
    autoBootOpenCalls: '0 on READY profile',
    loginInitCalls: '1 per maybeAutoOpenBootFlow',
    bootVisibilityEvents: '0 on READY auto-startup',
  },
  nodeHarness: stage3.pass ? 'PASS' : 'FAIL',
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'NOT-READY-STARTUP-TRACE.json'), `${JSON.stringify({
  expected: ['DB ready', 'evaluateReady', 'ready=false', 'existing bootstrap behavior (shouldAutoOpenBoot true)'],
  nodeHarness: 'covered in test-stage-3-no-auto-boot.js NOT READY cases',
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'FIRST-RUN-INTERACTION.json'), `${JSON.stringify({
  module: 'cupping-first-run.js',
  autoOpenPolicy: 'shouldShowSetupWizard returns false when evaluateReady().ready',
  manualEntry: 'settings.firstRun.forceWizard === true',
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'DELAYED-HOOKS.json'), `${JSON.stringify({
  tested: 'setTimeout 25ms after READY startup — shouldAutoOpenBoot remains false',
  result: stage3.pass ? 'PASS' : 'FAIL',
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'RACE-VERIFICATION.json'), `${JSON.stringify({
  earlyGate: 'index.html early-ready-no-auto-boot after SQLite init',
  lateGate: 'BootFlow.maybeAutoOpenBootFlow after cloud init',
  bootFlashMitigation: 'early gate + authoritative READY before auto-open',
  nodeHarness: stage3.pass ? 'PASS' : 'FAIL',
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'RESTART-VERIFICATION.json'), `${JSON.stringify({
  iterations: 5,
  expected: 'READY=true, no auto boot each restart',
  nodeHarness: stage3.pass ? 'PASS' : 'FAIL',
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'RESTORE-STARTUP-VERIFICATION.json'), `${JSON.stringify({
  scenario: 'restore profile with bootstrapCompletedAt, stale wizard',
  expected: 'Login path, no auto BootFlow',
  nodeHarness: stage3.pass ? 'PASS' : 'FAIL',
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'TEST-RESULTS.json'), `${JSON.stringify({
  stage3Focused: stage3.pass ? 'PASS' : 'FAIL',
  stage2Focused: stage2.pass ? 'PASS' : 'FAIL',
  stage1Focused: stage1Tests.every((t) => t.pass) ? 'PASS' : 'FAIL',
  stage3Stdout: stage3.stdout,
  stage3Stderr: stage3.stderr,
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'REGRESSION-RESULTS.json'), `${JSON.stringify({
  stage3Focused: stage3.pass ? 'PASS' : 'FAIL',
  stage2Focused: stage2.pass ? 'PASS' : 'FAIL',
  stage1Details: stage1Tests,
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'WINDOWS-VERIFICATION.json'), `${JSON.stringify({
  node: stage3.pass ? 'PASS' : 'FAIL',
  electronIpcHarness: 'via stage-1/2 UAT scripts',
  installedExeSmoke: 'GHA post-build (startup auto-boot not visually verified)',
  fullInteractiveGui: 'UNVERIFIED',
  realGoogleDrive: 'UNVERIFIED',
}, null, 2)}\n`);

const summary = `# Stage 3 No Auto-Boot — Summary

**Build ID:** ${buildId}
**Commit:** ${git(['rev-parse', 'HEAD'])}
**Stage 2 baseline:** ${stage2Ref.commit} (run ${stage2Ref.githubRun})

## Verdict
**${stage3.pass && stage2.pass && stage1Tests.every((t) => t.pass) ? 'PASS' : 'FAIL'}**

## Stage 3 focused
${stage3.pass ? 'PASS' : 'FAIL'}

## Regressions
- Stage 2: ${stage2.pass ? 'PASS' : 'FAIL'}
- Stage 1: ${stage1Tests.every((t) => t.pass) ? 'PASS' : 'FAIL'}
`;

fs.writeFileSync(path.join(evidenceDir, 'SUMMARY.md'), summary);

console.log(JSON.stringify({
  ok: stage3.pass && stage2.pass,
  evidenceDir,
  stage3Focused: stage3.pass ? 'PASS' : 'FAIL',
  stage2Focused: stage2.pass ? 'PASS' : 'FAIL',
  stage1Focused: stage1Tests.every((t) => t.pass) ? 'PASS' : 'FAIL',
}, null, 2));

process.exit(stage3.pass && stage2.pass && stage1Tests.every((t) => t.pass) ? 0 : 1);
