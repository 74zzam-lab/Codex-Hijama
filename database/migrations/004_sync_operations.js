'use strict';

module.exports = {
  id: '004_sync_operations',
  version: 7,
  backupLabel: 'pre-p0d-sync-operations',
  sql: `
CREATE TABLE IF NOT EXISTS sync_operations_applied (
  event_id TEXT PRIMARY KEY,
  center_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  new_revision INTEGER NOT NULL,
  payload_hash TEXT NOT NULL,
  source_device_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('applied','stale','conflict')),
  applied_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_operations_scope
  ON sync_operations_applied(center_id, branch_id, applied_at);

CREATE TABLE IF NOT EXISTS sync_tombstones (
  center_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  deleted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(center_id, branch_id, table_name, record_id)
);
CREATE INDEX IF NOT EXISTS idx_sync_tombstones_retention
  ON sync_tombstones(expires_at);

-- Snapshot events cannot be replayed safely after the per-record cutover. Keep
-- them visible for operator reconciliation instead of silently overwriting a peer.
UPDATE sync_outbox
SET status='dead-letter',
    last_error='p0d_legacy_table_bump_reconciliation_required'
WHERE operation='TABLE_BUMP' AND status IN ('pending','inflight','sent');

INSERT INTO meta(key, value) VALUES('syncPublicationModel', 'immutable-operation-v3')
ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO meta(key, value) VALUES('legacySnapshotCutoverRequired',
  CASE WHEN EXISTS(
    SELECT 1 FROM sync_outbox
    WHERE operation='TABLE_BUMP' AND last_error='p0d_legacy_table_bump_reconciliation_required'
  ) THEN 'true' ELSE 'false' END)
ON CONFLICT(key) DO UPDATE SET value=excluded.value;
`
};
