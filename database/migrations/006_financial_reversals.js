'use strict';

module.exports = {
  id: '006_financial_reversals',
  version: 9,
  backupLabel: 'pre-p0e-financial-reversals',
  sql: `
DROP INDEX IF EXISTS uq_visits_scoped_invoice;
CREATE UNIQUE INDEX IF NOT EXISTS uq_visits_scoped_invoice
  ON visits(center_id, branch_id, invoice)
  WHERE COALESCE(json_extract(payload_json, '$.sharedRole'), 'primary') <> 'partner';

CREATE TABLE IF NOT EXISTS financial_reversals (
  reversal_id TEXT PRIMARY KEY,
  original_transaction_id TEXT NOT NULL UNIQUE,
  center_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  reversed_at TEXT NOT NULL,
  actor_id TEXT,
  FOREIGN KEY(original_transaction_id) REFERENCES financial_transactions(transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_financial_reversals_scope
  ON financial_reversals(center_id, branch_id, reversed_at);

INSERT INTO meta(key, value) VALUES('financialReversalVersion', '1')
ON CONFLICT(key) DO UPDATE SET value=excluded.value;
`,
};
