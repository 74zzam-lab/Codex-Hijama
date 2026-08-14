/**
 * Schema migrations — run on Local DB before sync (Cloud V2).
 */
(function (global) {
  'use strict';

  const Meta = global.CloudMeta;

  function migrate_v0_to_v1(ctx) {
    const meta = ctx.meta;
    if (!meta.centerId && global.CenterId) {
      meta.centerId = global.CenterId.ensureCenterId(meta.centerId);
    }
    // Operational settings are owned by SQLite. Cloud schema migrations may
    // advance metadata only; they must never create a second write authority.
    meta.operationalMigrationDelegated = 'sqlite_003_p0b_authority';
    return meta;
  }

  function migrate_v1_to_v2(ctx) {
    const meta = ctx.meta;
    // Missing ownership is ambiguous. Migration 003 resolves it from proven
    // center/branch identity or quarantines the row; never assume BR-MAIN here.
    if (!meta.defaultBranchId) meta.legacyBranchMigrationRequired = true;
    meta.operationalMigrationDelegated = 'sqlite_003_p0b_authority';
    return meta;
  }

  function migrate_v2_to_v3(ctx) {
    const meta = ctx.meta;
    if (!meta.centerId && global.CenterId) {
      meta.centerId = global.CenterId.ensureCenterId(meta.centerId);
    }
    const centerId = meta.centerId || global.LicenseCloud?.loadLocal?.()?.centerId || '';
    const branchId = meta.defaultBranchId || '';
    if (global.VersionsIndex?.syncFromRepository) {
      global.VersionsIndex.syncFromRepository(global.Repository, centerId, branchId);
    }
    if (branchId && global.ConfigLayer?.exportBranchPack) {
      const pack = global.ConfigLayer.exportBranchPack(branchId);
      meta.branchConfigCachePrepared = !!(pack && (centerId || pack.centerId));
    }
    meta.configLayerReady = !!branchId;
    return meta;
  }

  function migrate_v3_to_v4(ctx) {
    const meta = ctx.meta;
    if (global.SyncState?.load) {
      const st = global.SyncState.load();
      global.SyncState.save(st);
    }
    meta.syncEngineReady = true;
    return meta;
  }

  function migrate_v4_to_v5(ctx) {
    const meta = ctx.meta;
    meta.operationalMigrationDelegated = 'sqlite_003_p0b_authority';
    meta.auditLogReady = true;
    meta.ownerHubReady = true;
    return meta;
  }

  function migrate_v5_to_v6(ctx) {
    const meta = ctx.meta;
    meta.recordMetadataReady = meta.legacyBranchMigrationRequired !== true;
    meta.coreDataEngineReady = true;
    meta.operationalMigrationDelegated = 'sqlite_003_p0b_authority';
    return meta;
  }

  const MIGRATIONS = [
    { from: 0, to: 1, name: 'cloud_v2_meta_center_id', run: migrate_v0_to_v1 },
    { from: 1, to: 2, name: 'cloud_v2_branch_id_on_records', run: migrate_v1_to_v2 },
    { from: 2, to: 3, name: 'cloud_v2_config_versions_cache', run: migrate_v2_to_v3 },
    { from: 3, to: 4, name: 'cloud_v2_sync_engine', run: migrate_v3_to_v4 },
    { from: 4, to: 5, name: 'cloud_v2_owner_hub_audit_backup', run: migrate_v4_to_v5 },
    { from: 5, to: 6, name: 'cloud_v2_record_metadata', run: migrate_v5_to_v6 }
  ];

  function runMigrations(options) {
    options = options || {};
    const target = options.targetVersion ?? Meta.APP_SCHEMA_VERSION;
    let meta = Meta.loadMeta();
    const from = meta.schemaVersion || 0;
    if (from >= target) return { ok: true, from, to: from, ran: [] };

    const db = global.DB;
    const ran = [];
    let cur = from;

    while (cur < target) {
      const step = MIGRATIONS.find(m => m.from === cur && m.to === cur + 1);
      if (!step) {
        return { ok: false, error: 'missing_migration', from: cur, to: target };
      }
      try {
        meta = step.run({ meta, db, global }) || meta;
        cur = step.to;
        meta.schemaVersion = cur;
        meta.migratedAt = new Date().toISOString();
        Meta.saveMeta(meta);
        ran.push(step.name);
        if (typeof global.AuditLogger?.log === 'function') {
          global.AuditLogger.log({
            action: 'SCHEMA_MIGRATED',
            entity: 'meta',
            entityId: String(cur),
            summary: `Migration ${step.name}: ${step.from} → ${step.to}`
          });
        }
      } catch (e) {
        return { ok: false, error: e.message || String(e), from: cur, ran };
      }
    }

    return { ok: true, from, to: cur, ran };
  }

  global.MigrationRunner = { MIGRATIONS, runMigrations };
})(typeof window !== 'undefined' ? window : globalThis);
