/**
 * Stage 7 — Post-Google cloud discovery (read-mostly gate).
 * Lists/classifies cloud candidates without creating org/owner/branch/device,
 * without restore/sync push, and without activation consume.
 */
(function (global) {
  'use strict';

  const WIZARD_KEY = '__tdw_boot_wizard__';
  const CACHE_FIELD = 'cloudDiscovery';
  const STATUS_NO_DATA = 'no_existing_business';
  const STATUS_EXISTING = 'existing_business_found';
  const STATUS_AMBIGUOUS = 'ambiguous_candidates';
  const STATUS_ERROR = 'discovery_error';

  const FORK_NO_EXISTING = 'no_existing_business';
  const FORK_UNIQUE = 'unique_existing_business';
  const FORK_AMBIGUOUS = 'ambiguous_candidates';
  const FORK_BACKUP_ONLY = 'backup_only';
  const FORK_LICENSE_ONLY = 'license_only';
  const FORK_PARTIAL = 'partial_existing_state';
  const FORK_ERROR = 'discovery_error';

  function wizardRaw() {
    try { return global.DB?.get?.(WIZARD_KEY) || null; } catch { return null; }
  }

  function saveWizard(w) {
    global.DB?.set?.(WIZARD_KEY, w);
    return w;
  }

  function loadWizard() {
    return wizardRaw() || {};
  }

  function hasGoogle() {
    const prov = global.settings?.backup?.providers?.google;
    if (global.DriveAdapter?.isConnected?.()) return true;
    return !!(prov?.connected && !prov?.userDisconnected && prov?.oauth !== false);
  }

  function classifyBackupPoint(point) {
    if (!point || typeof point !== 'object') return 'other';
    const kind = String(point.kind || point.type || '').toLowerCase();
    if (kind === 'backup_file' || kind === 'backup') return 'backup_file';
    if (kind === 'sync_checkpoint' || kind === 'checkpoint' || kind === 'sync') return 'sync_checkpoint';
    return 'other';
  }

  function mapLicenseCandidates(licResult) {
    if (!licResult) return [];
    if (licResult.error === 'multiple_licenses' && Array.isArray(licResult.candidates)) {
      return licResult.candidates.map((c, i) => ({
        id: c.id || c.path || `license-${i}`,
        verified: c.verified === true || c.signatureValid === true,
        centerId: c.centerId || c.license?.centerId || null,
        centerName: c.centerName || c.license?.centerName || null,
        path: c.path || null,
        raw: c,
      }));
    }
    if (licResult.ok && licResult.license) {
      return [{
        id: licResult.path || licResult.license?.centerId || 'license-0',
        verified: true,
        centerId: licResult.license.centerId || null,
        centerName: licResult.license.centerName || null,
        path: licResult.path || null,
        raw: licResult.license,
      }];
    }
    return [];
  }

  function mapOrganizationCandidates(licenseCandidates, dataDiscovery) {
    const orgs = new Map();
    for (const lic of licenseCandidates) {
      if (!lic.centerId) continue;
      const key = String(lic.centerId);
      if (!orgs.has(key)) {
        orgs.set(key, {
          id: key,
          centerId: lic.centerId,
          centerName: lic.centerName || null,
          source: 'license_discovery',
          verified: lic.verified === true,
        });
      }
    }
    const cloud = dataDiscovery?.cloud || {};
    const centerId = cloud.centerId || dataDiscovery?.identity?.centerId;
    if (centerId) {
      const key = String(centerId);
      if (!orgs.has(key)) {
        orgs.set(key, {
          id: key,
          centerId,
          centerName: cloud.centerName || dataDiscovery?.identity?.centerName || null,
          source: 'data_discovery',
          verified: false,
        });
      }
    }
    return Array.from(orgs.values());
  }

  function mapBackupCandidates(dataDiscovery) {
    const cloud = dataDiscovery?.cloud || {};
    const points = Array.isArray(cloud.restorePoints) ? cloud.restorePoints : [];
    const list = points.length ? points : (cloud.newest ? [cloud.newest] : []);
    return list.map((p, i) => ({
      id: p.id || p.path || p.name || `backup-${i}`,
      classification: classifyBackupPoint(p),
      kind: classifyBackupPoint(p),
      modifiedAt: p.modifiedAt || p.updatedAt || p.createdAt || null,
      sizeBytes: p.sizeBytes || p.size || null,
      verified: p.verified === true,
      raw: p,
    }));
  }

  function mapBranchCandidates(licenseCandidates, dataDiscovery) {
    const branches = [];
    for (const lic of licenseCandidates) {
      const raw = lic.raw?.license || lic.raw;
      const list = raw?.branches;
      if (!Array.isArray(list)) continue;
      for (const b of list) {
        branches.push({
          id: b.id || b.branchId,
          name: b.name || b.branchName || null,
          centerId: lic.centerId || null,
          source: 'license_discovery',
          verified: lic.verified === true,
          raw: b,
        });
      }
    }
    const cloud = dataDiscovery?.cloud || {};
    if (cloud.branchId) {
      branches.push({
        id: cloud.branchId,
        name: cloud.branchName || null,
        centerId: cloud.centerId || dataDiscovery?.identity?.centerId || null,
        source: 'data_discovery',
        verified: false,
        raw: { branchId: cloud.branchId },
      });
    }
    return branches;
  }

  function mapSyncCandidates(dataDiscovery) {
    const cloud = dataDiscovery?.cloud || {};
    const points = Array.isArray(cloud.restorePoints) ? cloud.restorePoints : [];
    const syncPoints = points.filter((p) => classifyBackupPoint(p) === 'sync_checkpoint');
    if (!syncPoints.length && cloud.newest && classifyBackupPoint(cloud.newest) === 'sync_checkpoint') {
      syncPoints.push(cloud.newest);
    }
    return syncPoints.map((p, i) => ({
      id: p.id || p.path || `sync-${i}`,
      classification: 'sync_checkpoint',
      modifiedAt: p.modifiedAt || p.updatedAt || null,
      verified: p.verified === true,
      raw: p,
    }));
  }

  function pickUniqueCandidate(list) {
    if (!Array.isArray(list) || list.length !== 1) return null;
    return list[0];
  }

  function deriveStatus(orgCandidates, licenseCandidates) {
    if (orgCandidates.length > 1) return STATUS_AMBIGUOUS;
    if (licenseCandidates.length > 1) return STATUS_AMBIGUOUS;
    if (orgCandidates.length === 1 || licenseCandidates.length === 1) return STATUS_EXISTING;
    return STATUS_NO_DATA;
  }

  function classifyForkScenario(result) {
    if (!result || result.ok === false) return FORK_ERROR;
    const orgs = result.organizationCandidates || [];
    const lics = result.licenseCandidates || [];
    const backups = (result.backupCandidates || []).filter((b) => b.classification === 'backup_file');
    const branches = result.branchCandidates || [];
    const syncs = result.syncCandidates || [];
    if (orgs.length > 1 || lics.length > 1) return FORK_AMBIGUOUS;
    if (orgs.length === 1) return FORK_UNIQUE;
    if (lics.length === 1) return FORK_LICENSE_ONLY;
    if (backups.length > 0) return FORK_BACKUP_ONLY;
    if (branches.length > 0 || syncs.length > 0) return FORK_PARTIAL;
    return FORK_NO_EXISTING;
  }

  function requiresPathFork(classification) {
    return classification === FORK_UNIQUE
      || classification === FORK_AMBIGUOUS
      || classification === FORK_LICENSE_ONLY
      || classification === FORK_BACKUP_ONLY
      || classification === FORK_PARTIAL;
  }

  function discoveryFingerprint(result) {
    if (!result) return null;
    const orgs = (result.organizationCandidates || []).map((o) => o.id || o.centerId).sort().join(',');
    const lics = (result.licenseCandidates || []).map((l) => l.id || l.centerId).sort().join(',');
    const backups = (result.backupCandidates || []).map((b) => b.id).sort().join(',');
    return `${orgs}|${lics}|${backups}|${result.status || ''}`;
  }

  function invalidateForkDecision(wizard) {
    const w = wizard || loadWizard();
    delete w.forkDecision;
    delete w.forkDecisionAt;
    delete w.forkGoogleAccountKey;
    delete w.forkDiscoveryFingerprint;
    delete w.forkSelectedCandidateId;
    delete w.pathDecisionResolvedAt;
    const steps = global.BootFlow?.NEW_STEPS || [];
    const forkIdx = steps.indexOf('path_decision');
    if (forkIdx >= 0 && Array.isArray(w.completedSteps)) {
      w.completedSteps = w.completedSteps.filter((step) => steps.indexOf(step) < 0 || steps.indexOf(step) < forkIdx);
    }
    saveWizard(w);
    return w;
  }

  function isForkDecisionValid(wizard) {
    const w = wizard || wizardRaw() || {};
    if (!w.forkDecision) return false;
    if (w.forkGoogleAccountKey && w.forkGoogleAccountKey !== currentGoogleAccountKey()) return false;
    const cached = getCachedDiscovery();
    const fp = discoveryFingerprint(cached);
    if (w.forkDiscoveryFingerprint && fp && w.forkDiscoveryFingerprint !== fp) return false;
    return w.forkDecision === 'use_existing' || w.forkDecision === 'start_new';
  }

  function buildResult(payload) {
    const organizationCandidates = payload.organizationCandidates || [];
    const licenseCandidates = payload.licenseCandidates || [];
    const status = payload.status || deriveStatus(organizationCandidates, licenseCandidates);
    const selectedOrUniqueCandidate = payload.selectedOrUniqueCandidate
      || pickUniqueCandidate(organizationCandidates)
      || pickUniqueCandidate(licenseCandidates)
      || null;
    const forkClassification = payload.forkClassification || classifyForkScenario({
      ok: payload.ok !== false,
      organizationCandidates,
      licenseCandidates,
      backupCandidates: payload.backupCandidates || [],
      branchCandidates: payload.branchCandidates || [],
      syncCandidates: payload.syncCandidates || [],
      status,
    });
    return {
      ok: payload.ok !== false,
      organizationCandidates,
      licenseCandidates,
      backupCandidates: payload.backupCandidates || [],
      branchCandidates: payload.branchCandidates || [],
      syncCandidates: payload.syncCandidates || [],
      selectedOrUniqueCandidate,
      status,
      forkClassification,
      requiresPathFork: requiresPathFork(forkClassification),
      diagnostics: payload.diagnostics || {},
      dataDiscovery: payload.dataDiscovery || null,
      licenseDiscovery: payload.licenseDiscovery || null,
      at: payload.at || new Date().toISOString(),
      readOnly: true,
    };
  }

  function getCachedDiscovery() {
    const w = wizardRaw() || {};
    const cache = w[CACHE_FIELD];
    if (!cache || typeof cache !== 'object') return null;
    if (cache.googleAccountKey && cache.googleAccountKey !== currentGoogleAccountKey()) return null;
    return cache.result || null;
  }

  function currentGoogleAccountKey() {
    const email = global.settings?.backup?.providers?.google?.email || '';
    return String(email || '').toLowerCase() || null;
  }

  function cacheDiscoveryResult(result, options) {
    options = options || {};
    const w = loadWizard();
    w[CACHE_FIELD] = {
      result,
      googleAccountKey: currentGoogleAccountKey(),
      path: w.path || null,
      completedAt: new Date().toISOString(),
      forceRefresh: options.forceRefresh === true,
    };
    w.licenseDiscoveryAttempted = true;
    w.discoveryStatus = result.status;
    w.discoveryCompletedAt = w[CACHE_FIELD].completedAt;
    if (result.selectedOrUniqueCandidate?.id) {
      w.selectedCandidateId = result.selectedOrUniqueCandidate.id;
    }
    saveWizard(w);
    return result;
  }

  function invalidateDiscoveryCache(wizard) {
    const w = wizard || loadWizard();
    invalidateForkDecision(w);
    delete w[CACHE_FIELD];
    delete w.discoveryStatus;
    delete w.discoveryCompletedAt;
    delete w.licenseDiscoveryAttempted;
    delete w.selectedCandidateId;
    const steps = (w.path === 'existing'
      ? (global.BootFlow?.EXISTING_STEPS || [])
      : (global.BootFlow?.NEW_STEPS || []));
    const discoveryIdx = steps.indexOf('discovery');
    if (discoveryIdx >= 0 && Array.isArray(w.completedSteps)) {
      w.completedSteps = w.completedSteps.filter((step) => {
        const idx = steps.indexOf(step);
        return idx >= 0 && idx < discoveryIdx;
      });
    }
    saveWizard(w);
    return w;
  }

  function hasDiscoveryResolved() {
    const w = wizardRaw() || {};
    const cached = getCachedDiscovery();
    if (cached && cached.ok === true) return true;
    if (w.discoveryCompletedAt && w.licenseDiscoveryAttempted === true && cached) return true;
    return false;
  }

  /**
   * Read-only post-Google discovery. Network failures return ok:false (retryable).
   */
  async function runPostGoogleCloudDiscovery(options) {
    options = options || {};
    if (!hasGoogle()) {
      return buildResult({
        ok: false,
        status: STATUS_ERROR,
        diagnostics: { error: 'google_not_connected', retryable: false },
      });
    }

    if (!options.forceRefresh) {
      const cached = getCachedDiscovery();
      if (cached) return { ...cached, fromCache: true };
    }

    const diagnostics = { stages: [], retryable: true };
    let licenseDiscovery = null;
    let licenseCandidates = [];

    try {
      const bootstrap = global.CloudBootstrap;
      if (bootstrap?.discoverAndFetchLicenseFromDrive) {
        diagnostics.stages.push('license_list');
        licenseDiscovery = await bootstrap.discoverAndFetchLicenseFromDrive({
          forceList: options.forceList === true,
          persist: false,
        });
        if (!licenseDiscovery?.ok && licenseDiscovery?.error !== 'multiple_licenses') {
          licenseDiscovery = await bootstrap.discoverAndFetchLicenseFromDrive({
            forceList: true,
            persist: false,
          });
        }
        licenseCandidates = mapLicenseCandidates(licenseDiscovery);
      } else {
        diagnostics.stages.push('license_list_skipped');
      }
    } catch (error) {
      return buildResult({
        ok: false,
        status: STATUS_ERROR,
        licenseCandidates: [],
        organizationCandidates: [],
        backupCandidates: [],
        branchCandidates: [],
        syncCandidates: [],
        diagnostics: {
          error: error?.code || error?.message || 'license_discovery_failed',
          stage: 'license_list',
          retryable: true,
        },
      });
    }

    let dataDiscovery = null;
    try {
      const Discovery = global.CloudDataDiscovery;
      if (Discovery?.discoverAllSources) {
        diagnostics.stages.push('data_sources');
        const budget = Discovery.DISCOVERY_TIMEOUT_MS || 180000;
        dataDiscovery = await Discovery.discoverAllSources({
          timeoutMs: options.timeoutMs || budget,
          metadataOnly: true,
          onProgress: options.onProgress,
        });
      } else {
        diagnostics.stages.push('data_sources_unavailable');
      }
    } catch (error) {
      return buildResult({
        ok: false,
        status: STATUS_ERROR,
        licenseCandidates,
        organizationCandidates: mapOrganizationCandidates(licenseCandidates, null),
        backupCandidates: [],
        branchCandidates: mapBranchCandidates(licenseCandidates, null),
        syncCandidates: [],
        licenseDiscovery,
        diagnostics: {
          error: error?.code || error?.message || 'data_discovery_failed',
          stage: 'data_sources',
          retryable: true,
        },
      });
    }

    const organizationCandidates = mapOrganizationCandidates(licenseCandidates, dataDiscovery);
    const backupCandidates = mapBackupCandidates(dataDiscovery);
    const branchCandidates = mapBranchCandidates(licenseCandidates, dataDiscovery);
    const syncCandidates = mapSyncCandidates(dataDiscovery);
    const status = deriveStatus(organizationCandidates, licenseCandidates);

  const result = buildResult({
      ok: true,
      organizationCandidates,
      licenseCandidates,
      backupCandidates,
      branchCandidates,
      syncCandidates,
      licenseDiscovery,
      dataDiscovery,
      status,
      diagnostics: {
        ...diagnostics,
        licenseError: licenseDiscovery?.error || null,
        dataError: dataDiscovery?.error || null,
        existingBusinessFound: status === STATUS_EXISTING || status === STATUS_AMBIGUOUS,
        silentPathFlipPrevented: true,
      },
    });

    if (status === STATUS_EXISTING || status === STATUS_AMBIGUOUS) {
      result.diagnostics.stage8Note = 'existing_business_detected_recorded_no_silent_path_flip';
    }

    return cacheDiscoveryResult(result, options);
  }

  /**
   * Legacy name wrapper — read-only discovery only (no license apply / path flip).
   */
  async function postGoogleCloudDiscovery(options) {
    return runPostGoogleCloudDiscovery(options);
  }

  global.PostGoogleCloudDiscovery = {
    WIZARD_CACHE_FIELD: CACHE_FIELD,
    STATUS_NO_DATA,
    STATUS_EXISTING,
    STATUS_AMBIGUOUS,
    STATUS_ERROR,
    FORK_NO_EXISTING,
    FORK_UNIQUE,
    FORK_AMBIGUOUS,
    FORK_BACKUP_ONLY,
    FORK_LICENSE_ONLY,
    FORK_PARTIAL,
    FORK_ERROR,
    runPostGoogleCloudDiscovery,
    postGoogleCloudDiscovery,
    getCachedDiscovery,
    hasDiscoveryResolved,
    invalidateDiscoveryCache,
    invalidateForkDecision,
    isForkDecisionValid,
    classifyForkScenario,
    requiresPathFork,
    discoveryFingerprint,
    buildResult,
    classifyBackupPoint,
  };
})(typeof window !== 'undefined' ? window : globalThis);
