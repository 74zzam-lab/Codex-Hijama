/**
 * Configuration Layer — per-branch config packs for Drive (Cloud V2 Sprint 3).
 * Phase 1: record-level merge for array tables; safe settings merge.
 */
(function (global) {
  'use strict';

  const CONFIG_FILES = ['settings.json', 'prices.json', 'services.json', 'packages.json', 'users.json', 'owner.json'];
  const ARRAY_TABLES = ['services', 'packages', 'users'];

  function getCenterId() {
    return global.DeviceConfig?.getCenterIdFromConfig?.()
      || global.CenterId?.getStoredCenterId?.()
      || global.LicenseCloud?.loadLocal?.()?.centerId
      || '';
  }

  async function commitOperational(key, value, options) {
    if (!global.SqliteBridge?.setAuthoritative) {
      throw new Error(`authoritative_write_unavailable:${key}`);
    }
    const result = await global.SqliteBridge.setAuthoritative(key, value, options || {});
    if (!result || result.ok === false) {
      throw new Error(result?.error || `config_commit_failed:${key}`);
    }
    return result;
  }

  function deriveOwnerProfileProjection(profile) {
    if (!profile || typeof profile !== 'object') return null;
    const users = global.users || global.DB?.get?.('users', []) || [];
    const owner = users.find((user) => user && user.active !== false
      && ['owner', 'hq_admin'].includes(String(user.role || '').toLowerCase())
      && /^(?:pbkdf2:|pbkdf2v2:|b64:)/i.test(String(user.password || ''))
      && user.mustChangePassword !== true && user.seedDefaultPassword !== true);
    if (!owner) return null;
    return {
      ...profile,
      schemaVersion: 2,
      role: 'owner',
      username: String(owner.username || profile.username || '').trim().toLowerCase(),
      credentialUserId: String(owner.id),
      credentialRevision: Math.max(1, Number(owner.credentialRevision) || 1),
      passwordHash: null,
      passwordChangedAt: owner.passwordChangedAt || profile.passwordChangedAt || null,
      updatedAt: new Date().toISOString(),
    };
  }

  function buildCenterJson() {
    const s = global.settings || {};
    const license = global.LicenseCloud?.loadLocal?.() || {};
    const branches = (license.branches || []).filter(b => b && b.active !== false).map(b => b.id);
    return {
      centerId: getCenterId(),
      centerName: license.centerName || s.centerName || '',
      taxNum: s.taxNum || '',
      crNum: s.crNum || '',
      defaultVatRate: s.vatRate ?? 15,
      branches: branches.length ? branches : [global.BranchScope?.DEFAULT_BRANCH_ID || 'BR-MAIN'],
      updatedAt: new Date().toISOString()
    };
  }

  function buildBranchState(branchId) {
    return {
      branchId: branchId || global.BranchScope?.getActiveBranchId?.() || 'BR-MAIN',
      budget: Number(global.DB?.get?.('budget', 0)) || 0,
      invoiceCounter: Math.max(1, Number(global.DB?.get?.('invoiceCounter', global.invoiceCounter || 1)) || 1),
      clientFileCounter: Math.max(1, Number(global.DB?.get?.('clientFileCounter', global.clientFileCounter || 1)) || 1),
      luxQueue: global.DB?.get?.('luxQueue', null) || null,
      updatedAt: new Date().toISOString()
    };
  }

  async function applyBranchState(state) {
    if (!state || typeof state !== 'object') return [];
    const applied = [];
    const write = async (key, value) => {
      if (value === undefined) return;
      await commitOperational(key, value);
      applied.push(key);
    };
    await write('budget', Math.max(0, Number(state.budget) || 0));
    if (state.invoiceCounter != null) {
      const value = Math.max(1, Number(state.invoiceCounter) || 1);
      await write('invoiceCounter', value);
      global.invoiceCounter = value;
    }
    if (state.clientFileCounter != null) {
      const value = Math.max(1, Number(state.clientFileCounter) || 1);
      await write('clientFileCounter', value);
      global.clientFileCounter = value;
    }
    if (state.luxQueue !== undefined) await write('luxQueue', state.luxQueue);
    return applied;
  }

  function exportBranchPack(branchId) {
    branchId = branchId || global.BranchScope?.getActiveBranchId?.() || '';
    if (!branchId) throw new Error('config_export_branch_required');
    const Split = global.SettingsSplit;
    const services = global.services || global.DB?.get?.('services', []) || [];
    const packages = global.packages || global.DB?.get?.('packages', []) || [];
    const users = global.users || global.DB?.get?.('users', []) || [];
    const ownerProfile = deriveOwnerProfileProjection(global.DB?.get?.('__tdw_owner_profile__', null));

    const branchState = buildBranchState(branchId);
    const branchSettings = Split?.extractBranchSettings?.(global.settings) || {};
    branchSettings.__tdwBranchState = branchState;
    return {
      centerId: getCenterId(),
      branchId,
      exportedAt: new Date().toISOString(),
      settings: branchSettings,
      prices: Split?.extractPrices?.(global.settings) || {},
      services: Array.isArray(services) ? services.filter(s => s && s.active !== false) : [],
      packages: Array.isArray(packages) ? packages.filter(p => p && p.active !== false) : [],
      users: Split?.filterUsersForBranch?.(users, branchId) || [],
      owner: {
        profile: ownerProfile,
        sessionEpoch: Number(global.DB?.get?.('__tdw_owner_session_epoch__', 0)) || 0,
        setup: global.DB?.get?.('__tdw_owner_setup__', null) || null
      },
      branchState
    };
  }

  function packToDriveFiles(pack) {
    return {
      'settings.json': pack.settings,
      'prices.json': pack.prices,
      'services.json': pack.services,
      'packages.json': pack.packages,
      'users.json': pack.users,
      'owner.json': pack.owner
    };
  }

  function drivePathForFile(centerId, branchId, fileName) {
    return global.DriveLayout?.configBranchFile?.(centerId, branchId, fileName) || '';
  }

  function centerJsonPath(centerId) {
    return global.DriveLayout?.configCenterJson?.(centerId) || '';
  }

  function centerJsonPathCandidates(centerId) {
    return global.DriveLayout?.configCenterJsonCandidates?.(centerId) || [centerJsonPath(centerId)];
  }

  function mergeSettingsObject(localObj, remoteObj, branchId) {
    localObj = localObj || {};
    remoteObj = remoteObj || {};
    const localRec = { id: '__settings__', ...localObj, branchId };
    const remoteRec = { id: '__settings__', ...remoteObj, branchId };
    const merge = global.RecordMerger?.mergeRecords?.(
      [localRec],
      [remoteRec],
      { table: 'settings', branchId, enqueueConflicts: true, preserveOtherBranches: false }
    );
    if (merge?.hasConflict) {
      return { ok: false, blocked: true, hasConflict: true, conflicts: merge.conflicts };
    }
    const merged = merge?.merged?.[0] || { ...localObj, ...remoteObj };
    const { id, ...settings } = merged;
    return { ok: true, settings };
  }

  async function mergeArrayTable(table, incoming, branchId, options) {
    options = options || {};
    const repo = global.Repository;
    const existing = repo?.get?.(table) || global.DB?.get?.(table, []) || [];
    const merge = global.RecordMerger?.mergeRecords?.(existing, incoming, {
      table,
      branchId,
      enqueueConflicts: options.enqueueConflicts !== false,
      preserveOtherBranches: table === 'users'
    });
    if (merge?.hasConflict) {
      return { ok: false, blocked: true, hasConflict: true, conflicts: merge.conflicts };
    }
    let mergedRows = merge?.merged || incoming;
    if (table === 'users') {
      const localById = new Map((existing || []).map((row) => [String(row?.id || row?.username || ''), row]));
      const remoteById = new Map((incoming || []).map((row) => [String(row?.id || row?.username || ''), row]));
      const protectedFields = [
        'password', 'credentialRevision', 'passwordChangedAt', 'mustChangePassword',
        'seedDefaultPassword', 'role', 'active', 'permissions',
      ];
      mergedRows = mergedRows.map((row) => {
        const key = String(row?.id || row?.username || '');
        const local = localById.get(key);
        const remote = remoteById.get(key);
        if (!local || !remote) return row;
        const localRevision = Number(local.credentialRevision) || 0;
        const remoteRevision = Number(remote.credentialRevision) || 0;
        const winner = remoteRevision > localRevision ? remote : local;
        const safe = { ...row };
        for (const field of protectedFields) {
          if (Object.prototype.hasOwnProperty.call(winner, field)) safe[field] = winner[field];
        }
        return safe;
      });
    }
    const committed = await commitOperational(table, mergedRows, {
      branchId,
      source: options.remote ? 'cloud_pull' : 'config_import',
    });
    if (committed?.ok === false) return { ok: false, error: committed.error || 'config_table_commit_failed', table };
    if (table === 'services') global.services = mergedRows;
    if (table === 'packages') global.packages = mergedRows;
    if (table === 'users') global.users = mergedRows;
    return { ok: true, merged: mergedRows, stats: merge.stats };
  }

  async function importBranchPack(pack, options) {
    options = options || {};
    if (!pack || typeof pack !== 'object') return { ok: false, error: 'invalid_pack' };
    const branchId = pack.branchId || options.branchId || global.BranchScope?.getActiveBranchId?.() || '';
    if (!branchId) return { ok: false, error: 'config_import_branch_required' };
    const conflicts = [];

    const branchState = pack.branchState || pack.settings?.__tdwBranchState || null;
    if (pack.settings && global.settings) {
      const incomingSettings = { ...pack.settings };
      delete incomingSettings.__tdwBranchState;
      const settingsMerge = options.preferRemote === true
        ? {
          ok: true,
          settings: {
            ...(global.SettingsSplit?.extractBranchSettings?.(global.settings) || global.settings),
            ...incomingSettings,
            branchId
          }
        }
        : mergeSettingsObject(
          global.SettingsSplit?.extractBranchSettings?.(global.settings) || global.settings,
          incomingSettings,
          branchId
        );
      if (!settingsMerge.ok) {
        conflicts.push(...(settingsMerge.conflicts || []));
        if (!options.allowConflict) {
          global.SyncGuard?.pause?.('conflict', { table: 'settings', conflicts: settingsMerge.conflicts });
          return { ok: false, blocked: true, hasConflict: true, conflicts: settingsMerge.conflicts };
        }
      } else {
        const nextSettings = {
          ...global.settings,
          ...settingsMerge.settings,
          defaultBranchId: branchId,
        };
        const committed = await commitOperational('settings', nextSettings, options);
        if (committed?.ok === false) return { ok: false, error: committed.error || 'settings_commit_failed' };
      }
    }

    if (branchState) await applyBranchState(branchState);

    if (pack.prices && global.settings) {
      const pricesMerge = options.preferRemote === true
        ? {
          ok: true,
          settings: {
            ...(global.SettingsSplit?.extractPrices?.(global.settings) || {}),
            ...pack.prices
          }
        }
        : mergeSettingsObject(
          global.SettingsSplit?.extractPrices?.(global.settings) || {},
          pack.prices,
          branchId
        );
      if (!pricesMerge.ok) {
        conflicts.push(...(pricesMerge.conflicts || []));
        if (!options.allowConflict) {
          global.SyncGuard?.pause?.('conflict', { table: 'settings_prices', conflicts: pricesMerge.conflicts });
          return { ok: false, blocked: true, hasConflict: true, conflicts: pricesMerge.conflicts };
        }
      } else {
        const nextSettings = { ...global.settings, ...pricesMerge.settings };
        const committed = await commitOperational('settings', nextSettings, options);
        if (committed?.ok === false) return { ok: false, error: committed.error || 'prices_commit_failed' };
      }
    }

    for (const table of ARRAY_TABLES) {
      if (!Array.isArray(pack[table])) continue;
      if (table === 'users' && options.mergeUsers === false) continue;
      const incoming = pack[table];
      const r = await mergeArrayTable(table, incoming, branchId, options);
      if (!r.ok) {
        conflicts.push(...(r.conflicts || []));
        if (!options.allowConflict) {
          return { ok: false, blocked: true, hasConflict: true, table, conflicts: r.conflicts };
        }
      }
    }

    if (pack.owner && typeof pack.owner === 'object') {
      if (pack.owner.profile && typeof pack.owner.profile === 'object') {
        const projection = deriveOwnerProfileProjection(pack.owner.profile);
        if (!projection) return { ok: false, error: 'authoritative_owner_credential_missing' };
        try { await commitOperational('__tdw_owner_profile__', projection, options); }
        catch (error) { return { ok: false, error: error.message || 'owner_profile_commit_failed' }; }
      }
      if (Number.isFinite(Number(pack.owner.sessionEpoch))) {
        try { await commitOperational('__tdw_owner_session_epoch__', Number(pack.owner.sessionEpoch) || 0, options); }
        catch (error) { return { ok: false, error: error.message || 'owner_epoch_commit_failed' }; }
      }
      if (pack.owner.setup && typeof pack.owner.setup === 'object') {
        try { await commitOperational('__tdw_owner_setup__', pack.owner.setup, options); }
        catch (error) { return { ok: false, error: error.message || 'owner_setup_commit_failed' }; }
      }
    }

    if (conflicts.length && !options.allowConflict) {
      return { ok: false, blocked: true, hasConflict: true, conflicts };
    }

    if (global.VersionsIndex && !options.remote && !options.skipVersionBump) {
      global.VersionsIndex.bumpConfig('settingsVersion', branchId);
      global.VersionsIndex.bumpConfig('pricesVersion', branchId);
      global.VersionsIndex.bumpConfig('servicesVersion', branchId);
      global.VersionsIndex.bumpConfig('packagesVersion', branchId);
      global.VersionsIndex.bumpConfig('usersVersion', branchId);
    }

    return { ok: true, branchId, hadConflicts: conflicts.length > 0 };
  }

  async function importBranchPackAuthoritative(pack, options) {
    options = { ...(options || {}), remote: true, skipVersionBump: true };
    const result = await importBranchPack(pack, options);
    return result?.ok === true ? { ...result, authoritative: true } : result;
  }

  global.ConfigLayer = {
    CONFIG_FILES,
    ARRAY_TABLES,
    getCenterId,
    buildCenterJson,
    buildBranchState,
    applyBranchState,
    exportBranchPack,
    deriveOwnerProfileProjection,
    packToDriveFiles,
    drivePathForFile,
    centerJsonPath,
    centerJsonPathCandidates,
    importBranchPack,
    importBranchPackAuthoritative,
    mergeArrayTable,
    mergeSettingsObject
  };
})(typeof window !== 'undefined' ? window : globalThis);
