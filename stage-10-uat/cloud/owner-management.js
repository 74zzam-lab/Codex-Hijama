/**
 * Owner Management — Single Source of Truth for Owner state + CRUD facade.
 * V2-5.8: State Machine decides NO_OWNER / EXISTS / CORRUPTED / RECOVERY / CREATION_IN_PROGRESS.
 * All BootFlow / Startup / Login / Restore / Hub / Emergency paths MUST use getOwnerState()
 * and createOwner() — no local Owner decision logic elsewhere.
 */
(function (global) {
  'use strict';

  const OWNER_ROLE = 'owner';

  const OWNER_STATES = Object.freeze({
    NO_OWNER: 'NO_OWNER',
    OWNER_EXISTS: 'OWNER_EXISTS',
    OWNER_CORRUPTED: 'OWNER_CORRUPTED',
    OWNER_RECOVERY_REQUIRED: 'OWNER_RECOVERY_REQUIRED',
    OWNER_CREATION_IN_PROGRESS: 'OWNER_CREATION_IN_PROGRESS'
  });

  const OWNER_ACTIONS = Object.freeze({
    OPEN_BOOTSTRAP: 'OPEN_BOOTSTRAP',
    CONTINUE: 'CONTINUE',
    RUN_RECOVERY: 'RUN_RECOVERY',
    WAIT: 'WAIT'
  });

  /** Single create lock — shared by BootFlow, Hub, Emergency (no duplicate locks). */
  let creationInProgress = false;
  /** Prevent double-open of Owner Bootstrap Wizard. */
  let bootstrapOpenRequested = false;
  /** Transient system busy reason: restore | sync | license_refresh */
  let systemBusyReason = null;

  function getUsers() {
    if (Array.isArray(global.users)) return global.users;
    return global.DB?.get?.('users', []) || [];
  }

  async function persistUsers(list) {
    const committed = typeof global.persistData === 'function'
      ? await global.persistData('users', list)
      : await global.SqliteBridge?.setAuthoritative?.('users', list);
    if (!committed || committed.ok === false) {
      throw new Error(committed?.error || 'owner_users_commit_failed');
    }
    global.users = list;
    return list;
  }

  function isOwnerRole(user) {
    if (!user) return false;
    const role = String(user.role || '').toLowerCase();
    return role === OWNER_ROLE || role === 'hq_admin';
  }

  function hasUsableOwnerCredential(user) {
    if (!user || user.active === false) return false;
    if (user.mustChangePassword === true || user.seedDefaultPassword === true) return false;
    if (user.hasUsableCredential === true) return true;
    return /^(?:pbkdf2:|pbkdf2v2:|b64:)/i.test(String(user.password || ''));
  }

  function listOwners(users) {
    users = users || getUsers();
    return users.filter((u) => u && isOwnerRole(u) && !u.isDev);
  }

  function listActiveOwners(users) {
    return listOwners(users).filter((u) => u.active !== false);
  }

  function countActiveOwners(users) {
    return listActiveOwners(users).length;
  }

  function countAuthoritativeOwners(users) {
    if (global.OwnerSeedRetirement?.countAuthoritativeOwners) {
      return global.OwnerSeedRetirement.countAuthoritativeOwners(users || getUsers());
    }
    return listActiveOwners(users).filter(hasUsableOwnerCredential).length;
  }

  function organizationHasOwner(users) {
    return getOwnerState(users).state === OWNER_STATES.OWNER_EXISTS;
  }

  async function retireOwnerSeedsIfNeeded(options) {
    options = options || {};
    const users = getUsers().slice();
    if (!global.OwnerSeedRetirement?.retireOwnerSeedAccounts) {
      return { ok: true, changed: false, users };
    }
    const retired = global.OwnerSeedRetirement.retireOwnerSeedAccounts(users, options);
    if (!retired.changed || options.dryRun) {
      return { ok: true, changed: false, users: retired.users, retiredCount: retired.retiredCount || 0 };
    }
    await persistUsers(retired.users);
    notifyOwnerChanged({ type: 'seed_retired', retiredCount: retired.retiredCount, authoritativeOwnerId: retired.authoritativeOwnerId });
    return { ok: true, changed: true, users: retired.users, retiredCount: retired.retiredCount, authoritativeOwnerId: retired.authoritativeOwnerId };
  }

  async function migrateOwnerSeedStateIfNeeded(options) {
    options = options || {};
    const users = getUsers().slice();
    if (!global.OwnerSeedRetirement?.migrateOwnerSeedState) {
      return { ok: true, changed: false, users };
    }
    const migrated = global.OwnerSeedRetirement.migrateOwnerSeedState(users, options);
    if (!migrated.changed || options.dryRun) {
      return { ok: true, changed: false, users: migrated.users, classification: migrated.classification };
    }
    await persistUsers(migrated.users);
    notifyOwnerChanged({ type: 'seed_migration', retiredCount: migrated.retiredCount, classification: migrated.classification?.state });
    return { ok: true, changed: true, ...migrated };
  }

  function isDeveloperMode(user) {
    user = user || global.currentUser;
    if (global.RolePolicy?.isDev?.(user)) return true;
    try {
      if (typeof document !== 'undefined' && document.body?.classList?.contains('dev-mode')) return true;
    } catch { /* empty */ }
    return !!(user && user.isDev);
  }

  function setSystemBusy(reason) {
    systemBusyReason = reason ? String(reason) : null;
    return systemBusyReason;
  }

  function clearSystemBusy(reason) {
    if (!reason || systemBusyReason === reason) systemBusyReason = null;
    return systemBusyReason;
  }

  function getSystemBusyReason() {
    if (systemBusyReason) return systemBusyReason;
    try {
      if (global.BootFlow?.isCriticalOpInFlight?.()) return 'boot_op_in_flight';
    } catch { /* empty */ }
    try {
      if (global.SyncEngine?.isRunning?.()) return 'sync';
    } catch { /* empty */ }
    return null;
  }

  function isOwnerCreationInProgress() {
    return !!creationInProgress;
  }

  /**
   * Single Source of Truth — the only function that decides organization Owner state.
   * Callers must not invent parallel checks (hasProfile / needsOwnerBootstrap alone).
   */
  function getOwnerState(users) {
    users = users || getUsers();
    if (creationInProgress) {
      return {
        state: OWNER_STATES.OWNER_CREATION_IN_PROGRESS,
        action: OWNER_ACTIONS.WAIT,
        activeOwnerCount: countActiveOwners(users),
        hasProfile: !!global.OwnerProfile?.hasProfile?.(),
        systemBusy: getSystemBusyReason()
      };
    }

    const owners = listActiveOwners(users);
    const hasProfile = !!global.OwnerProfile?.hasProfile?.();
    const profile = hasProfile ? (global.OwnerProfile.loadProfile?.() || null) : null;
    const ownersWithPassword = owners.filter(hasUsableOwnerCredential);
    const setupFlag = !!global.OwnerSetupState?.isRequired?.();

    if (!hasProfile && owners.length === 0) {
      return {
        state: OWNER_STATES.NO_OWNER,
        action: OWNER_ACTIONS.OPEN_BOOTSTRAP,
        activeOwnerCount: 0,
        hasProfile: false,
        systemBusy: getSystemBusyReason()
      };
    }

    // Profile without login owner, or owners without usable password → corrupted
    if ((hasProfile && owners.length === 0) || (owners.length > 0 && ownersWithPassword.length === 0)) {
      return {
        state: OWNER_STATES.OWNER_CORRUPTED,
        action: OWNER_ACTIONS.RUN_RECOVERY,
        activeOwnerCount: owners.length,
        hasProfile,
        profileUsername: profile?.username || null,
        systemBusy: getSystemBusyReason()
      };
    }

    // Seeded / restored Owner login users without crypto OwnerProfile:
    // treat as OWNER_EXISTS for daily Hub use. Profile can be healed on password change.
    // Do NOT show OWNER_RECOVERY_REQUIRED solely because profile JSON is missing.
    if (!hasProfile && ownersWithPassword.length > 0) {
      return {
        state: OWNER_STATES.OWNER_EXISTS,
        action: OWNER_ACTIONS.CONTINUE,
        activeOwnerCount: ownersWithPassword.length,
        hasProfile: false,
        profileOptional: true,
        systemBusy: getSystemBusyReason()
      };
    }

    if (hasProfile && profile?.username) {
      const match = ownersWithPassword.some(
        (u) => String(u.username || '').toLowerCase() === String(profile.username).toLowerCase()
      );
      if (!match) {
        return {
          state: OWNER_STATES.OWNER_RECOVERY_REQUIRED,
          action: OWNER_ACTIONS.RUN_RECOVERY,
          activeOwnerCount: ownersWithPassword.length,
          hasProfile: true,
          profileUsername: profile.username,
          systemBusy: getSystemBusyReason()
        };
      }
    }

    if (setupFlag && ownersWithPassword.length === 0) {
      return {
        state: OWNER_STATES.OWNER_RECOVERY_REQUIRED,
        action: OWNER_ACTIONS.OPEN_BOOTSTRAP,
        activeOwnerCount: 0,
        hasProfile,
        systemBusy: getSystemBusyReason()
      };
    }

    if (hasProfile && ownersWithPassword.length > 0) {
      return {
        state: OWNER_STATES.OWNER_EXISTS,
        action: OWNER_ACTIONS.CONTINUE,
        activeOwnerCount: ownersWithPassword.length,
        hasProfile: true,
        profileUsername: profile?.username || null,
        systemBusy: getSystemBusyReason()
      };
    }

    return {
      state: OWNER_STATES.NO_OWNER,
      action: OWNER_ACTIONS.OPEN_BOOTSTRAP,
      activeOwnerCount: owners.length,
      hasProfile,
      systemBusy: getSystemBusyReason()
    };
  }

  function getOwnerDecision(users) {
    return getOwnerState(users);
  }

  /** True when bootstrap/recovery UI should open (not OWNER_EXISTS / not WAIT). */
  function needsOwnerBootstrap(users) {
    const s = getOwnerState(users).state;
    return s === OWNER_STATES.NO_OWNER
      || s === OWNER_STATES.OWNER_CORRUPTED
      || s === OWNER_STATES.OWNER_RECOVERY_REQUIRED;
  }

  function shouldShowEmergencyOwnerTools(user) {
    const s = getOwnerState().state;
    if (s !== OWNER_STATES.OWNER_EXISTS) return true;
    return isDeveloperMode(user);
  }

  function shouldShowOwnerManagementSection(user) {
    return shouldShowEmergencyOwnerTools(user);
  }

  function notifyOwnerChanged(event) {
    event = event || { type: 'changed' };
    try { global.OwnerHub?.refresh?.(); } catch { /* empty */ }
    try { global.renderUsersList?.(); } catch { /* empty */ }
    try { global.OwnerHub?.applyNavVisibility?.(); } catch { /* empty */ }
    try {
      if (typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
        global.dispatchEvent(new global.CustomEvent('tdw:owner-changed', { detail: event }));
      }
    } catch { /* empty */ }
  }

  /**
   * Sole entry for opening Owner Bootstrap / Recovery UI.
   * BootFlow / Startup / Login / Restore / Hub / Emergency must call this (or BootFlow wrapper that calls this).
   */
  function requestOwnerBootstrap(reason) {
    const decision = getOwnerDecision();
    if (decision.state === OWNER_STATES.OWNER_EXISTS) {
      try { global.OwnerSetupState?.clearRequired?.(); } catch { /* empty */ }
      return { ok: true, opened: false, reason: 'owner_present', state: decision.state };
    }
    if (decision.state === OWNER_STATES.OWNER_CREATION_IN_PROGRESS) {
      return { ok: false, opened: false, error: 'creation_in_progress', state: decision.state };
    }
    const busy = getSystemBusyReason();
    if (busy === 'restore' || busy === 'sync' || busy === 'license_refresh') {
      return { ok: false, opened: false, error: 'system_busy', busy, state: decision.state };
    }

    try {
      if (typeof document !== 'undefined') {
        const open = document.getElementById('bootFlowOverlay')?.classList?.contains('open');
        if (open && bootstrapOpenRequested) {
          return { ok: true, opened: false, already: true, state: decision.state };
        }
      }
    } catch { /* empty */ }

    bootstrapOpenRequested = true;
    const why = reason || decision.state.toLowerCase();
    try { global.OwnerSetupState?.ensureMissingOwner?.(why); } catch {
      try { global.OwnerSetupState?.markRequired?.(why); } catch { /* empty */ }
    }

    let opened = false;
    try {
      opened = !!global.BootFlow?.openAtStep?.('owner');
      if (!opened) opened = !!global.BootFlow?.forceOpen?.();
    } catch { /* empty */ }

    if (!opened) bootstrapOpenRequested = false;

    return { ok: true, opened: !!opened, reason: why, state: decision.state, action: decision.action };
  }

  function clearBootstrapOpenRequest() {
    bootstrapOpenRequested = false;
  }

  function bindOwnerToCurrentContext(user) {
    if (!user || typeof user !== 'object') return user;
    const lic = global.LicenseCloud?.loadLocal?.() || {};
    const centerId = global.CenterId?.getStoredCenterId?.()
      || global.Organization?.getId?.()
      || lic.centerId
      || '';
    const orgId = global.Organization?.getId?.() || centerId || '';
    if (centerId && !user.centerId) user.centerId = centerId;
    if (orgId && !user.orgId) user.orgId = orgId;
    if (lic.licenseId && !user.licenseId) user.licenseId = lic.licenseId;
    if (lic.productKey && !user.licenseKeyHint) {
      user.licenseKeyHint = String(lic.productKey).slice(0, 8);
    }
    user.role = OWNER_ROLE;
    if (global.BranchScope?.applyDefaultScopeToUser) {
      global.BranchScope.applyDefaultScopeToUser(user);
    } else {
      user.branchScope = user.branchScope || ['*'];
      user.canSwitchBranch = user.canSwitchBranch != null ? !!user.canSwitchBranch : true;
    }
    return user;
  }

  function canRemoveOwnerUser(userId, users) {
    users = users || getUsers();
    const target = users.find((u) => u && String(u.id) === String(userId));
    if (!target) return { ok: false, error: 'not_found' };
    if (!isOwnerRole(target)) return { ok: true };
    if (String(target.id) === '1') {
      return { ok: false, error: 'primary_protected', message: 'لا يمكن حذف الحساب الرئيسي' };
    }
    const active = listActiveOwners(users);
    const isActive = target.active !== false;
    if (isActive && active.length <= 1) {
      return {
        ok: false,
        error: 'last_active_owner',
        message: 'لا يمكن حذف آخر مالك فعّال في المؤسسة'
      };
    }
    return { ok: true };
  }

  function canDisableOwnerUser(userId, users) {
    users = users || getUsers();
    const target = users.find((u) => u && String(u.id) === String(userId));
    if (!target) return { ok: false, error: 'not_found' };
    if (!isOwnerRole(target)) return { ok: true };
    if (String(target.id) === '1') {
      return { ok: false, error: 'primary_protected', message: 'لا يمكن تعطيل الحساب الرئيسي' };
    }
    if (target.active === false) return { ok: true };
    const active = listActiveOwners(users);
    if (active.length <= 1) {
      return {
        ok: false,
        error: 'last_active_owner',
        message: 'لا يمكن تعطيل آخر مالك فعّال في المؤسسة'
      };
    }
    return { ok: true };
  }

  function canDemoteOwnerUser(userId, nextRole, users) {
    users = users || getUsers();
    const target = users.find((u) => u && String(u.id) === String(userId));
    if (!target) return { ok: false, error: 'not_found' };
    if (!isOwnerRole(target)) return { ok: true };
    const next = String(nextRole || '').toLowerCase();
    if (next === OWNER_ROLE || next === 'hq_admin') return { ok: true };
    return canDisableOwnerUser(userId, users);
  }

  /**
   * First Owner: uses OwnerCreateForm / OwnerProfile.
   * Additional Owners: same user store + role=owner + BranchScope (no second OwnerProfile).
   * Must only run while creation lock is held (via createOwner).
   */
  async function createOwnerAccountUnlocked(input) {
    input = input || {};
    const needsBootstrap = !global.OwnerProfile?.hasProfile?.() || countActiveOwners() === 0;

    if (needsBootstrap && !global.OwnerProfile?.hasProfile?.() && global.OwnerCreateForm?.createOwnerFromForm) {
      // Prefer form when DOM ids are present; otherwise programmatic bootstrap below.
      if (typeof document !== 'undefined' && document.getElementById((input.idPrefix || 'ocf') + '-username')) {
        const formRes = await global.OwnerCreateForm.createOwnerFromForm(input.idPrefix || 'ocf');
        if (formRes?.ok) {
          const users = getUsers();
          const u = users.find((x) => x && String(x.username || '').toLowerCase() === String(formRes.username || '').toLowerCase());
          if (u) {
            bindOwnerToCurrentContext(u);
            await persistUsers(users);
          }
        }
        return formRes;
      }
    }

    const fullName = String(input.fullName || '').trim();
    const username = String(input.username || '').trim();
    const email = String(input.email || '').trim();
    const password = String(input.password || '');
    const passwordConfirm = String(input.passwordConfirm != null ? input.passwordConfirm : password);
    const recoveryCode = String(input.recoveryCode || input.recovery || '').trim();
    const minLen = global.OwnerCreateForm?.MIN_PASSWORD_LENGTH || 8;

    if (!fullName) return { ok: false, error: 'name_required' };
    if (!username) return { ok: false, error: 'username_required' };
    if (!password) return { ok: false, error: 'password_required' };
    if (password.length < minLen) return { ok: false, error: 'password_too_short', min: minLen };
    if (password !== passwordConfirm) return { ok: false, error: 'password_mismatch' };

    const users = getUsers().slice();
    const dup = users.find((u) => u && String(u.username || '').toLowerCase() === username.toLowerCase());
    if (dup && !isOwnerRole(dup)) {
      return { ok: false, error: 'username_taken' };
    }

    // Initial Owner creation is a pre-auth operation by definition. Keep the
    // generic users/OwnerProfile channels protected and use one main-owned
    // transaction that hashes the password, derives recovery metadata and
    // publishes the credential revision together.
    let session = null;
    try { session = await global.cuppingElectron?.rbac?.getSession?.(); } catch { /* pre-auth */ }
    const setupCommitOwner = global.cuppingElectron?.database?.setupCommitOwner
      || global.tadawi?.database?.setupCommitOwner;
    if (!session && typeof setupCommitOwner === 'function') {
      let committed;
      try {
        committed = await setupCommitOwner({
          fullName,
          username,
          email,
          password,
          recoveryCode,
        });
      } catch (error) {
        return { ok: false, error: error?.code || error?.message || 'setup_owner_commit_failed' };
      }
      if (committed?.ok !== true) {
        return { ok: false, error: committed?.error || 'setup_owner_commit_failed', committed };
      }
      const hydrated = await global.SqliteBridge?.hydrateIntoMemory?.();
      if (hydrated && hydrated.ok !== true) {
        return { ok: false, error: hydrated.error || 'setup_owner_hydrate_failed', committed };
      }
      try { global.OwnerSetupState?.clearRequired?.(); } catch { /* empty */ }
      try { await migrateOwnerSeedStateIfNeeded(); } catch { /* empty */ }
      return {
        ok: true,
        username: committed.username || username,
        userId: committed.userId,
        email,
        credentialRevision: committed.credentialRevision,
        setupCommitted: true,
      };
    }

    // Bootstrap OwnerProfile once when missing.
    if (!global.OwnerProfile?.hasProfile?.()) {
      if (!recoveryCode) return { ok: false, error: 'recovery_required' };
      const profileRes = await global.OwnerProfile.createProfile({
        username,
        password,
        recoveryCode,
        email,
        fullName
      });
      if (!profileRes?.ok) return profileRes;
    }

    let hash = password;
    if (typeof global.hashPW === 'function') {
      hash = await global.hashPW(password, username);
    }

    let ownerUser = dup;
    if (!ownerUser) {
      ownerUser = {
        id: 'owner-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
        fullName,
        username,
        password: hash,
        role: OWNER_ROLE,
        email,
        active: true,
        empNum: '',
        doctorId: ''
      };
      users.push(ownerUser);
    } else {
      ownerUser.fullName = fullName;
      ownerUser.email = email || ownerUser.email;
      ownerUser.password = hash;
      ownerUser.role = OWNER_ROLE;
      ownerUser.active = true;
    }
    ownerUser.mustChangePassword = false;
    ownerUser.seedDefaultPassword = false;
    ownerUser.passwordChangedAt = new Date().toISOString();
    ownerUser.credentialRevision = (Number(ownerUser.credentialRevision) || 0) + 1;
    if (global.OwnerSeedRetirement?.retireOwnerSeedAccounts) {
      const retired = global.OwnerSeedRetirement.retireOwnerSeedAccounts(users, { authoritativeOwnerId: ownerUser.id });
      users.splice(0, users.length, ...retired.users);
    } else {
      users.forEach((candidate) => {
        if (candidate === ownerUser || !isOwnerRole(candidate)) return;
        if (candidate.seedDefaultPassword === true || candidate.mustChangePassword === true) {
          candidate.active = false;
          candidate.ownerSeedRetired = true;
          candidate.supersededByOwnerId = ownerUser.id;
        }
      });
    }
    bindOwnerToCurrentContext(ownerUser);
    await persistUsers(users);
    try { await global.OwnerMigration?.promoteUserToOwnerRole?.(username); } catch { /* empty */ }
    try { global.OwnerSetupState?.clearRequired?.(); } catch { /* empty */ }

    return { ok: true, username, userId: ownerUser.id, email };
  }

  /** @deprecated Prefer createOwner — kept as alias that goes through the single lock. */
  async function createOwnerAccount(input) {
    return createOwner(input);
  }

  /** Canonical create entry — acquires the single creation lock. */
  async function createOwner(input) {
    const busy = getSystemBusyReason();
    if (busy === 'restore' || busy === 'sync' || busy === 'license_refresh') {
      return { ok: false, error: 'system_busy', busy };
    }
    if (creationInProgress) {
      return { ok: false, error: 'creation_in_progress', code: 'owner_creation_in_progress' };
    }
    creationInProgress = true;
    try {
      const res = await createOwnerAccountUnlocked(input);
      if (res?.ok) {
        bootstrapOpenRequested = false;
        try { await retireOwnerSeedsIfNeeded(); } catch { /* idempotent retry on restart */ }
        notifyOwnerChanged({ type: 'create', username: res.username, userId: res.userId });
      }
      return res;
    } finally {
      creationInProgress = false;
    }
  }

  async function updateOwner(userId, patch) {
    patch = patch || {};
    const users = getUsers().slice();
    const idx = users.findIndex((u) => u && String(u.id) === String(userId));
    if (idx < 0) return { ok: false, error: 'not_found' };
    const user = users[idx];
    if (!isOwnerRole(user)) return { ok: false, error: 'not_owner' };

    if (patch.fullName != null) user.fullName = String(patch.fullName).trim();
    if (patch.email != null) user.email = String(patch.email).trim();
    if (patch.username != null) {
      const next = String(patch.username).trim();
      const clash = users.find((u) => u && u.id !== user.id && String(u.username || '').toLowerCase() === next.toLowerCase());
      if (clash) return { ok: false, error: 'username_taken' };
      user.username = next;
    }
    bindOwnerToCurrentContext(user);
    await persistUsers(users);
    notifyOwnerChanged({ type: 'update', userId });
    return { ok: true, user };
  }

  async function resetOwnerPassword(userId, newPassword, confirmPassword) {
    const minLen = global.OwnerCreateForm?.MIN_PASSWORD_LENGTH || 8;
    const pw = String(newPassword || '');
    const conf = String(confirmPassword != null ? confirmPassword : pw);
    if (!pw) return { ok: false, error: 'password_required' };
    if (pw.length < minLen) return { ok: false, error: 'password_too_short', min: minLen };
    if (pw !== conf) return { ok: false, error: 'password_mismatch' };

    const users = getUsers().slice();
    const idx = users.findIndex((u) => u && String(u.id) === String(userId));
    if (idx < 0) return { ok: false, error: 'not_found' };
    const user = users[idx];
    if (!isOwnerRole(user)) return { ok: false, error: 'not_owner' };

    let hash = pw;
    if (typeof global.hashPW === 'function') {
      hash = await global.hashPW(pw, user.username);
    }
    user.password = hash;
    user.mustChangePassword = false;
    user.seedDefaultPassword = false;
    user.passwordChangedAt = new Date().toISOString();
    user.sessionEpoch = (Number(user.sessionEpoch) || 0) + 1;
    await persistUsers(users);

    const profile = global.OwnerProfile?.loadProfile?.();
    if (profile && String(profile.username || '').toLowerCase() === String(user.username || '').toLowerCase()) {
      try {
        await global.OwnerProfile.rotatePassword(pw, { invalidateSessions: true });
      } catch { /* empty */ }
    }
    notifyOwnerChanged({ type: 'password_reset', userId });
    return { ok: true };
  }

  async function setOwnerActive(userId, active) {
    const users = getUsers().slice();
    const idx = users.findIndex((u) => u && String(u.id) === String(userId));
    if (idx < 0) return { ok: false, error: 'not_found' };
    const user = users[idx];
    if (!isOwnerRole(user)) return { ok: false, error: 'not_owner' };

    if (!active) {
      const gate = canDisableOwnerUser(userId, users);
      if (!gate.ok) return gate;
    }
    user.active = !!active;
    await persistUsers(users);
    notifyOwnerChanged({ type: active ? 'enable' : 'disable', userId });
    return { ok: true, user };
  }

  async function deleteOwner(userId) {
    const users = getUsers().slice();
    const gate = canRemoveOwnerUser(userId, users);
    if (!gate.ok) return gate;
    const removed = users.find((u) => u && String(u.id) === String(userId));
    if (!removed) return { ok: false, error: 'not_found' };
    if (!isOwnerRole(removed)) return { ok: false, error: 'not_owner' };
    const next = users.filter((u) => String(u.id) !== String(userId));
    await persistUsers(next);
    notifyOwnerChanged({ type: 'delete', userId });
    return { ok: true, removed };
  }

  async function repairOwnerMembership() {
    const users = getUsers().slice();
    let fixed = 0;
    const profile = global.OwnerProfile?.loadProfile?.();
    if (profile?.username) {
      let u = users.find((x) => x && String(x.username || '').toLowerCase() === String(profile.username).toLowerCase());
      if (!u) {
        u = {
          id: 'owner-' + Date.now().toString(36),
          username: profile.username,
          fullName: profile.fullName || profile.username,
          role: OWNER_ROLE,
          active: true,
          password: users[0]?.password || '',
          email: profile.email || ''
        };
        users.push(u);
        fixed++;
      } else if (!isOwnerRole(u) || u.active === false) {
        u.role = OWNER_ROLE;
        u.active = true;
        fixed++;
      }
      bindOwnerToCurrentContext(u);
    }
    listOwners(users).forEach((u) => {
      const before = JSON.stringify({ c: u.centerId, o: u.orgId, b: u.branchScope });
      bindOwnerToCurrentContext(u);
      const after = JSON.stringify({ c: u.centerId, o: u.orgId, b: u.branchScope });
      if (before !== after) fixed++;
    });
    await persistUsers(users);
    try { await global.OwnerMigration?.promoteUserToOwnerRole?.(profile?.username); } catch { /* empty */ }
    notifyOwnerChanged({ type: 'repair_membership', fixed });
    return { ok: true, fixed, owners: listOwners().length };
  }

  async function repairOwnerBinding() {
    const users = getUsers().slice();
    let fixed = 0;
    listOwners(users).forEach((u) => {
      bindOwnerToCurrentContext(u);
      fixed++;
    });
    await persistUsers(users);
    notifyOwnerChanged({ type: 'repair_binding', fixed });
    return { ok: true, fixed };
  }

  async function repairOwnerLicenseLink() {
    const lic = global.LicenseCloud?.loadLocal?.() || {};
    const users = getUsers().slice();
    let fixed = 0;
    listOwners(users).forEach((u) => {
      if (lic.licenseId && u.licenseId !== lic.licenseId) {
        u.licenseId = lic.licenseId;
        fixed++;
      }
      if (lic.centerId && u.centerId !== lic.centerId) {
        u.centerId = lic.centerId;
        u.orgId = u.orgId || lic.centerId;
        fixed++;
      }
      bindOwnerToCurrentContext(u);
    });
    await persistUsers(users);
    notifyOwnerChanged({ type: 'repair_license', fixed });
    return { ok: true, fixed, licenseId: lic.licenseId || null, centerId: lic.centerId || null };
  }

  async function rebuildOwnerPermissions() {
    const users = getUsers().slice();
    let fixed = 0;
    listOwners(users).forEach((u) => {
      u.role = OWNER_ROLE;
      if (u.permissions) {
        delete u.permissions;
        fixed++;
      }
      bindOwnerToCurrentContext(u);
      fixed++;
    });
    await persistUsers(users);
    notifyOwnerChanged({ type: 'rebuild_permissions', fixed });
    return { ok: true, fixed, note: 'Owner role uses built-in organization permissions (no custom map).' };
  }

  function buildOwnerDiagnostics() {
    const owners = listOwners();
    const lic = global.LicenseCloud?.loadLocal?.() || {};
    const profile = global.OwnerProfile?.loadProfile?.() || null;
    const st = getOwnerState();
    return {
      at: new Date().toISOString(),
      state: st.state,
      action: st.action,
      needsBootstrap: needsOwnerBootstrap(),
      organizationHasOwner: st.state === OWNER_STATES.OWNER_EXISTS,
      activeOwnerCount: countActiveOwners(),
      authoritativeOwnerCount: countAuthoritativeOwners(),
      ownerCount: owners.length,
      hasProfile: !!profile,
      profileUsername: profile?.username || null,
      creationInProgress: isOwnerCreationInProgress(),
      systemBusy: getSystemBusyReason(),
      centerId: global.CenterId?.getStoredCenterId?.() || lic.centerId || null,
      licenseId: lic.licenseId || null,
      owners: owners.map((o) => ({
        id: o.id,
        username: o.username,
        active: o.active !== false,
        hasPassword: !!o.password,
        centerId: o.centerId || null,
        licenseId: o.licenseId || null,
        branchScope: o.branchScope || null
      }))
    };
  }

  const api = {
    OWNER_ROLE,
    OWNER_STATES,
    OWNER_ACTIONS,
    getOwnerState,
    getOwnerDecision,
    requestOwnerBootstrap,
    clearBootstrapOpenRequest,
    setSystemBusy,
    clearSystemBusy,
    getSystemBusyReason,
    isOwnerCreationInProgress,
    notifyOwnerChanged,
    listOwners,
    listActiveOwners,
    countActiveOwners,
    countAuthoritativeOwners,
    retireOwnerSeedsIfNeeded,
    migrateOwnerSeedStateIfNeeded,
    organizationHasOwner,
    needsOwnerBootstrap,
    isDeveloperMode,
    shouldShowOwnerManagementSection: shouldShowEmergencyOwnerTools,
    shouldShowEmergencyOwnerTools,
    bindOwnerToCurrentContext,
    canRemoveOwnerUser,
    canDisableOwnerUser,
    canDemoteOwnerUser,
    createOwner,
    createOwnerAccount,
    updateOwner,
    resetOwnerPassword,
    setOwnerActive,
    deleteOwner,
    isOwnerRole,
    repairOwnerMembership,
    repairOwnerBinding,
    repairOwnerLicenseLink,
    rebuildOwnerPermissions,
    buildOwnerDiagnostics
  };

  global.OwnerManagement = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
