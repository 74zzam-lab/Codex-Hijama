/**
 * Stage 13 — Setup publication contract (read-only evaluation + artifact scope).
 * Authority: __tdw_meta__.setupPublication verified remote read-back, not wizard flags.
 */
(function (global) {
  'use strict';

  const STATES = Object.freeze({
    LOCAL_RESOLVED: 'LOCAL_RESOLVED',
    PUBLICATION_PENDING: 'PUBLICATION_PENDING',
    PUBLICATION_IN_PROGRESS: 'PUBLICATION_IN_PROGRESS',
    PUBLICATION_FAILED: 'PUBLICATION_FAILED',
    PUBLICATION_VERIFIED: 'PUBLICATION_VERIFIED',
  });

  const ARTIFACTS = Object.freeze({
    LICENSE: 'license',
    SETTINGS: 'settings',
    USERS: 'users',
    OUTBOX: 'outbox',
  });

  const NEW_REQUIRED = Object.freeze([ARTIFACTS.LICENSE, ARTIFACTS.SETTINGS, ARTIFACTS.USERS, ARTIFACTS.OUTBOX]);
  const EXISTING_MINIMAL = Object.freeze([ARTIFACTS.LICENSE, ARTIFACTS.OUTBOX]);

  function readMeta() {
    try { return global.DB?.get?.('__tdw_meta__', {}) || {}; } catch { return {}; }
  }

  function readPublicationRecord() {
    const rec = readMeta().setupPublication;
    return rec && typeof rec === 'object' ? rec : null;
  }

  function discoveryStatus() {
    const w = global.DB?.get?.('__tdw_boot_wizard__', {}) || {};
    return String(w.cloudDiscovery?.result?.status || w.cloudDiscovery?.status || '').trim();
  }

  function isExistingBusinessOnCloud() {
    const w = global.DB?.get?.('__tdw_boot_wizard__', {}) || {};
    if (w.forkDecision === 'use_existing') return true;
    return discoveryStatus() === 'existing_business_found';
  }

  function requiredArtifactsForPath(path) {
    if (path === 'existing' || isExistingBusinessOnCloud()) return EXISTING_MINIMAL.slice();
    return NEW_REQUIRED.slice();
  }

  function artifactVerified(record, artifactId) {
    const entry = record?.artifacts?.[artifactId];
    return !!(entry && entry.ok === true && entry.readBack === true);
  }

  function allRequiredVerified(record, path) {
    if (!record || record.state !== STATES.PUBLICATION_VERIFIED) return false;
    const required = Array.isArray(record.requiredArtifacts)
      ? record.requiredArtifacts
      : requiredArtifactsForPath(path || record.path);
    return required.every((id) => artifactVerified(record, id));
  }

  function isResolved(snapshot) {
    const meta = snapshot?.meta || readMeta();
    if (meta.bootstrapCompletedAt) return true;
    const rec = snapshot?.setupPublication || meta.setupPublication;
    if (!rec) return false;
    const path = snapshot?.path || global.DB?.get?.('__tdw_boot_wizard__', {})?.path || rec.path;
    return allRequiredVerified(rec, path);
  }

  function getState(snapshot) {
    const meta = snapshot?.meta || readMeta();
    if (meta.bootstrapCompletedAt) return STATES.PUBLICATION_VERIFIED;
    const rec = snapshot?.setupPublication || meta.setupPublication;
    if (!rec?.state) return STATES.PUBLICATION_PENDING;
    return rec.state;
  }

  function buildContract(path) {
    const p = path || global.DB?.get?.('__tdw_boot_wizard__', {})?.path || 'new';
    return {
      states: Object.values(STATES),
      requiredArtifacts: requiredArtifactsForPath(p),
      existingMinimalScope: EXISTING_MINIMAL,
      newFullScope: NEW_REQUIRED,
      authority: '__tdw_meta__.setupPublication (remote read-back verified)',
      notBasedOn: ['wizard.completedSteps alone', 'upload return without read-back', 'local commit markers alone'],
      signedLicenseImmutable: true,
    };
  }

  const PublicationContract = {
    STATES,
    ARTIFACTS,
    NEW_REQUIRED,
    EXISTING_MINIMAL,
    readMeta,
    readPublicationRecord,
    requiredArtifactsForPath,
    artifactVerified,
    allRequiredVerified,
    isResolved,
    getState,
    isExistingBusinessOnCloud,
    buildContract,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PublicationContract;
  }
  global.PublicationContract = PublicationContract;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global);
