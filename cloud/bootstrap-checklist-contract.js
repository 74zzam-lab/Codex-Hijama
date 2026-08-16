/**
 * Stage 17 — Bootstrap checklist UI contract (read-only, non-authoritative).
 * Derives DONE / REQUIRED / IN_PROGRESS / ERROR / FUTURE from gates + UI context.
 */
(function (global) {
  'use strict';

  const STATUS = Object.freeze({
    DONE: 'DONE',
    REQUIRED: 'REQUIRED',
    IN_PROGRESS: 'IN_PROGRESS',
    ERROR: 'ERROR',
    USER_ACTION: 'USER_ACTION',
    FATAL: 'FATAL',
    CANCELLED: 'CANCELLED',
    FUTURE: 'FUTURE',
    SKIPPED: 'SKIPPED',
  });

  const OUTCOME_TO_STATUS = Object.freeze({
    SUCCESS: STATUS.DONE,
    RETRYABLE: STATUS.ERROR,
    USER_ACTION_REQUIRED: STATUS.USER_ACTION,
    FATAL: STATUS.FATAL,
    CANCELLED: STATUS.CANCELLED,
  });

  const NEW_CHECKLIST_STEPS = Object.freeze([
    'language', 'license', 'google', 'discovery', 'path_decision',
    'organization', 'owner', 'branch', 'device', 'business_setup',
    'publication', 'restore', 'sync', 'ready',
  ]);

  const EXISTING_CHECKLIST_STEPS = Object.freeze([
    'language', 'google', 'discovery', 'license_org_recovery',
    'branch_select', 'device', 'restore', 'owner_auth', 'sync', 'ready',
  ]);

  const USER_LABELS = Object.freeze({
    language: 'اللغة',
    license: 'تفعيل البرنامج',
    google: 'ربط حساب Google',
    discovery: 'البحث عن البيانات السابقة',
    path_decision: 'اختيار طريقة الإعداد',
    organization: 'بيانات المؤسسة',
    owner: 'حساب المالك',
    branch: 'إعداد الفرع',
    branch_select: 'اختيار الفرع',
    device: 'إعداد الجهاز',
    business_setup: 'البيانات الأساسية',
    publication: 'حفظ البيانات على السحابة',
    restore: 'استرجاع البيانات',
    owner_auth: 'تأكيد حساب المالك',
    license_org_recovery: 'استرداد الترخيص والمؤسسة',
    sync: 'المزامنة الأولية',
    ready: 'جاهز للاستخدام',
  });

  const ERROR_MESSAGES = Object.freeze({
    google_not_connected: 'تعذر ربط حساب Google. حاول مرة أخرى.',
    discovery_failed: 'تعذر إكمال البحث عن البيانات السابقة.',
    existing_business_not_found: 'لم يتم العثور على بيانات سابقة لهذا الحساب.',
    existing_license_recovery_failed: 'تعذر استرداد الترخيص أو المؤسسة.',
    existing_candidate_ambiguous: 'وُجد أكثر من مؤسسة — اختر المؤسسة الصحيحة.',
    candidate_selection_required: 'يلزم اختيار مؤسسة قبل المتابعة.',
    activation_invalid: 'رمز التفعيل غير صالح أو منتهٍ.',
    owner_credential_required: 'يلزم التحقق من حساب المالك.',
    device_limit_exceeded: 'تم بلوغ الحد الأقصى للأجهزة.',
    publication_failed: 'تعذر حفظ البيانات على السحابة.',
    readback_failed: 'تعذر التحقق من الحفظ السحابي.',
    restore_failed: 'تعذر استرجاع البيانات.',
    initial_sync_failed: 'تعذر إكمال المزامنة الأولية.',
    sync_not_ready: 'المزامنة غير جاهزة بعد.',
    business_setup_invalid: 'أكمل البيانات الأساسية المطلوبة.',
    step_required: 'أكمل المتطلبات الظاهرة في هذه الخطوة قبل المتابعة.',
    step_failed: 'أكمل المتطلبات الظاهرة في هذه الخطوة قبل المتابعة.',
    discovery_in_flight: 'انتظر اكتمال فحص السحابة قبل المتابعة.',
    cloud_download_stalled: 'توقف تنزيل النسخة — تحقق من الاتصال ثم أعد المحاولة.',
  });

  const STEP_IN_FLIGHT = Object.freeze({
    language: null,
    license: 'licenseActivate',
    google: 'oauth',
    discovery: 'discovery',
    path_decision: null,
    organization: 'branchBind',
    owner: 'ownerCreate',
    branch: 'branchCreate',
    branch_select: 'branchBind',
    device: 'deviceRegister',
    business_setup: 'businessSetup',
    publication: 'publication',
    restore: 'restore',
    sync: 'sync',
    license_org_recovery: 'licenseActivate',
    owner_auth: 'ownerLogin',
    ready: null,
  });

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function humanizeError(code, fallback) {
    if (!code) return fallback || 'حدث خطأ — حاول مرة أخرى.';
    const key = String(code).toLowerCase();
    return ERROR_MESSAGES[key] || ERROR_MESSAGES[String(code)] || fallback || `حدث خطأ (${code})`;
  }

  function isExistingPath(ctx) {
    return ctx.path === 'existing' || ctx.forkDecision === 'use_existing';
  }

  function shouldShowPathDecision(ctx) {
    if (isExistingPath(ctx)) return false;
    if (ctx.pathDecisionResolved) return true;
    if (ctx.needsPathFork) return true;
    if (ctx.forkDecision) return true;
    return false;
  }

  function shouldShowOwnerAuth(ctx) {
    if (!isExistingPath(ctx)) return false;
    if (ctx.ownerAuthResolved) return true;
    if (ctx.ownerAuthRequired) return true;
    if (ctx.currentStepId === 'owner_auth') return true;
    return false;
  }

  /**
   * Delegates to the authoritative step model so the checklist, the header
   * ("الخطوة X من Y"), Next/Back and resume all filter conditional steps the
   * same way. Divergence here was the source of the step-numbering drift.
   */
  function visibleStepsForPath(ctx) {
    const model = global.BootstrapStepModel;
    const path = isExistingPath(ctx) ? 'existing' : 'new';
    if (model?.getApplicableSteps) return model.getApplicableSteps(path, ctx);
    const base = isExistingPath(ctx) ? EXISTING_CHECKLIST_STEPS.slice() : NEW_CHECKLIST_STEPS.slice();
    return base.filter((stepId) => {
      if (stepId === 'path_decision') return shouldShowPathDecision(ctx);
      if (stepId === 'owner_auth') return shouldShowOwnerAuth(ctx);
      return true;
    });
  }

  function isStepDone(stepId, ctx) {
    if (typeof ctx.validateStep === 'function') return ctx.validateStep(stepId) === true;
    return false;
  }

  function isStepInProgress(stepId, ctx) {
    const key = STEP_IN_FLIGHT[stepId];
    if (!key || !ctx.uiOps) return false;
    return ctx.uiOps[key] === true;
  }

  function resolveFailureStatus(stepError) {
    if (!stepError) return null;
    const outcome = stepError.outcome || null;
    if (outcome && OUTCOME_TO_STATUS[outcome]) return OUTCOME_TO_STATUS[outcome];
    if (stepError.fatal) return STATUS.FATAL;
    if (stepError.cancelled) return STATUS.CANCELLED;
    if (stepError.userActionRequired) return STATUS.USER_ACTION;
    return STATUS.ERROR;
  }

  function resolveItemStatus(stepId, ctx, firstUnresolvedId) {
    if (ctx.stepError && ctx.stepError.stepId === stepId) {
      return resolveFailureStatus(ctx.stepError) || STATUS.ERROR;
    }
    if (isStepDone(stepId, ctx)) return STATUS.DONE;
    if (ctx.currentStepId === stepId && isStepInProgress(stepId, ctx)) return STATUS.IN_PROGRESS;
    if (stepId === firstUnresolvedId) {
      if (ctx.currentStepId === stepId && isStepInProgress(stepId, ctx)) return STATUS.IN_PROGRESS;
      return STATUS.REQUIRED;
    }
    if (ctx.currentStepId === stepId && !isStepDone(stepId, ctx)) return STATUS.REQUIRED;
    return STATUS.FUTURE;
  }

  function buildChecklistModel(ctx) {
    ctx = ctx || {};
    const steps = visibleStepsForPath(ctx);
    const firstUnresolved = steps.find((id) => !isStepDone(id, ctx) && id !== 'ready') || null;
    const items = steps.map((id) => {
      const status = resolveItemStatus(id, ctx, firstUnresolved);
      const failureStatuses = [STATUS.ERROR, STATUS.USER_ACTION, STATUS.FATAL, STATUS.CANCELLED];
      const error = failureStatuses.includes(status) ? ctx.stepError : null;
      return {
        id,
        label: USER_LABELS[id] || id,
        status,
        required: status === STATUS.REQUIRED || status === STATUS.ERROR || status === STATUS.USER_ACTION || status === STATUS.FATAL,
        active: ctx.currentStepId === id,
        error: error ? humanizeError(error.code || error.diagnostic, error.message) : null,
        diagnostic: error?.code && !String(error.code).startsWith('TDW-BOOT-ERR')
          ? error.code
          : (error?.correlationId || error?.diagnostic || error?.code || null),
        outcome: error?.outcome || null,
        retryable: !!error?.retryable,
        userActionRequired: !!error?.userActionRequired,
        fatal: !!error?.fatal,
        cancelled: !!error?.cancelled,
        actionAvailable: status === STATUS.REQUIRED || status === STATUS.ERROR || status === STATUS.USER_ACTION
          || status === STATUS.IN_PROGRESS || (status === STATUS.CANCELLED && error?.userActionRequired),
      };
    });
    const countable = items.filter((i) => i.status !== STATUS.SKIPPED);
    const doneCount = countable.filter((i) => i.status === STATUS.DONE).length;
    const total = countable.length || 1;
    const percent = Math.min(100, Math.max(0, Math.round((doneCount / total) * 100)));
    return {
      path: ctx.path,
      items,
      progress: { done: doneCount, total, percent },
      currentStepId: ctx.currentStepId,
      firstUnresolvedId: firstUnresolved,
    };
  }

  function buildContract() {
    return {
      statuses: STATUS,
      newChecklist: NEW_CHECKLIST_STEPS.slice(),
      existingChecklist: EXISTING_CHECKLIST_STEPS.slice(),
      userLabels: USER_LABELS,
      gateToUiMapping: STEP_IN_FLIGHT,
      autoResolvedHidden: ['business_setup', 'publication', 'readback'],
      authority: 'BootstrapGates + BootFlow.validateStep (read-only)',
    };
  }

  function buildUiInventoryBefore() {
    return {
      wizardContainer: 'bootFlowOverlay / bf-dialog',
      progressBar: 'bf-progress dots + bf-stepper horizontal list',
      stepTitle: 'bf-wizard-title, bf-step-label',
      stepBody: 'bf-step-content',
      navigation: 'bf-step-nav prev/next',
      actions: 'bf-step-actions',
      errorBox: 'bf-wizard-status.bf-status',
      statusBox: 'bf-step-meta, bf-step-hint',
      loadingState: 'in-flight flags + disabled buttons',
      completedIndicators: 'bf-stepper data-state=done (wizard.completedSteps derived)',
      pathSelector: 'bf-step-choose new/existing buttons',
      renderFunctions: ['renderProgress', 'renderStepUI', 'renderNavButtons', 'getDisplayWizard'],
      responsive: '@media max-width 640px stepper scroll',
      stage17Target: 'bf-checklist sidebar + bf-checklist-main content panel',
    };
  }

  const BootstrapChecklistContract = {
    STATUS,
    OUTCOME_TO_STATUS,
    NEW_CHECKLIST_STEPS,
    EXISTING_CHECKLIST_STEPS,
    USER_LABELS,
    ERROR_MESSAGES,
    escapeHtml,
    humanizeError,
    resolveFailureStatus,
    visibleStepsForPath,
    buildChecklistModel,
    buildContract,
    buildUiInventoryBefore,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BootstrapChecklistContract;
  }
  global.BootstrapChecklistContract = BootstrapChecklistContract;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global);
