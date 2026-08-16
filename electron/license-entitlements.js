'use strict';

const FEATURE_GROUPS = Object.freeze({
  attendance: ['attendance', 'att_daily', 'att_leave', 'att_overtime', 'att_report', 'att_policy', 'cap_hr_att', 'hr_attendance'],
  payroll: ['payroll', 'pay_salary', 'pay_commission', 'hr_ledger', 'cap_hr_pay'],
  inventory: ['inventory', 'stock', 'ops_inventory', 'cap_inventory'],
  expenses: ['expenses', 'finance', 'exp_track', 'exp_budget', 'pkg_bank', 'fin_cashfloat', 'cap_finance'],
  reports: ['reports', 'reporting', 'rep_monthly', 'rep_doctors', 'rep_vat', 'rep_zreport', 'rep_profitability', 'rep_sales', 'cap_reports'],
  appointments: ['appointments', 'bookings', 'book_schedule', 'book_confirm', 'core_bookings'],
  clients: ['clients', 'cases', 'core_clients', 'core_cases'],
  sync: ['sync', 'cloud_sync', 'multi_device', 'cloud_multi_device', 'bk_drive', 'cap_sync'],
  backup: ['backup', 'cloud_backup', 'bk_local', 'bk_custom', 'bk_cloud', 'bk_drive', 'cap_backup'],
});

const ENTITY_GROUP = Object.freeze({
  attendance: 'attendance', otRecords: 'attendance', employeeLeaveRequests: 'attendance',
  employeeLedgerAccruals: 'payroll', employeeLedgerPayments: 'payroll',
  employeeLedgerEntries: 'payroll', payrollRuns: 'payroll', payrollAdjustments: 'payroll',
  inventoryItems: 'inventory', inventorySuppliers: 'inventory', inventoryMovements: 'inventory',
  expenses: 'expenses', cashMovements: 'expenses', financialPostings: 'expenses',
  bookings: 'appointments', cases: 'clients', clientsRegistry: 'clients',
});

function normalizeFeatures(license) {
  const raw = license?.features;
  if (Array.isArray(raw)) return new Set(raw.map((value) => String(value).toLowerCase()));
  if (raw && typeof raw === 'object') {
    return new Set(Object.entries(raw).filter(([, enabled]) => !!enabled).map(([key]) => String(key).toLowerCase()));
  }
  return new Set();
}

function activeBranchIds(license) {
  return new Set((Array.isArray(license?.branches) ? license.branches : [])
    .filter((branch) => branch && branch.active !== false && !branch.pending && branch.id)
    .map((branch) => String(branch.id)));
}

function check(license, options = {}) {
  // The authenticated developer identity issued by password-auth/rbac-session
  // is __dev__. Keep the support entitlement bound to that exact trusted
  // main-process identity; a renderer claim alone cannot create this session.
  if (options.actorId === '__dev__') return { ok: true, developerSupport: true };
  if (!license || typeof license !== 'object') return { ok: false, error: 'license_required' };
  const expiry = Date.parse(String(license.expiresAt || license.expiry || ''));
  if (!Number.isFinite(expiry)) return { ok: false, error: 'license_expiry_invalid' };
  if (expiry <= Date.now()) return { ok: false, error: 'license_expired' };

  const branchIds = activeBranchIds(license);
  if (options.branchId && options.branchId !== '__ORG__' && branchIds.size && !branchIds.has(String(options.branchId))) {
    return { ok: false, error: 'license_branch_not_entitled' };
  }

  const group = options.group || ENTITY_GROUP[options.entity];
  const features = normalizeFeatures(license);
  // Legacy allowlisted licenses without a feature registry retain their
  // historical full package during controlled V6 migration.
  if (!group || Number(license.schemaVersion) !== 6) return { ok: true };
  const aliases = FEATURE_GROUPS[group] || [group];
  if (!aliases.some((feature) => features.has(String(feature).toLowerCase()))) {
    return { ok: false, error: 'license_feature_not_entitled', featureGroup: group };
  }
  return { ok: true, featureGroup: group };
}

function assert(license, options) {
  const result = check(license, options);
  if (!result.ok) {
    const error = new Error(result.error);
    error.code = result.error;
    error.details = result;
    throw error;
  }
  return result;
}

module.exports = { FEATURE_GROUPS, ENTITY_GROUP, normalizeFeatures, activeBranchIds, check, assert };
