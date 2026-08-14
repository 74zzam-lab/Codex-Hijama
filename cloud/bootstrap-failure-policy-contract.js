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
    oauth_cancelled: { outcome: OUTCOME.CANCELLED, cancelled: true, code: 'TDW-BOOT-GOOGLE-CANCEL' },
    oauth_access_denied: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-GOOGLE-REAUTH' },
    oauth_timeout: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-GOOGLE-TIMEOUT' },
    oauth_offline: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-GOOGLE-NETWORK' },
    oauth_port_in_use: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-GOOGLE-PORT' },
    oauth_invalid_grant: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-GOOGLE-REAUTH' },
    oauth_redirect_mismatch: { outcome: OUTCOME.FATAL, fatal: true, code: 'TDW-BOOT-GOOGLE-OAUTH-CONFIG' },
    oauth_api_disabled: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-GOOGLE-API' },
    oauth_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-GOOGLE-FAIL' },
    google_not_connected: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-GOOGLE-NOT-CONNECTED' },
    google_disconnect_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-GOOGLE-DISCONNECT' },
    discovery_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-DISC-FAIL' },
    discovery_in_flight: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-DISC-INFLIGHT' },
    discovery_module_unavailable: { outcome: OUTCOME.FATAL, fatal: true, code: 'TDW-BOOT-DISC-MODULE' },
    discovery_required: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-DISC-REQUIRED' },
    existing_business_not_found: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-DISC-NONE' },
    existing_candidate_ambiguous: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-DISC-AMBIGUOUS' },
    candidate_selection_required: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-PATH-SELECT' },
    license_invalid: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-ACT-INVALID' },
    license_expired: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-ACT-EXPIRED' },
    setup_activation_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-ACT-COMMIT' },
    activation_defaults_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-ACT-DEFAULTS' },
    no_activation_on_drive: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-ACT-MISSING' },
    existing_license_recovery_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-ACT-RECOVERY' },
    org_fetch_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-ORG-FETCH' },
    organization_commit_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-ORG-COMMIT' },
    owner_password_required: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-OWNER-PASSWORD' },
    owner_password_mismatch: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-OWNER-MISMATCH' },
    owner_password_weak: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-OWNER-WEAK' },
    owner_duplicate: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-OWNER-DUP' },
    owner_credential_required: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-OWNER-CRED' },
    owner_session_required: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-OWNER-SESSION' },
    setup_owner_authentication_failed: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-OWNER-AUTH' },
    branch_name_required: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-BRANCH-NAME' },
    branch_code_duplicate: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-BRANCH-DUP' },
    branch_duplicate_create: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-BRANCH-INFLIGHT' },
    license_branch_limit: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-BRANCH-LIMIT' },
    license_device_limit: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-DEVICE-LIMIT' },
    device_limit_exceeded: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-DEVICE-LIMIT' },
    device_duplicate: { outcome: OUTCOME.RETRYABLE, retryable: false, code: 'TDW-BOOT-DEVICE-DUP' },
    business_setup_invalid: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-BIZ-INVALID' },
    publication_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-PUB-FAIL' },
    readback_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-READBACK-FAIL' },
    readback_stale: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-READBACK-STALE' },
    readback_mismatch: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-READBACK-MISMATCH' },
    backup_password_required: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-RESTORE-PASSWORD' },
    backup_password_invalid: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-RESTORE-PASSWORD' },
    restore_interrupted: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-RESTORE-INTERRUPT' },
    cloud_download_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-RESTORE-DOWNLOAD' },
    cloud_backup_restore_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-RESTORE-FAIL' },
    local_restore_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-RESTORE-LOCAL' },
    restore_reconcile_incomplete: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-RESTORE-RECONCILE' },
    restore_cancelled: { outcome: OUTCOME.CANCELLED, cancelled: true, code: 'TDW-BOOT-RESTORE-CANCEL' },
    backup_cancelled: { outcome: OUTCOME.CANCELLED, cancelled: true, code: 'TDW-BOOT-RESTORE-CANCEL' },
    initial_sync_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-SYNC-FAIL' },
    sync_not_ready: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-SYNC-NOT-READY' },
    sync_plan_invalid: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-SYNC-PLAN' },
    sync_post_restore_blocked: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-SYNC-EMPTY-PUSH' },
    sync_push_blocked_pull_only: { outcome: OUTCOME.FATAL, fatal: true, code: 'TDW-BOOT-SYNC-PULL-ONLY' },
    sync_interrupted: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-SYNC-INTERRUPT' },
    bootstrap_unavailable: { outcome: OUTCOME.FATAL, fatal: true, code: 'TDW-BOOT-RUNTIME-UNAVAILABLE' },
    database_integrity_failed: { outcome: OUTCOME.FATAL, fatal: true, code: 'TDW-BOOT-DB-INTEGRITY' },
    signed_license_corrupt: { outcome: OUTCOME.FATAL, fatal: true, code: 'TDW-BOOT-LICENSE-CORRUPT' },
    step_required: { outcome: OUTCOME.USER_ACTION_REQUIRED, userActionRequired: true, code: 'TDW-BOOT-STEP-REQUIRED' },
    step_failed: { outcome: OUTCOME.RETRYABLE, retryable: true, code: 'TDW-BOOT-STEP-FAIL' },
  });

  let correlationCounter = 0;

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
    if (typeof raw === 'string') return raw;
    if (raw.cancelled === true || raw.canceled === true) return raw.code || raw.error || 'oauth_cancelled';
    return raw.code || raw.error || raw.reason || raw.diagnosticCode || 'step_failed';
  }

  function lookupPolicy(code) {
    const key = String(code || '').toLowerCase().replace(/^tdw-boot-[a-z0-9-]+-/i, '').replace(/-/g, '_');
    const direct = CODE_POLICY[String(code || '')] || CODE_POLICY[key];
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
    return {
      outcome: OUTCOME.RETRYABLE,
      retryable: true,
      code: `TDW-BOOT-${String(code || 'STEP-FAIL').replace(/[^A-Z0-9_]/gi, '-').slice(0, 24)}`,
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
    const code = resolveRawCode(raw);
    const policy = lookupPolicy(code);
    const AE = global.ActivationErrors;
    const userErr = AE?.toUserError ? AE.toUserError(raw, code) : null;
    const message = options.message
      || userErr?.detail
      || (typeof raw === 'object' && raw.message)
      || policy.message
      || 'تعذّر إكمال العملية.';
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
