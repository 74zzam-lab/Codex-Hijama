/**
 * V2-5.8 — User-facing activation errors + safe diagnostic codes (no secrets).
 */
(function (global) {
  'use strict';

  const USER_MESSAGES = Object.freeze({
    oauth_cancelled: { title: 'تم إلغاء تسجيل الدخول', detail: 'أُلغي ربط Google. يمكنك المحاولة مرة أخرى.' },
    oauth_access_denied: { title: 'تم رفض الصلاحيات', detail: 'الحساب لا يمتلك الصلاحيات المطلوبة لـ Drive.' },
    oauth_timeout: { title: 'انتهت المهلة', detail: 'انتهت مهلة انتظار Google. تحقق من الاتصال وحاول مرة أخرى.' },
    oauth_offline: { title: 'لا يوجد اتصال بالإنترنت', detail: 'تعذّر الوصول إلى Google — تحقق من الشبكة.' },
    oauth_port_in_use: { title: 'تعذّر فتح نافذة الربط', detail: 'منفذ إعادة التوجيه مشغول. أعد المحاولة.' },
    oauth_invalid_grant: { title: 'انتهت صلاحية الجلسة', detail: 'أعد ربط حساب Google.' },
    oauth_redirect_mismatch: { title: 'Redirect URI غير صحيح', detail: 'إعدادات OAuth غير متطابقة مع التطبيق.' },
    oauth_api_disabled: { title: 'Google API غير مفعّل', detail: 'فعّل Drive API في مشروع Google Cloud.' },
    oauth_failed: { title: 'فشل ربط Google', detail: 'تعذّر إكمال المصادقة. راجع التشخيص ثم أعد المحاولة.' },
    drive_unreachable: { title: 'تعذّر الوصول إلى Drive', detail: 'تحقق من الاتصال وصلاحيات الحساب.' },
    sheets_unreachable: { title: 'تعذّر الوصول إلى Sheets', detail: 'بوابة الترخيص غير متاحة حالياً. يمكن المتابعة محلياً إن وُجدت الحزمة.' },
    license_invalid: { title: 'مفتاح ترخيص غير صالح', detail: 'تحقق من المفتاح وأعد المحاولة.' },
    license_expired: { title: 'الترخيص منتهٍ', detail: 'جدّد الترخيص من المطوّر ثم أعد التفعيل.' },
    license_wrong_account: { title: 'المفتاح غير مرتبط بهذا الحساب', detail: 'استخدم حساب Google المرتبط بالمركز.' },
    license_other_org: { title: 'المفتاح مرتبط بمؤسسة أخرى', detail: 'لا يمكن خلط بيانات أكثر من مركز.' },
    license_device_limit: { title: 'تم تجاوز عدد الأجهزة', detail: 'احذف جهازاً قديماً أو رقِّ الباقة.' },
    license_branch_limit: { title: 'تم تجاوز عدد الفروع', detail: 'لا يمكن إنشاء فرع إضافي ضمن الباقة الحالية.' },
    license_offline: { title: 'غير متصل', detail: 'التفعيل عبر السحابة يتطلب إنترنت — أو استخدم حزمة تفعيل محلية.' },
    license_timeout: { title: 'انتهت مهلة سحب الترخيص', detail: 'أعد المحاولة عند استقرار الشبكة.' },
    license_server_error: { title: 'خطأ في خادم الترخيص', detail: 'حاول لاحقاً أو تواصل مع المطوّر.' },
    setup_activation_failed: { title: 'تعذّر حفظ التفعيل', detail: 'تم الوصول إلى الترخيص، لكن تعذّر حفظه محليًا. أعد المحاولة وانسخ رمز التشخيص إن استمر الخطأ.' },
    org_fetch_failed: { title: 'فشل سحب المؤسسات', detail: 'تعذّر جلب بيانات المؤسسة المصرّح بها.' },
    branch_fetch_failed: { title: 'فشل سحب الفروع', detail: 'تعذّر جلب قائمة الفروع.' },
    branch_name_required: { title: 'اسم الفرع مطلوب', detail: 'أدخل اسماً بالعربية للفرع.' },
    branch_code_duplicate: { title: 'رمز الفرع مكرر', detail: 'اختر رمزاً غير مستخدم.' },
    branch_duplicate_create: { title: 'منع إنشاء مكرر', detail: 'جارٍ إنشاء الفرع بالفعل — انتظر اكتمال العملية.' },
    owner_password_required: { title: 'كلمة مرور المالك مطلوبة', detail: 'لا يمكن إنشاء Owner بدون كلمة مرور.' },
    owner_password_mismatch: { title: 'كلمتا المرور غير متطابقتين', detail: 'أعد إدخال التأكيد.' },
    owner_password_weak: { title: 'كلمة المرور قصيرة', detail: 'استخدم 8 أحرف على الأقل.' },
    owner_duplicate: { title: 'حساب المالك موجود', detail: 'لا تنشئ Owner مرتين — سجّل الدخول أو استعد.' },
    restore_interrupted: { title: 'توقفت الاستعادة', detail: 'بياناتك المحلية آمنة. يمكنك إعادة المحاولة.' },
    cloud_download_failed: { title: 'فشل تنزيل النسخة السحابية', detail: 'تعذّر تنزيل ملف Backup من Google Drive. تحقق من الاتصال وأعد المحاولة.' },
    cloud_download_incomplete: { title: 'تنزيل غير مكتمل', detail: 'انقطع تنزيل النسخة قبل اكتماله. أعد المحاولة.' },
    cloud_backup_restore_failed: { title: 'فشلت استعادة النسخة السحابية', detail: 'تعذّر تطبيق النسخة المختارة. بياناتك المحلية محفوظة.' },
    backup_password_required: { title: 'كلمة مرور النسخة مطلوبة', detail: 'أدخل كلمة مرور Backup V2 للجهاز الجديد أو النسخة القديمة.' },
    backup_password_invalid: { title: 'كلمة مرور النسخة غير صحيحة', detail: 'تحقق من كلمة مرور Backup V2 وأعد المحاولة.' },
    setup_restore_requires_empty_database: { title: 'قاعدة البيانات ليست فارغة', detail: 'استعادة الإعداد تتطلب قاعدة بيانات فارغة. استخدم مسار الاستعادة الكامل بدلاً من ذلك.' },
    restore_reconcile_incomplete: { title: 'مواءمة ما بعد الاستعادة غير مكتملة', detail: 'اكتملت الاستعادة لكن المزامنة اللاحقة تحتاج إعادة محاولة.' },
    local_restore_failed: { title: 'فشلت الاستعادة المحلية', detail: 'تعذّر تطبيق ملف النسخة المختار.' },
    google_not_connected: { title: 'Google غير متصل', detail: 'أكمل ربط حساب Google قبل المزامنة الأولية.' },
    activation_defaults_failed: { title: 'تعذّر تفعيل الإعداد', detail: 'فشل تطبيق إعدادات التفعيل الافتراضية. أعد المحاولة.' },
    initial_sync_failed: { title: 'فشلت المزامنة الأولية', detail: 'تعذّر إكمال المزامنة الأولى بعد الاستعادة.' },
    owner_credential_required: { title: 'حساب المالك مطلوب', detail: 'أنشئ حساب المالك بكلمة مرور قبل المزامنة.' },
    owner_session_required: { title: 'جلسة المالك مطلوبة', detail: 'سجّل دخول المالك في خطوة الإعداد قبل المزامنة.' },
    setup_owner_authentication_failed: { title: 'فشل التحقق من المالك', detail: 'تعذّر التحقق من كلمة مرور المالك أثناء الإعداد.' },
    sync_interrupted: { title: 'توقفت المزامنة', detail: 'يمكنك إعادة المحاولة دون فقدان التقدم المحفوظ.' },
    step_required: { title: 'خطوة مطلوبة', detail: 'أكمل هذه الخطوة قبل المتابعة.' },
    backup_v1_disabled: { title: 'Backup V1 معطّل', detail: 'استخدم Backup V2 لاستعادة الكوارث وCloud V2 للمزامنة.' },
    conflict_resolve_failed: { title: 'تعذّر حل التعارض', detail: 'أعد المحاولة أو راجع التعارضات من Owner Hub.' },
    bootflow_required: { title: 'أكمل الإعداد الموحّد', detail: 'استخدم معالج الإعداد (BootFlow) قبل الدخول.' },
    unknown: { title: 'حدث خطأ', detail: 'تعذّر إكمال العملية. انسخ رمز التشخيص إن استمر الخطأ.' }
  });

  function classifyTechnical(err) {
    const msg = String(err && (err.message || err.error || err.code || err) || '').toLowerCase();
    if (/access_denied|cancelled|canceled|user.?denied/.test(msg)) return 'oauth_access_denied';
    if (/timeout|oauth_timeout/.test(msg)) return 'oauth_timeout';
    if (/eaddrinuse|port.?in.?use/.test(msg)) return 'oauth_port_in_use';
    if (/invalid_grant|token.?expired|needs.?reauth/.test(msg)) return 'oauth_invalid_grant';
    if (/redirect.?uri|redirect_uri_mismatch/.test(msg)) return 'oauth_redirect_mismatch';
    if (/api.?not.?enabled|accessNotConfigured/.test(msg)) return 'oauth_api_disabled';
    if (/offline|failed to fetch|network|enotfound|enetunreach/.test(msg)) return 'oauth_offline';
    if (/drive/.test(msg) && /403|401|permission/.test(msg)) return 'drive_unreachable';
    if (/cloud_download|download_failed|download_incomplete/.test(msg)) return 'cloud_download_failed';
    if (/backup_password_required|password_required/.test(msg)) return 'backup_password_required';
    if (/backup_password_invalid|backup_authentication_failed|decrypt|auth_tag|scrypt/.test(msg)) return 'backup_password_invalid';
    if (/cloud_backup_restore_failed|restore_failed|legacy_setup_restore_failed/.test(msg)) return 'cloud_backup_restore_failed';
    if (/setup_restore_requires_empty_database/.test(msg)) return 'setup_restore_requires_empty_database';
    if (/restore_reconcile|reconcile_incomplete/.test(msg)) return 'restore_reconcile_incomplete';
    if (/local_restore_failed|invalid_local_backup_path/.test(msg)) return 'local_restore_failed';
    if (/google_not_connected|not_connected/.test(msg)) return 'google_not_connected';
    if (/activation_defaults_failed|activation_incomplete/.test(msg)) return 'activation_defaults_failed';
    if (/initial_sync_failed|sync_not_ready/.test(msg)) return 'initial_sync_failed';
    if (/owner_credential_required|owner_password_required/.test(msg)) return 'owner_credential_required';
    if (/owner_session_required/.test(msg)) return 'owner_session_required';
    if (/setup_owner_authentication/.test(msg)) return 'setup_owner_authentication_failed';
    if (/sheet|vault/.test(msg) && /fail|unreachable|timeout/.test(msg)) return 'sheets_unreachable';
    if (/license.?expired|expired/.test(msg)) return 'license_expired';
    if (/setup.?activation|license_settings_commit_failed|raw_kv_operational_write_denied|setup_activation_hydrate_failed/.test(msg)) return 'setup_activation_failed';
    if (/invalid.?key|license.?invalid|bundle_missing/.test(msg)) return 'license_invalid';
    if (/device.?limit|maxDevices/.test(msg)) return 'license_device_limit';
    if (/branch.?limit|maxBranches/.test(msg)) return 'license_branch_limit';
    if (/password.?required|empty.?password/.test(msg)) return 'owner_password_required';
    if (/password.?mismatch|confirm/.test(msg)) return 'owner_password_mismatch';
    if (/password.?weak|too.?short|min.?length/.test(msg)) return 'owner_password_weak';
    if (/profile_exists|owner_already/.test(msg)) return 'owner_duplicate';
    if (/branch_name/.test(msg)) return 'branch_name_required';
    if (/branch_id_exists|code.?duplicate/.test(msg)) return 'branch_code_duplicate';
    if (/in.?flight|already.?creating|duplicate.?create/.test(msg)) return 'branch_duplicate_create';
    if (/backup_v1_disabled|BACKUP_V1_DISABLED/.test(msg)) return 'backup_v1_disabled';
    if (/conflict.?resolve|not_found|already_resolved/.test(msg)) return 'conflict_resolve_failed';
    if (/boot.?flow|needs.?boot|activation.?required/.test(msg)) return 'bootflow_required';
    return 'unknown';
  }

  function diagnosticCode(code) {
    const stamp = Date.now().toString(36).toUpperCase();
    const safe = String(code || 'unknown').replace(/[^a-z0-9_]/gi, '').slice(0, 40);
    return `TDW-ACT-${safe}-${stamp}`;
  }

  function redact(value) {
    const s = String(value == null ? '' : value);
    return s
      .replace(/ya29\.[A-Za-z0-9_\-.]+/g, '[REDACTED_TOKEN]')
      .replace(/Bearer\s+[A-Za-z0-9_\-.]+/gi, 'Bearer [REDACTED]')
      .replace(/password["']?\s*[:=]\s*["'][^"']*["']?/gi, 'password:[REDACTED]')
      .replace(/password["']?\s*[:=]\s*\S+/gi, 'password:[REDACTED]')
      .replace(/client_secret["']?\s*[:=]\s*["'][^"']*/gi, 'client_secret:[REDACTED]');
  }

  function toUserError(err, fallbackCode) {
    const code = fallbackCode || classifyTechnical(err);
    const mapped = USER_MESSAGES[code] || USER_MESSAGES.unknown;
    const diag = diagnosticCode(code);
    const technical = redact(err && (err.message || err.error || err) || code);
    try {
      global.AuditLogger?.log?.({
        action: 'ACTIVATION_ERROR',
        entity: 'activation',
        entityId: diag,
        detail: { code, technical: String(technical).slice(0, 240) }
      });
    } catch { /* empty */ }
    return {
      ok: false,
      code,
      title: mapped.title,
      detail: mapped.detail,
      diagnosticCode: diag,
      technical: String(technical).slice(0, 240),
      safe: true,
      retryable: !/license_invalid|license_other_org|owner_duplicate|branch_code_duplicate/.test(code)
    };
  }

  function formatForUi(userErr) {
    if (!userErr) return '';
    return `${userErr.title} — ${userErr.detail} [${userErr.diagnosticCode || ''}]`;
  }

  const api = {
    USER_MESSAGES,
    classifyTechnical,
    diagnosticCode,
    redact,
    toUserError,
    formatForUi
  };
  global.ActivationErrors = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
