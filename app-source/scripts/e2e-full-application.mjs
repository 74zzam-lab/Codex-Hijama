#!/usr/bin/env node
/**
 * Full-application E2E harness (Node/vm + production readiness scenarios).
 * Runs all critical journey simulations without mutating production data.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const results = [];

function run(rel, label) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    results.push({ label, ok: false, detail: 'missing:' + rel });
    return;
  }
  const r = spawnSync(node, [abs], { cwd: ROOT, encoding: 'utf8', env: process.env });
  const ok = r.status === 0;
  results.push({
    label,
    ok,
    detail: ok
      ? (r.stdout || '').trim().split('\n').slice(-2).join(' | ')
      : ((r.stderr || r.stdout || '') + '').trim().split('\n').slice(-6).join('\n'),
  });
}

const suites = [
  ['scripts/scan-source-secrets.cjs', 'e2e:secret-scan'],
  ['scripts/e2e-production-readiness.mjs', 'e2e:production-readiness'],
  ['tests/baseline/test-p0-a-security-boundary.js', 'e2e:security-boundary'],
  ['tests/baseline/test-p0-c-setup-restore-target.js', 'e2e:setup-restore-target'],
  ['tests/baseline/test-p0-c-restore-truth-and-boot-gate.js', 'e2e:restore-boot-gate'],
  ['tests/baseline/test-p0-c-discovery-integrity.js', 'e2e:discovery-integrity'],
  ['tests/baseline/test-current-setup-restore-runtime.js', 'e2e:setup-restore-runtime'],
  ['tests/baseline/test-current-restore-license-login.js', 'e2e:restore-license-login'],
  ['tests/baseline/test-current-legacy-cloud-restore-runtime.js', 'e2e:legacy-cloud-restore'],
  ['tests/baseline/test-p0-d-operation-sync.js', 'e2e:operation-sync'],
  ['tests/baseline/test-p0-e-runtime-license-immutability.js', 'e2e:license-immutability'],
  ['tests/baseline/test-p0-e-financial-atomicity.js', 'e2e:financial-atomicity'],
  ['tests/baseline/test-hybrid-backup-v2.js', 'e2e:backup-v2'],
  ['tests/backup/backup-restore-v2.test.js', 'e2e:backup-restore-v2'],
  ['tests/baseline/test-legacy-v5-license-runtime.js', 'e2e:legacy-v5-runtime'],
  ['tests/baseline/test-legacy-v5-generator-isolation.js', 'e2e:legacy-v5-generator'],
  ['scripts/verify-google-oauth-config.js', 'e2e:oauth-structure'],
];

for (const [file, label] of suites) run(file, label);

let failed = 0;
console.log('══ Full Application E2E ══\n');
for (const row of results) {
  const mark = row.ok ? 'PASS' : 'FAIL';
  if (!row.ok) failed += 1;
  console.log(`${mark}  ${row.label}`);
  if (!row.ok && row.detail) console.log(row.detail.split('\n').map((l) => '      ' + l).join('\n'));
}
console.log(`\nSummary: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
