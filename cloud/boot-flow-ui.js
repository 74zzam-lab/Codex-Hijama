/**
 * V2-5.9 Activation Wizard — simplified customer journey (no Owner Bootstrap).
 * V2-5.10+ Stage 6 — NEW customer: Activation (license) before Google.
 * V2-5.11+ Stage 7 — Explicit Discovery gate after Google (read-mostly, separate from OAuth).
 * V2-5.12+ Stage 8 — Explicit NEW/EXISTING fork after Discovery when existing business found.
 * V2-5.13+ Stage 9 — NEW Start New: Owner before first Branch (organization → owner → branch → restore).
 * V2-5.14+ Stage 11 — Explicit Device step after Branch (branch/device orchestration split).
 * V2-5.15+ Stage 12 — Explicit Business Setup gate after Device (NEW) / after Restore (EXISTING).
 * V2-5.16+ Stage 13 — Explicit Publication gate with remote read-back after Business Setup (NEW) / after Business Setup (EXISTING).
 * V2-5.17+ Stage 16 — Existing customer short path (recovery-only, no re-creation).
 * NEW: Language → Activation → Google → Discovery → Path decision (if needed) → Organization → Owner → Branch → Device → Business Setup → Publication → Restore → Sync → Ready
 * EXISTING: Language → Google → Discovery → License/Org recovery → Branch_select → Device → Restore → Owner auth → Sync → Ready
 *
 * Google Login never implies Owner. Owner is a seeded normal user account.
 * Dashboard/login completion requires Google + license + org + device branch + data decision + sync.
 */
(function (global) {
  'use strict';

  const BOOT_DONE_KEY = '__tdw_boot_complete__';
  const WIZARD_KEY = '__tdw_boot_wizard__';
  const LANG_KEY = '__tdw_ui_lang__';
  const RESTART_REQUIRED_KEY = '__tdw_restart_required__';

  const PATHS = { NEW: 'new', EXISTING: 'existing' };
  const SETUP_CONNECTIVITY_POLICY = Object.freeze({
    mode: 'cloud_required_for_initial_setup',
    initialSetupRequiresGoogle: true,
    establishedOfflineStartAllowed: true,
  });

  const WIZARD_FLOW_VERSION = 16;
  const LEGACY_NEW_STEPS_PRE_STAGE6 = Object.freeze([
    'language', 'google', 'license', 'organization', 'branch', 'restore', 'owner', 'sync', 'ready',
  ]);
  const LEGACY_NEW_STEPS_PRE_STAGE7 = Object.freeze([
    'language', 'license', 'google', 'organization', 'branch', 'restore', 'owner', 'sync', 'ready',
  ]);
  const LEGACY_NEW_STEPS_PRE_STAGE8 = Object.freeze([
    'language', 'license', 'google', 'discovery', 'organization', 'branch', 'restore', 'owner', 'sync', 'ready',
  ]);
  const LEGACY_NEW_STEPS_PRE_STAGE9 = Object.freeze([
    'language', 'license', 'google', 'discovery', 'path_decision', 'organization', 'branch', 'restore', 'owner', 'sync', 'ready',
  ]);
  const LEGACY_NEW_STEPS_PRE_STAGE11 = Object.freeze([
    'language', 'license', 'google', 'discovery', 'path_decision', 'organization', 'owner', 'branch', 'restore', 'sync', 'ready',
  ]);
  const LEGACY_NEW_STEPS_PRE_STAGE12 = Object.freeze([
    'language', 'license', 'google', 'discovery', 'path_decision', 'organization', 'owner', 'branch', 'device', 'restore', 'sync', 'ready',
  ]);
  const LEGACY_NEW_STEPS_PRE_STAGE13 = Object.freeze([
    'language', 'license', 'google', 'discovery', 'path_decision', 'organization', 'owner', 'branch', 'device', 'business_setup', 'restore', 'sync', 'ready',
  ]);
  const LEGACY_EXISTING_STEPS_PRE_STAGE7 = Object.freeze([
    'language', 'google', 'license', 'organization', 'branch_select', 'restore', 'owner', 'sync', 'ready',
  ]);
  const LEGACY_EXISTING_STEPS_PRE_STAGE11 = Object.freeze([
    'language', 'google', 'discovery', 'license', 'organization', 'branch_select', 'restore', 'owner', 'sync', 'ready',
  ]);
  const LEGACY_EXISTING_STEPS_PRE_STAGE12 = Object.freeze([
    'language', 'google', 'discovery', 'license', 'organization', 'branch_select', 'device', 'restore', 'owner', 'sync', 'ready',
  ]);
  const LEGACY_EXISTING_STEPS_PRE_STAGE13 = Object.freeze([
    'language', 'google', 'discovery', 'license', 'organization', 'branch_select', 'device', 'restore', 'business_setup', 'owner', 'sync', 'ready',
  ]);

  const LEGACY_EXISTING_STEPS_PRE_STAGE16 = Object.freeze([
    'language', 'google', 'discovery', 'license', 'organization', 'branch_select', 'device', 'restore', 'business_setup', 'publication', 'owner', 'sync', 'ready',
  ]);

  const NEW_STEPS = ['language', 'license', 'google', 'discovery', 'path_decision', 'organization', 'owner', 'branch', 'device', 'business_setup', 'publication', 'restore', 'sync', 'ready'];
  const EXISTING_STEPS = ['language', 'google', 'discovery', 'license_org_recovery', 'branch_select', 'device', 'restore', 'owner_auth', 'sync', 'ready'];

  const STEP_LABELS = {
    language: 'اللغة',
    google: 'ربط Google',
    discovery: 'اكتشاف السحابة',
    path_decision: 'اختيار المسار',
    license: 'التفعيل والترخيص',
    license_org_recovery: 'استرداد الترخيص والمؤسسة',
    owner_auth: 'تحقق المالك',
    organization: 'المؤسسة',
    branch: 'إنشاء أول فرع',
    branch_select: 'اختيار فرع موجود',
    device: 'تسجيل الجهاز',
    business_setup: 'إعداد بيانات المركز',
    publication: 'نشر الإعداد إلى السحابة',
    owner: 'حساب المالك',
    restore: 'مصدر البيانات',
    sync: 'المزامنة الأولية',
    ready: 'الجاهزية وإعادة التشغيل'
  };

  /** Compact stepper labels — avoid tall wrap inside modal header */
  const STEP_SHORT = {
    language: 'لغة',
    google: 'Google',
    discovery: 'اكتشاف',
    path_decision: 'مسار',
    license: 'ترخيص',
    license_org_recovery: 'استرداد',
    owner_auth: 'مالك',
    organization: 'مؤسسة',
    branch: 'فرع',
    branch_select: 'فرع',
    device: 'جهاز',
    business_setup: 'بيانات',
    publication: 'نشر',
    owner: 'مالك',
    restore: 'بيانات',
    sync: 'مزامنة',
    ready: 'جاهز'
  };

  const STEP_HINTS = {
    language: 'اختر لغة الواجهة.',
    google: 'اربط حساب Google للمركز — الاتصال فقط (بدون اكتشاف تلقائي هنا).',
    discovery: 'فحص read-only للمؤسسة/الترخيص/النسخ/الفروع على السحابة — بلا إنشاء أو استعادة.',
    path_decision: 'إذا وُجدت بيانات سابقة على Google، اختر: استخدام الموجود أو بدء إعداد جديد.',
    license: 'يُسحب الترخيص من Drive إن وُجد؛ وإلا أدخل المفتاح.',
    license_org_recovery: 'استرداد الترخيص والمؤسسة من السحابة — بلا تفعيل يدوي ولا إنشاء مؤسسة جديدة.',
    owner_auth: 'تحقق من حساب المالك الحالي — ليس إنشاء مالك جديد.',
    organization: 'أكد المؤسسة المصرّح بها فقط.',
    branch: 'اسم الفرع الأول فقط — تسجيل الجهاز في الخطوة التالية.',
    branch_select: 'اختر فرعاً موجوداً — تسجيل الجهاز في الخطوة التالية.',
    device: 'أدخل اسم هذا الجهاز لربطه بالفرع المحدد.',
    business_setup: 'أكمل بيانات المركز الأساسية (الاسم والهاتف) قبل متابعة الإعداد.',
    publication: 'ارفع بيانات الإعداد إلى Google Drive مع تحقق read-back قبل الاستعادة/المزامنة.',
    owner: 'أنشئ حساب المالك الحقيقي للمؤسسة — مطلوب قبل إنشاء أول فرع.',
    restore: 'فحص سريع للمصادر ثم تأكيد الاستعادة — سحابة / محلي / Backup V2 / فارغ بلا تنزيل أثناء الاكتشاف.',
    sync: 'المزامنة تُفعَّل بعد اكتمال الربط.',
    ready: 'أعد تشغيل التطبيق لتطبيق التفعيل.'
  };

  let oauthInFlight = false;
  let branchCreateInFlight = false;
  let branchBindInFlight = false;
  let deviceRegisterInFlight = false;
  let businessSetupInFlight = false;
  let publicationInFlight = false;
  let licenseActivateInFlight = false;
  let ownerLoginInFlight = false;
  let setupOwnerSessionUserId = null;
  let restoreInFlight = false;
  let syncInFlight = false;
  let discoveryInFlight = false;
  let lastFocusEl = null;
  let checklistStepError = null;
  let failureContextSnapshot = { googleEmail: null, branchId: null, restoreChoice: null, organizationId: null };
  let lastGateRetryHandler = null;
  let renderGeneration = 0;

  function isCriticalOpInFlight() {
    if (oauthInFlight || licenseActivateInFlight || branchCreateInFlight || branchBindInFlight
        || deviceRegisterInFlight || ownerLoginInFlight || restoreInFlight || syncInFlight || discoveryInFlight
        || publicationInFlight) {
      return true;
    }
    return !!global.OwnerManagement?.isOwnerCreationInProgress?.();
  }

  function ownerCreateInFlight() {
    return !!global.OwnerManagement?.isOwnerCreationInProgress?.();
  }

  function normalizeWizardFlowState(w) {
    if (!w || !w.path) return w;
    let changed = false;
    // Persisted records from older builds can omit completedSteps entirely.
    // Every gate below (and runGoogleConnect) treats it as an array, so a
    // missing value used to surface as a false "operation failed".
    if (!Array.isArray(w.completedSteps)) {
      w.completedSteps = [];
      changed = true;
    }
    const version = Number(w.wizardFlowVersion || 0);
    if (version < WIZARD_FLOW_VERSION) {
      const legacySteps = w.path === PATHS.EXISTING
        ? (version < 7 ? LEGACY_EXISTING_STEPS_PRE_STAGE7
          : (version < 11 ? LEGACY_EXISTING_STEPS_PRE_STAGE11
            : (version < 12 ? LEGACY_EXISTING_STEPS_PRE_STAGE12
              : (version < 13 ? LEGACY_EXISTING_STEPS_PRE_STAGE13
                : (version < 16 ? LEGACY_EXISTING_STEPS_PRE_STAGE16 : EXISTING_STEPS)))))
        : (version < 6
          ? LEGACY_NEW_STEPS_PRE_STAGE6
          : (version < 7
            ? LEGACY_NEW_STEPS_PRE_STAGE7
            : (version < 8
              ? LEGACY_NEW_STEPS_PRE_STAGE8
              : (version < 9
                ? LEGACY_NEW_STEPS_PRE_STAGE9
                : (version < 11 ? LEGACY_NEW_STEPS_PRE_STAGE11
                  : (version < 12 ? LEGACY_NEW_STEPS_PRE_STAGE12
                    : (version < 13 ? LEGACY_NEW_STEPS_PRE_STAGE13 : NEW_STEPS)))))));
      const steps = stepsFor(w.path);
      const legacyIdx = Number(w.currentStep);
      if (Number.isFinite(legacyIdx) && legacyIdx >= 0 && legacyIdx < legacySteps.length) {
        const legacyStepId = legacySteps[legacyIdx];
        const ESC = global.ExistingShortPathContract;
        const mappedStepId = (w.path === PATHS.EXISTING && ESC?.mapLegacyStep)
          ? (ESC.mapLegacyStep(legacyStepId) || legacyStepId)
          : legacyStepId;
        const newIdx = steps.indexOf(mappedStepId);
        if (newIdx >= 0 && newIdx !== w.currentStep) {
          w.currentStep = newIdx;
          changed = true;
        }
      }
      if (version < 16 && w.path === PATHS.EXISTING && global.ExistingShortPathContract?.migrateCompletedSteps) {
        const migrated = global.ExistingShortPathContract.migrateCompletedSteps(w.completedSteps);
        if (JSON.stringify(migrated) !== JSON.stringify(w.completedSteps || [])) {
          w.completedSteps = migrated;
          changed = true;
        }
      }
      if (Number(w.wizardFlowVersion || 0) < WIZARD_FLOW_VERSION) {
        w.wizardFlowVersion = WIZARD_FLOW_VERSION;
        changed = true;
      }
      if (version < 11 && hasDeviceBranch()) {
        if (!Array.isArray(w.completedSteps)) w.completedSteps = [];
        if (!w.completedSteps.includes('device')) w.completedSteps.push('device');
        // A locked local branch is NOT evidence that the operator chose it. The
        // branch gate re-derives provenance from DeviceConfig separately, so
        // migration must not forge an explicit selection here.
        changed = true;
      }
      if (w.branchExplicitlySelected !== undefined) {
        delete w.branchExplicitlySelected;
        changed = true;
      }
      if (version < 12 && businessSetupStepResolved()) {
        if (!Array.isArray(w.completedSteps)) w.completedSteps = [];
        if (!w.completedSteps.includes('business_setup')) w.completedSteps.push('business_setup');
        changed = true;
      }
      if (version < 13 && publicationStepResolved()) {
        if (!Array.isArray(w.completedSteps)) w.completedSteps = [];
        if (!w.completedSteps.includes('publication')) w.completedSteps.push('publication');
        changed = true;
      }
      if (version < 14 && readbackStepResolved()) {
        if (!Array.isArray(w.completedSteps)) w.completedSteps = [];
        if (!w.completedSteps.includes('publication')) w.completedSteps.push('publication');
        changed = true;
      }
      if (changed) saveWizard(w);
    }
    return w;
  }

  function loadWizard() {
    let raw = null;
    try {
      const stored = localStorage.getItem(WIZARD_KEY);
      if (stored) raw = JSON.parse(stored);
    } catch { /* empty */ }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      raw = global.DB?.get?.(WIZARD_KEY, {
        path: null,
        currentStep: 0,
        completedSteps: [],
        startedAt: null,
        lang: global.UxI18n?.getLang?.() || 'ar',
        restoreChoice: null,
        syncDone: false,
        oauthLockAt: null,
        wizardFlowVersion: 0,
      }) || {
        path: null, currentStep: 0, completedSteps: [], startedAt: null, lang: 'ar', restoreChoice: null, syncDone: false,
        wizardFlowVersion: 0,
      };
    }
    return normalizeWizardFlowState(raw);
  }

  function saveWizard(w) {
    const payload = (w && typeof w === 'object' && !Array.isArray(w)) ? { ...w } : w;
    // UI-only wizard state is Chromium-local. Write it first so loadWizard() cannot
    // miss a silent DB.set failure before SqliteBridge write-through is installed.
    try {
      localStorage.setItem(WIZARD_KEY, JSON.stringify(payload));
    } catch { /* empty */ }
    const bridge = global.SqliteBridge;
    if (bridge?.setUiOnly && global.DB?.__sqliteWriteThrough) {
      bridge.setUiOnly(WIZARD_KEY, payload);
      return payload;
    }
    const set = global.DB?.set;
    if (set) {
      const result = set(WIZARD_KEY, payload);
      try {
        if (global.DB?.__rawSet) global.DB.__rawSet(WIZARD_KEY, payload);
      } catch { /* empty */ }
      void result;
    }
    return payload;
  }

  function resetWizard(path) {
    return saveWizard({
      path,
      currentStep: 0,
      completedSteps: [],
      startedAt: new Date().toISOString(),
      lang: loadWizard().lang || 'ar',
      restoreChoice: null,
      syncDone: false,
      oauthLockAt: null,
      wizardFlowVersion: WIZARD_FLOW_VERSION,
    });
  }

  function stepsFor(path) {
    const model = global.BootstrapStepModel;
    if (model?.sequenceFor) {
      return model.sequenceFor(path === PATHS.EXISTING ? 'existing' : 'new');
    }
    return path === PATHS.EXISTING ? EXISTING_STEPS : NEW_STEPS;
  }

  function userError(err, code) {
    if (global.ActivationErrors?.toUserError) {
      return global.ActivationErrors.toUserError(err, code);
    }
    return { title: 'خطأ', detail: String(err && err.message || err || code || ''), diagnosticCode: 'TDW-ACT-FALLBACK' };
  }

  function normalizeBootstrapFailure(err, code, stepId) {
    const BFPC = global.BootstrapFailurePolicyContract;
    if (BFPC?.normalizeFailure) {
      return BFPC.normalizeFailure(err, { code, stepId });
    }
    const ue = userError(err, code);
    return {
      ok: false,
      outcome: 'RETRYABLE',
      code: code || ue.diagnosticCode || 'step_failed',
      message: ue.detail || ue.title,
      retryable: true,
      userActionRequired: false,
      fatal: false,
      cancelled: false,
      correlationId: `TDW-BOOT-FALLBACK-${Date.now()}`,
      stepId: stepId || null,
    };
  }

  function formatFailureForStatus(normalized) {
    if (!normalized || normalized.ok) return '';
    if (normalized.cancelled) return `${normalized.message} (${normalized.correlationId})`;
    const benignGate = normalized.code === 'TDW-BOOT-STEP-REQUIRED'
      || normalized.rawCode === 'step_required'
      || normalized.rawCode === 'step_failed'
      || normalized.rawCode === 'discovery_in_flight';
    if (benignGate) return normalized.message;
    const prefix = normalized.fatal ? 'خطأ حرج'
      : (normalized.userActionRequired ? 'إجراء مطلوب' : 'خطأ');
    const retryHint = normalized.retryable ? ' — يمكن إعادة المحاولة' : '';
    // One primary owner: meaningful code + one Arabic message + one support ref.
    // Never append a second generic "unexpected" line when a known rawCode exists.
    const primaryCode = normalized.rawCode && normalized.rawCode !== 'unknown'
      && normalized.rawCode !== normalized.code
      ? `${normalized.code} / ${normalized.rawCode}`
      : normalized.code;
    const supportRef = normalized.correlationId ? ` — مرجع: ${normalized.correlationId}` : '';
    return `${prefix} — ${normalized.message} (${primaryCode})${retryHint}${supportRef}`;
  }

  function logNormalizedFailure(stepId, normalized) {
    const BFPC = global.BootstrapFailurePolicyContract;
    if (BFPC?.logBootstrapFailure && normalized && !normalized.ok) {
      BFPC.logBootstrapFailure({
        step: stepId,
        stepId,
        outcome: normalized.outcome,
        code: normalized.code,
        correlationId: normalized.correlationId,
        safeDetails: normalized.message,
      });
    }
  }

  function clearChecklistStepError(stepIds) {
    if (!checklistStepError) return;
    const ids = Array.isArray(stepIds) ? stepIds : [stepIds];
    if (!ids.length || ids.includes(checklistStepError.stepId)) {
      checklistStepError = null;
      lastGateRetryHandler = null;
    }
  }

  function invalidateStaleChecklistErrors(w) {
    w = w || loadWizard();
    const googleEmail = global.settings?.backup?.providers?.google?.email || null;
    const branchId = getSelectedBranchId() || null;
    const restoreChoice = w.restoreChoice || null;
    const organizationId = global.CenterId?.getStoredCenterId?.()
      || global.LicenseCloud?.loadLocal?.()?.centerId || null;
    const snap = failureContextSnapshot;
    const staleSteps = [];
    if (snap.googleEmail && googleEmail && snap.googleEmail !== googleEmail) {
      staleSteps.push('google', 'discovery', 'path_decision', 'license_org_recovery');
    }
    if (snap.organizationId && organizationId && snap.organizationId !== organizationId) {
      staleSteps.push('organization', 'owner', 'branch', 'branch_select', 'device', 'business_setup', 'publication', 'sync');
    }
    if (snap.branchId && branchId && snap.branchId !== branchId) {
      staleSteps.push('device', 'restore', 'sync');
    }
    if (snap.restoreChoice && restoreChoice && snap.restoreChoice !== restoreChoice) {
      staleSteps.push('restore', 'sync');
    }
    if (staleSteps.length && checklistStepError && staleSteps.includes(checklistStepError.stepId)) {
      checklistStepError = null;
      lastGateRetryHandler = null;
    }
    failureContextSnapshot = { googleEmail, branchId, restoreChoice, organizationId };
  }

  function setStatus(msg, isError) {
    const el = document.getElementById('bf-wizard-status');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('bf-status-error', !!isError);
    el.setAttribute('role', isError ? 'alert' : 'status');
    if (!isError && msg && String(msg).includes('✅')) {
      const w = getDisplayWizard(loadWizard());
      const step = stepsFor(w.path)[w.currentStep];
      if (checklistStepError?.stepId === step) {
        checklistStepError = null;
        lastGateRetryHandler = null;
      }
      renderChecklist(w);
    }
  }

  function isStepOperationInFlight(stepId) {
    const ctx = getChecklistUiContext();
    const key = global.BootstrapChecklistContract?.STEP_IN_FLIGHT?.[stepId]
      || { discovery: 'discovery', google: 'oauth', license_org_recovery: 'licenseActivate' }[stepId];
    if (!key || !ctx.uiOps) return false;
    return ctx.uiOps[key] === true;
  }

  function setStatusFromErr(err, code, options) {
    options = options || {};
    const w = getDisplayWizard(loadWizard());
    invalidateStaleChecklistErrors(w);
    let step = options.stepId || stepsFor(w.path)[w.currentStep];
    const normalized = normalizeBootstrapFailure(err, code, step);
    if (!options.stepId && step === 'google' && hasGoogle()) {
      const discoveryCodes = ['discovery_failed', 'license_discovery_failed', 'data_discovery_failed', 'existing_license_recovery_failed', 'no_activation_on_drive'];
      if (discoveryCodes.includes(normalized.code)) step = 'discovery';
    }
    if (options.suppressIfResolved && step && validateStep(step)) {
      return normalized;
    }
    if (normalized.code === 'TDW-BOOT-STEP-REQUIRED' || code === 'step_required' || code === 'step_failed') {
      if (isStepOperationInFlight(step) || (step === 'discovery' && discoveryInFlight)) {
        setStatus('⏳ العملية جارية — انتظر اكتمالها قبل المتابعة', false);
        return normalized;
      }
      normalized.message = options.message || normalized.message || 'أكمل المتطلبات الظاهرة في هذه الخطوة قبل المتابعة.';
      normalized.userActionRequired = true;
      normalized.retryable = false;
      setStatus(normalized.message, false);
      return normalized;
    }
    if (options.retryHandler) lastGateRetryHandler = options.retryHandler;
    const isOperationalError = !normalized.cancelled
      && !normalized.userActionRequired
      && (normalized.fatal || normalized.retryable)
      && options.inProgress !== true;
    if (isOperationalError) {
      try {
        global.BootstrapFailurePolicyContract?.recordDiagnostic?.({
          correlationId: normalized.correlationId,
          stepId: step,
          code: normalized.code,
          rawCode: normalized.rawCode,
          outcome: normalized.outcome,
          operation: options.operation || null,
          message: normalized.message,
          recovered: false,
        });
      } catch { /* dev-only */ }
    }
    setStatus(formatFailureForStatus(normalized), isOperationalError);
    if (step && !normalized.ok) {
      logNormalizedFailure(step, normalized);
      checklistStepError = {
        stepId: step,
        code: normalized.code,
        message: normalized.message,
        diagnostic: normalized.code,
        outcome: normalized.outcome,
        retryable: normalized.retryable,
        userActionRequired: normalized.userActionRequired,
        fatal: normalized.fatal,
        cancelled: normalized.cancelled,
        correlationId: normalized.correlationId,
      };
      renderChecklist(w);
    }
    return normalized;
  }

  function getChecklistUiContext(w) {
    // Invalidate an unprovable branch selection BEFORE the checklist is derived,
    // so a branch set that changed after an auto-selection cannot render DONE.
    reconcileBranchSelection();
    w = w || getDisplayWizard(loadWizard());
    invalidateStaleChecklistErrors(w);
    if (checklistStepError?.stepId === 'discovery' && hasDiscoveryResolved()) {
      checklistStepError = null;
      lastGateRetryHandler = null;
    }
    if (checklistStepError?.stepId === 'branch_select' && !isBranchExplicitlySelected()) {
      checklistStepError = null;
      lastGateRetryHandler = null;
    }
    const steps = stepsFor(w.path);
    const currentStepId = steps[w.currentStep] || steps[0] || null;
    if (checklistStepError?.stepId && validateStep(checklistStepError.stepId)) {
      checklistStepError = null;
      lastGateRetryHandler = null;
    }
    return {
      path: w.path,
      forkDecision: w.forkDecision,
      currentStepId,
      validateStep,
      needsPathFork: needsPathForkDecision(),
      pathDecisionResolved: hasPathDecisionResolved(),
      ownerAuthResolved: ownerAuthStepResolved(),
      ownerAuthRequired: hasOwnerPasswordAccount() && !ownerAuthStepResolved(),
      stepError: checklistStepError,
      uiOps: {
        oauth: oauthInFlight,
        discovery: discoveryInFlight,
        licenseActivate: licenseActivateInFlight,
        branchCreate: branchCreateInFlight,
        branchBind: branchBindInFlight,
        deviceRegister: deviceRegisterInFlight,
        businessSetup: businessSetupInFlight,
        publication: publicationInFlight,
        ownerLogin: ownerLoginInFlight,
        ownerCreate: ownerCreateInFlight(),
        restore: restoreInFlight,
        sync: syncInFlight,
      },
    };
  }

  function checklistStatusMeta(status) {
    const BCC = global.BootstrapChecklistContract;
    const S = BCC?.STATUS || {};
    switch (status) {
      case S.DONE: return { badge: 'تم', icon: '✓', className: 'done' };
      case S.REQUIRED: return { badge: 'مطلوب', icon: '●', className: 'required' };
      case S.IN_PROGRESS: return { badge: 'جارٍ', icon: '⟳', className: 'progress' };
      case S.ERROR: return { badge: 'خطأ', icon: '!', className: 'error' };
      case S.USER_ACTION: return { badge: 'إجراء', icon: '✎', className: 'user-action' };
      case S.FATAL: return { badge: 'حرج', icon: '⛔', className: 'fatal' };
      case S.CANCELLED: return { badge: 'ملغى', icon: '⊘', className: 'cancelled' };
      default: return { badge: 'لاحقاً', icon: '○', className: 'future' };
    }
  }

  async function retryCurrentGate() {
    const w = getDisplayWizard(loadWizard());
    const step = stepsFor(w.path)[w.currentStep];
    if (!checklistStepError || checklistStepError.stepId !== step || !checklistStepError.retryable) {
      return { ok: false, error: 'retry_not_available' };
    }
    if (typeof lastGateRetryHandler === 'function') {
      return lastGateRetryHandler();
    }
    switch (step) {
      case 'google': return runGoogleConnect();
      case 'discovery': return runDiscoveryGate({ forceRefresh: true });
      case 'license':
      case 'license_org_recovery': return runLicenseOrgRecovery?.() || { ok: false, error: 'step_failed' };
      case 'publication': return commitPublicationFromWizard();
      case 'restore': return { ok: false, error: 'restore_retry_requires_ui' };
      case 'sync': return runInitialSyncPipeline(w);
      default: return { ok: false, error: 'retry_not_available' };
    }
  }

  function hasValidLicense() {
    const lic = typeof global.licLoad === 'function' ? global.licLoad() : null;
    const cloud = global.LicenseCloud?.loadLocal?.();
    if (global._licStatus === 'valid') return true;
    if (lic && global._licStatus !== 'expired' && global._licStatus !== 'blocked') return true;
    if (cloud?.centerId && global.LicenseActivationGate?.isConsumed?.(cloud)) return true;
    if (cloud?.centerId && (cloud.branches || []).length) return true;
    return false;
  }

  function hasGoogle() {
    const prov = global.settings?.backup?.providers?.google;
    if (global.DriveAdapter?.isConnected?.()) return true;
    const w = loadWizard();
    if (w.googleSessionConnected === true && !prov?.userDisconnected && prov?.oauth !== false) return true;
    return !!(prov?.connected && !prov?.userDisconnected && prov?.oauth !== false);
  }

  function googleAccountKey() {
    return String(global.settings?.backup?.providers?.google?.email || '').toLowerCase() || null;
  }

  function currentOrganizationId() {
    return String(global.LicenseCloud?.loadLocal?.()?.centerId
      || global.CenterId?.getStoredCenterId?.()
      || '') || null;
  }

  /**
   * Single count authority. The previous implementation compared two different
   * numbers — the de-duplicated branch list and the RAW discovery candidate list
   * (which contains one entry per piece of evidence, so the same branch appears
   * twice). The gate read the de-duplicated count while the guard read the
   * inflated one, so a single branch silently satisfied the gate while the UI
   * reported "فروع: 2".
   */
  function eligibleBranchCount() {
    return authoritativeBootstrapBranches().length;
  }

  /**
   * Validated branch selection or null.
   *
   * Only a current-context user action counts. Explicitly NOT accepted as proof:
   * a sole eligible branch, a bare pendingBranchId/selectedBranchId,
   * DeviceConfig.lockedBranchId, or `completedSteps` history. The selection is
   * bound to organizationId + googleAccountKey + branchId and dies when any of
   * them changes.
   */
  function currentBranchSelection() {
    const w = loadWizard();
    const sel = w.branchSelection;
    if (!sel || typeof sel !== 'object') return null;
    const branchId = String(sel.branchId || '').trim();
    const provenance = String(sel.provenance || '');
    if (!branchId || (provenance !== 'user' && provenance !== 'created')) return null;
    const orgId = currentOrganizationId();
    if (orgId && sel.organizationId && String(sel.organizationId) !== orgId) return null;
    const account = googleAccountKey();
    if (account && sel.googleAccountKey && String(sel.googleAccountKey) !== account) return null;
    const branches = authoritativeBootstrapBranches();
    if (branches.length && !branches.some((b) => String(b.id) === branchId)) return null;
    return {
      branchId,
      provenance,
      organizationId: sel.organizationId || orgId || null,
      googleAccountKey: sel.googleAccountKey || account || null,
    };
  }

  function recordBranchSelection(branchId, provenance) {
    const w = loadWizard();
    w.branchSelection = {
      branchId: String(branchId),
      provenance,
      organizationId: currentOrganizationId(),
      googleAccountKey: googleAccountKey(),
      at: new Date().toISOString(),
    };
    w.pendingBranchId = String(branchId);
    w.selectedBranchId = String(branchId);
    return saveWizard(w);
  }

  /**
   * Drop any selection that is no longer provable, and remove the derived
   * completion marker with it. Runs synchronously before every checklist render
   * so a branch set that grows from 1 to 2 can never leave a stale DONE behind.
   */
  function reconcileBranchSelection() {
    const w = loadWizard();
    let changed = false;
    const valid = currentBranchSelection();
    if (w.branchSelection && !valid) {
      delete w.branchSelection;
      changed = true;
    }
    // Legacy fields are no longer authority; clear them when unbacked.
    if (!valid && (w.pendingBranchId || w.selectedBranchId)) {
      delete w.pendingBranchId;
      delete w.selectedBranchId;
      changed = true;
    }
    if (w.branchExplicitlySelected !== undefined) {
      delete w.branchExplicitlySelected;
      changed = true;
    }
    if (!valid && Array.isArray(w.completedSteps) && w.completedSteps.includes('branch_select')) {
      w.completedSteps = w.completedSteps.filter((s) => s !== 'branch_select');
      changed = true;
    }
    if (changed) saveWizard(w);
    return w;
  }

  /** Kept for callers that ran after discovery/recovery specifically. */
  function reconcileBranchSelectionAfterDiscovery() {
    return reconcileBranchSelection();
  }

  function isBranchExplicitlySelected() {
    return !!currentBranchSelection();
  }

  /** Evidence for the branch gate decision — no secrets. */
  function branchGateDiagnostics() {
    const w = loadWizard();
    const lic = global.LicenseCloud?.loadLocal?.() || {};
    const discovery = getCachedDiscoveryResult();
    const cfg = global.DeviceConfig?.load?.() || {};
    const selection = currentBranchSelection();
    const eligible = authoritativeBootstrapBranches();
    return {
      at: new Date().toISOString(),
      organizationId: currentOrganizationId(),
      licenseBranches: (lic.branches || []).map((b) => String(b?.id || '')).filter(Boolean),
      discoveryCandidates: (discovery?.branchCandidates || []).map((b) => ({
        id: String(b?.id || ''),
        source: b?.source || null,
        verified: b?.verified === true,
      })),
      localDeviceBranch: String(cfg.lockedBranchId || '') || null,
      wizardBranchSelection: w.branchSelection
        ? { branchId: w.branchSelection.branchId, provenance: w.branchSelection.provenance }
        : null,
      eligibleBranches: eligible.map((b) => ({ id: b.id, source: b.source })),
      eligibleBranchCount: eligible.length,
      selectionProvenance: selection?.provenance || null,
      branchStepResolved: branchStepResolved(),
      reason: selection
        ? `selection_provenance_${selection.provenance}`
        : (eligible.length ? 'explicit_selection_required' : 'no_cloud_authorized_branch'),
    };
  }

  function hasCenterData() {
    const cid = global.CenterId?.getStoredCenterId?.() || global.ConfigLayer?.getCenterId?.()
      || global.LicenseCloud?.loadLocal?.()?.centerId;
    const name = global.settings?.centerName || global.LicenseCloud?.loadLocal?.()?.centerName;
    return !!(cid && name);
  }

  function hasBranch() {
    return authoritativeBootstrapBranches().length > 0;
  }

  function hasDeviceBranch() {
    const cfg = global.DeviceConfig?.load?.();
    return !!(cfg?.lockedBranchId && (cfg?.deviceName || cfg?.deviceUuid));
  }

  /**
   * The branch this device will use.
   *
   * On the EXISTING path this never falls back to "the only branch" —
   * auto-returning a sole branch is what let device registration proceed with a
   * BR-MAIN the operator never chose. On the NEW path the branch is created by
   * the operator inside this journey, so an existing sole branch is itself the
   * product of an explicit action.
   */
  function getSelectedBranchId() {
    const selection = currentBranchSelection();
    if (selection) return selection.branchId;
    if (isExistingCustomerPath()) return '';
    const branches = authoritativeBootstrapBranches();
    return branches.length === 1 ? String(branches[0].id || '') : '';
  }

  /**
   * Cloud-authorized branches only.
   *
   * `discovery.branchCandidates` contains a `data_discovery` entry built from
   * `dataDiscovery.cloud.branchId`, which is an ECHO of local identity
   * (DeviceConfig.lockedBranchId → passed into the Drive scan → returned
   * unchanged). Treating it as a discovered branch let stale local state both
   * invent a branch and inflate the candidate count, so it is accepted only when
   * a cloud license document corroborates it.
   */
  function authoritativeBootstrapBranches(license) {
    license = license || global.LicenseCloud?.loadLocal?.() || {};
    const branchMap = new Map();
    for (const b of (license.branches || []).filter((item) => item && item.active !== false)) {
      const id = String(b.id || '').trim();
      if (!id) continue;
      branchMap.set(id, { id, name: b.name || b.id, source: 'license' });
    }
    const discovery = getCachedDiscoveryResult();
    for (const b of (discovery?.branchCandidates || [])) {
      const id = String(b?.id || b?.branchId || '').trim();
      if (!id) continue;
      if (branchMap.has(id)) continue;
      if (b?.source === 'data_discovery') continue;
      branchMap.set(id, {
        id,
        name: b.name || b.branchName || id,
        source: b.source || 'discovery',
      });
    }
    return Array.from(branchMap.values());
  }

  function populateBootstrapBranchSelect(prefix = 'bf') {
    const lic = global.LicenseCloud?.loadLocal?.() || {};
    const branches = authoritativeBootstrapBranches(lic);
    if (typeof global.populateDriveBootstrapBranchFields === 'function') {
      return global.populateDriveBootstrapBranchFields(lic, prefix, branches);
    }
    const sel = document.getElementById(`${prefix}-branch-id`);
    if (!sel) return branches[0]?.id || '';
    if (!branches.length) {
      sel.innerHTML = '<option value="">— لا فروع —</option>';
      return '';
    }
    sel.innerHTML = branches.map((b) => {
      const id = String(b.id).replace(/"/g, '&quot;');
      return `<option value="${id}">${b.name || b.id}</option>`;
    }).join('');
    return sel.value;
  }

  function readDeviceCommitState() {
    const cfg = global.DeviceConfig?.load?.() || {};
    const lic = global.LicenseCloud?.loadLocal?.() || {};
    const fingerprint = typeof global.licGetFingerprint === 'function' ? global.licGetFingerprint() : '';
    return {
      deviceId: String(cfg.deviceUuid || ''),
      organizationId: String(cfg.centerId || lic.centerId || ''),
      branchId: String(cfg.lockedBranchId || ''),
      deviceName: String(cfg.deviceName || ''),
      fingerprint: String(fingerprint || cfg.deviceFingerprint || ''),
    };
  }

  function deviceStepResolved() {
    if (!hasDeviceBranch()) return false;
    const state = readDeviceCommitState();
    const branchId = getSelectedBranchId() || state.branchId;
    return !!(state.deviceId && state.branchId && state.deviceName
      && (!branchId || state.branchId === branchId));
  }

  function readBusinessSetupState() {
    const BSC = global.BusinessSetupContract;
    const snap = BSC?.readSettingsSnapshot?.() || {
      centerName: String(global.settings?.centerName || '').trim(),
      phone: String(global.settings?.phone || '').trim(),
      address: String(global.settings?.address || '').trim(),
      centerCity: String(global.settings?.centerCity || '').trim(),
      organizationId: String(global.LicenseCloud?.loadLocal?.()?.centerId || '').trim(),
    };
    return {
      centerName: snap.centerName,
      phone: snap.phone,
      address: snap.address || '',
      centerCity: snap.centerCity || '',
      organizationId: snap.organizationId || '',
    };
  }

  function businessSetupStepResolved() {
    const BSC = global.BusinessSetupContract;
    if (BSC?.isResolved) return BSC.isResolved(readBusinessSetupState());
    const snap = readBusinessSetupState();
    return !!(snap.centerName && snap.phone);
  }

  function isExistingCustomerPath() {
    const w = loadWizard();
    return w.path === PATHS.EXISTING || w.forkDecision === 'use_existing';
  }

  function licenseOrgRecoveryResolved() {
    if (!hasValidLicense()) return false;
    if (!hasCenterData()) return false;
    const lic = global.LicenseCloud?.loadLocal?.() || {};
    const centerId = String(lic.centerId || global.CenterId?.getStoredCenterId?.() || '').trim();
    const w = loadWizard();
    const discovery = getCachedDiscoveryResult();
    const selected = w.forkSelectedCandidateId || w.selectedCandidateId;
    if (selected && centerId && selected !== centerId && !String(selected).includes(centerId)) {
      return false;
    }
    if (discovery?.organizationCandidates?.length > 1 && !selected) return false;
    return !!centerId;
  }

  function ownerAuthStepResolved() {
    if (!hasOwnerPasswordAccount()) return false;
    return setupOwnerSessionReady();
  }

  /**
   * "بدء قاعدة جديدة" policy for the EXISTING path.
   *
   * On the existing-customer journey the Owner identity is recovered from the
   * backup (or a cloud pull) — it is never created. Accepting an empty database
   * resolved the restore gate while `owner_auth` still demanded an Owner that
   * only the backup could provide, leaving the wizard in a contradictory state
   * ("لا يوجد مالك مسترد بعد — أكمل الاستعادة أولاً" on a mandatory step).
   * The option is therefore refused while no Owner is recoverable, and the
   * operator is pointed at the paths that can actually produce one.
   */
  function existingEmptyStartPolicy() {
    if (!isExistingCustomerPath()) {
      return { allowed: true, code: null, messageAr: '', reason: 'new_path' };
    }
    if (hasOwnerPasswordAccount()) {
      return { allowed: true, code: null, messageAr: '', reason: 'owner_present' };
    }
    return {
      allowed: false,
      code: 'existing_empty_start_blocked_no_owner',
      reason: 'no_recoverable_owner',
      messageAr: 'لا يمكن البدء بقاعدة فارغة لعميل حالي: حساب المالك يُسترد من النسخة الاحتياطية أو من المزامنة السحابية ولا يُنشأ في هذا المسار. أكمل الاستعادة من السحابة، أو استخدم «تأكيد البيانات الحالية» إذا كانت بيانات هذا الجهاز صحيحة.',
    };
  }

  function existingGatesBeforeSyncSatisfied() {
    if (!isExistingCustomerPath()) return true;
    const ESC = global.ExistingShortPathContract;
    const gates = ESC?.gatesBeforeSyncSatisfied?.({
      wizard: loadWizard(),
      meta: global.DB?.get?.('__tdw_meta__', {}) || {},
      settings: global.settings || {},
    });
    if (gates?.ok === true) return true;
    return businessSetupStepResolved()
      && (publicationStepResolved() || ESC?.minimalPublicationSatisfied?.({ wizard: loadWizard(), meta: global.DB?.get?.('__tdw_meta__', {}) }))
      && (readbackStepResolved() || ESC?.minimalReadbackSatisfied?.({ wizard: loadWizard(), meta: global.DB?.get?.('__tdw_meta__', {}) }))
      && ownerAuthStepResolved();
  }

  function publicationStepResolved() {
    const meta = global.DB?.get?.('__tdw_meta__', {}) || {};
    if (meta.bootstrapCompletedAt) return true;
    if (isExistingCustomerPath() && global.ExistingShortPathContract?.minimalPublicationSatisfied?.({
      meta, wizard: loadWizard(), settings: global.settings,
    })) {
      return true;
    }
    const PC = global.PublicationContract;
    if (PC?.isResolved) {
      return PC.isResolved({ meta, path: loadWizard().path, setupPublication: meta.setupPublication });
    }
    return false;
  }

  function readbackStepResolved() {
    const meta = global.DB?.get?.('__tdw_meta__', {}) || {};
    if (meta.bootstrapCompletedAt) return true;
    if (isExistingCustomerPath() && global.ExistingShortPathContract?.minimalReadbackSatisfied?.({
      meta, wizard: loadWizard(), settings: global.settings,
    })) {
      return true;
    }
    const RVC = global.ReadbackVerificationContract;
    if (RVC?.isVerified) {
      return RVC.isVerified({ meta, readbackVerification: meta.readbackVerification, path: loadWizard().path });
    }
    return false;
  }

  function readPublicationState() {
    const meta = global.DB?.get?.('__tdw_meta__', {}) || {};
    return meta.setupPublication || null;
  }

  /**
   * Branch gate.
   *
   * EXISTING: the older working build completed this step only after the
   * operator clicked to bind the device to a branch — including when exactly one
   * branch existed. A provable current-context selection is therefore always
   * required, regardless of how many branches were recovered.
   *
   * NEW: the branch is created by the operator during this journey, so its
   * existence already carries the explicit action.
   */
  function branchStepResolved() {
    if (!hasBranch()) return false;
    if (isExistingCustomerPath()) return !!currentBranchSelection();
    return !!getSelectedBranchId();
  }

  function hasOwnerPasswordAccount() {
    // Delegate to Single Source of Truth — do not re-implement Owner detection here.
    if (global.OwnerManagement?.getOwnerState) {
      return global.OwnerManagement.getOwnerState().state === 'OWNER_EXISTS';
    }
    const users = global.users || global.DB?.get?.('users', []) || [];
    return users.some((u) => u && u.active !== false
      && ['owner', 'hq_admin'].includes(String(u.role || '').toLowerCase())
      && u.mustChangePassword !== true && u.seedDefaultPassword !== true
      && (u.hasUsableCredential === true
        || /^(?:pbkdf2:|pbkdf2v2:|b64:)/i.test(String(u.password || ''))));
  }

  function ownerSetupRequirementMet() {
    return hasOwnerPasswordAccount();
  }

  function isNewFreshStartPath() {
    const w = loadWizard();
    if (w.path !== PATHS.NEW) return false;
    if (w.forkDecision === 'use_existing') return false;
    return true;
  }

  function ownerCredentialCommitted() {
    return ownerSetupRequirementMet();
  }

  /** Owner step gate: NEW fresh path = credential committed; EXISTING/Use Existing = credential (+ session at sync). */
  function ownerStepResolved() {
    if (!ownerCredentialCommitted()) return false;
    const w = loadWizard();
    if (isNewFreshStartPath()) return true;
    return setupOwnerSessionReady();
  }

  function newBranchRequiresOwner() {
    return isNewFreshStartPath() && !ownerCredentialCommitted();
  }

  function getUsableOwnerAccount() {
    const users = global.users || global.DB?.get?.('users', []) || [];
    return users.find((user) => user
      && user.active !== false
      && /^(?:owner|hq_admin)$/i.test(String(user.role || ''))
      && user.mustChangePassword !== true
      && user.seedDefaultPassword !== true
      && (user.hasUsableCredential === true
        || /^(?:pbkdf2:|pbkdf2v2:|b64:)/i.test(String(user.password || '')))) || null;
  }

  function setupOwnerSessionReady() {
    const owner = getUsableOwnerAccount();
    return !!(owner && String(setupOwnerSessionUserId || '') === String(owner.id));
  }

  async function verifySetupOwnerSession() {
    const owner = getUsableOwnerAccount();
    const rbac = global.cuppingElectron?.rbac || global.tadawi?.rbac;
    if (!owner || !rbac?.getSession) {
      setupOwnerSessionUserId = null;
      return { ok: false, error: owner ? 'rbac_session_unavailable' : 'owner_credential_required' };
    }
    const state = await rbac.getSession();
    const matches = state?.ok
      && String(state.session?.userId) === String(owner.id)
      && /^(?:owner|hq_admin)$/i.test(String(state.session?.role || ''));
    setupOwnerSessionUserId = matches ? owner.id : null;
    return matches ? { ok: true, owner, session: state.session } : { ok: false, error: 'owner_session_required' };
  }

  function hasRestoreDecision() {
    const w = loadWizard();
    if (['empty', 'cloud', 'skip_existing', 'local', 'file'].includes(w.restoreChoice)) return true;
    if (global.BootstrapCoordinator?.metaBootstrapCommitted?.()) return true;
    try {
      const reconcile = global.RestoreReconciliation?.loadState?.();
      if (reconcile?.choice || reconcile?.pullDone) return true;
    } catch { /* read-only */ }
    return false;
  }

  function hasSyncDone() {
    if (global.BootstrapCoordinator?.metaBootstrapCommitted?.()) return true;
    const meta = global.DB?.get?.('__tdw_meta__') || {};
    if (meta.bootstrapCompletedAt) return true;
    const ISC = global.InitialSyncDirectionContract;
    if (ISC?.isInitialSyncResolved) {
      const snap = {
        meta,
        wizard: loadWizard(),
        deviceConfig: global.DeviceConfig?.load?.() || {},
        restoreReconcile: null,
      };
      try { snap.restoreReconcile = global.RestoreReconciliation?.loadState?.(); } catch { /* read-only */ }
      if (ISC.isInitialSyncResolved(snap).ok) return true;
    }
    try {
      const reconcile = global.RestoreReconciliation?.loadState?.();
      if (reconcile?.pullDone === true && reconcile?.pushAllowed === true) return true;
    } catch { /* read-only */ }
    return false;
  }

  function getSetupConnectivityPolicy() {
    return { ...SETUP_CONNECTIVITY_POLICY };
  }

  function buildInitialSyncPlanContext(overrides) {
    const wizard = loadWizard();
    const meta = global.DB?.get?.('__tdw_meta__') || {};
    const deviceConfig = global.DeviceConfig?.load?.() || {};
    let restoreReconcile = null;
    try { restoreReconcile = global.RestoreReconciliation?.loadState?.(); } catch { /* read-only */ }
    let clientsCount = 0;
    let casesCount = 0;
    let bookingsCount = 0;
    try {
      clientsCount = (global.clientsRegistry || []).length;
      casesCount = (global.cases || []).length;
      bookingsCount = (global.bookings || []).length;
    } catch { /* read-only */ }
    return {
      wizard,
      meta,
      deviceConfig,
      path: wizard.path,
      restoreChoice: wizard.restoreChoice,
      organizationId: meta.centerId || deviceConfig.centerId,
      branchId: deviceConfig.lockedBranchId,
      deviceId: deviceConfig.deviceUuid,
      restoreReconcile,
      clientsCount,
      casesCount,
      bookingsCount,
      restoreInProgress: !!(global.CloudDataDiscovery?.isRestoreLocked?.()
        || global.OwnerManagement?.isSystemBusy?.('restore')),
      ...(overrides || {}),
    };
  }

  function initialOperationForChoice(choice) {
    const ISC = global.InitialSyncDirectionContract;
    if (ISC?.resolveInitialSyncPlan) {
      const plan = ISC.resolveInitialSyncPlan(buildInitialSyncPlanContext({ restoreChoice: choice }));
      return ISC.mapPlanToLegacyOperation?.(plan) || 'invalid';
    }
    if (choice === 'empty') return 'push';
    if (choice === 'cloud') return 'pull';
    if (['local', 'file', 'skip_existing'].includes(choice)) return 'reconcile_verified_local';
    return 'invalid';
  }

  function persistInitialSyncResult(ok) {
    const wizard = loadWizard();
    wizard.syncDone = ok === true;
    saveWizard(wizard);
    return wizard.syncDone;
  }

  function persistInitialSyncPlanProgress(plan) {
    if (!plan || !plan.mode || plan.mode === 'NO_SYNC') return null;
    const meta = global.DB?.get?.('__tdw_meta__') || {};
    meta.initialSyncPlan = {
      mode: plan.mode,
      reason: plan.reason,
      sourceAuthority: plan.sourceAuthority,
      allowPush: plan.allowPush === true,
      allowPull: plan.allowPull === true,
      allowOutboxDrain: plan.allowOutboxDrain === true,
      syncEngineDirection: plan.syncEngineDirection,
      operation: plan.operation,
      binding: plan.binding,
      bindingFingerprint: plan.bindingFingerprint,
      startedAt: meta.initialSyncPlan?.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    global.DB?.set?.('__tdw_meta__', meta);
    return meta.initialSyncPlan;
  }

  function persistInitialSyncCompletion(plan, syncResult) {
    const meta = global.DB?.get?.('__tdw_meta__') || {};
    meta.initialSyncCompletion = {
      completedAt: new Date().toISOString(),
      mode: plan.mode,
      reason: plan.reason,
      sourceAuthority: plan.sourceAuthority,
      binding: plan.binding,
      bindingFingerprint: plan.bindingFingerprint,
      syncResultSummary: {
        ok: syncResult?.ok === true,
        direction: plan.syncEngineDirection,
        at: syncResult?.at || new Date().toISOString(),
      },
    };
    delete meta.initialSyncPlan;
    global.DB?.set?.('__tdw_meta__', meta);
    return meta.initialSyncCompletion;
  }

  async function runInitialSyncPipeline() {
    const wizardBeforeSync = loadWizard();
    const planContext = buildInitialSyncPlanContext();
    let syncPlan = global.InitialSyncDirectionContract?.resolveInitialSyncPlan?.(planContext)
      || { mode: 'NO_SYNC', reason: 'sync_plan_invalid', operation: initialOperationForChoice(wizardBeforeSync.restoreChoice) };
    if (syncPlan.mode === 'NO_SYNC' && syncPlan.reason === 'initial_sync_already_resolved') {
      persistInitialSyncResult(true);
      return { ok: true, skipped: true, reason: syncPlan.reason, plan: syncPlan };
    }
    if (syncPlan.mode === 'NO_SYNC') {
      persistInitialSyncResult(false);
      return { ok: false, error: syncPlan.reason || 'sync_plan_invalid', plan: syncPlan };
    }
    if (syncPlan.mode === 'RESUME_PENDING') {
      syncPlan = {
        ...syncPlan,
        mode: syncPlan.resumedMode || (syncPlan.operation === 'push' ? 'PUSH_ONLY' : 'PULL_ONLY'),
        syncEngineDirection: syncPlan.syncEngineDirection || (syncPlan.operation === 'push' ? 'push' : 'pull'),
      };
    }
    persistInitialSyncPlanProgress(syncPlan);
    const verifiedDatabaseRestore = wizardBeforeSync.restoreVerifiedDatabase === true;
    const googleStepCompleted = hasGoogle()
      || (Array.isArray(wizardBeforeSync.completedSteps) && wizardBeforeSync.completedSteps.includes('google'));
    const googleState = await refreshGoogleConnectionState({
      acceptLiveReconnect: googleStepCompleted,
    });
    if (!googleState.connected) {
      persistInitialSyncResult(false);
      return { ok: false, error: googleState.error || 'google_not_connected', googleState };
    }
    const ownerSession = await verifySetupOwnerSession();
    if (!ownerSession.ok) {
      persistInitialSyncResult(false);
      return ownerSession;
    }
    let defaultsResult;
    try {
      defaultsResult = await global.ActivationSyncDefaults?.applyDefaults?.({
        startSync: true,
        startBackup: true,
        acceptLiveReconnect: googleStepCompleted,
      });
    } catch (error) {
      defaultsResult = { ok: false, error: error?.code || error?.message || 'activation_defaults_failed' };
    }
    if (defaultsResult?.ok !== true) {
      persistInitialSyncResult(false);
      return { ok: false, error: defaultsResult?.error || defaultsResult?.reason || 'activation_defaults_failed' };
    }

    const ready = global.SyncEngine?.getReadiness?.({ force: true });
    if (ready && !ready.ready) {
      persistInitialSyncResult(false);
      return { ok: false, error: ready.error || ready.state || 'sync_not_ready', readiness: ready };
    }

    const restoreChoice = loadWizard().restoreChoice;
    const operation = global.InitialSyncDirectionContract?.mapPlanToLegacyOperation?.(syncPlan)
      || initialOperationForChoice(restoreChoice);
    let syncResult;
    if (operation === 'reconcile_verified_local') {
      const reconcileState = global.RestoreReconciliation?.loadState?.();
      syncResult = reconcileState?.pullDone === true && reconcileState?.pushAllowed === true
        ? { ok: true, reconciled: true, state: reconcileState }
        : { ok: false, error: 'local_reconcile_required', state: reconcileState || null };
    } else if (['push', 'pull'].includes(operation) && global.SyncEngine?.runOnce) {
      if (!global.SyncEngine.isRunning?.()) {
        global.SyncEngine.start?.({ pollIntervalMs: global.SyncState?.load?.()?.pollIntervalMs });
      }
      const direction = syncPlan.syncEngineDirection || operation;
      if (direction === 'pull' && syncPlan.allowPush === false && syncPlan.allowPull !== true) {
        syncResult = { ok: false, error: 'sync_plan_invalid', plan: syncPlan };
      } else if (direction === 'push' && syncPlan.allowPull === false && syncPlan.allowPush !== true) {
        syncResult = { ok: false, error: 'sync_plan_invalid', plan: syncPlan };
      } else if (direction === 'push' && syncPlan.emptyLocalPushBlocked === true) {
        syncResult = { ok: false, error: 'sync_post_restore_blocked', plan: syncPlan };
      } else {
        syncResult = await global.SyncEngine.runOnce({
          force: true,
          direction,
          initialSyncPlan: syncPlan,
          allowOutboxDrain: syncPlan.allowOutboxDrain === true,
          bootstrapInitialSync: true,
        });
        if (direction === 'pull' && syncPlan.allowPush === false && syncResult?.push && syncResult.push.skipped !== true) {
          const pushAttempted = syncResult.push.ok === true || (syncResult.push.error && syncResult.push.reason !== 'direction_pull_only');
          if (pushAttempted && syncResult.push.reason !== 'direction_pull_only') {
            syncResult = { ok: false, error: 'sync_push_blocked_pull_only', plan: syncPlan, pull: syncResult.pull, push: syncResult.push };
          }
        }
        if (direction === 'push' && syncPlan.allowPull === false && syncResult?.pull && syncResult.pull.skipped !== true) {
          const pullAttempted = syncResult.pull.ok === true || (syncResult.pull.error && syncResult.pull.reason !== 'direction_push_only');
          if (pullAttempted && syncResult.pull.reason !== 'direction_push_only') {
            syncResult = { ok: false, error: 'sync_pull_blocked_push_only', plan: syncPlan, pull: syncResult.pull, push: syncResult.push };
          }
        }
      }
    } else if (operation === 'pull' && global.CloudBootstrap?.hydrateFromDrive) {
      syncResult = await global.CloudBootstrap.hydrateFromDrive(null, { allowMissingLicense: true });
    } else {
      syncResult = { ok: false, error: operation === 'invalid' ? 'restore_choice_required' : 'sync_runtime_unavailable' };
    }
    if (syncResult?.ok !== true) {
      persistInitialSyncResult(false);
      return { ok: false, error: syncResult?.error || syncResult?.reason || syncResult?.message || 'initial_sync_failed', syncResult };
    }

    const bootstrap = await global.ensureCloudBootstrapReady?.();
    if (!bootstrap) {
      persistInitialSyncResult(false);
      return { ok: false, error: 'bootstrap_unavailable' };
    }
    const branchId = global.DeviceConfig?.load?.()?.lockedBranchId;
    let bootResult;
    if (operation === 'pull' && verifiedDatabaseRestore && bootstrap.markBootstrapComplete) {
      // Backup V2 already restored and verified the complete authoritative
      // SQLite database. The operation-log pull above reconciles newer records;
      // running the legacy full-config bootstrap again can fail on optional
      // historical files and must not overwrite the restored database.
      bootstrap.markBootstrapComplete(branchId);
      bootResult = { ok: true, mode: 'verified_backup_v2_reconcile', localDataPreserved: true };
    } else if (operation === 'pull') {
      if (!bootstrap.runNewDeviceBootstrap) {
        persistInitialSyncResult(false);
        return { ok: false, error: 'bootstrap_unavailable' };
      }
      bootResult = await bootstrap.runNewDeviceBootstrap({
        branchId,
        startSync: true,
        allowMissingLicense: true
      });
    } else if (bootstrap.markBootstrapComplete) {
      bootstrap.markBootstrapComplete(branchId);
      bootResult = { ok: true, mode: operation, localDataPreserved: operation === 'reconcile_verified_local' };
    } else {
      bootResult = { ok: false, error: 'bootstrap_completion_unavailable' };
    }
    if (bootResult?.ok !== true) {
      persistInitialSyncResult(false);
      return { ok: false, error: bootResult?.error || bootResult?.reason || 'device_bootstrap_failed', bootResult };
    }
    if (!ownerSetupRequirementMet()) {
      persistInitialSyncResult(false);
      return { ok: false, error: 'owner_credential_required' };
    }

    persistInitialSyncCompletion(syncPlan, syncResult);
    persistInitialSyncResult(true);
    return { ok: true, defaultsResult, syncResult, bootResult, plan: syncPlan };
  }

  const __stage3BootTrace = {
    evaluateReadyCalls: 0,
    autoBootOpenCalls: 0,
    loginInitCalls: 0,
    bootVisibilityEvents: 0,
    lastAutoBootBlockedReason: null,
  };

  function traceEvaluateReady() {
    __stage3BootTrace.evaluateReadyCalls += 1;
    return global.SetupStateService?.evaluateReady?.({ ignoreRestart: true });
  }

  function isDeviceReadyAuthoritative() {
    const evaluation = traceEvaluateReady();
    return !!(evaluation && evaluation.ready === true);
  }

  function isBootComplete() {
    const evaluation = traceEvaluateReady();
    if (evaluation && typeof evaluation.ready === 'boolean') {
      if (!evaluation.ready) {
        try { localStorage.removeItem(BOOT_DONE_KEY); } catch { /* empty */ }
      }
      return evaluation.ready;
    }
    const base = hasGoogle() && hasValidLicense() && hasCenterData() && hasDeviceBranch()
      && businessSetupStepResolved() && publicationStepResolved() && hasRestoreDecision() && ownerSetupRequirementMet() && hasSyncDone();
    if (!base) {
      try { localStorage.removeItem(BOOT_DONE_KEY); } catch { /* empty */ }
      return false;
    }
    return true;
  }

  async function markBootComplete() {
    if (!isBootComplete()) return false;
    try {
      const durable = await global.SetupStateService?.markBootCompleteDurable?.();
      if (!durable || durable.ok !== true) {
        try { localStorage.removeItem(BOOT_DONE_KEY); } catch { /* empty */ }
        return false;
      }
      global.AuditLogger?.logSyncEvent?.('BOOTSTRAP', { summary: 'V2-5.9 activation wizard complete' });
      return true;
    } catch {
      try { localStorage.removeItem(BOOT_DONE_KEY); } catch { /* empty */ }
      return false;
    }
  }

  function needsBootScreen() {
    if (isDeviceReadyAuthoritative()) return false;
    // Delegate to SetupStateService (via SetupStateDom) as sole SoT.
    if (global.SetupStateDom?.needsBootFlow) return global.SetupStateDom.needsBootFlow();
    const ss = global.SetupStateService?.getState?.({ ignoreRestart: true });
    if (ss && typeof ss.needsBootFlow === 'boolean') return !!ss.needsBootFlow;
    if (bootDonePersisted() && isBootComplete()) return false;
    if (ss?.state === 'READY') return false;
    return !isBootComplete();
  }

  function bootDonePersisted() {
    try { return localStorage.getItem(BOOT_DONE_KEY) === '1'; } catch { return false; }
  }

  /**
   * Call once on app startup after relaunch — consume restart marker and never reopen Ready.
   */
  function onAppStartupAfterRelaunch() {
    const consumed = global.SetupStateService?.consumeRestartMarker?.()
      || (() => {
        try {
          if (localStorage.getItem(RESTART_REQUIRED_KEY)) {
            localStorage.removeItem(RESTART_REQUIRED_KEY);
            localStorage.setItem(BOOT_DONE_KEY, '1');
            return { consumed: true, loopDetected: false };
          }
        } catch { /* empty */ }
        return { consumed: false };
      })();
    if (consumed?.loopDetected) {
      global.notify?.('⚠️ حلقة إعادة تشغيل مكتشفة — راجع Diagnostic في أدوات الدعم', 'danger');
    }
    if (consumed?.consumed && isBootComplete()) {
      clearTransientBootstrapState();
      close({ showLogin: true });
      applyLoginGate();
      applyOperationalGuard();
    } else if (needsBootScreen()) {
      prepareBootstrapResume({ showResumeHint: false });
      applyOperationalGuard();
    }
    return consumed;
  }

  function shouldAutoOpenBoot() {
    try {
      const bootParam = new URLSearchParams(global.location?.search || '').get('boot');
      if (bootParam === '0') return false;
      if (bootParam === '1' || bootParam === 'force') return true;
    } catch { /* empty */ }
    if (isDeviceReadyAuthoritative()) {
      __stage3BootTrace.lastAutoBootBlockedReason = 'ready_authoritative';
      return false;
    }
    return needsBootScreen() && !global.currentUser;
  }

  /**
   * Stage 3 startup gate — evaluate READY before any automatic BootFlow open.
   */
  function maybeAutoOpenBootFlow() {
    __stage3BootTrace.loginInitCalls += 1;
    ensureLoginAccessible();
    prepareBootstrapResume({ showResumeHint: false });
    const tryOpen = (attempt) => {
      if (!shouldAutoOpenBoot()) {
        updateLoginSetupHint();
        applyLoginGate();
        return false;
      }
      __stage3BootTrace.autoBootOpenCalls += 1;
      __stage3BootTrace.bootVisibilityEvents += 1;
      ensureDOM();
      openOverlay(true);
      const overlay = document.getElementById('bootFlowOverlay');
      const isOpen = overlay?.classList.contains('open');
      if (!isOpen && attempt < 4) {
        setTimeout(() => tryOpen(attempt + 1), 120 * (attempt + 1));
        return true;
      }
      if (!isOpen) {
        updateLoginSetupHint();
        applyLoginGate();
      }
      return isOpen;
    };
    return tryOpen(0);
  }

  function canShowLogin() {
    return isBootComplete();
  }

  function canOpenDashboard() {
    return isBootComplete() && !!global.currentUser;
  }

  function getCachedDiscoveryResult() {
    return global.PostGoogleCloudDiscovery?.getCachedDiscovery?.() || null;
  }

  function needsPathForkDecision() {
    const w = loadWizard();
    if (w.path !== PATHS.NEW) return false;
    const PG = global.PostGoogleCloudDiscovery;
    const discovery = getCachedDiscoveryResult();
    if (!discovery?.ok) return false;
    const classification = discovery.forkClassification || PG?.classifyForkScenario?.(discovery);
    return !!(PG?.requiresPathFork?.(classification));
  }

  function hasPathDecisionResolved() {
    const w = loadWizard();
    if (w.path === PATHS.EXISTING && w.forkDecision === 'use_existing') {
      return global.PostGoogleCloudDiscovery?.isForkDecisionValid?.(w) === true;
    }
    if (w.path === PATHS.NEW) {
      if (!needsPathForkDecision()) return hasDiscoveryResolved();
      if (w.forkDecision === 'start_new' && global.PostGoogleCloudDiscovery?.isForkDecisionValid?.(w)) {
        return true;
      }
      return false;
    }
    return !needsPathForkDecision();
  }

  function forkCandidateList(discovery) {
    discovery = discovery || getCachedDiscoveryResult();
    if (!discovery) return [];
    const orgs = discovery.organizationCandidates || [];
    if (orgs.length) return orgs;
    return discovery.licenseCandidates || [];
  }

  function commitForkStartNew() {
    const w = loadWizard();
    const discovery = getCachedDiscoveryResult();
    const PG = global.PostGoogleCloudDiscovery;
    w.forkDecision = 'start_new';
    w.forkDecisionAt = new Date().toISOString();
    w.pathDecisionResolvedAt = w.forkDecisionAt;
    w.forkGoogleAccountKey = global.settings?.backup?.providers?.google?.email?.toLowerCase?.() || null;
    w.forkDiscoveryFingerprint = PG?.discoveryFingerprint?.(discovery) || null;
    w.path = PATHS.NEW;
    const steps = NEW_STEPS;
    const forkIdx = steps.indexOf('path_decision');
    if (!w.completedSteps.includes('path_decision')) w.completedSteps.push('path_decision');
    if (forkIdx >= 0 && w.currentStep <= forkIdx) w.currentStep = forkIdx + 1;
    saveWizard(w);
    console.info('[BootFlow] fork_decision_start_new', {
      activationRetained: hasValidLicense(),
      note: 'NEW activation remains consumed locally; not re-applied to existing business',
    });
    return { ok: true, forkDecision: 'start_new', path: PATHS.NEW };
  }

  function commitForkUseExisting(candidateId) {
    const w = loadWizard();
    const discovery = getCachedDiscoveryResult();
    const PG = global.PostGoogleCloudDiscovery;
    const candidates = forkCandidateList(discovery);
    const classification = discovery?.forkClassification || PG?.classifyForkScenario?.(discovery);
    if (PG?.requiresPathFork?.(classification) && candidates.length > 1 && !candidateId) {
      return { ok: false, error: 'candidate_selection_required' };
    }
    const chosen = candidateId
      || w.forkSelectedCandidateId
      || discovery?.selectedOrUniqueCandidate?.id
      || (candidates.length === 1 ? candidates[0].id : null);
    if (PG?.requiresPathFork?.(classification) && candidates.length > 1 && !chosen) {
      return { ok: false, error: 'candidate_selection_required' };
    }
    w.forkDecision = 'use_existing';
    w.forkDecisionAt = new Date().toISOString();
    w.pathDecisionResolvedAt = w.forkDecisionAt;
    w.forkGoogleAccountKey = global.settings?.backup?.providers?.google?.email?.toLowerCase?.() || null;
    w.forkDiscoveryFingerprint = PG?.discoveryFingerprint?.(discovery) || null;
    if (chosen) {
      w.forkSelectedCandidateId = chosen;
      w.selectedCandidateId = chosen;
    }
    w.path = PATHS.EXISTING;
    const exSteps = EXISTING_STEPS;
    const recoveryIdx = exSteps.indexOf('license_org_recovery');
    w.currentStep = recoveryIdx >= 0 ? recoveryIdx : 3;
    ['language', 'google', 'discovery', 'path_decision'].forEach((step) => {
      if (!w.completedSteps.includes(step)) w.completedSteps.push(step);
    });
    saveWizard(w);
    console.info('[BootFlow] fork_decision_use_existing', {
      path: PATHS.EXISTING,
      candidateId: chosen || null,
      activationState: 'retained-until-existing-license-recovery',
      noOrgOwnerBranchCreate: true,
    });
    return { ok: true, forkDecision: 'use_existing', path: PATHS.EXISTING, candidateId: chosen || null };
  }

  function hasDiscoveryResolved() {
    return !!(global.PostGoogleCloudDiscovery?.hasDiscoveryResolved?.()
      || loadWizard().discoveryCompletedAt);
  }

  function validateStep(step) {
    const w = loadWizard();
    const isExisting = w.path === PATHS.EXISTING || w.forkDecision === 'use_existing';
    switch (step) {
      case 'language': return !!(loadWizard().lang);
      case 'google': return hasGoogle();
      case 'discovery': return hasDiscoveryResolved();
      case 'path_decision': return hasPathDecisionResolved();
      case 'license': return hasValidLicense();
      case 'license_org_recovery': return licenseOrgRecoveryResolved();
      case 'organization': return isExisting ? licenseOrgRecoveryResolved() : hasCenterData();
      case 'owner': return ownerStepResolved();
      case 'owner_auth': return ownerAuthStepResolved();
      case 'branch': {
        if (newBranchRequiresOwner()) return false;
        return branchStepResolved();
      }
      case 'branch_select': return branchStepResolved();
      case 'device': return deviceStepResolved();
      case 'business_setup': {
        if (!deviceStepResolved()) return false;
        return businessSetupStepResolved();
      }
      case 'publication': {
        if (!businessSetupStepResolved()) return false;
        return publicationStepResolved() && readbackStepResolved();
      }
      case 'restore': {
        if (!deviceStepResolved()) return false;
        const wRestore = loadWizard();
        if (wRestore.path === PATHS.NEW) {
          if (!businessSetupStepResolved()) return false;
          if (!publicationStepResolved()) return false;
          if (!readbackStepResolved()) return false;
        }
        return hasRestoreDecision();
      }
      case 'sync': {
        if (!deviceStepResolved()) return false;
        if (isExisting) {
          if (!hasRestoreDecision()) return false;
          if (!ownerAuthStepResolved()) return false;
        } else {
          if (!businessSetupStepResolved()) return false;
          if (!publicationStepResolved()) return false;
          if (!readbackStepResolved()) return false;
        }
        return hasSyncDone();
      }
      case 'ready': return isBootComplete();
      default: return false;
    }
  }

  function completeCurrentStep(w) {
    w = w || loadWizard();
    const steps = stepsFor(w.path);
    const step = steps[w.currentStep];
    if (!w.completedSteps.includes(step)) w.completedSteps.push(step);
    delete w.reviewStepIndex;
    if (w.currentStep < steps.length - 1) w.currentStep += 1;
    return saveWizard(w);
  }

  function hideBlockingScreens() {
    document.getElementById('licenseScreen')?.classList.add('hidden');
    document.getElementById('devContactModal')?.classList.remove('open');
    if (typeof global.CenterSetupUI?.close === 'function') global.CenterSetupUI.close();
  }

  function injectStyles() {
    const styleId = 'boot-flow-styles-v260';
    let s = document.getElementById(styleId);
    if (!s) {
      s = document.createElement('style');
      s.id = styleId;
      document.head.appendChild(s);
      ['boot-flow-styles-v258', 'boot-flow-styles-v259'].forEach((id) => {
        document.getElementById(id)?.remove();
      });
    }
    s.textContent = `
.bf-overlay{position:fixed;inset:0;inset-inline:0;z-index:100030;background:linear-gradient(145deg,#1a2f42,#2c4159);display:none;place-items:center;box-sizing:border-box;padding-block:clamp(24px,5vh,48px);padding-inline:clamp(16px,3vw,32px);overflow:auto;overscroll-behavior:contain;direction:rtl}
.bf-overlay.open{display:grid;align-items:flex-start;justify-items:stretch;justify-content:center}
.bf-card,.bf-card.modal-shell{position:relative;z-index:1;width:min(960px,calc(100vw - 24px));max-width:min(960px,calc(100vw - 24px));max-height:calc(100dvh - (2 * clamp(24px,5vh,48px)));display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:var(--card,#fff);border-radius:var(--tdw-radius-lg,16px);border:1px solid rgba(255,255,255,.12);box-shadow:0 24px 64px rgba(0,0,0,.35);pointer-events:auto;overflow:hidden;min-height:0;box-sizing:border-box;margin-inline:auto;inset-inline:auto;transform:none;left:auto;right:auto}
.bf-card-header{flex:0 0 auto;padding:14px clamp(12px,3vw,20px) 8px;position:relative;min-height:0;border-bottom:1px solid var(--border,#e5e7eb);background:var(--card,#fff)}
.bf-card-body{min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;padding:0 clamp(12px,3vw,20px) 12px;-webkit-overflow-scrolling:touch;max-width:100%}
.bf-card-footer{flex-shrink:0;padding:10px 20px 14px;border-top:1px solid var(--border,#e5e7eb);background:var(--card,#fff);display:grid;gap:8px;position:sticky;bottom:0;z-index:3}
.bf-card h1{margin:0 0 6px;font-size:clamp(1.05rem,2.2vw,1.35rem);font-weight:900;color:var(--primary,#3D5A80);text-align:center}
.bf-card>p,.bf-lead{margin:0 0 10px;font-size:13px;color:var(--text-muted,#666);text-align:center;line-height:1.6}
.bf-progress{display:flex;gap:4px;margin-bottom:8px;justify-content:center;flex-wrap:nowrap;overflow-x:auto;max-height:16px}
.bf-dot{width:10px;height:10px;border-radius:50%;background:var(--border,#ccc);flex:0 0 auto}
.bf-dot.done{background:#2d7a5f}
.bf-dot.current{background:var(--primary,#3D5A80);transform:scale(1.2)}
.bf-dot.failed{background:var(--tdw-color-danger-600,#a94045)}
.tdw-stepper.bf-stepper{display:flex;flex-wrap:nowrap;gap:4px;overflow-x:auto;overflow-y:hidden;max-height:2.75rem;padding-bottom:4px}
.tdw-stepper.bf-stepper>li{flex:1 0 auto;min-width:4.5rem;max-width:7rem;font-size:11px;text-align:center;padding:6px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-block-end:3px solid var(--tdw-color-neutral-300,#cbd5e1)}
.tdw-stepper.bf-stepper>li[data-state="done"]{border-color:#2d7a5f;color:#2d7a5f}
.tdw-stepper.bf-stepper>li[data-state="failed"]{border-color:var(--tdw-color-danger-600);color:var(--tdw-color-danger-600)}
.tdw-stepper.bf-stepper>li[aria-current="step"]{border-color:var(--tdw-color-accent-500,#2f8f83);color:var(--tdw-color-primary-700)}
.bf-checklist-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;align-items:start;width:100%;max-width:100%}
@media (min-width:900px){.bf-checklist-layout{grid-template-columns:minmax(14rem,17rem) minmax(0,1fr)}}
.bf-checklist-panel{border:1px solid var(--border,#e5e7eb);border-radius:12px;background:var(--surface,#f8fafc);padding:10px;max-height:min(58vh,480px);overflow:auto;min-width:0}
.bf-checklist-progress{display:grid;gap:6px;margin-bottom:10px}
.bf-checklist-bar{height:6px;border-radius:999px;background:var(--border,#e5e7eb);overflow:hidden}
.bf-checklist-bar>i{display:block;height:100%;width:0;background:var(--tdw-color-accent-500,#2f8f83);transition:width .2s}
.bf-checklist-pct{font-size:11px;color:var(--text-muted,#64748b);text-align:center}
.bf-checklist-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.bf-checklist-item{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:start;padding:8px;border-radius:10px;border:1px solid transparent}
.bf-checklist-item[data-status="done"]{background:#f0fdf4;border-color:#bbf7d0}
.bf-checklist-item[data-status="required"]{background:#eff6ff;border-color:#bfdbfe}
.bf-checklist-item[data-status="progress"]{background:#fffbeb;border-color:#fde68a}
.bf-checklist-item[data-status="error"]{background:#fef2f2;border-color:#fecaca}
.bf-checklist-item[data-status="user-action"]{background:#fff7ed;border-color:#fed7aa}
.bf-checklist-item[data-status="fatal"]{background:#450a0a;border-color:#7f1d1d;color:#fecaca}
.bf-checklist-item[data-status="cancelled"]{background:#f8fafc;border-color:#e2e8f0}
.bf-checklist-item[data-status="future"]{opacity:.72}
.bf-checklist-item[aria-current="step"]{box-shadow:0 0 0 1px var(--tdw-color-accent-500,#2f8f83)}
.bf-checklist-icon{width:1.25rem;text-align:center;font-weight:900;line-height:1.2}
.bf-checklist-label{font-size:12px;font-weight:800;line-height:1.5;overflow-wrap:anywhere}
.bf-checklist-badge{font-size:10px;font-weight:800;padding:2px 6px;border-radius:999px;background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);white-space:nowrap}
.bf-checklist-item[data-status="done"] .bf-checklist-badge{color:#166534}
.bf-checklist-item[data-status="required"] .bf-checklist-badge{color:#1d4ed8}
.bf-checklist-item[data-status="progress"] .bf-checklist-badge{color:#b45309}
.bf-checklist-item[data-status="error"] .bf-checklist-badge{color:#b91c1c}
.bf-checklist-item[data-status="user-action"] .bf-checklist-badge{color:#c2410c}
.bf-checklist-item[data-status="fatal"] .bf-checklist-badge{color:#fecaca}
.bf-checklist-item[data-status="cancelled"] .bf-checklist-badge{color:#64748b}
.bf-checklist-error{grid-column:1/-1;font-size:11px;color:var(--tdw-color-danger-600,#a94045);line-height:1.5}
.bf-checklist-item[data-status="fatal"] .bf-checklist-error{color:#fecaca}
.bf-checklist-item[data-status="cancelled"] .bf-checklist-error{color:#64748b}
.bf-checklist-code{opacity:.75;font-size:10px}
.bf-checklist-retry{grid-column:1/-1;margin-top:4px}
.bf-checklist-main{min-width:0;max-width:100%;overflow-x:hidden}
.bf-step-content{min-height:60px;max-width:100%;overflow-x:hidden}
.bf-step-content .form-control,.bf-step-content select,.bf-step-content input{max-width:100%;box-sizing:border-box}
.bf-step-meta{font-size:12px;color:var(--text-muted);text-align:center;margin-bottom:6px}
.bf-step-hint{font-size:12px;color:var(--primary);background:var(--surface,#f4f6f8);border:1px solid var(--border,#ddd);border-radius:10px;padding:10px 12px;margin-bottom:12px;line-height:1.7}
.bf-actions{display:flex;flex-wrap:wrap;gap:10px;margin:0;width:100%}
.bf-actions:empty{display:none}
.bf-actions .btn{flex:1 1 11rem;min-width:min(100%,11rem);min-height:44px;white-space:normal;text-align:center}
.bf-choice-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:10px;margin-top:12px}
.bf-choice-actions .btn{width:100%;min-height:44px;white-space:normal;text-align:center}
.bf-nav-row{display:flex;gap:8px;flex-wrap:wrap}
.bf-nav-row .btn{flex:1 1 0;min-width:0;min-height:44px;white-space:nowrap}
.bf-status{margin-top:8px;font-size:12px;color:var(--text-muted);min-height:18px;text-align:center;line-height:1.5}
.bf-status-error{color:var(--tdw-color-danger-600,#a94045);font-weight:700}
.bf-choices{display:grid;gap:12px}
.bf-choice{padding:16px;border-radius:14px;border:2px solid var(--border,#ddd);background:var(--surface,#f8f9fa);cursor:pointer;text-align:inherit;width:100%}
.bf-choice h3{margin:0 0 6px;font-size:16px;font-weight:900;color:var(--primary)}
.bf-choice p{margin:0;font-size:12px;color:var(--text-muted)}
.bf-step{display:none}.bf-step.active{display:block}
.bf-close-btn{position:absolute;top:8px;inset-inline-start:8px;width:40px;height:40px;border-radius:10px;border:1px solid var(--border);background:var(--surface);cursor:pointer;z-index:2}
.bf-lang-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.bf-lang-row .btn{min-width:0;min-height:44px}
.tdw-password-row{display:flex;gap:8px;align-items:center}
.tdw-password-row .form-control{flex:1;min-width:0}
.tdw-field-error{color:var(--tdw-color-danger-600,#a94045);font-size:12px;margin-top:4px;font-weight:700}
.ocf-form .form-group{margin-bottom:12px}
.bf-support{margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}
.bf-support-title{font-size:13px;font-weight:900;text-align:center;margin-bottom:8px}
body.bf-active #login-drive-bootstrap-panel,
body.bf-active #lic-drive-bootstrap-panel{display:none!important}
body.bf-active #licenseScreen:not(.hidden){z-index:100040!important}
body.bf-active #cloudConnectModal.open{z-index:100039!important}
body.bf-active #ops-ux-restore-wizard{z-index:100050!important}
.bf-source-card{border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:12px 14px;background:var(--surface,#f8fafc);display:grid;gap:6px;text-align:start}
.bf-source-card[data-status="ready"]{border-color:#86efac;background:#f0fdf4}
.bf-source-card[data-status="not_found"],.bf-source-card[data-status="offline"],.bf-source-card[data-status="timeout"]{border-color:#fcd34d;background:#fffbeb}
.bf-source-card[data-status="error"],.bf-source-card[data-status="token_expired"]{border-color:#fca5a5;background:#fef2f2}
.bf-source-card h4{margin:0;font-size:14px}
.bf-source-meta{font-size:12px;color:var(--text-muted,#64748b);line-height:1.6;dir:rtl}
.bf-source-meta code{font-size:11px}
.bf-cloud-backup-list{display:grid;gap:6px;margin-top:6px}
.bf-cloud-backup-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px;border:1px solid var(--border,#e5e7eb);border-radius:9px;background:var(--card,#fff)}
.bf-cloud-backup-row[data-selected="true"]{border-color:var(--primary,#3D5A80);box-shadow:0 0 0 1px var(--primary,#3D5A80)}
.bf-cloud-backup-row .bf-cloud-backup-label{min-width:0;font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.bf-restore-progress{margin-top:10px;border:1px solid var(--border);border-radius:10px;padding:10px;background:#fff}
.bf-restore-progress .bar{height:8px;background:#e5e7eb;border-radius:999px;overflow:hidden}
.bf-restore-progress .bar>i{display:block;height:100%;width:0;background:#3D5A80;transition:width .2s}
@keyframes bf-indeterminate{from{opacity:.35}to{opacity:.85}}
@media (max-height:720px){.bf-card-header{padding-top:10px}.bf-card h1{font-size:1.05rem}}
@media (max-width:1024px){.bf-overlay{padding-inline:clamp(12px,2.5vw,24px)}.bf-card,.bf-card.modal-shell{width:min(960px,calc(100vw - 20px));max-width:calc(100vw - 20px)}.bf-checklist-layout{grid-template-columns:minmax(0,1fr)}}
@media (max-width:640px){.bf-nav-row{display:grid;grid-template-columns:1fr 1fr}.tdw-stepper.bf-stepper>li{min-width:3.25rem;max-width:5rem;font-size:10px}.bf-checklist-panel{max-height:none}}
@media (max-width:420px){.bf-overlay{padding-inline:10px}.bf-card{width:100%;max-width:100%}.bf-nav-row{grid-template-columns:1fr}.bf-actions .btn,.bf-choice-actions .btn{font-size:13px;white-space:normal;overflow-wrap:anywhere}}
@media (min-resolution:1.5dppx) and (max-width:1100px){.bf-actions .btn,.bf-nav-row .btn{min-height:48px;font-size:13px;white-space:normal}.bf-card{width:min(960px,calc(100vw - 20px))}}
`;
  }

  function wirePathChoiceHandlers(el) {
    const newBtn = el?.querySelector?.('#bf-new-customer');
    const existingBtn = el?.querySelector?.('#bf-existing-customer');
    if (newBtn) newBtn.onclick = () => startPath(PATHS.NEW);
    if (existingBtn) existingBtn.onclick = () => startPath(PATHS.EXISTING);
  }

  function ensureDOM() {
    injectStyles();
    let el = document.getElementById('bootFlowOverlay');
    if (el) {
      // Upgrade if missing shell parts or actions still inside scroll body
      const actionsInFooter = !!el.querySelector('.bf-card-footer #bf-step-actions');
      if (!el.querySelector('.bf-card-body') || !actionsInFooter || !el.querySelector('#bf-checklist-list')) {
        el.remove();
        el = null;
      }
    }
    if (el) {
      wirePathChoiceHandlers(el);
      return;
    }
    el = document.createElement('div');
    el.id = 'bootFlowOverlay';
    el.className = 'bf-overlay';
    el.setAttribute('role', 'presentation');
    el.innerHTML = `
      <div class="bf-card modal-shell tdw-modal tdw-modal--wizard" role="dialog" aria-modal="true" aria-labelledby="bf-main-title" id="bf-dialog">
        <header class="bf-card-header modal-header">
          <button type="button" class="bf-close-btn" id="bf-close-btn" title="إغلاق" aria-label="إغلاق">✕</button>
          <div id="bf-step-choose" class="bf-step active">
            <h1 id="bf-main-title">مرحباً بك</h1>
            <p class="bf-lead">رحلة إعداد موحّدة — لا يمكن تخطي الخطوات المطلوبة</p>
          </div>
          <div id="bf-step-wizard" class="bf-step">
            <h1 id="bf-wizard-title">الإعداد</h1>
            <ul class="tdw-stepper bf-stepper" id="bf-stepper" aria-label="خطوات الإعداد" hidden></ul>
            <div class="bf-progress" id="bf-progress" aria-hidden="true" hidden></div>
          </div>
        </header>
        <section class="bf-card-body modal-body">
          <div id="bf-step-choose-body" class="bf-step active">
            <div class="bf-choices">
              <button type="button" class="bf-choice" id="bf-new-customer">
                <h3>🆕 عميل جديد</h3>
                <p>ربط Google ثم التفعيل وإنشاء أول فرع</p>
              </button>
              <button type="button" class="bf-choice" id="bf-existing-customer">
                <h3>☁️ عميل حالي / جهاز جديد</h3>
                <p>ربط Google وسحب الترخيص واختيار فرع موجود ثم الاستعادة</p>
              </button>
            </div>
          </div>
          <div id="bf-wizard-body" class="bf-step">
            <div class="bf-checklist-layout">
              <aside class="bf-checklist-panel" id="bf-checklist-panel" aria-label="قائمة خطوات الإعداد">
                <div class="bf-checklist-progress">
                  <div class="bf-checklist-bar" aria-hidden="true"><i id="bf-checklist-bar-fill"></i></div>
                  <div class="bf-checklist-pct" id="bf-checklist-pct" aria-live="polite"></div>
                </div>
                <ul class="bf-checklist-list" id="bf-checklist-list" role="list"></ul>
              </aside>
              <div class="bf-checklist-main">
                <div class="bf-step-meta" id="bf-step-meta"></div>
                <p id="bf-step-label" style="font-weight:800;text-align:center"></p>
                <div class="bf-step-hint" id="bf-step-hint"></div>
                <div class="bf-step-content" id="bf-step-content"></div>
                <div class="bf-status" id="bf-wizard-status" role="status" aria-live="polite"></div>
              </div>
            </div>
          </div>
          <div id="bf-support-host"></div>
        </section>
        <footer class="bf-card-footer modal-footer">
          <div class="bf-actions modal-actions" id="bf-step-actions"></div>
          <div class="bf-nav-row" id="bf-step-nav"></div>
        </footer>
      </div>`;
    document.body.appendChild(el);
    wirePathChoiceHandlers(el);
    el.querySelector('#bf-close-btn')?.addEventListener('click', () => dismissBootstrap());
    el.addEventListener('keydown', onDialogKeydown);
  }

  function onDialogKeydown(ev) {
    if (ev.key === 'Escape') {
      // Safe close only when not in critical in-flight
      if (oauthInFlight || licenseActivateInFlight || branchCreateInFlight || branchBindInFlight || ownerLoginInFlight || ownerCreateInFlight() || restoreInFlight || syncInFlight) {
        setStatus('⚠️ عملية جارية — انتظر أو أكمل قبل الإغلاق', true);
        ev.preventDefault();
        return;
      }
      dismissBootstrap();
      return;
    }
    if (ev.key !== 'Tab') return;
    const dialog = document.getElementById('bf-dialog');
    if (!dialog || !document.getElementById('bootFlowOverlay')?.classList.contains('open')) return;
    const focusables = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((n) => !n.disabled && n.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      last.focus();
      ev.preventDefault();
    } else if (!ev.shiftKey && document.activeElement === last) {
      first.focus();
      ev.preventDefault();
    }
  }

  function showStep(id) {
    document.querySelectorAll('#bootFlowOverlay .bf-step').forEach((s) => s.classList.remove('active'));
    if (id === 'bf-step-choose') {
      document.getElementById('bf-step-choose')?.classList.add('active');
      document.getElementById('bf-step-choose-body')?.classList.add('active');
      const nav = document.getElementById('bf-step-nav');
      if (nav) nav.innerHTML = '';
      const actions = document.getElementById('bf-step-actions');
      if (actions) actions.innerHTML = '';
    } else {
      document.getElementById('bf-step-wizard')?.classList.add('active');
      document.getElementById('bf-wizard-body')?.classList.add('active');
    }
  }

  function getDisplayWizard(w) {
    w = w || loadWizard();
    const derivedDone = global.BootstrapCoordinator?.deriveCompletedSteps?.(w.path) || w.completedSteps || [];
    const effectiveStep = global.BootstrapCoordinator?.effectiveStepIndex?.(w);
    const stepIndex = Number.isFinite(effectiveStep) ? effectiveStep : w.currentStep;
    return { ...w, completedSteps: derivedDone, currentStep: stepIndex };
  }

  function sanitizeWizardForResume(w) {
    w = w || loadWizard();
    if (!w || typeof w !== 'object' || Array.isArray(w)) {
      return saveWizard({
        path: null, currentStep: 0, completedSteps: [], startedAt: null,
        lang: global.UxI18n?.getLang?.() || 'ar', restoreChoice: null, syncDone: false,
        oauthLockAt: null, wizardFlowVersion: WIZARD_FLOW_VERSION,
      });
    }
    let changed = false;
    const steps = w.path ? stepsFor(w.path) : [];
    if (w.path && steps.length) {
      const resumeIdx = global.BootstrapCoordinator?.effectiveStepIndex?.(w);
      if (Number.isFinite(resumeIdx) && resumeIdx !== w.currentStep) {
        w.currentStep = resumeIdx;
        changed = true;
      }
      if (!Number.isFinite(w.currentStep) || w.currentStep < 0 || w.currentStep >= steps.length) {
        w.currentStep = Number.isFinite(resumeIdx) ? resumeIdx : 0;
        changed = true;
      }
    }
    if (!Number.isFinite(w.wizardFlowVersion) || w.wizardFlowVersion < 0) {
      w.wizardFlowVersion = WIZARD_FLOW_VERSION;
      changed = true;
    }
    if (!Array.isArray(w.completedSteps)) {
      w.completedSteps = global.BootstrapCoordinator?.deriveCompletedSteps?.(w.path) || [];
      changed = true;
    }
    if (changed) saveWizard(w);
    return w;
  }

  function clearTransientBootstrapState(options) {
    options = options || {};
    if (options.clearStepError !== false) {
      checklistStepError = null;
      lastGateRetryHandler = null;
    }
    if (options.clearStatus !== false) {
      const el = document.getElementById('bf-wizard-status');
      if (el && el.classList.contains('bf-status-error')) {
        el.textContent = '';
        el.classList.remove('bf-status-error');
      }
    }
  }

  function prepareBootstrapResume(options) {
    options = options || {};
    const w = sanitizeWizardForResume(loadWizard());
    if (global.BootstrapLifecycleContract?.shouldClearTransientErrorOnResume?.() !== false) {
      clearTransientBootstrapState({ clearStepError: true, clearStatus: true });
    }
    if (w.path && options.showResumeHint !== false) {
      const steps = stepsFor(w.path);
      const stepId = steps[w.currentStep];
      if (stepId && stepId !== 'ready' && !validateStep(stepId)) {
        const msg = global.BootstrapLifecycleContract?.buildDismissPolicy?.()?.resumeMessage
          || 'سنكمل الإعداد من حيث توقفت.';
        const hint = document.getElementById('bf-step-hint');
        if (hint && !hint.dataset.resumeHint) {
          hint.dataset.resumeHint = '1';
          hint.textContent = msg;
        }
      }
    }
    updateBootstrapCloseButton();
    return getDisplayWizard(w);
  }

  function updateBootstrapCloseButton() {
    const btn = document.getElementById('bf-close-btn');
    if (!btn) return;
    const incomplete = needsBootScreen();
    btn.title = incomplete ? 'إغلاق والعودة' : 'إغلاق';
    btn.setAttribute('aria-label', incomplete ? 'إغلاق والعودة إلى شاشة الدخول' : 'إغلاق');
  }

  function isOperationalAppAllowed() {
    const BLC = global.BootstrapLifecycleContract;
    const readyEval = traceEvaluateReady();
    const needsBoot = needsBootScreen();
    if (BLC?.isOperationalAppAllowed) return BLC.isOperationalAppAllowed(readyEval, needsBoot);
    return readyEval?.ready === true && !needsBoot;
  }

  function applyOperationalGuard() {
    try { global.SetupStateDom?.applyDomVisibility?.({ reason: 'bootstrap-lifecycle-guard' }); } catch { /* empty */ }
    if (!isOperationalAppAllowed()) {
      try { global.setAppAuthed?.(false); } catch { /* empty */ }
      const shell = document.getElementById('app-shell');
      if (shell) shell.classList.add('app-shell--locked');
      document.body?.classList.add('app-locked');
    }
  }

  async function completeBootstrapTransition(opts) {
    opts = opts || {};
    if (!isBootComplete()) {
      return { ok: false, error: 'ready_not_satisfied', ready: false };
    }
    clearTransientBootstrapState();
    const marked = await markBootComplete();
    if (!marked) {
      return { ok: false, error: 'boot_completion_failed', ready: false };
    }
    if (opts.close !== false) {
      close({ showLogin: true });
      applyOperationalGuard();
    }
    return { ok: true, ready: true };
  }

  function dismissBootstrap() {
    if (isCriticalOpInFlight()) {
      setStatus('⚠️ عملية جارية — انتظر أو أكمل قبل الإغلاق', true);
      return { ok: false, error: 'operation_in_flight' };
    }
    document.getElementById('bootFlowOverlay')?.classList.remove('open');
    setBootActive(false);
    clearTransientBootstrapState({ clearStepError: true, clearStatus: false });
    if (!isOperationalAppAllowed()) {
      const login = document.getElementById('loginScreen');
      if (login) {
        login.classList.remove('hidden');
        login.style.display = '';
        login.style.pointerEvents = '';
      }
      applyOperationalGuard();
      global.notify?.('ℹ️ يمكنك إعادة فتح الإعداد من «🚀 بدء الإعداد»', 'info');
      applyLoginGate();
      return { ok: true, dismissed: true, operationalApp: false };
    }
    close({ showLogin: true });
    return { ok: true, dismissed: true, operationalApp: true };
  }

  function renderChecklist(w) {
    w = getDisplayWizard(w);
    const BCC = global.BootstrapChecklistContract;
    if (!BCC?.buildChecklistModel) return;
    const model = BCC.buildChecklistModel(getChecklistUiContext(w));
    const list = document.getElementById('bf-checklist-list');
    const barFill = document.getElementById('bf-checklist-bar-fill');
    const pct = document.getElementById('bf-checklist-pct');
    if (!list) return;
    list.textContent = '';
    model.items.forEach((item) => {
      const meta = checklistStatusMeta(item.status);
      const li = document.createElement('li');
      li.className = 'bf-checklist-item';
      li.dataset.status = meta.className;
      li.dataset.stepId = item.id;
      if (item.active) li.setAttribute('aria-current', 'step');
      const icon = document.createElement('span');
      icon.className = 'bf-checklist-icon';
      icon.textContent = meta.icon;
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'bf-checklist-label';
      label.textContent = item.label;
      const badge = document.createElement('span');
      badge.className = 'bf-checklist-badge';
      badge.textContent = meta.badge;
      li.appendChild(icon);
      li.appendChild(label);
      li.appendChild(badge);
      if (item.error) {
        const err = document.createElement('div');
        err.className = 'bf-checklist-error';
        err.textContent = item.error;
        if (item.diagnostic) {
          const code = document.createElement('span');
          code.className = 'bf-checklist-code';
          code.textContent = ` (${item.diagnostic})`;
          err.appendChild(code);
        }
        li.appendChild(err);
      }
      if (item.retryable && item.active) {
        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'btn btn-secondary btn-sm bf-checklist-retry';
        retryBtn.textContent = 'إعادة المحاولة';
        retryBtn.onclick = () => retryCurrentGate();
        li.appendChild(retryBtn);
      }
      list.appendChild(li);
    });
    if (barFill) barFill.style.width = `${model.progress.percent}%`;
    if (pct) pct.textContent = `${model.progress.percent}% — ${model.progress.done}/${model.progress.total}`;
  }

  /**
   * State the step model needs to decide which conditional steps apply.
   * Derived from the same gates the checklist uses, so all consumers agree.
   */
  function stepModelState(w) {
    w = w || loadWizard();
    return {
      path: w.path,
      forkDecision: w.forkDecision,
      currentStepId: currentStepId(w),
      needsPathFork: needsPathForkDecision(),
      pathDecisionResolved: hasPathDecisionResolved(),
      ownerAuthResolved: ownerAuthStepResolved(),
      ownerAuthRequired: hasOwnerPasswordAccount() && !ownerAuthStepResolved(),
    };
  }

  /** Resolve the step id for a wizard without recursing through the model state. */
  function currentStepId(w) {
    w = w || loadWizard();
    const sequence = stepsFor(w.path);
    const idx = Number(w.currentStep);
    return sequence[Number.isFinite(idx) ? Math.min(Math.max(idx, 0), sequence.length - 1) : 0] || sequence[0] || null;
  }

  function stepModel() {
    return global.BootstrapStepModel;
  }

  function applicableSteps(w) {
    w = w || loadWizard();
    return stepModel()?.getApplicableSteps?.(w.path, stepModelState(w)) || stepsFor(w.path);
  }

  /** Single description of the current frame — used by every renderer. */
  function describeCurrentStep(w) {
    w = w || getDisplayWizard(loadWizard());
    const model = stepModel();
    const stepId = currentStepId(w);
    if (!model?.describeStep) {
      const steps = stepsFor(w.path);
      return {
        path: w.path,
        stepId,
        stepNumber: steps.indexOf(stepId) + 1,
        totalSteps: steps.length,
        applicableSteps: steps,
        nextStepId: steps[steps.indexOf(stepId) + 1] || null,
        previousStepId: steps[steps.indexOf(stepId) - 1] || null,
      };
    }
    return model.describeStep(w.path, stepModelState(w), stepId);
  }

  function renderProgress(w) {
    w = getDisplayWizard(w);
    const frame = describeCurrentStep(w);
    const steps = frame.applicableSteps;
    const currentIdx = steps.indexOf(frame.stepId);
    const host = document.getElementById('bf-progress');
    const stepper = document.getElementById('bf-stepper');
    if (host) {
      host.innerHTML = steps.map((s, i) => {
        let cls = 'bf-dot';
        if (w.completedSteps.includes(s)) cls += ' done';
        else if (i === currentIdx) cls += ' current';
        return `<div class="${cls}" title="${STEP_LABELS[s] || s}"></div>`;
      }).join('');
    }
    if (stepper) {
      stepper.innerHTML = steps.map((s, i) => {
        let state = 'pending';
        if (w.completedSteps.includes(s)) state = 'done';
        else if (i === currentIdx) state = 'current';
        const cur = i === currentIdx ? 'step' : undefined;
        const short = STEP_SHORT[s] || STEP_LABELS[s] || s;
        const full = STEP_LABELS[s] || s;
        return `<li data-state="${state}" title="${full}" ${cur ? 'aria-current="step"' : ''}>${short}</li>`;
      }).join('');
    }
    renderChecklist(w);
    const meta = document.getElementById('bf-step-meta');
    if (meta) meta.textContent = `الخطوة ${frame.stepNumber || 1} من ${frame.totalSteps}`;
    const label = document.getElementById('bf-step-label');
    if (label) label.textContent = STEP_LABELS[frame.stepId] || '';
    const hint = document.getElementById('bf-step-hint');
    if (hint) hint.textContent = STEP_HINTS[frame.stepId] || '';
    const title = document.getElementById('bf-wizard-title');
    if (title) title.textContent = w.path === PATHS.NEW ? 'إعداد عميل جديد' : 'جهاز / عميل حالي';
  }

  function renderNavButtons(w) {
    const nav = document.getElementById('bf-step-nav');
    if (!nav) return;
    nav.innerHTML = '';
    const display = getDisplayWizard(w);
    const frame = describeCurrentStep(display);
    const step = frame.stepId;
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'btn btn-ghost btn-sm';
    prev.id = 'bf-back-btn';
    prev.textContent = frame.previousStepId ? '◀ السابق' : '◀ مرحباً بك';
    prev.onclick = () => prevStep();
    nav.appendChild(prev);

    // On ready step: no duplicate "إنهاء والدخول" — primary CTA lives in step actions only.
    if (step === 'ready') {
      return;
    }

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'btn btn-primary btn-sm';
    next.id = 'bf-next-btn';
    next.textContent = 'متابعة ▶';
    // Authoritative gate only. Never keep Next disabled when validateStep is true
    // (checklist DONE / coordinator resolved must agree via validateStep).
    const stepOk = validateStep(step) === true;
    const inFlight = isStepOperationInFlight(step)
      || (step === 'discovery' && discoveryInFlight)
      || (step === 'google' && oauthInFlight)
      || (step === 'restore' && restoreInFlight);
    next.disabled = !stepOk || inFlight;
    next.title = !stepOk
      ? (STEP_HINTS[step] || 'أكمل متطلبات هذه الخطوة أولاً')
      : (inFlight ? 'انتظر اكتمال العملية الجارية' : '');
    next.onclick = () => advanceWizard();
    nav.appendChild(next);
  }

  /**
   * Render one frame from a single wizard snapshot and bump the generation, so
   * a late async callback from a previous step can detect that it is stale
   * before touching the DOM. Prevents header/body/checklist showing different
   * steps.
   */
  function renderAll(w) {
    w = getDisplayWizard(w || loadWizard());
    renderGeneration += 1;
    renderProgress(w);
    renderStepUI(w);
    renderNavButtons(w);
    return renderGeneration;
  }

  function currentRenderGeneration() {
    return renderGeneration;
  }

  function isRenderCurrent(generation, stepId) {
    if (generation !== renderGeneration) return false;
    if (stepId && currentStepId() !== stepId) return false;
    return true;
  }

  function addBtn(host, label, cls, handler, disabled) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + (cls || 'btn-primary');
    b.textContent = label;
    b.disabled = !!disabled;
    b.onclick = (ev) => {
      if (typeof global.runWithButtonLock === 'function') {
        return global.runWithButtonLock(b, () => handler(ev));
      }
      return handler(ev);
    };
    host.appendChild(b);
    return b;
  }

  async function refreshGoogleConnectionState(options) {
    options = options || {};
    let refreshError = null;
    if (typeof global.DriveAdapter?.ensureConnected === 'function') {
      try {
        await global.DriveAdapter.ensureConnected({
          acceptLiveReconnect: options.acceptLiveReconnect === true,
        });
      } catch (error) {
        refreshError = error?.code || error?.message || 'google_status_refresh_failed';
      }
    } else if (typeof global.syncCloudStatusFromElectron === 'function') {
      try {
        const synced = await global.syncCloudStatusFromElectron({
          acceptLiveReconnect: options.acceptLiveReconnect === true,
        });
        if (synced?.ok === false && synced?.error) {
          refreshError = synced.error;
        }
      } catch (error) {
        refreshError = error?.code || error?.message || 'google_status_refresh_failed';
      }
    }
    if (typeof global.licCheck === 'function') {
      try { await global.licCheck({ silent: true }); } catch { /* license readiness is checked separately */ }
    }
    const connected = hasGoogle();
    return {
      ok: connected,
      connected,
      error: connected ? null : (refreshError || 'google_not_connected'),
    };
  }

  async function runLicenseOrgRecovery(options) {
    options = options || {};
    const w = loadWizard();
    if (!hasDiscoveryResolved()) {
      return { ok: false, error: 'discovery_required' };
    }
    const discovery = getCachedDiscoveryResult();
    const PG = global.PostGoogleCloudDiscovery;
    const status = discovery?.status || discovery?.result?.status || '';
    const noBusiness = status === 'no_existing_business'
      || status === PG?.STATUS_NO_EXISTING
      || (discovery?.organizationCandidates?.length === 0
        && discovery?.licenseCandidates?.length === 0
        && w.path === PATHS.EXISTING);
    if (noBusiness && !options.allowRetry) {
      return { ok: false, error: 'existing_business_not_found' };
    }
    const activationCountBefore = Number(global.LicenseActivationGate?.getConsumeCount?.() || 0);
    const result = await autoDiscoverActivationAfterGoogle({
      forceDriveRescan: options.forceDriveRescan === true,
      existingRecovery: true,
    });
    if (result?.error === 'multiple_licenses' || result?.needsSelection) {
      return { ok: false, error: 'existing_candidate_ambiguous', result };
    }
    if (!hasValidLicense() || !hasCenterData()) {
      return { ok: false, error: result?.error || 'existing_license_recovery_failed', result };
    }
    const lic = global.LicenseCloud?.loadLocal?.() || {};
    const meta = global.DB?.get?.('__tdw_meta__', {}) || {};
    meta.existingShortPathRecovery = {
      recoveredAt: new Date().toISOString(),
      organizationId: lic.centerId || meta.centerId,
      licenseRecovered: true,
      activationConsumed: false,
      activationConsumeDelta: Number(global.LicenseActivationGate?.getConsumeCount?.() || 0) - activationCountBefore,
      minimalPublicationWaived: true,
      minimalReadbackWaived: true,
      businessSetupFromRecovery: businessSetupStepResolved(),
      googleAccount: global.settings?.backup?.providers?.google?.email || null,
      candidateId: w.forkSelectedCandidateId || w.selectedCandidateId || discovery?.selectedOrUniqueCandidate?.id || null,
    };
    global.DB?.set?.('__tdw_meta__', meta);
    if (!w.completedSteps.includes('license_org_recovery')) w.completedSteps.push('license_org_recovery');
    saveWizard(w);
    await refreshGoogleConnectionState({ acceptLiveReconnect: true });
    const wAfter = loadWizard();
    if (hasGoogle()) {
      wAfter.googleSessionConnected = true;
      if (!wAfter.completedSteps.includes('google')) wAfter.completedSteps.push('google');
      saveWizard(wAfter);
      clearChecklistStepError('google');
    }
    reconcileBranchSelectionAfterDiscovery();
    renderChecklist(getDisplayWizard(loadWizard()));
    return { ok: true, recovered: true, activationConsumeDelta: meta.existingShortPathRecovery.activationConsumeDelta };
  }

  /**
   * License recovery apply (license step / manual rescan) — NOT the Discovery gate.
   * NEW Stage 6/7: skipped when local activation already authoritative — no re-consume.
   */
  async function autoDiscoverActivationAfterGoogle(options) {
    options = options || {};
    const w = loadWizard();
    if (w.path === PATHS.NEW && hasValidLicense() && !options.forceDriveRescan && !options.existingRecovery) {
      setStatus('✅ التفعيل محفوظ — متابعة إعداد السحابة بعد Google');
      return { ok: true, skipped: true, reason: 'activation_already_authoritative', discovered: false };
    }
    setStatus('🔍 جارٍ فحص بيانات الترخيص على Drive/Cloud...');
    try {
      const bootstrap = global.CloudBootstrap;
      if (!bootstrap?.discoverAndFetchLicenseFromDrive) {
        return { ok: false, error: 'bootstrap_unavailable' };
      }
      let lic = await bootstrap.discoverAndFetchLicenseFromDrive({ forceList: false, persist: false });
      if (lic?.error === 'multiple_licenses' && lic.needsSelection) {
        setStatus('⚠️ وُجد أكثر من ترخيص — اختر الترخيص الصحيح من القائمة');
        const host = document.getElementById('bf-license-candidates');
        if (host && typeof global.renderDriveLicenseCandidates === 'function') {
          host.style.display = '';
          global.renderDriveLicenseCandidates('bf-license-candidates', lic.candidates, {
            context: 'bootflow',
            skipModal: true,
            skipDeviceBootstrap: true,
            recovery: true
          });
        }
        return lic;
      }
      if (!lic?.ok) {
        // Retry force list scan once for legacy roots
        lic = await bootstrap.discoverAndFetchLicenseFromDrive({ forceList: true, persist: false });
      }
      if (lic?.error === 'multiple_licenses') return lic;
      if (lic?.ok && lic.license) {
        const bridge = global.LicenseLegacyBridge
          || (typeof global.tdwLicenseLegacyBridge === 'function' ? global.tdwLicenseLegacyBridge() : null);
        if (bridge?.applyFromCloudDoc) {
          const applied = await bridge.applyFromCloudDoc(lic.license, { remotePath: lic.path });
          if (!applied?.ok) {
            setStatusFromErr(applied);
            return { ...applied, discovery: true };
          }
        }
        if (typeof global.licCheck === 'function') await global.licCheck({ silent: true });
        const w = loadWizard();
        if (!w.completedSteps.includes('license')) w.completedSteps.push('license');
        if (hasBranch() && hasCenterData() && !w.completedSteps.includes('organization')) {
          w.completedSteps.push('organization');
        }
        saveWizard(w);
        if (hasBranch() || hasCenterData()) {
          console.info('[BootFlow] license_recovery_existing_signals_detected', {
            hasBranch: hasBranch(),
            hasCenterData: hasCenterData(),
            path: w.path,
            stage8Note: 'no_silent_path_flip_stage7',
          });
        }
        setStatus('✅ تم العثور على بيانات التفعيل وسحبها بنجاح. يرجى اختيار الفرع وإدخال اسم هذا الجهاز لإكمال التسجيل.');
        return { ok: true, discovered: true, license: lic.license, applied: true };
      }
      setStatus('ℹ️ لم يُعثر على تفعيل على Drive — أدخل مفتاح الترخيص للمتابعة (عميل جديد).');
      return { ok: false, error: 'no_activation_on_drive', scenario: 'B' };
    } catch (e) {
      // Preserve the real failure class. The previous hard-coded fallback
      // mislabeled RBAC, signature, rendering and persistence errors as a
      // network timeout, hiding the actionable root cause.
      if (options.existingRecovery && hasGoogle() && hasDiscoveryResolved()) {
        console.info('[BootFlow] license_recovery_transient_error_ignored', e?.code || e?.message || e);
        return { ok: false, error: String(e && e.message || e), transient: true };
      }
      setStatusFromErr(e, e?.code || e?.error, { suppressIfResolved: true });
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  async function commitSetupOrganizationDevice(options) {
    const commit = global.cuppingElectron?.database?.setupCommitOrganizationDevice
      || global.tadawi?.database?.setupCommitOrganizationDevice;
    if (typeof commit !== 'function') {
      const error = new Error('setup_organization_device_endpoint_unavailable');
      error.code = 'setup_organization_device_endpoint_unavailable';
      throw error;
    }
    const result = await commit(options || {});
    if (result?.ok !== true) {
      const error = new Error(result?.error || result?.message || 'setup_organization_device_commit_failed');
      error.code = result?.error || 'setup_organization_device_commit_failed';
      error.result = result;
      throw error;
    }
    const hydrated = await global.SqliteBridge?.hydrateIntoMemory?.();
    if (hydrated && hydrated.ok !== true) {
      const error = new Error(hydrated.error || 'setup_activation_hydrate_failed');
      error.code = hydrated.error || 'setup_activation_hydrate_failed';
      throw error;
    }
    if (result.settings && typeof result.settings === 'object') global.settings = result.settings;
    else if (result.centerName) global.settings = { ...(global.settings || {}), centerName: result.centerName };
    return result;
  }

  async function runDiscoveryGate(options) {
    options = options || {};
    if (discoveryInFlight) {
      return { ok: false, error: 'discovery_in_flight', retryable: true };
    }
    // First-pass Google→Discovery must run the same Main Google reconciliation
    // that close/reopen used to trigger via prepareBootstrapResume + ensureConnected.
    // Without this, a successful OAuth token could leave settings unsynced and a
    // protected settings write would surface as rbac_session_required.
    try {
      await refreshGoogleConnectionState({ acceptLiveReconnect: true });
    } catch { /* discovery still validates hasGoogle() below */ }
    if (!hasGoogle()) {
      setStatus('⚠️ اربط Google أولاً', true);
      return { ok: false, error: 'google_not_connected', retryable: false };
    }
    discoveryInFlight = true;
    setStatus('🔍 جارٍ اكتشاف بيانات السحابة (read-only)...');
    try {
      const run = global.PostGoogleCloudDiscovery?.runPostGoogleCloudDiscovery;
      if (typeof run !== 'function') {
        return { ok: false, error: 'discovery_module_unavailable', retryable: false };
      }
      const result = await run({
        forceRefresh: options.forceRefresh === true,
        forceList: options.forceList === true,
        onProgress: options.onProgress,
      });
      if (options.forceRefresh) {
        global.PostGoogleCloudDiscovery?.invalidateForkDecision?.();
      }
      if (!result?.ok) {
        const err = result?.diagnostics?.error || 'discovery_failed';
        setStatusFromErr(
          { code: err, error: err, message: `فشل الاكتشاف — ${err}` },
          err,
          {
            stepId: 'discovery',
            retryHandler: () => runDiscoveryGate({ forceRefresh: true }),
          },
        );
        return { ok: false, error: err, retryable: result?.diagnostics?.retryable !== false, discovery: result };
      }
      if (result.status === global.PostGoogleCloudDiscovery?.STATUS_EXISTING
        || result.status === global.PostGoogleCloudDiscovery?.STATUS_AMBIGUOUS) {
        setStatus('✅ وُجدت بيانات سابقة على السحابة — سجّلت للمراجعة (لا تبديل مسار صامت).');
      } else {
        setStatus('✅ اكتمل الاكتشاف — لا بيانات سابقة مرتبطة بهذا الحساب.');
      }
      clearChecklistStepError('discovery');
      clearTransientBootstrapState({ clearStepError: false, clearStatus: true });
      reconcileBranchSelectionAfterDiscovery();
      renderChecklist(getDisplayWizard(loadWizard()));
      renderNavButtons(loadWizard());
      return { ok: true, discovery: result };
    } catch (e) {
      const code = e?.code || e?.error || 'discovery_failed';
      setStatusFromErr(
        { ...(e && typeof e === 'object' ? e : {}), code, error: code, message: `فشل الاكتشاف — ${e?.message || code}` },
        code,
        {
          stepId: 'discovery',
          retryHandler: () => runDiscoveryGate({ forceRefresh: true }),
        },
      );
      return { ok: false, error: String(e && e.message || e), retryable: true };
    } finally {
      discoveryInFlight = false;
      renderProgress(loadWizard());
      renderNavButtons(loadWizard());
    }
  }

  async function runGoogleConnect() {
    if (oauthInFlight) {
      setStatus('⏳ ربط Google جارٍ بالفعل — انتظر');
      return { ok: false, error: 'oauth_in_flight' };
    }
    const wizardPath = loadWizard().path;
    if (wizardPath === PATHS.NEW && !hasValidLicense()) {
      setStatus('⚠️ أكمل التفعيل أولاً قبل ربط Google', true);
      return { ok: false, error: 'activation_required_before_google' };
    }
    oauthInFlight = true;
    setStatus('🔗 جارٍ فتح Google للمصادقة...');
    try {
      const res = await global.connectGoogleDriveOnly?.({
        context: 'boot-wizard',
        skipModal: true
      }) || await global.loginConnectGoogleAndBootstrap?.({
        context: 'boot-wizard',
        fieldPrefix: 'bf',
        skipDeviceBootstrap: true,
        connectOnly: true
      }, true);
      await refreshGoogleConnectionState({ acceptLiveReconnect: true });
      if (!hasGoogle()) {
        setStatusFromErr(res || { message: 'oauth_failed' }, res?.error || 'oauth_failed', { retryHandler: () => runGoogleConnect() });
        return res || { ok: false };
      }
      const w = loadWizard();
      w.googleSessionConnected = true;
      if (!w.completedSteps.includes('google')) w.completedSteps.push('google');
      saveWizard(w);
      setStatus('✅ تم ربط Google' + (res?.email ? ' — ' + res.email : '') + ' — تابع لخطوة الاكتشاف');
      clearChecklistStepError('google');
      clearTransientBootstrapState({ clearStepError: false, clearStatus: true });
      return { ok: true, googleConnected: true, email: res?.email || '' };
    } catch (e) {
      setStatusFromErr(e, e?.code || e?.error || 'oauth_failed', { retryHandler: () => runGoogleConnect() });
      return { ok: false, error: String(e && e.message || e) };
    } finally {
      oauthInFlight = false;
      const w = loadWizard();
      renderProgress(w);
      renderNavButtons(w);
      // Re-render step actions so Connect→Change/Disconnect swap immediately.
      renderStepUI(w);
    }
  }

  async function disconnectGoogleDuringSetup() {
    if (oauthInFlight || licenseActivateInFlight || branchBindInFlight || ownerLoginInFlight || syncInFlight) {
      return { ok: false, error: 'setup_operation_in_progress' };
    }
    try {
      const api = global.cuppingElectron || global.tadawi || global.tadawiElectron;
      // Main owns OAuth-token removal. A Google-account switch never deletes
      // the license, SQLite data, device binding, or setup choices.
      const disconnected = await api?.backup?.disconnectCloud?.('google');
      if (disconnected?.ok === false) return disconnected;
      const settings = global.settings || (global.settings = {});
      settings.backup = settings.backup || {};
      settings.backup.providers = settings.backup.providers || {};
      settings.backup.providers.google = {
        ...(settings.backup.providers.google || {}),
        connected: false, email: '', oauth: false, hasRefreshToken: false,
        userDisconnected: true,
      };
      settings.backup.cloudEnabled = false;
      global.DB?.set?.('settings', settings);
      if (typeof global.commitGoogleConnectionForSetup === 'function') {
        await global.commitGoogleConnectionForSetup({
          connected: false,
          userDisconnected: true,
          email: '',
          hasRefreshToken: false,
          oauth: false,
        });
      }
      const wizard = loadWizard();
      const steps = stepsFor(wizard.path);
      const googleIndex = steps.indexOf('google');
      wizard.completedSteps = (wizard.completedSteps || []).filter((step) => {
        const index = steps.indexOf(step);
        return index >= 0 && index < googleIndex;
      });
      wizard.currentStep = Math.max(0, googleIndex);
      wizard.restoreChoice = null;
      wizard.syncDone = false;
      global.PostGoogleCloudDiscovery?.invalidateDiscoveryCache?.(wizard);
      clearChecklistStepError(['google', 'discovery', 'path_decision', 'license_org_recovery', 'restore', 'sync']);
      failureContextSnapshot = { googleEmail: null, branchId: null, restoreChoice: null, organizationId: null };
      saveWizard(wizard);
      setStatus('تم فصل حساب Google. يمكنك ربط الحساب الصحيح الآن.');
      renderProgress(loadWizard());
      renderNavButtons(loadWizard());
      renderStepUI(loadWizard());
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.code || error?.message || 'google_disconnect_failed' };
    }
  }

  async function activateLicenseKey() {
    if (licenseActivateInFlight) {
      setStatus('⏳ التفعيل جارٍ — لا تضغط مجدداً');
      return { ok: false, error: 'activate_in_flight' };
    }
    const input = document.getElementById('bf-license-key');
    let key = String(input?.value || '').replace(/\s+/g, '').trim();
    if (!/^TDW6\./.test(key)) key = key.toUpperCase();
    if (input) input.value = key;
    if (!key) {
      setStatus('⚠️ أدخل مفتاح الترخيص');
      return { ok: false, error: 'key_required' };
    }
    licenseActivateInFlight = true;
    try { global.OwnerManagement?.setSystemBusy?.('license_refresh'); } catch { /* empty */ }
    setStatus('⏳ جارٍ التحقق من الترخيص...');
    try {
      let res;
      const router = global.CommercialLicense?.router;
      const uiSink = { style: { display: 'none' }, textContent: '' };
      // licApplyRenewal is a legacy screen handler: it ignores this key and
      // reads an input from another page, causing false invalid-key results.
      if (router?.isV6Input?.(key)) {
        res = await router.applyV6Activation(key, uiSink, null);
        if (res?.ok === true) {
          const commitSigned = global.cuppingElectron?.database?.setupCommitSignedActivation
            || global.tadawi?.database?.setupCommitSignedActivation;
          if (typeof commitSigned !== 'function') throw new Error('setup_signed_activation_endpoint_unavailable');
          const committed = await commitSigned({
            license: res.verified?.license,
            legacyLicense: res.lic,
          });
          if (committed?.ok !== true) {
            const error = new Error(committed?.error || 'setup_signed_activation_commit_failed');
            error.code = committed?.error || 'setup_signed_activation_commit_failed';
            throw error;
          }
          const hydrated = await global.SqliteBridge?.hydrateIntoMemory?.();
          if (hydrated && hydrated.ok !== true) throw new Error(hydrated.error || 'setup_activation_hydrate_failed');
        }
      } else if (router?.isV5Key?.(key)) {
        res = await router.applyActivation(key, uiSink, null);
        if (res?.ok === true) {
          const commitSigned = global.cuppingElectron?.database?.setupCommitSignedActivation
            || global.tadawi?.database?.setupCommitSignedActivation;
          if (typeof commitSigned !== 'function') throw new Error('setup_signed_activation_endpoint_unavailable');
          const licenseDoc = res.activationCommit?.doc || global.LicenseCloud?.loadLocal?.();
          if (!licenseDoc) throw new Error('setup_legacy_activation_document_missing');
          const committed = await commitSigned({ license: licenseDoc, legacyLicense: res.lic });
          if (committed?.ok !== true) {
            const error = new Error(committed?.error || 'setup_signed_activation_commit_failed');
            error.code = committed?.error || 'setup_signed_activation_commit_failed';
            throw error;
          }
          const hydrated = await global.SqliteBridge?.hydrateIntoMemory?.();
          if (hydrated && hydrated.ok !== true) throw new Error(hydrated.error || 'setup_activation_hydrate_failed');
        }
      } else {
        res = { handled: true, ok: false, error: 'license_format_invalid' };
      }
      if (res?.ok !== true) {
        if (uiSink.textContent) setStatus(uiSink.textContent, true);
        else setStatusFromErr(res || { message: 'license_invalid' }, res?.error || 'license_invalid');
        return { ok: false, error: res?.error || 'license_invalid', result: res };
      }
      if (typeof global.licCheck === 'function') await global.licCheck();
      if (hasValidLicense()) {
        setStatus('✅ تم التفعيل بنجاح');
        return { ok: true, result: res };
      }
      setStatusFromErr(res || { message: 'license_invalid' }, 'license_invalid');
      return { ok: false, result: res };
    } catch (e) {
      setStatusFromErr(e, 'license_invalid');
      return { ok: false, error: String(e && e.message || e) };
    } finally {
      licenseActivateInFlight = false;
      try { global.OwnerManagement?.clearSystemBusy?.('license_refresh'); } catch { /* empty */ }
      const w = loadWizard();
      renderNavButtons(w);
    }
  }

  async function createFirstBranchFromForm() {
    if (branchCreateInFlight) {
      setStatusFromErr({ message: 'duplicate create' }, 'branch_duplicate_create');
      return { ok: false, error: 'in_flight' };
    }
    if (newBranchRequiresOwner()) {
      setStatus('⚠️ يجب إنشاء/اعتماد حساب المالك قبل إنشاء أول فرع', true);
      return { ok: false, error: 'owner_required_before_branch' };
    }
    if (hasBranch() && getSelectedBranchId()) {
      setStatus('✅ الفرع جاهز — تابع إلى تسجيل الجهاز');
      return { ok: true, already: true };
    }
    const nameAr = String(document.getElementById('bf-branch-name-ar')?.value || '').trim();
    const nameEn = String(document.getElementById('bf-branch-name-en')?.value || '').trim();
    const code = String(document.getElementById('bf-branch-code')?.value || '').trim();
    const city = String(document.getElementById('bf-branch-city')?.value || '').trim();
    const phone = String(document.getElementById('bf-branch-phone')?.value || '').trim();
    if (!nameAr) {
      setStatusFromErr({ message: 'branch_name_required' }, 'branch_name_required');
      return { ok: false };
    }
    const centerName = String(global.settings?.centerName || global.LicenseCloud?.loadLocal?.()?.centerName || '').trim();
    const banned = ['مركز الحجامة', 'الفرع الرئيسي', 'Hijama Center', 'Main Branch', centerName].filter(Boolean);
    if (banned.some((b) => b && nameAr === b)) {
      setStatus('⚠️ أدخل اسماً مخصصاً للفرع — لا تستخدم اسم المركز أو القيمة الافتراضية', true);
      return { ok: false, error: 'branch_name_placeholder' };
    }
    branchCreateInFlight = true;
    setStatus('⏳ جارٍ إنشاء الفرع...');
    try {
      const doc = global.LicenseCloud?.loadLocal?.();
      if (!doc?.centerId) {
        setStatus('⚠️ لا يوجد ترخيص/مؤسسة صالحة لإنشاء فرع', true);
        return { ok: false, error: 'no_center' };
      }
      const committed = await commitSetupOrganizationDevice({
        centerName: centerName || doc.centerName || nameAr,
        branchOnly: true,
        createBranch: {
          source: 'activation_wizard',
          id: code || 'BR-MAIN',
          name: nameAr,
          nameEn,
          code: code || 'MAIN',
          city,
          phone,
        },
      });
      if (!committed?.branch?.id || !hasBranch()) {
        throw new Error('setup_branch_not_committed');
      }
      recordBranchSelection(committed.branch.id, 'created');
      setStatus('✅ تم إنشاء الفرع — تابع إلى تسجيل الجهاز');
      return { ok: true, branch: committed.branch };
    } catch (e) {
      setStatusFromErr(e);
      return { ok: false };
    } finally {
      branchCreateInFlight = false;
      renderNavButtons(loadWizard());
    }
  }

  async function selectExistingBranchOnly() {
    if (branchBindInFlight) {
      return { ok: false, error: 'in_flight' };
    }
    const branchId = String(document.getElementById('bf-branch-id')?.value || '').trim();
    if (!branchId) {
      setStatus('⚠️ اختر الفرع', true);
      return { ok: false, error: 'branch_required' };
    }
    branchBindInFlight = true;
    try {
      const lic = global.LicenseCloud?.loadLocal?.() || {};
      const branch = authoritativeBootstrapBranches(lic).find((b) => b && String(b.id) === branchId)
        || (lic.branches || []).find((b) => b && String(b.id) === branchId);
      if (!branch) {
        setStatus('⚠️ الفرع غير موجود في الترخيص', true);
        return { ok: false, error: 'branch_not_found' };
      }
      const w = recordBranchSelection(branchId, 'user');
      if (!w.completedSteps.includes('branch_select')) w.completedSteps.push('branch_select');
      saveWizard(w);
      clearChecklistStepError('branch_select');
      setStatus('✅ تم اختيار الفرع — تابع إلى تسجيل الجهاز');
      renderChecklist(getDisplayWizard(loadWizard()));
      return { ok: true, branchId, provenance: 'user' };
    } finally {
      branchBindInFlight = false;
      renderNavButtons(loadWizard());
    }
  }

  async function registerDeviceFromForm() {
    if (deviceRegisterInFlight) {
      return { ok: false, error: 'device_registration_in_flight' };
    }
    if (!hasBranch() || !getSelectedBranchId()) {
      setStatus('⚠️ يجب اختيار/إنشاء فرع قبل تسجيل الجهاز', true);
      return { ok: false, error: 'branch_required_before_device' };
    }
    if (deviceStepResolved()) {
      setStatus('✅ الجهاز مسجل بالفعل');
      return { ok: true, already: true };
    }
    const deviceName = String(document.getElementById('bf-device-name')?.value || '').trim();
    const branchId = getSelectedBranchId();
    if (!deviceName) {
      setStatus('⚠️ أدخل اسم هذا الجهاز', true);
      return { ok: false, error: 'device_name_required' };
    }
    deviceRegisterInFlight = true;
    setStatus('⏳ جارٍ تسجيل الجهاز...');
    try {
      const committed = await commitSetupOrganizationDevice({
        centerName: global.settings?.centerName || global.LicenseCloud?.loadLocal?.()?.centerName || '',
        branchId,
        deviceName,
      });
      if (!committed?.deviceRegistryCommit?.ok || !hasDeviceBranch()) {
        throw new Error(committed?.error || 'setup_device_binding_not_committed');
      }
      const readBack = readDeviceCommitState();
      if (!readBack.deviceId || readBack.branchId !== branchId || readBack.deviceName !== deviceName) {
        throw new Error('device_readback_mismatch');
      }
      try { localStorage.setItem(RESTART_REQUIRED_KEY, '1'); } catch { /* empty */ }
      await refreshGoogleConnectionState({ acceptLiveReconnect: true });
      const wDev = loadWizard();
      if (hasGoogle()) {
        wDev.googleSessionConnected = true;
        if (!wDev.completedSteps.includes('google')) wDev.completedSteps.push('google');
        saveWizard(wDev);
      }
      setStatus('✅ تم تسجيل الجهاز وربطه بالفرع بنجاح. سيتم إعادة تشغيل البرنامج لتطبيق التفعيل واستكمال المزامنة.');
      return { ok: true, restartRequired: true, readBack };
    } catch (e) {
      setStatusFromErr(e);
      return { ok: false };
    } finally {
      deviceRegisterInFlight = false;
      renderNavButtons(loadWizard());
    }
  }

  async function commitBusinessSetupFromForm() {
    if (businessSetupInFlight) {
      return { ok: false, error: 'business_setup_in_flight' };
    }
    if (!deviceStepResolved()) {
      setStatus('⚠️ يجب إكمال تسجيل الجهاز قبل إعداد بيانات المركز', true);
      return { ok: false, error: 'device_required_before_business_setup' };
    }
    if (businessSetupStepResolved()) {
      setStatus('✅ بيانات المركز جاهزة');
      return { ok: true, already: true };
    }
    const input = {
      centerName: String(document.getElementById('bf-business-center-name')?.value || '').trim(),
      phone: String(document.getElementById('bf-business-phone')?.value || '').trim(),
      address: String(document.getElementById('bf-business-address')?.value || '').trim(),
      centerCity: String(document.getElementById('bf-business-city')?.value || '').trim(),
      centerNameEn: String(document.getElementById('bf-business-center-name-en')?.value || '').trim(),
    };
    const validation = global.BusinessSetupContract?.validateFormInput?.(input)
      || { ok: !!(input.centerName && input.phone), issues: [] };
    if (!validation.ok) {
      const first = validation.issues?.[0];
      setStatusFromErr({ message: first?.message || 'business_setup_invalid' }, first?.code || 'business_setup_invalid');
      return { ok: false, error: first?.code || 'business_setup_invalid', issues: validation.issues };
    }
    businessSetupInFlight = true;
    setStatus('⏳ جارٍ حفظ بيانات المركز...');
    try {
      const settings = { ...(global.settings || {}) };
      settings.centerName = input.centerName;
      settings.phone = input.phone;
      if (input.address) settings.address = input.address;
      if (input.centerCity) settings.centerCity = input.centerCity;
      if (input.centerNameEn) settings.centerNameEn = input.centerNameEn;
      const committed = typeof global.persistData === 'function'
        ? await global.persistData('settings', settings)
        : await global.SqliteBridge?.setAuthoritative?.('settings', settings);
      if (!committed || committed.ok === false) {
        throw new Error(committed?.error || 'business_setup_commit_failed');
      }
      global.settings = settings;
      const lic = global.LicenseCloud?.loadLocal?.();
      if (lic?.centerId && settings.centerName && lic.centerName !== settings.centerName) {
        lic.centerName = settings.centerName;
        global.LicenseCloud?.saveLocal?.(lic);
      }
      const hydrated = await global.SqliteBridge?.hydrateIntoMemory?.();
      if (hydrated && hydrated.ok !== true) {
        throw new Error(hydrated.error || 'business_setup_hydrate_failed');
      }
      const readBack = readBusinessSetupState();
      if (!readBack.centerName || readBack.centerName !== input.centerName
        || !readBack.phone || readBack.phone !== input.phone) {
        throw new Error('business_setup_readback_mismatch');
      }
      setStatus('✅ تم حفظ بيانات المركز بنجاح');
      return { ok: true, readBack };
    } catch (e) {
      setStatusFromErr(e);
      return { ok: false, error: e?.message || e?.code || 'business_setup_failed' };
    } finally {
      businessSetupInFlight = false;
      renderNavButtons(loadWizard());
    }
  }

  async function commitPublicationFromWizard() {
    if (publicationInFlight) {
      return { ok: false, error: 'publication_in_flight' };
    }
    if (!businessSetupStepResolved()) {
      setStatus('⚠️ يجب إكمال بيانات المركز قبل النشر', true);
      return { ok: false, error: 'business_setup_required_before_publication' };
    }
    if (publicationStepResolved() && readbackStepResolved()) {
      setStatus('✅ النشر إلى السحابة مكتمل ومُتحقق منه');
      return { ok: true, already: true };
    }
    if (publicationStepResolved() && !readbackStepResolved()) {
      publicationInFlight = true;
      setStatus('⏳ جارٍ التحقق من read-back للسحابة...');
      try {
        const verifyOnly = await global.PublicationGateService?.runReadbackVerification?.({ allowWithoutPublication: true });
        if (!verifyOnly?.ok || !readbackStepResolved()) {
          const code = verifyOnly?.error || 'cloud_readback_failed';
          setStatusFromErr({ message: code }, code);
          return { ok: false, error: code, result: verifyOnly };
        }
        setStatus('✅ تم التحقق من السحابة بنجاح');
        return { ok: true, readbackVerification: verifyOnly.readbackVerification };
      } finally {
        publicationInFlight = false;
        renderNavButtons(loadWizard());
      }
    }
    publicationInFlight = true;
    setStatus('⏳ جارٍ نشر الإعداد إلى Google Drive والتحقق...');
    try {
      const result = await global.PublicationGateService?.runSetupPublication?.({
        inFlightGuard: () => publicationInFlight,
      });
      if (!result?.ok) {
        const code = result?.error || result?.lastError?.error || 'publication_failed';
        setStatusFromErr({ message: code }, code);
        return { ok: false, error: code, result };
      }
      const hydrated = await global.SqliteBridge?.hydrateIntoMemory?.();
      if (hydrated && hydrated.ok !== true) {
        throw new Error(hydrated.error || 'publication_hydrate_failed');
      }
      if (!publicationStepResolved()) {
        throw new Error('publication_readback_mismatch');
      }
      if (!readbackStepResolved()) {
        throw new Error('readback_verification_failed');
      }
      setStatus('✅ تم النشر والتحقق من السحابة بنجاح');
      return { ok: true, setupPublication: result.setupPublication || readPublicationState() };
    } catch (e) {
      setStatusFromErr(e);
      return { ok: false, error: e?.message || e?.code || 'publication_failed' };
    } finally {
      publicationInFlight = false;
      renderNavButtons(loadWizard());
    }
  }

  /** @deprecated Stage 11 — use selectExistingBranchOnly + registerDeviceFromForm */
  async function bindExistingBranch() {
    const selected = await selectExistingBranchOnly();
    if (!selected?.ok) return selected;
    return registerDeviceFromForm();
  }

  async function authenticateExistingOwnerFromWizard() {
    if (ownerLoginInFlight) return { ok: false, error: 'owner_login_in_flight' };
    const owner = getUsableOwnerAccount();
    const password = String(document.getElementById('bf-owner-password')?.value || '');
    if (!owner) return { ok: false, error: 'owner_credential_required' };
    if (!password) {
      setStatusFromErr({ message: 'password_required' }, 'password_required');
      return { ok: false, error: 'password_required' };
    }
    if (typeof global.authenticateSetupOwner !== 'function') {
      setStatusFromErr({ message: 'setup_owner_authentication_unavailable' }, 'setup_owner_authentication_unavailable');
      return { ok: false, error: 'setup_owner_authentication_unavailable' };
    }
    ownerLoginInFlight = true;
    setStatus('⏳ جارٍ التحقق من كلمة مرور المالك...');
    try {
      const authenticated = await global.authenticateSetupOwner(owner.id, password);
      if (authenticated?.ok !== true) {
        setStatusFromErr(authenticated || { message: 'setup_owner_authentication_failed' }, authenticated?.error);
        return authenticated || { ok: false, error: 'setup_owner_authentication_failed' };
      }
      const verified = await verifySetupOwnerSession();
      if (!verified.ok) {
        setStatusFromErr(verified, verified.error);
        return verified;
      }
      setStatus('✅ تم التحقق من حساب المالك — يمكن بدء المزامنة');
      return { ok: true, userId: owner.id, sessionBound: true };
    } catch (error) {
      setStatusFromErr(error, error?.code || error?.message || 'setup_owner_authentication_failed');
      return { ok: false, error: error?.code || error?.message || 'setup_owner_authentication_failed' };
    } finally {
      ownerLoginInFlight = false;
      renderNavButtons(loadWizard());
      renderStepUI(loadWizard());
    }
  }

  async function createOwnerFromWizard() {
    if (ownerCreateInFlight()) {
      setStatus('⏳ إنشاء المالك جارٍ — انتظر');
      return { ok: false, error: 'creation_in_progress' };
    }
    if (hasOwnerPasswordAccount()) {
      const verified = await verifySetupOwnerSession();
      if (verified.ok) return { ok: true, already: true, sessionBound: true };
      setStatusFromErr({ message: 'owner_session_required' }, 'owner_session_required');
      renderStepUI(loadWizard());
      return verified;
    }
    const busy = global.OwnerManagement?.getSystemBusyReason?.();
    if (busy === 'restore' || busy === 'sync' || busy === 'license_refresh') {
      setStatus('⚠️ انتظر انتهاء ' + busy + ' قبل إنشاء Owner', true);
      return { ok: false, error: 'system_busy', busy };
    }
    setStatus('⏳ جارٍ إنشاء حساب المالك...');
    try {
      // Single create path + single lock inside OwnerManagement.createOwner
      let res;
      if (global.OwnerManagement?.createOwner) {
        res = await global.OwnerManagement.createOwner({ idPrefix: 'ocf' });
      } else {
        res = await global.OwnerCreateForm?.createOwnerFromForm?.('ocf');
      }
      if (!res?.ok) {
        setStatusFromErr(res, res?.code || res?.error);
        return res || { ok: false };
      }
      const owner = getUsableOwnerAccount();
      const activated = global.activateSetupOwnerIdentity?.(res.userId || owner?.id);
      if (activated?.ok === false) {
        setStatusFromErr(activated, activated.error);
        return { ...activated, committed: true };
      }
      const verified = await verifySetupOwnerSession();
      if (!verified.ok) {
        setStatusFromErr(verified, verified.error);
        return { ...verified, committed: true };
      }
      try { global.OwnerSetupState?.clearRequired?.(); } catch { /* empty */ }
      try { global.OwnerManagement?.clearBootstrapOpenRequest?.(); } catch { /* empty */ }
      try { await global.OwnerManagement?.retireOwnerSeedsIfNeeded?.(); } catch { /* idempotent */ }
      setStatus('✅ تم إنشاء حساب المالك (Owner)');
      try { global.OwnerHub?.applyNavVisibility?.(); } catch { /* empty */ }
      return res;
    } catch (e) {
      setStatusFromErr(e);
      return { ok: false };
    } finally {
      renderNavButtons(loadWizard());
      renderStepUI(loadWizard());
    }
  }

  async function restoreLocalBackupDuringSetup() {
    const api = global.cuppingElectron?.backup || global.tadawiElectron?.backup || global.tadawi?.backup;
    if (!api?.v2PickFile || !api?.v2SetupLocalRestore) {
      return { ok: false, error: 'backup_v2_setup_restore_unavailable' };
    }
    const picked = await api.v2PickFile({ allowLegacy: true });
    if (!picked?.ok || !picked.filePath) return { ok: false, canceled: true, error: 'file_not_selected' };
    let password = typeof global.getBackupV2Password === 'function' ? await global.getBackupV2Password() : '';
    const execute = async () => {
      try {
        return await api.v2SetupLocalRestore({
          filePath: picked.filePath,
          password,
          setupMode: true,
          relaunch: false,
          ...(typeof global.getBackupV2IdentityMeta === 'function' ? global.getBackupV2IdentityMeta() : {})
        });
      } catch (error) {
        if (/password|decrypt|authentication|scrypt/i.test(String(error?.code || error?.message || error))) {
          password = typeof global.openBackupPasswordModal === 'function'
            ? await global.openBackupPasswordModal('أدخل كلمة مرور Backup V2:')
            : '';
          if (!password) return { ok: false, canceled: true, error: 'backup_password_required' };
          return api.v2SetupLocalRestore({
            filePath: picked.filePath,
            password,
            setupMode: true,
            relaunch: false,
            ...(typeof global.getBackupV2IdentityMeta === 'function' ? global.getBackupV2IdentityMeta() : {})
          });
        }
        return { ok: false, error: error?.code || error?.message || String(error) };
      }
    };
    const result = global.OpsUxBridge?.runRestoreWizardFlow
      ? await global.OpsUxBridge.runRestoreWizardFlow({
        point: { id: picked.filePath, path: picked.filePath, label: picked.filePath },
        execute
      })
      : await execute();
    if (result?.ok !== true) return result || { ok: false, error: 'local_restore_failed' };
    const hydrated = await global.SqliteBridge?.hydrateIntoMemory?.();
    if (hydrated && hydrated.ok !== true) return { ok: false, error: hydrated.error || 'restore_hydrate_failed' };
    return { ok: true, filePath: picked.filePath, restartRequired: true };
  }

  function renderStepUI(w) {
    w = getDisplayWizard(w);
    const frame = describeCurrentStep(w);
    const step = frame.stepId;
    const content = document.getElementById('bf-step-content');
    const actions = document.getElementById('bf-step-actions');
    if (!content || !actions) return;
    try {
      if (typeof content.setAttribute === 'function') content.setAttribute('data-step-id', step || '');
      else if (content.dataset) content.dataset.stepId = step || '';
    } catch { /* DOM stubs in unit tests */ }
    content.innerHTML = '';
    actions.innerHTML = '';

    switch (step) {
      case 'language': {
        content.innerHTML = '<p class="bf-lead">اختر لغة الواجهة</p><div class="bf-lang-row" id="bf-lang-row"></div>';
        const row = content.querySelector('#bf-lang-row');
        [['ar', 'العربية'], ['en', 'English']].forEach(([code, label]) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn ' + ((w.lang || 'ar') === code ? 'btn-primary' : 'btn-secondary');
          b.textContent = label;
          b.onclick = () => {
            w.lang = code;
            saveWizard(w);
            try { localStorage.setItem(LANG_KEY, code); } catch { /* empty */ }
            global.UxI18n?.setLang?.(code);
            global.UxI18n?.applyDocumentLang?.(document, code);
            setStatus(code === 'ar' ? '✅ العربية' : '✅ English');
            renderProgress(loadWizard());
            renderNavButtons(loadWizard());
            renderStepUI(loadWizard());
          };
          row.appendChild(b);
        });
        break;
      }
      case 'google': {
        const isNew = w.path === PATHS.NEW;
        content.innerHTML = isNew
          ? '<p>بعد اكتمال التفعيل، اربط حساب Google للنسخ الاحتياطي والمزامنة السحابية (اتصال فقط).</p><div id="bf-google-email" class="bf-lead" dir="ltr"></div>'
          : '<p>اربط حساب Google الخاص بالمركز. الاكتشاف يتم في الخطوة التالية.</p><div id="bf-google-email" class="bf-lead" dir="ltr"></div>';
        const emailEl = content.querySelector('#bf-google-email');
        const provEmail = global.settings?.backup?.providers?.google?.email || '';
        const connected = hasGoogle();
        if (connected && provEmail) emailEl.textContent = '✅ ' + provEmail;
        else if (connected) emailEl.textContent = '✅ Google متصل';
        if (!connected) {
          const btn = addBtn(actions, oauthInFlight ? '⏳ جارٍ الربط...' : '🔗 ربط Google', 'btn-primary', () => runGoogleConnect(), oauthInFlight || (isNew && !hasValidLicense()));
          btn.id = 'bf-google-connect-btn';
        } else {
          // Connected: never hide account controls behind a stale render.
          const changeBtn = addBtn(actions, 'تبديل حساب Google', 'btn-secondary', async () => {
            if (!confirm('فصل حساب Google الحالي وتسجيل حساب آخر؟ لن تُحذف بيانات الترخيص أو SQLite المحلية.')) return;
            const result = await disconnectGoogleDuringSetup();
            if (!result?.ok) setStatusFromErr(result, result?.error || 'google_disconnect_failed', { stepId: 'google' });
            else {
              renderAll(loadWizard());
            }
          });
          changeBtn.id = 'bf-google-change-btn';
          const discBtn = addBtn(actions, 'فصل حساب Google', 'btn-ghost', async () => {
            if (!confirm('فصل حساب Google الحالي؟ لن تُحذف بيانات الترخيص أو SQLite المحلية.')) return;
            const result = await disconnectGoogleDuringSetup();
            if (!result?.ok) setStatusFromErr(result, result?.error || 'google_disconnect_failed', { stepId: 'google' });
            else renderAll(loadWizard());
          });
          discBtn.id = 'bf-google-disconnect-btn';
        }
        if (connected) setStatus(isNew ? '✅ Google متصل — تابع لخطوة الاكتشاف' : '✅ Google متصل — تابع لخطوة الاكتشاف');
        else if (w.googleSessionConnected && !global.settings?.backup?.providers?.google?.userDisconnected) {
          refreshGoogleConnectionState({ acceptLiveReconnect: true }).then((state) => {
            if (state?.connected || hasGoogle()) {
              setStatus('✅ Google متصل — تابع لخطوة الاكتشاف');
              renderAll(loadWizard());
            }
          });
        }
        else if (isNew && !hasValidLicense()) setStatus('أكمل التفعيل في الخطوة السابقة أولاً', true);
        break;
      }
      case 'discovery': {
        content.innerHTML = `
          <p>فحص read-only للمؤسسة والترخيص والنسخ والفروع على السحابة — بلا إنشاء أو استعادة.</p>
          <div id="bf-discovery-gate-status" class="bf-source-meta">⏳ جارٍ الاكتشاف…</div>
          <div id="bf-discovery-gate-summary" class="bf-source-meta" style="margin-top:8px"></div>`;
        const statusHost = content.querySelector('#bf-discovery-gate-status');
        const summaryHost = content.querySelector('#bf-discovery-gate-summary');
        const renderSummary = (result) => {
          if (!summaryHost || !result) return;
          const orgs = result.organizationCandidates?.length || 0;
          const lics = result.licenseCandidates?.length || 0;
          const backups = result.backupCandidates?.length || 0;
          // Show unique cloud-authorized branches, not raw evidence rows. The
          // raw list holds one entry per piece of evidence (including the
          // local data_discovery echo), which is why a single branch used to
          // be reported as "فروع: 2".
          const uniqueBranches = eligibleBranchCount();
          summaryHost.textContent = `الحالة: ${result.status || '—'} · مؤسسات: ${orgs} · تراخيص: ${lics} · نسخ: ${backups} · فروع: ${uniqueBranches}`;
        };
        addBtn(actions, discoveryInFlight ? '⏳ جارٍ الاكتشاف...' : '🔍 إعادة الفحص', 'btn-primary', async () => {
          if (discoveryInFlight) return;
          if (statusHost) statusHost.textContent = '⏳ جارٍ إعادة الفحص...';
          const r = await runDiscoveryGate({ forceRefresh: true });
          if (statusHost) {
            statusHost.textContent = r.ok
              ? '✅ اكتمل الاكتشاف'
              : ('❌ ' + (r.error || 'discovery_failed') + (r.retryable ? ' — قابل لإعادة المحاولة' : ''));
          }
          if (r.discovery) renderSummary(r.discovery);
          renderNavButtons(loadWizard());
          renderChecklist(getDisplayWizard(loadWizard()));
        }, discoveryInFlight || !hasGoogle());
        if (hasDiscoveryResolved()) {
          const cached = global.PostGoogleCloudDiscovery?.getCachedDiscovery?.();
          if (statusHost) statusHost.textContent = '✅ اكتمل الاكتشاف سابقاً';
          renderSummary(cached);
          setStatus('✅ الاكتشاف مكتمل — تابع');
          clearChecklistStepError('discovery');
          reconcileBranchSelectionAfterDiscovery();
        } else if (hasGoogle()) {
          clearChecklistStepError('discovery');
          setStatus('🔍 جارٍ اكتشاف بيانات السحابة (read-only)...', false);
          runDiscoveryGate().then((r) => {
            if (statusHost) {
              statusHost.textContent = r.ok ? '✅ اكتمل الاكتشاف' : ('❌ ' + (r.error || 'discovery_failed'));
            }
            if (r.discovery) renderSummary(r.discovery);
            if (r.ok) reconcileBranchSelectionAfterDiscovery();
            renderNavButtons(loadWizard());
            renderChecklist(getDisplayWizard(loadWizard()));
          });
        } else {
          if (statusHost) statusHost.textContent = '⚠️ اربط Google أولاً';
        }
        break;
      }
      case 'path_decision': {
        const PG = global.PostGoogleCloudDiscovery;
        const discovery = getCachedDiscoveryResult();
        const classification = discovery?.forkClassification || PG?.classifyForkScenario?.(discovery);
        const forkRequired = !!(PG?.requiresPathFork?.(classification));
        const candidates = forkCandidateList(discovery);
        const wLive = loadWizard();
        let forkMessage = 'تم العثور على بيانات سابقة مرتبطة بحساب Google هذا.';
        if (classification === PG?.FORK_LICENSE_ONLY) {
          forkMessage += ' وُجد ترخيص سحابي — قد لا تكون كل بيانات المؤسسة مكتملة بعد.';
        } else if (classification === PG?.FORK_BACKUP_ONLY) {
          forkMessage += ' وُجدت نسخة احتياطية — قد تحتاج استعادة لاحقاً.';
        } else if (classification === PG?.FORK_PARTIAL) {
          forkMessage += ' وُجدت بيانات جزئية — قد يلزم استكمال الاسترداد لاحقاً.';
        } else if (classification === PG?.FORK_AMBIGUOUS) {
          forkMessage += ' وُجد أكثر من مؤسسة — اختر المؤسسة الصحيحة أولاً.';
        }
        content.innerHTML = `
          <p class="bf-lead">${forkRequired ? forkMessage : 'لا توجد بيانات سابقة — متابعة إعداد جديد.'}</p>
          <div id="bf-fork-candidates" class="bf-choice-actions"></div>
          <div id="bf-fork-status" class="bf-source-meta" style="margin-top:8px"></div>`;
        const candidateHost = content.querySelector('#bf-fork-candidates');
        const statusHost = content.querySelector('#bf-fork-status');
        let selectedId = wLive.forkSelectedCandidateId || wLive.selectedCandidateId || null;
        const renderCandidateButtons = () => {
          if (!candidateHost || candidates.length <= 1) {
            if (candidateHost) candidateHost.innerHTML = '';
            return;
          }
          candidateHost.innerHTML = '';
          candidates.forEach((c) => {
            const label = c.centerName || c.centerId || c.id || 'مرشح';
            const btn = addBtn(candidateHost, (selectedId === c.id ? '✓ ' : '') + label, selectedId === c.id ? 'btn-primary' : 'btn-secondary', () => {
              selectedId = c.id;
              wLive.forkSelectedCandidateId = c.id;
              saveWizard(wLive);
              renderCandidateButtons();
              renderNavButtons(loadWizard());
            });
            btn.type = 'button';
          });
        };
        renderCandidateButtons();
        if (forkRequired) {
          const useExistingDisabled = candidates.length > 1 && !selectedId;
          addBtn(actions, 'استخدام البيانات الموجودة', 'btn-primary', async () => {
            const r = commitForkUseExisting(selectedId);
            if (!r?.ok) {
              setStatus('⚠️ اختر المؤسسة/الترخيص الصحيح أولاً', true);
              if (statusHost) statusHost.textContent = 'يلزم اختيار مرشح واحد قبل المتابعة.';
              return;
            }
            setStatus('✅ تم اختيار استخدام البيانات الموجودة — متابعة مسار الاسترداد');
            renderProgress(loadWizard());
            renderNavButtons(loadWizard());
            renderStepUI(loadWizard());
          }, useExistingDisabled);
          addBtn(actions, 'بدء إعداد جديد', 'btn-secondary', () => {
            const r = commitForkStartNew();
            if (statusHost) statusHost.textContent = r.ok ? '✅ بدء إعداد جديد' : '';
            setStatus('✅ بدء إعداد جديد — متابعة إنشاء المؤسسة');
            renderProgress(loadWizard());
            renderNavButtons(loadWizard());
            renderStepUI(loadWizard());
          });
        } else if (!wLive.completedSteps.includes('path_decision')) {
          wLive.completedSteps.push('path_decision');
          wLive.pathDecisionResolvedAt = new Date().toISOString();
          saveWizard(wLive);
        }
        if (wLive.forkDecision === 'use_existing') {
          if (statusHost) statusHost.textContent = '✅ اختيار سابق: استخدام البيانات الموجودة';
        } else if (wLive.forkDecision === 'start_new') {
          if (statusHost) statusHost.textContent = '✅ اختيار سابق: بدء إعداد جديد';
        }
        break;
      }
      case 'license_org_recovery': {
        content.innerHTML = `
          <p><strong>استرداد الترخيص والمؤسسة</strong> من السحابة — بلا تفعيل يدوي ولا إنشاء مؤسسة جديدة.</p>
          <p class="bf-source-meta">يتم سحب الترخيص والهوية المؤسسية من Google Drive وفق اكتشاف السحابة.</p>
          <div id="bf-license-recovery-status" class="bf-source-meta"></div>`;
        if (licenseOrgRecoveryResolved()) {
          const lic = global.LicenseCloud?.loadLocal?.() || {};
          setStatus('✅ تم استرداد الترخيص والمؤسسة');
          content.querySelector('#bf-license-recovery-status').textContent =
            `Center: ${lic.centerId || '—'} / ${lic.centerName || global.settings?.centerName || '—'}`;
        }
        addBtn(actions, licenseActivateInFlight ? '⏳ جارٍ الاسترداد...' : '☁️ استرداد من السحابة', 'btn-primary', async () => {
          const r = await runLicenseOrgRecovery({ forceDriveRescan: true });
          if (!r?.ok) {
            if (r?.error === 'existing_business_not_found') {
              setStatus('⚠️ لم تُعثر على مؤسسة موجودة — يمكنك العودة واختيار بدء إعداد جديد', true);
            } else if (r?.error === 'existing_candidate_ambiguous') {
              setStatus('⚠️ أكثر من مؤسسة — اختر المرشح من خطوة المسار أولاً', true);
            } else {
              setStatusFromErr(r, r?.error || 'existing_license_recovery_failed');
            }
            return;
          }
          setStatus('✅ تم استرداد الترخيص والمؤسسة بنجاح');
          renderNavButtons(loadWizard());
          renderStepUI(loadWizard());
        }, licenseActivateInFlight || !hasDiscoveryResolved());
        break;
      }
      case 'license': {
        const isNew = w.path === PATHS.NEW;
        content.innerHTML = `
          <p>${hasValidLicense()
    ? '✅ التفعيل مكتمل.'
    : (isNew
      ? 'أدخل مفتاح التفعيل. التحقق المحلي/Sheets لا يتطلب ربط Google Drive للعميل.'
      : 'لم يُعثر على تفعيل تلقائي — أدخل مفتاح الترخيص.')}</p>
          <label for="bf-license-key">مفتاح التفعيل</label>
          <input type="text" id="bf-license-key" class="form-control" dir="ltr" autocomplete="off" placeholder="XXXX-XXXX-...">
          <div id="bf-license-candidates" style="display:none;margin-top:8px"></div>`;
        const keyInput = content.querySelector('#bf-license-key');
        keyInput?.addEventListener('paste', () => {
          setTimeout(() => {
            let pasted = String(keyInput.value || '').replace(/\s+/g, '').trim();
            if (!/^TDW6\./.test(pasted)) pasted = pasted.toUpperCase();
            keyInput.value = pasted;
          }, 0);
        });
        addBtn(actions, licenseActivateInFlight ? '⏳ جارٍ التفعيل...' : '✅ تحقق وتفعيل', 'btn-primary', () => activateLicenseKey(), licenseActivateInFlight);
        if (!isNew || hasGoogle()) {
          addBtn(actions, '🔁 إعادة فحص Drive وتطبيق الترخيص', 'btn-secondary', async () => {
            setStatus('⏳ جارٍ إعادة الفحص وتطبيق الترخيص...');
            await autoDiscoverActivationAfterGoogle({ forceDriveRescan: true });
            renderNavButtons(loadWizard());
          });
        }
        if (hasValidLicense()) setStatus('✅ الترخيص صالح');
        break;
      }
      case 'organization': {
        const lic = global.LicenseCloud?.loadLocal?.() || {};
        const cid = lic.centerId || global.CenterId?.getStoredCenterId?.() || '';
        const cname = lic.centerName || global.settings?.centerName || '';
        content.innerHTML = `
          <p>المؤسسة المصرّح بها من الترخيص:</p>
          <div class="form-group"><label>Center ID</label><input class="form-control" id="bf-org-id" dir="ltr" value="${String(cid).replace(/"/g, '&quot;')}" readonly></div>
          <div class="form-group"><label>اسم المؤسسة</label><input class="form-control" id="bf-org-name" value="${String(cname).replace(/"/g, '&quot;')}"></div>`;
        addBtn(actions, '💾 تأكيد المؤسسة', 'btn-primary', async () => {
          const name = String(document.getElementById('bf-org-name')?.value || '').trim();
          if (!name) { setStatus('⚠️ أدخل اسم المؤسسة', true); return; }
          try {
            await commitSetupOrganizationDevice({ centerName: name });
          } catch (error) {
            setStatusFromErr(error);
            return;
          }
          setStatus('✅ تم تأكيد المؤسسة');
          renderNavButtons(loadWizard());
        });
        if (hasCenterData()) setStatus('✅ بيانات المؤسسة جاهزة');
        break;
      }
      case 'branch': {
        if (newBranchRequiresOwner()) {
          content.innerHTML = '<p class="tdw-field-error">يجب إكمال خطوة حساب المالك قبل إنشاء أول فرع.</p>';
          setStatus('⚠️ أنشئ حساب المالك أولاً', true);
          break;
        }
        if (hasBranch() && getSelectedBranchId()) {
          content.innerHTML = '<p>✅ الفرع جاهز. تابع إلى خطوة تسجيل الجهاز.</p>';
          setStatus('✅ الفرع محدد');
          break;
        }
        content.innerHTML = `
          <p><strong>إنشاء أول فرع</strong> — لا توجد فروع بعد.</p>
          <div class="form-group"><label>اسم الفرع (عربي) *</label><input id="bf-branch-name-ar" class="form-control" required></div>
          <div class="form-group"><label>الاسم بالإنجليزية</label><input id="bf-branch-name-en" class="form-control" dir="ltr"></div>
          <div class="form-group"><label>رمز الفرع</label><input id="bf-branch-code" class="form-control" dir="ltr" placeholder="BR-MAIN"></div>
          <div class="form-group"><label>المدينة</label><input id="bf-branch-city" class="form-control"></div>
          <div class="form-group"><label>الهاتف</label><input id="bf-branch-phone" class="form-control" dir="ltr"></div>
          <select id="bf-branch-id" class="form-control" hidden></select>`;
        addBtn(actions, branchCreateInFlight ? '⏳ جارٍ الإنشاء...' : '➕ إنشاء أول فرع', 'btn-primary', () => createFirstBranchFromForm(), branchCreateInFlight);
        break;
      }
      case 'branch_select': {
        const lic = global.LicenseCloud?.loadLocal?.() || {};
        const orgLabel = lic.centerName || global.settings?.centerName || lic.centerId || '—';
        content.innerHTML = `
          <p><strong>اختيار فرع موجود</strong> — تسجيل الجهاز في الخطوة التالية.</p>
          <p class="bf-source-meta">المؤسسة المستردة: <strong>${String(orgLabel).replace(/</g, '&lt;')}</strong>${lic.centerId ? ` · ${String(lic.centerId).replace(/</g, '&lt;')}` : ''}</p>
          <div class="form-group"><label>الفرع الموجود</label><select id="bf-branch-id" class="form-control"></select></div>`;
        populateBootstrapBranchSelect('bf');
        const selection = currentBranchSelection();
        if (selection?.branchId) {
          const sel = document.getElementById('bf-branch-id');
          if (sel) sel.value = selection.branchId;
        }
        const branchCount = eligibleBranchCount();
        if (!hasBranch()) {
          content.innerHTML += '<p class="tdw-field-error">لا توجد فروع معتمدة من السحابة لهذه المؤسسة — أعد فحص الاكتشاف أو ارجع لمسار عميل جديد.</p>';
        } else if (!selection) {
          content.innerHTML += `<p class="bf-source-meta">وُجد ${branchCount} فرع معتمد. اختر الفرع الذي يعمل عليه هذا الجهاز ثم اضغط «تأكيد اختيار الفرع» — لا يتم الاختيار تلقائياً.</p>`;
        }
        addBtn(actions, branchBindInFlight ? '⏳ جارٍ التأكيد...' : '✅ تأكيد اختيار الفرع', 'btn-primary', () => selectExistingBranchOnly(), !hasBranch() || branchBindInFlight);
        if (selection?.branchId) setStatus(`✅ تم اختيار الفرع ${selection.branchId}`);
        else if (hasBranch()) setStatus(`اختر الفرع من القائمة ثم اضغط «تأكيد اختيار الفرع» (${branchCount} فرع متاح)`, false);
        break;
      }
      case 'device': {
        if (!hasBranch() || !getSelectedBranchId()) {
          content.innerHTML = '<p class="tdw-field-error">يجب اختيار/إنشاء فرع قبل تسجيل الجهاز.</p>';
          setStatus('⚠️ الفرع مطلوب أولاً', true);
          break;
        }
        if (deviceStepResolved()) {
          const rb = readDeviceCommitState();
          content.innerHTML = `<p>✅ الجهاز مسجل ومرتبط بالفرع.</p>
            <p class="bf-source-meta">Device: ${rb.deviceName} · Branch: ${rb.branchId}</p>`;
          setStatus('✅ الجهاز جاهز');
          break;
        }
        content.innerHTML = `
          <p><strong>تسجيل الجهاز</strong> للفرع المحدد.</p>
          <div class="form-group"><label>اسم هذا الجهاز *</label><input id="bf-device-name" class="form-control" placeholder="Reception-PC"></div>
          <p class="bf-source-meta">الفرع: ${getSelectedBranchId()}</p>`;
        addBtn(actions, deviceRegisterInFlight ? '⏳ جارٍ التسجيل...' : '🖥️ تسجيل الجهاز', 'btn-primary', () => registerDeviceFromForm(), deviceRegisterInFlight);
        break;
      }
      case 'business_setup': {
        if (!deviceStepResolved()) {
          content.innerHTML = '<p class="tdw-field-error">يجب إكمال تسجيل الجهاز قبل إعداد بيانات المركز.</p>';
          setStatus('⚠️ الجهاز مطلوب أولاً', true);
          break;
        }
        const snap = readBusinessSetupState();
        if (businessSetupStepResolved()) {
          content.innerHTML = `<p>✅ بيانات المركز مكتملة.</p>
            <p class="bf-source-meta">${snap.centerName} · ${snap.phone}</p>`;
          setStatus('✅ بيانات المركز جاهزة');
          break;
        }
        const lic = global.LicenseCloud?.loadLocal?.() || {};
        content.innerHTML = `
          <p><strong>إعداد بيانات المركز</strong> — الحد الأدنى المطلوب للتشغيل.</p>
          <div class="form-group"><label>اسم المركز *</label><input id="bf-business-center-name" class="form-control" value="${String(snap.centerName || lic.centerName || '').replace(/"/g, '&quot;')}"></div>
          <div class="form-group"><label>الاسم بالإنجليزية</label><input id="bf-business-center-name-en" class="form-control" dir="ltr" value="${String(global.settings?.centerNameEn || '').replace(/"/g, '&quot;')}"></div>
          <div class="form-group"><label>هاتف المركز *</label><input id="bf-business-phone" class="form-control" dir="ltr" value="${String(snap.phone || '').replace(/"/g, '&quot;')}"></div>
          <div class="form-group"><label>العنوان</label><input id="bf-business-address" class="form-control" value="${String(snap.address || '').replace(/"/g, '&quot;')}"></div>
          <div class="form-group"><label>المدينة</label><input id="bf-business-city" class="form-control" value="${String(snap.centerCity || '').replace(/"/g, '&quot;')}"></div>
          <p class="bf-source-meta">لا تُقبل الأسماء الافتراضية مثل «مركز الحجامة».</p>`;
        addBtn(actions, businessSetupInFlight ? '⏳ جارٍ الحفظ...' : '💾 حفظ بيانات المركز', 'btn-primary', () => commitBusinessSetupFromForm(), businessSetupInFlight);
        break;
      }
      case 'publication': {
        if (!businessSetupStepResolved()) {
          content.innerHTML = '<p class="tdw-field-error">يجب إكمال بيانات المركز قبل النشر إلى السحابة.</p>';
          setStatus('⚠️ بيانات المركز مطلوبة أولاً', true);
          break;
        }
        const pub = readPublicationState();
        if (publicationStepResolved()) {
          const arts = Object.entries(pub?.artifacts || {}).filter(([, v]) => v?.ok).map(([k]) => k).join(', ');
          content.innerHTML = `<p>✅ تم نشر الإعداد والتحقق من السحابة.</p>
            <p class="bf-source-meta">${arts || 'verified'}</p>`;
          setStatus('✅ النشر مكتمل');
          break;
        }
        const scope = global.PublicationContract?.requiredArtifactsForPath?.(w.path) || [];
        content.innerHTML = `
          <p><strong>نشر الإعداد إلى Google Drive</strong> مع تحقق read-back حقيقي.</p>
          <p class="bf-source-meta">النطاق: ${scope.join(' → ')}</p>
          <p class="bf-source-meta">لن يُعتبر النشر مكتملاً بدون تطابق read-back من السحابة.</p>`;
        addBtn(actions, publicationInFlight ? '⏳ جارٍ النشر...' : '☁️ نشر والتحقق', 'btn-primary', () => commitPublicationFromWizard(), publicationInFlight);
        break;
      }
      case 'owner_auth': {
        const owner = getUsableOwnerAccount();
        if (!hasOwnerPasswordAccount()) {
          content.innerHTML = '<p class="tdw-field-error">لا يوجد مالك مسترد بعد — أكمل الاستعادة أولاً.</p>';
          setStatus('⚠️ existing_owner_auth_required', true);
          break;
        }
        if (setupOwnerSessionReady()) {
          content.innerHTML = '<p>✅ تم التحقق من حساب المالك لهذه الجلسة.</p>';
          setStatus('✅ Owner auth جاهز');
        } else {
          content.innerHTML = `
            <p>تحقق من حساب المالك الحالي — <strong>ليس إنشاء مالك جديد</strong>.</p>
            <div class="form-group"><label>حساب المالك</label><div id="bf-owner-account" class="form-control" dir="ltr"></div></div>
            <div class="form-group"><label for="bf-owner-password">كلمة مرور المالك الحالية</label><input type="password" id="bf-owner-password" class="form-control" autocomplete="current-password"></div>`;
          const account = content.querySelector('#bf-owner-account');
          if (account) account.textContent = String(owner?.username || owner?.fullName || 'Owner');
          addBtn(actions, ownerLoginInFlight ? '⏳ جارٍ التحقق...' : '🔐 تحقق من حساب المالك', 'btn-primary', () => authenticateExistingOwnerFromWizard(), ownerLoginInFlight);
          setStatus('يجب التحقق من كلمة مرور المالك قبل المزامنة', true);
        }
        break;
      }
      case 'owner': {
        const st = global.OwnerManagement?.getOwnerState?.()?.state;
        const preferOwnerCreation = isNewFreshStartPath() && !ownerCredentialCommitted();
        if (preferOwnerCreation) {
          if (st === 'OWNER_CREATION_IN_PROGRESS') {
            content.innerHTML = '<p>⏳ إنشاء المالك جارٍ — لا تبدأ عملية ثانية.</p>';
            setStatus('⏳ جارٍ إنشاء حساب المالك...');
          } else {
            const label = (st === 'OWNER_CORRUPTED' || st === 'OWNER_RECOVERY_REQUIRED')
              ? 'استرداد / إصلاح حساب المالك — كلمة المرور إلزامية.'
              : 'أنشئ حساب المالك المستقل — كلمة المرور إلزامية.';
            content.innerHTML = `<p>${label}</p>`
              + (global.OwnerCreateForm?.renderFormHtml?.({ idPrefix: 'ocf' }) || '<p>OwnerCreateForm غير محمّل</p>');
            global.OwnerCreateForm?.bindPasswordToggles?.(content);
            const creating = ownerCreateInFlight();
            addBtn(actions, creating ? '⏳ جارٍ الإنشاء...' : '👤 إنشاء حساب المالك', 'btn-primary', () => createOwnerFromWizard(), creating);
          }
          break;
        }
        if (st === 'OWNER_EXISTS' || hasOwnerPasswordAccount()) {
          const owner = getUsableOwnerAccount();
          if (setupOwnerSessionReady()) {
            content.innerHTML = '<p>✅ تم التحقق من حساب المالك لهذه الجلسة. يمكنك المتابعة.</p>';
            setStatus('✅ Owner جاهز');
          } else {
            content.innerHTML = `
              <p>حساب المالك موجود بالفعل. أدخل كلمة المرور الحالية للمتابعة دون إنشاء الحساب أو تغييرها.</p>
              <div class="form-group"><label>حساب المالك</label><div id="bf-owner-account" class="form-control" dir="ltr"></div></div>
              <div class="form-group"><label for="bf-owner-password">كلمة مرور المالك الحالية</label><input type="password" id="bf-owner-password" class="form-control" autocomplete="current-password"></div>`;
            const account = content.querySelector('#bf-owner-account');
            if (account) account.textContent = String(owner?.username || owner?.fullName || 'Owner');
            addBtn(actions, ownerLoginInFlight ? '⏳ جارٍ التحقق...' : '🔐 تحقق من حساب المالك', 'btn-primary', () => authenticateExistingOwnerFromWizard(), ownerLoginInFlight);
            setStatus('يجب التحقق من كلمة مرور المالك قبل بدء المزامنة', true);
          }
        } else if (st === 'OWNER_CREATION_IN_PROGRESS') {
          content.innerHTML = '<p>⏳ إنشاء المالك جارٍ — لا تبدأ عملية ثانية.</p>';
          setStatus('⏳ جارٍ إنشاء حساب المالك...');
        } else {
          const label = (st === 'OWNER_CORRUPTED' || st === 'OWNER_RECOVERY_REQUIRED')
            ? 'استرداد / إصلاح حساب المالك — كلمة المرور إلزامية.'
            : 'أنشئ حساب المالك المستقل — كلمة المرور إلزامية.';
          content.innerHTML = `<p>${label}</p>`
            + (global.OwnerCreateForm?.renderFormHtml?.({ idPrefix: 'ocf' }) || '<p>OwnerCreateForm غير محمّل</p>');
          global.OwnerCreateForm?.bindPasswordToggles?.(content);
          const creating = ownerCreateInFlight();
          addBtn(actions, creating ? '⏳ جارٍ الإنشاء...' : '👤 إنشاء حساب المالك', 'btn-primary', () => createOwnerFromWizard(), creating);
        }
        break;
      }
      case 'restore': {
        const wRestore = loadWizard();
        const startNewNote = wRestore.forkDecision === 'start_new'
          ? '<p class="bf-source-meta">أنت على مسار <strong>بدء إعداد جديد</strong> — لن يتم استعادة بيانات العمل السابقة تلقائيًا.</p>'
          : '';
        // Fast Discovery (metadata) then Confirmed Restore — never silent infinite loader.
        content.innerHTML = `
          ${startNewNote}
          <p><strong>اختر مصدر البيانات</strong> — يتم فحص الخيارات المتاحة بسرعة قبل أي تنزيل.</p>
          <div id="bf-discovery-status" class="bf-source-meta">⏳ جارٍ فحص مصادر البيانات (بدون تنزيل)…</div>
          <div class="bf-choice-actions" id="bf-restore-choices" style="display:grid;gap:10px;margin-top:10px"></div>
          <div id="bf-restore-progress-host"></div>`;
        const choiceHost = content.querySelector('#bf-restore-choices') || content;
        const statusEl = content.querySelector('#bf-discovery-status');
        const progressHost = content.querySelector('#bf-restore-progress-host');
        const Discovery = global.CloudDataDiscovery;

        const markRestore = (choice, msg, meta = {}) => {
          const w2 = loadWizard();
          w2.restoreChoice = choice;
          w2.restoreVerifiedDatabase = meta.verifiedDatabase === true;
          w2.restoreMode = meta.mode || null;
          w2.cloudDiscovery = Discovery?.getLastDiscovery?.() || w2.cloudDiscovery || null;
          saveWizard(w2);
          setStatus(msg);
          renderNavButtons(loadWizard());
        };

        const reconcileAndSelectLocal = async (choice, successMessage, meta = {}) => {
          if (!global.RestoreReconciliation?.afterRestoreDataSourceSelected) {
            setStatusFromErr({ message: 'restore_reconcile_unavailable' }, 'restore_reconcile_unavailable');
            return false;
          }
          setStatus('⏳ مواءمة البيانات المحلية مع السحابة (سحب الأحدث بلا رفع فوري)...');
          const reconciled = await global.RestoreReconciliation.afterRestoreDataSourceSelected(choice);
          if (reconciled?.ok !== true) {
            setStatusFromErr(
              { message: reconciled?.error || 'restore_reconcile_incomplete' },
              reconciled?.error || 'restore_reconcile_incomplete'
            );
            return false;
          }
          markRestore(choice, successMessage, meta);
          return true;
        };

        const renderProgress = (snap) => {
          if (!progressHost || !snap) return;
          const stageLine = snap.stageCount
            ? `${snap.stageIndex || 0}/${snap.stageCount} — ${snap.stageLabel || '—'}`
            : (snap.stageLabel || 'فحص مصادر البيانات');
          const pctLabel = snap.indeterminate ? '…' : `${snap.percent || 0}%`;
          const barWidth = snap.indeterminate ? '100%' : `${snap.percent || 0}%`;
          const barPulse = snap.indeterminate ? 'animation:bf-indeterminate 1.2s ease-in-out infinite alternate' : '';
          // Overall restore progress and file download are reported separately.
          // Weighted stage progress must never be shown where it reads as
          // network download progress (this is what rendered a fake 13%).
          const bytesDone = Number(snap.downloadedBytes) || 0;
          const bytesTotal = Number(snap.totalBytes) || 0;
          const isDownloadStage = snap.stageId === 'download_db' || snap.stageId === 'download_state';
          let downloadLine = '';
          if (isDownloadStage || bytesDone > 0) {
            if (bytesDone <= 0) {
              downloadLine = `<div class="bf-source-meta" style="margin-top:4px">تنزيل الملف: بدء تنزيل النسخة...${bytesTotal ? ` (الحجم المتوقع ${Discovery.formatBytes(bytesTotal)})` : ''}</div>`;
            } else {
              const bytePct = bytesTotal ? Math.min(100, Math.round((bytesDone / bytesTotal) * 100)) : null;
              downloadLine = `<div class="bf-source-meta" style="margin-top:4px">تنزيل الملف: <span dir="ltr">${Discovery.formatBytes(bytesDone)}${bytesTotal ? ` / ${Discovery.formatBytes(bytesTotal)}` : ''}</span>${bytePct != null ? ` — ${bytePct}%` : ''}</div>`;
            }
          }
          progressHost.innerHTML = `<div class="bf-restore-progress" dir="rtl">
            <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px">
              <span>التقدم الكلي: ${stageLine}</span>
              <strong dir="ltr">${pctLabel}</strong>
            </div>
            <div class="bar"><i style="width:${barWidth};opacity:${snap.indeterminate ? 0.45 : 1};${barPulse}"></i></div>
            ${downloadLine}
            <div class="bf-source-meta" style="margin-top:6px">
              المنقضي: ${Math.round((snap.elapsedMs || 0) / 1000)}ث
              ${snap.budgetMs ? ` / ~${Math.round(snap.budgetMs / 1000)}ث` : ''}
              ${snap.foundCount ? ` · وُجد: ${snap.foundCount}` : ''}<br>
              آخر نشاط: ${snap.lastActivity || '—'}
              ${snap.diagnosticId ? `<br>Diagnostic ID: <code dir="ltr">${snap.diagnosticId}</code>` : ''}
            </div>
          </div>`;
        };

        const addSourceCard = (opts) => {
          const card = document.createElement('div');
          card.className = 'bf-source-card';
          card.dataset.status = opts.status || 'unknown';
          const title = document.createElement('h4');
          title.textContent = String(opts.title || '');
          const meta = document.createElement('div');
          meta.className = 'bf-source-meta';
          if (global.SafeRender?.setStructuredHtml) global.SafeRender.setStructuredHtml(meta, opts.metaHtml || '');
          else meta.textContent = String(opts.metaText || '');
          const actions = document.createElement('div');
          actions.className = 'bf-source-actions';
          actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:4px';
          card.append(title, meta, actions);
          choiceHost.appendChild(card);
          return { card, meta, actions };
        };

        const runDiscovery = async (forceRescan = false) => {
          if (restoreInFlight) {
            setStatus('⚠️ عملية جارية — انتظر', true);
            return;
          }
          if (!Discovery?.discoverAllSources) {
            if (statusEl) {
              statusEl.textContent = '⚠️ وحدة الاكتشاف غير محمّلة — حدّث التطبيق أو أعد التحميل.';
            }
            // Still show non-cloud alternatives
            addBtn(choiceHost, '💾 استخدام البيانات المحلية الموجودة', 'btn-secondary', async () => {
              await reconcileAndSelectLocal('local', '✅ تم اعتماد البيانات المحلية بعد المواءمة');
            });
            addBtn(choiceHost, '📁 اختيار ملف Backup / Database', 'btn-secondary', async () => {
              const restored = await restoreLocalBackupDuringSetup();
              if (restored?.ok === true) {
                await reconcileAndSelectLocal('file', '✅ تمت استعادة Backup V2 ومواءمتها', {
                  verifiedDatabase: true,
                  mode: 'backup_v2_local',
                });
              } else if (!restored?.canceled) {
                setStatus('❌ لم تتم الاستعادة: ' + (restored?.error || 'restore_failed'), true);
              }
            });
            addBtn(choiceHost, '📭 البدء بدون قاعدة بيانات سابقة', 'btn-ghost', () => {
              markRestore('empty', '✅ بدء صريح بدون قاعدة سابقة');
            });
            return;
          }

          restoreInFlight = true;
          try { global.OwnerManagement?.setSystemBusy?.('discovery'); } catch { /* empty */ }
          const discoveryBudgetMs = Discovery.DISCOVERY_TIMEOUT_MS || 180000;
          setStatus(`🔍 فحص مصادر البيانات (حتى ${Math.round(discoveryBudgetMs / 1000)}ث) — بلا تنزيل…`);
          choiceHost.innerHTML = '';
          if (statusEl) statusEl.textContent = '⏳ جارٍ الفحص: سحابة / محلي / نسخ — مع مؤشر تقدم…';
          if (progressHost) {
            renderProgress({
              stageLabel: 'بدء الفحص',
              percent: 2,
              elapsedMs: 0,
              budgetMs: discoveryBudgetMs,
              lastActivity: 'بيانات وصفية فقط — لا تنزيل',
            });
          }

          let discovery;
          const cachedDiscovery = global.PostGoogleCloudDiscovery?.getCachedDiscovery?.();
          if (cachedDiscovery?.dataDiscovery && !forceRescan) {
            discovery = cachedDiscovery.dataDiscovery;
            if (statusEl) statusEl.textContent = '✅ استخدام نتائج الاكتشاف المحفوظة — بلا إعادة فحص كامل.';
            renderProgress({
              stageLabel: 'نتائج محفوظة من خطوة الاكتشاف',
              percent: 100,
              elapsedMs: 0,
              budgetMs: discoveryBudgetMs,
              lastActivity: 'cached',
            });
          } else {
            try {
              discovery = await Discovery.discoverAllSources({
                timeoutMs: discoveryBudgetMs,
                onProgress: (snap) => {
                  renderProgress(snap);
                  if (statusEl && snap?.stageLabel) {
                    statusEl.textContent = `⏳ ${snap.stageLabel} — ${snap.percent || 0}%`;
                  }
                },
              });
            } catch (e) {
              discovery = { ok: false, error: e.message || String(e), cloud: { status: 'error', message: e.message } };
            }
          }
          restoreInFlight = false;
          try { global.OwnerManagement?.clearSystemBusy?.('discovery'); } catch { /* empty */ }

          const cloud = discovery?.cloud || {};
          const dur = discovery?.durationMs != null ? `${discovery.durationMs}ms` : '—';
          const cloudHasPoint = !!(cloud.newest && (cloud.status === 'ready' || cloud.status === 'ipc_missing'));
          if (statusEl) {
            if (cloudHasPoint && cloud.timedOut) {
              statusEl.textContent = `⚠️ اكتمل الفحص جزئياً (${dur}) — وُجدت نسخة سحابية للتأكيد.`;
            } else if (cloud.timedOut) {
              statusEl.textContent = `⏱️ انتهى وقت الفحص السحابي (${dur}). يمكنك إعادة المحاولة أو اختيار مصدر آخر.`;
            } else {
              statusEl.textContent = `✅ اكتمل الفحص خلال ${dur}. لا تنزيل أثناء الاكتشاف.`;
            }
          }
          setStatus(cloud.timedOut && !cloudHasPoint
            ? '⏱️ مهلة اكتشاف السحابة — أعد المحاولة'
            : (cloudHasPoint && cloud.timedOut ? '⚠️ نتائج جزئية — يمكن التأكيد' : '✅ نتائج الفحص جاهزة'));

          // --- Cloud card ---
          const newest = cloud.newest;
          const backupPoints = Array.isArray(cloud.restorePoints)
            ? cloud.restorePoints.filter((point) => point?.kind === 'backup_file').slice(0, 10)
            : (newest?.kind === 'backup_file' ? [newest] : []);
          // When several backups exist, require an explicit choice. A newer
          // file can be a valid but nearly-empty setup snapshot and must not
          // silently supersede an older data-rich recovery point.
          let selectedCloudPoint = backupPoints.length > 1 ? null : newest;
          let selectedRestoreButton = null;
          const cloudStatus = cloud.status || 'unknown';
          const cloudMeta = newest
            ? `الحالة: <strong>${cloud.ok === true && cloudStatus === 'ready' ? 'جاهزة للتأكيد' : 'نتيجة جزئية غير قابلة للاختيار'}</strong><br>
               ${cloud.ok !== true ? `<span class="bf-source-meta">⚠️ ${cloud.message || 'لم يكتمل الفحص؛ أعد المحاولة.'}</span><br>` : ''}
               النوع: ${newest.kind === 'backup_file' ? 'نسخة Backup' : 'نقطة مزامنة سحابية'}<br>
               المركز: <code dir="ltr">${cloud.centerId || discovery?.identity?.centerId || '—'}</code><br>
               الفرع: <code dir="ltr">${cloud.branchId || discovery?.identity?.branchId || '—'}</code><br>
               آخر نسخة: ${Discovery.formatWhen(newest.modifiedAt)}<br>
               الحجم: ${Discovery.formatBytes(newest.sizeBytes)}<br>
               الملف: <code dir="ltr">${newest.name || newest.path || '—'}</code><br>
               التحقق: ${newest.validation || 'metadata_ok'}`
            : `الحالة: <strong>${cloudStatus}</strong><br>${cloud.message || 'لم يتم العثور على نسخ سحابية — جرّب «ملف Backup» أو تأكد من حساب Google.'}`;

          const cloudCard = addSourceCard({
            title: backupPoints.length > 1 ? '☁️ النسخ السحابية المتاحة' : '☁️ أحدث بيانات سحابية',
            status: newest ? 'ready' : cloudStatus,
            metaHtml: cloudMeta,
          });

          if (newest && cloud.ok === true && cloudStatus === 'ready'
              && !cloud.partialScan && !cloud.truncated && !cloud.timedOut) {
            selectedRestoreButton = addBtn(cloudCard.actions, 'استعادة هذه البيانات المحددة', 'btn-primary', async () => {
              if (!selectedCloudPoint) {
                setStatus('⚠️ اختر نسخة من القائمة أولاً', true);
                return;
              }
              if (restoreInFlight || Discovery.isRestoreLocked?.()) {
                setStatus('⏳ استعادة جارية — انتظر');
                return;
              }
              restoreInFlight = true;
              try { global.OwnerManagement?.setSystemBusy?.('restore'); } catch { /* empty */ }
              setStatus('⏳ جارٍ الاستعادة المؤكدة من السحابة…');
              try {
                const result = await Discovery.confirmedCloudRestore(selectedCloudPoint, {
                  onProgress: (snap) => {
                    renderProgress(snap);
                    const pct = snap.indeterminate ? '…' : `${snap.percent}%`;
                    setStatus(`⏳ ${snap.stageLabel} — ${pct}`, false);
                  },
                });
                if (!result?.ok) {
                  setStatusFromErr(result, result?.error || 'cloud_backup_restore_failed');
                  if (progressHost) {
                    progressHost.innerHTML += `<p class="bf-source-meta">لم تُستبدل القاعدة المحلية. الترخيص والجهاز والفرع محفوظون. يمكنك إعادة المحاولة أو تغيير المصدر.${result?.diagnosticId ? ` · ID ${result.diagnosticId}` : ''}</p>`;
                  }
                  return;
                }
                markRestore('cloud', '✅ تمت الاستعادة السحابية المؤكدة — انتقل للمزامنة', {
                  verifiedDatabase: result?.result?.native === true,
                  mode: result?.result?.mode || null,
                });
                setStatus('✅ تمت الاستعادة — المزامنة التالية تسحب الأحدث فقط');
              } catch (e) {
                setStatusFromErr(e, 'restore_interrupted');
              } finally {
                restoreInFlight = false;
                try { global.OwnerManagement?.clearSystemBusy?.('restore'); } catch { /* empty */ }
                renderNavButtons(loadWizard());
              }
            }, !selectedCloudPoint);
          } else {
            addBtn(cloudCard.actions, 'إعادة فحص السحابة', 'btn-secondary', async () => {
              if (restoreInFlight) return;
              if (statusEl) statusEl.textContent = '⏳ جارٍ إعادة فحص مصادر البيانات...';
              choiceHost.innerHTML = '';
              if (progressHost) progressHost.innerHTML = '';
              await runDiscovery(true);
            });
          }

          if (backupPoints.length > 1) {
            const note = document.createElement('p');
            note.className = 'bf-source-meta';
            note.textContent = 'اختر النسخة حسب التاريخ والحجم. النسخ الأكبر قد تحتوي بيانات أكثر، ويُطلب رمز النسخة القديمة عند الحاجة.';
            const list = document.createElement('div');
            list.className = 'bf-cloud-backup-list';
            const rows = [];
            backupPoints.forEach((point, index) => {
              const row = document.createElement('div');
              row.className = 'bf-cloud-backup-row';
              row.dataset.selected = String(point === selectedCloudPoint);
              const label = document.createElement('span');
              label.className = 'bf-cloud-backup-label';
              label.textContent = `${index === 0 ? 'الأحدث · ' : ''}${Discovery.formatWhen(point.modifiedAt)} · ${Discovery.formatBytes(point.sizeBytes)}`;
              const select = document.createElement('button');
              select.type = 'button';
              select.className = 'btn btn-secondary btn-sm';
              select.textContent = point === selectedCloudPoint ? 'محددة ✓' : 'اختيار';
              select.onclick = () => {
                selectedCloudPoint = point;
                rows.forEach(({ row: itemRow, button, point: itemPoint }) => {
                  const isSelected = itemPoint === selectedCloudPoint;
                  itemRow.dataset.selected = String(isSelected);
                  button.textContent = isSelected ? 'محددة ✓' : 'اختيار';
                });
                if (selectedRestoreButton) selectedRestoreButton.textContent = 'استعادة هذه البيانات المحددة';
                if (selectedRestoreButton) selectedRestoreButton.disabled = false;
                setStatus(`✅ تم اختيار نسخة ${Discovery.formatWhen(point.modifiedAt)} بحجم ${Discovery.formatBytes(point.sizeBytes)}`);
              };
              row.append(label, select);
              rows.push({ row, button: select, point });
              list.appendChild(row);
            });
            cloudCard.card.insertBefore(note, cloudCard.actions);
            cloudCard.card.insertBefore(list, cloudCard.actions);
          }

          // --- Local DB card ---
          const local = discovery?.localDb || {};
          const localCard = addSourceCard({
            title: '💾 البيانات المحلية',
            status: local.status === 'valid' ? 'ready' : (local.status || 'unknown'),
            metaHtml: `المسار: <code dir="ltr">${local.path || '—'}</code><br>الحالة: ${local.message || local.status || '—'}`,
          });
          addBtn(localCard.actions, 'استخدام البيانات المحلية', 'btn-secondary', async () => {
            try {
              await reconcileAndSelectLocal('local', '✅ تم اعتماد البيانات المحلية بعد المواءمة');
            } catch (error) { setStatusFromErr(error, 'restore_reconcile_incomplete'); }
          });

          // --- Local backups / file ---
          const lb = discovery?.localBackup || {};
          const fileCard = addSourceCard({
            title: '📁 اختيار ملف Backup',
            status: lb.available ? 'ready' : 'not_found',
            metaHtml: `${lb.message || 'اختيار ملف...'}<br>النسخ المحلية: ${lb.count || 0}`,
          });
          addBtn(fileCard.actions, 'اختيار ملف…', 'btn-secondary', async () => {
            if (restoreInFlight) return;
            restoreInFlight = true;
            setStatus('⏳ اختر ملف Backup V2 ثم أكّد الاستعادة...');
            try {
              const restored = await restoreLocalBackupDuringSetup();
              if (restored?.ok !== true) {
                if (!restored?.canceled) setStatus('❌ لم تتم الاستعادة: ' + (restored?.error || 'restore_failed'), true);
                return;
              }
              await reconcileAndSelectLocal('file', '✅ تمت استعادة Backup V2 ومواءمتها', {
                verifiedDatabase: true,
                mode: 'backup_v2_local',
              });
            } catch (error) {
              setStatusFromErr(error, 'local_restore_failed');
            } finally {
              restoreInFlight = false;
              renderNavButtons(loadWizard());
            }
          });

          // --- Empty start ---
          const emptyPolicy = existingEmptyStartPolicy();
          const emptyCard = addSourceCard({
            title: '📭 البدء بدون بيانات سابقة',
            status: emptyPolicy.allowed ? 'ready' : 'blocked',
            metaHtml: emptyPolicy.allowed
              ? 'إنشاء قاعدة جديدة بقرار صريح منك — لن يحدث تلقائياً عند فشل السحابة.'
              : `<span class="tdw-field-error">${emptyPolicy.messageAr}</span>`,
          });
          addBtn(emptyCard.actions, 'بدء قاعدة جديدة', 'btn-ghost', () => {
            const policy = existingEmptyStartPolicy();
            if (!policy.allowed) {
              // Choosing "empty" here would resolve the restore gate while
              // leaving owner_auth permanently unreachable. Refuse with the
              // real reason instead of entering that state.
              setStatusFromErr(
                { message: policy.code },
                policy.code,
                { stepId: 'restore', message: policy.messageAr },
              );
              return;
            }
            markRestore('empty', '✅ بدء صريح بدون قاعدة سابقة');
          }, !emptyPolicy.allowed);

          if (w.path === PATHS.EXISTING) {
            addBtn(choiceHost, '✔️ تأكيد البيانات الحالية (جهاز موجود)', 'btn-ghost', async () => {
              try {
                await reconcileAndSelectLocal('skip_existing', '✅ تم تأكيد البيانات الحالية بعد المواءمة');
              } catch (error) { setStatusFromErr(error, 'restore_reconcile_incomplete'); }
            });
          }
        };

        // Kick discovery asynchronously so the step paints first
        setTimeout(() => { runDiscovery().catch(() => {}); }, 0);
        break;
      }
      case 'sync': {
        const readiness = global.SyncEngine?.getReadiness?.() || null;
        content.innerHTML = `<p>نفّذ المزامنة الأولية بعد الاستعادة/البدء.</p>
          <div class="bf-source-meta" id="bf-sync-readiness">${
            readiness
              ? (readiness.ready
                ? `✅ الجاهزية: ${readiness.state}`
                : `⚠️ غير جاهز بعد: ${(readiness.missing || []).join(', ') || readiness.messageAr || ''}`)
              : 'جارٍ فحص جاهزية المزامنة…'
          }</div>`;
        addBtn(actions, '▶️ بدء المزامنة الأولية', 'btn-primary', async () => {
          if (syncInFlight || ownerCreateInFlight()) {
            setStatus('⚠️ عملية جارية — انتظر', true);
            return;
          }
          syncInFlight = true;
          try { global.OwnerManagement?.setSystemBusy?.('sync'); } catch { /* empty */ }
          setStatus('⏳ جارٍ المزامنة...');
          try {
            const result = await runInitialSyncPipeline();
            if (result.ok) setStatus('✅ اكتملت المزامنة الأولية');
            else setStatusFromErr({ message: result.error }, result.error);
          } catch (e) {
            persistInitialSyncResult(false);
            setStatusFromErr(e, 'sync_interrupted');
          } finally {
            syncInFlight = false;
            try { global.OwnerManagement?.clearSystemBusy?.('sync'); } catch { /* empty */ }
            renderNavButtons(loadWizard());
            renderStepUI(loadWizard());
          }
        });
        if (hasSyncDone()) setStatus('✅ المزامنة مسجّلة كمكتملة');
        break;
      }
      case 'ready': {
        const checks = [
          ['Google', hasGoogle()],
          ['الترخيص', hasValidLicense()],
          ['المؤسسة', hasCenterData()],
          ['الفرع والجهاز', hasDeviceBranch()],
          ['بيانات المركز', businessSetupStepResolved()],
          ['النشر إلى السحابة', publicationStepResolved()],
          ['مصدر البيانات', hasRestoreDecision()],
          ['حساب المالك', ownerSetupRequirementMet()],
          ['المزامنة', hasSyncDone()]
        ];
        const setupState = global.SetupStateService?.getState?.({ ignoreRestart: true });
        content.innerHTML = `<ul style="font-size:13px;line-height:1.9">${checks.map(([l, ok]) => `<li>${ok ? '✅' : '❌'} ${l}</li>`).join('')}</ul>
          <p>اكتمل الإعداد بنجاح. اضغط الزر الوحيد أدناه لإعادة تشغيل البرنامج وتطبيق التفعيل، ثم سجّل الدخول.</p>
          <p class="bf-source-meta">لن تُعرض هذه الشاشة مرة أخرى بعد إعادة التشغيل الناجحة.</p>`;
        // Single terminal CTA — no duplicate finish / login / restart buttons.
        addBtn(actions, '🔄 إعادة تشغيل البرنامج وتطبيق الإعداد', 'btn-primary', async () => {
          if (!isBootComplete()) {
            setStatus('⚠️ لم تكتمل جميع المتطلبات', true);
            return;
          }
          const finalized = await global.SqliteBridge?.finalizeSetupData?.();
          if (!finalized || finalized.ok !== true) {
            setStatus('❌ تعذر تثبيت البيانات في SQLite: ' + (finalized?.error || 'setup_finalize_failed'), true);
            return;
          }
          try {
            // Flush durable state before relaunch
            try {
              const committed = typeof global.persistData === 'function'
                ? await global.persistData('settings', global.settings)
                : await global.SqliteBridge?.setAuthoritative?.('settings', global.settings);
              if (!committed || committed.ok === false) throw new Error(committed?.error || 'settings_flush_failed');
            } catch (error) {
              setStatus('⚠️ تعذر حفظ الإعدادات قبل إعادة التشغيل', true);
              return;
            }
            const completed = await markBootComplete();
            if (!completed) {
              setStatus('⚠️ تعذر تثبيت حالة اكتمال الإعداد قبل إعادة التشغيل', true);
              return;
            }
            const meta = global.SetupStateService?.markRestartRequired?.('setup_finalize')
              || (() => { try { localStorage.setItem(RESTART_REQUIRED_KEY, '1'); } catch { /* empty */ } return null; })();
            setStatus('⏳ جارٍ حفظ الحالة وإعادة التشغيل…');
            try { global.SyncEngine?.stop?.(); } catch { /* empty */ }
            const api = global.cuppingElectron || global.tadawiElectron;
            if (api?.relaunchApp) {
              await api.relaunchApp({ reason: meta?.id || 'setup_finalize' });
              return;
            }
            if (api?.app?.relaunch) {
              await api.app.relaunch();
              return;
            }
          } catch (e) {
            setStatus('⚠️ تعذّر relaunch التلقائي — أعد التشغيل يدوياً من النظام', true);
            return;
          }
          setStatus('ℹ️ أعد تشغيل التطبيق يدوياً من قائمة النظام لتطبيق الإعداد', true);
        }, !isBootComplete());
        break;
      }
      default:
        break;
    }
    renderNavButtons(w);
  }

  function startPath(path) {
    ensureDOM();
    const w = resetWizard(path);
    showStep('bf-step-wizard');
    document.getElementById('bootFlowOverlay')?.classList.add('open');
    setBootActive(true);
    renderProgress(w);
    renderStepUI(w);
  }

  /**
   * Back moves to the previous APPLICABLE step, never `currentStep - 1`, which
   * could land on a conditional step that is not part of this journey. Going
   * back is navigation only: it never rewrites committed data and never clears
   * a committed choice.
   */
  function prevStep() {
    const w = loadWizard();
    if (!w.path) return;
    const model = stepModel();
    const state = stepModelState(w);
    const previousId = model?.getPreviousStep
      ? model.getPreviousStep(w.path, state, currentStepId(w))
      : stepsFor(w.path)[w.currentStep - 1] || null;
    if (!previousId) {
      w.path = null;
      w.currentStep = 0;
      saveWizard(w);
      showStep('bf-step-choose');
      setStatus('');
      return;
    }
    w.currentStep = stepsFor(w.path).indexOf(previousId);
    w.reviewStepIndex = w.currentStep;
    saveWizard(w);
    renderAll(w);
    setStatus('');
  }

  async function advanceWizard() {
    let w = loadWizard();
    const steps = stepsFor(w.path);
    const step = currentStepId(w);
    if (!validateStep(step)) {
      if (isStepOperationInFlight(step) || (step === 'discovery' && discoveryInFlight)) {
        setStatus('⏳ انتظر اكتمال العملية الجارية قبل المتابعة', false);
        return;
      }
      if (step === 'branch_select' && hasBranch() && !isBranchExplicitlySelected()) {
        setStatus('⚠️ اختر الفرع من القائمة ثم اضغط «تأكيد اختيار الفرع»', false);
        return;
      }
      setStatusFromErr({ message: 'step_required' }, 'step_required', { stepId: step });
      return;
    }
    const model = stepModel();
    const nextId = model?.getNextStep
      ? model.getNextStep(w.path, stepModelState(w), step)
      : steps[steps.indexOf(step) + 1] || null;
    if (!nextId) {
      const completed = await completeBootstrapTransition({ close: true });
      if (!completed?.ok) {
        setStatus('⚠️ لم تكتمل جميع متطلبات الإعداد', true);
      }
      return;
    }
    // Advance to the next APPLICABLE step; never to `currentStep + 1`, and
    // never using historical completedSteps as the reason to skip a gate.
    if (!w.completedSteps.includes(step)) w.completedSteps.push(step);
    delete w.reviewStepIndex;
    w.currentStep = steps.indexOf(nextId);
    w = saveWizard(w);
    renderAll(w);
    setStatus('');
  }

  function setBootActive(active) {
    document.body?.classList.toggle('bf-active', !!active);
  }

  function openOverlay(force) {
    if (!force && !needsBootScreen()) return false;
    lastFocusEl = document.activeElement;
    hideBlockingScreens();
    ensureDOM();
    prepareBootstrapResume({ showResumeHint: true });
    const w = getDisplayWizard(loadWizard());
    if (w.path) {
      showStep('bf-step-wizard');
      renderProgress(w);
      renderStepUI(w);
    } else {
      showStep('bf-step-choose');
    }
    document.getElementById('bootFlowOverlay')?.classList.add('open');
    __stage3BootTrace.bootVisibilityEvents += 1;
    setBootActive(true);
    const login = document.getElementById('loginScreen');
    if (login) login.classList.add('hidden');
    setTimeout(() => document.getElementById('bf-dialog')?.querySelector('button,input')?.focus?.(), 30);
    return true;
  }

  function open() { return openOverlay(true); }
  function forceOpen() { return openOverlay(true); }

  /**
   * Jump wizard to a specific step id (e.g. 'owner') and open overlay.
   * Used by self-healing Owner Bootstrap when org has no Owner.
   */
  function openAtStep(stepId, opts) {
    opts = opts || {};
    let w = loadWizard();
    if (!w.path) {
      w.path = opts.path || (hasValidLicense() ? PATHS.EXISTING : PATHS.NEW);
      w = saveWizard(w);
    }
    const steps = stepsFor(w.path);
    const idx = steps.indexOf(stepId);
    if (idx >= 0) {
      w.currentStep = idx;
      w.reviewStepIndex = idx;
      saveWizard(w);
    }
    openOverlay(true);
    const fresh = getDisplayWizard(loadWizard());
    if (fresh.path) renderAll(fresh);
    return true;
  }

  /**
   * V2-5.9: Owner Bootstrap is support/emergency only — never for Google activation.
   */
  function ensureOwnerBootstrapWizard(reason) {
    const why = String(reason || '');
    const allowed = /^(emergency|support|migration|owner_hub)/i.test(why);
    if (!allowed) {
      return { ok: true, opened: false, skipped: true, reason: 'v2_5_9_no_auto_owner_bootstrap', why };
    }
    if (global.OwnerManagement?.requestOwnerBootstrap) {
      return global.OwnerManagement.requestOwnerBootstrap(why);
    }
    if (hasOwnerPasswordAccount()) {
      try { global.OwnerSetupState?.clearRequired?.(); } catch { /* empty */ }
      return { ok: true, opened: false, reason: 'owner_present' };
    }
    try { global.OwnerSetupState?.ensureMissingOwner?.(why); } catch { /* empty */ }
    openAtStep('owner');
    return { ok: true, opened: true, reason: why };
  }

  function close(opts) {
    document.getElementById('bootFlowOverlay')?.classList.remove('open');
    setBootActive(false);
    const login = document.getElementById('loginScreen');
    const forceLogin = !!(opts?.showLogin || !global.currentUser);
    if (login && (forceLogin || canShowLogin())) {
      login.classList.remove('hidden');
      login.style.display = '';
      login.style.pointerEvents = '';
    }
    applyLoginGate();
    applyOperationalGuard();
    try { lastFocusEl?.focus?.(); } catch { /* empty */ }
    if (forceLogin && typeof global.ensureUserLoginScreenVisible === 'function') {
      global.ensureUserLoginScreenVisible();
    }
  }

  function closeToLogin() {
    return dismissBootstrap();
  }

  async function refreshBootState() {
    if (isBootComplete()) {
      if (!await markBootComplete()) return;
      close();
      global.filterLoginUsers?.();
    } else {
      const w = loadWizard();
      if (w.path && document.getElementById('bootFlowOverlay')?.classList.contains('open')) {
        renderProgress(w);
        renderStepUI(w);
      }
    }
  }

  function ensureLoginAccessible() {
    // Do not force-close wizard if activation incomplete — only ensure login DOM usable when shown.
    const login = document.getElementById('loginScreen');
    if (login && !document.getElementById('bootFlowOverlay')?.classList.contains('open')) {
      login.classList.remove('hidden');
      login.style.display = '';
      login.style.pointerEvents = '';
    }
    document.getElementById('centerSetupModal')?.classList.remove('open');
  }

  function updateLoginSetupHint() {
    const el = document.getElementById('login-setup-hint');
    const bootCta = document.getElementById('login-boot-cta')
      || document.querySelector('#loginScreen .login-activate-btn, #loginScreen button[onclick*="openBootWizard"]');
    const complete = isBootComplete() || global.SetupStateService?.getState?.()?.state === 'READY';
    if (el) {
      if (complete) {
        el.style.display = 'none';
        el.textContent = '';
      } else {
        el.style.display = '';
        el.innerHTML = '💡 لم يكتمل الإعداد — <button type="button" class="btn btn-primary btn-sm" id="login-open-activation-wizard">🚀 بدء الإعداد الموحّد</button>';
        document.getElementById('login-open-activation-wizard')?.addEventListener('click', () => forceOpen());
      }
    }
    // Hide completed-step boot CTA on login when READY
    if (bootCta) {
      bootCta.style.display = complete ? 'none' : '';
      bootCta.hidden = !!complete;
    }
    // License/dev support entry stays in collapsed <details> — never hide after activation
  }

  function applyLoginGate() {
    ensureLoginAccessible();
    updateLoginSetupHint();
    try { global.SetupStateDom?.applyDomVisibility?.({ reason: 'bootflow-login-gate' }); } catch { /* empty */ }
  }

  // Inventory helpers for tests
  function getStepCatalog() {
    return { NEW_STEPS: NEW_STEPS.slice(), EXISTING_STEPS: EXISTING_STEPS.slice(), STEP_LABELS: { ...STEP_LABELS } };
  }

  global.BootFlow = {
    PATHS,
    NEW_STEPS,
    EXISTING_STEPS,
    open,
    forceOpen,
    openAtStep,
    ensureOwnerBootstrapWizard,
    close,
    closeToLogin,
    dismissBootstrap,
    prepareBootstrapResume,
    completeBootstrapTransition,
    isOperationalAppAllowed,
    sanitizeWizardForResume,
    clearTransientBootstrapState,
    applyOperationalGuard,
    needsBootScreen,
    shouldAutoOpenBoot,
    maybeAutoOpenBootFlow,
    isDeviceReadyAuthoritative,
    getStage3BootTrace: () => ({ ...__stage3BootTrace }),
    isBootComplete,
    markBootComplete,
    onAppStartupAfterRelaunch,
    canShowLogin,
    canOpenDashboard,
    ensureLoginAccessible,
    updateLoginSetupHint,
    applyLoginGate,
    refreshBootState,
    startPath,
    validateStep,
    loadWizard,
    saveWizard,
    getDisplayWizard,
    getChecklistUiContext,
    buildChecklistModel: (ctx) => global.BootstrapChecklistContract?.buildChecklistModel?.(ctx || getChecklistUiContext()),
    renderChecklist,
    resolveCoordinatorState: () => global.BootstrapCoordinator?.resolveCoordinatorState?.() || null,
    getStepCatalog,
    getStepManifest: getStepCatalog,
    WIZARD_FLOW_VERSION,
    LEGACY_NEW_STEPS_PRE_STAGE6,
    LEGACY_NEW_STEPS_PRE_STAGE7,
    LEGACY_NEW_STEPS_PRE_STAGE8,
    LEGACY_NEW_STEPS_PRE_STAGE9,
    LEGACY_NEW_STEPS_PRE_STAGE11,
    LEGACY_NEW_STEPS_PRE_STAGE12,
    LEGACY_NEW_STEPS_PRE_STAGE13,
    LEGACY_EXISTING_STEPS_PRE_STAGE7,
    LEGACY_EXISTING_STEPS_PRE_STAGE11,
    LEGACY_EXISTING_STEPS_PRE_STAGE12,
    LEGACY_EXISTING_STEPS_PRE_STAGE16,
    describeCurrentStep,
    currentStepId,
    advanceWizard,
    prevStep,
    applicableSteps,
    stepModelState,
    renderAll,
    currentRenderGeneration,
    isRenderCurrent,
    branchStepResolved,
    isBranchExplicitlySelected,
    currentBranchSelection,
    recordBranchSelection,
    selectExistingBranchOnly,
    createFirstBranchFromForm,
    reconcileBranchSelection,
    reconcileBranchSelectionAfterDiscovery,
    eligibleBranchCount,
    authoritativeBootstrapBranches,
    branchGateDiagnostics,
    existingEmptyStartPolicy,
    deviceStepResolved,
    businessSetupStepResolved,
    readBusinessSetupState,
    commitBusinessSetupFromForm,
    publicationStepResolved,
    readbackStepResolved,
    readPublicationState,
    commitPublicationFromWizard,
    getSelectedBranchId,
    readDeviceCommitState,
    registerDeviceFromForm,
    hasDiscoveryResolved,
    needsPathForkDecision,
    hasPathDecisionResolved,
    commitForkUseExisting,
    commitForkStartNew,
    getCachedDiscoveryResult,
    isNewFreshStartPath,
    ownerStepResolved,
    ownerCredentialCommitted,
    newBranchRequiresOwner,
    hasOwnerPasswordAccount,
    /** @deprecated alias — prefer hasOwnerPasswordAccount */
    hasOwnerAccount: hasOwnerPasswordAccount,
    hasGoogle,
    hasValidLicense,
    hasCenterData,
    hasBranch,
    hasDeviceBranch,
    hasRestoreDecision,
    hasSyncDone,
    isExistingCustomerPath,
    licenseOrgRecoveryResolved,
    ownerAuthStepResolved,
    existingGatesBeforeSyncSatisfied,
    runLicenseOrgRecovery,
    getSetupConnectivityPolicy,
    initialOperationForChoice,
    buildInitialSyncPlanContext,
    runInitialSyncPipeline,
    autoDiscoverActivationAfterGoogle,
    runGoogleConnect,
    runDiscoveryGate,
    disconnectGoogleDuringSetup,
    retryCurrentGate,
    normalizeBootstrapFailure,
    isCriticalOpInFlight,
    version: 'v2-5.14'
  };
})(typeof window !== 'undefined' ? window : globalThis);
