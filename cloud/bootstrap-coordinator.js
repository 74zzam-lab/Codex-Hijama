/**
 * Stage 4 — Bootstrap Coordinator State (progress/UI only, not business SoT).
 * Wizard KV retains legacy fields for compatibility; authoritative gates read Services/SQLite.
 */
(function (global) {
  'use strict';

  const WIZARD_KEY = '__tdw_boot_wizard__';
  const META_KEY = '__tdw_meta__';

  const FIELD_AUTHORITY = Object.freeze({
    path: 'KEEP_TEMPORARILY',
    currentStep: 'KEEP_TEMPORARILY',
    completedSteps: 'NO_LONGER_AUTHORITATIVE',
    startedAt: 'UI_ONLY',
    lang: 'KEEP_TEMPORARILY',
    restoreChoice: 'KEEP_TEMPORARILY',
    syncDone: 'NO_LONGER_AUTHORITATIVE',
    oauthLockAt: 'UI_ONLY',
    restoreVerifiedDatabase: 'KEEP_TEMPORARILY',
    forkDecision: 'KEEP_TEMPORARILY',
    forkSelectedCandidateId: 'KEEP_TEMPORARILY',
    forkDiscoveryFingerprint: 'UI_ONLY',
    forkGoogleAccountKey: 'UI_ONLY',
    pathDecisionResolvedAt: 'UI_ONLY',
    pendingBranchId: 'KEEP_TEMPORARILY',
    lastError: 'UI_ONLY',
    lastDiagnostic: 'UI_ONLY',
    setupCompletedAt: 'DERIVED',
  });

  const NEW_STEPS = ['language', 'license', 'google', 'discovery', 'path_decision', 'organization', 'owner', 'branch', 'device', 'business_setup', 'publication', 'restore', 'sync', 'ready'];
  const EXISTING_STEPS = ['language', 'google', 'discovery', 'license_org_recovery', 'branch_select', 'device', 'restore', 'owner_auth', 'sync', 'ready'];

  function stepsFor(path) {
    return path === 'existing' ? EXISTING_STEPS : NEW_STEPS;
  }

  function safeWizardRaw() {
    try {
      const raw = global.DB?.get?.(WIZARD_KEY);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      return raw;
    } catch {
      return null;
    }
  }

  function coordinatorSnapshot() {
    const raw = safeWizardRaw() || {};
    const currentStep = Number(raw.currentStep);
    return {
      currentStep: Number.isFinite(currentStep) && currentStep >= 0 ? currentStep : 0,
      userPathChoice: raw.path || null,
      restoreChoice: raw.restoreChoice || null,
      selectedCandidateId: raw.selectedCandidateId || raw.discoveryCandidateId || raw.forkSelectedCandidateId || null,
      forkDecision: raw.forkDecision || null,
      forkSelectedCandidateId: raw.forkSelectedCandidateId || raw.selectedCandidateId || null,
      selectedBranchCandidate: raw.selectedBranchCandidate || raw.pendingBranchId || null,
      pendingRetry: raw.pendingRetry || raw.lastError || null,
      lastDiagnostic: raw.lastDiagnostic || null,
      transientProgress: {
        lang: raw.lang || null,
        startedAt: raw.startedAt || null,
        oauthLockAt: raw.oauthLockAt || null,
        restoreVerifiedDatabase: raw.restoreVerifiedDatabase === true,
      },
      legacy: {
        completedSteps: Array.isArray(raw.completedSteps) ? raw.completedSteps.slice() : [],
        syncDone: raw.syncDone === true,
      },
    };
  }

  function metaBootstrapCommitted() {
    const meta = global.DB?.get?.(META_KEY) || {};
    return !!meta.bootstrapCompletedAt;
  }

  function restoreReconcileCommitted() {
    try {
      const st = global.RestoreReconciliation?.loadState?.();
      return !!(st && (st.pullDone === true || st.reconciled === true));
    } catch {
      return false;
    }
  }

  function getDerivedGates() {
    const SS = global.SetupStateService;
    const BF = global.BootFlow;
    const readyEval = SS?.evaluateReady?.({ ignoreRestart: true }) || {};
    const checks = readyEval.checks || {};
    return {
      googleResolved: !!(BF?.hasGoogle?.() || checks.google),
      licenseResolved: !!(BF?.hasValidLicense?.() || checks.license),
      organizationResolved: !!(BF?.hasCenterData?.() || checks.center),
      ownerResolved: !!(BF?.hasOwnerPasswordAccount?.() || checks.ownerCredential),
      branchResolved: !!(BF?.hasBranch?.() || checks.branch),
      deviceResolved: !!(BF?.hasDeviceBranch?.() || checks.device),
      businessSetupResolved: !!(BF?.businessSetupStepResolved?.() || checks.businessSetup),
      dataSourceResolved: !!(BF?.hasRestoreDecision?.() || checks.dataSource),
      initialSyncResolved: !!(metaBootstrapCommitted()
        || readyEval.resolved?.includes?.('initialSync')
        || (BF?.hasSyncDone?.() && metaBootstrapCommitted())),
      ready: readyEval.ready === true,
    };
  }

  function isStepResolved(step, coord) {
    const SS = global.SetupStateService;
    const BF = global.BootFlow;
    switch (step) {
      case 'language':
        return !!(coord?.transientProgress?.lang || BF?.validateStep?.('language'));
      case 'google':
        return !!(BF?.hasGoogle?.() || SS?.hasGoogle?.());
      case 'discovery':
        return !!(BF?.hasDiscoveryResolved?.() || BF?.validateStep?.('discovery'));
      case 'path_decision':
        return !!(BF?.hasPathDecisionResolved?.() || BF?.validateStep?.('path_decision'));
      case 'license_org_recovery':
        return !!(BF?.licenseOrgRecoveryResolved?.() || BF?.validateStep?.('license_org_recovery'));
      case 'license':
        return !!(BF?.hasValidLicense?.() || SS?.hasLicense?.());
      case 'organization':
        return !!(BF?.hasCenterData?.() || SS?.hasCenter?.());
      case 'branch':
        if (coord?.userPathChoice === 'new' && BF?.newBranchRequiresOwner?.()) return false;
        return !!(BF?.branchStepResolved?.() || BF?.validateStep?.('branch'));
      case 'branch_select':
        return !!(BF?.branchStepResolved?.() || BF?.validateStep?.('branch_select'));
      case 'device':
        return !!(BF?.deviceStepResolved?.() || BF?.validateStep?.('device'));
      case 'business_setup':
        if (!BF?.deviceStepResolved?.()) return false;
        return !!(BF?.businessSetupStepResolved?.() || BF?.validateStep?.('business_setup'));
      case 'publication':
        if (!BF?.businessSetupStepResolved?.()) return false;
        return !!(BF?.publicationStepResolved?.() && BF?.readbackStepResolved?.());
      case 'owner_auth':
        return !!(BF?.ownerAuthStepResolved?.() || BF?.validateStep?.('owner_auth'));
      case 'owner':
        return !!(BF?.ownerStepResolved?.() || BF?.ownerSetupRequirementMet?.() || SS?.hasOwnerCredential?.());
      case 'restore':
        if (!BF?.deviceStepResolved?.()) return false;
        if (coord?.userPathChoice === 'new') {
          if (!BF?.businessSetupStepResolved?.()) return false;
          if (!BF?.publicationStepResolved?.()) return false;
          if (!BF?.readbackStepResolved?.()) return false;
        }
        return !!(BF?.hasRestoreDecision?.() || SS?.hasDataSource?.());
      case 'sync':
        if (!BF?.deviceStepResolved?.()) return false;
        if (coord?.userPathChoice === 'existing') {
          if (!BF?.hasRestoreDecision?.()) return false;
          return !!(BF?.hasSyncDone?.() || metaBootstrapCommitted());
        }
        if (!BF?.businessSetupStepResolved?.()) return false;
        if (!BF?.publicationStepResolved?.()) return false;
        if (!BF?.readbackStepResolved?.()) return false;
        return !!(BF?.hasSyncDone?.() || metaBootstrapCommitted());
      case 'ready':
        return !!(BF?.isBootComplete?.() || SS?.evaluateReady?.({ ignoreRestart: true })?.ready);
      default:
        return false;
    }
  }

  function deriveCompletedSteps(path) {
    if (!path) return [];
    return stepsFor(path).filter((step) => isStepResolved(step, coordinatorSnapshot()));
  }

  function resolveResumeStepIndex(path, currentStep) {
    const steps = stepsFor(path);
    if (!steps.length) return 0;
    for (let i = 0; i < steps.length; i++) {
      if (!isStepResolved(steps[i], coordinatorSnapshot())) return i;
    }
    const idx = Number(currentStep);
    return Number.isFinite(idx) ? Math.min(idx, steps.length - 1) : steps.length - 1;
  }

  function effectiveStepIndex(w) {
    const path = w?.path || coordinatorSnapshot().userPathChoice;
    if (!path) return Number.isFinite(w?.currentStep) ? w.currentStep : 0;
    const resume = resolveResumeStepIndex(path, w?.currentStep);
    const stored = Number.isFinite(w?.currentStep) ? w.currentStep : 0;
    const steps = stepsFor(path);
    if (stored >= steps.length) return resume;
    const rawWizard = safeWizardRaw();
    if (Number.isFinite(rawWizard?.reviewStepIndex)
        && stored === rawWizard.reviewStepIndex
        && stored < resume) {
      return stored;
    }
    const stepId = steps[stored];
    if (isStepResolved(stepId, w || coordinatorSnapshot())) return resume;
    if (!isStepResolved(stepId, w || coordinatorSnapshot()) && stored > resume) return resume;
    return stored;
  }

  /**
   * Pure read-only coordinator resolution — no KV/SQLite writes.
   */
  function resolveCoordinatorState(options) {
    options = options || {};
    const coord = coordinatorSnapshot();
    const derived = getDerivedGates();
    const path = coord.userPathChoice;
    return {
      coordinator: coord,
      derived,
      derivedCompletedSteps: path ? deriveCompletedSteps(path) : [],
      resumeStepIndex: path ? resolveResumeStepIndex(path, coord.currentStep) : coord.currentStep,
      effectiveStepIndex: path ? effectiveStepIndex({ path, currentStep: coord.currentStep }) : coord.currentStep,
      fieldAuthority: FIELD_AUTHORITY,
      wizardPresent: safeWizardRaw() !== null,
      at: new Date().toISOString(),
    };
  }

  function getFieldInventory() {
    return Object.entries(FIELD_AUTHORITY).map(([field, classification]) => ({
      field,
      storage: WIZARD_KEY,
      classification,
      authoritative: classification === 'KEEP_TEMPORARILY' && ['path', 'currentStep', 'restoreChoice', 'lang'].includes(field),
    }));
  }

  global.BootstrapCoordinator = {
    WIZARD_KEY,
    META_KEY,
    FIELD_AUTHORITY,
    coordinatorSnapshot,
    getDerivedGates,
    deriveCompletedSteps,
    resolveResumeStepIndex,
    effectiveStepIndex,
    resolveCoordinatorState,
    getFieldInventory,
    isStepResolved,
    metaBootstrapCommitted,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.BootstrapCoordinator;
  }
})(typeof window !== 'undefined' ? window : globalThis);
