/**
 * DB Bridge — synced tables MUST go through Repository (metadata + merge policy).
 */
(function (global) {
  'use strict';

  function syncedTables() {
    return global.Repository?.SYNCED_TABLES
      || global.RepositoryFactory?.SYNCED_TABLES
      || [];
  }

  function syncedSet() {
    return new Set(syncedTables());
  }

  function rawDb() {
    return global.DB?.__tdwBridged ? global.DB.raw : global.DB;
  }

  function ensureRepository() {
    if (global.Repository) return global.Repository;
    const store = rawDb();
    if (global.RepositoryFactory && store) {
      global.Repository = global.RepositoryFactory.createRepository(
        global.RepositoryFactory.createLocalStorageAdapter(store)
      );
    }
    return global.Repository || null;
  }

  function isSyncedKey(key) {
    return syncedSet().has(key);
  }

  function get(key, def) {
    const repo = ensureRepository();
    if (repo && isSyncedKey(key)) {
      const val = repo.get(key);
      return val == null ? def : val;
    }
    return rawDb()?.get?.(key, def) ?? def;
  }

  function set(key, value) {
    if (typeof global.dbSetGuarded === 'function' && !global.dbSetGuarded(key, value)) {
      return Promise.resolve({ ok: false, error: 'database_write_guard_denied' });
    }
    const repo = ensureRepository();
    if (repo && isSyncedKey(key)) {
      repo.setAll(key, value);
      return Promise.resolve({ ok: true, legacyBridge: true });
    }
    const store = rawDb();
    if (!store?.set) return Promise.resolve({ ok: false, error: 'database_write_unavailable' });
    return store.set(key, value);
  }

  function install() {
    const store = rawDb();
    if (!store || store.__tdwBridged) {
      ensureRepository();
      return store;
    }
    const bridged = {
      __tdwBridged: true,
      get: (k, def) => get(k, def),
      set: (k, v) => set(k, v),
      raw: store
    };
    global.DB = bridged;
    ensureRepository();
    return bridged;
  }

  global.DbBridge = {
    ensureRepository,
    get,
    set,
    install,
    isSyncedKey,
    syncedTables,
    rawDb
  };
})(typeof window !== 'undefined' ? window : globalThis);
