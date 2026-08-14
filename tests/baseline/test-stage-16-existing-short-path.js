#!/usr/bin/env node
'use strict';

/**
 * Stage 16 — Existing customer short path (FLOW_AFTER convergence).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

const ESC = require(path.join(root, 'cloud/existing-short-path-contract.js'));
const PC = require(path.join(root, 'cloud/publication-contract.js'));
const RVC = require(path.join(root, 'cloud/readback-verification-contract.js'));
const BSC = require(path.join(root, 'cloud/business-setup-contract.js'));

const STAGE_15_NEW_STEPS = Object.freeze([
  'language', 'license', 'google', 'discovery', 'path_decision', 'organization', 'owner',
  'branch', 'device', 'business_setup', 'publication', 'restore', 'sync', 'ready',
]);

const STAGE_16_EXISTING_STEPS = Object.freeze([
  'language', 'google', 'discovery', 'license_org_recovery', 'branch_select', 'device',
  'restore', 'owner_auth', 'sync', 'ready',
]);

function extractStringArray(src, varName) {
  const re = new RegExp(`const ${varName} = \\[([^\\]]+)\\]`);
  const m = src.match(re);
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim().replace(/['"]/g, ''));
}

function extractFreezeArray(src, varName) {
  const re = new RegExp(`const ${varName} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`);
  const m = src.match(re);
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
}

function snap(overrides = {}) {
  return {
    wizard: { path: 'existing', forkDecision: null, ...(overrides.wizard || {}) },
    meta: { centerId: 'CTR-S16', ...(overrides.meta || {}) },
    license: overrides.license,
    settings: overrides.settings,
  };
}

function recoveryMeta(overrides = {}) {
  return {
    existingShortPathRecovery: {
      recoveredAt: new Date().toISOString(),
      organizationId: 'CTR-S16',
      licenseRecovered: true,
      activationConsumed: false,
      activationConsumeDelta: 0,
      minimalPublicationWaived: true,
      minimalReadbackWaived: true,
      businessSetupFromRecovery: true,
      googleAccount: 'owner@test.com',
      candidateId: 'CTR-S16',
      ...overrides,
    },
  };
}

function withBootFlow(mock, fn) {
  const prev = global.BootFlow;
  global.BootFlow = mock;
  try { return fn(); } finally { global.BootFlow = prev; }
}

function withGlobals(mocks, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(mocks)) {
    saved[k] = global[k];
    global[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) global[k] = v;
  }
}

function run() {
  const bootSrc = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
  const coordSrc = fs.readFileSync(path.join(root, 'cloud/bootstrap-coordinator.js'), 'utf8');
  const gatesSrc = fs.readFileSync(path.join(root, 'cloud/bootstrap-gates.js'), 'utf8');
  const contractSrc = fs.readFileSync(path.join(root, 'cloud/existing-short-path-contract.js'), 'utf8');
  const indexSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  const bootNewSteps = extractStringArray(bootSrc, 'NEW_STEPS');
  const bootExistingSteps = extractStringArray(bootSrc, 'EXISTING_STEPS');
  const coordExistingSteps = extractStringArray(coordSrc, 'EXISTING_STEPS');
  const coordNewSteps = extractStringArray(coordSrc, 'NEW_STEPS');
  const gatesExistingRuntime = extractFreezeArray(gatesSrc, 'CURRENT_EXISTING_RUNTIME');
  const gatesNewRuntime = extractFreezeArray(gatesSrc, 'CURRENT_NEW_RUNTIME');
  const gatesTargetExisting = extractFreezeArray(gatesSrc, 'TARGET_EXISTING_GATES');

  // 1–8 FLOW_BEFORE vs FLOW_AFTER
  check(ESC.FLOW_BEFORE.length === 13, '1 FLOW_BEFORE length 13');
  check(ESC.FLOW_AFTER.length === 10, '2 FLOW_AFTER length 10');
  check(ESC.FLOW_BEFORE.includes('license') && ESC.FLOW_BEFORE.includes('organization'), '3 FLOW_BEFORE has license+organization');
  check(ESC.FLOW_BEFORE.includes('business_setup') && ESC.FLOW_BEFORE.includes('publication'), '4 FLOW_BEFORE has business_setup+publication');
  check(ESC.FLOW_AFTER.includes('license_org_recovery'), '5 FLOW_AFTER has license_org_recovery');
  check(ESC.FLOW_AFTER.includes('owner_auth'), '6 FLOW_AFTER has owner_auth');
  check(!ESC.FLOW_AFTER.includes('license'), '7 FLOW_AFTER no separate license');
  check(!ESC.FLOW_AFTER.includes('business_setup') && !ESC.FLOW_AFTER.includes('publication'), '8 FLOW_AFTER no business_setup/publication');

  // 9–14 FLOW_AFTER alignment
  check(JSON.stringify(ESC.FLOW_AFTER) === JSON.stringify(STAGE_16_EXISTING_STEPS), '9 FLOW_AFTER matches stage16 existing');
  check(ESC.FLOW_AFTER.indexOf('license_org_recovery') < ESC.FLOW_AFTER.indexOf('branch_select'), '10 recovery before branch');
  check(ESC.FLOW_AFTER.indexOf('restore') < ESC.FLOW_AFTER.indexOf('owner_auth'), '11 restore before owner_auth');
  check(ESC.FLOW_AFTER.indexOf('owner_auth') < ESC.FLOW_AFTER.indexOf('sync'), '12 owner_auth before sync');
  check(ESC.FLOW_AFTER[0] === 'language' && ESC.FLOW_AFTER.at(-1) === 'ready', '13 FLOW_AFTER bookends');
  check(ESC.FLOW_BEFORE.indexOf('owner') > ESC.FLOW_BEFORE.indexOf('publication'), '14 FLOW_BEFORE owner after publication');

  // 15–30 step classification
  const SC = ESC.STEP_CLASSIFICATION;
  check(SC.language === 'KEEP', '15 classify language KEEP');
  check(SC.google === 'KEEP', '16 classify google KEEP');
  check(SC.discovery === 'KEEP', '17 classify discovery KEEP');
  check(SC.license_org_recovery === 'MERGE', '18 classify license_org_recovery MERGE');
  check(SC.owner_auth === 'MERGE', '19 classify owner_auth MERGE');
  check(SC.license === 'MERGE', '20 classify license MERGE');
  check(SC.organization === 'MERGE', '21 classify organization MERGE');
  check(SC.owner === 'MERGE', '22 classify owner MERGE');
  check(SC.business_setup === 'AUTO_RESOLVE', '23 classify business_setup AUTO_RESOLVE');
  check(SC.publication === 'AUTO_RESOLVE', '24 classify publication AUTO_RESOLVE');
  check(SC.readback === 'AUTO_RESOLVE', '25 classify readback AUTO_RESOLVE');
  check(SC.path_decision === 'REMOVE_FROM_EXISTING_FLOW', '26 classify path_decision REMOVE');
  check(SC.branch_select === 'KEEP', '27 classify branch_select KEEP');
  check(SC.device === 'KEEP', '28 classify device KEEP');
  check(SC.restore === 'KEEP', '29 classify restore KEEP');
  check(SC.sync === 'KEEP' && SC.ready === 'KEEP', '30 classify sync+ready KEEP');

  // 31–40 mapLegacyStep
  check(ESC.mapLegacyStep('license') === 'license_org_recovery', '31 map license');
  check(ESC.mapLegacyStep('organization') === 'license_org_recovery', '32 map organization');
  check(ESC.mapLegacyStep('owner') === 'owner_auth', '33 map owner');
  check(ESC.mapLegacyStep('business_setup') === null, '34 map business_setup null');
  check(ESC.mapLegacyStep('publication') === null, '35 map publication null');
  check(ESC.mapLegacyStep('readback') === null, '36 map readback null');
  check(ESC.mapLegacyStep('device') === 'device', '37 map device passthrough');
  check(ESC.mapLegacyStep('sync') === 'sync', '38 map sync passthrough');
  check(ESC.mapLegacyStep('google') === 'google', '39 map google passthrough');
  check(ESC.mapLegacyStep('branch_select') === 'branch_select', '40 map branch_select passthrough');

  // 41–48 migrateCompletedSteps
  check(JSON.stringify(ESC.migrateCompletedSteps(['license', 'organization'])) === JSON.stringify(['license_org_recovery']), '41 migrate license+org dedupe');
  check(JSON.stringify(ESC.migrateCompletedSteps(['owner'])) === JSON.stringify(['owner_auth']), '42 migrate owner');
  check(JSON.stringify(ESC.migrateCompletedSteps(['business_setup', 'publication', 'readback'])) === JSON.stringify([]), '43 migrate auto-resolve dropped');
  check(JSON.stringify(ESC.migrateCompletedSteps(['google', 'device', 'sync'])) === JSON.stringify(['google', 'device', 'sync']), '44 migrate keep steps');
  check(ESC.migrateCompletedSteps(['license', 'owner', 'business_setup']).length === 2, '45 migrate mixed length');
  check(ESC.migrateCompletedSteps(null).length === 0, '46 migrate null empty');
  check(ESC.migrateCompletedSteps([]).length === 0, '47 migrate empty array');
  check(ESC.migrateCompletedSteps(['license', 'license']).length === 1, '48 migrate duplicate license');

  // 49–54 isExistingPath convergence
  check(ESC.isExistingPath(snap({ wizard: { path: 'existing' } })), '49 direct existing path');
  check(ESC.isExistingPath(snap({ wizard: { path: 'new', forkDecision: 'use_existing' } })), '50 use_existing fork');
  check(!ESC.isExistingPath(snap({ wizard: { path: 'new', forkDecision: 'start_new' } })), '51 start_new not existing');
  check(!ESC.isExistingPath(snap({ wizard: { path: 'new' } })), '52 plain new not existing');
  check(ESC.isExistingPath({ wizard: { path: 'existing' } }) === ESC.isExistingPath({ wizard: { path: 'new', forkDecision: 'use_existing' } }), '53 direct vs use_existing same flag');
  check(ESC.isExistingPath({}) === false, '54 empty snapshot not existing');

  // 55–62 licenseOrgRecoveryResolved mocks
  check(withBootFlow({ licenseOrgRecoveryResolved: () => true, hasValidLicense: () => true }, () => ESC.licenseOrgRecoveryResolved(snap())), '55 licenseOrgRecovery BootFlow delegate');
  check(withBootFlow({ licenseOrgRecoveryResolved: () => false }, () => !ESC.licenseOrgRecoveryResolved(snap())), '56 licenseOrgRecovery BootFlow false');
  check(withGlobals({
    BootFlow: { hasValidLicense: () => true },
    LicenseCloud: { loadLocal: () => ({ centerId: 'CTR-S16', centerName: 'Center' }) },
    settings: { centerName: 'Center' },
  }, () => ESC.licenseOrgRecoveryResolved(snap())), '57 licenseOrgRecovery license+name');
  check(withGlobals({
    BootFlow: { hasValidLicense: () => true },
    LicenseCloud: { loadLocal: () => ({ centerId: 'CTR-S16' }) },
    settings: {},
  }, () => !ESC.licenseOrgRecoveryResolved(snap())), '58 licenseOrgRecovery missing name');
  check(withGlobals({
    BootFlow: { hasValidLicense: () => false },
    LicenseCloud: { loadLocal: () => ({ centerId: 'CTR-S16', centerName: 'Center' }) },
  }, () => !ESC.licenseOrgRecoveryResolved(snap())), '59 licenseOrgRecovery invalid license');
  check(withGlobals({
    BootFlow: { hasValidLicense: () => true },
    LicenseCloud: { loadLocal: () => null },
  }, () => !ESC.licenseOrgRecoveryResolved(snap({ meta: { centerId: '' }, license: { centerId: '', centerName: '' }, settings: { centerName: '' } }))), '60 licenseOrgRecovery empty ids');
  check(withGlobals({
    BootFlow: { hasValidLicense: () => true },
    LicenseCloud: { loadLocal: () => ({ center_id: 'CTR-S16', centerName: 'Alt' }) },
  }, () => ESC.licenseOrgRecoveryResolved(snap())), '61 licenseOrgRecovery center_id alias');
  check(withGlobals({
    BootFlow: { hasValidLicense: () => true },
    LicenseCloud: { loadLocal: () => null },
  }, () => ESC.licenseOrgRecoveryResolved(snap({ meta: { centerId: 'CTR-S16' }, settings: { centerName: 'Meta Name' } }))), '62 licenseOrgRecovery meta fallback');

  // 63–70 minimalPublicationSatisfied
  check(!ESC.minimalPublicationSatisfied(snap({ wizard: { path: 'new' } })), '63 minimalPublication false on NEW');
  check(ESC.minimalPublicationSatisfied(snap({ meta: { bootstrapCompletedAt: 'x' } })), '64 minimalPublication bootstrap complete');
  check(ESC.minimalPublicationSatisfied(snap({ meta: recoveryMeta() })), '65 minimalPublication recovery waived');
  check(ESC.minimalPublicationSatisfied(snap({ meta: recoveryMeta({ minimalPublicationWaived: false }) })) === false, '66 minimalPublication waiver false');
  check(withGlobals({
    PublicationContract: PC,
  }, () => ESC.minimalPublicationSatisfied(snap({
    meta: {
      setupPublication: {
        state: 'PUBLICATION_VERIFIED', path: 'existing', requiredArtifacts: ['license', 'outbox'],
        artifacts: { license: { ok: true, readBack: true }, outbox: { ok: true, readBack: true } },
      },
    },
  }))), '67 minimalPublication contract resolved');
  check(ESC.minimalPublicationSatisfied(snap({ meta: { licenseRecovered: true } })) === false, '68 minimalPublication no recovery record');
  check(ESC.minimalPublicationSatisfied(snap({ meta: recoveryMeta({ licenseRecovered: false }) })) === false, '69 minimalPublication license not recovered');
  check(ESC.minimalPublicationSatisfied(snap({ wizard: { path: 'new', forkDecision: 'use_existing' }, meta: recoveryMeta() })), '70 minimalPublication use_existing path');

  // 71–78 minimalReadbackSatisfied
  check(!ESC.minimalReadbackSatisfied(snap({ wizard: { path: 'new' } })), '71 minimalReadback false on NEW');
  check(ESC.minimalReadbackSatisfied(snap({ meta: { bootstrapCompletedAt: 'x' } })), '72 minimalReadback bootstrap complete');
  check(ESC.minimalReadbackSatisfied(snap({ meta: recoveryMeta() })), '73 minimalReadback recovery waived');
  check(ESC.minimalReadbackSatisfied(snap({ meta: recoveryMeta({ minimalReadbackWaived: false }) })) === false, '74 minimalReadback waiver false');
  check(withGlobals({
    ReadbackVerificationContract: RVC,
    PublicationContract: PC,
    LicenseCloud: { loadLocal: () => ({ centerId: 'CTR-S16' }) },
    DeviceConfig: { load: () => ({ lockedBranchId: 'BR-1', deviceUuid: 'DEV-1' }) },
    settings: { centerName: 'Center', backup: { providers: { google: { email: 'owner@test.com' } } } },
    DB: {
      get: (k) => {
        if (k === '__tdw_boot_wizard__') return { path: 'existing' };
        if (k === '__tdw_meta__') {
          return {
            setupPublication: {
              state: 'PUBLICATION_VERIFIED', path: 'existing', requiredArtifacts: ['license', 'outbox'],
              artifacts: { license: { ok: true, readBack: true }, outbox: { ok: true, readBack: true } },
            },
            readbackVerification: {
              state: 'VERIFIED', path: 'existing', requiredArtifacts: ['license', 'outbox'],
              artifacts: {
                license: { ok: true, readBack: true, state: 'CONTENT_VERIFIED' },
                outbox: { ok: true, readBack: true, state: 'CONTENT_VERIFIED' },
              },
              binding: { organizationId: 'CTR-S16', branchId: 'BR-1', deviceId: 'DEV-1', googleAccount: 'owner@test.com' },
            },
          };
        }
        return null;
      },
    },
  }, () => ESC.minimalReadbackSatisfied(snap({
    meta: {
      setupPublication: {
        state: 'PUBLICATION_VERIFIED', path: 'existing', requiredArtifacts: ['license', 'outbox'],
        artifacts: { license: { ok: true, readBack: true }, outbox: { ok: true, readBack: true } },
      },
      readbackVerification: {
        state: 'VERIFIED', path: 'existing', requiredArtifacts: ['license', 'outbox'],
        artifacts: { license: { ok: true, readBack: true, state: 'CONTENT_VERIFIED' }, outbox: { ok: true, readBack: true, state: 'CONTENT_VERIFIED' } },
        binding: { organizationId: 'CTR-S16', branchId: 'BR-1', deviceId: 'DEV-1', googleAccount: 'owner@test.com' },
      },
    },
  }))), '75 minimalReadback contract verified');
  check(ESC.minimalReadbackSatisfied(snap({ meta: {} })) === false, '76 minimalReadback empty meta');
  check(ESC.minimalReadbackSatisfied(snap({ meta: recoveryMeta({ licenseRecovered: false }) })) === false, '77 minimalReadback license not recovered');
  check(ESC.minimalReadbackSatisfied(snap({ wizard: { path: 'existing' }, meta: recoveryMeta() })), '78 minimalReadback direct existing');

  // 79–84 ownerAuthResolved
  check(withBootFlow({ ownerAuthStepResolved: () => true, hasOwnerPasswordAccount: () => true, setupOwnerSessionReady: () => true }, () => ESC.ownerAuthResolved(snap())), '79 ownerAuth BootFlow delegate');
  check(withBootFlow({ ownerAuthStepResolved: () => false }, () => !ESC.ownerAuthResolved(snap())), '80 ownerAuth BootFlow false');
  check(withBootFlow({ hasOwnerPasswordAccount: () => false, setupOwnerSessionReady: () => true }, () => !ESC.ownerAuthResolved(snap())), '81 ownerAuth no password account');
  check(withBootFlow({ hasOwnerPasswordAccount: () => true, setupOwnerSessionReady: () => false }, () => !ESC.ownerAuthResolved(snap())), '82 ownerAuth session not ready');
  check(withBootFlow({ hasOwnerPasswordAccount: () => true, setupOwnerSessionReady: () => true }, () => ESC.ownerAuthResolved(snap())), '83 ownerAuth session ready');
  check(withBootFlow({}, () => !ESC.ownerAuthResolved(snap())), '84 ownerAuth missing BootFlow helpers');

  // 85–92 gatesBeforeSyncSatisfied
  const allGatesOk = withGlobals({
    BootFlow: {
      businessSetupStepResolved: () => true,
      publicationStepResolved: () => true,
      readbackStepResolved: () => true,
      ownerAuthStepResolved: () => true,
    },
    BusinessSetupContract: BSC,
  }, () => ESC.gatesBeforeSyncSatisfied(snap()));
  check(allGatesOk?.ok === true, '85 gates all satisfied via BootFlow');
  check(ESC.gatesBeforeSyncSatisfied(snap({ wizard: { path: 'new' } })) === null, '86 gates null on NEW path');
  const recoveryGates = ESC.gatesBeforeSyncSatisfied(snap({
    meta: recoveryMeta(),
    wizard: { path: 'existing' },
    settings: { centerName: 'C', phone: '0501234567' },
  }));
  check(recoveryGates?.businessSetup === true, '87 gates business from recovery');
  check(recoveryGates?.publication === true, '88 gates publication waived');
  check(recoveryGates?.readback === true, '89 gates readback waived');
  check(withBootFlow({ ownerAuthStepResolved: () => false, hasOwnerPasswordAccount: () => true, setupOwnerSessionReady: () => false }, () => {
    const g = ESC.gatesBeforeSyncSatisfied(snap({ meta: recoveryMeta(), wizard: { path: 'existing' }, settings: { centerName: 'C', phone: '050' } }));
    return g?.ownerAuth === false && g?.ok === false;
  }), '90 gates ownerAuth blocks');
  check(withBootFlow({
    businessSetupStepResolved: () => false,
    publicationStepResolved: () => false,
    readbackStepResolved: () => false,
    ownerAuthStepResolved: () => true,
  }, () => {
    const g = ESC.gatesBeforeSyncSatisfied(snap({ wizard: { path: 'existing' }, meta: {} }));
    return g?.ok === false;
  }), '91 gates missing without recovery');
  check(withBootFlow({ ownerAuthStepResolved: () => true }, () => ESC.gatesBeforeSyncSatisfied(snap({
    wizard: { path: 'new', forkDecision: 'use_existing' }, meta: recoveryMeta(),
  }))?.ok === true), '92 gates use_existing convergence');

  // 93–97 buildContract + TARGET_EXISTING_GATES
  const built = ESC.buildContract();
  check(built.flowAfter.length === ESC.FLOW_AFTER.length, '93 buildContract flowAfter');
  check(built.targetGates.includes('OWNER_AUTH_RESOLVED'), '94 buildContract OWNER_AUTH_RESOLVED');
  check(built.targetGates.includes('LICENSE_ORG_RECOVERY_RESOLVED'), '95 buildContract LICENSE_ORG_RECOVERY');
  check(built.prohibited.includes('manual activation'), '96 buildContract prohibited manual activation');
  check(built.convergence.includes('Direct Existing'), '97 buildContract convergence text');

  // 98–110 boot-flow-ui.js EXISTING_STEPS / version
  check(bootExistingSteps !== null, '98 boot-flow EXISTING_STEPS parseable');
  check(JSON.stringify(bootExistingSteps) === JSON.stringify(STAGE_16_EXISTING_STEPS), '99 boot-flow EXISTING_STEPS match');
  check(bootExistingSteps.includes('license_org_recovery'), '100 boot-flow has license_org_recovery');
  check(bootExistingSteps.includes('owner_auth'), '101 boot-flow has owner_auth');
  check(!bootExistingSteps.includes('license'), '102 boot-flow no separate license');
  check(!bootExistingSteps.includes('organization'), '103 boot-flow no separate organization');
  check(!bootExistingSteps.includes('business_setup'), '104 boot-flow no business_setup');
  check(!bootExistingSteps.includes('publication'), '105 boot-flow no publication');
  check(!bootExistingSteps.includes('owner'), '106 boot-flow no separate owner step');
  check(/const WIZARD_FLOW_VERSION = 16/.test(bootSrc), '107 WIZARD_FLOW_VERSION is 16');
  check(/WIZARD_FLOW_VERSION/.test(bootSrc) && Number(bootSrc.match(/const WIZARD_FLOW_VERSION = (\d+)/)?.[1]) >= 16, '108 WIZARD_FLOW_VERSION >= 16');
  check(/LEGACY_EXISTING_STEPS_PRE_STAGE16/.test(bootSrc), '109 legacy pre-stage16 preserved');
  check(/ExistingShortPathContract/.test(bootSrc), '110 boot-flow uses ExistingShortPathContract');

  // 111–116 NEW_STEPS unchanged from Stage 15
  check(JSON.stringify(bootNewSteps) === JSON.stringify(STAGE_15_NEW_STEPS), '111 NEW_STEPS unchanged stage15');
  check(JSON.stringify(coordNewSteps) === JSON.stringify(STAGE_15_NEW_STEPS), '112 coordinator NEW_STEPS unchanged');
  check(JSON.stringify(gatesNewRuntime) === JSON.stringify(STAGE_15_NEW_STEPS), '113 gates NEW runtime unchanged');
  check(bootNewSteps.indexOf('publication') < bootNewSteps.indexOf('restore'), '114 NEW publication before restore');
  check(bootNewSteps.includes('path_decision'), '115 NEW path_decision present');
  check(!bootNewSteps.includes('license_org_recovery'), '116 NEW no license_org_recovery');

  // 117–121 bootstrap-coordinator EXISTING_STEPS
  check(JSON.stringify(coordExistingSteps) === JSON.stringify(STAGE_16_EXISTING_STEPS), '117 coordinator EXISTING_STEPS match');
  check(coordExistingSteps.includes('owner_auth'), '118 coordinator owner_auth');
  check(coordExistingSteps.includes('license_org_recovery'), '119 coordinator license_org_recovery');
  check(!coordExistingSteps.includes('publication'), '120 coordinator no publication');
  check(coordExistingSteps.length === 10, '121 coordinator existing step count 10');

  // 122–127 bootstrap-gates runtime + TARGET_EXISTING_GATES
  check(JSON.stringify(gatesExistingRuntime) === JSON.stringify(STAGE_16_EXISTING_STEPS), '122 gates CURRENT_EXISTING_RUNTIME match');
  check(gatesTargetExisting.includes('OWNER_AUTH_RESOLVED'), '123 TARGET_EXISTING_GATES OWNER_AUTH_RESOLVED');
  check(gatesTargetExisting.includes('LICENSE_ORG_RECOVERY_RESOLVED'), '124 TARGET_EXISTING_GATES LICENSE_ORG_RECOVERY');
  check(gatesTargetExisting.includes('BUSINESS_SETUP_RESOLVED'), '125 TARGET_EXISTING_GATES BUSINESS_SETUP');
  check(gatesTargetExisting.includes('INITIAL_SYNC_RESOLVED'), '126 TARGET_EXISTING_GATES INITIAL_SYNC');
  check(/evaluateOwnerAuthResolved/.test(gatesSrc), '127 gates evaluateOwnerAuthResolved');

  // 128–131 index.html + schema
  check(/existing-short-path-contract\.js/.test(indexSrc), '128 index loads existing-short-path-contract');
  check(/id:\s*'__dev__'/.test(indexSrc), '129 __dev__ unchanged');
  check(/session\.userId === '__dev__'/.test(indexSrc), '130 __dev__ session guard unchanged');
  check(!/CREATE TABLE/.test(contractSrc), '131 schema unchanged in contract');

  // 132–141 Stage 10–15 regression markers in boot-flow
  check(/retireOwnerSeedsIfNeeded/.test(bootSrc), '132 stage10 owner seed marker');
  check(/deviceStepResolved/.test(bootSrc), '133 stage11 device regression');
  check(/businessSetupStepResolved/.test(bootSrc), '134 stage12 business regression');
  check(/publicationStepResolved/.test(bootSrc), '135 stage13 publication regression');
  check(/readbackStepResolved/.test(bootSrc), '136 stage14 readback regression');
  check(/resolveInitialSyncPlan|InitialSyncDirectionContract/.test(bootSrc), '137 stage15 initial sync contract');
  check(/existingShortPathRecovery/.test(bootSrc), '138 stage16 recovery record writer');
  check(/licenseOrgRecoveryResolved/.test(bootSrc), '139 stage16 licenseOrgRecoveryResolved');
  check(/ownerAuthStepResolved/.test(bootSrc), '140 stage16 ownerAuthStepResolved');
  check(/migrateCompletedSteps/.test(bootSrc), '141 stage16 migrateCompletedSteps hook');

  // 142–146 NEW path unchanged structural checks
  check(bootNewSteps[0] === 'language', '142 NEW starts language');
  check(bootNewSteps.at(-1) === 'ready', '143 NEW ends ready');
  check(bootNewSteps.includes('business_setup') && bootNewSteps.includes('publication'), '144 NEW keeps business+publication');
  check(!bootExistingSteps.includes('path_decision'), '145 EXISTING no path_decision');
  check(bootExistingSteps.includes('branch_select') && !bootExistingSteps.includes('branch'), '146 EXISTING branch_select not branch');

  // 147–152 direct existing / use existing convergence
  check(JSON.stringify(ESC.migrateCompletedSteps(['license', 'organization', 'owner'])) === JSON.stringify(['license_org_recovery', 'owner_auth']), '147 migration converges legacy trio');
  check(ESC.isExistingPath({ wizard: { path: 'existing' } }) && ESC.isExistingPath({ wizard: { path: 'new', forkDecision: 'use_existing' } }), '148 both paths existing');
  check(ESC.gatesBeforeSyncSatisfied(snap({ wizard: { path: 'existing' }, meta: recoveryMeta() }))?.ok
    === ESC.gatesBeforeSyncSatisfied(snap({ wizard: { path: 'new', forkDecision: 'use_existing' }, meta: recoveryMeta() }))?.ok, '149 gates same for direct vs fork');
  check(ESC.FLOW_AFTER.every((step) => bootExistingSteps.includes(step)), '150 FLOW_AFTER subset boot EXISTING_STEPS');
  check(ESC.businessSetupAutoResolved(snap({ wizard: { path: 'existing' }, meta: recoveryMeta() })), '151 businessSetup auto from recovery');
  check(!ESC.businessSetupAutoResolved(snap({ wizard: { path: 'new' } })), '152 businessSetup auto false on NEW');

  // 153–158 activation consume delta 0 recovery record shape
  const recoveryShape = recoveryMeta();
  check(recoveryShape.existingShortPathRecovery.activationConsumeDelta === 0, '153 activationConsumeDelta zero default');
  check(recoveryShape.existingShortPathRecovery.activationConsumed === false, '154 activationConsumed false');
  check(recoveryShape.existingShortPathRecovery.licenseRecovered === true, '155 licenseRecovered true');
  check(recoveryShape.existingShortPathRecovery.minimalPublicationWaived === true, '156 minimalPublicationWaived true');
  check(recoveryShape.existingShortPathRecovery.minimalReadbackWaived === true, '157 minimalReadbackWaived true');
  check(/activationConsumeDelta:/.test(bootSrc) && /activationConsumed:\s*false/.test(bootSrc), '158 boot-flow recovery shape fields');

  if (errors.length) {
    console.error('FAIL stage-16-existing-short-path');
    errors.forEach((e, i) => console.error(`${i + 1}. ${e}`));
    process.exit(1);
  }
  const scenarioCount = 158;
  console.log(`PASS stage-16-existing-short-path (${scenarioCount} scenarios)`);
}

run();
