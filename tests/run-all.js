#!/usr/bin/env node
'use strict';

/**
 * Unified test runner for Phase 1+.
 * Runs baseline suites first, then existing verify:* critical scripts.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const results = [];

function runNode(relPath, label) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) {
    results.push({ label, ok: false, detail: 'missing file ' + relPath });
    return;
  }
  const r = spawnSync(process.execPath, [abs], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });
  const ok = r.status === 0;
  let detail = ok
    ? (r.stdout || '').trim().split('\n').slice(-2).join(' | ')
    : ((r.stderr || r.stdout || '') + '').trim().split('\n').slice(-6).join('\n');
  if (!ok && !detail) {
    detail = [
      `exitStatus=${r.status}`,
      `signal=${r.signal || ''}`,
      `spawnError=${r.error ? r.error.message : ''}`,
    ].join(' ');
  }
  results.push({ label, ok, detail });
}

console.log('══ Tadawi Phase-1 Test Runner ══\n');

const baseline = [
  ['tests/baseline/test-p0-a-security-boundary.js', 'p0-a:security-boundary'],
  ['tests/baseline/test-p0-b-authority-branch-isolation.js', 'p0-b:authority-branch-isolation'],
  ['tests/baseline/test-p0-c-discovery-integrity.js', 'p0-c:discovery-integrity'],
  ['tests/baseline/test-p0-c-setup-activation.js', 'p0-c:setup-activation'],
  ['tests/baseline/test-p0-c-setup-restore-target.js', 'p0-c:setup-restore-target'],
  ['tests/baseline/test-p0-c-restore-truth-and-boot-gate.js', 'p0-c:restore-truth-boot-gate'],
  ['tests/baseline/test-stage-2-ready-pure.js', 'stage-2:ready-pure'],
  ['tests/baseline/test-stage-3-no-auto-boot.js', 'stage-3:no-auto-boot'],
  ['tests/baseline/test-stage-4-bootstrap-coordinator-state.js', 'stage-4:coordinator-state'],
  ['tests/baseline/test-stage-5-bootstrap-gate-map.js', 'stage-5:gate-map'],
  ['tests/baseline/test-stage-6-activation-before-google.js', 'stage-6:activation-first'],
  ['tests/baseline/test-stage-7-explicit-discovery-gate.js', 'stage-7:explicit-discovery-gate'],
  ['tests/baseline/test-stage-8-explicit-new-existing-fork.js', 'stage-8:explicit-new-existing-fork'],
  ['tests/baseline/test-stage-9-owner-before-first-branch.js', 'stage-9:owner-before-first-branch'],
  ['tests/baseline/test-stage-10-owner-seed-retirement.js', 'stage-10:owner-seed-retirement'],
  ['tests/baseline/test-stage-11-explicit-device-step.js', 'stage-11:explicit-device-step'],
  ['tests/baseline/test-stage-12-business-setup-gate.js', 'stage-12:business-setup-gate'],
  ['tests/baseline/test-stage-13-publication-gate.js', 'stage-13:publication-gate'],
  ['tests/baseline/test-stage-14-readback-hardening.js', 'stage-14:readback-hardening'],
  ['tests/baseline/test-stage-15-initial-sync-direction.js', 'stage-15:initial-sync-direction'],
  ['tests/baseline/test-stage-16-existing-short-path.js', 'stage-16:existing-short-path'],
  ['tests/baseline/test-stage-17-bootstrap-checklist-ui.js', 'stage-17:bootstrap-checklist-ui'],
  ['tests/baseline/test-stage-18-bootstrap-failure-policy.js', 'stage-18:bootstrap-failure-policy'],
  ['tests/baseline/test-p0-c-owner-credential-merge.js', 'p0-c:owner-credential-merge'],
  ['tests/baseline/test-p0-c-credential-publication.js', 'p0-c:credential-publication'],
  ['tests/baseline/test-p0-c-setup-owner-session.js', 'p0-c:setup-owner-session'],
  ['tests/baseline/test-p0-c-google-state-recovery.js', 'p0-c:google-state-recovery'],
  ['tests/baseline/test-current-restore-license-login.js', 'current:restore-license-login'],
  ['tests/baseline/test-current-setup-restore-runtime.js', 'current:setup-restore-runtime'],
  ['tests/baseline/test-current-legacy-cloud-restore-runtime.js', 'current:legacy-cloud-restore-runtime'],
  ['tests/baseline/test-p0-d-operation-sync.js', 'p0-d:operation-sync'],
  ['tests/baseline/test-p0-e-financial-atomicity.js', 'p0-e:financial-atomicity'],
  ['tests/baseline/test-p0-e-backup-secret.js', 'p0-e:backup-secret'],
  ['tests/baseline/test-p0-e-licensing-production.js', 'p0-e:licensing-production'],
  ['tests/baseline/test-p0-e-runtime-license-immutability.js', 'p0-e:runtime-license-immutability'],
  ['tests/baseline/test-p0-e-payroll-finalization.js', 'p0-e:payroll-finalization'],
  ['tests/baseline/test-p0-e-report-scope.js', 'p0-e:report-scope'],
  ['tests/baseline/test-data-sync-restore-hardening.js', 'hardening:data-sync-restore'],
  ['tests/baseline/test-entities-finance.js', 'baseline:entities+finance'],
  ['tests/baseline/test-tax-golden.js', 'baseline:tax'],
  ['tests/baseline/test-backup-crypto.js', 'baseline:backup-crypto'],
  ['tests/baseline/test-license-read.js', 'baseline:license-read'],
  ['tests/baseline/test-electron-security-snapshot.js', 'baseline:electron-security'],
  ['tests/baseline/test-phase2-electron-security.js', 'phase2:electron-security'],
  ['tests/baseline/test-phase3-licensing-v6.js', 'phase3:licensing-v6'],
  ['tests/baseline/test-license-builder-v6-runtime.js', 'licensing:v6-builder-runtime'],
  ['tests/baseline/test-legacy-v5-license-runtime.js', 'licensing:legacy-v5-runtime'],
  ['tests/baseline/test-legacy-v5-generator-isolation.js', 'licensing:legacy-v5-generator-isolation'],
  ['tests/baseline/test-legacy-license-admin-persistence.js', 'licensing:legacy-admin-persistence'],
  ['tests/baseline/test-license-vault-proxy.js', 'licensing:sheets-vault-proxy'],
  ['tests/baseline/test-phase4-sqlite.js', 'phase4:sqlite'],
  ['tests/baseline/test-phase6-permissions.js', 'phase6:permissions'],
  ['tests/baseline/test-phase7-backup.js', 'phase7:backup'],
  ['tests/baseline/test-phase8-dev-panel.js', 'phase8:dev-panel'],
  ['tests/baseline/test-phase9-branding-consistency.js', 'phase9:branding-consistency'],
  ['tests/baseline/test-phase10-wizard-tour.js', 'phase10:wizard-tour'],
  ['tests/baseline/test-phase11-booking-statuses.js', 'phase11:booking-statuses'],
  ['tests/baseline/test-phase12-build.js', 'phase12:build'],
  ['tests/baseline/test-phase13-electron-readiness.js', 'phase13:electron-readiness'],
  ['tests/baseline/test-phase14-final-gate.js', 'phase14:final-gate'],
  ['tests/baseline/test-phase15-rc-gate.js', 'phase15:rc-gate'],
  ['tests/baseline/test-phase16-code-freeze-gate.js', 'phase16:code-freeze-gate'],
  ['tests/baseline/test-phase17-release-evidence.js', 'phase17:release-evidence'],
  ['tests/baseline/test-phase18-multibranch-cloud.js', 'phase18:multibranch-cloud'],
  ['tests/baseline/test-phase19-owner-hub.js', 'phase19:owner-hub'],
  ['tests/baseline/test-phase20-production-release.js', 'phase20:production-release'],
  ['tests/baseline/test-phase21-organization-facade.js', 'phase21:organization-facade'],
  ['tests/baseline/test-phase22-owner-policy.js', 'phase22:owner-policy'],
  ['tests/baseline/test-phase23-owner-profile-store.js', 'phase23:owner-profile-store'],
  ['tests/baseline/test-phase24-owner-activation-flag.js', 'phase24:owner-activation-flag'],
  ['tests/baseline/test-phase25-owner-setup-gate.js', 'phase25:owner-setup-gate'],
  ['tests/baseline/test-phase26-device-limits.js', 'phase26:device-limits'],
  ['tests/baseline/test-phase27-owner-hub-device-branch-controls.js', 'phase27:ownerhub-controls'],
  ['tests/baseline/test-phase28-branch-gate.js', 'phase28:branch-gate'],
  ['tests/baseline/test-phase30-owner-branch-mode.js', 'phase30:owner-branch-mode'],
  ['tests/baseline/test-phase31-owner-audit-expansion.js', 'phase31:owner-audit-expansion'],
  ['tests/baseline/test-phase32-ownerhub-licensing-panel.js', 'phase32:ownerhub-licensing-panel'],
  ['tests/baseline/test-phase33-branch-summary-contract.js', 'phase33:branch-summary-contract'],
  ['tests/baseline/test-phase34-nextgen-freeze-gate.js', 'phase34:nextgen-freeze-gate'],
  ['tests/baseline/test-phase35-backup-org-branch-metadata.js', 'phase35:backup-org-branch-metadata'],
  ['tests/baseline/test-phase36-compat-matrix.js', 'phase36:compat-matrix'],
  ['tests/baseline/test-phase37-legacy-owner-migration.js', 'phase37:legacy-owner-migration'],
  ['tests/baseline/test-phase38-nextgen-final-gate.js', 'phase38:nextgen-final-gate'],
  ['tests/baseline/test-phase39-license-drive-push.js', 'phase39:license-drive-push'],
  ['tests/baseline/test-phase39-owner-bootstrap.js', 'phase39:owner-bootstrap'],
  ['tests/baseline/test-phase40-handover-gate.js', 'phase40:handover-gate'],
  ['tests/baseline/test-login-license-ux.js', 'ux:login-license'],
  ['tests/baseline/test-licensing-google-bootstrap-flow.js', 'ux:licensing-google-bootstrap'],
  ['tests/baseline/test-vault-csp-uninstall-wipe.js', 'ux:vault-csp-uninstall-wipe'],
  ['tests/baseline/test-nsis-cupping-center-wipe.js', 'ux:nsis-cupping-center-wipe'],
  ['tests/baseline/test-hybrid-icon-packaging.js', 'hybrid:icon-packaging'],
  ['tests/baseline/test-hybrid-backup-v2.js', 'hybrid:backup-v2'],
  ['tests/backup/backup-restore-v2.test.js', 'v2-5.1:backup-restore-v2'],
  ['tests/backup/backup-sync-harden-v2.test.js', 'v2-5.2:backup-sync-harden'],
  ['tests/baseline/test-v2-5-3-owner-identity-license.js', 'v2-5.3:owner-identity-license'],
  ['scripts/v2-5-3-scenarios-all.cjs', 'v2-5.3:scenarios'],
  ['scripts/windows-uat/v2-5-3-owner-identity-runtime.cjs', 'v2-5.3:windows-uat-runtime'],
  ['tests/baseline/test-v2-5-4-rbac-audit.js', 'v2-5.4:rbac-audit'],
  ['scripts/v2-5-4-scenarios-all.cjs', 'v2-5.4:scenarios'],
  ['scripts/windows-uat/v2-5-4-rbac-runtime.cjs', 'v2-5.4:windows-uat-runtime'],
  ['tests/baseline/test-v2-5-5-performance.js', 'v2-5.5:performance'],
  ['scripts/v2-5-5-scenarios-all.cjs', 'v2-5.5:scenarios'],
  ['scripts/windows-uat/v2-5-5-performance-runtime.cjs', 'v2-5.5:windows-uat-runtime'],
  ['tests/baseline/test-v2-5-6-ux-hardening.js', 'v2-5.6:ux-hardening'],
  ['scripts/v2-5-6-scenarios-all.cjs', 'v2-5.6:scenarios'],
  ['scripts/windows-uat/v2-5-6-ux-runtime.cjs', 'v2-5.6:windows-uat-runtime'],
  ['tests/baseline/test-v2-5-7-production-release.js', 'v2-5.7:production-release'],
  ['scripts/v2-5-7-scenarios-all.cjs', 'v2-5.7:scenarios'],
  ['scripts/windows-uat/v2-5-7-release-runtime.cjs', 'v2-5.7:windows-uat-runtime'],
  ['tests/baseline/test-v2-5-final-stabilization.js', 'v2-5:final-stabilization'],
  ['scripts/v2-5-stabilization-scenarios-all.cjs', 'v2-5:stabilization-scenarios'],
  ['scripts/windows-uat/v2-5-stabilization-runtime.cjs', 'v2-5:stabilization-windows-uat'],
  ['tests/baseline/test-v2-5-8-auth-activation-ui.js', 'v2-5.8:auth-activation-ui'],
  ['tests/baseline/test-v2-5-8-live-owner-validation.js', 'v2-5.8:live-owner-validation'],
  ['tests/baseline/test-v2-5-8-drive-license-pull-recovery.js', 'v2-5.8:drive-license-pull-recovery'],
  ['tests/baseline/test-v2-5-9-final-activation.js', 'v2-5.9:final-activation'],
  ['tests/baseline/test-v2-5-9-residual-closure.js', 'v2-5.9:residual-closure'],
  ['tests/baseline/test-v2-5-10-stage1-backup-v1.js', 'v2-5.10:stage1-backup-v1'],
  ['tests/baseline/test-v2-5-10-stage2-inventory.js', 'v2-5.10:stage2-inventory'],
  ['tests/baseline/test-v2-5-10-cloud-discovery-restore.js', 'v2-5.10:cloud-discovery-restore'],
  ['tests/baseline/test-v2-5-10-setup-state-sync-auth.js', 'v2-5.10:setup-state-sync-auth'],
  ['tests/baseline/test-v2-5-10-setupstate-runtime-proof.js', 'v2-5.10:setupstate-runtime-proof'],
  ['tests/baseline/test-v2-5-10-final-consolidation.js', 'v2-5.10:final-consolidation'],
  ['tests/baseline/test-v2-5-10-production-lock.js', 'v2-5.10:production-lock'],
  ['tests/baseline/test-v2-5-10-production-lock-ux.js', 'v2-5.10:production-lock-ux'],
  ['tests/baseline/test-v2-5-10-category-b.js', 'v2-5.10:category-b'],
  ['scripts/v2-5-8-scenarios-all.cjs', 'v2-5.8:scenarios'],
  ['scripts/windows-uat/v2-5-8-activation-runtime.cjs', 'v2-5.8:windows-uat'],
  ['tests/baseline/test-hybrid-sot-foundation.js', 'hybrid:sot-foundation'],
  ['tests/baseline/test-hybrid-appointments-v2.js', 'hybrid:appointments-v2'],
  ['tests/baseline/test-font-csp-baseline.js', 'hybrid:font-csp'],
  ['tests/baseline/test-local-qr-baseline.js', 'hybrid:local-qr'],
  ['tests/baseline/test-v2-3-owner-rbac-activation.js', 'v2-3:owner-rbac-activation'],
  ['tests/baseline/test-v2-3-5-migration-failsafe.js', 'v2-3.5:migration-failsafe'],
  ['tests/baseline/test-v2-3-5-uninstall-prep-preserve.js', 'v2-3.5:uninstall-prep-preserve'],
  ['scripts/verify-uninstall-prep.js', 'v2-3.5:verify-uninstall-prep'],
  ['scripts/windows-uat/owner-rbac-runtime.cjs', 'v2-3.5:owner-rbac-runtime'],
  ['tests/baseline/test-v2-4-outbox-dual-device.js', 'v2-4:outbox-dual-device'],
  ['tests/baseline/test-v2-4-policies-attachments.js', 'v2-4:policies-attachments'],
  ['tests/baseline/test-v2-4-conflict-resolution.js', 'v2-4:conflict-resolution'],
  ['tests/baseline/test-v2-4-large-queue.js', 'v2-4:large-queue'],
  ['tests/baseline/test-v2-4-device-registry.js', 'v2-4:device-registry'],
];

const existing = [
  ['scripts/verify-attendance-policy.js', 'verify:attendance'],
  ['scripts/verify-ledger-monthly.js', 'verify:ledger'],
  ['scripts/verify-tax-invoice.js', 'verify:tax-invoice'],
  ['scripts/verify-backup-sync.js', 'verify:backup-sync'],
  ['scripts/verify-client-import.js', 'verify:client-import'],
  ['scripts/verify-cloud-v2.js', 'verify:cloud-v2'],
  ['scripts/scan-source-secrets.cjs', 'security:source-secret-scan'],
];

for (const [file, label] of baseline) runNode(file, label);
for (const [file, label] of existing) runNode(file, label);

// License suite is ESM
{
  const abs = path.join(root, 'scripts', 'commercial-licensing-test.mjs');
  const r = spawnSync(process.execPath, [abs], { cwd: root, encoding: 'utf8', env: process.env });
  results.push({
    label: 'license:test',
    ok: r.status === 0,
    detail: r.status === 0
      ? (r.stdout || '').trim().split('\n').slice(-2).join(' | ')
      : ((r.stderr || r.stdout || '') + '').trim().split('\n').slice(-8).join('\n'),
  });
}

let failed = 0;
for (const row of results) {
  const mark = row.ok ? 'PASS' : 'FAIL';
  if (!row.ok) failed += 1;
  console.log(`${mark}  ${row.label}`);
  if (!row.ok && row.detail) console.log(row.detail.split('\n').map((l) => '      ' + l).join('\n'));
}

console.log(`\nSummary: ${results.length - failed}/${results.length} passed`);
if (failed) {
  process.exit(1);
}
console.log('All tests passed.');
