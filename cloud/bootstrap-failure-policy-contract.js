/**
 * Stage 18 — Unified Bootstrap failure policy contract.
 * Normalizes bootstrap operation results into SUCCESS / RETRYABLE / USER_ACTION_REQUIRED / FATAL / CANCELLED.
 */
(function (global) {
  'use strict';

  const OUTCOME = Object.freeze({
    SUCCESS: 'SUCCESS',
    RETRYABLE: 'RETRYABLE',
    USER_ACTION_REQUIRED: 'USER_ACTION_REQUIRED',
    FATAL: 'FATAL',
    CANCELLED: 'CANCELLED',
  });

  const GATE_STEPS = Object.freeze({
    activation: 'license',
    google: 'google',
    discovery: 'discovery',
    pathDecision: 'path_decision',
    organization: 'organization',
    owner: 'owner',
    branch: 'branch',
    branchSelect: 'branch_select',
    device: 'device',
    businessSetup: 'business_setup',
    publication: 'publication',
    readback: 'publication',
    restore: 'restore',
    ownerAuth: 'owner_auth',
    licenseOrgRecovery: 'license_org_recovery',
    sync: 'sync',
    ready: 'ready',
  });

  /** @type {Record<string, { outcome: string, retryable?: boolean, userActionRequired?: boolean, fatal?: boolean, cancelled?: boolean, message?: string, code?: string }>} */
  const CODE_POLICY = Object.freeze({
    // Every entry owns its Arabic message. Relying on a secondary lookup made
    // any unmapped code fall through to "حدث خطأ غير متوقع", which is how real
    // causes reached the operator as a meaningless generic failure.
    oauth_cancelled: { outcome: OUTCOME.CANCELLED, cancelled: true, code: 'TDW-BOOT-GOOGLE-CANCEL', message: 'أُلغي ربط Google قبل اكتماله. يمكنك المحاولة مرة أخرى.' },
    oauth_access_denied: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-GOOGLE-REAUTH', message: 'لم تُمنح الصلاحيات المطلوبة لحساب Google. اقبل صلاحيات Drive عند الربط.' },
    oauth_timeout: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-GOOGLE-TIMEOUT', message: 'انتهت مهلة نافذة مصادقة Google. أعد المحاولة.' },
    oauth_offline: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-GOOGLE-NETWORK', message: 'لا يوجد اتصال بالإنترنت لإكمال ربط Google. تحقق من الشبكة ثم أعد المحاولة.' },
    oauth_port_in_use: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-GOOGLE-PORT', message: 'منفذ المصادقة المحلي مستخدم من برنامج آخر. أغلق النسخ الأخرى ثم أعد المحاولة.' },
    oauth_invalid_grant: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-GOOGLE-REAUTH', message: 'انتهت صلاحية إذن Google. أعد ربط الحساب.' },
    oauth_redirect_mismatch: { outcome: OUTCOME.FATAL, fatal: true, code: 'TDW-BOOT-GOOGLE-OAUTH-CONFIG', message: 'إعداد OAuth في هذه النسخة غير مطابق. راجع الدعم الفني — لا يمكن حلها من الجهاز.' },
    oauth_api_disabled: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-GOOGLE-API', message: 'واجهة Google Drive غير مُفعّلة لهذا المشروع. فعّلها من حساب Google ثم أعد المحاولة.' },
    oauth_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-GOOGLE-FAIL', message: 'تعذّر إكمال مصادقة Google. أعد المحاولة.' },
    google_not_connected: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-GOOGLE-NOT-CONNECTED', message: 'اربط حساب Google أولاً قبل هذه الخطوة.' },
    google_disconnect_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-GOOGLE-DISCONNECT', message: 'تعذّر فصل حساب Google. أعد المحاولة — لن تُحذف بيانات الترخيص.' },
    discovery_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-DISC-FAIL', message: 'تعذّر إكمال فحص بيانات السحابة. Google ما زال متصلاً — أعد الفحص.' },
    discovery_in_flight: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-DISC-INFLIGHT', message: 'فحص السحابة جارٍ بالفعل. انتظر اكتماله.' },
    discovery_module_unavailable: { outcome: OUTCOME.FATAL, fatal: true, code: 'TDW-BOOT-DISC-MODULE', message: 'وحدة الاكتشاف غير محمّلة في هذه النسخة. أعد تثبيت التطبيق.' },
    discovery_required: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-DISC-REQUIRED', message: 'أكمل خطوة البحث عن البيانات السابقة قبل المتابعة.' },
    existing_business_not_found: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-DISC-NONE', message: 'لم يُعثر على مؤسسة سابقة مرتبطة بحساب Google هذا. تحقّق من الحساب أو ابدأ إعداداً جديداً.' },
    existing_candidate_ambiguous: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-DISC-AMBIGUOUS', message: 'وُجدت أكثر من مؤسسة على هذا الحساب. اختر المؤسسة الصحيحة.' },
    candidate_selection_required: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-PATH-SELECT', message: 'اختر المؤسسة أو الترخيص المطلوب قبل المتابعة.' },
    license_invalid: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-ACT-INVALID', message: 'مفتاح التفعيل غير صالح. تحقّق من المفتاح وأعد المحاولة.' },
    license_expired: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-ACT-EXPIRED', message: 'انتهت صلاحية الترخيص. جدّد الترخيص للمتابعة.' },
    setup_activation_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-ACT-COMMIT', message: 'تعذّر حفظ بيانات التفعيل محلياً. أعد المحاولة.' },
    activation_defaults_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-ACT-DEFAULTS', message: 'تعذّر تطبيق إعدادات التفعيل الافتراضية. أعد المحاولة.' },
    no_activation_on_drive: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-ACT-MISSING', message: 'لا يوجد ترخيص محفوظ على Google Drive لهذا الحساب. أدخل مفتاح التفعيل يدوياً.' },
    existing_license_recovery_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-ACT-RECOVERY', message: 'تعذّر استرداد الترخيص والمؤسسة من السحابة. أعد المحاولة.' },
    org_fetch_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-ORG-FETCH', message: 'تعذّر قراءة بيانات المؤسسة من السحابة. أعد المحاولة.' },
    organization_commit_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-ORG-COMMIT', message: 'تعذّر حفظ بيانات المؤسسة محلياً. أعد المحاولة.' },
    owner_password_required: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-OWNER-PASSWORD', message: 'أدخل كلمة مرور حساب المالك.' },
    owner_password_mismatch: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-OWNER-MISMATCH', message: 'كلمتا المرور غير متطابقتين. أعد إدخال التأكيد.' },
    owner_password_weak: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-OWNER-WEAK', message: 'كلمة المرور قصيرة أو ضعيفة. استخدم كلمة أقوى.' },
    owner_duplicate: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-OWNER-DUP', message: 'يوجد حساب مالك بالفعل. استخدم تسجيل الدخول بدلاً من الإنشاء.' },
    owner_credential_required: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-OWNER-CRED', message: 'يلزم حساب مالك بكلمة مرور صالحة قبل المتابعة.' },
    owner_session_required: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-OWNER-SESSION', message: 'سجّل دخول المالك في خطوة الإعداد قبل المزامنة.' },
    setup_owner_authentication_failed: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-OWNER-AUTH', message: 'كلمة مرور المالك غير صحيحة. أعد المحاولة.' },
    branch_name_required: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-BRANCH-NAME', message: 'أدخل اسم الفرع.' },
    branch_code_duplicate: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-BRANCH-DUP', message: 'رمز الفرع مستخدم بالفعل. اختر رمزاً مختلفاً.' },
    branch_duplicate_create: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-BRANCH-INFLIGHT', message: 'عملية إنشاء فرع جارية بالفعل. انتظر اكتمالها.' },
    license_branch_limit: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-BRANCH-LIMIT', message: 'بلغت الحد الأقصى للفروع في هذا الترخيص.' },
    license_device_limit: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-DEVICE-LIMIT', message: 'بلغت الحد الأقصى للأجهزة في هذا الترخيص. أوقف جهازاً آخر أولاً.' },
    device_limit_exceeded: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-DEVICE-LIMIT', message: 'بلغت الحد الأقصى للأجهزة في هذا الترخيص. أوقف جهازاً آخر أولاً.' },
    device_duplicate: { outcome: OUTCOME.RETRYABLE, retryable: false, code: 'TDW-BOOT-DEVICE-DUP', message: 'هذا الجهاز مسجّل بالفعل في هذا الفرع.' },
    business_setup_invalid: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-BIZ-INVALID', message: 'أكمل بيانات المركز المطلوبة (الاسم والهاتف).' },
    publication_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-PUB-FAIL', message: 'تعذّر حفظ بيانات الإعداد على السحابة. أعد المحاولة.' },
    readback_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-READBACK-FAIL', message: 'تعذّر التحقق من الحفظ السحابي. أعد المحاولة.' },
    readback_stale: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-READBACK-STALE', message: 'البيانات المقروءة من السحابة أقدم من المحفوظة. أعد الحفظ والتحقق.' },
    readback_mismatch: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-READBACK-MISMATCH', message: 'البيانات المقروءة من السحابة لا تطابق المحفوظة. أعد الحفظ والتحقق.' },
    backup_password_required: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-RESTORE-PASSWORD', message: 'أدخل كلمة مرور النسخة الاحتياطية (Backup V2) لهذا الجهاز الجديد.' },
    backup_password_invalid: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-RESTORE-PASSWORD', message: 'تعذّر فك تشفير النسخة. تأكّد من كلمة مرور النسخة ثم أعد المحاولة.' },
    password_too_short: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-RESTORE-PASSWORD-SHORT', message: 'كلمة مرور النسخة قصيرة جداً (٨ أحرف على الأقل).' },
    restore_interrupted: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-RESTORE-INTERRUPT', message: 'توقفت الاستعادة قبل اكتمالها. بياناتك المحلية محفوظة — أعد المحاولة.' },
    cloud_download_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-RESTORE-DOWNLOAD', message: 'تعذّر تنزيل النسخة من Google Drive. تحقّق من الاتصال ثم أعد المحاولة.' },
    cloud_backup_restore_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-RESTORE-FAIL', message: 'تعذّر تطبيق النسخة المختارة. بياناتك المحلية محفوظة — أعد المحاولة.' },
    local_restore_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-RESTORE-LOCAL', message: 'تعذّر تطبيق ملف النسخة المحلي المختار.' },
    restore_reconcile_incomplete: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-RESTORE-RECONCILE', message: 'اكتملت الاستعادة لكن المواءمة اللاحقة تحتاج إعادة محاولة.' },
    restore_cancelled: { outcome: OUTCOME.CANCELLED, cancelled: true, code: 'TDW-BOOT-RESTORE-CANCEL', message: 'أُلغيت الاستعادة. لم تتغيّر بياناتك المحلية.' },
    backup_cancelled: { outcome: OUTCOME.CANCELLED, cancelled: true, code: 'TDW-BOOT-RESTORE-CANCEL', message: 'أُلغيت العملية. لم تتغيّر بياناتك المحلية.' },
    initial_sync_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-SYNC-FAIL', message: 'تعذّر إكمال المزامنة الأولى. أعد المحاولة دون فقدان التقدم.' },
    sync_not_ready: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-SYNC-NOT-READY', message: 'المزامنة غير جاهزة بعد. أكمل الخطوات السابقة ثم أعد المحاولة.' },
    sync_plan_invalid: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-SYNC-PLAN', message: 'لا يمكن تحديد اتجاه المزامنة الأولى. راجع اختيار مصدر البيانات.' },
    sync_post_restore_blocked: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-SYNC-EMPTY-PUSH', message: 'رفع قاعدة فارغة إلى السحابة ممنوع لحماية بياناتك. أكمل الاستعادة أولاً.' },
    sync_push_blocked_pull_only: { outcome: OUTCOME.FATAL, fatal: true, code: 'TDW-BOOT-SYNC-PULL-ONLY', message: 'هذا الجهاز مسموح له بالسحب فقط في هذه المرحلة. لا يمكن الرفع الآن.' },
    sync_interrupted: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-SYNC-INTERRUPT', message: 'توقفت المزامنة. يمكنك إعادة المحاولة دون فقدان التقدم المحفوظ.' },
    bootstrap_unavailable: { outcome: OUTCOME.FATAL, fatal: true, code: 'TDW-BOOT-RUNTIME-UNAVAILABLE', message: 'مكوّن الإعداد غير متوفر في هذه النسخة. أعد تثبيت التطبيق.' },
    database_integrity_failed: { outcome: OUTCOME.FATAL, fatal: true, code: 'TDW-BOOT-DB-INTEGRITY', message: 'فحص سلامة قاعدة البيانات فشل. لا تتابع — راجع الدعم الفني.' },
    signed_license_corrupt: { outcome: OUTCOME.FATAL, fatal: true, code: 'TDW-BOOT-LICENSE-CORRUPT', message: 'ملف الترخيص تالف أو توقيعه غير صالح. راجع الدعم الفني.' },
    step_required: {
      outcome: OUTCOME.USER_ACTION_REQUIRED,
      userActionRequired: true,
      code: 'TDW-BOOT-STEP-REQUIRED',
      message: 'أكمل المتطلبات الظاهرة في هذه الخطوة قبل المتابعة.',
    },
    step_failed: {
      outcome: OUTCOME.USER_ACTION_REQUIRED,
      userActionRequired: true,
      code: 'TDW-BOOT-STEP-REQUIRED',
      message: 'أكمل المتطلبات الظاهرة في هذه الخطوة قبل المتابعة.',
    },
    cloud_download_stalled: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-CLOUD-DOWNLOAD-STALLED', message: 'بدأ الاتصال بـ Google Drive ولكن لم تصل بيانات من الملف. تحقق من الاتصال ثم أعد المحاولة.' },
    backup_download_stalled: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-CLOUD-DOWNLOAD-STALLED', message: 'بدأ الاتصال بـ Google Drive ولكن لم تصل بيانات من الملف. تحقق من الاتصال ثم أعد المحاولة.' },
    cloud_restore_timeout: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-CLOUD-RESTORE-TIMEOUT', message: 'استغرقت الاستعادة وقتاً أطول من المسموح. أعد المحاولة.' },
    rbac_session_required: {
      outcome: OUTCOME.RETRYABLE,
      retryable: true,
      code: 'TDW-BOOT-RBAC-SESSION',
      message: 'تعذر بدء فحص البيانات السحابية لأن جلسة الإعداد لم تكتمل بعد. أعد المحاولة من نفس الشاشة — إن استمر الخطأ فهذا خلل في مسار الإعداد وليس في حساب Google.',
    },
    rbac_session_unavailable: {
      outcome: OUTCOME.USER_ACTION_REQUIRED,
      userActionRequired: true,
      code: 'TDW-BOOT-RBAC-SESSION',
      message: 'يلزم تسجيل دخول المالك لإكمال هذه الخطوة.',
    },

    // Main-process setup-restore boundaries. Each one is reachable from the
    // Existing-customer restore step and must name its own cause.
    setup_restore_requires_empty_database: {
      outcome: OUTCOME.USER_ACTION_REQUIRED,
      userActionRequired: true,
      code: 'TDW-BOOT-RESTORE-DB-NOT-EMPTY',
      message: 'قاعدة البيانات المحلية تحتوي بيانات فعلية، ولا يمكن استبدالها من مسار الإعداد. استخدم «تأكيد البيانات الحالية» أو استعادة كاملة بعد الدخول.',
    },
    setup_mode_required: {
      outcome: OUTCOME.FATAL,
      fatal: true,
      code: 'TDW-BOOT-RESTORE-MODE',
      message: 'طلب الاستعادة وصل بدون وضع الإعداد. أعد تشغيل البرنامج ثم أعد المحاولة.',
    },
    invalid_remote_backup_path: {
      outcome: OUTCOME.USER_ACTION_REQUIRED,
      userActionRequired: true,
      code: 'TDW-BOOT-RESTORE-REMOTE-PATH',
      message: 'مسار النسخة على Google Drive غير صالح. اختر نسخة أخرى من القائمة.',
    },
    empty_cloud_backup: {
      outcome: OUTCOME.USER_ACTION_REQUIRED,
      userActionRequired: true,
      code: 'TDW-BOOT-RESTORE-EMPTY-FILE',
      message: 'ملف النسخة على Google Drive فارغ. اختر نسخة أخرى بتاريخ مختلف.',
    },
    cloud_download_incomplete: {
      outcome: OUTCOME.RETRYABLE,
      retryable: true,
      code: 'TDW-BOOT-RESTORE-DOWNLOAD-INCOMPLETE',
      message: 'انقطع تنزيل النسخة قبل اكتماله. أعد المحاولة.',
    },
    needs_reauth: {
      outcome: OUTCOME.USER_ACTION_REQUIRED,
      userActionRequired: true,
      code: 'TDW-BOOT-RESTORE-REAUTH',
      message: 'انتهت صلاحية إذن Google Drive. أعد ربط حساب Google ثم أعد المحاولة.',
    },
    legacy_backup_invalid_json: {
      outcome: OUTCOME.USER_ACTION_REQUIRED,
      userActionRequired: true,
      code: 'TDW-BOOT-RESTORE-LEGACY-JSON',
      message: 'ملف النسخة القديمة غير سليم ولا يمكن قراءته. اختر نسخة أخرى.',
    },
    legacy_backup_envelope_invalid: {
      outcome: OUTCOME.USER_ACTION_REQUIRED,
      userActionRequired: true,
      code: 'TDW-BOOT-RESTORE-LEGACY-ENVELOPE',
      message: 'غلاف تشفير النسخة القديمة غير مكتمل. اختر نسخة أخرى.',
    },
    legacy_backup_read_failed: {
      outcome: OUTCOME.RETRYABLE,
      retryable: true,
      code: 'TDW-BOOT-RESTORE-LEGACY-READ',
      message: 'تعذر قراءة ملف النسخة بعد التنزيل. أعد المحاولة.',
    },
    legacy_setup_restore_failed: {
      outcome: OUTCOME.RETRYABLE,
      retryable: true,
      code: 'TDW-BOOT-RESTORE-LEGACY-APPLY',
      message: 'تعذر تطبيق النسخة القديمة على قاعدة البيانات. أعد المحاولة.',
    },
    restored_database_hydrate_failed: {
      outcome: OUTCOME.RETRYABLE,
      retryable: true,
      code: 'TDW-BOOT-RESTORE-HYDRATE',
      message: 'تمت الاستعادة لكن تعذر تحميل البيانات في الذاكرة. أعد تشغيل البرنامج.',
    },
    // The renderer could not recover a cause from the Main process. This is a
    // reporting defect, not a user error — say so instead of "unexpected error".
    main_process_restore_failed: {
      outcome: OUTCOME.RETRYABLE,
      retryable: true,
      code: 'TDW-BOOT-RESTORE-MAIN-UNREPORTED',
      message: 'فشلت الاستعادة في العملية الرئيسية دون سبب مُبلَّغ. راجع ملف التشخيص في مجلد Backups/V2/diagnostics ثم أعد المحاولة.',
    },
    main_process_call_failed: {
      outcome: OUTCOME.RETRYABLE,
      retryable: true,
      code: 'TDW-BOOT-MAIN-UNREPORTED',
      message: 'فشلت عملية داخلية في العملية الرئيسية دون سبب مُبلَّغ. راجع ملف التشخيص ثم أعد المحاولة.',
    },
    // Structured setup-restore codes returned by the Main process.
    backup_password_invalid: {
      outcome: OUTCOME.USER_ACTION_REQUIRED,
      userActionRequired: true,
      code: 'TDW-BOOT-RESTORE-PASSWORD',
      message: 'كلمة مرور النسخة غير صحيحة.',
    },
    backup_download_forbidden: {
      outcome: OUTCOME.USER_ACTION_REQUIRED,
      userActionRequired: true,
      code: 'TDW-BOOT-RESTORE-FORBIDDEN',
      message: 'لا يملك حساب Google الحالي صلاحية الوصول إلى ملف النسخة.',
    },
    backup_file_not_found: {
      outcome: OUTCOME.USER_ACTION_REQUIRED,
      userActionRequired: true,
      code: 'TDW-BOOT-RESTORE-NOT-FOUND',
      message: 'ملف النسخة لم يعد موجودًا على Google Drive.',
    },
    backup_download_stalled: {
      outcome: OUTCOME.RETRYABLE,
      retryable: true,
      code: 'TDW-BOOT-RESTORE-STALLED',
      message: 'توقف تنزيل النسخة ولم تصل بيانات جديدة. تحقق من الاتصال ثم أعد المحاولة.',
    },
    backup_size_mismatch: {
      outcome: OUTCOME.RETRYABLE,
      retryable: true,
      code: 'TDW-BOOT-RESTORE-SIZE-MISMATCH',
      message: 'اكتمل التنزيل لكن حجم الملف لا يطابق النسخة المسجلة.',
    },
    backup_checksum_failed: {
      outcome: OUTCOME.RETRYABLE,
      retryable: true,
      code: 'TDW-BOOT-RESTORE-CHECKSUM',
      message: 'فشل التحقق من سلامة النسخة.',
    },
    backup_decrypt_failed: {
      outcome: OUTCOME.USER_ACTION_REQUIRED,
      userActionRequired: true,
      code: 'TDW-BOOT-RESTORE-DECRYPT',
      message: 'تعذر فك تشفير النسخة.',
    },
    backup_archive_invalid: {
      outcome: OUTCOME.USER_ACTION_REQUIRED,
      userActionRequired: true,
      code: 'TDW-BOOT-RESTORE-ARCHIVE',
      message: 'ملف النسخة غير صالح أو تالف.',
    },
    backup_sqlite_integrity_failed: {
      outcome: OUTCOME.FATAL,
      fatal: true,
      code: 'TDW-BOOT-RESTORE-SQLITE-INTEGRITY',
      message: 'تم فك النسخة لكن قاعدة البيانات المستعادة لم تجتز فحص السلامة.',
    },
    branch_selection_required: {
      outcome: OUTCOME.USER_ACTION_REQUIRED,
      userActionRequired: true,
      code: 'TDW-BOOT-BRANCH-SELECT-REQUIRED',
      message: 'اختر الفرع الذي يعمل عليه هذا الجهاز ثم اضغط «تأكيد اختيار الفرع».',
    },
    existing_empty_start_blocked_no_owner: {
      outcome: OUTCOME.USER_ACTION_REQUIRED,
      userActionRequired: true,
      code: 'TDW-BOOT-EMPTY-START-NO-OWNER',
      message: 'لا يمكن البدء بقاعدة فارغة لعميل حالي: حساب المالك يُسترد من النسخة الاحتياطية أو من المزامنة. أكمل الاستعادة أو اختر السحب من السحابة.',
    },
  });

  let correlationCounter = 0;
  const diagnosticRegistry = new Map();
  const MAX_DIAGNOSTIC_ENTRIES = 500;

  function recordDiagnostic(entry) {
    entry = entry || {};
    const id = String(entry.correlationId || entry.diagnosticId || '').trim();
    if (!id) return null;
    const safe = {
      correlationId: id,
      timestamp: entry.timestamp || new Date().toISOString(),
      step: entry.stepId || entry.step || null,
      operation: entry.operation || null,
      code: entry.code || null,
      rawCode: entry.rawCode || null,
      outcome: entry.outcome || null,
      domain: entry.domain || 'bootstrap',
      message: entry.message ? redactSensitive(String(entry.message)) : null,
      rootCause: entry.rootCause ? redactSensitive(String(entry.rootCause)) : null,
      recovered: entry.recovered === true,
      percent: entry.percent != null ? entry.percent : null,
      downloadedBytes: entry.downloadedBytes != null ? entry.downloadedBytes : null,
      totalBytes: entry.totalBytes != null ? entry.totalBytes : null,
      expectedBytes: entry.expectedBytes != null ? entry.expectedBytes : null,
      remotePath: entry.remotePath || null,
      remoteId: entry.remoteId || null,
      selectedName: entry.selectedName || null,
      lastActivity: entry.lastActivity || null,
    };
    diagnosticRegistry.set(id, safe);
    if (diagnosticRegistry.size > MAX_DIAGNOSTIC_ENTRIES) {
      const oldest = diagnosticRegistry.keys().next().value;
      if (oldest) diagnosticRegistry.delete(oldest);
    }
    return safe;
  }

  function lookupDiagnostic(correlationId) {
    const id = String(correlationId || '').trim();
    if (!id) return null;
    return diagnosticRegistry.get(id) || null;
  }

  function generateCorrelationId(prefix) {
    correlationCounter += 1;
    const stamp = Date.now().toString(36).toUpperCase();
    const seq = String(correlationCounter).padStart(4, '0');
    return `${prefix || 'TDW-BOOT'}-${stamp}-${seq}`;
  }

  function redactSensitive(value) {
    const s = String(value == null ? '' : value);
    return s
      .replace(/ya29\.[A-Za-z0-9_\-.]+/g, '[REDACTED_TOKEN]')
      .replace(/Bearer\s+[A-Za-z0-9_\-.]+/gi, 'Bearer [REDACTED]')
      .replace(/password["']?\s*[:=]\s*["']?[^"'\s]+["']?/gi, 'password:[REDACTED]')
      .replace(/refresh_token["']?\s*[:=]\s*\S+/gi, 'refresh_token:[REDACTED]')
      .replace(/client_secret["']?\s*[:=]\s*\S+/gi, 'client_secret:[REDACTED]')
      .replace(/activation["']?\s*[:=]\s*\S+/gi, 'activation:[REDACTED]');
  }

  function resolveRawCode(raw) {
    if (!raw) return 'step_failed';
    const envelope = global.IpcErrorEnvelope;
    if (typeof raw === 'string') {
      return envelope?.decodeIpcError?.(raw)?.code || raw;
    }
    if (raw.cancelled === true || raw.canceled === true) return raw.code || raw.error || 'oauth_cancelled';
    const direct = raw.code || raw.error || raw.reason || raw.diagnosticCode;
    if (direct) return envelope?.decodeIpcError?.(String(direct))?.code || direct;
    // A bare Error that crossed IPC: the cause only exists inside the message.
    const decoded = envelope?.decodeIpcError?.(raw);
    if (decoded?.code) return decoded.code;
    if (envelope?.isIpcWrapperError?.(raw)) return 'main_process_call_failed';
    return 'step_failed';
  }

  function lookupPolicy(code) {
    const raw = String(code || '');
    const lower = raw.toLowerCase();
    // Accept both snake codes and displayed TDW forms:
    // rbac_session_required ↔ TDW-BOOT-RBAC_SESSION_REQUIRED ↔ TDW-BOOT-RBAC-SESSION
    const stripped = lower.replace(/^tdw[-_]?boot[-_]?/, '').replace(/-/g, '_');
    const key = stripped.replace(/^tdw_boot_/, '');
    const byPolicyCode = Object.values(CODE_POLICY).find((p) => String(p.code || '').toLowerCase() === lower);
    const direct = CODE_POLICY[raw]
      || CODE_POLICY[lower]
      || CODE_POLICY[key]
      || CODE_POLICY[stripped]
      || byPolicyCode;
    if (direct) return direct;
    if (/cancel|abort|user.?denied/.test(key)) {
      return { outcome: OUTCOME.CANCELLED, cancelled: true, code: `TDW-BOOT-${key.toUpperCase().slice(0, 24)}` };
    }
    if (/timeout|offline|network|429|5\d\d|in_flight|interrupted|unavailable/.test(key)) {
      return { outcome: OUTCOME.RETRYABLE, retryable: true, code: `TDW-BOOT-${key.toUpperCase().slice(0, 24)}` };
    }
    if (/password|required|invalid|mismatch|ambiguous|selection|limit|weak|select/.test(key)) {
      return { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: `TDW-BOOT-${key.toUpperCase().slice(0, 24)}` };
    }
    if (/integrity|corrupt|fatal|unsupported/.test(key)) {
      return { outcome: OUTCOME.FATAL, fatal: true, code: `TDW-BOOT-${key.toUpperCase().slice(0, 24)}` };
    }
    // Never turn free-text (e.g. an IPC wrapper message) into a diagnostic code.
    const token = String(code || '').trim();
    const isCodeLike = token.length > 0 && token.length <= 64 && /^[a-z0-9_.:-]+$/i.test(token);
    if (!isCodeLike) {
      return {
        outcome: OUTCOME.RETRYABLE,
        retryable: true,
        unclassified: true,
        code: 'TDW-BOOT-UNCLASSIFIED',
        message: 'تعذّر تحديد سبب المشكلة بدقة. راجع ملف التشخيص ثم أعد المحاولة.',
      };
    }
    return {
      outcome: OUTCOME.RETRYABLE,
      retryable: true,
      unclassified: true,
      code: `TDW-BOOT-${token.replace(/[^A-Z0-9_]/gi, '-').toUpperCase().slice(0, 32)}`,
    };
  }

  function isTruthySuccess(raw) {
    if (raw == null) return false;
    if (typeof raw === 'boolean') return raw === true;
    if (typeof raw === 'object') {
      if (raw.ok === false) return false;
      if (raw.success === false) return false;
      if (raw.ok === true || raw.success === true) return true;
      if (raw.outcome === OUTCOME.SUCCESS) return true;
    }
    return false;
  }

  function normalizeFailure(raw, options) {
    options = options || {};
    if (isTruthySuccess(raw)) {
      return {
        ok: true,
        outcome: OUTCOME.SUCCESS,
        code: options.code || 'TDW-BOOT-SUCCESS',
        message: options.message || 'اكتملت العملية بنجاح.',
        retryable: false,
        userActionRequired: false,
        fatal: false,
        cancelled: false,
        details: null,
        correlationId: options.correlationId || generateCorrelationId('TDW-BOOT-OK'),
        stepId: options.stepId || null,
      };
    }
    const code = options.code || resolveRawCode(raw);
    const policy = lookupPolicy(code);
    const AE = global.ActivationErrors;
    const userErr = AE?.toUserError ? AE.toUserError(raw, code) : null;
    const message = options.message
      || policy.message
      || userErr?.detail
      || (typeof raw === 'object' && raw.message && String(raw.message) !== String(code) ? raw.message : null)
      || (typeof raw === 'string' ? raw : null)
      || 'حدث خطأ غير متوقع — راجع التفاصيل أو أعد المحاولة.';
    const outcome = raw?.outcome && OUTCOME[raw.outcome] ? raw.outcome
      : (raw?.retryable === true ? OUTCOME.RETRYABLE : policy.outcome);
    const result = {
      ok: false,
      outcome,
      code: policy.code || code,
      message,
      retryable: outcome === OUTCOME.RETRYABLE || policy.retryable === true || raw?.retryable === true,
      userActionRequired: outcome === OUTCOME.USER_ACTION_REQUIRED || policy.userActionRequired === true,
      fatal: outcome === OUTCOME.FATAL || policy.fatal === true,
      cancelled: outcome === OUTCOME.CANCELLED || policy.cancelled === true || raw?.cancelled === true || raw?.canceled === true,
      details: options.includeDetails ? redactSensitive(JSON.stringify(raw?.details || raw)) : null,
      correlationId: options.correlationId || generateCorrelationId('TDW-BOOT-ERR'),
      stepId: options.stepId || raw?.stepId || null,
      rawCode: code,
    };
    if (result.code === 'unknown' || result.rawCode === 'unknown') {
      result.code = policy.code || `TDW-BOOT-${String(code).toUpperCase().slice(0, 24)}`;
    }
    return result;
  }

  function normalizeResult(raw, options) {
    return normalizeFailure(raw, options);
  }

  function logBootstrapFailure(entry) {
    entry = entry || {};
    const safe = {
      step: entry.step || entry.stepId || null,
      outcome: entry.outcome || null,
      code: entry.code || null,
      correlationId: entry.correlationId || null,
      details: entry.safeDetails ? redactSensitive(entry.safeDetails) : null,
    };
    if (safe.correlationId) {
      recordDiagnostic({
        correlationId: safe.correlationId,
        stepId: safe.step,
        code: safe.code,
        outcome: safe.outcome,
        message: safe.details,
      });
    }
    if (typeof console !== 'undefined' && console.info) {
      console.info('[BootstrapFailure]', safe);
    }
    return safe;
  }

  function buildFailurePolicyMatrix() {
    const gates = [
      'Activation', 'Google/OAuth', 'Discovery', 'Path Decision', 'Organization',
      'Owner', 'Branch', 'Device', 'Business Setup', 'Publication', 'Read-back',
      'Restore', 'Owner Auth', 'Initial Sync',
    ];
    const rows = [];
    for (const [key, policy] of Object.entries(CODE_POLICY)) {
      rows.push({
        gate: key.split('_')[0],
        failure: key,
        outcome: policy.outcome,
        code: policy.code,
        retry: !!policy.retryable,
        userAction: !!policy.userActionRequired,
        fatal: !!policy.fatal,
        cancel: !!policy.cancelled,
        statePreserved: policy.fatal ? 'blocked' : 'current gate only',
      });
    }
    return { gates, rows, outcomes: Object.values(OUTCOME) };
  }

  function buildDiagnosticCodeRegistry() {
    return Object.fromEntries(
      Object.entries(CODE_POLICY).map(([k, v]) => [k, { code: v.code, outcome: v.outcome }]),
    );
  }

  function buildContract() {
    return {
      outcomes: OUTCOME,
      fields: ['ok', 'outcome', 'code', 'message', 'retryable', 'userActionRequired', 'fatal', 'cancelled', 'details', 'correlationId', 'stepId'],
      truthySuccessRule: 'ok===true only; {ok:false} is never success',
      unknownPolicy: 'map known codes; avoid literal unknown when classifiable',
    };
  }

  function buildErrorInventory() {
    return {
      sources: Object.keys(GATE_STEPS),
      patterns: ['throw new Error', 'return {ok:false}', 'setStatusFromErr', 'ActivationErrors', 'catch'],
      files: [
        'cloud/boot-flow-ui.js',
        'cloud/bootstrap-checklist-contract.js',
        'cloud/bootstrap-failure-policy-contract.js',
        'cloud/activation-errors.js',
        'cloud/bootstrap-coordinator.js',
        'cloud/bootstrap-gates.js',
      ],
    };
  }

  const BootstrapFailurePolicyContract = {
    OUTCOME,
    GATE_STEPS,
    CODE_POLICY,
    generateCorrelationId,
    recordDiagnostic,
    lookupDiagnostic,
    redactSensitive,
    isTruthySuccess,
    normalizeFailure,
    normalizeResult,
    lookupPolicy,
    logBootstrapFailure,
    buildFailurePolicyMatrix,
    buildDiagnosticCodeRegistry,
    buildContract,
    buildErrorInventory,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BootstrapFailurePolicyContract;
  }
  global.BootstrapFailurePolicyContract = BootstrapFailurePolicyContract;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global);
