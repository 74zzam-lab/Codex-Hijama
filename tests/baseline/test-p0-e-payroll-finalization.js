#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

function loadService(userData) {
  const original = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return { app: { getPath: () => userData } };
    return original.call(this, request, parent, isMain);
  };
  const target = require.resolve('../../electron/database/service');
  delete require.cache[target];
  try { return require(target); } finally { Module._load = original; }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdw-p0e-payroll-'));
const context = { centerId: 'CTR-PAY', branchId: 'BR-A', actorId: 'OWNER', deviceId: 'DEVICE-A' };
let service = loadService(dir);
let db = service.ensureDb();
const request = {
  runId: 'PAYROLL:2026-08:RUN-0001',
  periodKey: '2026-08',
  rows: [
    { employeeId: 'EMP-1', employeeName: 'A', gross: 10000, deductions: 500, net: 9500 },
    { employeeId: 'EMP-2', employeeName: 'B', gross: 8000, deductions: 250, net: 7750 },
  ],
};
const finalized = service.finalizePayrollRun(request, context);
assert.equal(finalized.ok, true, JSON.stringify(finalized));
assert.equal(finalized.status, 'finalized');
assert.equal(finalized.totals.netMinor, 1725000);
assert.equal(db.prepare('SELECT COUNT(*) c FROM payroll_run_control').get().c, 1);
assert.equal(service.finalizePayrollRun(request, context).replayed, true);

const changed = service.finalizePayrollRun({
  ...request, runId: 'PAYROLL:2026-08:RUN-0002',
  rows: [{ employeeId: 'EMP-1', gross: 1, deductions: 0, net: 1 }],
}, context);
assert.equal(changed.ok, false);
assert.equal(changed.error, 'payroll_period_finalized_immutable');

const bad = service.finalizePayrollRun({
  runId: 'PAYROLL:2026-09:RUN-0001', periodKey: '2026-09',
  rows: [{ employeeId: 'EMP-1', gross: 100, deductions: 20, net: 90 }],
}, context);
assert.equal(bad.ok, false);
assert.equal(bad.error, 'payroll_row_not_reconciled');

const adjustment = service.adjustFinalizedPayroll({
  adjustmentId: 'PAYADJ:2026-08:0001', runId: request.runId, employeeId: 'EMP-1',
  amount: -100, reason: 'approved correction',
}, context);
assert.equal(adjustment.ok, true, JSON.stringify(adjustment));
assert.equal(adjustment.amountMinor, -10000);
assert.equal(db.prepare('SELECT COUNT(*) c FROM payroll_adjustments').get().c, 1);
assert.equal(db.prepare("SELECT status FROM payroll_run_control WHERE run_id=?").get(request.runId).status, 'finalized');
assert.equal(service.adjustFinalizedPayroll({
  adjustmentId: 'PAYADJ:2026-08:0002', runId: request.runId, employeeId: 'EMP-1',
  amount: 10, reason: 'wrong branch',
}, { ...context, branchId: 'BR-B' }).error, 'finalized_payroll_run_not_found');

service.close();
service = loadService(dir);
db = service.ensureDb();
assert.equal(db.prepare("SELECT status FROM payroll_run_control WHERE run_id=?").get(request.runId).status, 'finalized');
assert.equal(db.prepare('SELECT COUNT(*) c FROM payroll_adjustments').get().c, 1);

const ledgerSource = fs.readFileSync(path.join(__dirname, '..', '..', 'cupping-employee-ledger.js'), 'utf8');
assert.match(ledgerSource, /finalizePayrollRun/);
assert.match(ledgerSource, /adjustFinalizedPayroll/);
assert.match(ledgerSource, /مسير الرواتب النهائي غير قابل لإعادة الفتح/);

service.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('P0-E payroll finalization PASS: immutable final run, explicit adjustment, branch isolation, restart persistence');
