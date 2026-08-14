'use strict';

/**
 * Dual-device peer sync harness (V2-4).
 * Uses production SQLite outbox + a filesystem remote that mirrors Drive layout.
 * Google Drive adapter can replace FileRemote when OAuth tokens are available.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { openDatabase } = require('./connection');
const { createSyncPlatform } = require('./sync-outbox');
const { classify } = require('./sync-error-classify');

function sha256(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

class FileRemote {
  constructor(root) {
    this.root = root;
    ensureDir(root);
  }

  centerRoot(centerId) {
    return path.join(this.root, 'NajjarTech', 'centers', String(centerId));
  }

  branchDir(centerId, branchId) {
    return path.join(this.centerRoot(centerId), 'branches', String(branchId));
  }

  versionsPath(centerId, branchId) {
    return path.join(this.branchDir(centerId, branchId), 'versions.json');
  }

  tablePath(centerId, branchId, table) {
    return path.join(this.branchDir(centerId, branchId), 'operational', `${table}.json`);
  }

  quarantineDir(centerId, branchId) {
    return path.join(this.branchDir(centerId, branchId), 'quarantine');
  }

  attachmentPath(centerId, branchId, sha) {
    return path.join(this.branchDir(centerId, branchId), 'attachments', String(sha).toLowerCase());
  }

  readJson(file) {
    if (!fs.existsSync(file)) return null;
    const text = fs.readFileSync(file, 'utf8');
    try {
      return JSON.parse(text);
    } catch {
      const err = new Error('remote_corrupt_json');
      err.code = 'corrupt';
      err.remotePath = file;
      err.rawText = text;
      throw err;
    }
  }

  writeAtomic(file, obj) {
    ensureDir(path.dirname(file));
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    const body = JSON.stringify(obj, null, 2);
    fs.writeFileSync(tmp, body);
    const hash = sha256(body);
    const verify = sha256(fs.readFileSync(tmp));
    if (verify !== hash) throw new Error('remote_temp_checksum_mismatch');
    fs.renameSync(tmp, file);
    return { fileId: sha256(file + ':' + hash).slice(0, 32), hash, path: file };
  }

  quarantineCorrupt(centerId, branchId, remotePath, reason, rawText) {
    const qDir = this.quarantineDir(centerId, branchId);
    ensureDir(qDir);
    const base = path.basename(remotePath || 'unknown.json');
    const qPath = path.join(qDir, `${Date.now()}-${base}`);
    const body = typeof rawText === 'string' ? rawText : JSON.stringify({ reason: String(reason || 'corrupt') });
    fs.writeFileSync(qPath, body);
    if (remotePath && fs.existsSync(remotePath)) {
      try {
        fs.renameSync(remotePath, `${remotePath}.corrupt-${Date.now()}`);
      } catch {
        /* preserve */
      }
    }
    return { ok: true, quarantinePath: qPath, fileId: sha256(qPath).slice(0, 32) };
  }

  putAttachment(centerId, branchId, sha256Hex, buffer) {
    const dest = this.attachmentPath(centerId, branchId, sha256Hex);
    ensureDir(path.dirname(dest));
    const tmp = `${dest}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, dest);
    return { fileId: sha256(dest).slice(0, 32), path: dest, hash: sha256Hex };
  }

  getAttachment(centerId, branchId, sha256Hex) {
    const dest = this.attachmentPath(centerId, branchId, sha256Hex);
    if (!fs.existsSync(dest)) return null;
    return { buffer: fs.readFileSync(dest), path: dest };
  }

  getVersions(centerId, branchId) {
    return this.readJson(this.versionsPath(centerId, branchId)) || {
      schemaVersion: 1,
      formatVersion: 1,
      centerId,
      branchId,
      tables: {},
      updatedAt: null,
    };
  }

  putTable(centerId, branchId, table, revision, records, deviceId) {
    const payload = {
      centerId,
      branchId,
      table,
      revision,
      deviceId,
      updatedAt: new Date().toISOString(),
      records,
      payloadHash: sha256(JSON.stringify(records)),
    };
    const written = this.writeAtomic(this.tablePath(centerId, branchId, table), payload);
    const versions = this.getVersions(centerId, branchId);
    versions.tables[table] = {
      revision,
      checksum: payload.payloadHash,
      fileId: written.fileId,
      updatedAt: payload.updatedAt,
      lastWriter: deviceId,
    };
    versions.updatedAt = payload.updatedAt;
    this.writeAtomic(this.versionsPath(centerId, branchId), versions);
    return { ...written, payloadHash: payload.payloadHash, revision };
  }

  getTable(centerId, branchId, table) {
    return this.readJson(this.tablePath(centerId, branchId, table));
  }
}

function createDevice(options) {
  const dir = options.userDataDir;
  ensureDir(path.join(dir, 'database'));
  const dbPath = path.join(dir, 'database', 'tadawi.db');
  const db = openDatabase(dbPath);
  const sync = createSyncPlatform(db);
  let deviceStatus = options.deviceStatus || 'approved';
  const state = {
    centerId: options.centerId,
    branchId: options.branchId || 'BR-MAIN',
    deviceId: options.deviceId,
    appVersion: options.appVersion || '2.4.0',
    tables: Object.create(null),
    revisions: Object.create(null),
  };

  function setDeviceStatus(status) {
    deviceStatus = String(status || 'approved');
  }

  function canSync() {
    if (typeof options.canSync === 'function') {
      return options.canSync({ deviceId: state.deviceId, status: deviceStatus });
    }
    if (deviceStatus === 'revoked') return { ok: false, error: 'device_revoked', status: deviceStatus };
    if (deviceStatus === 'pending') return { ok: false, error: 'device_pending_approval', status: deviceStatus };
    return { ok: true, status: deviceStatus };
  }

  try {
    const rows = db.prepare(`SELECT key, value FROM sync_meta WHERE key LIKE 'table:%' OR key LIKE 'rev:%'`).all();
    for (const row of rows) {
      if (row.key.startsWith('table:')) {
        const table = row.key.slice('table:'.length);
        try {
          state.tables[table] = JSON.parse(row.value);
        } catch {
          state.tables[table] = [];
        }
      } else if (row.key.startsWith('rev:')) {
        state.revisions[row.key.slice('rev:'.length)] = Number(row.value) || 0;
      }
    }
  } catch {
    /* fresh db */
  }

  function persistTableState(table) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO sync_meta(key, value, updated_at) VALUES(?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
    ).run(`table:${table}`, JSON.stringify(state.tables[table] || []), now);
    db.prepare(
      `INSERT INTO sync_meta(key, value, updated_at) VALUES(?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
    ).run(`rev:${table}`, String(state.revisions[table] || 0), now);
  }

  function getAll(table) {
    return Array.isArray(state.tables[table]) ? state.tables[table].slice() : [];
  }

  function setAll(table, records, actorId) {
    const list = Array.isArray(records) ? records.slice() : [];
    const base = Number(state.revisions[table] || 0);
    const next = base + 1;
    const payload = JSON.stringify(list);
    const result = sync.enqueueAtomic(
      {
        center_id: state.centerId,
        branch_id: state.branchId,
        table_name: table,
        record_id: null,
        operation: 'TABLE_BUMP',
        base_revision: base,
        new_revision: next,
        payload_json: payload,
        device_id: state.deviceId,
        actor_id: actorId || state.deviceId,
      },
      () => {
        state.tables[table] = list;
        state.revisions[table] = next;
        persistTableState(table);
      }
    );
    return { ok: true, revision: next, outbox: result };
  }

  function upsertRecord(table, record, actorId) {
    const list = getAll(table);
    const idx = list.findIndex((r) => r && r.id === record.id);
    const op = idx >= 0 ? 'UPDATE' : 'CREATE';
    if (idx >= 0) list[idx] = { ...list[idx], ...record, updatedAt: new Date().toISOString() };
    else list.push({ ...record, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const base = Number(state.revisions[table] || 0);
    const next = base + 1;
    sync.enqueueAtomic(
      {
        center_id: state.centerId,
        branch_id: state.branchId,
        table_name: table,
        record_id: record.id,
        operation: op,
        base_revision: base,
        new_revision: next,
        payload_json: JSON.stringify(list),
        device_id: state.deviceId,
        actor_id: actorId || state.deviceId,
      },
      () => {
        state.tables[table] = list;
        state.revisions[table] = next;
        persistTableState(table);
      }
    );
    return { ok: true, revision: next, operation: op };
  }

  function softDeleteRecord(table, recordId, actorId) {
    const list = getAll(table);
    const idx = list.findIndex((r) => r && r.id === recordId);
    if (idx < 0) return { ok: false, error: 'not_found' };
    list[idx] = {
      ...list[idx],
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return setAll(table, list, actorId);
  }

  async function flush(remote, options = {}) {
    const gate = canSync();
    if (!gate.ok) {
      sync.audit({
        action: 'sync.push.blocked',
        center_id: state.centerId,
        branch_id: state.branchId,
        device_id: state.deviceId,
        result: 'blocked',
        metadata_json: { reason: gate.error || 'device_sync_blocked' },
      });
      return [{ ok: false, blocked: true, reason: gate.error || 'device_sync_blocked' }];
    }
    const claimed = sync.claimPending({
      branch_id: state.branchId,
      limit: 100,
      ignoreBackoff: !!options.ignoreBackoff,
    });
    const results = [];
    for (const row of claimed) {
      try {
        let records = row.payload_json ? JSON.parse(row.payload_json) : getAll(row.table_name);
        const versions = await Promise.resolve(remote.getVersions(state.centerId, state.branchId));
        const remoteMeta = versions.tables?.[row.table_name];
        const remoteRev = Number(remoteMeta?.revision || 0);
        if (remoteMeta && remoteRev > Number(row.base_revision || 0)) {
          const remoteTable = await Promise.resolve(
            remote.getTable(state.centerId, state.branchId, row.table_name)
          );
          const remoteRecords = remoteTable?.records || [];
          let opened = 0;
          for (const localRec of records) {
            if (!localRec?.id) continue;
            const rr = remoteRecords.find((x) => x && x.id === localRec.id);
            if (!rr) continue; // full-table snapshots may omit peers' unrelated rows; not a conflict by itself
            const localDeleted = !!localRec.deletedAt;
            const remoteDeleted = !!rr.deletedAt;
            if (localDeleted !== remoteDeleted || JSON.stringify(rr) !== JSON.stringify(localRec)) {
              sync.openConflict({
                center_id: state.centerId,
                branch_id: state.branchId,
                table_name: row.table_name,
                record_id: localRec.id,
                base_revision: row.base_revision,
                local_json: localRec,
                remote_json: rr,
                device_id: state.deviceId,
              });
              opened += 1;
            }
          }
          if (opened > 0) {
            sync.fail(row.event_id, 'conflict_detected_push', { maxAttempts: 99 });
            db.prepare(
              `UPDATE sync_outbox SET status='pending', last_error=?, next_attempt_at=? WHERE event_id=?`
            ).run('conflict_detected_push', new Date().toISOString(), row.event_id);
            results.push({ eventId: row.event_id, ok: false, conflict: true, opened });
            continue;
          }
          // Non-overlapping concurrent edits: union merge (local wins on same id when equal)
          const byId = new Map();
          for (const r of remoteRecords) {
            if (r?.id) byId.set(r.id, r);
          }
          for (const l of records) {
            if (l?.id) byId.set(l.id, l);
          }
          records = [...byId.values()];
          state.tables[row.table_name] = records;
          persistTableState(row.table_name);
        }
        const putRev = Math.max(Number(row.new_revision || 0), remoteRev + 1);
        const put = await Promise.resolve(
          remote.putTable(
            state.centerId,
            state.branchId,
            row.table_name,
            putRev,
            records,
            state.deviceId
          )
        );
        state.revisions[row.table_name] = putRev;
        persistTableState(row.table_name);
        sync.ack(row.event_id, put.fileId);
        sync.audit({
          action: 'sync.push.ack',
          center_id: state.centerId,
          branch_id: state.branchId,
          device_id: state.deviceId,
          entity: row.table_name,
          entity_id: row.record_id,
          result: 'ok',
          metadata_json: { remoteFileId: put.fileId, revision: putRev },
        });
        results.push({ eventId: row.event_id, ok: true, fileId: put.fileId, revision: putRev });
      } catch (err) {
        const classified = classify(err);
        sync.fail(row.event_id, err.message || String(err));
        results.push({
          eventId: row.event_id,
          ok: false,
          error: String(err.message || err),
          classified,
        });
      }
    }
    return results;
  }

  async function pull(remote) {
    const gate = canSync();
    if (!gate.ok) {
      sync.audit({
        action: 'sync.pull.blocked',
        center_id: state.centerId,
        branch_id: state.branchId,
        device_id: state.deviceId,
        result: 'blocked',
        metadata_json: { reason: gate.error || 'device_sync_blocked' },
      });
      return { versions: null, applied: [], blocked: true, reason: gate.error || 'device_sync_blocked' };
    }
    let versions;
    try {
      versions = await Promise.resolve(remote.getVersions(state.centerId, state.branchId));
    } catch (err) {
      const classified = classify(err);
      if (classified.category === 'remote_corrupt' && typeof remote.quarantineCorrupt === 'function') {
        await Promise.resolve(
          remote.quarantineCorrupt(
            state.centerId,
            state.branchId,
            remote.versionsPath?.(state.centerId, state.branchId) || 'versions.json',
            err.message,
            err.rawText
          )
        );
      }
      return {
        versions: null,
        applied: [],
        error: String(err.message || err),
        classified,
        quarantined: classified.category === 'remote_corrupt',
      };
    }
    const applied = [];
    for (const [table, meta] of Object.entries(versions.tables || {})) {
      const localRev = Number(state.revisions[table] || 0);
      const remoteRev = Number(meta.revision || 0);
      if (remoteRev <= localRev) continue;
      let remoteTable;
      try {
        remoteTable = await Promise.resolve(remote.getTable(state.centerId, state.branchId, table));
      } catch (err) {
        const classified = classify(err);
        if (classified.category === 'remote_corrupt' && typeof remote.quarantineCorrupt === 'function') {
          await Promise.resolve(
            remote.quarantineCorrupt(
              state.centerId,
              state.branchId,
              remote.tablePath?.(state.centerId, state.branchId, table) || `${table}.json`,
              err.message,
              err.rawText
            )
          );
          applied.push({ table, error: 'quarantined_corrupt', classified });
          continue;
        }
        throw err;
      }
      if (!remoteTable) continue;
      const payloadHash = remoteTable.payloadHash || sha256(JSON.stringify(remoteTable.records || []));
      const marked = sync.markRemoteApplied({
        center_id: state.centerId,
        branch_id: state.branchId,
        table_name: table,
        remote_revision: remoteRev,
        remote_file_id: meta.fileId,
        payload_hash: payloadHash,
        source_device_id: remoteTable.deviceId,
      });
      if (marked.duplicate) continue;

      const pending = sync.countByStatus(state.branchId);
      if ((pending.pending || 0) + (pending.inflight || 0) > 0 && localRev > 0) {
        const localRecords = getAll(table);
        const remoteRecords = remoteTable.records || [];
        for (const lr of localRecords) {
          const rr = remoteRecords.find((x) => x && x.id === lr.id);
          if (!rr) continue;
          if (!!lr.deletedAt !== !!rr.deletedAt || JSON.stringify(lr) !== JSON.stringify(rr)) {
            sync.openConflict({
              center_id: state.centerId,
              branch_id: state.branchId,
              table_name: table,
              record_id: lr.id,
              base_revision: localRev,
              local_json: lr,
              remote_json: rr,
              device_id: state.deviceId,
            });
          }
        }
      }

      state.tables[table] = remoteTable.records || [];
      state.revisions[table] = remoteRev;
      persistTableState(table);
      applied.push({ table, revision: remoteRev, duplicate: false });
      sync.audit({
        action: 'sync.pull.apply',
        center_id: state.centerId,
        branch_id: state.branchId,
        device_id: state.deviceId,
        entity: table,
        result: 'ok',
        metadata_json: { revision: remoteRev },
      });
    }
    return { versions, applied };
  }

  function close() {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }

  return {
    db,
    sync,
    state,
    getAll,
    setAll,
    upsertRecord,
    softDeleteRecord,
    flush,
    pull,
    close,
    dbPath,
    canSync,
    setDeviceStatus,
  };
}

module.exports = {
  FileRemote,
  createDevice,
  sha256,
};
