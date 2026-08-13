/**
 * Stage 5 — Bootstrap gate registry (read-only predicates, no runtime reorder).
 * Maps target state-machine gates to current Sources of Truth.
 */
(function (global) {
  'use strict';

  const PATH_NEW = 'new';
  const PATH_EXISTING = 'existing';

  const CURRENT_NEW_RUNTIME = Object.freeze([
    'language', 'license', 'google', 'discovery', 'path_decision', 'organization', 'owner', 'branch', 'device', 'restore', 'sync', 'ready',
  ]);
  const CURRENT_EXISTING_RUNTIME = Object.freeze([
    'language', 'google', 'discovery', 'license', 'organization', 'branch_select', 'device', 'restore', 'owner', 'sync', 'ready',
  ]);

  const TARGET_NEW_GATES = Object.freeze([
    'ACTIVATION_RESOLVED',
    'GOOGLE_CONNECTED',
    'DISCOVERY_RESOLVED',
    'PATH_DECISION_RESOLVED',
    'ORGANIZATION_RESOLVED',
    'OWNER_RESOLVED',
    'BRANCH_RESOLVED',
    'DEVICE_RESOLVED',
    'BUSINESS_SETUP_RESOLVED',
    'RESTORE_DECISION_RESOLVED',
    'PUBLICATION_RESOLVED',
    'READBACK_VERIFIED',
    'INITIAL_SYNC_RESOLVED',
    'READY',
  ]);

  const TARGET_EXISTING_GATES = Object.freeze([
    'GOOGLE_CONNECTED',
    'DISCOVERY_RESOLVED',
    'LICENSE_ORG_RECOVERY_RESOLVED',
    'BRANCH_RESOLVED',
    'DEVICE_RESOLVED',
    'RESTORE_DECISION_RESOLVED',
    'INITIAL_SYNC_RESOLVED',
    'READY',
  ]);

  const GATE_STATUS = Object.freeze({
    RESOLVED: 'resolved',
    MISSING: 'missing',
    BLOCKED: 'blocked',
    INVALID: 'invalid',
    UNKNOWN: 'unknown',
    NOT_APPLICABLE: 'not_applicable',
  });

  function BF() { return global.BootFlow; }
  function SS() { return global.SetupStateService; }
  function BC() { return global.BootstrapCoordinator; }
  function RPE() { return global.ReadyPureEvaluator; }

  function meta() {
    try { return global.DB?.get?.('__tdw_meta__') || {}; } catch { return {}; }
  }

  function wizardRaw() {
    try { return global.DB?.get?.('__tdw_boot_wizard__') || null; } catch { return null; }
  }

  function licenseLocal() {
    try { return global.LicenseCloud?.loadLocal?.() || null; } catch { return null; }
  }

  function deviceConfig() {
    try { return global.DeviceConfig?.load?.() || null; } catch { return null; }
  }

  function gateResult(id, status, reason, source, extra) {
    return Object.assign({ id, status, reason: reason || '', source: source || 'unknown' }, extra || {});
  }

  function evaluateActivationResolved() {
    const BFm = BF();
    const SSm = SS();
    if (BFm?.hasValidLicense?.()) {
      return gateResult('ACTIVATION_RESOLVED', GATE_STATUS.RESOLVED, 'valid license committed', 'BootFlow.hasValidLicense');
    }
    if (SSm?.hasLicense?.()) {
      return gateResult('ACTIVATION_RESOLVED', GATE_STATUS.RESOLVED, 'license gate via SetupStateService', 'SetupStateService.hasLicense');
    }
    const lic = licenseLocal();
    if (lic?.centerId && global.LicenseActivationGate?.isConsumed?.(lic)) {
      return gateResult('ACTIVATION_RESOLVED', GATE_STATUS.RESOLVED, 'activation consumed in license doc', 'LicenseActivationGate.isConsumed');
    }
    return gateResult('ACTIVATION_RESOLVED', GATE_STATUS.MISSING, 'no consumed activation', 'LicenseCloud+LicenseActivationGate');
  }

  function evaluateGoogleConnected() {
    const BFm = BF();
    const SSm = SS();
    const connected = !!(BFm?.hasGoogle?.() || SSm?.hasGoogle?.());
    const w = wizardRaw();
    const staleFlag = Array.isArray(w?.completedSteps) && w.completedSteps.includes('google');
    if (connected) {
      return gateResult('GOOGLE_CONNECTED', GATE_STATUS.RESOLVED, 'Drive/settings connected', 'BootFlow.hasGoogle');
    }
    if (staleFlag) {
      return gateResult('GOOGLE_CONNECTED', GATE_STATUS.MISSING, 'wizard google flag stale — not authoritative', 'wizard.completedSteps (ignored)');
    }
    return gateResult('GOOGLE_CONNECTED', GATE_STATUS.MISSING, 'google not connected', 'BootFlow.hasGoogle');
  }

  function evaluatePathDecisionResolved(path) {
    const BFm = BF();
    if (path === PATH_EXISTING) {
      return gateResult('PATH_DECISION_RESOLVED', GATE_STATUS.NOT_APPLICABLE, 'direct EXISTING path — no NEW fork', 'wizard.path');
    }
    if (BFm?.hasPathDecisionResolved?.()) {
      return gateResult('PATH_DECISION_RESOLVED', GATE_STATUS.RESOLVED, 'explicit fork decision or no fork required', 'BootFlow.hasPathDecisionResolved');
    }
    if (BFm?.needsPathForkDecision?.()) {
      return gateResult('PATH_DECISION_RESOLVED', GATE_STATUS.MISSING, 'existing business found — awaiting explicit fork', 'PostGoogleCloudDiscovery.requiresPathFork');
    }
    return gateResult('PATH_DECISION_RESOLVED', GATE_STATUS.RESOLVED, 'no fork required', 'discovery classification');
  }

  function evaluateDiscoveryResolved(path) {
    const BFm = BF();
    if (BFm?.hasDiscoveryResolved?.()) {
      return gateResult('DISCOVERY_RESOLVED', GATE_STATUS.RESOLVED, 'explicit discovery gate completed', 'PostGoogleCloudDiscovery.hasDiscoveryResolved');
    }
    const w = wizardRaw() || {};
    if (w.discoveryCompletedAt && w.cloudDiscovery?.result) {
      return gateResult('DISCOVERY_RESOLVED', GATE_STATUS.RESOLVED, 'cached discovery result present', '__tdw_boot_wizard__.cloudDiscovery');
    }
    if (BFm?.hasGoogle?.()) {
      return gateResult('DISCOVERY_RESOLVED', GATE_STATUS.MISSING, 'google connected — discovery gate pending', 'PostGoogleCloudDiscovery');
    }
    return gateResult('DISCOVERY_RESOLVED', GATE_STATUS.MISSING, 'google required before discovery', 'SETUP_CONNECTIVITY_POLICY');
  }

  function evaluateOrganizationResolved() {
    const BFm = BF();
    const SSm = SS();
    if (BFm?.hasCenterData?.() || SSm?.hasCenter?.()) {
      const lic = licenseLocal();
      const centerId = lic?.centerId || global.CenterId?.getStoredCenterId?.();
      const same = !centerId || !lic?.organizationId || String(centerId) === String(lic.organizationId || lic.centerId);
      return gateResult('ORGANIZATION_RESOLVED', GATE_STATUS.RESOLVED,
        same ? 'centerId+centerName present' : 'centerId present (organizationId alias)',
        'BootFlow.hasCenterData', { centerIdEqualsOrgId: same });
    }
    return gateResult('ORGANIZATION_RESOLVED', GATE_STATUS.MISSING, 'center id/name missing', 'BootFlow.hasCenterData');
  }

  function evaluateLicenseOrgRecoveryResolved() {
    const org = evaluateOrganizationResolved();
    const lic = evaluateActivationResolved();
    if (org.status === GATE_STATUS.RESOLVED && lic.status === GATE_STATUS.RESOLVED) {
      return gateResult('LICENSE_ORG_RECOVERY_RESOLVED', GATE_STATUS.RESOLVED, 'license and organization recovered', 'hasCenterData+hasValidLicense');
    }
    if (lic.status === GATE_STATUS.RESOLVED && org.status !== GATE_STATUS.RESOLVED) {
      return gateResult('LICENSE_ORG_RECOVERY_RESOLVED', GATE_STATUS.MISSING, 'license without organization metadata', 'license without center');
    }
    return gateResult('LICENSE_ORG_RECOVERY_RESOLVED', GATE_STATUS.MISSING, 'remote license/org not recovered', 'LicenseCloud');
  }

  function evaluateOwnerResolved() {
    const BFm = BF();
    const SSm = SS();
    const credential = !!(BFm?.hasOwnerPasswordAccount?.() || BFm?.ownerSetupRequirementMet?.() || SSm?.hasOwnerCredential?.());
    if (!credential) {
      return gateResult('OWNER_RESOLVED', GATE_STATUS.MISSING, 'no usable owner credential', 'OwnerManagement.getOwnerState');
    }
    const sessionReady = BFm?.setupOwnerSessionReady?.() === true;
    return gateResult('OWNER_RESOLVED', GATE_STATUS.RESOLVED, sessionReady ? 'owner credential + session' : 'owner credential (session required for sync action only)',
      'OwnerManagement', { sessionReady, seedExcluded: true });
  }

  function evaluateBranchResolved() {
    const BFm = BF();
    const SSm = SS();
    if (BFm?.hasBranch?.() || SSm?.hasBranch?.()) {
      return gateResult('BRANCH_RESOLVED', GATE_STATUS.RESOLVED, 'active branch in license or locked', 'BootFlow.hasBranch');
    }
    return gateResult('BRANCH_RESOLVED', GATE_STATUS.MISSING, 'no branch', 'LicenseCloud.branches');
  }

  function evaluateDeviceResolved() {
    const BFm = BF();
    const SSm = SS();
    if (BFm?.hasDeviceBranch?.() || SSm?.hasDevice?.()) {
      return gateResult('DEVICE_RESOLVED', GATE_STATUS.RESOLVED, 'device bound to branch', 'DeviceConfig+BootFlow.hasDeviceBranch');
    }
    return gateResult('DEVICE_RESOLVED', GATE_STATUS.MISSING, 'device not registered', 'DeviceConfig');
  }

  function evaluateBusinessSetupResolved() {
    const org = evaluateOrganizationResolved();
    const branch = evaluateBranchResolved();
    const settings = global.settings || {};
    const hasName = !!(String(settings.centerName || '').trim() || licenseLocal()?.centerName);
    if (org.status === GATE_STATUS.RESOLVED && branch.status === GATE_STATUS.RESOLVED && hasName) {
      return gateResult('BUSINESS_SETUP_RESOLVED', GATE_STATUS.RESOLVED, 'center name + branch committed', 'settings+license');
    }
    return gateResult('BUSINESS_SETUP_RESOLVED', GATE_STATUS.MISSING, 'center/branch business metadata incomplete', 'settings.centerName');
  }

  function evaluateRestoreDecisionResolved() {
    const BFm = BF();
    const SSm = SS();
    const choiceMade = !!(BFm?.hasRestoreDecision?.() || SSm?.hasDataSource?.());
    const w = wizardRaw() || {};
    const choice = w.restoreChoice || null;
    const completed = !!(BC()?.metaBootstrapCommitted?.() || meta().bootstrapCompletedAt);
    return gateResult('RESTORE_DECISION_RESOLVED',
      choiceMade ? GATE_STATUS.RESOLVED : GATE_STATUS.MISSING,
      choiceMade ? `restore choice: ${choice || 'meta/reconcile'}` : 'no restore choice',
      'BootFlow.hasRestoreDecision',
      { restoreChoice: choice, restoreCompleted: completed, choiceIsNotCompletion: choiceMade && !completed });
  }

  function evaluatePublicationResolved() {
    const m = meta();
    if (m.setupActivationCommittedAt || m.setupOrganizationDeviceCommittedAt) {
      return gateResult('PUBLICATION_RESOLVED', GATE_STATUS.RESOLVED, 'setup commits recorded in meta', '__tdw_meta__');
    }
    const lic = licenseLocal();
    if (lic?.centerId && global.LicenseActivationGate?.isConsumed?.(lic)) {
      return gateResult('PUBLICATION_RESOLVED', GATE_STATUS.RESOLVED, 'activation consumed (local commit)', 'LicenseActivationGate');
    }
    return gateResult('PUBLICATION_RESOLVED', GATE_STATUS.MISSING, 'no setup publication markers', '__tdw_meta__');
  }

  function evaluateReadbackVerified() {
    const m = meta();
    const lic = licenseLocal();
    const cfg = deviceConfig();
    const parts = [];
    if (lic?.centerId) parts.push('license');
    if (cfg?.lockedBranchId) parts.push('device');
    if (m.setupOrganizationDeviceCommittedAt) parts.push('org_device_commit');
    if (parts.length >= 2) {
      return gateResult('READBACK_VERIFIED', GATE_STATUS.RESOLVED, `hydrated: ${parts.join(',')}`, 'SqliteBridge.hydrateIntoMemory (post-commit)');
    }
    if (lic?.centerId) {
      return gateResult('READBACK_VERIFIED', GATE_STATUS.MISSING, 'license only — branch/device read-back pending', 'partial');
    }
    return gateResult('READBACK_VERIFIED', GATE_STATUS.MISSING, 'no post-commit read-back evidence', 'meta+DeviceConfig');
  }

  function evaluateInitialSyncResolved() {
    const BFm = BF();
    const SSm = SS();
    if (BFm?.hasSyncDone?.() || SSm?.hasSyncDone?.() || BC()?.metaBootstrapCommitted?.()) {
      return gateResult('INITIAL_SYNC_RESOLVED', GATE_STATUS.RESOLVED, 'bootstrapCompletedAt or sync ready', 'meta.bootstrapCompletedAt');
    }
    return gateResult('INITIAL_SYNC_RESOLVED', GATE_STATUS.MISSING, 'initial sync not complete', 'meta.bootstrapCompletedAt');
  }

  function evaluateReadyGate() {
    const ready = SS()?.evaluateReady?.({ ignoreRestart: true }) || {};
    if (ready.ready === true) {
      return gateResult('READY', GATE_STATUS.RESOLVED, 'Stage 2 pure evaluator', 'SetupStateService.evaluateReady');
    }
    return gateResult('READY', GATE_STATUS.MISSING, ready.state || 'not ready', 'ReadyPureEvaluator', { missing: ready.missing || [] });
  }

  const EVALUATORS = Object.freeze({
    ACTIVATION_RESOLVED: () => evaluateActivationResolved(),
    GOOGLE_CONNECTED: () => evaluateGoogleConnected(),
    DISCOVERY_RESOLVED: (path) => evaluateDiscoveryResolved(path),
    PATH_DECISION_RESOLVED: (path) => evaluatePathDecisionResolved(path),
    ORGANIZATION_RESOLVED: () => evaluateOrganizationResolved(),
    LICENSE_ORG_RECOVERY_RESOLVED: () => evaluateLicenseOrgRecoveryResolved(),
    OWNER_RESOLVED: () => evaluateOwnerResolved(),
    BRANCH_RESOLVED: () => evaluateBranchResolved(),
    DEVICE_RESOLVED: () => evaluateDeviceResolved(),
    BUSINESS_SETUP_RESOLVED: () => evaluateBusinessSetupResolved(),
    RESTORE_DECISION_RESOLVED: () => evaluateRestoreDecisionResolved(),
    PUBLICATION_RESOLVED: () => evaluatePublicationResolved(),
    READBACK_VERIFIED: () => evaluateReadbackVerified(),
    INITIAL_SYNC_RESOLVED: () => evaluateInitialSyncResolved(),
    READY: () => evaluateReadyGate(),
  });

  function targetGatesFor(path) {
    return path === PATH_EXISTING ? TARGET_EXISTING_GATES : TARGET_NEW_GATES;
  }

  function evaluateGate(gateId, path) {
    const fn = EVALUATORS[gateId];
    if (!fn) return gateResult(gateId, GATE_STATUS.UNKNOWN, 'unknown gate', 'registry');
    if (gateId === 'ACTIVATION_RESOLVED' && path === PATH_EXISTING) {
      return gateResult(gateId, GATE_STATUS.NOT_APPLICABLE, 'existing path recovers license — no new activation', 'target model');
    }
    return fn(path);
  }

  function evaluateAllGates(path) {
    const gates = targetGatesFor(path);
    return gates.map((id) => evaluateGate(id, path));
  }

  function firstUnresolvedTargetGate(path) {
    const gates = targetGatesFor(path);
    for (const id of gates) {
      const r = evaluateGate(id, path);
      if (r.status === GATE_STATUS.NOT_APPLICABLE) continue;
      if (r.status !== GATE_STATUS.RESOLVED) return r;
    }
    return null;
  }

  function getCurrentRuntimeSteps(path) {
    const BFm = BF();
    if (BFm?.getStepCatalog || BFm?.getStepManifest) {
      const m = (BFm.getStepCatalog || BFm.getStepManifest)();
      return path === PATH_EXISTING ? m.EXISTING_STEPS.slice() : m.NEW_STEPS.slice();
    }
    return path === PATH_EXISTING ? CURRENT_EXISTING_RUNTIME.slice() : CURRENT_NEW_RUNTIME.slice();
  }

  function runtimeOrderingUnchanged() {
    const BFm = BF();
    const manifest = (BFm?.getStepCatalog || BFm?.getStepManifest)?.() || {};
    const nw = manifest.NEW_STEPS || CURRENT_NEW_RUNTIME;
    const ex = manifest.EXISTING_STEPS || CURRENT_EXISTING_RUNTIME;
    const sameNew = JSON.stringify(nw) === JSON.stringify(CURRENT_NEW_RUNTIME);
    const sameEx = JSON.stringify(ex) === JSON.stringify(CURRENT_EXISTING_RUNTIME);
    return { unchanged: sameNew && sameEx, NEW_STEPS: nw, EXISTING_STEPS: ex, baseline: { NEW: CURRENT_NEW_RUNTIME, EXISTING: CURRENT_EXISTING_RUNTIME } };
  }

  function getStepInventory() {
    return [
      { stepId: 'language', displayName: 'اللغة', path: 'BOTH', currentPositionNew: 0, currentPositionExisting: 0, uiRenderer: 'renderStepUI:language', entry: 'lang button', completionChecker: 'validateStep: loadWizard().lang', sourceOfTruth: '__tdw_boot_wizard__.lang', writes: ['wizard.lang', 'localStorage LANG_KEY'], cloudEffect: false, sqliteEffect: true, canRetry: true, canResume: true, canSkip: false, dependsOn: [], produces: ['lang'] },
      { stepId: 'license', displayName: 'التفعيل والترخيص', path: 'BOTH', currentPositionNew: 1, currentPositionExisting: 3, uiRenderer: 'renderStepUI:license', entry: 'activateLicenseKey', completionChecker: 'hasValidLicense()', sourceOfTruth: '__tdw_cloud_license__+LicenseActivationGate', writes: ['setupCommitSignedActivation', 'activation state'], cloudEffect: true, sqliteEffect: true, canRetry: true, canResume: true, canSkip: false, dependsOn: ['language (NEW)', 'discovery (EXISTING)'], produces: ['consumed activation'] },
      { stepId: 'google', displayName: 'ربط Google', path: 'BOTH', currentPositionNew: 2, currentPositionExisting: 1, uiRenderer: 'renderStepUI:google', entry: 'runGoogleConnect', completionChecker: 'hasGoogle()', sourceOfTruth: 'DriveAdapter+settings.backup.providers.google', writes: ['settings oauth only'], cloudEffect: true, sqliteEffect: false, canRetry: true, canResume: true, canSkip: false, dependsOn: ['license (NEW)', 'language (EXISTING)'], produces: ['google session'] },
      { stepId: 'discovery', displayName: 'اكتشاف السحابة', path: 'BOTH', currentPositionNew: 3, currentPositionExisting: 2, uiRenderer: 'renderStepUI:discovery', entry: 'runDiscoveryGate', completionChecker: 'hasDiscoveryResolved()', sourceOfTruth: 'PostGoogleCloudDiscovery cache', writes: ['wizard.cloudDiscovery transient only'], cloudEffect: true, sqliteEffect: false, canRetry: true, canResume: true, canSkip: false, dependsOn: ['google'], produces: ['discovery candidates'] },
      { stepId: 'path_decision', displayName: 'اختيار المسار', path: 'NEW', currentPositionNew: 4, uiRenderer: 'renderStepUI:path_decision', entry: 'commitForkUseExisting / commitForkStartNew', completionChecker: 'hasPathDecisionResolved()', sourceOfTruth: 'wizard.forkDecision + discovery classification', writes: ['wizard.forkDecision', 'wizard.forkSelectedCandidateId', 'wizard.path on use_existing'], cloudEffect: false, sqliteEffect: false, canRetry: true, canResume: true, canSkip: false, dependsOn: ['discovery'], produces: ['path choice'] },
      { stepId: 'organization', displayName: 'المؤسسة', path: 'BOTH', currentPositionNew: 5, currentPositionExisting: 4, uiRenderer: 'renderStepUI:organization', entry: 'commitSetupOrganizationDevice({centerName})', completionChecker: 'hasCenterData()', sourceOfTruth: 'centerId+centerName license/settings', writes: ['meta setupOrganizationDeviceCommittedAt', 'settings'], cloudEffect: false, sqliteEffect: true, canRetry: true, canResume: true, canSkip: false, dependsOn: ['discovery', 'license', 'path_decision (NEW)'], produces: ['organization metadata'] },
      { stepId: 'owner', displayName: 'حساب المالك', path: 'BOTH', currentPositionNew: 6, currentPositionExisting: 7, uiRenderer: 'renderStepUI:owner', entry: 'createOwnerFromWizard / authenticateExistingOwnerFromWizard', completionChecker: 'ownerStepResolved / ownerSetupRequirementMet', sourceOfTruth: 'OwnerManagement+users+RBAC session', writes: ['users owner profile'], cloudEffect: false, sqliteEffect: true, canRetry: true, canResume: true, canSkip: false, dependsOn: ['organization'], produces: ['owner credential', 'setup session'] },
      { stepId: 'branch', displayName: 'إنشاء أول فرع', path: 'NEW', currentPositionNew: 8, uiRenderer: 'renderStepUI:branch', entry: 'createFirstBranchFromForm', completionChecker: 'branchStepResolved()', sourceOfTruth: 'license.branches', writes: ['license branches', 'setupBranchCommittedAt'], cloudEffect: true, sqliteEffect: true, canRetry: true, canResume: true, canSkip: false, dependsOn: ['owner'], produces: ['branch'] },
      { stepId: 'device', displayName: 'تسجيل الجهاز', path: 'BOTH', currentPositionNew: 9, currentPositionExisting: 6, uiRenderer: 'renderStepUI:device', entry: 'registerDeviceFromForm', completionChecker: 'deviceStepResolved()', sourceOfTruth: 'DeviceConfig+device registry', writes: ['device config', 'device registry', 'RESTART_REQUIRED'], cloudEffect: false, sqliteEffect: true, canRetry: true, canResume: true, canSkip: false, dependsOn: ['branch'], produces: ['device registration'] },
      { stepId: 'branch_select', displayName: 'اختيار فرع موجود', path: 'EXISTING', currentPositionExisting: 5, uiRenderer: 'renderStepUI:branch_select', entry: 'selectExistingBranchOnly', completionChecker: 'branchStepResolved()', sourceOfTruth: 'license.branches+wizard.pendingBranchId', writes: ['pendingBranchId'], cloudEffect: false, sqliteEffect: false, canRetry: true, canResume: true, canSkip: false, dependsOn: ['organization'], produces: ['branch selection'] },
      { stepId: 'restore', displayName: 'مصدر البيانات', path: 'BOTH', currentPositionNew: 10, currentPositionExisting: 7, uiRenderer: 'renderStepUI:restore', entry: 'runDiscovery / restore actions', completionChecker: 'hasRestoreDecision() after device', sourceOfTruth: 'wizard.restoreChoice+RestoreReconciliation', writes: ['restoreChoice', 'optional full DB replace'], cloudEffect: true, sqliteEffect: true, canRetry: true, canResume: true, canSkip: false, dependsOn: ['device'], produces: ['data source decision'] },
      { stepId: 'owner', displayName: 'حساب المالك', path: 'EXISTING', currentPositionExisting: 7, uiRenderer: 'renderStepUI:owner', entry: 'authenticateExistingOwnerFromWizard', completionChecker: 'ownerSetupRequirementMet&&setupOwnerSessionReady', sourceOfTruth: 'OwnerManagement+users', writes: ['users owner profile'], cloudEffect: false, sqliteEffect: true, canRetry: true, canResume: true, canSkip: false, dependsOn: ['restore decision', 'branch/device'], produces: ['owner credential', 'setup session'] },
      { stepId: 'sync', displayName: 'المزامنة الأولية', path: 'BOTH', currentPositionNew: 9, currentPositionExisting: 8, uiRenderer: 'renderStepUI:sync', entry: 'runInitialSyncPipeline', completionChecker: 'hasSyncDone()', sourceOfTruth: 'meta.bootstrapCompletedAt', writes: ['bootstrapCompletedAt', 'SyncEngine'], cloudEffect: true, sqliteEffect: true, canRetry: true, canResume: true, canSkip: false, dependsOn: ['owner session', 'restoreChoice', 'google'], produces: ['initial sync complete'] },
      { stepId: 'ready', displayName: 'الجاهزية', path: 'BOTH', currentPositionNew: 10, currentPositionExisting: 9, uiRenderer: 'renderStepUI:ready', entry: 'finalize + relaunch', completionChecker: 'isBootComplete/evaluateReady', sourceOfTruth: 'ReadyPureEvaluator', writes: ['setupCompletedAt', 'BOOT_DONE_KEY'], cloudEffect: false, sqliteEffect: true, canRetry: true, canResume: true, canSkip: false, dependsOn: ['all gates'], produces: ['READY durable'] },
    ];
  }

  function getCapabilityMatrix() {
    const caps = ['activation', 'google', 'discovery', 'organization', 'owner', 'branch', 'device', 'business setup', 'restore', 'publication', 'read-back', 'initial sync', 'READY', 'login'];
    return caps.map((cap) => {
      const row = { capability: cap };
      if (cap === 'activation') {
        row.currentNew = 1; row.targetNew = 0; row.currentExisting = 2; row.targetExisting = 'recovery'; row.changeRequired = 'Stage 6 complete (NEW)';
      } else if (cap === 'google') {
        row.currentNew = 2; row.targetNew = 1; row.currentExisting = 1; row.targetExisting = 0; row.changeRequired = 'Stage 6 complete (NEW)';
      } else if (cap === 'discovery') {
        row.currentNew = 3; row.targetNew = 2; row.currentExisting = 2; row.targetExisting = 1; row.changeRequired = 'Stage 7 complete';
      } else if (cap === 'owner') {
        row.currentNew = 6; row.targetNew = 4; row.currentExisting = 6; row.targetExisting = 'recover'; row.changeRequired = 'Stage 9 before branch (NEW)';
      } else if (cap === 'branch') {
        row.currentNew = 7; row.targetNew = 7; row.currentExisting = 5; row.targetExisting = 5; row.changeRequired = 'Stage 11: branch only';
      } else if (cap === 'device') {
        row.currentNew = 8; row.targetNew = 8; row.currentExisting = 6; row.targetExisting = 6; row.changeRequired = 'Stage 11 explicit device step';
      } else if (cap === 'login') {
        row.currentNew = 'post-READY startup'; row.targetNew = 'post-READY'; row.currentExisting = 'post-READY'; row.targetExisting = 'post-READY'; row.changeRequired = 'none (Stage 3)';
      } else {
        row.currentNew = CURRENT_NEW_RUNTIME.indexOf(cap === 'organization' ? 'organization' : cap === 'initial sync' ? 'sync' : cap === 'read-back' ? 'sync' : cap === 'business setup' ? 'organization' : cap === 'restore' ? 'restore' : cap === 'publication' ? 'sync' : cap === 'READY' ? 'ready' : cap);
        row.targetNew = TARGET_NEW_GATES.indexOf(cap.toUpperCase().replace(/ /g, '_') + (cap === 'restore' ? '_DECISION_RESOLVED' : cap === 'initial sync' ? '_RESOLVED' : cap === 'read-back' ? '_VERIFIED' : cap === 'business setup' ? '_RESOLVED' : cap === 'READY' ? '' : '_RESOLVED'));
        row.currentExisting = CURRENT_EXISTING_RUNTIME.indexOf(cap === 'branch' ? 'branch_select' : cap === 'organization' ? 'organization' : cap === 'initial sync' ? 'sync' : cap === 'restore' ? 'restore' : cap === 'READY' ? 'ready' : cap);
        row.targetExisting = TARGET_EXISTING_GATES.findIndex((g) => g.includes(cap.toUpperCase().split(' ')[0]));
        row.changeRequired = row.currentNew !== row.targetNew ? 'future stage' : 'aligned or N/A';
      }
      return row;
    });
  }

  function getDependencyGraph() {
    return {
      hard: [
        { from: 'language', to: 'license', reason: 'Stage 6 NEW: activation before Google' },
        { from: 'license', to: 'google', reason: 'NEW: Google OAuth after authoritative activation' },
        { from: 'google', to: 'organization', reason: 'initialSetupRequiresGoogle satisfied (EXISTING: google before license)' },
        { from: 'organization', to: 'branch', reason: 'setupCommitOrganizationDevice' },
        { from: 'branch', to: 'restore', reason: 'device lockedBranchId for sync targets' },
        { from: 'restore', to: 'owner', reason: 'restore may hydrate owner; sync requires owner session' },
        { from: 'owner', to: 'sync', reason: 'verifySetupOwnerSession in runInitialSyncPipeline' },
        { from: 'sync', to: 'ready', reason: 'bootstrapCompletedAt before finalize' },
      ],
      soft: [
        { from: 'owner', to: 'branch', reason: 'target: owner should authorize branch creation' },
        { from: 'activation', to: 'google', reason: 'target NEW: activation before Google' },
      ],
      accidental: [
        { from: 'google', to: 'license', reason: 'pre-Stage-6 NEW order (legacy wizardFlowVersion < 6)' },
        { from: 'branch', to: 'owner', reason: 'current runtime places branch before owner (legacy)' },
        { from: 'bootstrapCompletedAt', to: 'restore', reason: 'meta marker satisfies hasRestoreDecision retroactively' },
      ],
    };
  }

  function getCircularDependencies() {
    return [
      {
        id: 'centerId_discovery',
        cycle: 'Need centerId for cloud discovery ↔ Need discovery to recover centerId',
        currentMitigation: 'Google OAuth first; manual key path; Drive license pull',
        riskOnReorder: 'medium',
      },
      {
        id: 'branch_owner',
        cycle: 'Branch step creates device before owner credential ↔ Target wants owner before branch',
        currentMitigation: 'Owner seed not used for gate; branch uses license not owner RBAC',
        riskOnReorder: 'high for Stage 9',
      },
      {
        id: 'restore_owner',
        cycle: 'Restore may import owner ↔ Owner step after restore for session',
        currentMitigation: 'Owner step handles both create and authenticate',
        riskOnReorder: 'low',
      },
    ];
  }

  function getStage6Plan() {
    return {
      status: 'IMPLEMENTED_STAGE_6',
      goal: 'NEW: Activation before Google — completed in Stage 6',
      nextStage: 'Stage 7 — Explicit Discovery gate after Google',
    };
  }

  function getOriginalVsCurrent() {
    return [
      {
        topic: 'Google vs Activation order',
        originalBehavior: 'v2-5.9 NEW_STEPS: google(1) → license(2) — unchanged since v2-5.8',
        currentBehavior: 'Same runtime order; Stage 4 adds owner step at index 6',
        reasonForDifference: 'SETUP_CONNECTIVITY_POLICY.initialSetupRequiresGoogle; Drive license discovery requires OAuth',
        matchesProductTarget: 'Target NEW wants activation first — neither original nor current',
        riskOfChanging: 'high without discovery deferral + resume migration',
      },
      {
        topic: 'Owner vs Branch order',
        originalBehavior: 'v2-5.9: branch(4) → restore(5) → sync(6) — no owner step in customer journey',
        currentBehavior: 'branch(4) → restore(5) → owner(6) → sync(7)',
        reasonForDifference: 'Stage 4 re-inserted owner; branch still before owner for device registration + restore hydrate',
        matchesProductTarget: 'Target wants owner before branch',
        riskOfChanging: 'medium — device registration embedded in branch step',
      },
      {
        topic: 'Device step',
        originalBehavior: 'Device registration inside branch step via setupCommitOrganizationDevice',
        currentBehavior: 'Unchanged',
        reasonForDifference: 'Historical single-step branch+device commit',
        matchesProductTarget: 'Target wants explicit device step (Stage 11)',
        riskOfChanging: 'low for UI-only split; medium for service extraction',
      },
    ];
  }

  function getGateSourceOfTruth() {
    return Object.keys(EVALUATORS).map((id) => ({
      gateId: id,
      readOnly: true,
      evaluator: `BootstrapGates.evaluateGate('${id}')`,
      writesOnEvaluate: false,
    }));
  }

  function getReorderRiskMatrix() {
    return {
      owner: { duplicateRisk: 'createOwnerFromWizard retries', locations: ['boot-flow-ui.js createOwnerFromWizard'], mitigation: 'ensureOwner idempotent contract (Stage 10)' },
      branch: { duplicateRisk: 'createFirstBranchFromForm double-submit', locations: ['commitSetupOrganizationDevice'], mitigation: 'ensureFirstBranch idempotent' },
      device: { duplicateRisk: 'bindExistingBranch retry', locations: ['setupCommitOrganizationDevice'], mitigation: 'registry upsert by deviceUuid' },
      organization: { duplicateRisk: 'low — centerId from license', locations: ['organization step commit'], mitigation: 'centerId immutable from license' },
    };
  }

  function getBackwardCompatibility() {
    return {
      oldWizardKv: 'currentStep indices will shift on reorder — migrate via gate-derived resume (Stage 4 coordinator)',
      readyProfile: 'READY devices skip bootstrap — unaffected',
      existingBranch: 'branch_select path preserved in EXISTING_STEPS',
      existingOwner: 'owner credential survives — no re-create on reorder',
      oldSetupState: 'completedSteps/syncDone non-authoritative since Stage 4',
      migrationStrategy: 'evaluate SoT gates → first unresolved; do not delete wizard KV',
    };
  }

  function getIdempotencyContracts() {
    return {
      ensureOwner: 'OwnerManagement.getOwnerState === OWNER_EXISTS → skip create; authenticate only',
      ensureFirstBranch: 'hasBranch() → bind device only; else create once via IPC commit',
      ensureDevice: 'hasDeviceBranch() → no-op; else register via setupCommitOrganizationDevice',
    };
  }

  function getTransitionTable(path) {
    const gates = targetGatesFor(path);
    const rows = [];
    for (let i = 0; i < gates.length - 1; i++) {
      rows.push({
        currentGate: gates[i],
        condition: `${gates[i]} status === resolved`,
        nextGate: gates[i + 1],
      });
    }
    rows.push({ currentGate: gates[gates.length - 1], condition: 'all prior resolved', nextGate: 'LOGIN (Stage 3 startup)' });
    return rows;
  }

  function getErrorTransitions() {
    return {
      ACTIVATION_RESOLVED: 'RETRYABLE',
      GOOGLE_CONNECTED: 'RETRYABLE',
      DISCOVERY_RESOLVED: 'RETRYABLE',
      ORGANIZATION_RESOLVED: 'USER_ACTION_REQUIRED',
      OWNER_RESOLVED: 'USER_ACTION_REQUIRED',
      BRANCH_RESOLVED: 'USER_ACTION_REQUIRED',
      DEVICE_RESOLVED: 'USER_ACTION_REQUIRED',
      RESTORE_DECISION_RESOLVED: 'USER_ACTION_REQUIRED',
      INITIAL_SYNC_RESOLVED: 'RETRYABLE',
      READY: 'FATAL if blocked by restart',
    };
  }

  function diagnoseAll(path) {
    return {
      path,
      runtimeSteps: getCurrentRuntimeSteps(path),
      targetGates: targetGatesFor(path),
      gates: evaluateAllGates(path),
      firstUnresolved: firstUnresolvedTargetGate(path),
      runtimeOrdering: runtimeOrderingUnchanged(),
      at: new Date().toISOString(),
    };
  }

  global.BootstrapGates = {
    PATH_NEW,
    PATH_EXISTING,
    CURRENT_NEW_RUNTIME,
    CURRENT_EXISTING_RUNTIME,
    TARGET_NEW_GATES,
    TARGET_EXISTING_GATES,
    GATE_STATUS,
    evaluateGate,
    evaluateAllGates,
    firstUnresolvedTargetGate,
    getCurrentRuntimeSteps,
    runtimeOrderingUnchanged,
    getStepInventory,
    getCapabilityMatrix,
    getDependencyGraph,
    getCircularDependencies,
    getStage6Plan,
    getOriginalVsCurrent,
    getGateSourceOfTruth,
    getReorderRiskMatrix,
    getBackwardCompatibility,
    getIdempotencyContracts,
    getTransitionTable,
    getErrorTransitions,
    diagnoseAll,
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.BootstrapGates;
}
