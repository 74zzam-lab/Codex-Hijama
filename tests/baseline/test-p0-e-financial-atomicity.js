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

const checks = [];
async function check(name, fn) {
  try { await fn(); checks.push({ name, ok: true }); console.log(`PASS  ${name}`); }
  catch (error) { checks.push({ name, ok: false, error: error.message }); console.error(`FAIL  ${name}: ${error.message}`); }
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdw-p0e-fin-'));
  const service = loadService(dir);
  const db = service.ensureDb();
  const base = { centerId: 'CTR-FIN', branchId: 'BR-A', actorId: 'USER-1', deviceId: 'DEVICE-A' };
  assert.equal(service.command({
    commandId: 'client-fin', entity: 'clientsRegistry', action: 'upsert',
    record: { id: 'CLIENT-FIN', name: 'Client' },
  }, base).ok, true);
  assert.equal(service.command({
    commandId: 'doctor-fin', entity: 'doctors', action: 'upsert',
    record: { id: 'DOC-1', name: 'Doctor' },
  }, base).ok, true);

  function financialRequest(id, overrides = {}) {
    return {
      transactionId: `TX-${id}-00000000`,
      caseRecord: {
        id, clientRegistryId: 'CLIENT-FIN', name: 'Client', doctorId: 'DOC-1',
        date: '2026-08-10', total: 115, preTax: 100, vat: 15,
        cash: 15, card: 100, foreignSarEquiv: 0, changeReturned: 0,
        commission: 10, cups: 5, ...overrides,
      },
      effects: [{ entity: 'inventoryMovements', records: [{
        id: `MOVE-${id}`, itemId: 'CUP', delta: -5, refId: id,
      }] }],
    };
  }

  await check('AT-FIN-001 case, invoice, payments, stock, cash, audit, ledger and outbox commit together', () => {
    const result = service.commitFinancialCase(financialRequest('CASE-OK'), base);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.match(result.invoiceNumber, /^TM-2026-\d{6}-[A-F0-9]{4}$/);
    for (const [table, where] of [
      ['visits', "id='CASE-OK'"], ['invoices', "visit_id='CASE-OK'"],
      ['payments', "visit_id='CASE-OK'"], ['financial_transactions', "case_id='CASE-OK'"],
    ]) assert.ok(db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${where}`).get().c > 0, table);
    for (const entity of ['inventoryMovements', 'cashMovements', 'financialPostings', 'auditEvents', 'employeeLedgerEntries']) {
      assert.ok(db.prepare('SELECT COUNT(*) c FROM p0b_entities WHERE entity_type=?').get(entity).c > 0, entity);
    }
    assert.ok(db.prepare("SELECT COUNT(*) c FROM sync_outbox WHERE record_id='CASE-OK'").get().c > 0);
  });

  await check('AT-FIN-001 every injected transaction step rolls back all data and invoice sequence', () => {
    for (let step = 1; step <= 6; step += 1) {
      const id = `FAIL-${step}`;
      const beforeSequence = db.prepare("SELECT next_value FROM invoice_sequences WHERE center_id=? AND branch_id=? AND year=2026 AND device_id=?")
        .get(base.centerId, base.branchId, base.deviceId)?.next_value;
      const result = service.commitFinancialCase(financialRequest(id), { ...base, trusted: true, failAfterStep: step });
      assert.equal(result.ok, false, `step ${step}`);
      assert.equal(result.rolledBack, true);
      assert.equal(db.prepare('SELECT COUNT(*) c FROM visits WHERE id=?').get(id).c, 0);
      assert.equal(db.prepare('SELECT COUNT(*) c FROM financial_transactions WHERE case_id=?').get(id).c, 0);
      assert.equal(db.prepare('SELECT COUNT(*) c FROM sync_outbox WHERE record_id=?').get(id).c, 0);
      const afterSequence = db.prepare("SELECT next_value FROM invoice_sequences WHERE center_id=? AND branch_id=? AND year=2026 AND device_id=?")
        .get(base.centerId, base.branchId, base.deviceId)?.next_value;
      assert.equal(afterSequence, beforeSequence, `sequence rollback ${step}`);
    }
  });

  await check('AT-FIN-002 scoped database sequence and device tag prevent duplicate invoice numbers', () => {
    const numbers = new Set();
    for (let i = 0; i < 30; i += 1) {
      const context = { ...base, deviceId: i % 2 ? 'DEVICE-A' : 'DEVICE-B' };
      const result = service.commitFinancialCase(financialRequest(`SEQ-${i}`, { total: 10, cash: 10, card: 0, vat: 0, preTax: 10 }), context);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(numbers.has(result.invoiceNumber), false, result.invoiceNumber);
      numbers.add(result.invoiceNumber);
    }
    assert.equal(numbers.size, 30);
  });

  await check('AT-FIN-003 payment methods reconcile to the cent and never infer missing cash', () => {
    const valid = [
      { total: 10, cash: 10, card: 0 },
      { total: 10, cash: 0, card: 10 },
      { total: 10, cash: 5, card: 5 },
      { total: 10, cash: 12, card: 0, changeReturned: 2 },
      { total: 10, cash: 0, card: 0, foreignSarEquiv: 10 },
      { total: 10.01, cash: 5, card: 5.01 },
    ];
    valid.forEach((payments, index) => {
      const result = service.commitFinancialCase(financialRequest(`PAY-OK-${index}`, { vat: 0, preTax: payments.total, ...payments }), base);
      assert.equal(result.ok, true, `${JSON.stringify(payments)} => ${JSON.stringify(result)}`);
    });
    const invalid = [
      { total: 10, cash: 0, card: 0 },
      { total: 10, cash: 9.98, card: 0 },
      { total: 10, cash: 5, card: 0, changeReturned: 6 },
      { total: 10, cash: -1, card: 11 },
    ];
    invalid.forEach((payments, index) => {
      const result = service.commitFinancialCase(financialRequest(`PAY-BAD-${index}`, { vat: 0, preTax: payments.total, foreignSarEquiv: 0, changeReturned: 0, ...payments }), base);
      assert.equal(result.ok, false, JSON.stringify(payments));
      assert.match(result.error, /payment_not_reconciled|financial_amount_invalid/);
    });
  });

  await check('posted financial records reject direct overwrite and require reversal semantics', () => {
    const request = financialRequest('CASE-OK', { total: 1, cash: 1, card: 0 });
    request.transactionId = 'TX-CASE-OK-SECOND-0000';
    const result = service.commitFinancialCase(request, base);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'financial_record_immutable_use_reversal');
    const direct = service.command({
      commandId: 'direct-overwrite-posted', entity: 'cases', action: 'upsert',
      record: { id: 'CASE-OK', total: 1 },
    }, base);
    assert.equal(direct.ok, false);
    assert.equal(direct.error, 'financial_record_immutable_use_reversal');
  });

  await check('shared visits post once and authorized void creates complete append-only reversal', () => {
    const request = financialRequest('SHARED-PRIMARY', { total: 40, cash: 20, card: 20, commission: 4 });
    request.relatedCaseRecords = [{
      id: 'SHARED-PARTNER', clientRegistryId: 'CLIENT-FIN', name: 'Partner', doctorId: 'DOC-1',
      date: '2026-08-10', total: 0, cash: 0, card: 0, commission: 3, cups: 2,
      isSharedVisit: true, sharedSessionId: 'SHARED-PRIMARY', sharedRole: 'partner',
    }];
    const posted = service.commitFinancialCase(request, base);
    assert.equal(posted.ok, true, JSON.stringify(posted));
    assert.equal(posted.relatedCaseRecords.length, 1);
    assert.equal(posted.relatedCaseRecords[0].invoice, posted.invoiceNumber);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM visits WHERE id IN ('SHARED-PRIMARY','SHARED-PARTNER')").get().c, 2);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM financial_transactions WHERE invoice_number=?').get(posted.invoiceNumber).c, 1);

    const reversed = service.voidFinancialCase({
      reversalId: 'REV-SHARED-PRIMARY-0001', caseId: 'SHARED-PRIMARY', reason: 'customer cancellation',
    }, base);
    assert.equal(reversed.ok, true, JSON.stringify(reversed));
    assert.equal(reversed.voidedCases.length, 2);
    assert.equal(db.prepare("SELECT status FROM financial_transactions WHERE case_id='SHARED-PRIMARY'").get().status, 'voided');
    assert.equal(db.prepare("SELECT COUNT(*) c FROM financial_reversals WHERE case_id='SHARED-PRIMARY'").get().c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM visits WHERE id IN ('SHARED-PRIMARY','SHARED-PARTNER')").get().c, 2);
    assert.ok(reversed.reversalCash.some((row) => row.amount < 0));
    const again = service.voidFinancialCase({
      reversalId: 'REV-SHARED-PRIMARY-0002', caseId: 'SHARED-PRIMARY', reason: 'duplicate cancellation',
    }, base);
    assert.equal(again.ok, true);
    assert.equal(again.alreadyVoided, true);
  });

  await check('renderer primary save path invokes only the atomic financial command', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
    const start = source.indexOf('async function saveCase()');
    const end = source.indexOf('function collectExtraServicesFromForm()', start);
    const saveCase = source.slice(start, end);
    assert.match(saveCase, /commitFinancialCase/);
    assert.doesNotMatch(saveCase, /persistData\('cases'/);
    assert.doesNotMatch(saveCase, /deductInventoryForCase\(c\)/);
    assert.doesNotMatch(saveCase, /onCasePaymentRecorded\(c\)/);
    for (const [name, next] of [
      ['async function saveSharedPackageCase()', 'async function deleteCase('],
      ['async function saveOldCase()', '// ═'],
    ]) {
      const blockStart = source.indexOf(name);
      const blockEnd = source.indexOf(next, blockStart + name.length);
      const block = source.slice(blockStart, blockEnd);
      assert.match(block, /commitFinancialCase/, name);
      assert.doesNotMatch(block, /persistData\('cases'/, name);
      assert.doesNotMatch(block, /persistData\('invoiceCounter'/, name);
    }
    const deleteStart = source.indexOf('async function deleteCase(');
    const deleteEnd = source.indexOf('function todayCases()', deleteStart);
    const deleteBlock = source.slice(deleteStart, deleteEnd);
    assert.match(deleteBlock, /voidFinancialCase/);
    assert.doesNotMatch(deleteBlock, /cases = cases\.filter/);
  });

  service.close();
  fs.rmSync(dir, { recursive: true, force: true });
  const failed = checks.filter((row) => !row.ok);
  if (failed.length) { console.error(`P0-E financial atomicity FAIL: ${failed.length}/${checks.length}`); process.exit(1); }
  console.log(`P0-E financial atomicity PASS: ${checks.length}/${checks.length}`);
})().catch((error) => { console.error(error); process.exit(1); });
