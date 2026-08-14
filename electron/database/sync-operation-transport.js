'use strict';

/**
 * Main-owned Google Drive operation-log transport (P0-D).
 * Renderer can only request push/pull; it cannot choose paths or payloads.
 */
const crypto = require('crypto');
const googleDrive = require('../cloud-providers/google-drive');

const PROTOCOL = 'tdw.sync.operation.v3';
const ADMIN_ROLES = new Set(['admin', 'hq_admin', 'owner']);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function safeSegment(value) {
  return String(value || '').replace(/[<>:"|?*\\/]/g, '_').trim() || 'unknown';
}

function operationRoot(centerId, branchId) {
  return `NajjarTech/centers/${safeSegment(centerId)}/branches/${safeSegment(branchId)}/sync-v3/operations`;
}

function operationPath(row) {
  return `${operationRoot(row.center_id, row.branch_id)}/${safeSegment(row.table_name)}/${safeSegment(row.event_id)}.json`;
}

function documentFromRow(row) {
  const payloadJson = String(row.payload_json || '');
  const payloadHash = String(row.payload_hash || '').toLowerCase();
  if (!['CREATE', 'UPDATE', 'DELETE'].includes(String(row.operation || '').toUpperCase())) {
    throw new Error('legacy_snapshot_event_not_publishable');
  }
  if (!payloadJson || sha256(payloadJson) !== payloadHash) throw new Error('outbox_payload_hash_mismatch');
  return {
    protocol: PROTOCOL,
    eventId: String(row.event_id),
    centerId: String(row.center_id),
    branchId: String(row.branch_id),
    tableName: String(row.table_name),
    recordId: String(row.record_id),
    operation: String(row.operation).toUpperCase(),
    baseRevision: Number(row.base_revision),
    newRevision: Number(row.new_revision),
    payloadJson,
    payloadHash,
    deviceId: String(row.device_id || ''),
    actorId: row.actor_id || null,
    createdAt: row.created_at,
  };
}

function entryFromDocument(doc) {
  if (!doc || doc.protocol !== PROTOCOL) throw new Error('sync_protocol_invalid');
  return {
    event_id: doc.eventId,
    center_id: doc.centerId,
    branch_id: doc.branchId,
    table_name: doc.tableName,
    record_id: doc.recordId,
    operation: doc.operation,
    base_revision: doc.baseRevision,
    new_revision: doc.newRevision,
    payload_json: doc.payloadJson,
    payload_hash: doc.payloadHash,
    device_id: doc.deviceId,
    actor_id: doc.actorId,
    created_at: doc.createdAt,
  };
}

function scopesForContext(context, includeOrganization) {
  const branch = String(context.branchId || '').trim();
  if (!context.centerId || !branch) throw new Error('sync_scope_required');
  const scopes = [branch];
  if (includeOrganization && branch !== '__ORG__' && ADMIN_ROLES.has(String(context.role || ''))) {
    scopes.push('__ORG__');
  }
  return scopes;
}

function createSyncOperationTransport(dbService, provider = googleDrive) {
  async function pushScope(context, branchId, limit) {
    const scoped = { ...context, branchId, trusted: true };
    const claimed = dbService.syncOp({ op: 'claimPending', options: { branch_id: branchId, limit } }, scoped);
    if (!claimed?.ok) return { ok: false, branchId, error: claimed?.error || 'outbox_claim_failed', results: [] };
    const rows = claimed.rows || [];
    const results = [];
    for (const row of rows) {
      try {
        const doc = documentFromRow(row);
        const serialized = JSON.stringify(doc);
        const path = operationPath(row);
        const upload = await provider.publishImmutableJson(path, serialized, sha256(serialized));
        if (!upload?.ok) throw new Error(upload?.error || upload?.message || 'operation_upload_failed');
        const verify = await provider.downloadBackup(path);
        if (!verify?.ok) throw new Error(verify?.error || verify?.message || 'operation_readback_failed');
        let remote;
        try { remote = JSON.parse(String(verify.text || verify.payload || '')); }
        catch { throw new Error('operation_readback_json_invalid'); }
        if (remote.eventId !== doc.eventId || remote.payloadHash !== doc.payloadHash
          || sha256(String(remote.payloadJson || '')) !== doc.payloadHash) {
          throw new Error('operation_readback_mismatch');
        }
        dbService.syncOp({ op: 'ack', eventId: row.event_id, remoteFileId: upload.id || null }, scoped);
        results.push({ ok: true, eventId: row.event_id, path, duplicate: !!upload.duplicate });
      } catch (error) {
        dbService.syncOp({ op: 'fail', eventId: row.event_id, error: error.message || String(error) }, scoped);
        results.push({ ok: false, eventId: row.event_id, error: error.message || String(error) });
      }
    }
    return { ok: results.every((item) => item.ok), branchId, claimed: rows.length, results };
  }

  async function pushPending(context, options = {}) {
    const scopes = scopesForContext(context, options.includeOrganization !== false);
    const results = [];
    for (const branchId of scopes) results.push(await pushScope(context, branchId, Math.min(200, Number(options.limit) || 50)));
    return {
      ok: results.every((item) => item.ok),
      protocol: PROTOCOL,
      published: results.reduce((sum, item) => sum + item.results.filter((row) => row.ok).length, 0),
      scopes: results,
    };
  }

  async function pullScope(context, branchId) {
    const scoped = { ...context, branchId, trusted: true };
    const root = operationRoot(context.centerId, branchId);
    const inventory = await provider.listOperationFiles(root);
    if (!inventory?.ok) return { ok: false, branchId, error: inventory?.error || 'operation_list_failed', results: [] };
    const results = [];
    let latestCursor = null;
    for (const item of inventory.items || []) {
      const cursor = `${item.modifiedAt || ''}|${item.path || ''}`;
      if (!latestCursor || cursor > latestCursor) latestCursor = cursor;
      try {
        const downloaded = await provider.downloadBackup(item.path);
        if (!downloaded?.ok) throw new Error(downloaded?.error || downloaded?.message || 'operation_download_failed');
        let doc;
        try { doc = JSON.parse(String(downloaded.text || downloaded.payload || '')); }
        catch { throw new Error('operation_json_invalid'); }
        if (doc.centerId !== context.centerId || doc.branchId !== branchId) throw new Error('operation_scope_mismatch');
        const applied = dbService.applyRemoteOperation(entryFromDocument(doc), scoped);
        if (!applied?.ok) throw new Error(applied?.error || 'operation_apply_failed');
        results.push({ ok: true, path: item.path, ...applied });
      } catch (error) {
        results.push({ ok: false, path: item.path, error: error.message || String(error) });
      }
    }
    if (latestCursor) {
      dbService.syncOp({ op: 'metaSet', key: 'operationPullCursor', value: latestCursor }, scoped);
    }
    return { ok: results.every((item) => item.ok), branchId, scanned: inventory.items?.length || 0, cursor: latestCursor, results };
  }

  async function pullRemote(context, options = {}) {
    const scopes = scopesForContext(context, options.includeOrganization !== false);
    const results = [];
    for (const branchId of scopes) results.push(await pullScope(context, branchId));
    return {
      ok: results.every((item) => item.ok),
      protocol: PROTOCOL,
      applied: results.reduce((sum, item) => sum + item.results.filter((row) => row.ok && row.status === 'applied').length, 0),
      conflicts: results.reduce((sum, item) => sum + item.results.filter((row) => row.status === 'conflict').length, 0),
      scopes: results,
    };
  }

  return { PROTOCOL, pushPending, pullRemote, documentFromRow, entryFromDocument, operationRoot };
}

module.exports = { createSyncOperationTransport, PROTOCOL, documentFromRow, entryFromDocument, operationRoot };
