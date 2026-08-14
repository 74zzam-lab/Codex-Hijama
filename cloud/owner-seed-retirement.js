/**
 * Stage 10 — Owner Seed retirement / authoritative Owner selection.
 * Seed accounts are bootstrap-only; they must not remain login-capable after a real Owner exists.
 */
(function (global) {
  'use strict';

  const OWNER_ROLE = 'owner';
  const OWNER_SEED_PASSWORD_HASH = 'pbkdf2:owner:f28c4134eec2cebf7631ab559ec0eb794280730d728919f259438a3441f5266b';

  const OWNER_STATE_CLASS = Object.freeze({
    NO_OWNER: 'NO_OWNER',
    SEED_ONLY: 'SEED_ONLY',
    REAL_OWNER: 'REAL_OWNER',
    REAL_OWNER_LEGACY_SEED: 'REAL_OWNER + LEGACY_SEED',
    AMBIGUOUS_MULTIPLE_OWNER: 'AMBIGUOUS_MULTIPLE_OWNER',
    RESTORED_OWNER: 'RESTORED_OWNER',
    INVALID_OWNER_CREDENTIAL: 'INVALID_OWNER_CREDENTIAL',
  });

  function isOwnerRole(user) {
    if (!user || user.isDev) return false;
    const role = String(user.role || '').toLowerCase();
    return role === OWNER_ROLE || role === 'hq_admin';
  }

  function isOwnerSeedUser(user) {
    if (!user || !isOwnerRole(user)) return false;
    if (user.ownerSeedRetired === true) return true;
    if (user.seedDefaultPassword === true) return true;
    if (user.password === OWNER_SEED_PASSWORD_HASH) return true;
    return false;
  }

  function hasUsableOwnerCredential(user) {
    if (!user || user.active === false || user.isDev) return false;
    if (!isOwnerRole(user)) return false;
    if (user.mustChangePassword === true || user.seedDefaultPassword === true) return false;
    if (user.ownerSeedRetired === true) return false;
    if (user.hasUsableCredential === true) return true;
    return /^(?:pbkdf2:|pbkdf2v2:|b64:)/i.test(String(user.password || ''));
  }

  function isAuthoritativeOwner(user) {
    return hasUsableOwnerCredential(user) && !isOwnerSeedUser(user);
  }

  function listAuthoritativeOwners(users) {
    return (Array.isArray(users) ? users : []).filter(isAuthoritativeOwner);
  }

  function countAuthoritativeOwners(users) {
    return listAuthoritativeOwners(users).length;
  }

  function classifyOwnerState(users, options) {
    options = options || {};
    users = Array.isArray(users) ? users : [];
    const authoritative = listAuthoritativeOwners(users);
    const activeSeeds = users.filter((u) => isOwnerSeedUser(u) && u.active !== false && u.ownerSeedRetired !== true);
    const ownerRows = users.filter((u) => isOwnerRole(u) && u.active !== false);

    if (authoritative.length > 1) {
      return { state: OWNER_STATE_CLASS.AMBIGUOUS_MULTIPLE_OWNER, authoritativeOwnerCount: authoritative.length };
    }
    if (options.restored === true && authoritative.length === 1) {
      return {
        state: OWNER_STATE_CLASS.RESTORED_OWNER,
        authoritativeOwnerCount: 1,
        legacySeedPresent: activeSeeds.length > 0,
      };
    }
    if (authoritative.length === 1) {
      if (activeSeeds.length > 0) {
        return { state: OWNER_STATE_CLASS.REAL_OWNER_LEGACY_SEED, authoritativeOwnerCount: 1, legacySeedCount: activeSeeds.length };
      }
      return { state: OWNER_STATE_CLASS.REAL_OWNER, authoritativeOwnerCount: 1 };
    }
    if (activeSeeds.length > 0 && ownerRows.length === activeSeeds.length) {
      return { state: OWNER_STATE_CLASS.SEED_ONLY, authoritativeOwnerCount: 0, seedCount: activeSeeds.length };
    }
    if (ownerRows.length > 0 && authoritative.length === 0) {
      return { state: OWNER_STATE_CLASS.INVALID_OWNER_CREDENTIAL, authoritativeOwnerCount: 0, ownerRowCount: ownerRows.length };
    }
    if (activeSeeds.length > 0) {
      return { state: OWNER_STATE_CLASS.SEED_ONLY, authoritativeOwnerCount: 0, seedCount: activeSeeds.length };
    }
    return { state: OWNER_STATE_CLASS.NO_OWNER, authoritativeOwnerCount: 0 };
  }

  function pickAuthoritativeOwner(users) {
    const list = listAuthoritativeOwners(users);
    if (list.length === 1) return list[0];
    if (list.length > 1) return null;
    return null;
  }

  function retireOwnerSeedAccounts(users, options) {
    options = options || {};
    users = Array.isArray(users) ? users.slice() : [];
    const authoritative = pickAuthoritativeOwner(users);
    if (!authoritative) {
      return { users, changed: false, retiredCount: 0, reason: 'no_authoritative_owner' };
    }
    let changed = false;
    let retiredCount = 0;
    const retiredAt = options.retiredAt || new Date().toISOString();
    const next = users.map((user) => {
      if (!isOwnerSeedUser(user)) return user;
      if (user.ownerSeedRetired === true && user.active === false) return user;
      changed = true;
      retiredCount += 1;
      return {
        ...user,
        active: false,
        ownerSeedRetired: true,
        seedDefaultPassword: true,
        mustChangePassword: true,
        supersededByOwnerId: authoritative.id,
        retiredAt: user.retiredAt || retiredAt,
      };
    });
    return { users: next, changed, retiredCount, authoritativeOwnerId: authoritative.id };
  }

  function shouldAllowOwnerSeedLogin(users, user) {
    if (!isOwnerSeedUser(user)) return true;
    return countAuthoritativeOwners(users) === 0;
  }

  function shouldExposeUserForLogin(users, user) {
    if (!user || user.active === false || user.isDev) return false;
    if (isOwnerSeedUser(user) && !shouldAllowOwnerSeedLogin(users, user)) return false;
    if (user.ownerSeedRetired === true) return false;
    return true;
  }

  /**
   * Bootstrap compatibility: seed only when no owner row exists.
   * When authoritative owner exists: retire legacy seeds and never re-insert seed.
   */
  function ensureOwnerSeedCompatibility(list, seedTemplate) {
    if (!Array.isArray(list)) list = [];
    const authoritativeCount = countAuthoritativeOwners(list);
    if (authoritativeCount > 0) {
      const retired = retireOwnerSeedAccounts(list);
      return dedupeSeedUsername(retired.users);
    }

    const owners = list.filter((u) => u && isOwnerRole(u));
    if (owners.length) {
      return dedupeSeedUsername(list);
    }

    const seed = seedTemplate || null;
    if (!seed) return list;
    const next = list.concat([{ ...seed, id: String(seed.id || ('owner-' + Date.now())) }]);
    return dedupeSeedUsername(next);
  }

  function dedupeSeedUsername(list) {
    const seen = new Set();
    const out = [];
    for (const user of list) {
      if (!user) continue;
      if (isOwnerRole(user) && String(user.username || '').toLowerCase() === 'owner') {
        const key = 'owner:' + String(user.username || '').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (user.password === OWNER_SEED_PASSWORD_HASH) {
          user.mustChangePassword = true;
          user.seedDefaultPassword = true;
        }
      }
      out.push(user);
    }
    return out;
  }

  function migrateOwnerSeedState(users, options) {
    const classified = classifyOwnerState(users, options);
    if (classified.authoritativeOwnerCount !== 1) {
      return { users, changed: false, classification: classified };
    }
    const retired = retireOwnerSeedAccounts(users, options);
    return {
      users: retired.users,
      changed: retired.changed,
      retiredCount: retired.retiredCount,
      classification: classifyOwnerState(retired.users, options),
      authoritativeOwnerId: retired.authoritativeOwnerId,
    };
  }

  const api = {
    OWNER_SEED_PASSWORD_HASH,
    OWNER_STATE_CLASS,
    isOwnerRole,
    isOwnerSeedUser,
    hasUsableOwnerCredential,
    isAuthoritativeOwner,
    listAuthoritativeOwners,
    countAuthoritativeOwners,
    classifyOwnerState,
    pickAuthoritativeOwner,
    retireOwnerSeedAccounts,
    shouldAllowOwnerSeedLogin,
    shouldExposeUserForLogin,
    ensureOwnerSeedCompatibility,
    migrateOwnerSeedState,
  };

  global.OwnerSeedRetirement = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
