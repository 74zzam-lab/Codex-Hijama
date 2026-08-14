/**
 * Stage 13 — Explicit setup publication orchestration (publish + remote read-back).
 * Reuses DriveAdapter, LicenseCloud, ConfigLayer, SqliteOutboxBridge — no new cloud protocol.
 */
(function (global) {
  'use strict';

  const PC = () => global.PublicationContract;
  const STATES = () => PC()?.STATES || {};

  function readLocalContext() {
    const lic = global.LicenseCloud?.loadLocal?.() || {};
    const cfg = global.DeviceConfig?.load?.() || {};
    const settings = global.settings || global.DB?.get?.('settings', {}) || {};
    const w = global.DB?.get?.('__tdw_boot_wizard__', {}) || {};
    const meta = global.DB?.get?.('__tdw_meta__', {}) || {};
    const branchId = String(cfg.lockedBranchId || lic.branches?.[0]?.id || '').trim();
    return {
      path: w.path || 'new',
      centerId: String(lic.centerId || meta.centerId || '').trim(),
      branchId,
      deviceId: String(cfg.deviceUuid || '').trim(),
      deviceName: String(cfg.deviceName || '').trim(),
      centerName: String(settings.centerName || lic.centerName || '').trim(),
      phone: String(settings.phone || '').trim(),
      license: lic,
      settings,
      meta,
      wizard: w,
    };
  }

  async function persistPublicationRecord(patch) {
    const meta = global.DB?.get?.('__tdw_meta__', {}) || {};
    const prev = meta.setupPublication && typeof meta.setupPublication === 'object'
      ? meta.setupPublication : {};
    const nextMeta = {
      ...meta,
      setupPublication: {
        ...prev,
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    };
    if (typeof global.SqliteBridge?.setAuthoritative === 'function') {
      const r = await global.SqliteBridge.setAuthoritative('__tdw_meta__', nextMeta);
      if (r?.ok === false) return r;
    } else if (typeof global.DB?.set === 'function') {
      const r = await global.DB.set('__tdw_meta__', nextMeta);
      if (r?.ok === false) return r;
    }
    return { ok: true, setupPublication: nextMeta.setupPublication };
  }

  async function verifyGoogleIdentity() {
    const status = typeof global.DriveAdapter?.getStatus === 'function'
      ? await global.DriveAdapter.getStatus()
      : { connected: !!global.DriveAdapter?.isConnected?.(), email: global.settings?.backup?.providers?.google?.email || '' };
    if (!status?.connected) {
      return { ok: false, error: 'drive_not_connected', code: 'cloud_upload_failed' };
    }
    if (status?.needsReauth) {
      return { ok: false, error: 'oauth_unauthorized', code: 'cloud_upload_failed' };
    }
    const lic = global.LicenseCloud?.loadLocal?.() || {};
    const connected = String(status.email || '').trim().toLowerCase();
    const bound = String(lic.ownerIdentity?.boundGoogleEmail || '').trim().toLowerCase();
    const authorized = String(lic.ownerIdentity?.authorizedEmail || '').trim().toLowerCase();
    if ((bound && bound !== connected) || (authorized && authorized !== connected)) {
      return { ok: false, error: 'cloud_identity_mismatch', code: 'cloud_identity_mismatch' };
    }
    return { ok: true, email: connected || status.email || '' };
  }

  function parseRemoteJson(dl) {
    if (!dl?.ok) return { ok: false, error: dl?.error || dl?.message || 'cloud_artifact_missing' };
    try {
      const raw = dl.text || dl.payload || dl.data || '';
      const doc = typeof raw === 'object' ? raw : JSON.parse(String(raw));
      return { ok: true, doc };
    } catch {
      return { ok: false, error: 'cloud_readback_failed' };
    }
  }

  async function remoteDownload(paths) {
    const list = Array.isArray(paths) ? paths.filter(Boolean) : [paths].filter(Boolean);
    if (!list.length) return { ok: false, error: 'cloud_artifact_missing' };
    if (typeof global.DriveAdapter?.downloadJsonFirst === 'function') {
      return global.DriveAdapter.downloadJsonFirst(list);
    }
    return global.DriveAdapter.downloadJson(list[0]);
  }

  async function publishLicense(ctx) {
    const lic = ctx.license;
    if (!lic?.centerId) return { ok: false, error: 'no_center_id', artifact: 'license' };
    const existing = PC()?.isExistingBusinessOnCloud?.();
    if (existing) {
      const paths = global.DriveLayout?.licenseJsonCandidates?.(ctx.centerId)
        || [global.DriveLayout?.licenseJson?.(ctx.centerId)].filter(Boolean);
      const dl = await remoteDownload(paths);
      const parsed = parseRemoteJson(dl);
      if (!parsed.ok) return { ...parsed, artifact: 'license' };
      const remote = parsed.doc;
      if (String(remote.centerId || '') !== ctx.centerId) {
        return { ok: false, error: 'cloud_identity_mismatch', artifact: 'license', readBack: false };
      }
      const branchOk = !ctx.branchId || (remote.branches || []).some((b) => b && b.id === ctx.branchId);
      if (!branchOk) return { ok: false, error: 'cloud_artifact_missing', artifact: 'license', readBack: false };
      return { ok: true, artifact: 'license', readBack: true, skippedPublish: true, centerId: ctx.centerId, branchId: ctx.branchId };
    }
    const push = await global.LicenseCloud?.pushToDrive?.(lic);
    if (!push?.ok) {
      return { ok: false, error: push?.error || 'cloud_upload_failed', artifact: 'license', readBack: false };
    }
    const paths = global.DriveLayout?.licenseJsonCandidates?.(ctx.centerId)
      || [global.DriveLayout?.licenseJson?.(ctx.centerId)].filter(Boolean);
    const dl = await remoteDownload(paths);
    const parsed = parseRemoteJson(dl);
    if (!parsed.ok) return { ...parsed, artifact: 'license', readBack: false };
    const remote = parsed.doc;
    if (String(remote.centerId || '') !== ctx.centerId) {
      return { ok: false, error: 'cloud_readback_failed', artifact: 'license', readBack: false };
    }
    const branchOk = !ctx.branchId || (remote.branches || []).some((b) => b && b.id === ctx.branchId);
    if (!branchOk) return { ok: false, error: 'cloud_readback_failed', artifact: 'license', readBack: false };
    return { ok: true, artifact: 'license', readBack: true, centerId: ctx.centerId, branchId: ctx.branchId };
  }

  async function publishSettings(ctx) {
    if (PC()?.isExistingBusinessOnCloud?.()) {
      return { ok: true, artifact: 'settings', readBack: true, skippedPublish: true };
    }
    const centerId = ctx.centerId;
    const branchId = ctx.branchId;
    if (!centerId || !branchId) return { ok: false, error: 'branch_required', artifact: 'settings' };
    const pack = global.ConfigLayer?.exportBranchPack?.(branchId);
    if (!pack?.settings) return { ok: false, error: 'no_config_pack', artifact: 'settings' };
    const payload = { ...pack.settings };
    if (ctx.centerName) payload.centerName = ctx.centerName;
    if (ctx.phone) payload.phone = ctx.phone;
    const remotePath = global.ConfigLayer?.drivePathForFile?.(centerId, branchId, 'settings.json');
    if (!remotePath) return { ok: false, error: 'no_path', artifact: 'settings' };
    const up = await global.DriveAdapter?.uploadJson?.(remotePath, payload, { overwrite: true });
    if (!up?.ok) return { ok: false, error: up?.error || 'cloud_upload_failed', artifact: 'settings', readBack: false };
    const paths = global.DriveLayout?.configBranchFileCandidates?.(centerId, branchId, 'settings.json')
      || [remotePath];
    const dl = await remoteDownload(paths);
    const parsed = parseRemoteJson(dl);
    if (!parsed.ok) return { ...parsed, artifact: 'settings', readBack: false };
    const remote = parsed.doc || {};
    const name = String(remote.centerName || remote.clinicName || remote.name || '').trim();
    const phone = String(remote.phone || remote.centerPhone || '').trim();
    if (ctx.centerName && name && name !== ctx.centerName) {
      return { ok: false, error: 'cloud_readback_failed', artifact: 'settings', readBack: false };
    }
    if (ctx.phone && phone && phone.replace(/\D/g, '') !== ctx.phone.replace(/\D/g, '')) {
      return { ok: false, error: 'cloud_readback_failed', artifact: 'settings', readBack: false };
    }
    return { ok: true, artifact: 'settings', readBack: true, centerName: name || ctx.centerName, phone: phone || ctx.phone };
  }

  async function publishUsers(ctx) {
    if (PC()?.isExistingBusinessOnCloud?.()) {
      return { ok: true, artifact: 'users', readBack: true, skippedPublish: true };
    }
    const centerId = ctx.centerId;
    const branchId = ctx.branchId;
    const pack = global.ConfigLayer?.exportBranchPack?.(branchId);
    if (!pack) return { ok: false, error: 'no_config_pack', artifact: 'users' };
    const usersPath = global.ConfigLayer?.drivePathForFile?.(centerId, branchId, 'users.json');
    const ownerPath = global.ConfigLayer?.drivePathForFile?.(centerId, branchId, 'owner.json');
    const users = (pack.users || []).map((u) => {
      const copy = { ...u };
      if (copy.seedDefaultPassword === true) return null;
      if (copy.password && !/^(?:pbkdf2:|pbkdf2v2:|b64:)/i.test(String(copy.password))) delete copy.password;
      delete copy.passwordPlain;
      return copy;
    }).filter(Boolean);
    const upUsers = await global.DriveAdapter?.uploadJson?.(usersPath, users, { overwrite: true });
    if (!upUsers?.ok) return { ok: false, error: upUsers?.error || 'cloud_upload_failed', artifact: 'users', readBack: false };
    const ownerPayload = pack.owner || {};
    const upOwner = await global.DriveAdapter?.uploadJson?.(ownerPath, ownerPayload, { overwrite: true });
    if (!upOwner?.ok) return { ok: false, error: upOwner?.error || 'cloud_upload_failed', artifact: 'users', readBack: false };
    const paths = global.DriveLayout?.configBranchFileCandidates?.(centerId, branchId, 'users.json') || [usersPath];
    const dl = await remoteDownload(paths);
    const parsed = parseRemoteJson(dl);
    if (!parsed.ok) return { ...parsed, artifact: 'users', readBack: false };
    const remoteUsers = Array.isArray(parsed.doc) ? parsed.doc : [];
    const owner = remoteUsers.find((u) => u && ['owner', 'hq_admin'].includes(String(u.role || '').toLowerCase())
      && u.seedDefaultPassword !== true);
    if (!owner) return { ok: false, error: 'cloud_readback_failed', artifact: 'users', readBack: false };
    if (owner.password && !/^(?:pbkdf2:|pbkdf2v2:|b64:)/i.test(String(owner.password))) {
      return { ok: false, error: 'cloud_readback_failed', artifact: 'users', readBack: false };
    }
    return { ok: true, artifact: 'users', readBack: true, ownerId: owner.id };
  }

  async function publishOutbox(ctx) {
    if (!global.SqliteOutboxBridge?.pushPending) {
      return { ok: false, error: 'operation_sync_bridge_unavailable', artifact: 'outbox', readBack: false };
    }
    const push = await global.SqliteOutboxBridge.pushPending({ includeOrganization: true, limit: 50 });
    const flushed = Number(push?.flushed || 0);
    const failed = (push?.failed || push?.results || []).filter((r) => r && r.ok !== true);
    if (push?.ok !== true && flushed === 0) {
      return { ok: false, error: push?.error || push?.reason || 'cloud_partial_publication', artifact: 'outbox', readBack: false, partial: failed };
    }
    return { ok: true, artifact: 'outbox', readBack: true, flushed, failedCount: failed.length };
  }

  const PUBLISHERS = {
    license: publishLicense,
    settings: publishSettings,
    users: publishUsers,
    outbox: publishOutbox,
  };

  function prerequisitesMet(ctx) {
    const BF = global.BootFlow;
    const issues = [];
    if (!BF?.hasCenterData?.()) issues.push('organization');
    if (ctx.path === 'new' && !PC()?.isExistingBusinessOnCloud?.() && !BF?.ownerStepResolved?.()) issues.push('owner');
    if (!BF?.branchStepResolved?.()) issues.push('branch');
    if (!BF?.deviceStepResolved?.()) issues.push('device');
    if (!BF?.businessSetupStepResolved?.()) issues.push('business_setup');
    return { ok: issues.length === 0, issues };
  }

  async function runSetupPublication(options) {
    options = options || {};
    if (options.inFlightGuard && options.inFlightGuard()) {
      return { ok: false, error: 'publication_in_flight' };
    }
    const ctx = readLocalContext();
    const prereq = prerequisitesMet(ctx);
    if (!prereq.ok) {
      return { ok: false, error: 'local_prerequisites_missing', issues: prereq.issues };
    }
    if (PC()?.isResolved?.({ meta: ctx.meta, setupPublication: ctx.meta.setupPublication, path: ctx.path })) {
      return { ok: true, already: true, setupPublication: ctx.meta.setupPublication };
    }
    const identity = await verifyGoogleIdentity();
    if (!identity.ok) {
      await persistPublicationRecord({ state: STATES().PUBLICATION_FAILED, path: ctx.path, lastError: identity });
      return identity;
    }
    const required = PC()?.requiredArtifactsForPath?.(ctx.path) || [];
    await persistPublicationRecord({
      state: STATES().PUBLICATION_IN_PROGRESS,
      path: ctx.path,
      requiredArtifacts: required,
      googleAccount: identity.email,
      artifacts: {},
    });
    const artifacts = {};
    for (const id of required) {
      const fn = PUBLISHERS[id];
      if (!fn) {
        artifacts[id] = { ok: false, error: 'unknown_artifact', readBack: false };
        break;
      }
      const result = await fn(ctx);
      artifacts[id] = result;
      if (!result.ok) {
        await persistPublicationRecord({
          state: STATES().PUBLICATION_FAILED,
          path: ctx.path,
          requiredArtifacts: required,
          googleAccount: identity.email,
          artifacts,
          lastError: result,
        });
        return { ok: false, error: result.error || 'cloud_partial_publication', artifact: id, artifacts };
      }
    }
    const verified = required.every((id) => artifacts[id]?.ok && artifacts[id]?.readBack);
    if (!verified) {
      await persistPublicationRecord({
        state: STATES().PUBLICATION_FAILED,
        path: ctx.path,
        requiredArtifacts: required,
        artifacts,
        lastError: { error: 'cloud_readback_failed' },
      });
      return { ok: false, error: 'cloud_readback_failed', artifacts };
    }
    const record = {
      state: STATES().PUBLICATION_VERIFIED,
      path: ctx.path,
      requiredArtifacts: required,
      googleAccount: identity.email,
      verifiedAt: new Date().toISOString(),
      artifacts,
    };
    await persistPublicationRecord(record);
    return { ok: true, setupPublication: record, artifacts };
  }

  const PublicationGateService = {
    STATES,
    readLocalContext,
    persistPublicationRecord,
    verifyGoogleIdentity,
    prerequisitesMet,
    runSetupPublication,
    publishLicense,
    publishSettings,
    publishUsers,
    publishOutbox,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PublicationGateService;
  }
  global.PublicationGateService = PublicationGateService;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global);
