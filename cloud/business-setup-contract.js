/**
 * Stage 12 — Business Setup contract (read-only evaluation + field rules).
 * Authority: settings SoT (+ license centerName fallback for read only).
 */
(function (global) {
  'use strict';

  const PLACEHOLDER_CENTER_NAMES = Object.freeze([
    'مركز الحجامة',
    'الفرع الرئيسي',
    'Hijama Center',
    'Main Branch',
    'Clinic',
    'Center',
  ]);

  const REQUIRED_FIELDS = Object.freeze([
    { key: 'centerName', level: 'organization', label: 'اسم المركز', rejectPlaceholders: true },
    { key: 'phone', level: 'organization', label: 'هاتف المركز', minLength: 6 },
  ]);

  const OPTIONAL_FIELDS = Object.freeze([
    { key: 'centerNameEn', level: 'organization', label: 'اسم المركز (EN)' },
    { key: 'address', level: 'organization', label: 'العنوان' },
    { key: 'centerCity', level: 'organization', label: 'المدينة' },
    { key: 'taxNum', level: 'organization', label: 'الرقم الضريبي' },
    { key: 'crNum', level: 'organization', label: 'السجل التجاري' },
    { key: 'waNumber', level: 'organization', label: 'واتساب' },
    { key: 'siteUrl', level: 'organization', label: 'رابط الموقع' },
  ]);

  function normalizeName(value) {
    return String(value || '').trim();
  }

  function isPlaceholderCenterName(name) {
    const n = normalizeName(name);
    if (!n) return true;
    const licName = normalizeName(global.LicenseCloud?.loadLocal?.()?.centerName || '');
    const banned = [...PLACEHOLDER_CENTER_NAMES];
    if (licName && !banned.includes(licName)) {
      /* license-specific name is not a placeholder */
    }
    return banned.some((b) => b && n.toLowerCase() === String(b).toLowerCase());
  }

  function readSettingsSnapshot() {
    const settings = global.settings || global.DB?.get?.('settings', {}) || {};
    const lic = global.LicenseCloud?.loadLocal?.() || {};
    return {
      centerName: normalizeName(settings.centerName || lic.centerName || ''),
      centerNameEn: normalizeName(settings.centerNameEn || ''),
      phone: normalizeName(settings.phone || ''),
      address: normalizeName(settings.address || ''),
      centerCity: normalizeName(settings.centerCity || ''),
      taxNum: normalizeName(settings.taxNum || ''),
      crNum: normalizeName(settings.crNum || ''),
      waNumber: normalizeName(settings.waNumber || ''),
      siteUrl: normalizeName(settings.siteUrl || ''),
      organizationId: String(lic.centerId || global.CenterId?.getStoredCenterId?.() || '').trim(),
    };
  }

  function fieldIssues(snapshot) {
    const issues = [];
    const s = snapshot || readSettingsSnapshot();
    const name = s.centerName;
    if (!name) issues.push({ field: 'centerName', code: 'required', message: 'center name required' });
    else if (isPlaceholderCenterName(name)) {
      issues.push({ field: 'centerName', code: 'placeholder', message: 'placeholder center name not accepted' });
    }
    const phone = normalizeName(s.phone).replace(/\D/g, '');
    if (!phone || phone.length < 6) {
      issues.push({ field: 'phone', code: 'required', message: 'business phone required' });
    }
    return issues;
  }

  function isResolved(snapshot) {
    return fieldIssues(snapshot).length === 0;
  }

  function validateFormInput(input) {
    const merged = { ...readSettingsSnapshot(), ...(input || {}) };
    return { ok: fieldIssues(merged).length === 0, issues: fieldIssues(merged), snapshot: merged };
  }

  function buildContract() {
    return {
      requiredFields: REQUIRED_FIELDS.map((f) => f.key),
      optionalFields: OPTIONAL_FIELDS.map((f) => f.key),
      placeholderCenterNames: PLACEHOLDER_CENTER_NAMES.slice(),
      evaluation: 'read-only settings SoT',
      authority: 'settings + license.centerName (read fallback only)',
    };
  }

  const BusinessSetupContract = {
    PLACEHOLDER_CENTER_NAMES,
    REQUIRED_FIELDS,
    OPTIONAL_FIELDS,
    readSettingsSnapshot,
    fieldIssues,
    isResolved,
    validateFormInput,
    isPlaceholderCenterName,
    buildContract,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BusinessSetupContract;
  }
  global.BusinessSetupContract = BusinessSetupContract;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global);
