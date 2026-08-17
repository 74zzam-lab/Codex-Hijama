/**
 * Stage 16 — Existing customer short path contract (read-only evaluation).
 * Direct Existing and NEW→Use Existing converge on the same gate logic after fork.
 */
(function (global) {
  'use strict';

  const FLOW_BEFORE = Object.freeze([
    'language', 'google', 'discovery', 'license', 'organization', 'branch_select',
    'device', 'restore', 'business_setup', 'publication', 'owner', 'sync', 'ready',
  ]);

  const FLOW_AFTER = Object.freeze([
    'language', 'google', 'discovery', 'license_org_recovery', 'branch_select',
    'device', 'restore', 'owner_auth', 'sync', 'ready',
  ]);

  const STEP_CLASSIFICATION = Object.freeze({
    language: 'KEEP',
    google: 'KEEP',
    discovery: 'KEEP',
    license_org_recovery: 'MERGE',
    branch_select: 'KEEP',
    device: 'KEEP',
    restore: 'KEEP',
    owner_auth: 'MERGE',
    sync: 'KEEP',
    ready: 'KEEP',
    license: 'MERGE',
    organization: 'MERGE',
    business_setup: 'AUTO_RESOLVE',
    publication: 'AUTO_RESOLVE',
    readback: 'AUTO_RESOLVE',
    owner: 'MERGE',
    path_decision: 'REMOVE_FROM_EXISTING_FLOW',
  });

  const TARGET_EXISTING_GATES = Object.freeze([
    'GOOGLE_CONNECTED',
    'DISCOVERY_RESOLVED',
    'LICENSE_ORG_RECOVERY_RESOLVED',
    'BRANCH_RESOLVED',
    'DEVICE_RESOLVED',
    'RESTORE_DECISION_RESOLVED',
    'BUSINESS_SETUP_RESOLVED',
    'PUBLICATION_RESOLVED',
    'READBACK_VERIFIED',
    'OWNER_AUTH_RESOLVED',
    'INITIAL_SYNC_RESOLVED',
    'READY',
  ]);

  function readWizard(snapshot) {
    if (snapshot?.wizard) return snapshot.wizard;
    try { return global.DB?.get?.('__tdw_boot_wizard__', {}) || {}; } catch { return {}; }
  }

  function readMeta(snapshot) {
    if (snapshot?.meta) return snapshot.meta;
    try { return global.DB?.get?.('__tdw_meta__', {}) || {}; } catch { return {}; }
  }

  function isExistingPath(snapshot) {
    const w = readWizard(snapshot);
    return w.path === 'existing' || w.forkDecision === 'use_existing';
  }

  function recoveryRecord(snapshot) {
    return readMeta(snapshot).existingShortPathRecovery || null;
  }

  function licenseOrgRecoveryResolved(snapshot) {
    const BF = global.BootFlow;
    if (BF?.licenseOrgRecoveryResolved) return BF.licenseOrgRecoveryResolved();
    const lic = global.LicenseCloud?.loadLocal?.() || snapshot?.license;
    const centerId = String(lic?.centerId || lic?.center_id || readMeta(snapshot).centerId || '').trim();
    const centerName = String(
      lic?.centerName || global.settings?.centerName || snapshot?.settings?.centerName || '',
    ).trim();
    return !!(centerId && centerName && global.BootFlow?.hasValidLicense?.());
  }

  function businessSetupAutoResolved(snapshot) {
    if (!isExistingPath(snapshot)) return false;
    const BSC = global.BusinessSetupContract;
    const snap = BSC?.readSettingsSnapshot?.() || {
      centerName: String(global.settings?.centerName || snapshot?.settings?.centerName || '').trim(),
      phone: String(global.settings?.phone || snapshot?.settings?.phone || '').trim(),
    };
    if (BSC?.isResolved?.(snap)) return true;
    const rec = recoveryRecord(snapshot);
    return rec?.businessSetupFromRecovery === true;
  }

  function minimalPublicationSatisfied(snapshot) {
    if (!isExistingPath(snapshot)) return false;
    const meta = readMeta(snapshot);
    if (meta.bootstrapCompletedAt) return true;
    const PC = global.PublicationContract;
    if (PC?.isResolved?.({ meta, path: 'existing', setupPublication: meta.setupPublication })) return true;
    const rec = recoveryRecord(snapshot);
    return rec?.licenseRecovered === true && rec?.minimalPublicationWaived !== false;
  }

  function minimalReadbackSatisfied(snapshot) {
    if (!isExistingPath(snapshot)) return false;
    const meta = readMeta(snapshot);
    if (meta.bootstrapCompletedAt) return true;
    const RVC = global.ReadbackVerificationContract;
    if (RVC?.isVerified?.({ meta, readbackVerification: meta.readbackVerification, path: 'existing' })) {
      return true;
    }
    const rec = recoveryRecord(snapshot);
    return rec?.licenseRecovered === true && rec?.minimalReadbackWaived !== false;
  }

  function ownerAuthResolved(snapshot) {
    const BF = global.BootFlow;
    if (BF?.ownerAuthStepResolved) return BF.ownerAuthStepResolved();
    if (!BF?.hasOwnerPasswordAccount?.()) return false;
    return BF?.setupOwnerSessionReady?.() === true;
  }

  function gatesBeforeSyncSatisfied(snapshot) {
    if (!isExistingPath(snapshot)) return null;
    const BF = global.BootFlow;
    const businessOk = businessSetupAutoResolved(snapshot)
      || BF?.businessSetupStepResolved?.() === true;
    const pubOk = minimalPublicationSatisfied(snapshot) || BF?.publicationStepResolved?.() === true;
    const readOk = minimalReadbackSatisfied(snapshot) || BF?.readbackStepResolved?.() === true;
    const ownerOk = ownerAuthResolved(snapshot);
    return {
      businessSetup: businessOk,
      publication: pubOk,
      readback: readOk,
      ownerAuth: ownerOk,
      ok: businessOk && pubOk && readOk && ownerOk,
    };
  }

  function mapLegacyStep(stepId) {
    if (stepId === 'license' || stepId === 'organization') return 'license_org_recovery';
    if (stepId === 'owner') return 'owner_auth';
    if (['business_setup', 'publication', 'readback'].includes(stepId)) return null;
    return stepId;
  }

  function migrateCompletedSteps(completedSteps) {
    const out = new Set();
    for (const step of completedSteps || []) {
      const mapped = mapLegacyStep(step);
      if (mapped) out.add(mapped);
    }
    return Array.from(out);
  }

  function buildContract() {
    return {
      flowBefore: FLOW_BEFORE.slice(),
      flowAfter: FLOW_AFTER.slice(),
      stepClassification: STEP_CLASSIFICATION,
      targetGates: TARGET_EXISTING_GATES.slice(),
      convergence: 'Direct Existing and NEW→Use Existing share FLOW_AFTER after fork',
      prohibited: ['manual activation', 'createOrganization', 'createOwner', 'createFirstBranch', 'NEW full publication'],
    };
  }

  const ExistingShortPathContract = {
    FLOW_BEFORE,
    FLOW_AFTER,
    STEP_CLASSIFICATION,
    TARGET_EXISTING_GATES,
    isExistingPath,
    licenseOrgRecoveryResolved,
    businessSetupAutoResolved,
    minimalPublicationSatisfied,
    minimalReadbackSatisfied,
    ownerAuthResolved,
    gatesBeforeSyncSatisfied,
    mapLegacyStep,
    migrateCompletedSteps,
    buildContract,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExistingShortPathContract;
  }
  global.ExistingShortPathContract = ExistingShortPathContract;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global);
