/**
 * Table Merge Policy — per-table merge strategies (not one-size-fits-all).
 */
(function (global) {
  'use strict';

  const STRATEGIES = {
    LATEST_WINS: 'latest_wins',
    MERGE_FIELDS: 'merge_fields',
    STRICT_CONFLICT: 'strict_conflict',
    SECTION_AWARE: 'section_aware',
    MOVEMENT_AWARE: 'movement_aware',
    APPEND_UNION: 'append_union'
  };

  const TABLE_POLICIES = {
    attendance: { strategy: STRATEGIES.LATEST_WINS, label: 'الحضور', caution: 'low' },
    clientsRegistry: { strategy: STRATEGIES.MERGE_FIELDS, label: 'العملاء', caution: 'medium' },
    doctors: { strategy: STRATEGIES.MERGE_FIELDS, label: 'الموظفون', caution: 'medium' },
    bookings: { strategy: STRATEGIES.LATEST_WINS, label: 'الحجوزات', caution: 'medium' },
    expenses: { strategy: STRATEGIES.STRICT_CONFLICT, label: 'المصروفات', caution: 'high' },
    cases: { strategy: STRATEGIES.STRICT_CONFLICT, label: 'الفواتير', caution: 'critical' },
    settings: { strategy: STRATEGIES.SECTION_AWARE, label: 'الإعدادات', caution: 'high' },
    services: { strategy: STRATEGIES.MERGE_FIELDS, label: 'الخدمات', caution: 'medium' },
    packages: { strategy: STRATEGIES.MERGE_FIELDS, label: 'الباقات', caution: 'medium' },
    users: {
      strategy: STRATEGIES.MERGE_FIELDS,
      label: 'المستخدمون',
      caution: 'high',
      protectedFields: [
        'password', 'role', 'credentialRevision', 'passwordChangedAt',
        'mustChangePassword', 'seedDefaultPassword', 'active'
      ]
    },
    inventoryItems: { strategy: STRATEGIES.MOVEMENT_AWARE, label: 'المخزون', caution: 'high' },
    inventorySuppliers: { strategy: STRATEGIES.MERGE_FIELDS, label: 'موردو المخزون', caution: 'medium' },
    inventoryMovements: { strategy: STRATEGIES.MOVEMENT_AWARE, label: 'حركات المخزون', caution: 'critical' },
    activityLog: { strategy: STRATEGIES.APPEND_UNION, label: 'سجل النشاط', caution: 'low' }
  };

  Object.assign(TABLE_POLICIES, {
    otRecords: { strategy: STRATEGIES.STRICT_CONFLICT, label: 'Overtime', caution: 'high' },
    nextSessions: { strategy: STRATEGIES.LATEST_WINS, label: 'Next sessions', caution: 'medium' },
    employeeLeaveRequests: { strategy: STRATEGIES.STRICT_CONFLICT, label: 'Leave requests', caution: 'high' },
    employeeLedgerAccruals: { strategy: STRATEGIES.STRICT_CONFLICT, label: 'Employee accruals', caution: 'critical' },
    employeeLedgerPayments: { strategy: STRATEGIES.STRICT_CONFLICT, label: 'Employee payments', caution: 'critical' },
    employeeLedgerEntries: { strategy: STRATEGIES.STRICT_CONFLICT, label: 'Employee ledger entries', caution: 'critical' },
    messageLog: { strategy: STRATEGIES.APPEND_UNION, label: 'Message log', caution: 'low' }
  });

  const DEFAULT_POLICY = { strategy: STRATEGIES.MERGE_FIELDS, label: '', caution: 'medium' };

  function getPolicy(table) {
    return TABLE_POLICIES[table] || DEFAULT_POLICY;
  }

  function compareRevision(local, remote) {
    return global.MergePolicy?.compareRevision?.(local, remote) || 0;
  }

  function overlappingFields(local, remote, ignoreExtra) {
    const ignore = new Set(['revision', 'updatedAt', 'updatedBy', 'deviceId', 'createdAt', 'createdBy', ...(ignoreExtra || [])]);
    const conflicts = [];
    const keys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
    keys.forEach(k => {
      if (ignore.has(k)) return;
      const lv = local?.[k];
      const rv = remote?.[k];
      if (lv === undefined || rv === undefined) return;
      if (JSON.stringify(lv) !== JSON.stringify(rv)) conflicts.push(k);
    });
    return conflicts;
  }

  function mergeComplementary(local, remote) {
    return {
      ...remote,
      ...local,
      revision: Math.max(Number(local?.revision) || 0, Number(remote?.revision) || 0) + 1
    };
  }

  function isPortableCredential(value) {
    return /^(?:pbkdf2:|pbkdf2v2:|b64:)/i.test(String(value || ''));
  }

  function isSeedCredential(user) {
    return user?.mustChangePassword === true || user?.seedDefaultPassword === true;
  }

  function decideUserCredential(local, remote, ACTIONS) {
    const localRevision = Math.max(0, Number(local?.credentialRevision) || 0);
    const remoteRevision = Math.max(0, Number(remote?.credentialRevision) || 0);
    const localPortable = isPortableCredential(local?.password);
    const remotePortable = isPortableCredential(remote?.password);
    const localSeed = isSeedCredential(local);
    const remoteSeed = isSeedCredential(remote);
    let winner = null;
    let loser = null;
    let reason = '';

    if (localRevision !== remoteRevision) {
      winner = localRevision > remoteRevision ? local : remote;
      loser = winner === local ? remote : local;
      if (!isPortableCredential(winner?.password)) {
        return {
          action: ACTIONS.CONFLICT,
          reason: 'invalid_newer_credential',
          fields: ['password', 'credentialRevision'],
          local,
          remote,
        };
      }
      reason = localRevision > remoteRevision ? 'local_credential_revision_newer' : 'remote_credential_revision_newer';
    } else if (String(local?.password || '') !== String(remote?.password || '')) {
      if (localPortable && !localSeed && (!remotePortable || remoteSeed)) {
        winner = local;
        loser = remote;
        reason = 'local_nonseed_migration_wins';
      } else if (remotePortable && !remoteSeed && (!localPortable || localSeed)) {
        winner = remote;
        loser = local;
        reason = 'remote_nonseed_migration_wins';
      } else {
        return {
          action: ACTIONS.CONFLICT,
          reason: 'credential_revision_collision',
          fields: ['password', 'credentialRevision'],
          local,
          remote,
        };
      }
    } else if (String(local?.role || '') !== String(remote?.role || '')) {
      return {
        action: ACTIONS.CONFLICT,
        reason: 'role_revision_collision',
        fields: ['role', 'credentialRevision'],
        local,
        remote,
      };
    } else {
      const cmp = compareRevision(local, remote);
      winner = cmp < 0 ? remote : local;
      loser = winner === local ? remote : local;
      reason = 'credential_identical';
    }

    const merged = {
      ...loser,
      ...winner,
      password: winner.password,
      role: winner.role,
      active: winner.active,
      credentialRevision: Math.max(localRevision, remoteRevision),
      passwordChangedAt: winner.passwordChangedAt || loser.passwordChangedAt || null,
      mustChangePassword: isSeedCredential(winner),
      seedDefaultPassword: winner.seedDefaultPassword === true,
      revision: Math.max(Number(local?.revision) || 0, Number(remote?.revision) || 0),
    };
    if (isPortableCredential(merged.password) && !isSeedCredential(winner)) {
      merged.mustChangePassword = false;
      merged.seedDefaultPassword = false;
    }
    return { action: ACTIONS.MERGE, reason, merged, fields: overlappingFields(local, remote) };
  }

  function decideForTable(table, local, remote) {
    const policy = getPolicy(table);
    const ACTIONS = global.MergePolicy?.ACTIONS || {
      SKIP: 'skip', PUSH: 'push', PULL: 'pull', MERGE: 'merge', CONFLICT: 'conflict'
    };

    if (!local && !remote) return { action: ACTIONS.SKIP };
    if (table === 'users') {
      if (local && !remote) return { action: ACTIONS.PUSH, reason: 'local_only' };
      if (!local && remote) {
        if (!isPortableCredential(remote.password) && !isSeedCredential(remote)) {
          return {
            action: ACTIONS.CONFLICT,
            reason: 'remote_credential_invalid',
            fields: ['password'],
            local,
            remote,
          };
        }
        return { action: ACTIONS.PULL, reason: 'cloud_only' };
      }
    }
    if (local && !remote) return { action: ACTIONS.PUSH, reason: 'local_only' };
    if (!local && remote) return { action: ACTIONS.PULL, reason: 'cloud_only' };

    if (global.MergePolicy?.isIdentical?.(local, remote)) {
      return { action: ACTIONS.SKIP, reason: 'identical' };
    }

    if (table === 'users') return decideUserCredential(local, remote, ACTIONS);

    const fields = overlappingFields(local, remote, policy.protectedFields);
    const cmp = compareRevision(local, remote);

    switch (policy.strategy) {
      case STRATEGIES.LATEST_WINS:
        if (!fields.length) return { action: ACTIONS.MERGE, reason: 'complementary', merged: mergeComplementary(local, remote) };
        if (cmp > 0) return { action: ACTIONS.PUSH, reason: 'local_newer', fields };
        if (cmp < 0) return { action: ACTIONS.PULL, reason: 'cloud_newer', fields };
        return { action: ACTIONS.CONFLICT, reason: 'diverged', fields, local, remote };

      case STRATEGIES.MERGE_FIELDS:
        if (!fields.length) return { action: ACTIONS.MERGE, reason: 'complementary', merged: mergeComplementary(local, remote) };
        if (fields.length === 1 && policy.protectedFields?.includes(fields[0])) {
          return { action: ACTIONS.CONFLICT, reason: 'protected_field', fields, local, remote };
        }
        if (cmp !== 0) {
          const winner = cmp > 0 ? local : remote;
          const loser = cmp > 0 ? remote : local;
          const merged = mergeComplementary(loser, winner);
          fields.forEach(f => {
            if (policy.protectedFields?.includes(f)) merged[f] = winner[f];
          });
          return { action: ACTIONS.MERGE, reason: 'field_merge_newer_base', merged, fields };
        }
        return { action: ACTIONS.MERGE, reason: 'field_merge', merged: mergeComplementary(local, remote), fields };

      case STRATEGIES.STRICT_CONFLICT:
        if (fields.length) return { action: ACTIONS.CONFLICT, reason: 'strict', fields, local, remote };
        return { action: ACTIONS.MERGE, reason: 'complementary', merged: mergeComplementary(local, remote) };

      case STRATEGIES.SECTION_AWARE:
        if (!fields.length) return { action: ACTIONS.MERGE, reason: 'complementary', merged: mergeComplementary(local, remote) };
        if (cmp > 0) return { action: ACTIONS.PUSH, reason: 'local_newer', fields };
        if (cmp < 0) return { action: ACTIONS.PULL, reason: 'cloud_newer', fields };
        return { action: ACTIONS.CONFLICT, reason: 'settings_diverged', fields, local, remote };

      case STRATEGIES.MOVEMENT_AWARE:
        if (table === 'inventoryMovements') {
          return { action: ACTIONS.MERGE, reason: 'movement_union', merged: mergeComplementary(local, remote) };
        }
        if (!fields.length) return { action: ACTIONS.MERGE, reason: 'complementary', merged: mergeComplementary(local, remote) };
        const localQty = Number(local?.quantity ?? local?.qty ?? local?.stock ?? 0);
        const remoteQty = Number(remote?.quantity ?? remote?.qty ?? remote?.stock ?? 0);
        const localMoves = Number(local?.movementCount ?? 0);
        const remoteMoves = Number(remote?.movementCount ?? 0);
        if (localMoves > remoteMoves || (localMoves === remoteMoves && localQty !== remoteQty && cmp > 0)) {
          return { action: ACTIONS.PUSH, reason: 'more_movements_local', fields, local, remote };
        }
        if (remoteMoves > localMoves || (localMoves === remoteMoves && localQty !== remoteQty && cmp < 0)) {
          return { action: ACTIONS.PULL, reason: 'more_movements_cloud', fields, local, remote };
        }
        return { action: ACTIONS.CONFLICT, reason: 'inventory_diverged', fields, local, remote };

      case STRATEGIES.APPEND_UNION:
        return { action: ACTIONS.MERGE, reason: 'append_union', merged: mergeComplementary(local, remote) };

      default:
        return global.MergePolicy?.decideRecord?.(local, remote) || { action: ACTIONS.CONFLICT, local, remote };
    }
  }

  function decideTable(table, localRecords, remoteRecords) {
    localRecords = Array.isArray(localRecords) ? localRecords : [];
    remoteRecords = Array.isArray(remoteRecords) ? remoteRecords : [];
    const byIdLocal = new Map(localRecords.filter(r => r?.id).map(r => [r.id, r]));
    const byIdRemote = new Map(remoteRecords.filter(r => r?.id).map(r => [r.id, r]));
    const ids = new Set([...byIdLocal.keys(), ...byIdRemote.keys()]);
    const ACTIONS = global.MergePolicy?.ACTIONS || {};

    const stats = { skip: 0, push: 0, pull: 0, merge: 0, conflict: 0 };
    const merged = [];
    const conflicts = [];
    const toPush = [];
    const toPull = [];

    ids.forEach(id => {
      const decision = decideForTable(table, byIdLocal.get(id), byIdRemote.get(id));
      switch (decision.action) {
        case ACTIONS.SKIP:
        case 'skip':
          stats.skip++;
          merged.push(byIdLocal.get(id) || byIdRemote.get(id));
          break;
        case ACTIONS.PUSH:
        case 'push':
          stats.push++;
          toPush.push(byIdLocal.get(id));
          merged.push(byIdLocal.get(id));
          break;
        case ACTIONS.PULL:
        case 'pull':
          stats.pull++;
          toPull.push(byIdRemote.get(id));
          merged.push(byIdRemote.get(id));
          break;
        case ACTIONS.MERGE:
        case 'merge':
          stats.merge++;
          merged.push(decision.merged || mergeComplementary(byIdLocal.get(id), byIdRemote.get(id)));
          break;
        case ACTIONS.CONFLICT:
        case 'conflict':
        default:
          stats.conflict++;
          conflicts.push({ id, table, policy: getPolicy(table).strategy, ...decision });
          merged.push(byIdLocal.get(id));
          break;
      }
    });

    return {
      ok: conflicts.length === 0,
      table,
      policy: getPolicy(table),
      stats,
      merged,
      conflicts,
      toPush,
      toPull,
      hasConflict: conflicts.length > 0,
      safeAutoMerge: conflicts.length === 0
    };
  }

  global.TableMergePolicy = {
    STRATEGIES,
    TABLE_POLICIES,
    getPolicy,
    decideForTable,
    decideTable,
    overlappingFields,
    isPortableCredential,
    decideUserCredential,
  };
})(typeof window !== 'undefined' ? window : globalThis);
