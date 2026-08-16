#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${name} is unterminated`);
}

const sandbox = {
  currentUser: { id: 'OWNER', role: 'owner' },
  BranchContexts: { getSelectedReportingBranch: () => 'BR-A' },
  BranchScope: {
    getActiveBranchId: () => 'BR-A',
    isAggregateBranchView: () => false,
    filterByBranch: (rows, branchId) => rows.filter((row) => row.branchId === branchId),
  },
  RolePolicy: { isOrganizationOwner: () => true },
  getUiScopedRecords: (rows) => rows.filter((row) => row.branchId === 'BR-A'),
  Object,
};
vm.runInNewContext(`${extractFunction('getExplicitReportScope')};this.scopeFn=getExplicitReportScope;`, sandbox);
const records = [
  { id: 'A1', branchId: 'BR-A', total: 10 },
  { id: 'A2', branchId: 'BR-A', total: 20, financialStatus: 'voided' },
  { id: 'B1', branchId: 'BR-B', total: 30 },
];
let scoped = sandbox.scopeFn(records, 'vat');
assert.deepEqual(Array.from(scoped.records, (row) => row.id), ['A1']);
assert.equal(scoped.branchId, 'BR-A');
assert.equal(scoped.aggregate, false);

sandbox.BranchScope.isAggregateBranchView = () => true;
scoped = sandbox.scopeFn(records, 'owner-report');
assert.deepEqual(Array.from(scoped.records, (row) => row.id), ['A1', 'B1']);
assert.equal(scoped.branchId, '__ALL_AUTHORIZED__');
assert.equal(scoped.aggregate, true);

for (const name of ['getRepFilteredCases', 'generateDoctorReport', 'getVatFilteredTaxCases', 'generatePayroll']) {
  assert.match(extractFunction(name), /getExplicitReportScope/, `${name} consumes explicit branch scope`);
}
const printStart = source.indexOf("else if (type === 'doctors')");
const payrollStart = source.indexOf("else if (type === 'payroll')", printStart);
const attendanceStart = source.indexOf("else if (type === 'attendance')", payrollStart);
const doctorPrint = source.slice(printStart, payrollStart);
const payrollPrint = source.slice(payrollStart, attendanceStart);
assert.match(doctorPrint, /getExplicitReportScope\(cases, 'doctors_print'\)/);
assert.doesNotMatch(doctorPrint, /dc_cases\s*=\s*cases/);
assert.match(payrollPrint, /window\._payrollReportDocument/);
assert.doesNotMatch(payrollPrint, /const mc\s*=\s*cases\.filter/);
assert.match(extractFunction('printAttSheet'), /getExplicitReportScope\(DB\.get\('attendance'/);

console.log('P0-E report correctness PASS: explicit branch context, void exclusion, owner aggregate label, shared payroll preview/print document');
