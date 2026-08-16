/**
 * Stage 19 — Bootstrap dismiss / resume / completion lifecycle policy (read-only contract).
 * READY evaluator remains authoritative; wizard fields are hints only.
 */
(function (global) {
  'use strict';

  const LIFECYCLE_STATE = Object.freeze({
    UNCONFIGURED: 'UNCONFIGURED',
    PARTIAL: 'PARTIAL',
    READY: 'READY',
    ERROR_RETRYABLE: 'ERROR_RETRYABLE',
    USER_ACTION_REQUIRED: 'USER_ACTION_REQUIRED',
    FATAL: 'FATAL',
    CANCELLED: 'CANCELLED',
  });

  const COMPLETION_AUTHORITY = 'SetupStateService.evaluateReady / ReadyPureEvaluator';

  const MARKER_AUTHORITY = Object.freeze({
    bootstrapCompletedAt: { authority: 'evidence', canInvalidateReady: false, cache: true, legacy: false },
    setupCompletedAt: { authority: 'derived', canInvalidateReady: false, cache: true, legacy: false },
    wizardCompletedSteps: { authority: 'legacy_only', canInvalidateReady: false, cache: true, legacy: true },
    wizardCurrentStep: { authority: 'hint_only', canInvalidateReady: false, cache: true, legacy: false },
    wizardSyncDone: { authority: 'legacy_only', canInvalidateReady: false, cache: true, legacy: true },
    bootDoneFlag: { authority: 'cache', canInvalidateReady: true, cache: true, legacy: false },
    firstRunWizardCompleted: { authority: 'legacy_only', canInvalidateReady: false, cache: true, legacy: true },
    initialSyncCompletion: { authority: 'derived', canInvalidateReady: false, cache: false, legacy: false },
  });

  function buildEntryPoints() {
    return [
      { id: 'A', name: 'Fresh install startup', trigger: 'maybeAutoOpenBootFlow' },
      { id: 'B', name: 'Partial setup startup', trigger: 'needsBootFlow + coordinator resume' },
      { id: 'C', name: 'READY startup', trigger: 'evaluateReady.ready === true → skip boot' },
      { id: 'D', name: 'Restart during setup', trigger: 'prepareBootstrapResume' },
      { id: 'E', name: 'Logout then startup', trigger: 'login gate + needsBootFlow' },
      { id: 'F', name: 'Failed login', trigger: 'stay on login, no bootstrap unless needsBoot' },
      { id: 'G', name: 'App relaunch', trigger: 'onAppStartupAfterRelaunch' },
      { id: 'H', name: 'Restore-triggered relaunch', trigger: 'restart marker consume' },
      { id: 'I', name: 'Setup completion', trigger: 'completeBootstrapTransition' },
      { id: 'J', name: 'Manual Bootstrap open', trigger: 'BootFlow.forceOpen' },
      { id: 'K', name: 'Developer/support paths', trigger: 'support mode only' },
    ];
  }

  function buildExitPoints() {
    return [
      { id: 'close_button', policy: 'dismissBootstrap → login shell, no operational app' },
      { id: 'escape', policy: 'same as close unless in-flight' },
      { id: 'app_shutdown', policy: 'allowed anytime' },
      { id: 'successful_completion', policy: 'READY evaluate → relaunch/login once' },
      { id: 'cancel_step', policy: 'CANCELLED outcome, gate stays unresolved' },
      { id: 'logout', policy: 'login only; READY device no bootstrap' },
    ];
  }

  function buildStateDiagram() {
    return {
      states: Object.values(LIFECYCLE_STATE),
      transitions: [
        { from: 'UNCONFIGURED', to: 'PARTIAL', when: 'path chosen / first gate started' },
        { from: 'PARTIAL', to: 'READY', when: 'evaluateReady.ready === true' },
        { from: 'PARTIAL', to: 'ERROR_RETRYABLE', when: 'transient failure (UI only)' },
        { from: 'PARTIAL', to: 'USER_ACTION_REQUIRED', when: 'validation/selection required (UI only)' },
        { from: 'PARTIAL', to: 'CANCELLED', when: 'user cancelled step (UI only)' },
        { from: 'PARTIAL', to: 'FATAL', when: 'integrity/corruption (re-derived from truth)' },
        { from: 'READY', to: 'READY', when: 'restart/logout/login — bootstrap skipped' },
      ],
      note: 'Error outcomes are UI state only; READY authority is Stage 2 evaluator',
    };
  }

  function buildCompletionContract() {
    return {
      authority: COMPLETION_AUTHORITY,
      bootstrapCompleteMeans: 'evaluateReady({ ignoreRestart: true }).ready === true',
      notCompletion: ['wizard currentStep at end', 'completedSteps count', 'bootstrapCompletedAt alone'],
      transition: ['final action success', 'authoritative state update', 'evaluate READY', 'clear transient bootstrap state', 'close bootstrap', 'show login once'],
    };
  }

  function buildDismissPolicy() {
    return {
      incompleteClose: 'returns to login shell; operational app remains locked',
      appQuit: 'allowed',
      cancelDoesNotComplete: true,
      closeButtonLabelIncomplete: 'إغلاق والعودة',
      resumeMessage: 'سنكمل الإعداد من حيث توقفت.',
    };
  }

  function resolveLifecycleUiState(ctx) {
    ctx = ctx || {};
    const ready = ctx.ready === true;
    if (ready) return LIFECYCLE_STATE.READY;
    const outcome = ctx.stepError?.outcome;
    if (outcome === 'CANCELLED') return LIFECYCLE_STATE.CANCELLED;
    if (outcome === 'FATAL') return LIFECYCLE_STATE.FATAL;
    if (outcome === 'USER_ACTION_REQUIRED') return LIFECYCLE_STATE.USER_ACTION_REQUIRED;
    if (outcome === 'RETRYABLE') return LIFECYCLE_STATE.ERROR_RETRYABLE;
    if (!ctx.path) return LIFECYCLE_STATE.UNCONFIGURED;
    return LIFECYCLE_STATE.PARTIAL;
  }

  function isOperationalAppAllowed(readyEval, needsBoot) {
    if (readyEval && readyEval.ready === true) return true;
    if (needsBoot === true) return false;
    return !!(readyEval && readyEval.ready === true);
  }

  function shouldClearTransientErrorOnResume() {
    return true;
  }

  function buildResumeMatrix() {
    return {
      source: 'BootstrapCoordinator.effectiveStepIndex + isStepResolved',
      staleCurrentStep: 'ignored when resolved gates differ',
      staleCompletedSteps: 'ignored (deriveCompletedSteps wins)',
      newPath: ['language', 'license', 'google', 'discovery', 'path_decision', 'organization', 'owner', 'branch', 'device', 'business_setup', 'publication', 'restore', 'sync'],
      existingPath: ['language', 'google', 'discovery', 'license_org_recovery', 'branch_select', 'device', 'restore', 'owner_auth', 'sync'],
    };
  }

  function buildLifecycleInventory() {
    return {
      controllers: [
        'BootFlow.needsBootScreen',
        'BootFlow.shouldAutoOpenBoot',
        'BootFlow.maybeAutoOpenBootFlow',
        'BootFlow.prepareBootstrapResume',
        'BootFlow.dismissBootstrap',
        'BootFlow.completeBootstrapTransition',
        'SetupStateService.evaluateReady',
        'SetupStateDom.needsBootFlow',
        'SetupStateDom.applyDomVisibility',
        'BootstrapCoordinator.effectiveStepIndex',
      ],
      markers: MARKER_AUTHORITY,
      entryPoints: buildEntryPoints(),
      exitPoints: buildExitPoints(),
    };
  }

  function buildContract() {
    return {
      lifecycleStates: LIFECYCLE_STATE,
      completion: buildCompletionContract(),
      dismiss: buildDismissPolicy(),
      resume: buildResumeMatrix(),
      stateDiagram: buildStateDiagram(),
      markerAuthority: MARKER_AUTHORITY,
    };
  }

  const BootstrapLifecycleContract = {
    LIFECYCLE_STATE,
    COMPLETION_AUTHORITY,
    MARKER_AUTHORITY,
    buildEntryPoints,
    buildExitPoints,
    buildStateDiagram,
    buildCompletionContract,
    buildDismissPolicy,
    buildResumeMatrix,
    buildLifecycleInventory,
    buildContract,
    resolveLifecycleUiState,
    isOperationalAppAllowed,
    shouldClearTransientErrorOnResume,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BootstrapLifecycleContract;
  }
  global.BootstrapLifecycleContract = BootstrapLifecycleContract;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global);
