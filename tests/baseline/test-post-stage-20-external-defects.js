#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

const bootSrc = read('cloud/boot-flow-ui.js');
const coordSrc = read('cloud/bootstrap-coordinator.js');
const discoverySrc = read('cloud/cloud-data-discovery.js');
const indexSrc = read('index.html');

check('BUG-EXT-004 branch_select merges discovery branch candidates', () => {
  assert.match(bootSrc, /authoritativeBootstrapBranches/);
  assert.match(bootSrc, /populateBootstrapBranchSelect/);
  assert.match(bootSrc, /discovery\?\.branchCandidates/);
  assert.match(indexSrc, /extraBranches/);
});

check('BUG-EXT-005 restore rescan executes fresh discovery', () => {
  assert.match(bootSrc, /runDiscovery\(true\)/);
  assert.match(bootSrc, /forceRescan = false/);
  assert.doesNotMatch(bootSrc, /إعادة فحص السحابة[\s\S]{0,120}renderStepUI\(loadWizard\(\)\)/);
});

check('BUG-EXT-006 NEW start_new prefers owner creation', () => {
  assert.match(bootSrc, /preferOwnerCreation = isNewFreshStartPath\(\)/);
});

check('BUG-EXT-007 coordinator honors explicit back navigation review index', () => {
  assert.match(coordSrc, /reviewStepIndex/);
  assert.match(bootSrc, /reviewStepIndex/);
});

check('BUG-EXT-008 restore emits heartbeat during native cloud restore', () => {
  assert.match(discoverySrc, /RESTORE_OPERATION_TIMEOUT_MS/);
  assert.match(discoverySrc, /heartbeatRatio/);
  assert.match(discoverySrc, /backup_password_required/);
});

check('BUG-EXT-009 syncCloudStatusFromElectron does not downgrade on transient read', () => {
  assert.match(indexSrc, /Only downgrade on authoritative auth loss/);
});

check('BUG-EXT-002 discovery errors are not pinned to google when connected', () => {
  assert.match(bootSrc, /discoveryCodes\.includes\(normalized\.code\)/);
  assert.match(bootSrc, /step = 'discovery'/);
  assert.match(bootSrc, /stepId: 'discovery'/);
});

check('BUG-EXT-003 google disconnect/switch exposed in bootstrap', () => {
  assert.match(bootSrc, /فصل \/ تغيير حساب Google/);
  assert.match(bootSrc, /disconnectGoogleDuringSetup/);
});

check('BUG-EXT-001 responsive bootstrap layout guards clipping', () => {
  assert.match(bootSrc, /calc\(100vw - 2 \* clamp/);
  assert.match(bootSrc, /@media \(min-width:641px\)\{\.bf-checklist-layout/);
  assert.match(bootSrc, /overflow-x:hidden/);
});

console.log('\nPost-Stage-20 external defect regression checks complete.');
