'use strict';

const CORE_TABLES = Object.freeze({
  clientsRegistry: 'clients',
  cases: 'visits',
  bookings: 'bookings',
  doctors: 'employees',
  attendance: 'attendance',
  expenses: 'expenses',
});

const BRANCH_ENTITY_KEYS = Object.freeze([
  'inventoryItems', 'inventorySuppliers', 'inventoryMovements',
  'otRecords', 'nextSessions', 'employeeLeaveRequests',
  'employeeLedgerAccruals', 'employeeLedgerPayments', 'employeeLedgerEntries',
  'messageLog', 'cashDrawerSession', 'budget', 'luxQueue',
  'invoiceCounter', 'clientFileCounter', '__tdw_attachment_manifest__',
  'payrollPeriods', 'payrollEntries', 'commissions', 'invoices', 'payments',
  'attachments',
  'financialPostings', 'cashMovements', 'auditEvents',
  'payrollRuns', 'payrollAdjustments',
  '__tdw_conflict_queue__', '__tdw_conflict_archive__',
]);

const ORGANIZATION_ENTITY_KEYS = Object.freeze([
  'users', 'settings', 'packages', 'services', '__tdw_device_registry__',
  '__tdw_owner_profile__', '__tdw_owner_session_epoch__', '__tdw_owner_setup__',
]);

const NON_OPERATIONAL_KV_KEYS = Object.freeze([
  'backupLog', 'backupRegistry', 'activityLog', 'hardwareLog', 'importHistory',
  'systemLogs', 'logCounter', 'communicationWebhookLog', 'communicationQueue',
  'importStudioLog', 'backupUploadQueue', 'backupOpCounter', 'preImportBackup',
  'devContact', 'tablePageSize', 'logsPageSize',
  '__tdw_meta__', '__tdw_cloud_license__', '__tdw_drive_folders__',
  '__tdw_repo_revisions__', '__tdw_versions__', '__tdw_sync_state__',
  '__tdw_branch_summaries__', '__tdw_audit_log__', '__tdw_audit_pending_drive__',
   '__tdw_branch_idempotency__',
  '__tdw_device_config__', '__tdw_branch_creation_pending__',
  '__tdw_license_activation_state__',
  '__tdw_setup_google__',
  '__tdw_setup_settings_shadow__',
  'commercial_license_data_v2', 'commercial_license_audit_v2',
  '__tdw_owner_migration__',
]);

const SINGLETON_ENTITY_KEYS = Object.freeze([
  'settings', '__tdw_owner_profile__', '__tdw_owner_session_epoch__', '__tdw_owner_setup__',
  '__tdw_device_registry__',
  'cashDrawerSession', 'budget', 'invoiceCounter', 'clientFileCounter',
  '__tdw_attachment_manifest__',
]);

const UI_PREFERENCE_KEYS = Object.freeze([
  '__tdw_ui_theme__', '__tdw_ui_lang__', '__tdw_last_tab__', '__tdw_wizard_ui__',
  'tdw_sidebar_collapsed',
]);

const CORE_SET = new Set(Object.keys(CORE_TABLES));
const BRANCH_SET = new Set(BRANCH_ENTITY_KEYS);
const ORGANIZATION_SET = new Set(ORGANIZATION_ENTITY_KEYS);
const NON_OPERATIONAL_KV_SET = new Set(NON_OPERATIONAL_KV_KEYS);
const UI_PREFERENCE_SET = new Set(UI_PREFERENCE_KEYS);
const OPERATIONAL_SET = new Set([...CORE_SET, ...BRANCH_SET, ...ORGANIZATION_SET]);
const SINGLETON_SET = new Set(SINGLETON_ENTITY_KEYS);

function classifyKey(key) {
  const normalized = String(key || '');
  if (CORE_SET.has(normalized)) return { kind: 'core', key: normalized, branchOwned: true };
  if (BRANCH_SET.has(normalized)) return { kind: 'entity', key: normalized, branchOwned: true };
  if (ORGANIZATION_SET.has(normalized)) return { kind: 'entity', key: normalized, branchOwned: false };
  if (NON_OPERATIONAL_KV_SET.has(normalized)) return { kind: 'kv', key: normalized, branchOwned: false };
  if (UI_PREFERENCE_SET.has(normalized)) return { kind: 'ui-preference', key: normalized, branchOwned: false };
  return { kind: 'unknown', key: normalized, branchOwned: false };
}

module.exports = {
  CORE_TABLES,
  BRANCH_ENTITY_KEYS,
  ORGANIZATION_ENTITY_KEYS,
  NON_OPERATIONAL_KV_KEYS,
  UI_PREFERENCE_KEYS,
  SINGLETON_ENTITY_KEYS,
  CORE_SET,
  BRANCH_SET,
  ORGANIZATION_SET,
  NON_OPERATIONAL_KV_SET,
  UI_PREFERENCE_SET,
  OPERATIONAL_SET,
  SINGLETON_SET,
  classifyKey,
};
