/**
 * Stage 13–14 — Setup publication orchestration (publish + authoritative remote verification).
 * Reuses DriveAdapter, LicenseCloud, ConfigLayer, SqliteOutboxBridge — no new cloud protocol.
 */
(function (global) {
  'use strict';

  const PC = () => global.PublicationContract;
  const RVC = () => global.ReadbackVerificationContract;
  const STATES = () => PC()?.STATES || {};
  const RB_STATES = () => RVC()?.STATES || {};
  const VERIFY_RETRY_MAX = 3;
  const VERIFY_RETRY_DELAY_MS = 40;

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

  async function persistReadbackVerificationRecord(patch) {
    const meta = global.DB?.get?.('__tdw_meta__', {}) || {};
    const prev = meta.readbackVerification && typeof meta.readbackVerification === 'object'
      ? meta.readbackVerification : {};
    const nextMeta = {
      ...meta,
      readbackVerification: {
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
    return { ok: true, readbackVerification: nextMeta.readbackVerification };
  }

  function delay(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
  }

  function stableContentHash(value) {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    let h = 0;
    for (let i = 0; i < raw.length; i++) {
      h = ((h << 5) - h) + raw.charCodeAt(i);
      h |= 0;
    }
    return `h${(h >>> 0).toString(16)}`;
  }

  function buildVerificationBinding(ctx, googleAccount) {
    const pack = global.ConfigLayer?.exportBranchPack?.(ctx.branchId);
    const contentBinding = stableContentHash({
      organizationId: ctx.centerId,
      branchId: ctx.branchId,
      deviceId: ctx.deviceId,
      centerName: ctx.centerName,
      phone: ctx.phone,
      licenseCenterId: ctx.license?.centerId,
      ownerId: (ctx.users || global.users || [])[0]?.id,
      settingsRevision: pack?.settings?.revision,
    });
    return {
      organizationId: ctx.centerId,
      branchId: ctx.branchId,
      deviceId: ctx.deviceId,
      googleAccount: String(googleAccount || '').trim().toLowerCase(),
      contentBinding,
      path: ctx.path,
    };
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

  async function remoteDownload(paths, options) {
    options = options || {};
    const list = Array.isArray(paths) ? paths.filter(Boolean) : [paths].filter(Boolean);
    if (!list.length) return { ok: false, error: 'cloud_artifact_missing' };
    const dlOpts = { bypassCache: true, ...options };
    if (typeof global.DriveAdapter?.downloadJsonFirst === 'function' && options.authoritative !== true) {
      return global.DriveAdapter.downloadJsonFirst(list, dlOpts);
    }
    return global.DriveAdapter.downloadJson(list[0], dlOpts);
  }

  /**
   * Stage 14 — scan all path candidates; never accept wrong-identity first hit.
   */
  async function remoteDownloadAuthoritative(paths, validateDoc, options) {
    options = options || {};
    const list = Array.isArray(paths) ? paths.filter(Boolean) : [paths].filter(Boolean);
    const validated = [];
    const wrongIdentity = [];
    const malformed = [];
    for (const p of list) {
      const res = await global.DriveAdapter?.downloadJson?.(p, { bypassCache: true, ...options });
      if (!res?.ok) continue;
      const parsed = parseRemoteJson(res);
      if (!parsed.ok) {
        malformed.push({ path: p, error: parsed.error });
        continue;
      }
      const verdict = validateDoc(parsed.doc, p);
      if (verdict?.ok) {
        validated.push({
          path: p,
          doc: parsed.doc,
          contentHash: stableContentHash(parsed.doc),
          ...verdict,
        });
      } else if (verdict?.error === 'cloud_identity_mismatch') {
        wrongIdentity.push({ path: p, ...verdict });
      } else {
        malformed.push({ path: p, ...verdict });
      }
    }
    if (!validated.length) {
      if (wrongIdentity.length) {
        return { ok: false, error: 'cloud_identity_mismatch', wrongIdentity, state: 'MISMATCH' };
      }
      if (malformed.length) {
        const primary = malformed.find((m) => m.error) || malformed[0];
        return {
          ok: false,
          error: primary.error || 'cloud_readback_failed',
          state: primary.state || 'MISMATCH',
          mismatches: malformed,
        };
      }
      return { ok: false, error: 'cloud_artifact_missing', state: 'MISSING' };
    }
    const hashes = new Set(validated.map((v) => v.contentHash));
    if (validated.length > 1 && hashes.size > 1) {
      return {
        ok: false,
        error: 'cloud_duplicate_artifact',
        state: 'DUPLICATE',
        duplicates: validated.map((v) => ({ path: v.path, contentHash: v.contentHash })),
      };
    }
    return { ok: true, ...validated[0], duplicateCount: validated.length };
  }

  async function verifyWithBoundedRetry(paths, validateDoc, options) {
    options = options || {};
    let last = { ok: false, error: 'cloud_readback_failed' };
    let prevHash = null;
    for (let attempt = 0; attempt < VERIFY_RETRY_MAX; attempt++) {
      const r = await remoteDownloadAuthoritative(paths, validateDoc, options);
      if (!r.ok) {
        last = r;
        if (attempt < VERIFY_RETRY_MAX - 1) await delay(VERIFY_RETRY_DELAY_MS);
        continue;
      }
      if (options.expectedContentHash && r.contentHash !== options.expectedContentHash) {
        last = { ok: false, error: 'cloud_stale_read', state: 'STALE', attempt, contentHash: r.contentHash };
        if (attempt < VERIFY_RETRY_MAX - 1) {
          await delay(VERIFY_RETRY_DELAY_MS);
          continue;
        }
        return last;
      }
      if (prevHash && prevHash !== r.contentHash) {
        return { ok: false, error: 'cloud_stale_read', state: 'STALE', unstable: true };
      }
      prevHash = r.contentHash;
      if (attempt < VERIFY_RETRY_MAX - 1) {
        const confirm = await remoteDownloadAuthoritative(paths, validateDoc, options);
        if (!confirm.ok) {
          last = confirm;
          await delay(VERIFY_RETRY_DELAY_MS);
          continue;
        }
        if (confirm.contentHash !== r.contentHash) {
          last = { ok: false, error: 'cloud_stale_read', state: 'STALE' };
          await delay(VERIFY_RETRY_DELAY_MS);
          continue;
        }
      }
      return { ...r, readBack: true, stable: true, attempts: attempt + 1 };
    }
    return last;
  }

  function compareRevision(localRev, remoteRev) {
    const lr = Number(localRev);
    const rr = Number(remoteRev);
    if (!Number.isFinite(lr) || !Number.isFinite(rr)) return { comparable: false };
    if (rr > lr) return { comparable: true, remoteNewer: true };
    if (lr > rr) return { comparable: true, localNewer: true };
    return { comparable: true, equal: true };
  }

  function validateLicenseDoc(doc, ctx, remotePath) {
    if (String(doc.centerId || '') !== ctx.centerId) {
      return { ok: false, error: 'cloud_identity_mismatch', state: 'MISMATCH', remotePath };
    }
    if (PC()?.isExistingBusinessOnCloud?.()) {
      const localCenter = String(ctx.license?.centerId || '').trim();
      const remoteCenter = String(doc.centerId || '').trim();
      if (localCenter && remoteCenter && localCenter !== remoteCenter) {
        return { ok: false, error: 'cloud_identity_mismatch', state: 'MISMATCH', activationAmbiguity: true };
      }
    }
    const branchOk = !ctx.branchId || (doc.branches || []).some((b) => b && b.id === ctx.branchId);
    if (!branchOk) return { ok: false, error: 'cloud_artifact_missing', state: 'MISSING', remotePath };
    return {
      ok: true,
      state: 'CONTENT_VERIFIED',
      organizationId: doc.centerId,
      branchId: ctx.branchId,
      remotePath,
    };
  }

  function validateSettingsDoc(doc, ctx, remotePath) {
    const orgId = String(doc.centerId || doc.organizationId || ctx.centerId || '').trim();
    if (orgId && orgId !== ctx.centerId) {
      return { ok: false, error: 'cloud_identity_mismatch', state: 'MISMATCH', remotePath };
    }
    const branchId = String(doc.branchId || doc.__tdwBranchState?.branchId || ctx.branchId || '').trim();
    if (branchId && ctx.branchId && branchId !== ctx.branchId) {
      return { ok: false, error: 'cloud_identity_mismatch', state: 'MISMATCH', remotePath };
    }
    const name = String(doc.centerName || doc.clinicName || doc.name || '').trim();
    const phone = String(doc.phone || doc.centerPhone || '').trim();
    if (ctx.centerName && name && name !== ctx.centerName) {
      return { ok: false, error: 'cloud_content_mismatch', state: 'MISMATCH', remotePath };
    }
    if (ctx.phone && phone && phone.replace(/\D/g, '') !== ctx.phone.replace(/\D/g, '')) {
      return { ok: false, error: 'cloud_content_mismatch', state: 'MISMATCH', remotePath };
    }
    const pack = global.ConfigLayer?.exportBranchPack?.(ctx.branchId);
    const localRev = pack?.settings?.revision;
    const remoteRev = doc.revision;
    const revCmp = compareRevision(localRev, remoteRev);
    if (revCmp.comparable && revCmp.remoteNewer && !revCmp.equal) {
      const remoteHash = stableContentHash({ centerName: name, phone });
      const localHash = stableContentHash({ centerName: ctx.centerName, phone: ctx.phone });
      if (remoteHash !== localHash) {
        return {
          ok: false,
          error: 'cloud_revision_conflict',
          state: 'CONFLICT',
          revisionConflict: { local: localRev, remote: remoteRev },
          remotePath,
        };
      }
    }
    if (revCmp.comparable && revCmp.localNewer && remoteRev != null && !revCmp.equal) {
      return { ok: false, error: 'cloud_stale_read', state: 'STALE', revisionConflict: { local: localRev, remote: remoteRev } };
    }
    return {
      ok: true,
      state: 'CONTENT_VERIFIED',
      organizationId: ctx.centerId,
      branchId: ctx.branchId,
      centerName: name || ctx.centerName,
      phone: phone || ctx.phone,
      remotePath,
    };
  }

  function validateUsersDoc(doc, ctx, remotePath) {
    const remoteUsers = Array.isArray(doc) ? doc : [];
    const owner = remoteUsers.find((u) => u && ['owner', 'hq_admin'].includes(String(u.role || '').toLowerCase())
      && u.seedDefaultPassword !== true);
    if (!owner) return { ok: false, error: 'cloud_readback_failed', state: 'MISMATCH', remotePath };
    if (owner.password && !/^(?:pbkdf2:|pbkdf2v2:|b64:)/i.test(String(owner.password))) {
      return { ok: false, error: 'cloud_content_mismatch', state: 'MISMATCH', remotePath };
    }
    const localOwner = (ctx.users || global.users || global.DB?.get?.('users', []) || [])
      .find((u) => u && ['owner', 'hq_admin'].includes(String(u.role || '').toLowerCase())
        && u.seedDefaultPassword !== true);
    if (localOwner?.id && owner.id && localOwner.id !== owner.id) {
      return { ok: false, error: 'cloud_identity_mismatch', state: 'MISMATCH', remotePath };
    }
    const revCmp = compareRevision(localOwner?.credentialRevision, owner.credentialRevision);
    if (revCmp.comparable && revCmp.remoteNewer && owner.credentialRevision != null) {
      return {
        ok: false,
        error: 'cloud_revision_conflict',
        state: 'CONFLICT',
        revisionConflict: { local: localOwner?.credentialRevision, remote: owner.credentialRevision },
      };
    }
    return {
      ok: true,
      state: 'CONTENT_VERIFIED',
      organizationId: ctx.centerId,
      branchId: ctx.branchId,
      ownerId: owner.id,
      remotePath,
    };
  }

  async function verifyLicenseArtifact(ctx, options) {
    options = options || {};
    options = options || {};
    const paths = global.DriveLayout?.licenseJsonCandidates?.(ctx.centerId)
      || [global.DriveLayout?.licenseJson?.(ctx.centerId)].filter(Boolean);
    const r = await verifyWithBoundedRetry(paths, (doc, p) => validateLicenseDoc(doc, ctx, p), options);
    return { ...r, artifact: 'license' };
  }

  async function verifySettingsArtifact(ctx, options) {
    options = options || {};
    if (PC()?.isExistingBusinessOnCloud?.()) {
      return { ok: true, artifact: 'settings', state: 'NOT_REQUIRED', readBack: true, skippedVerify: true };
    }
    const remotePath = global.ConfigLayer?.drivePathForFile?.(ctx.centerId, ctx.branchId, 'settings.json');
    const paths = global.DriveLayout?.configBranchFileCandidates?.(ctx.centerId, ctx.branchId, 'settings.json')
      || [remotePath].filter(Boolean);
    const expectedHash = options.expectedContentHash || null;
    const r = await verifyWithBoundedRetry(
      paths,
      (doc, p) => validateSettingsDoc(doc, ctx, p),
      { ...options, expectedContentHash: expectedHash },
    );
    return { ...r, artifact: 'settings' };
  }

  async function verifyUsersArtifact(ctx, options) {
    options = options || {};
    if (PC()?.isExistingBusinessOnCloud?.()) {
      return { ok: true, artifact: 'users', state: 'NOT_REQUIRED', readBack: true, skippedVerify: true };
    }
    const usersPath = global.ConfigLayer?.drivePathForFile?.(ctx.centerId, ctx.branchId, 'users.json');
    const paths = global.DriveLayout?.configBranchFileCandidates?.(ctx.centerId, ctx.branchId, 'users.json')
      || [usersPath].filter(Boolean);
    const r = await verifyWithBoundedRetry(paths, (doc, p) => validateUsersDoc(doc, ctx, p), options);
    return { ...r, artifact: 'users' };
  }

  async function verifyOutboxArtifact(ctx) {
    if (!global.SqliteOutboxBridge?.getPendingCount) {
      return { ok: true, artifact: 'outbox', state: 'CONTENT_VERIFIED', readBack: true, note: 'no_pending_counter' };
    }
    const pending = Number(await global.SqliteOutboxBridge.getPendingCount?.() || 0);
    if (pending > 0) {
      return { ok: false, error: 'cloud_partial_publication', artifact: 'outbox', state: 'PENDING', pending };
    }
    return { ok: true, artifact: 'outbox', state: 'CONTENT_VERIFIED', readBack: true, pending: 0 };
  }

  const VERIFIERS = {
    license: verifyLicenseArtifact,
    settings: verifySettingsArtifact,
    users: verifyUsersArtifact,
    outbox: verifyOutboxArtifact,
  };

  async function verifyPublishedArtifacts(ctx, options) {
    options = options || {};
    const identity = options.skipIdentityCheck ? { ok: true, email: options.googleAccount } : await verifyGoogleIdentity();
    if (!identity.ok) {
      return { ok: false, error: identity.error || 'cloud_identity_mismatch', identityMismatch: true, diagnostics: [identity] };
    }
    const binding = buildVerificationBinding(ctx, identity.email);
    const required = PC()?.requiredArtifactsForPath?.(ctx.path) || [];
    const artifacts = {};
    const diagnostics = [];
    for (const id of required) {
      const fn = VERIFIERS[id];
      if (!fn) {
        artifacts[id] = { ok: false, error: 'unknown_artifact', state: 'FAILED' };
        break;
      }
      const result = await fn(ctx, { ...options, googleAccount: identity.email });
      artifacts[id] = result;
      if (!result.ok) {
        diagnostics.push({ artifact: id, code: result.error, state: result.state });
        break;
      }
    }
    const verified = required.every((id) => {
      const st = String(artifacts[id]?.state || '');
      return artifacts[id]?.ok === true
        && (st === 'CONTENT_VERIFIED' || st === 'IDENTITY_VERIFIED' || st === 'NOT_REQUIRED');
    });
    const record = {
      state: verified ? RB_STATES().VERIFIED : RB_STATES().FAILED,
      path: ctx.path,
      requiredArtifacts: required,
      binding,
      googleAccount: identity.email,
      verifiedAt: verified ? new Date().toISOString() : null,
      artifacts,
      diagnostics,
      identityMismatch: diagnostics.some((d) => d.code === 'cloud_identity_mismatch'),
    };
    if (!options.dryRun) await persistReadbackVerificationRecord(record);
    return verified
      ? { ok: true, readbackVerification: record, artifacts, binding }
      : {
        ok: false,
        error: diagnostics[0]?.code || 'cloud_readback_failed',
        readbackVerification: record,
        artifacts,
        diagnostics,
      };
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
    const hardened = await verifyPublishedArtifacts(ctx, {
      googleAccount: identity.email,
      skipStableCheck: options.skipStableCheck,
    });
    if (!hardened?.ok) {
      await persistPublicationRecord({
        ...record,
        state: STATES().PUBLICATION_FAILED,
        lastError: { error: hardened.error, readBack: false, hardened: true },
      });
      return {
        ok: false,
        error: hardened.error || 'cloud_readback_failed',
        artifacts,
        readbackVerification: hardened.readbackVerification,
        publicationPublished: true,
      };
    }
    return {
      ok: true,
      setupPublication: record,
      artifacts,
      readbackVerification: hardened.readbackVerification,
    };
  }

  async function runReadbackVerification(options) {
    options = options || {};
    const ctx = readLocalContext();
    if (!PC()?.isResolved?.({ meta: ctx.meta, setupPublication: ctx.meta.setupPublication, path: ctx.path })
      && !options.allowWithoutPublication) {
      return { ok: false, error: 'publication_not_resolved' };
    }
    if (RVC()?.isVerified?.({ meta: ctx.meta, readbackVerification: ctx.meta.readbackVerification })) {
      return { ok: true, already: true, readbackVerification: ctx.meta.readbackVerification };
    }
    return verifyPublishedArtifacts(ctx, options);
  }

  const PublicationGateService = {
    STATES,
    readLocalContext,
    persistPublicationRecord,
    persistReadbackVerificationRecord,
    buildVerificationBinding,
    stableContentHash,
    verifyGoogleIdentity,
    prerequisitesMet,
    runSetupPublication,
    runReadbackVerification,
    verifyPublishedArtifacts,
    publishRequiredArtifacts: async (ctx, options) => {
      const required = PC()?.requiredArtifactsForPath?.(ctx.path || 'new') || [];
      const artifacts = {};
      for (const id of required) {
        const fn = PUBLISHERS[id];
        if (!fn) return { ok: false, error: 'unknown_artifact', artifact: id };
        const result = await fn(ctx);
        artifacts[id] = result;
        if (!result.ok) return { ok: false, error: result.error, artifact: id, artifacts };
      }
      return { ok: true, artifacts };
    },
    remoteDownloadAuthoritative,
    verifyWithBoundedRetry,
    publishLicense,
    publishSettings,
    publishUsers,
    publishOutbox,
    verifyLicenseArtifact,
    verifySettingsArtifact,
    verifyUsersArtifact,
    verifyOutboxArtifact,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PublicationGateService;
  }
  global.PublicationGateService = PublicationGateService;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global);
