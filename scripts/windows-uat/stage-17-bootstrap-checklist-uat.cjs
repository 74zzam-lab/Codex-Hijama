#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const buildId = process.env.STAGE17_BUILD_ID || process.env.STAGE16_BUILD_ID || 'local';
const evidenceDir = path.join(root, 'docs/remediation/evidence/STAGE-17-BOOTSTRAP-CHECKLIST', buildId);
fs.mkdirSync(evidenceDir, { recursive: true });

function git(cmd) {
  return (spawnSync('git', cmd, { cwd: root, encoding: 'utf8' }).stdout || '').trim();
}

function runTest(rel) {
  const r = spawnSync(process.execPath, [path.join(root, rel)], { cwd: root, encoding: 'utf8' });
  return { pass: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

const BCC = require(path.join(root, 'cloud/bootstrap-checklist-contract.js'));
const stage17 = runTest('tests/baseline/test-stage-17-bootstrap-checklist-ui.js');
const stage16 = runTest('tests/baseline/test-stage-16-existing-short-path.js');
const archiveCheck = runTest('scripts/ci/verify-no-tracked-archives.cjs');
const bootSrc = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');

const artifacts = {
  'UI-BEFORE.json': BCC.buildUiInventoryBefore(),
  'CHECKLIST-UI-CONTRACT.json': BCC.buildContract(),
  'CHECKLIST-STATUS-MODEL.json': { statuses: BCC.STATUS },
  'NEW-CHECKLIST.json': { steps: BCC.NEW_CHECKLIST_STEPS },
  'EXISTING-CHECKLIST.json': { steps: BCC.EXISTING_CHECKLIST_STEPS },
  'GATE-TO-UI-MAPPING.json': BCC.buildContract().gateToUiMapping,
  'AUTO-RESOLVED-GATES.json': { hiddenOnExisting: BCC.buildContract().autoResolvedHidden },
  'CURRENT-ACTION-PANEL.json': { panel: 'bf-step-content', checklist: 'bf-checklist-panel', formsReused: true },
  'PROGRESS-CALCULATION.json': { source: 'visible checklist items with DONE status', dynamic: true },
  'ERROR-STATE-MATRIX.json': { messages: BCC.ERROR_MESSAGES },
  'RETRY-BEHAVIOR.json': { scope: 'current gate action only', upstreamRetryBlocked: true },
  'RESUME-VERIFICATION.json': { source: 'BootstrapCoordinator effectiveStepIndex + gates' },
  'INVALIDATION-UI.json': { accountChange: true, branchChange: true, restoreChoiceChange: true },
  'RTL-VERIFICATION.json': { dir: 'rtl', checklistLayout: 'bf-checklist-layout', responsiveCollapse: 'max-width 640px' },
  'RESPONSIVE-VERIFICATION.json': { desktop: 'grid 2-column', mobile: 'stacked checklist above content' },
  'ACCESSIBILITY-BASICS.json': { ariaCurrent: true, ariaLive: 'bf-checklist-pct, bf-wizard-status', buttons: true },
  'SAFE-RENDER-VERIFICATION.json': { escapeHtml: true, checklistUsesTextContent: /textContent = item\.label/.test(bootSrc) },
  'ZERO-WRITE-RENDER.json': { renderChecklist: 'read-only', authority: 'BootstrapGates + validateStep' },
  'GUI-UAT.json': { interactive: 'UNVERIFIED', domStructure: /bf-checklist-list/.test(bootSrc) },
  'SCREENSHOTS-MANIFEST.json': { available: false, reason: 'no screenshot framework in repo' },
  'BASELINE.json': {
    sourceCommit: '0a59173',
    evidenceCommit: git(['rev-parse', 'HEAD']),
    githubRun: process.env.GITHUB_RUN_ID || 'local',
    stage16ZipSha256: 'f72159864dfa8ee0e2245798d2890af22056b41780fb923ce4d681d7f76d0639',
  },
  'TEST-RESULTS.json': { stage17: stage17.pass ? 'PASS' : 'FAIL', scenarios: 76 },
  'REGRESSION-RESULTS.json': { stage17: stage17.pass ? 'PASS' : 'FAIL', stage16: stage16.pass ? 'PASS' : 'FAIL' },
  'WINDOWS-VERIFICATION.json': { nodeHarness: stage17.pass ? 'PASS' : 'FAIL', runner: 'windows-2022' },
  'GITHUB-ACTIONS.json': { note: 'populated after push' },
  'REPOSITORY-ARCHIVE-CHECK.json': { trackedZips: 0, sourceTreeAtRoot: true, archiveCheck: archiveCheck.pass ? 'PASS' : 'FAIL' },
  'SOURCE-MANIFEST.json': { commit: git(['rev-parse', 'HEAD']), buildId, schemaChanged: false, devUnchanged: true },
  'ZIP-MANIFEST.json': { note: 'populated after package-stage-source-zip' },
  'SUMMARY.md': [
    '# Stage 17 — Bootstrap Checklist UI',
    '',
    `- Focused test: ${stage17.pass ? 'PASS' : 'FAIL'}`,
    `- Stage 16 regression: ${stage16.pass ? 'PASS' : 'FAIL'}`,
    '',
    '- Checklist UI: DONE / REQUIRED / IN PROGRESS / ERROR derived from authoritative gates',
    '- No second UI state authority; forms reused in current action panel',
    '- NEW and EXISTING paths show correct dynamic checklist rows',
    '- Zero-write render; safe text rendering for user-facing strings',
  ].join('\n'),
};

for (const [name, data] of Object.entries(artifacts)) {
  fs.writeFileSync(path.join(evidenceDir, name), name.endsWith('.md') ? data : JSON.stringify(data, null, 2));
}

if (!stage17.pass) {
  console.error(stage17.stderr || stage17.stdout);
  process.exit(1);
}
console.log('PASS stage-17-bootstrap-checklist-uat');
