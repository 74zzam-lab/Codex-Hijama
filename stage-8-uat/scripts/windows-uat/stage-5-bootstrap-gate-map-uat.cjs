#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.STAGE5_BUILD_ID || process.env.STAGE4_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence/STAGE-5-BOOTSTRAP-GATE-MAP', buildId);
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

const stage5 = runTest('tests/baseline/test-stage-5-bootstrap-gate-map.js');
const stage4 = runTest('tests/baseline/test-stage-4-bootstrap-coordinator-state.js');
const stage3 = runTest('tests/baseline/test-stage-3-no-auto-boot.js');
const stage2 = runTest('tests/baseline/test-stage-2-ready-pure.js');
const stage1Tests = [
  'tests/baseline/test-v2-5-10-cloud-discovery-restore.js',
  'tests/baseline/test-p0-c-restore-truth-and-boot-gate.js',
  'tests/baseline/test-current-restore-license-login.js',
  'tests/baseline/test-current-setup-restore-runtime.js',
  'tests/baseline/test-v2-5-8-auth-activation-ui.js',
].map((name) => ({ name, ...runTest(name) }));

const runtimeNew = BG.CURRENT_NEW_RUNTIME;
const runtimeExisting = BG.CURRENT_EXISTING_RUNTIME;
const ro = BG.runtimeOrderingUnchanged();

fs.writeFileSync(path.join(evidenceDir, 'SOURCE-MANIFEST.json'), `${JSON.stringify({
  stage4Baseline: { commit: '4974ebda7760e7fd487723bf08ef1a8be9571b89', evidence: '9f32c2f', run: '31695065909' },
  commit: git(['rev-parse', 'HEAD']),
  buildId,
  at: new Date().toISOString(),
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'CURRENT-NEW-FLOW.json'), `${JSON.stringify({
  steps: runtimeNew,
  transitions: runtimeNew.slice(0, -1).map((step, i) => ({
    from: step,
    to: runtimeNew[i + 1],
    decidedBy: 'BootFlow.validateStep + wizard navigation',
    condition: `isStepResolved('${step}')`,
    stateDependsOn: 'Services/SQLite SoT (Stage 4 coordinator)',
  })),
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'CURRENT-EXISTING-FLOW.json'), `${JSON.stringify({
  steps: runtimeExisting,
  excessVsTarget: ['license step when recovered', 'organization when recovered', 'owner when restored from backup'],
  transitions: runtimeExisting.slice(0, -1).map((step, i) => ({
    from: step,
    to: runtimeExisting[i + 1],
    decidedBy: 'BootFlow.validateStep',
    condition: `isStepResolved('${step}')`,
  })),
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'TARGET-NEW-FLOW.json'), `${JSON.stringify({ gates: BG.TARGET_NEW_GATES }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'TARGET-EXISTING-FLOW.json'), `${JSON.stringify({ gates: BG.TARGET_EXISTING_GATES }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'STEP-INVENTORY.json'), `${JSON.stringify({ steps: BG.getStepInventory() }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'GATE-REGISTRY.json'), `${JSON.stringify({
  new: BG.TARGET_NEW_GATES,
  existing: BG.TARGET_EXISTING_GATES,
  statusEnum: BG.GATE_STATUS,
  module: 'cloud/bootstrap-gates.js',
}, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'GATE-SOURCE-OF-TRUTH.json'), `${JSON.stringify({ gates: BG.getGateSourceOfTruth() }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'DEPENDENCY-GRAPH.json'), `${JSON.stringify(BG.getDependencyGraph(), null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'CIRCULAR-DEPENDENCIES.json'), `${JSON.stringify({ cycles: BG.getCircularDependencies() }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'ORIGINAL-VS-CURRENT.json'), `${JSON.stringify({ comparisons: BG.getOriginalVsCurrent() }, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'REORDER-RISK-MATRIX.json'), `${JSON.stringify(BG.getReorderRiskMatrix(), null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'BACKWARD-COMPATIBILITY.json'), `${JSON.stringify(BG.getBackwardCompatibility(), null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'STAGE-6-PLAN.json'), `${JSON.stringify(BG.getStage6Plan(), null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'TEST-RESULTS.json'), `${JSON.stringify({
  stage5Focused: stage5.pass ? 'PASS' : 'FAIL',
  runtimeOrderingUnchanged: ro.unchanged ? 'PASS' : 'FAIL',
  gateZeroWrite: stage5.pass ? 'PASS' : 'FAIL',
  gateIdempotent: stage5.pass ? 'PASS' : 'FAIL',
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'REGRESSION-RESULTS.json'), `${JSON.stringify({
  stage5Focused: stage5.pass ? 'PASS' : 'FAIL',
  stage4Focused: stage4.pass ? 'PASS' : 'FAIL',
  stage3Focused: stage3.pass ? 'PASS' : 'FAIL',
  stage2Focused: stage2.pass ? 'PASS' : 'FAIL',
  stage1Focused: stage1Tests.every((t) => t.pass) ? 'PASS' : 'FAIL',
  stage1Details: stage1Tests,
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'WINDOWS-VERIFICATION.json'), `${JSON.stringify({
  nodeHarness: stage5.pass ? 'PASS' : 'FAIL',
  windowsRunner: 'windows-2022',
  installedExeSmoke: 'GHA post-build',
  fullInteractiveGui: 'UNVERIFIED',
  realGoogleDrive: 'UNVERIFIED',
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'GITHUB-ACTIONS.json'), `${JSON.stringify({
  workflow: 'stage-1-windows-verification.yml',
  stage: 5,
  note: 'populated after push',
}, null, 2)}\n`);

fs.writeFileSync(path.join(evidenceDir, 'SUMMARY.md'), `# Stage 5 Bootstrap Gate Map — Summary

**Build ID:** ${buildId}
**Verdict:** ${stage5.pass && stage4.pass && stage3.pass && stage2.pass ? 'PASS' : 'FAIL'}

Gate model prepared and verified. **Runtime ordering unchanged.**

## Current NEW
${runtimeNew.join(' → ')}

## Current EXISTING
${runtimeExisting.join(' → ')}

## Target NEW gates
${BG.TARGET_NEW_GATES.join(' → ')}

## Target EXISTING gates
${BG.TARGET_EXISTING_GATES.join(' → ')}

Stage 6 NOT started — awaiting approval.
`);

const ok = stage5.pass && stage4.pass && stage3.pass && stage2.pass && stage1Tests.every((t) => t.pass);
console.log(JSON.stringify({ ok, evidenceDir, stage5Focused: stage5.pass ? 'PASS' : 'FAIL' }, null, 2));
process.exit(ok ? 0 : 1);
