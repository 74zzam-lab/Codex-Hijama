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
    FUTURE: 'FUTURE',
    SKIPPED: 'SKIPPED',
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

  function visibleStepsForPath(ctx) {
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

  function resolveItemStatus(stepId, ctx, firstUnresolvedId) {
    if (ctx.stepError && ctx.stepError.stepId === stepId) {
      return STATUS.ERROR;
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
      const error = status === STATUS.ERROR ? ctx.stepError : null;
      return {
        id,
        label: USER_LABELS[id] || id,
        status,
        required: status === STATUS.REQUIRED || status === STATUS.ERROR,
        active: ctx.currentStepId === id,
        error: error ? humanizeError(error.diagnostic || error.code, error.message) : null,
        diagnostic: error?.diagnostic || error?.code || null,
        actionAvailable: status === STATUS.REQUIRED || status === STATUS.ERROR || status === STATUS.IN_PROGRESS,
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
    NEW_CHECKLIST_STEPS,
    EXISTING_CHECKLIST_STEPS,
    USER_LABELS,
    ERROR_MESSAGES,
    escapeHtml,
    humanizeError,
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
