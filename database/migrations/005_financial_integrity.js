'use strict';

module.exports = {
  id: '005_financial_integrity',
  version: 8,
  backupLabel: 'pre-p0e-financial-integrity',
  sql: `
CREATE TABLE IF NOT EXISTS invoice_sequences (
  center_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  next_value INTEGER NOT NULL CHECK(next_value >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(center_id, branch_id, year, device_id)
);

CREATE TABLE IF NOT EXISTS financial_transactions (
  transaction_id TEXT PRIMARY KEY,
  center_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  total_minor INTEGER NOT NULL CHECK(total_minor >= 0),
  payment_minor INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('posted','voided','adjusted')),
  payload_json TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  UNIQUE(center_id, branch_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_case
  ON financial_transactions(center_id, branch_id, case_id);

CREATE TABLE IF NOT EXISTS financial_integrity_exceptions (
  exception_id TEXT PRIMARY KEY,
  center_id TEXT,
  branch_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  reason TEXT NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','accepted')),
  detected_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS payroll_run_control (
  center_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('draft','finalized','reversed')),
  calculation_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  finalized_at TEXT,
  PRIMARY KEY(center_id, branch_id, period_key)
);

CREATE TABLE IF NOT EXISTS payroll_adjustments (
  adjustment_id TEXT PRIMARY KEY,
  center_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  reason TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES payroll_run_control(run_id)
);

INSERT INTO meta(key, value) VALUES('financialIntegrityVersion', '1')
ON CONFLICT(key) DO UPDATE SET value=excluded.value;
`
};
