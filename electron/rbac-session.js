'use strict';

const crypto = require('crypto');

const ROLE_RANK = Object.freeze({
  employee: 1,
  reception: 2,
  accountant: 3,
  admin: 4,
  hq_admin: 5,
  owner: 6,
  custom: 2,
});

/** Complete IPC authorization inventory. Unknown channels are denied. */
const CHANNEL_POLICY = Object.freeze({
  'app:getRuntimeInfo': { public: true },
  'app:relaunch': { public: true },
  'app:consumeLicenseWipeFlag': { public: true },
  'app:wipePersistentLicenseData': { minRank: 6, roles: ['owner'] },
  'app:writeUninstallCenterMeta': { public: true },
  'app:openExternal': { public: true },
  'app:getDeviceFingerprintParts': { public: true },

  'database:status': { public: true },
  'database:hydrate': { public: true },
  // Narrow pre-auth flow: handler re-downloads and verifies Drive license and
  // commits only allowlisted activation records into a bootstrap-safe target.
  'database:setupCommitActivation': { public: true },
  'database:setupCommitSignedActivation': { public: true },
  'database:setupCommitOrganizationDevice': { public: true },
  'database:setupCommitOwner': { public: true },
  'database:setupCommitGoogleConnection': { public: true },
  'database:bootstrapFromLocal': { public: true },
  'database:persistTable': { minRank: 2 },
  'database:persistKv': { minRank: 2 },
  'database:seedUsersIfEmpty': { minRank: 4 },
  'database:enableSqlitePrimary': { public: true },
  'database:migrateFromBackup': { minRank: 4 },
  'database:querySafe': { minRank: 1 },
  'database:exportSnapshot': { minRank: 3 },
  // Operation-specific authorization is enforced again by the main handler.
  'database:syncOp': { minRank: 1 },
  'database:command': { minRank: 1 },
  'database:commitFinancialCase': { minRank: 2 },
  'database:voidFinancialCase': { minRank: 3 },
  'database:finalizePayrollRun': { minRank: 3 },
  'database:adjustFinalizedPayroll': { minRank: 3 },

  'cloudOAuth:getSettings': { public: true },
  'cloudOAuth:saveSettings': { minRank: 4 },
  'cloudOAuth:restoreDefaults': { minRank: 4 },
  'cloudOAuth:testConnection': { public: true },

  'backup:saveLocal': { minRank: 4 },
  'backup:uploadCloud': { minRank: 2 },
  'backup:uploadActivationArtifact': { public: true },
  'backup:uploadSyncFile': { minRank: 2 },
  'backup:downloadSyncFile': { minRank: 2 },
  'backup:connectGoogle': { public: true },
  'backup:registerCloudAccount': { public: true },
  'backup:disconnectCloud': { public: true },
  'backup:listCloudBackups': { public: true },
  'backup:discoverCloudRestorePoints': { public: true },
  'backup:downloadCloudBackup': { public: true },
  'backup:deleteCloudBackup': { minRank: 4 },
  'backup:verifyCloudBackup': { public: true },
  'backup:startOAuth': { public: true },
  'backup:getCloudStatus': { public: true },
  'backup:listCloudProviders': { public: true },
  'backup:pickLocalFolder': { public: true },
  'backup:uploadDbBackup': { minRank: 4 },
  'backup:listDbBackups': { public: true },
  'backup:restoreDbBackup': { minRank: 4 },
  'backup:syncDbBackup': { minRank: 4 },
  'backup:verifyDbBackup': { public: true },
  'backup:v2:health': { public: true },
  'backup:v2:ensureSecret': { minRank: 4 },
  'backup:v2:rotateSecret': { minRank: 6, roles: ['owner'] },
  'backup:v2:create': { minRank: 4 },
  'backup:v2:verify': { public: true },
  'backup:v2:inspect': { public: true },
  'backup:v2:restore': { minRank: 4 },
  'backup:v2:setupLocalRestore': { public: true },
  'backup:v2:listLocal': { public: true },
  'backup:v2:pickLatest': { public: true },
  'backup:v2:restoreLatest': { minRank: 4 },
  'backup:v2:pickFile': { public: true },
  'backup:v2:gate': { public: true },
  'backup:v2:stageRemote': { public: true },
  'backup:v2:downloadAndRestore': { minRank: 4 },
  'backup:v2:setupCloudRestore': { public: true },
  'backup:v2:prune': { minRank: 4 },
  'backup:v2:formatPolicy': { public: true },
  'backup:v2:scheduleStatus': { minRank: 4 },
  'backup:v2:scheduleConfigure': { minRank: 4 },

  // Cache snapshots can contain users/settings/license-derived organization data.
  // Reads remain available to the setup recovery flow; writes require an authenticated manager.
  'cache:writeBranchConfig': { minRank: 4 },
  'cache:readBranchConfig': { public: true },
  'cache:writeLicense': { minRank: 4 },
  'cache:readLicense': { public: true },
  'cache:writeVersions': { minRank: 2 },
  'cache:readVersions': { public: true },
  'cache:getStatus': { public: true },

  'devices:listPrinters': { minRank: 2, permissions: ['reports.print', 'settings.view'] },
  'devices:printThermal': { minRank: 2, permissions: ['reports.print', 'cases.view'] },
  'devices:printA4': { minRank: 2, permissions: ['reports.print'] },
  'devices:exportA4Pdf': { minRank: 2, permissions: ['reports.print'] },
  'devices:printWithDialog': { minRank: 2, permissions: ['reports.print'] },
  'devices:openCashDrawer': { minRank: 2, permissions: ['cash.edit', 'cash.view'] },
  'devices:openCashDrawerDirect': { minRank: 2, permissions: ['cash.edit'] },
  'devices:getStatus': { minRank: 2, permissions: ['settings.view', 'reports.print'] },
  'devices:writeRaw': { minRank: 4, permissions: ['settings.edit'] },

  'messaging:sendWhatsApp': { minRank: 2, permissions: ['messages.send'] },
  'messaging:sendSMS': { minRank: 2, permissions: ['messages.send'] },
  'messaging:getStatus': { minRank: 2, permissions: ['messages.view', 'messages.send'] },
  'communication:listProviders': { minRank: 2, permissions: ['messages.view', 'settings.view'] },
  'communication:testProvider': { minRank: 4, permissions: ['settings.edit'] },
  'communication:send': { minRank: 2, permissions: ['messages.send'] },
  'communication:getStatus': { minRank: 2, permissions: ['messages.view', 'messages.send'] },
  'communication:processQueue': { minRank: 2, permissions: ['messages.send'] },
  'communication:getQueue': { minRank: 2, permissions: ['messages.view'] },
  'communication:clearQueue': { minRank: 4, permissions: ['settings.edit'] },
  'communication:init': { minRank: 4, permissions: ['settings.edit'] },
  'communication:saveCredentials': { minRank: 4, permissions: ['settings.edit'] },
  'communication:getCredentialStatus': { minRank: 4, permissions: ['settings.view'] },
  'communication:deleteCredentials': { minRank: 4, permissions: ['settings.edit'] },

  'license:readActivationBundle': { public: true },
  'license:vaultRequest': { public: true },
  'license:writeLicenseShard': { minRank: 4, roles: ['admin'] },
  'license:writeActivationBundle': { minRank: 4, roles: ['admin'] },
  'license:writeCustomPackage': { minRank: 4, roles: ['admin'] },
  'license:updateLicenseIndex': { minRank: 4, roles: ['admin'] },
  'license:appendPackageToRegistry': { minRank: 4, roles: ['admin'] },
  'license:adminIssuerStatus': { minRank: 4, roles: ['admin'] },
  'license:adminSelectSigningKey': { minRank: 4, roles: ['admin'] },
  'license:adminIssueV6': { minRank: 4, roles: ['admin'] },

  'rbac:authenticateUser': { public: true },
  'rbac:authenticateDeveloper': { public: true },
  'rbac:bindSession': { public: true },
  'rbac:clearSession': { public: true },
  'rbac:getSession': { public: true },
  'rbac:setWriteBranch': { minRank: 1 },
  'rbac:clearWriteBranch': { minRank: 1 },

  'attachments:validate': { minRank: 2 },
  'attachments:hashBuffer': { minRank: 2 },
  'attachments:writeLocal': { minRank: 2 },
  'attachments:readLocal': { minRank: 2 },
  'attachments:existsLocal': { minRank: 2 },

  'dialog:confirmSync': { public: true },
  'dialog:promptSync': { public: true },
});

const PUBLIC_CHANNELS = new Set(
  Object.entries(CHANNEL_POLICY)
    .filter(([, policy]) => policy.public === true)
    .map(([channel]) => channel)
);

const sessions = new Map();
const authenticationProofs = new Map();
const AUTH_PROOF_TTL_MS = 60 * 1000;

const LOW_ROLE_KV_KEYS = new Set([
  'otRecords', 'budget', 'invoiceCounter', 'clientFileCounter', 'nextSessions',
  'employeeLeaveRequests', 'employeeLedgerAccruals', 'employeeLedgerPayments',
  'employeeLedgerEntries', 'importHistory', 'messageLog', 'backupLog',
  'activityLog', 'hardwareLog', 'cashDrawerSession', 'systemLogs', 'logCounter',
  'communicationWebhookLog', 'communicationQueue', 'importStudioLog', 'luxQueue',
  'backupUploadQueue', 'backupOpCounter', 'preImportBackup', 'tablePageSize',
  'logsPageSize', 'inventoryItems', 'inventorySuppliers', 'inventoryMovements',
  '__tdw_conflict_queue__', '__tdw_conflict_archive__', '__tdw_attachment_manifest__',
  '__tdw_repo_revisions__', '__tdw_versions__', '__tdw_sync_state__',
  '__tdw_branch_summaries__', '__tdw_audit_log__', '__tdw_audit_pending_drive__',
  '__tdw_branch_idempotency__',
]);

const PROTECTED_KV_KEYS = new Set([
  'users', 'settings', 'packages', 'services', 'roles', 'permissions',
  '__tdw_owner_profile__', '__tdw_owner_session_epoch__', '__tdw_owner_setup__',
  '__tdw_cloud_license__', '__tdw_meta__', '__tdw_device_config__',
  '__tdw_device_registry__', '__tdw_license_activation_state__',
  '__tdw_drive_folders__', 'commercial_license_data_v2', 'commercial_license_audit_v2',
]);

function rankOf(role) {
  return ROLE_RANK[String(role || '').toLowerCase()] || 0;
}

function senderIdOf(event) {
  return event?.sender?.id;
}

function getSession(event) {
  const id = senderIdOf(event);
  if (id == null) return null;
  return sessions.get(id) || null;
}

function purgeExpiredProofs(now = Date.now()) {
  for (const [token, proof] of authenticationProofs.entries()) {
    if (!proof || proof.expiresAt <= now) authenticationProofs.delete(token);
  }
}

function issueAuthenticationProof(event, identity, now = Date.now()) {
  const senderId = senderIdOf(event);
  if (senderId == null) return { ok: false, error: 'no_sender' };
  purgeExpiredProofs(now);
  const token = crypto.randomBytes(32).toString('base64url');
  const proof = {
    token,
    senderId,
    userId: String(identity?.userId || ''),
    role: String(identity?.role || '').toLowerCase(),
    isDev: identity?.isDev === true,
    sessionEpoch: Number(identity?.sessionEpoch) || 0,
    centerId: String(identity?.centerId || identity?.center_id || ''),
    issuedAt: now,
    expiresAt: now + AUTH_PROOF_TTL_MS,
  };
  authenticationProofs.set(token, proof);
  return { ok: true, proof: token, expiresAt: proof.expiresAt };
}

function consumeAuthenticationProof(event, claim, now = Date.now()) {
  purgeExpiredProofs(now);
  const token = String(claim?.authProof || '');
  if (!token) return { ok: false, error: 'authentication_proof_required' };
  const proof = authenticationProofs.get(token);
  authenticationProofs.delete(token);
  if (!proof || proof.expiresAt <= now) return { ok: false, error: 'authentication_proof_invalid' };
  if (proof.senderId !== senderIdOf(event)) return { ok: false, error: 'authentication_proof_sender_mismatch' };
  if (proof.userId !== String(claim?.userId || claim?.id || '')) return { ok: false, error: 'authentication_proof_user_mismatch' };
  if (proof.role !== String(claim?.role || '').toLowerCase()) return { ok: false, error: 'authentication_proof_role_mismatch' };
  return { ok: true, proof };
}

function bindSession(event, claim) {
  claim = claim || {};
  const id = senderIdOf(event);
  if (id == null) return { ok: false, error: 'no_sender' };
  const userId = String(claim.userId || claim.id || '').trim();
  const role = String(claim.role || '').trim().toLowerCase();
  if (!userId) return { ok: false, error: 'user_id_required' };
  if (!ROLE_RANK[role] && role !== 'custom') return { ok: false, error: 'invalid_role' };

  const authentication = consumeAuthenticationProof(event, claim);
  if (!authentication.ok) return authentication;

  let authoritativeRole = role;
  let branchScope = [];
  let permissions = claim.permissions && typeof claim.permissions === 'object' ? claim.permissions : null;
  let centerId = authentication.proof.centerId || '';
  const isDevAccount = userId === '__dev__' && role === 'admin' && authentication.proof.isDev === true;
  if (userId === '__dev__' && !isDevAccount) {
    return { ok: false, error: 'developer_authentication_required' };
  }

  if (!isDevAccount) {
    if (typeof claim.lookupUsers !== 'function') {
      return { ok: false, error: 'authoritative_lookup_required', action: 'refresh_users' };
    }
    let users = [];
    try {
      users = claim.lookupUsers() || [];
    } catch {
      return { ok: false, error: 'authoritative_lookup_failed', action: 'refresh_users' };
    }
    if (!users.length) return { ok: false, error: 'users_kv_empty', action: 'refresh_users' };
    const real = users.find((user) => user && String(user.id) === userId && user.active !== false);
    if (!real) return { ok: false, error: 'user_not_found', action: 'refresh_users' };
    authoritativeRole = String(real.role || '').toLowerCase();
    centerId = String(real.centerId || real.center_id || centerId || '');
    if (Array.isArray(real.branchScope)) branchScope = real.branchScope.slice();
    if (real.permissions) permissions = real.permissions;
    if (role && role !== authoritativeRole) {
      return { ok: false, error: 'tampered_role', expected: authoritativeRole, claimed: role };
    }
    if ((Number(real.sessionEpoch) || 0) !== (Number(authentication.proof.sessionEpoch) || 0)) {
      return { ok: false, error: 'stale_authentication_proof' };
    }
  }
  if (isDevAccount) branchScope = ['*'];

  const session = {
    userId,
    role: authoritativeRole,
    branchScope,
    permissions,
    sessionEpoch: authentication.proof.sessionEpoch,
    isDev: isDevAccount,
    boundAt: new Date().toISOString(),
    rank: rankOf(authoritativeRole),
    centerId,
    writeBranchId: branchScope.length === 1 && !branchScope.includes('*') ? branchScope[0] : null,
  };
  sessions.set(id, session);
  return {
    ok: true,
    session: {
      userId: session.userId,
      role: session.role,
      sessionEpoch: session.sessionEpoch,
      boundAt: session.boundAt,
    },
  };
}

function setWriteBranch(event, branchId) {
  const session = getSession(event);
  if (!session) return { ok: false, error: 'rbac_session_required' };
  const normalized = String(branchId || '').trim();
  if (!normalized || normalized === '*' || normalized === '__ALL__') {
    return { ok: false, error: 'explicit_write_branch_required' };
  }
  const scope = Array.isArray(session.branchScope) ? session.branchScope : [];
  if (!scope.includes('*') && !scope.includes(normalized)) {
    return { ok: false, error: 'branch_access_denied', branchId: normalized };
  }
  session.writeBranchId = normalized;
  return { ok: true, branchId: normalized };
}

function clearWriteBranch(event) {
  const session = getSession(event);
  if (!session) return { ok: false, error: 'rbac_session_required' };
  session.writeBranchId = null;
  return { ok: true };
}

function clearSession(event) {
  const id = senderIdOf(event);
  if (id != null) {
    sessions.delete(id);
    for (const [token, proof] of authenticationProofs.entries()) {
      if (proof?.senderId === id) authenticationProofs.delete(token);
    }
  }
  return { ok: true };
}

function sessionAllowsChannel(session, channel) {
  const policy = CHANNEL_POLICY[channel];
  if (!policy) return { ok: false, error: 'rbac_channel_unregistered' };
  if (policy.public === true) return { ok: true, public: true };
  if (!session) return { ok: false, error: 'rbac_session_required' };
  if (Array.isArray(policy.roles) && policy.roles.length && !policy.roles.includes(session.role)) {
    return { ok: false, error: 'rbac_role_denied', required: policy.roles, role: session.role };
  }
  if (policy.minRank != null && session.rank < policy.minRank) {
    return { ok: false, error: 'rbac_rank_denied', minRank: policy.minRank, rank: session.rank };
  }
  if (Array.isArray(policy.permissions) && policy.permissions.length) {
    if (session.rank >= 4) return { ok: true };
    const permissions = session.permissions || {};
    if (!policy.permissions.some((permission) => permissions[permission])) {
      return { ok: false, error: 'rbac_permission_denied', permissions: policy.permissions };
    }
  }
  return { ok: true };
}

function assertChannelAllowed(event, channel) {
  const gate = sessionAllowsChannel(getSession(event), channel);
  if (!gate.ok) {
    const error = new Error(gate.error || 'rbac_denied');
    error.code = gate.error || 'RBAC_DENIED';
    error.ok = false;
    error.rbac = gate;
    throw error;
  }
  return gate;
}

function assertBranchInSession(event, branchId) {
  if (!branchId) return { ok: true };
  const session = getSession(event);
  if (!session) return { ok: false, error: 'rbac_session_required' };
  const scope = session.branchScope || [];
  if (scope.includes('*') || scope.includes(branchId)) return { ok: true };
  return { ok: false, error: 'branch_access_denied', branchId };
}

function kvPolicyForKey(key) {
  const normalized = String(key || '');
  if (PROTECTED_KV_KEYS.has(normalized)
      || normalized.startsWith('__tdw_owner_')
      || normalized.startsWith('__tdw_license_')
      || normalized.startsWith('commercial_license')) {
    return { minRank: 4, protected: true };
  }
  if (LOW_ROLE_KV_KEYS.has(normalized)) return { minRank: 2, protected: false };
  return { minRank: 4, protected: true, unknown: true };
}

function assertKvWriteAllowed(event, key) {
  const session = getSession(event);
  if (!session) {
    const error = new Error('rbac_session_required');
    error.code = 'rbac_session_required';
    throw error;
  }
  const policy = kvPolicyForKey(key);
  if (session.rank < policy.minRank) {
    const error = new Error('rbac_kv_key_denied');
    error.code = 'rbac_kv_key_denied';
    error.rbac = { key: String(key || ''), minRank: policy.minRank, rank: session.rank };
    throw error;
  }
  return { ok: true, policy };
}

/** Entity-level policy for the typed database command gateway. */
const DATABASE_ENTITY_MIN_RANK = Object.freeze({
  clientsRegistry: 2, cases: 2, bookings: 2, attendance: 1, expenses: 3,
  doctors: 4, users: 4, settings: 4, packages: 4, services: 4,
  inventoryItems: 2, inventorySuppliers: 3, inventoryMovements: 2,
  otRecords: 3, nextSessions: 2, employeeLeaveRequests: 1,
  employeeLedgerAccruals: 3, employeeLedgerPayments: 3, employeeLedgerEntries: 3,
  messageLog: 2, cashDrawerSession: 2, budget: 3, luxQueue: 2,
  invoiceCounter: 2, clientFileCounter: 2,
  payrollPeriods: 3, payrollEntries: 3, commissions: 3, invoices: 2, payments: 2,
  financialPostings: 2, cashMovements: 2, auditEvents: 2,
  payrollRuns: 3, payrollAdjustments: 3,
  attachments: 2, __tdw_attachment_manifest__: 2,
  __tdw_conflict_queue__: 2, __tdw_conflict_archive__: 2,
  __tdw_owner_profile__: 6, __tdw_owner_session_epoch__: 6, __tdw_owner_setup__: 6,
  __tdw_device_registry__: 4,
});

function assertDatabaseEntityWriteAllowed(event, entity) {
  const session = getSession(event);
  if (!session) {
    const error = new Error('rbac_session_required');
    error.code = 'rbac_session_required';
    throw error;
  }
  const minRank = DATABASE_ENTITY_MIN_RANK[String(entity || '')];
  if (minRank == null || session.rank < minRank) {
    const error = new Error(minRank == null ? 'database_entity_unregistered' : 'database_entity_write_denied');
    error.code = minRank == null ? 'database_entity_unregistered' : 'database_entity_write_denied';
    error.rbac = { entity: String(entity || ''), minRank: minRank ?? null, rank: session.rank };
    throw error;
  }
  return { ok: true, minRank, rank: session.rank };
}

function invalidateStaleUserSessions(users) {
  const list = Array.isArray(users) ? users : [];
  let invalidated = 0;
  for (const [senderId, session] of sessions.entries()) {
    if (session.userId === '__dev__') continue;
    const user = list.find((item) => item && String(item.id) === session.userId && item.active !== false);
    if (!user
        || String(user.role || '').toLowerCase() !== session.role
        || (Number(user.sessionEpoch) || 0) !== (Number(session.sessionEpoch) || 0)) {
      sessions.delete(senderId);
      invalidated += 1;
    }
  }
  return invalidated;
}

function resetForTests() {
  sessions.clear();
  authenticationProofs.clear();
}

module.exports = {
  ROLE_RANK,
  PUBLIC_CHANNELS,
  CHANNEL_POLICY,
  AUTH_PROOF_TTL_MS,
  bindSession,
  setWriteBranch,
  clearWriteBranch,
  clearSession,
  getSession,
  sessionAllowsChannel,
  assertChannelAllowed,
  assertBranchInSession,
  issueAuthenticationProof,
  consumeAuthenticationProof,
  kvPolicyForKey,
  assertKvWriteAllowed,
  DATABASE_ENTITY_MIN_RANK,
  assertDatabaseEntityWriteAllowed,
  invalidateStaleUserSessions,
  rankOf,
  resetForTests,
};
