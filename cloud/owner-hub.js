/**
 * Owner Hub — view for managers; mutate (license push, branches, devices, transfer) is Owner-only.
 */
(function (global) {
  'use strict';

  function injectStyles() {
    if (document.getElementById('owner-hub-styles')) return;
    const s = document.createElement('style');
    s.id = 'owner-hub-styles';
    s.textContent = `
.oh-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-bottom:16px}
.oh-card{border:1px solid var(--border);border-radius:12px;padding:16px;background:var(--card)}
.oh-card h4{margin:0 0 8px;font-size:13px;font-weight:800;color:var(--text-muted)}
.oh-card .oh-val{font-size:20px;font-weight:900;color:var(--primary);line-height:1.3}
.oh-devices{display:grid;gap:8px;margin-top:8px}
.oh-device{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:10px;background:var(--surface);border:1px solid var(--border);font-size:13px;flex-wrap:wrap}
.oh-device-name{font-weight:700}
.oh-muted{font-size:12px;color:var(--text-muted)}
.oh-branch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-top:10px}
.oh-branch-card{padding:14px;border-radius:10px;border:1px solid var(--border);background:var(--surface)}
.oh-branch-card h5{margin:0 0 6px;font-size:14px;font-weight:800;color:var(--primary)}
.oh-path{font-size:10px;word-break:break-all;color:var(--text-muted);direction:ltr;margin-top:6px}
.oh-section-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;position:sticky;top:0;z-index:3;padding:8px 0;background:var(--bg,var(--surface))}
.oh-section-tab{min-height:44px}
.oh-section-panel{min-height:0}
@media (max-width:1024px){.oh-grid{grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}}
@media (max-width:768px){.oh-grid,.oh-branch-grid{grid-template-columns:1fr}}
`;
    document.head.appendChild(s);
  }

  function formatAgo(iso) {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return 'الآن';
    const min = Math.floor(ms / 60000);
    if (min < 2) return 'الآن';
    if (min < 60) return `${min} د`;
    const hr = Math.floor(min / 60);
    if (hr < 48) return `${hr} س`;
    return `${Math.floor(hr / 24)} ي`;
  }

  function deviceStatus(lastSeenAt) {
    if (!lastSeenAt) return { icon: '⚪', label: 'غير معروف' };
    const min = (Date.now() - new Date(lastSeenAt).getTime()) / 60000;
    if (min <= 10) return { icon: '🟢', label: formatAgo(lastSeenAt) };
    if (min <= 1440) return { icon: '🟡', label: formatAgo(lastSeenAt) };
    return { icon: '🔴', label: formatAgo(lastSeenAt) };
  }

  function canAccess() {
    const u = global.currentUser;
    if (!u) return false;
    if (global.RolePolicy?.isManager?.(u)) return true;
    if (u.isDev) return true;
    const cv2 = global.CloudMeta?.isCloudV2Enabled?.() || global.settings?.cloudV2Enabled;
    if (!cv2) return false;
    if (u.role === 'accountant') {
      const scope = global.BranchScope?.getUserBranchScope?.(u) || [];
      return scope.includes('*') || scope.length > 1;
    }
    return false;
  }

  function isCloudV2Ready() {
    return !!(global.CloudMeta?.isCloudV2Enabled?.() || global.settings?.cloudV2Enabled);
  }

  function branchDrivePath(centerId, branch) {
    const folder = global.DriveLayout?.resolveBranchFolderName?.(branch.id, branch.name)
      || branch.name || branch.id;
    const centerFolder = global.DriveLayout?.centerFolderName?.(centerId) || centerId;
    return `NajjarTech/${centerFolder}/Branches/${folder}/`;
  }

  function buildAnalyticsSummary(model) {
    const devices = model.devices || [];
    const online = devices.filter((d) => {
      if (!d?.lastSeenAt) return false;
      return (Date.now() - new Date(d.lastSeenAt).getTime()) / 60000 <= 10;
    }).length;
    const stale = devices.filter((d) => {
      if (!d?.lastSeenAt) return true;
      return (Date.now() - new Date(d.lastSeenAt).getTime()) / 60000 > 1440;
    }).length;
    const conflictsPending = global.ConflictQueue?.countPending?.() || 0;
    const syncPaused = !!global.SyncGuard?.isPaused?.();
    const auditRecent = (global.AuditLogger?.query?.() || []).slice(0, 20);
    const branchStats = (model.branches || []).map((b) => ({
      branchId: b.id,
      name: b.name || b.id,
      devices: devices.filter((d) => d.branchId === b.id).length,
      lockedHere: model.lockedBranch === b.id
    }));
    const health = syncPaused
      ? 'paused'
      : (model.sync?.lastError ? 'degraded' : (model.sync?.online === false ? 'offline' : 'healthy'));

    const outbox = model.outboxCounts || {};
    const pendingFromOutbox = Number(outbox.pending || 0) + Number(outbox.inflight || 0);
    const deadLetters = Number(outbox['dead-letter'] || 0);

    return {
      health,
      onlineDevices: online,
      staleDevices: stale,
      conflictsPending,
      syncPaused,
      pendingPushes: pendingFromOutbox || (model.sync?.pending ?? 0),
      deadLetters,
      outboxCounts: outbox,
      auditRecentCount: auditRecent.length,
      lastAuditAt: auditRecent[0]?.at || auditRecent[0]?.timestamp || null,
      branchStats
    };
  }

  function buildModel() {
    const license = global.LicenseCloud?.loadLocal?.() || {};
    const devices = global.DeviceRegistry?.listDevices?.(license) || [];
    const pendingDevices = global.DeviceRegistry?.listPending?.(license) || [];
    const sync = global.SyncEngine?.getStatus?.() || global.SyncState?.getStatus?.() || {};
    const backup = global.BackupLayer?.getStatus?.() || {};
    const branches = (license.branches || []).filter(b => b && b.active !== false);
    const activeUsers = (global.users || []).filter(u => u && u.active).length;
    const centerId = license.centerId || global.ConfigLayer?.getCenterId?.() || '—';
    const lockedBranch = global.DeviceConfig?.getLockedBranchId?.() || '—';
    const pollSec = Math.round((sync.pollIntervalMs || global.SyncState?.DEFAULT_POLL_MS || 15000) / 1000);
    const identity = global.LicenseIdentity?.formatIdentityStatus?.(license) || {};

    let licLabel = '—';
    const licDoc = license || {};
    if (global._licStatus === 'valid' && (licDoc.expiresAt || licDoc.centerId)) {
      licLabel = `✅ نشط${licDoc.expiresAt ? ' — ينتهي ' + licDoc.expiresAt : ''}`;
    } else if (licDoc.centerId && (licDoc.activation?.consumed || licDoc.branches?.length)) {
      licLabel = `✅ ${licDoc.centerName || licDoc.centerId}`;
    } else if (global._licStatus === 'expired') {
      licLabel = '🔴 منتهي';
    } else if (global._licStatus === 'none') {
      licLabel = '⚪ غير مفعّل';
    }

    const model = {
      license,
      licLabel,
      devices,
      pendingDevices,
      deviceCount: global.LicenseLimits?.formatDeviceCount?.(devices.length, license.limits)
        || `${devices.length}/${license.limits?.maxDevices ?? '?'}`,
      sync,
      backup,
      branches,
      activeUsers,
      centerId,
      lockedBranch,
      pollSec,
      identity,
      outboxCounts: null
    };
    model.analytics = buildAnalyticsSummary(model);
    // Best-effort durable outbox counts for Owner Hub observability
    if (global.SqliteOutboxBridge?.counts) {
      Promise.resolve(global.SqliteOutboxBridge.counts(null))
        .then((res) => {
          if (res?.ok && res.counts) model.outboxCounts = res.counts;
        })
        .catch(() => {});
    }
    return model;
  }

  function buildDiagnosticsSnapshot() {
    const model = buildModel();
    const a = model.analytics || {};
    return {
      generatedAt: new Date().toISOString(),
      centerId: model.centerId,
      cloudV2Enabled: isCloudV2Ready(),
      license: {
        label: model.licLabel,
        expiresAt: model.license?.expiresAt || null,
        branches: model.branches.map((b) => b.id),
        maxDevices: model.license?.limits?.maxDevices ?? null
      },
      devices: {
        total: model.devices.length,
        online: a.onlineDevices,
        stale: a.staleDevices,
        list: model.devices.map((d) => ({
          name: d.deviceName || null,
          branchId: d.branchId || null,
          lastSeenAt: d.lastSeenAt || null
        }))
      },
      sync: {
        health: a.health,
        online: model.sync?.online !== false,
        running: !!model.sync?.running,
        pendingPushes: a.pendingPushes,
        conflictsPending: a.conflictsPending,
        syncPaused: a.syncPaused,
        lastPushAt: model.sync?.lastPushAt || null,
        lastPollAt: model.sync?.lastPollAt || null,
        lastError: model.sync?.lastError || null,
        pollIntervalMs: model.sync?.pollIntervalMs || null
      },
      backup: {
        enabled: model.backup?.enabled !== false,
        lastAutoBackupAt: model.backup?.lastAutoBackupAt || null,
        due: !!model.backup?.due
      },
      audit: {
        recentCount: a.auditRecentCount,
        lastAuditAt: a.lastAuditAt
      },
      branches: a.branchStats
    };
  }

  async function resignLicenseDoc(doc) {
    if (Number(doc?.schemaVersion) === 6) {
      throw new Error('license_document_immutable_admin_signature_required');
    }
    if (!global.LicenseCloud?.resignDoc) throw new Error('legacy_license_signer_unavailable');
    return global.LicenseCloud.resignDoc({ ...doc, updatedAt: new Date().toISOString() });
  }

  async function saveLicenseDoc(doc) {
    let signed = doc;
    if (Number(doc?.schemaVersion) !== 6) signed = await resignLicenseDoc(doc);
    const checked = await global.LicenseCloud?.verifyLicenseDoc?.(signed);
    if (checked?.ok !== true) {
      return {
        ok: false,
        error: 'license_document_immutable_admin_signature_required',
        verificationError: checked?.error || 'signature_invalid',
      };
    }
    global.LicenseCloud?.saveLocal?.(signed);
    if (global.DriveAdapter?.isConnected?.()) {
      const pushed = await global.LicenseCloud?.pushToDrive?.(signed).catch((error) => ({
        ok: false,
        error: error?.message || String(error),
      }));
      if (pushed?.ok === false) return pushed;
      signed = pushed?.signed || signed;
    }
    return signed;
  }

  function requireOwnerManage(actionLabel) {
    const user = global.currentUser;
    if (!user || !global.RolePolicy?.canManageOrganization?.(user)) {
      global.notify?.(`⛔ صلاحية المالك مطلوبة — ${actionLabel || ''}`.trim(), 'danger');
      return false;
    }
    return true;
  }

  /** Managers may bootstrap Owner Profile when none exists yet (first activation / legacy). */
  function requireOwnerBootstrap(actionLabel) {
    const user = global.currentUser;
    if (global.RolePolicy?.canManageOrganization?.(user)) return true;
    if (global.RolePolicy?.canBootstrapOwner?.(user)) return true;
    if (global.RolePolicy?.isManager?.(user) && !global.OwnerProfile?.hasProfile?.()) return true;
    global.notify?.(`⛔ صلاحية المدير/المالك مطلوبة — ${actionLabel || ''}`.trim(), 'danger');
    return false;
  }

  async function pushLicenseToDriveNow() {
    const user = global.currentUser;
    const allowed = global.RolePolicy?.canManageOrganization?.(user)
      || global.RolePolicy?.canBootstrapOwner?.(user)
      || (global.RolePolicy?.isManager?.(user) && !global.OwnerProfile?.hasProfile?.());
    if (!allowed) {
      global.notify?.('⛔ صلاحية المالك مطلوبة — رفع الترخيص إلى Drive', 'danger');
      return { ok: false, error: 'owner_required' };
    }
    if (typeof global.DriveAdapter?.ensureConnected === 'function') {
      await global.DriveAdapter.ensureConnected().catch(() => false);
    }
    if (!global.DriveAdapter?.isConnected?.()) {
      global.notify?.('⚠️ اربط Google Drive أولاً من الإعدادات', 'warning');
      return { ok: false, error: 'drive_not_connected' };
    }
    const res = typeof global.LicenseCloud?.ensurePushedToDrive === 'function'
      ? await global.LicenseCloud.ensurePushedToDrive()
      : await global.LicenseCloud?.pushToDrive?.();
    if (res?.ok) {
      global.notify?.('☁️ تم رفع license.json إلى Google Drive', 'success');
    } else {
      global.notify?.('⚠️ فشل رفع الترخيص: ' + (res?.error || res?.message || 'unknown'), 'danger');
    }
    refresh();
    return res || { ok: false };
  }

  async function renameDevice(deviceUuid, nextName) {
    if (!requireOwnerManage('إعادة تسمية جهاز')) return { ok: false, error: 'owner_required' };
    const doc = global.LicenseCloud?.loadLocal?.();
    if (!doc) return { ok: false, error: 'no_license' };
    const name = String(nextName || '').trim();
    if (!name) return { ok: false, error: 'name_required' };
    if (!global.DeviceRegistry?.touchDevice) return { ok: false, error: 'device_registry_unavailable' };
    const saved = await global.DeviceRegistry.touchDevice(doc, deviceUuid, {
      deviceName: name,
      updatedAt: new Date().toISOString(),
    });
    if (!saved?.ok) return saved;
    global.AuditLogger?.log?.({
      action: 'DEVICE_RENAMED',
      entity: 'device',
      entityId: deviceUuid,
      summary: `Device renamed to ${name}`
    });
    return { ok: true, doc, device: saved.device };
  }

  async function disableDevice(deviceUuid) {
    if (!requireOwnerManage('تعطيل جهاز')) return { ok: false, error: 'owner_required' };
    if (global.DeviceRegistry?.revokeDevice) {
      return global.DeviceRegistry.revokeDevice(deviceUuid, { reason: 'owner_hub_disable' });
    }
    const doc = global.LicenseCloud?.loadLocal?.();
    if (!doc) return { ok: false, error: 'no_license' };
    const list = Array.isArray(doc?.devices?.registered) ? doc.devices.registered.slice() : [];
    const idx = list.findIndex((d) => d && d.deviceUuid === deviceUuid);
    if (idx < 0) return { ok: false, error: 'device_not_found' };
    list[idx] = { ...list[idx], active: false, status: 'revoked', disabledAt: new Date().toISOString() };
    doc.devices = { registered: list };
    doc.licenseVersion = (Number(doc.licenseVersion) || 0) + 1;
    const saved = await saveLicenseDoc(doc);
    global.AuditLogger?.log?.({
      action: 'DEVICE_DISABLED',
      entity: 'device',
      entityId: deviceUuid,
      summary: `Device disabled: ${list[idx].deviceName || deviceUuid}`
    });
    return { ok: true, doc: saved, device: list[idx] };
  }

  async function approveDevice(deviceUuid, options) {
    if (!requireOwnerManage('اعتماد جهاز')) return { ok: false, error: 'owner_required' };
    if (!global.DeviceRegistry?.approveDevice) return { ok: false, error: 'approve_unavailable' };
    return global.DeviceRegistry.approveDevice(deviceUuid, options || {});
  }

  async function revokeDevice(deviceUuid, options) {
    if (!requireOwnerManage('إلغاء ربط جهاز')) return { ok: false, error: 'owner_required' };
    if (!global.DeviceRegistry?.revokeDevice) return { ok: false, error: 'revoke_unavailable' };
    return global.DeviceRegistry.revokeDevice(deviceUuid, options || {});
  }

  async function deleteDevice(deviceUuid) {
    if (!requireOwnerManage('حذف جهاز')) return { ok: false, error: 'owner_required' };
    const doc = global.LicenseCloud?.loadLocal?.();
    if (!doc) return { ok: false, error: 'no_license' };
    if (!global.DeviceRegistry?.touchDevice) return { ok: false, error: 'device_registry_unavailable' };
    const previous = global.DeviceRegistry.findDevice?.(doc, deviceUuid);
    if (!previous) return { ok: false, error: 'device_not_found' };
    const saved = await global.DeviceRegistry.touchDevice(doc, deviceUuid, {
      active: false,
      status: 'revoked',
      deletedAt: new Date().toISOString(),
      removed: true,
    });
    if (!saved?.ok) return saved;
    global.AuditLogger?.log?.({
      action: 'DEVICE_DELETED',
      entity: 'device',
      entityId: deviceUuid,
      summary: `Device deleted: ${previous?.deviceName || deviceUuid}`
    });
    return { ok: true, doc, device: saved.device };
  }

  async function addBranch(name) {
    if (!requireOwnerManage('إضافة فرع')) return { ok: false, error: 'owner_required' };
    name = String(name || '').trim();
    if (!name) return { ok: false, error: 'name_required' };
    const doc = global.LicenseCloud?.loadLocal?.();
    if (!doc) return { ok: false, error: 'no_license' };
    if (Number(doc.schemaVersion) === 6) return {
      ok: false, error: 'license_branch_entitlement_missing_admin_reissue_required', requiresAdminReissue: true
    };
    if (!global.BranchEnrollment?.enrollBranch) return { ok: false, error: 'enrollment_unavailable' };
    const enroll = await global.BranchEnrollment.enrollBranch(doc, {
      branchName: name,
      source: 'owner_hub',
      deviceUuid: global.DeviceConfig?.ensureDeviceUuid?.(),
      idempotencyKey: 'oh-add-' + name
    });
    if (!enroll?.ok) return enroll;
    return { ok: true, doc: enroll.doc, branch: enroll.branch };
    /* Retired unsigned enrollment path.
    if (!global.BranchEnrollment?.enrollBranch) {
      return { ok: false, error: 'enrollment_unavailable' };
    }
    // Unify ID scheme with BranchEnrollment (BR-MAIN / BR02…) — never bypass gate.
    const enroll = await global.BranchEnrollment.enrollBranch(doc, {
      branchName: name,
      source: 'owner_hub',
      deviceUuid: global.DeviceConfig?.ensureDeviceUuid?.()
    });
    if (!enroll?.ok) {
      return {
        ok: false,
        error: enroll?.error || 'enroll_failed',
        max: enroll?.max,
        current: enroll?.current
      };
    }
    global.AuditLogger?.log?.({
      action: 'BRANCH_ADDED',
      entity: 'branch',
      entityId: enroll.branch?.id,
      summary: `Branch added via Owner Hub: ${name}`
    });
    return { ok: true, doc: enroll.doc, branch: enroll.branch };
    */
  }

  async function renameBranch(branchId, nextName) {
    if (!requireOwnerManage('إعادة تسمية فرع')) return { ok: false, error: 'owner_required' };
    const name = String(nextName || '').trim();
    if (!name) return { ok: false, error: 'name_required' };
    const doc = global.LicenseCloud?.loadLocal?.();
    if (!doc) return { ok: false, error: 'no_license' };
    if (Number(doc.schemaVersion) === 6) return { ok: false, error: 'license_document_immutable_admin_signature_required', requiresAdminReissue: true };
    const list = (doc.branches || []).slice();
    const idx = list.findIndex((branch) => branch && branch.id === branchId);
    if (idx < 0) return { ok: false, error: 'branch_not_found' };
    list[idx] = { ...list[idx], name, updatedAt: new Date().toISOString() };
    const saved = await saveLicenseDoc({ ...doc, branches: list, licenseVersion: (Number(doc.licenseVersion) || 0) + 1 });
    if (saved?.ok === false) return saved;
    return { ok: true, doc: saved, branch: list[idx] };
    /* Retired unsigned entitlement mutation path.
    const list = (doc.branches || []).slice();
    const idx = list.findIndex((b) => b && b.id === branchId);
    if (idx < 0) return { ok: false, error: 'branch_not_found' };
    list[idx] = { ...list[idx], name, updatedAt: new Date().toISOString() };
    doc.branches = list;
    doc.licenseVersion = (Number(doc.licenseVersion) || 0) + 1;
    const saved = await saveLicenseDoc(doc);
    global.AuditLogger?.log?.({
      action: 'BRANCH_RENAMED',
      entity: 'branch',
      entityId: branchId,
      summary: `Branch renamed to ${name}`
    });
    return { ok: true, doc: saved, branch: list[idx] };
    */
  }

  async function disableBranch(branchId) {
    if (!requireOwnerManage('تعطيل فرع')) return { ok: false, error: 'owner_required' };
    const doc = global.LicenseCloud?.loadLocal?.();
    if (!doc) return { ok: false, error: 'no_license' };
    if (Number(doc.schemaVersion) === 6) return { ok: false, error: 'license_document_immutable_admin_signature_required', requiresAdminReissue: true };
    const list = (doc.branches || []).slice();
    const idx = list.findIndex((branch) => branch && branch.id === branchId);
    if (idx < 0) return { ok: false, error: 'branch_not_found' };
    const activeCount = list.filter((branch) => branch && branch.active !== false && !branch.removed).length;
    if (activeCount <= 1 && list[idx].active !== false) return { ok: false, error: 'last_active_branch_required' };
    list[idx] = { ...list[idx], active: false, disabledAt: new Date().toISOString() };
    const saved = await saveLicenseDoc({ ...doc, branches: list, licenseVersion: (Number(doc.licenseVersion) || 0) + 1 });
    if (saved?.ok === false) return saved;
    return { ok: true, doc: saved, branch: list[idx] };
    /* Retired unsigned entitlement mutation path.
    const list = (doc.branches || []).slice();
    const idx = list.findIndex((b) => b && b.id === branchId);
    if (idx < 0) return { ok: false, error: 'branch_not_found' };
    list[idx] = { ...list[idx], active: false, disabledAt: new Date().toISOString() };
    doc.branches = list;
    doc.licenseVersion = (Number(doc.licenseVersion) || 0) + 1;
    const saved = await saveLicenseDoc(doc);
    global.AuditLogger?.log?.({
      action: 'BRANCH_DISABLED',
      entity: 'branch',
      entityId: branchId,
      summary: `Branch disabled: ${list[idx].name || branchId}`
    });
    return { ok: true, doc: saved, branch: list[idx] };
    */
  }

  async function deleteBranch(branchId) {
    if (!requireOwnerManage('حذف فرع')) return { ok: false, error: 'owner_required' };
    const doc = global.LicenseCloud?.loadLocal?.();
    if (!doc) return { ok: false, error: 'no_license' };
    if (Number(doc.schemaVersion) === 6) return { ok: false, error: 'license_document_immutable_admin_signature_required', requiresAdminReissue: true };
    const list = (doc.branches || []).slice();
    const idx = list.findIndex((branch) => branch && branch.id === branchId);
    if (idx < 0) return { ok: false, error: 'branch_not_found' };
    const activeCount = list.filter((branch) => branch && branch.active !== false && !branch.removed).length;
    if (activeCount <= 1 && list[idx].active !== false) return { ok: false, error: 'last_active_branch_required' };
    list[idx] = { ...list[idx], active: false, removed: true, deletedAt: new Date().toISOString() };
    const saved = await saveLicenseDoc({ ...doc, branches: list, licenseVersion: (Number(doc.licenseVersion) || 0) + 1 });
    if (saved?.ok === false) return saved;
    return { ok: true, doc: saved, branch: list[idx] };
    /* Retired unsigned entitlement mutation path.
    const list = (doc.branches || []).slice();
    const idx = list.findIndex((b) => b && b.id === branchId);
    if (idx < 0) return { ok: false, error: 'branch_not_found' };
    const prev = list[idx];
    list[idx] = { ...list[idx], active: false, deletedAt: new Date().toISOString(), removed: true };
    doc.branches = list;
    doc.licenseVersion = (Number(doc.licenseVersion) || 0) + 1;
    const saved = await saveLicenseDoc(doc);
    global.AuditLogger?.log?.({
      action: 'BRANCH_DELETED',
      entity: 'branch',
      entityId: branchId,
      summary: `Branch deleted: ${prev?.name || branchId}`
    });
    return { ok: true, doc: saved, branch: list[idx] };
    */
  }

  async function promptAddBranch() {
    const name = await global.tdwAskText?.({ title: 'إدخال', message: 'اسم الفرع الجديد' });
    if (!name) return;
    const configSource = await global.tdwAskText?.({
      title: 'إعدادات الفرع',
      message: 'مصدر الإعدادات: org_defaults | copy_branch | empty',
      defaultValue: 'org_defaults',
      hint: 'لا تُنسخ العملاء/الفواتير/الحضور. الإعدادات فقط (خدمات/أسعار/باقات حسب المصدر).',
      required: false,
    });
    const src = ['org_defaults', 'copy_branch', 'empty'].includes(String(configSource || '').trim())
      ? String(configSource).trim()
      : 'org_defaults';
    if (!requireOwnerManage('إضافة فرع')) return;
    const doc = global.LicenseCloud?.loadLocal?.();
    const enroll = await global.BranchEnrollment?.enrollBranch?.(doc, {
      branchName: name,
      source: 'owner_hub',
      configSource: src,
      deviceUuid: global.DeviceConfig?.ensureDeviceUuid?.(),
      idempotencyKey: 'oh-add-' + name + '-' + Date.now(),
    });
    if (!enroll?.ok) {
      if (enroll?.error === 'BRANCH_CREATION_PENDING' || enroll?.pending) {
        global.notify?.('⚠️ الفرع بحالة BRANCH_CREATION_PENDING — أكمل رفع الترخيص قبل العمل التشغيلي', 'warning');
      } else {
        global.notify?.('⚠️ تعذّر إضافة الفرع: ' + (enroll?.error || 'unknown'), 'warning');
      }
      refresh();
      return;
    }
    const branchId = enroll.branch?.id;
    if (branchId) {
      try { global.BranchSummary?.refreshBranchSummary?.(branchId); } catch { /* empty */ }
      const mode = global.OwnerBranchMode?.enterBranchMode?.(branchId);
      if (mode?.ok) {
        global.notify?.(
          '✅ فرع «' + name + '» ذرّي وفارغ تشغيلياً. Branch Mode مفعّل (بدون تغيير ربط الجهاز).',
          'success'
        );
        try {
          if (typeof global.refreshClientsView === 'function') global.refreshClientsView(true);
          if (typeof global.syncAppGlobals === 'function') global.syncAppGlobals();
        } catch { /* empty */ }
      } else {
        global.notify?.('✅ تم إنشاء الفرع. ادخل Branch Mode قبل أي كتابة تشغيلية.', 'success');
      }
    } else {
      global.notify?.('✅ تم إضافة الفرع', 'success');
    }
    refresh();
  }

  async function promptRenameBranch(branchId, currentName) {
    const name = await global.tdwAskText?.({ title: 'إدخال', message: 'الاسم الجديد للفرع', defaultValue: currentName || '' });
    if (!name) return;
    const res = await renameBranch(branchId, name);
    if (!res?.ok) {
      global.notify?.('⚠️ تعذّر إعادة تسمية الفرع: ' + (res.error || 'unknown'), 'warning');
      return;
    }
    global.notify?.('✅ تم تحديث الفرع', 'success');
    refresh();
  }

  async function promptDisableBranch(branchId) {
    if (!(await global.tdwConfirm?.({ message: 'تعطيل هذا الفرع؟' }))) return;
    const res = await disableBranch(branchId);
    if (!res?.ok) {
      global.notify?.('⚠️ تعذّر تعطيل الفرع: ' + (res.error || 'unknown'), 'warning');
      return;
    }
    global.notify?.('✅ تم تعطيل الفرع', 'success');
    refresh();
  }

  async function promptDeleteBranch(branchId) {
    if (!(await global.tdwConfirm?.({ message: 'حذف هذا الفرع؟ لا يمكن التراجع بسهولة.' }))) return;
    const res = await deleteBranch(branchId);
    if (!res?.ok) {
      global.notify?.('⚠️ تعذّر حذف الفرع: ' + (res.error || 'unknown'), 'warning');
      return;
    }
    global.notify?.('✅ تم حذف الفرع', 'success');
    refresh();
  }

  async function promptRenameDevice(deviceUuid, currentName) {
    const name = await global.tdwAskText?.({ title: 'إدخال', message: 'اسم الجهاز الجديد', defaultValue: currentName || '' });
    if (!name) return;
    const res = await renameDevice(deviceUuid, name);
    if (!res?.ok) {
      global.notify?.('⚠️ تعذّر إعادة تسمية الجهاز: ' + (res.error || 'unknown'), 'warning');
      return;
    }
    global.notify?.('✅ تم تحديث الجهاز', 'success');
    refresh();
  }

  async function promptDisableDevice(deviceUuid) {
    if (!(await global.tdwConfirm?.({ message: 'تعطيل هذا الجهاز؟' }))) return;
    const res = await disableDevice(deviceUuid);
    if (!res?.ok) {
      global.notify?.('⚠️ تعذّر تعطيل الجهاز: ' + (res.error || 'unknown'), 'warning');
      return;
    }
    global.notify?.('✅ تم تعطيل الجهاز', 'success');
    refresh();
  }

  async function promptDeleteDevice(deviceUuid) {
    if (!(await global.tdwConfirm?.({ message: 'حذف هذا الجهاز؟' }))) return;
    const res = await deleteDevice(deviceUuid);
    if (!res?.ok) {
      global.notify?.('⚠️ تعذّر حذف الجهاز: ' + (res.error || 'unknown'), 'warning');
      return;
    }
    global.notify?.('✅ تم حذف الجهاز', 'success');
    refresh();
  }

  function renderSetupGuideHtml(license) {
    const centerId = license?.centerId || global.ConfigLayer?.getCenterId?.() || '';
    const branch = global.DeviceConfig?.getLockedBranchId?.() || '';
    const google = global.settings?.backup?.providers?.google?.connected;
    const steps = [];
    if (!google) steps.push('① اربط Google من <strong>الإعدادات → النسخ السحابي → تسجيل الدخول إلى Google</strong>');
    if (!centerId) steps.push('② فعّل الترخيص بمفتاح المنتج — لإنشاء Center ID');
    if (centerId && !branch) steps.push('③ أكمل إعداد المركز والفرع الأول');
    if (!steps.length) return '';
    return `<div class="card" style="padding:20px;margin-bottom:14px;border-color:var(--warning)" data-ss-surface="ownerhub_setup_guide">
      <div class="card-title" style="margin-bottom:10px">⚙️ إكمال إعداد Cloud V2</div>
      <ul style="margin:0;padding-right:18px;line-height:1.85;font-size:13px;color:var(--text-muted)">
        ${steps.map(s => `<li style="margin-bottom:6px">${s}</li>`).join('')}
      </ul>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-primary btn-sm" id="ownerhub-bootflow-cta" onclick="typeof openBootWizardFromLogin==='function'&&openBootWizardFromLogin()">🚀 معالج الإعداد (BootFlow)</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="showPage('settings');setTimeout(function(){document.getElementById('set-panel-backup')?.scrollIntoView({behavior:'smooth'})},300)">الإعدادات → النسخ السحابي</button>
        <button type="button" class="btn btn-ghost btn-sm" id="ownerhub-centersetup-cta" onclick="CenterSetupUI.open('branch')" title="دعم متقدم">🏥 ربط فرع (دعم)</button>
      </div>
    </div>`;
  }

  function renderOwnerHubPage() {
    injectStyles();
    const host = document.getElementById('owner-hub-body');
    if (!host) return;

    try {
      if (!canAccess()) {
        host.innerHTML = '<div class="card" style="padding:20px"><p style="margin:0;color:var(--text-muted)">Owner Hub متاح للمدير أو المحاسب (بصلاحية كل الفروع).</p></div>';
        return;
      }
      if (!isCloudV2Ready()) {
        host.innerHTML = renderSetupGuideHtml(global.LicenseCloud?.loadLocal?.() || {}) +
          '<div class="card" style="padding:16px;margin-top:12px"><p style="margin:0;color:var(--text-muted)">Cloud V2 غير مفعّل بعد — اتبع الخطوات أعلاه أو فعّله من الإعدادات ← تفعيل الأنظمة.</p>' +
          '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
          '<button type="button" class="btn btn-primary btn-sm" id="ownerhub-bootflow-cta" onclick="typeof openBootWizardFromLogin===\'function\'&&openBootWizardFromLogin()">🚀 معالج الإعداد (BootFlow)</button>' +
          '<button type="button" class="btn btn-secondary btn-sm" onclick="showPage(\'settings\');setTimeout(function(){document.getElementById(\'set-panel-systems\')?.scrollIntoView({behavior:\'smooth\'})},300)">تفعيل Cloud V2</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="ownerhub-centersetup-cta" onclick="CenterSetupUI.open(\'overview\')" title="دعم متقدم">⚙️ إعداد المركز (دعم)</button></div></div>';
        try { global.SetupStateDom?.applyDomVisibility?.({ reason: 'owner-hub-not-ready' }); } catch { /* empty */ }
        return;
      }

      const m = buildModel();
      const setupHtml = renderSetupGuideHtml(m.license);
    const migration = global.OwnerMigration?.getStatus?.() || {};
    const lastSync = m.sync.lastPushAt || m.sync.lastPollAt;
    const syncLabel = lastSync ? formatAgo(lastSync) + ' ago' : '—';
    const canSwitch = global.BranchScope?.canUserSwitchBranch?.(global.currentUser);
    const id = m.identity || {};
    const a = m.analytics || {};
    const healthLabel = a.health === 'healthy' ? '✅ سليمة'
      : a.health === 'paused' ? '⏸️ متوقفة'
      : a.health === 'offline' ? '🟠 بدون اتصال'
      : '⚠️ متدهورة';
    const idStateLabel = id.state === 'ok' ? '✅ متطابق'
      : id.state === 'mismatch' ? '⛔ حساب مختلف'
      : id.state === 'bound_offline' ? '🟡 غير متصل'
      : '⚪ لم يُربط بعد';
    const activationLabel = global.LicenseActivationGate?.formatActivationLabel?.(m.license)
      || global.LicenseActivationGate?.formatPrimaryDeviceLabel?.(m.license) || '—';

    const ownerCanManage = global.RolePolicy?.canManageOrganization?.(global.currentUser);
    const canBootstrapOwner = global.RolePolicy?.canBootstrapOwner?.(global.currentUser)
      || (global.RolePolicy?.isManager?.(global.currentUser) && !global.OwnerProfile?.hasProfile?.());
    const ownerSetupRequired = !!global.OwnerSetupState?.isRequired?.() && !global.OwnerProfile?.hasProfile?.();
    const modeLabel = global.OwnerBranchMode?.getLabel?.((branchId) => (m.branches.find((x) => x.id === branchId)?.name || branchId)) || 'Owner Mode';
    const branchCards = m.branches.map(b => {
      const devs = m.devices.filter(d => d.branchId === b.id);
      const path = branchDrivePath(m.centerId, b);
      const isLocked = m.lockedBranch === b.id;
      return `<div class="oh-branch-card">
        <h5>${b.name || b.id}${isLocked ? ' 🔒' : ''}</h5>
        <div class="oh-muted">${devs.length} جهاز · ${b.id}</div>
        <div class="oh-path">${path}</div>
        ${ownerCanManage ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
          <button type="button" class="btn btn-secondary btn-sm" onclick="OwnerHub.enterBranchMode('${b.id}')">🧭 Branch Mode</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="OwnerHub.promptRenameBranch('${b.id}','${String(b.name || '').replace(/'/g, "\\'")}')">✏️ Rename</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="OwnerHub.promptDisableBranch('${b.id}')">⏸️ Disable</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="OwnerHub.promptDeleteBranch('${b.id}')">🗑️ Delete</button>
        </div>` : ''}
      </div>`;
    }).join('') || '<div class="oh-muted">—</div>';

    const ownerState = global.OwnerManagement?.getOwnerState?.()?.state;
    const needsOwnerUi = ownerState
      ? (ownerState === 'NO_OWNER' || ownerState === 'OWNER_CORRUPTED' || ownerState === 'OWNER_RECOVERY_REQUIRED')
      : (ownerSetupRequired || migration.needsMigration || !global.OwnerProfile?.hasProfile?.()
        || global.OwnerManagement?.needsOwnerBootstrap?.());
    const pendingDevices = (global.DeviceRegistry?.listPendingDevices?.()
      || (m.devices || []).filter((d) => d && (d.status === 'pending' || d.pending === true))) || [];
    const ownerSetupCard = needsOwnerUi ? `<div class="card" style="margin-bottom:14px;padding:16px;border-color:var(--warning)">
        <div class="card-title" style="margin-bottom:10px">👤 حساب المالك (Owner)</div>
        <p class="oh-muted" style="margin:0 0 10px">ترخيصك الحالي (بما فيه V5) ما زال صالحاً ولم يُعطَّل. V2-5.9: ربط Google لا يمنح Owner ولا يفتح Bootstrap تلقائياً. سجّل الدخول بحساب <code dir="ltr">owner</code> أو أنشئ Owner من هنا. حالة: <strong dir="ltr">${ownerState || 'NO_OWNER'}</strong>.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary btn-sm" onclick="OwnerHub.createAdditionalOwnerInteractive()">➕ إضافة Owner</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="OwnerHub.runLegacyOwnerMigration()">🔐 إنشاء حساب Owner (ترحيل)</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="OwnerHub.resetOwnerPasswordInteractive()">🔑 إعادة تعيين كلمة المرور</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="OwnerHub.emergencyRecoverInteractive()">🆘 استعادة طارئة (دعم)</button>
          ${canBootstrapOwner ? '<button type="button" class="btn btn-ghost btn-sm" onclick="OwnerHub.skipLegacyOwnerMigration()">تخطي حالياً</button>' : ''}
          ${(ownerCanManage || canBootstrapOwner) ? '<button type="button" class="btn btn-secondary btn-sm" onclick="OwnerHub.pushLicenseToDriveNow()">☁️ رفع license.json الآن</button>' : ''}
        </div>
      </div>` : `<div class="card" style="margin-bottom:14px;padding:16px">
        <div class="card-title" style="margin-bottom:10px">👤 ملكية المنظمة — Owner Hub</div>
        <p class="oh-muted" style="margin:0 0 10px">ترخيصك الحالي (بما فيه V5) ما زال صالحاً ولم يُعطَّل. الإدارة اليومية لحسابات Owner. Developer Tools = Reset Password للدعم فقط.</p>
        <div id="oh-owner-accounts"></div>
        ${ownerCanManage ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button type="button" class="btn btn-primary btn-sm" onclick="OwnerHub.createAdditionalOwnerInteractive()">➕ إضافة Owner</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="OwnerHub.resetOwnerPasswordInteractive()">🔑 إعادة تعيين كلمة مرور الملف</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="OwnerHub.transferOwnershipInteractive()">🔄 نقل الملكية</button>
        </div>` : '<p class="oh-muted" style="margin:0">عرض فقط — الإدارة للمالك (Owner).</p>'}
      </div>`;
    const approvalsCard = `<div class="card" style="margin-bottom:14px;padding:16px">
        <div class="card-title" style="margin-bottom:10px">✅ الطلبات والموافقات — أجهزة معلّقة</div>
        ${pendingDevices.length ? `<div class="oh-devices">${pendingDevices.map((d) => {
          const id = String(d.id || d.deviceId || '').replace(/'/g, "\\'");
          return `<div class="oh-device"><div><div class="oh-device-name">${d.deviceName || d.name || id || '—'}</div>
            <div class="oh-muted" dir="ltr">${d.branchId || '—'} · ${d.lastSeenAt || d.requestedAt || ''}</div></div>
            <div style="display:flex;gap:6px">
              <button type="button" class="btn btn-primary btn-sm" onclick="OwnerHub.approveDevice('${id}')">Approve</button>
              <button type="button" class="btn btn-ghost btn-sm" onclick="OwnerHub.revokeDevice('${id}')">Revoke</button>
            </div></div>`;
        }).join('')}</div>` : '<p class="oh-muted" style="margin:0">لا توجد أجهزة بانتظار الموافقة.</p>'}
      </div>`;

    const dailyKpis = `
      <div class="oh-grid">
        <div class="oh-card"><h4>الأجهزة</h4><div class="oh-val">${m.deviceCount}</div><div class="oh-muted">🟢 ${a.onlineDevices || 0} · 🔴 ${a.staleDevices || 0}</div></div>
        <div class="oh-card"><h4>صحة المزامنة</h4><div class="oh-val" style="font-size:16px">${healthLabel}</div><div class="oh-muted">Pending: ${global.OpsStatus?.formatLargeCount?.(a.pendingPushes || 0) || (a.pendingPushes || 0)} · Dead-letter: ${global.OpsStatus?.formatLargeCount?.(a.deadLetters || 0) || (a.deadLetters || 0)} · Conflicts: ${global.OpsStatus?.formatLargeCount?.(a.conflictsPending || 0) || (a.conflictsPending || 0)}</div></div>
        <div class="oh-card"><h4>آخر مزامنة</h4><div class="oh-val" style="font-size:16px">${syncLabel}</div><div class="oh-muted">Poll: ${m.pollSec}ث · Pending: ${global.OpsStatus?.formatLargeCount?.(m.sync.pending ?? 0) || (m.sync.pending ?? 0)}</div></div>
        <div class="oh-card"><h4>فرع الجلسة</h4><div class="oh-val" style="font-size:15px">${global.BranchScope?.getActiveBranchId?.() || m.lockedBranch}</div><div class="oh-muted">${canSwitch ? 'حسب صلاحيات حسابك — يمكنك التبديل' : 'محدد بصلاحيات حسابك'}</div></div>
        <div class="oh-card"><h4>Mode</h4><div class="oh-val" style="font-size:14px">${modeLabel}</div><div class="oh-muted">${ownerCanManage ? 'Owner Mode = نظرة عامة · Branch Mode = كتابة داخل فرع' : 'عرض فقط'}</div></div>
        <div class="oh-card"><h4>مستخدمون نشطون</h4><div class="oh-val">${m.activeUsers}</div></div>
      </div>`;
    const branchSummariesCard = `<div class="card" style="margin-bottom:14px;padding:16px">
        <div class="card-title" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <span>📊 ملخصات الفروع (On-Demand)</span>
          <button type="button" class="btn btn-secondary btn-sm" onclick="OwnerHub.refreshBranchSummaries()">تحديث الملخصات</button>
        </div>
        <p class="oh-muted" style="margin:0 0 10px">لا يتم تنزيل كل قواعد الفروع — يتم استخدام ملخصات خفيفة عند الطلب.</p>
        <div class="oh-branch-grid">
          ${m.branches.map((b) => {
            const s = global.BranchSummary?.getSummary?.(b.id);
            if (!s) {
              return `<div class="oh-branch-card"><h5>${b.name || b.id}</h5><div class="oh-muted">لا يوجد ملخص بعد</div></div>`;
            }
            return `<div class="oh-branch-card"><h5>${b.name || b.id}</h5><div class="oh-muted">عملاء: ${s.clientsTotal} · زيارات: ${s.casesTotal} · حجوزات: ${s.bookingsTotal}</div><div class="oh-muted">إيراد: ${s.revenueTotal} · مصروف: ${s.expensesTotal} · صافي: ${s.netTotal}</div><div class="oh-muted">${formatAgo(s.generatedAt)}</div></div>`;
          }).join('')}
        </div>
      </div>`;
    const devicesCard = `<div class="card" style="padding:16px">
        <div class="card-title" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <span>🖥️ الأجهزة المسجّلة</span>
          <button type="button" class="btn btn-ghost btn-sm" onclick="OwnerHub.refresh()">🔄 تحديث</button>
        </div>
        <div class="oh-devices">${m.devices.length ? m.devices.map(d => {
          const st = deviceStatus(d.lastSeenAt);
          const bName = m.branches.find(b => b.id === d.branchId)?.name || d.branchId || '';
          return `<div class="oh-device"><div><div class="oh-device-name">${d.deviceName || d.deviceUuid?.slice(0, 8)}</div><div class="oh-muted">${bName}</div></div><div>${st.icon} ${st.label}</div>${ownerCanManage ? `<div style="display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" class="btn btn-ghost btn-sm" onclick="OwnerHub.promptRenameDevice('${d.deviceUuid}','${String(d.deviceName || '').replace(/'/g, "\\'")}')">✏️</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="OwnerHub.promptDisableDevice('${d.deviceUuid}')">⏸️</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="OwnerHub.promptDeleteDevice('${d.deviceUuid}')">🗑️</button>
          </div>` : ''}</div>`;
        }).join('') : '<div class="oh-muted">لا أجهزة مسجّلة بعد</div>'}
        </div>
      </div>`;
    const licenseCard = `<div class="card" style="margin-bottom:14px;padding:16px">
        <div class="card-title" style="margin-bottom:10px">📦 الاشتراك والترخيص</div>
        <div class="oh-grid" style="margin-bottom:0">
          <div class="oh-card"><h4>الترخيص</h4><div class="oh-val" style="font-size:15px">${m.licLabel}</div><div class="oh-muted" style="margin-top:6px">${m.license.centerName || ''}</div></div>
          <div class="oh-card"><h4>Center ID</h4><div class="oh-val" style="font-size:13px;word-break:break-all" dir="ltr">${m.centerId}</div></div>
          <div class="oh-card"><h4>Package</h4><div class="oh-val" style="font-size:14px">${m.license?.packageId || '—'}</div></div>
          <div class="oh-card"><h4>Subscription</h4><div class="oh-val" style="font-size:14px">${m.license?.subscriptionId || '—'}</div></div>
          <div class="oh-card"><h4>Expiry</h4><div class="oh-val" style="font-size:14px">${m.license?.expiresAt || '—'}</div></div>
          <div class="oh-card"><h4>Activation</h4><div class="oh-val" style="font-size:14px">${activationLabel}</div></div>
          <div class="oh-card"><h4>Google المركز</h4><div class="oh-val" style="font-size:14px;word-break:break-all" dir="ltr">${id.boundGoogleEmail || id.authorizedEmail || '—'}</div><div class="oh-muted">${idStateLabel}</div></div>
          <div class="oh-card"><h4>Owner Profile</h4><div class="oh-val" style="font-size:14px">${(global.OwnerManagement?.getOwnerState?.()?.state === 'OWNER_EXISTS') ? '✅ جاهز' : '⚠️ مطلوب'}</div><div class="oh-muted" dir="ltr">${global.OwnerManagement?.getOwnerState?.()?.state || '—'}</div></div>
          <div class="oh-card"><h4>تدقيق حديث</h4><div class="oh-val">${a.auditRecentCount || 0}</div><div class="oh-muted">${a.lastAuditAt ? formatAgo(a.lastAuditAt) : '—'}</div></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button type="button" class="btn btn-secondary btn-sm" onclick="openLicenseScreen('licensing')">🔑 إدارة الترخيص</button>
          ${(ownerCanManage || canBootstrapOwner) ? '<button type="button" class="btn btn-primary btn-sm" onclick="OwnerHub.pushLicenseToDriveNow()">☁️ رفع license.json</button>' : ''}
          <button type="button" class="btn btn-ghost btn-sm" onclick="openLicenseScreen('developer')">👤 تواصل/تجديد</button>
        </div>
      </div>`;
    const advancedSupport = `
      ${setupHtml}
      ${ownerSetupCard}
      ${licenseCard}
      <div class="card" style="margin-bottom:14px;padding:16px">
        <div class="card-title" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <span>تشخيص المزامنة</span>
          <button type="button" class="btn btn-secondary btn-sm" onclick="OwnerHub.showDiagnosticsSnapshot()">لقطة تشخيصية</button>
        </div>
        <p class="oh-muted" style="margin:0">ملخص تشغيلي للفروع والأجهزة والمزامنة والتعارضات — بدون تقارير إيرادات مجمّعة (مؤجلة).</p>
        <pre id="owner-hub-diagnostics" class="oh-muted" style="display:none;margin:12px 0 0;max-height:280px;overflow:auto;white-space:pre-wrap;direction:ltr;text-align:left;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:11px"></pre>
      </div>
      <div class="card" style="margin-bottom:14px;padding:16px">
        <div class="card-title" style="margin-bottom:10px">🔐 حساب Google المصرّح</div>
        <p class="oh-muted" style="margin:0 0 10px">المزامنة تعمل مع حساب Google المرتبط بالمركز. لتغيير البريد: من حساب المالك/المدير.</p>
        <button type="button" class="btn btn-secondary btn-sm" onclick="OwnerHub.prepareIdentityChange()">تغيير Google</button>
      </div>
      <div class="card" style="margin-bottom:14px;padding:16px">
        <div class="card-title" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <span>🌿 إدارة الفروع</span>
          ${ownerCanManage ? '<button type="button" class="btn btn-secondary btn-sm" onclick="OwnerHub.promptAddBranch()">➕ إضافة فرع</button><button type="button" class="btn btn-ghost btn-sm" onclick="OwnerHub.exitToOwnerMode()">↩️ Owner Mode</button>' : ''}
        </div>
        <p class="oh-muted" style="margin:0 0 10px"><strong>Owner Mode</strong> = نظرة عامة لكل الفروع (قراءة). <strong>Branch Mode</strong> = الدخول لفرع للكتابة اليومية. إنشاء الفروع للمالك فقط.</p>
        <div class="oh-branch-grid">${branchCards}</div>
      </div>`;

    const branchManagementCard = `<div class="card" style="margin-bottom:14px;padding:16px">
      <div class="card-title" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <span>🌿 إدارة الفروع</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${ownerCanManage ? '<button type="button" class="btn btn-secondary btn-sm" onclick="OwnerHub.promptAddBranch()">➕ إضافة فرع</button><button type="button" class="btn btn-ghost btn-sm" onclick="OwnerHub.exitToOwnerMode()">↩️ Owner Mode</button>' : ''}
        </div>
      </div>
      <p class="oh-muted" style="margin:0 0 10px">كل فرع مستقل مع أجهزته ومساره. اختر Branch Mode للعمل داخله، أو Owner Mode للعرض التجميعي.</p>
      <div class="oh-branch-grid">${branchCards}</div>
    </div>`;

    host.innerHTML = `
      <div class="oh-workspace" data-oh-section="overview">
        <div class="oh-section-tabs" role="tablist" aria-label="Owner Hub sections">
          <button type="button" class="btn btn-primary btn-sm oh-section-tab is-active" data-oh-section-btn="overview" onclick="OwnerHub.showSection('overview')">📊 النظرة العامة</button>
          <button type="button" class="btn btn-ghost btn-sm oh-section-tab" data-oh-section-btn="branches" onclick="OwnerHub.showSection('branches')">🌿 الفروع</button>
          <button type="button" class="btn btn-ghost btn-sm oh-section-tab" data-oh-section-btn="devices" onclick="OwnerHub.showSection('devices')">🖥️ الأجهزة</button>
          <button type="button" class="btn btn-ghost btn-sm oh-section-tab" data-oh-section-btn="owners" onclick="OwnerHub.showSection('owners')">👤 المالك والصلاحيات</button>
          <button type="button" class="btn btn-ghost btn-sm oh-section-tab" data-oh-section-btn="advanced" onclick="OwnerHub.showSection('advanced')">🛠️ النظام والدعم</button>
        </div>
        <div id="oh-panel-overview" class="oh-section-panel" data-oh-panel="overview">
          ${dailyKpis}
        </div>
        <div id="oh-panel-branches" class="oh-section-panel" data-oh-panel="branches" hidden>
          ${branchManagementCard}
          ${branchSummariesCard}
        </div>
        <div id="oh-panel-devices" class="oh-section-panel" data-oh-panel="devices" hidden>
          ${approvalsCard}
          ${devicesCard}
        </div>
        <div id="oh-panel-owners" class="oh-section-panel" data-oh-panel="owners" hidden>
          ${ownerSetupCard}
          ${licenseCard}
        </div>
        <div id="oh-panel-advanced" class="oh-section-panel" data-oh-panel="advanced" hidden>
          ${advancedSupport}
        </div>
      </div>`;
      try { fillOwnerAccountsPanel(); } catch (e) { console.warn('OwnerHub accounts panel', e); }
      try { global.SetupStateDom?.applyDomVisibility?.({ reason: 'owner-hub-render' }); } catch { /* empty */ }
    } catch (err) {
      console.error('OwnerHub render:', err);
      host.innerHTML = '<div class="card" style="padding:20px;border-color:var(--danger)"><p style="margin:0;color:var(--danger)">⚠️ تعذّر تحميل Owner Hub: ' + (err.message || 'خطأ') + '</p></div>';
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fillOwnerAccountsPanel() {
    const el = document.getElementById('oh-owner-accounts');
    if (!el) return;
    const OM = global.OwnerManagement;
    if (!OM) {
      el.innerHTML = '<p class="oh-muted">OwnerManagement غير محمّل</p>';
      return;
    }
    const owners = OM.listOwners?.() || [];
    if (!owners.length) {
      el.innerHTML = '<p class="oh-muted">لا حسابات Owner بعد</p>';
      return;
    }
    el.innerHTML = `<div style="overflow:auto"><table style="width:100%;font-size:12px;text-align:right;border-collapse:collapse">
      <thead><tr><th style="padding:6px">الاسم</th><th>المستخدم</th><th>الحالة</th><th>إجراءات</th></tr></thead>
      <tbody>${owners.map((o) => {
        const active = o.active !== false;
        return `<tr>
          <td style="padding:6px">${escapeHtml(o.fullName || '')}</td>
          <td dir="ltr">${escapeHtml(o.username || '')}</td>
          <td>${active ? 'نشط' : 'موقوف'}</td>
          <td style="white-space:nowrap">
            <button type="button" class="btn btn-ghost btn-sm" data-oh-om="edit" data-id="${escapeHtml(o.id)}">تعديل</button>
            <button type="button" class="btn btn-ghost btn-sm" data-oh-om="reset" data-id="${escapeHtml(o.id)}">كلمة المرور</button>
            <button type="button" class="btn btn-ghost btn-sm" data-oh-om="${active ? 'disable' : 'enable'}" data-id="${escapeHtml(o.id)}">${active ? 'تعطيل' : 'تفعيل'}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-oh-om="delete" data-id="${escapeHtml(o.id)}">حذف</button>
          </td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
    el.querySelectorAll('[data-oh-om]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!requireOwnerManage('إدارة Owner')) return;
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-oh-om');
        try {
          if (action === 'edit') {
            const name = await global.tdwAskText?.({ title: 'إدخال', message: 'الاسم الكامل الجديد' });
            if (name == null) return;
            const email = await global.tdwAskText?.({ title: 'إدخال', message: 'البريد الإلكتروني' });
            const res = await OM.updateOwner(id, { fullName: name, email: email == null ? undefined : email });
            if (!res.ok) { global.notify?.('⚠️ ' + (res.message || res.error), 'warning'); return; }
            global.notify?.('✅ تم التعديل', 'success');
          } else if (action === 'reset') {
            const pw = await global.tdwAskPassword?.({ title: 'كلمة المرور', message: 'كلمة المرور الجديدة (8+)' });
            if (pw == null) return;
            const conf = await global.tdwAskPassword?.({ title: 'كلمة المرور', message: 'تأكيد كلمة المرور' });
            const res = await OM.resetOwnerPassword(id, pw, conf);
            if (!res.ok) { global.notify?.('⚠️ ' + (res.message || res.error), 'warning'); return; }
            global.notify?.('✅ تم تغيير كلمة المرور', 'success');
          } else if (action === 'disable') {
            const res = await OM.setOwnerActive(id, false);
            if (!res.ok) { global.notify?.('⚠️ ' + (res.message || res.error), 'warning'); return; }
            global.notify?.('✅ تم التعطيل', 'success');
          } else if (action === 'enable') {
            const res = await OM.setOwnerActive(id, true);
            if (!res.ok) { global.notify?.('⚠️ ' + (res.message || res.error), 'warning'); return; }
            global.notify?.('✅ تم التفعيل', 'success');
          } else if (action === 'delete') {
            if (!(await global.tdwConfirm?.({ message: 'حذف حساب Owner هذا؟ (يُمنع حذف آخر Owner فعّال)' }))) return;
            const res = await OM.deleteOwner(id);
            if (!res.ok) { global.notify?.('⚠️ ' + (res.message || res.error), 'warning'); return; }
            global.notify?.('🗑️ تم الحذف', 'danger');
          }
          refresh();
        } catch (e) {
          global.notify?.('✗ ' + (e.message || 'فشل'), 'danger');
        }
      });
    });
  }

  function refresh() {
    renderOwnerHubPage();
  }

  function showDiagnosticsSnapshot() {
    if (!canAccess()) {
      global.notify?.('⛔ Owner Hub غير متاح لهذا الحساب', 'danger');
      return null;
    }
    const snapshot = buildDiagnosticsSnapshot();
    const host = document.getElementById('owner-hub-diagnostics');
    if (host) {
      host.style.display = 'block';
      host.textContent = JSON.stringify(snapshot, null, 2);
    }
    const degraded = snapshot.sync?.health && snapshot.sync.health !== 'healthy';
    global.notify?.(
      degraded ? 'تم توليد لقطة تشخيصية — حالة المزامنة تحتاج مراجعة' : 'تم توليد لقطة تشخيصية',
      degraded ? 'warning' : 'success'
    );
    return snapshot;
  }

  function prepareIdentityChange() {
    const res = global.LicenseIdentity?.beginIdentityChange?.();
    if (!res?.ok) {
      global.notify?.('⚠️ ' + (res?.error || 'فشل'), 'danger');
      return;
    }
    global.notify?.('✅ الآن اربط حساب Google الجديد من الإعدادات ← النسخ السحابي', 'success');
  }

  function applyNavVisibility() {
    if (typeof document === 'undefined') return;
    const nav = document.getElementById('nav-owner-hub');
    if (!nav) return;
    const u = global.currentUser;
    const show = !!u && (global.RolePolicy?.isManager?.(u) || u.isDev ||
      (u.role === 'accountant' && ((global.BranchScope?.getUserBranchScope?.(u) || []).includes('*') ||
        (global.BranchScope?.getUserBranchScope?.(u) || []).length > 1)));
    nav.style.display = show ? '' : 'none';
    if (show) nav.classList.remove('admin-only');
  }

  /** V2-5.10 Category B: Daily Operations vs Advanced Support */
  function showSection(section) {
    const allowed = new Set(['overview', 'branches', 'devices', 'owners', 'advanced']);
    const name = allowed.has(section) ? section : 'overview';
    const root = typeof document !== 'undefined' ? document.querySelector('.oh-workspace') : null;
    if (!root) return;
    root.setAttribute('data-oh-section', name);
    root.querySelectorAll('[data-oh-panel]').forEach((el) => {
      const match = el.getAttribute('data-oh-panel') === name;
      if (match) el.removeAttribute('hidden');
      else el.setAttribute('hidden', '');
    });
    root.querySelectorAll('[data-oh-section-btn]').forEach((btn) => {
      const active = btn.getAttribute('data-oh-section-btn') === name;
      btn.classList.toggle('is-active', active);
      btn.classList.toggle('btn-primary', active);
      btn.classList.toggle('btn-ghost', !active);
    });
  }

  global.OwnerHub = {
    canAccess,
    isCloudV2Ready,
    buildModel,
    buildAnalyticsSummary,
    buildDiagnosticsSnapshot,
    showDiagnosticsSnapshot,
    saveLicenseDoc,
    renameDevice,
    disableDevice,
    deleteDevice,
    approveDevice,
    revokeDevice,
    addBranch,
    renameBranch,
    disableBranch,
    deleteBranch,
    promptAddBranch,
    promptRenameBranch,
    promptDisableBranch,
    promptDeleteBranch,
    promptRenameDevice,
    promptDisableDevice,
    promptDeleteDevice,
    enterBranchMode(branchId) {
      const res = global.OwnerBranchMode?.enterBranchMode?.(branchId);
      if (!res?.ok) {
        global.notify?.('⚠️ تعذّر تفعيل Branch Mode: ' + (res?.error || 'unknown'), 'warning');
        return res;
      }
      global.notify?.('✅ تم تفعيل Branch Mode — تُعرض بيانات هذا الفرع فقط', 'success');
      try {
        if (typeof global.refreshClientsView === 'function') global.refreshClientsView(true);
        if (typeof global.syncAppGlobals === 'function') global.syncAppGlobals();
      } catch { /* empty */ }
      refresh();
      return res;
    },
    exitToOwnerMode() {
      const res = global.OwnerBranchMode?.exitToOwnerMode?.();
      if (!res?.ok) return res;
      global.notify?.('✅ العودة إلى Owner Mode (نظرة عامة لكل الفروع)', 'success');
      try {
        if (typeof global.refreshClientsView === 'function') global.refreshClientsView(true);
      } catch { /* empty */ }
      refresh();
      return res;
    },
    refreshBranchSummaries() {
      if (!requireOwnerManage('تحديث ملخصات الفروع')) return { ok: false, error: 'owner_required' };
      const map = global.BranchSummary?.refreshAllBranchSummaries?.() || {};
      global.notify?.('✅ تم تحديث ملخصات الفروع', 'success');
      refresh();
      return { ok: true, summaries: map };
    },
    async runLegacyOwnerMigration() {
      if (!requireOwnerBootstrap('إنشاء حساب Owner')) return { ok: false, error: 'owner_required' };
      const res = await global.OwnerMigration?.runInteractiveMigration?.();
      if (!res?.ok) {
        global.notify?.('⚠️ تعذّرت الترقية: ' + (res?.error || 'unknown'), 'warning');
        return res || { ok: false, error: 'unknown' };
      }
      global.notify?.('✅ تم إنشاء حساب Owner — يمكنك إدارة الفروع والأجهزة والترخيص', 'success');
      try { global.OwnerHub?.applyNavVisibility?.(); } catch { /* empty */ }
      refresh();
      return res;
    },
    async skipLegacyOwnerMigration() {
      // Single SoT: SetupStateService / SetupStateDom — never BootFlow alone.
      const needsBoot = global.SetupStateDom?.needsBootFlow?.()
        || global.SetupStateService?.getState?.({ ignoreRestart: true })?.needsBootFlow
        || global.BootFlow?.needsBootScreen?.();
      if (needsBoot) {
        global.notify?.('⛔ لا يمكن تخطي حساب المالك أثناء رحلة الإعداد الأولى', 'danger');
        return { ok: false, error: 'owner_required_during_activation' };
      }
      // Skip must work for managers during bootstrap — do NOT require existing Owner role.
      if (!requireOwnerBootstrap('تخطي إعداد Owner')) return { ok: false, error: 'owner_required' };
      const res = await global.OwnerMigration?.skipMigration?.();
      if (res?.ok === false) return res;
      try { global.OwnerSetupState?.clearRequired?.(); } catch { /* empty */ }
      global.notify?.('ℹ️ تم تخطي إعداد Owner حالياً — يمكنك إنشاؤه لاحقاً من Owner Hub', 'info');
      refresh();
      return res || { ok: true };
    },
    async redeemSetupTokenInteractive() {
      const token = String(await global.tdwAskText?.({ title: 'إدخال', message: 'رمز إعداد المنظمة (Setup Token)' }) || '').trim();
      if (!token) return { ok: false, error: 'token_required' };
      const username = String(await global.tdwAskText?.({ title: 'إدخال', message: 'اسم مستخدم Owner' }) || '').trim();
      const password = String(await global.tdwAskPassword?.({ title: 'كلمة المرور', message: 'كلمة مرور Owner' }) || '').trim();
      const recoveryCode = String(await global.tdwAskText?.({ title: 'إدخال', message: 'Recovery PIN/Code' }) || '').trim();
      const res = await global.OwnerBootstrap?.redeemSetupToken?.(token, { username, password, recoveryCode });
      if (!res?.ok) {
        global.notify?.('⚠️ فشل استرداد الرمز: ' + (res?.error || 'unknown'), 'warning');
        return res || { ok: false };
      }
      global.notify?.('✅ تم إنشاء Owner عبر رمز الإعداد', 'success');
      try { global.OwnerHub?.applyNavVisibility?.(); } catch { /* empty */ }
      refresh();
      return res;
    },
    async emergencyRecoverInteractive() {
      if (global.OwnerProfile?.hasProfile?.()) {
        global.notify?.('ℹ️ Owner Profile موجود — استخدم إعادة تعيين كلمة المرور', 'info');
        return { ok: false, error: 'profile_exists' };
      }
      const recoveryCode = String(await global.tdwAskText?.({ title: 'إدخال', message: 'رمز الاستعادة الطارئة / Recovery' }) || '').trim();
      const username = String(await global.tdwAskText?.({ title: 'إدخال', message: 'اسم مستخدم Owner الجديد' }) || '').trim();
      const password = String(await global.tdwAskPassword?.({ title: 'كلمة المرور', message: 'كلمة المرور الجديدة' }) || '').trim();
      const newRecoveryCode = String(await global.tdwAskText?.({ title: 'إدخال', message: 'Recovery جديد' }) || '').trim() || recoveryCode;
      const res = await global.OwnerProfile?.emergencyRecoverOwner?.({
        recoveryCode, username, password, newRecoveryCode
      });
      if (!res?.ok) {
        global.notify?.('⚠️ الاستعادة مرفوضة: ' + (res?.error || 'unknown'), 'warning');
        return res || { ok: false };
      }
      global.notify?.('✅ تمت الاستعادة الطارئة لـ Owner (مُدقَّقة)', 'success');
      refresh();
      return res;
    },
    openOwnerBootstrapWizard() {
      const res = global.OwnerManagement?.requestOwnerBootstrap?.('owner_hub')
        || global.BootFlow?.ensureOwnerBootstrapWizard?.('owner_hub')
        || (global.BootFlow?.openAtStep?.('owner'), { opened: true });
      if (res?.opened !== false && !res?.error) {
        global.notify?.('🚀 تم فتح Owner Bootstrap Wizard', 'info');
      } else if (res?.error === 'creation_in_progress') {
        global.notify?.('⏳ إنشاء Owner جارٍ — انتظر', 'warning');
      } else if (res?.error === 'system_busy') {
        global.notify?.('⚠️ النظام مشغول (' + (res.busy || '') + ') — انتظر', 'warning');
      } else {
        global.notify?.('⚠️ تعذّر فتح المعالج', 'warning');
      }
      return res;
    },
    async createAdditionalOwnerInteractive() {
      if (!requireOwnerManage('إضافة Owner')) return { ok: false, error: 'owner_required' };
      const OM = global.OwnerManagement;
      if (!OM?.createOwner) {
        global.notify?.('⚠️ OwnerManagement غير متاح', 'warning');
        return { ok: false, error: 'no_api' };
      }
      const fullName = String(await global.tdwAskText?.({ title: 'إدخال', message: 'الاسم الكامل' }) || '').trim();
      const email = String(await global.tdwAskText?.({ title: 'إدخال', message: 'البريد الإلكتروني' }) || '').trim();
      const username = String(await global.tdwAskText?.({ title: 'إدخال', message: 'اسم المستخدم' }) || '').trim();
      const password = String(await global.tdwAskPassword?.({ title: 'كلمة المرور', message: 'كلمة المرور (8+)' }) || '').trim();
      const passwordConfirm = String(await global.tdwAskPassword?.({ title: 'كلمة المرور', message: 'تأكيد كلمة المرور' }) || '').trim();
      const recoveryCode = String(await global.tdwAskText?.({ title: 'إدخال', message: 'كود الاسترداد (للأول فقط إن لزم)' }) || '').trim() || 'hub-recovery';
      const res = await OM.createOwner({
        fullName, email, username, password, passwordConfirm, recoveryCode, acceptOrganization: true
      });
      if (!res?.ok) {
        global.notify?.('⚠️ ' + (res?.message || res?.error || 'فشل الإنشاء'), 'warning');
        return res || { ok: false };
      }
      global.notify?.('✅ تم إنشاء Owner إضافي عبر createOwner()', 'success');
      refresh();
      return res;
    },
    async resetOwnerPasswordInteractive() {
      const recoveryCode = String(await global.tdwAskText?.({ title: 'إدخال', message: 'Recovery Code' }) || '').trim();
      const newPassword = String(await global.tdwAskPassword?.({ title: 'كلمة المرور', message: 'كلمة المرور الجديدة' }) || '').trim();
      const res = await global.OwnerProfile?.resetPasswordWithRecovery?.({ recoveryCode, newPassword });
      if (!res?.ok) {
        global.notify?.('⚠️ تعذّر إعادة التعيين: ' + (res?.error || 'unknown'), 'warning');
        return res || { ok: false };
      }
      global.notify?.('✅ تم تحديث كلمة المرور — يجب تسجيل الدخول مجدداً', 'success');
      try { global.clearUserSession?.(); } catch { /* empty */ }
      refresh();
      return res;
    },
    async transferOwnershipInteractive() {
      if (!requireOwnerManage('نقل الملكية')) return { ok: false, error: 'owner_required' };
      const currentPassword = String(await global.tdwAskPassword?.({ title: 'كلمة المرور', message: 'كلمة مرور Owner الحالية' }) || '').trim();
      const newUsername = String(await global.tdwAskText?.({ title: 'إدخال', message: 'اسم المالك الجديد' }) || '').trim();
      const newPassword = String(await global.tdwAskPassword?.({ title: 'كلمة المرور', message: 'كلمة مرور المالك الجديد' }) || '').trim();
      const newRecoveryCode = String(await global.tdwAskText?.({ title: 'إدخال', message: 'Recovery للمالك الجديد' }) || '').trim();
      const res = await global.OwnerProfile?.transferOwnership?.({
        currentPassword, newUsername, newPassword, newRecoveryCode
      });
      if (!res?.ok) {
        global.notify?.('⚠️ فشل نقل الملكية: ' + (res?.error || 'unknown'), 'warning');
        return res || { ok: false };
      }
      global.notify?.('✅ تم نقل الملكية — صلاحيات المالك السابق أُلغيت', 'success');
      refresh();
      return res;
    },
    pushLicenseToDriveNow,
    renderOwnerHubPage,
    refresh,
    prepareIdentityChange,
    applyNavVisibility,
    showSection,
  };

  global.renderOwnerHubPage = renderOwnerHubPage;
})(typeof window !== 'undefined' ? window : globalThis);
