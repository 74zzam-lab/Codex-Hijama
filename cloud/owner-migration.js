/**
 * Owner Migration Assistant (Phase 37)
 * Helps legacy installations bootstrap owner profile without rewriting login flow.
 */
(function (global) {
  'use strict';

  const MIGRATION_KEY = '__tdw_owner_migration__';

  function loadState() {
    const raw = global.DB?.get?.(MIGRATION_KEY, null);
    if (!raw || typeof raw !== 'object') {
      return { completed: false, skipped: false, updatedAt: null };
    }
    return {
      completed: !!raw.completed,
      skipped: !!raw.skipped,
      updatedAt: raw.updatedAt || null
    };
  }

  async function saveState(next) {
    const state = {
      ...loadState(),
      ...(next || {}),
      updatedAt: new Date().toISOString()
    };
    const committed = global.SqliteBridge?.commitKv
      ? await global.SqliteBridge.commitKv(MIGRATION_KEY, state)
      : await global.DB?.set?.(MIGRATION_KEY, state);
    if (!committed || committed.ok === false) throw new Error(committed?.error || 'owner_migration_state_commit_failed');
    return state;
  }

  function hasConsumedActivation() {
    const lic = global.LicenseCloud?.loadLocal?.() || {};
    if (lic?.activation?.consumed) return true;
    try {
      const meta = global.licLoadMeta?.();
      return !!meta?.activationConsumed;
    } catch {
      return false;
    }
  }

  function hasManagerAccount() {
    return !!global.RolePolicy?.hasManagerAccount?.();
  }

  function shouldMigrate() {
    const st = loadState();
    if (st.completed || st.skipped) return false;
    if (global.OwnerProfile?.hasProfile?.()) return false;
    if (!hasConsumedActivation()) return false;
    if (!hasManagerAccount()) return false;
    return true;
  }

  function getStatus() {
    const setupRequired = !!global.OwnerSetupState?.isRequired?.() && !global.OwnerProfile?.hasProfile?.();
    return {
      ...loadState(),
      needsMigration: shouldMigrate() || setupRequired,
      setupRequired,
      hasOwnerProfile: !!global.OwnerProfile?.hasProfile?.(),
      hasConsumedActivation: hasConsumedActivation(),
      hasManagerAccount: hasManagerAccount()
    };
  }

  async function promoteUserToOwnerRole(username, options) {
    options = options || {};
    try {
      const list = Array.isArray(global.users)
        ? global.users.slice()
        : (global.DB?.get?.('users', []) || []).slice();
      const uname = String(username || '').trim().toLowerCase();
      let user = list.find((u) => u && String(u.username || '').toLowerCase() === uname);
      // Legacy migration: when profile username differs from login, promote current manager.
      // Ownership transfer must disable this via noCurrentUserFallback to avoid re-promoting the old owner.
      if (!user && !options.noCurrentUserFallback && global.currentUser &&
          global.RolePolicy?.isManager?.(global.currentUser)) {
        user = list.find((u) => u && u.id === global.currentUser.id) || global.currentUser;
      }
      if (user) {
        user.role = 'owner';
        user.active = true;
        const idx = list.findIndex((u) => u && u.id === user.id);
        if (idx >= 0) list[idx] = user;
        else list.push(user);
      } else if (uname) {
        user = {
          id: 'owner-' + Date.now().toString(36),
          username: String(username).trim(),
          fullName: String(username).trim(),
          role: 'owner',
          active: true,
          password: ''
        };
        list.push(user);
      } else {
        return;
      }
      const committed = typeof global.persistData === 'function'
        ? await global.persistData('users', list)
        : await global.SqliteBridge?.setAuthoritative?.('users', list);
      if (!committed || committed.ok === false) throw new Error(committed?.error || 'owner_users_commit_failed');
      global.users = list;
      if (global.currentUser && user && global.currentUser.id === user.id) {
        global.currentUser.role = 'owner';
      }
      return { ok: true, user };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  /** Demote previous owner after ownership transfer (default → admin). */
  async function demoteOwnerRole(username, options) {
    options = options || {};
    const toRole = String(options.toRole || 'admin');
    try {
      const list = Array.isArray(global.users)
        ? global.users.slice()
        : (global.DB?.get?.('users', []) || []).slice();
      const uname = String(username || '').trim().toLowerCase();
      let changed = false;
      for (let i = 0; i < list.length; i++) {
        const u = list[i];
        if (!u) continue;
        const match = uname && String(u.username || '').toLowerCase() === uname;
        if (match || (!uname && u.role === 'owner')) {
          if (u.role === 'owner') {
            u.role = toRole;
            list[i] = u;
            changed = true;
            if (global.currentUser && global.currentUser.id === u.id) {
              global.currentUser.role = toRole;
            }
          }
        }
      }
      if (changed) {
        const committed = typeof global.persistData === 'function'
          ? await global.persistData('users', list)
          : await global.SqliteBridge?.setAuthoritative?.('users', list);
        if (!committed || committed.ok === false) throw new Error(committed?.error || 'owner_users_commit_failed');
        global.users = list;
        global.AuditLogger?.log?.({
          action: 'OWNER_DEMOTED',
          entity: 'user',
          entityId: username || '',
          summary: `Previous owner demoted to ${toRole}`
        });
      }
      return { ok: true, demoted: changed, toRole };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  async function runInteractiveMigration() {
    const setupRequired = !!global.OwnerSetupState?.isRequired?.() && !global.OwnerProfile?.hasProfile?.();
    if (!shouldMigrate() && !setupRequired) {
      if (global.OwnerProfile?.hasProfile?.()) return { ok: false, error: 'not_required' };
      if (!hasConsumedActivation() && !setupRequired) return { ok: false, error: 'not_required' };
    }
    const username = String(await global.tdwAskText?.({ title: 'Owner Profile', message: 'إنشاء Owner Profile — اسم المستخدم' }) || '').trim();
    if (!username) return { ok: false, error: 'username_required' };
    const password = String(await global.tdwAskPassword?.({ title: 'كلمة المرور', message: 'كلمة مرور Owner' }) || '').trim();
    if (!password) return { ok: false, error: 'password_required' };
    const recovery = String(await global.tdwAskText?.({ title: 'Recovery', message: 'Recovery PIN/Code' }) || '').trim();
    if (!recovery) return { ok: false, error: 'recovery_required' };

    let res;
    if (global.OwnerProfile?.hasProfile?.()) {
      res = { ok: true, profile: global.OwnerProfile.loadProfile?.() };
    } else {
      res = await global.OwnerProfile?.createProfile?.({
        username,
        password,
        recoveryCode: recovery
      });
    }
    if (!res?.ok) return res || { ok: false, error: 'create_failed' };

    const promoted = await promoteUserToOwnerRole(username);
    if (!promoted?.ok) return promoted || { ok: false, error: 'owner_promotion_failed' };
    await saveState({ completed: true, skipped: false });
    try { global.OwnerSetupState?.clearRequired?.(); } catch { /* empty */ }
    global.AuditLogger?.log?.({
      action: 'OWNER_MIGRATION_COMPLETED',
      entity: 'owner_profile',
      entityId: username,
      summary: 'Owner profile created / legacy migration completed'
    });
    return { ok: true, profile: res.profile };
  }

  async function skipMigration() {
    await saveState({ skipped: true });
    try { global.OwnerSetupState?.clearRequired?.(); } catch { /* empty */ }
    return { ok: true };
  }

  global.OwnerMigration = {
    MIGRATION_KEY,
    loadState,
    saveState,
    hasConsumedActivation,
    hasManagerAccount,
    shouldMigrate,
    getStatus,
    runInteractiveMigration,
    skipMigration,
    promoteUserToOwnerRole,
    demoteOwnerRole
  };
})(typeof window !== 'undefined' ? window : globalThis);
