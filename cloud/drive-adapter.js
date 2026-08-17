/**
 * Google Drive adapter — V2 path upload/download (Cloud V2 Sprint 4).
 */
(function (global) {
  'use strict';

  function getBridge() {
    return global.BackupBridge || null;
  }

  function isConnected() {
    const s = global.settings?.backup;
    if (!s) return false;
    const prov = s?.cloudProvider || 'google';
    const p = s?.providers?.[prov] || s?.providers?.google;
    if (!p || p.userDisconnected) return false;
    // Connected flag is enough — oauth may be undefined on older settings blobs.
    if (p.connected && p.oauth !== false) return true;
    return !!(s.cloudEnabled && p.connected);
  }

  /**
   * Sync live Electron OAuth into settings, then re-check.
   * Fixes false "connect Google first" after a successful browser OAuth.
   */
  async function ensureConnected(options) {
    options = options || {};
    if (typeof global.syncCloudStatusFromElectron === 'function') {
      try {
        await global.syncCloudStatusFromElectron({
          acceptLiveReconnect: options.acceptLiveReconnect === true,
        });
      } catch { /* live status is checked directly below */ }
    }
    if (isConnected()) return true;

    const bridge = getBridge();
    if (!bridge?.isElectron?.() || !bridge.getCloudStatus) return isConnected();
    try {
      const live = await bridge.getCloudStatus('google');
      if (live?.connected && !live?.needsReauth) {
        const s = global.settings || (global.settings = {});
        s.backup = s.backup || {};
        s.backup.providers = s.backup.providers || {};
        const previous = s.backup.providers.google || {};
        // A normal startup must respect an explicit disconnect. BootFlow may
        // accept the live main-process token only after its Google step was
        // explicitly completed, which repairs a pre-auth settings commit that
        // did not survive the required setup restart.
        if (previous.userDisconnected && options.acceptLiveReconnect !== true) return false;
        s.backup.providers.google = {
          ...previous,
          connected: true,
          email: live.email || previous.email || '',
          oauth: live.oauth !== false,
          hasRefreshToken: !!live.hasRefreshToken,
          userDisconnected: false
        };
        s.backup.cloudProvider = 'google';
        s.backup.cloudEnabled = true;
        const commit = typeof global.commitGoogleConnectionForSetup === 'function'
          ? global.commitGoogleConnectionForSetup
          : null;
        const committed = commit
          ? await commit({
            connected: true,
            email: live.email || previous.email || '',
            hasRefreshToken: !!live.hasRefreshToken,
            oauth: live.oauth !== false,
            userDisconnected: false,
          })
          : (typeof global.persistData === 'function'
            ? await global.persistData('settings', s)
            : await global.SqliteBridge?.setAuthoritative?.('settings', s));
        if (committed?.ok === false) return false;
      }
    } catch { /* empty */ }
    return isConnected();
  }

  function splitRemotePath(remotePath) {
    const parts = String(remotePath || '').split('/').filter(Boolean);
    const filename = parts.pop() || 'file.json';
    const folder = parts.join('/');
    return { folder, filename };
  }

  async function uploadJson(remotePath, data, options) {
    options = options || {};
    const bridge = getBridge();
    if (!bridge) return global.DriveErrors?.handleFailure?.({ error: 'no_backup_bridge' }) || { ok: false, error: 'no_backup_bridge' };
    if (!isConnected()) {
      return global.DriveErrors?.handleFailure?.({ error: 'offline' }) || { ok: false, offline: true };
    }
    const payload = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const { filename } = splitRemotePath(remotePath);
    const provider = options.provider || global.settings?.backup?.cloudProvider || 'google';

    let res;
    if (options.activationArtifact && bridge.uploadActivationArtifact) {
      res = await bridge.uploadActivationArtifact(payload, remotePath, provider);
    } else if (bridge.uploadCloud) {
      res = await bridge.uploadCloud(payload, filename, provider, {
        remotePath,
        overwrite: options.overwrite !== false,
        brand: 'NajjarTech',
        // V2-4: atomic replace for versions/operational JSON by default
        atomicReplace: options.atomicReplace !== false && /\.json$/i.test(filename),
        hash: options.hash
      });
    } else if (bridge.uploadSyncFile) {
      const { folder } = splitRemotePath(remotePath);
      res = await bridge.uploadSyncFile(payload, filename, provider, folder);
    } else {
      res = { ok: false, error: 'upload_unavailable' };
    }
    if (res?.ok === false) return global.DriveErrors?.handleFailure?.(res) || res;
    return res;
  }

  async function downloadJson(remotePath, options) {
    options = options || {};
    const bridge = getBridge();
    if (!bridge) return global.DriveErrors?.handleFailure?.({ error: 'no_backup_bridge' }) || { ok: false, error: 'no_backup_bridge' };
    if (!isConnected()) {
      return global.DriveErrors?.handleFailure?.({ error: 'offline' }) || { ok: false, offline: true };
    }

    let res;
    if (bridge.downloadCloudBackup) {
      const provider = options.provider || global.settings?.backup?.cloudProvider || 'google';
      res = await bridge.downloadCloudBackup(remotePath, provider);
      if (!res?.ok) return global.DriveErrors?.handleFailure?.(res) || res;
      const text = res.text || res.payload || (res.buffer ? String(res.buffer) : '');
      try {
        return { ok: true, data: JSON.parse(text), text };
      } catch {
        return { ok: true, text, data: null };
      }
    }

    if (bridge.downloadSyncFile) {
      const { folder, filename } = splitRemotePath(remotePath);
      const provider = options.provider || 'google';
      res = await bridge.downloadSyncFile(filename, provider, folder);
      if (!res?.ok) return global.DriveErrors?.handleFailure?.(res) || res;
      try {
        return { ok: true, data: JSON.parse(res.text || res.payload), text: res.text || res.payload };
      } catch {
        return { ok: true, text: res.text || res.payload, data: null };
      }
    }

    return global.DriveErrors?.handleFailure?.({ error: 'download_unavailable' }) || { ok: false, error: 'download_unavailable' };
  }

  async function uploadVersions(centerId, versions, branchId) {
    branchId = branchId || global.BranchScope?.getActiveBranchId?.() || 'BR-MAIN';
    const path = global.VersionsIndex?.drivePath?.(centerId, branchId) || global.DriveLayout?.syncVersionsJson?.(centerId, branchId);
    if (!path) return { ok: false, error: 'no_versions_path' };
    return uploadJson(path, versions, { overwrite: true });
  }

  async function downloadVersions(centerId, branchId) {
    branchId = branchId || global.BranchScope?.getActiveBranchId?.() || 'BR-MAIN';
    const paths = global.VersionsIndex?.drivePathCandidates?.(centerId, branchId)
      || global.DriveLayout?.syncVersionsJsonCandidates?.(centerId, branchId)
      || [global.DriveLayout?.syncVersionsJson?.(centerId, branchId)];
    return downloadJsonFirst(paths);
  }

  /** Try paths in order — primary branch folder first, then legacy layout */
  async function downloadJsonFirst(paths, options) {
    const list = Array.isArray(paths) ? paths.filter(Boolean) : [paths];
    let last = { ok: false, error: 'not_found' };
    for (const p of list) {
      const res = await downloadJson(p, options);
      if (res?.ok && res.data != null) return { ...res, path: p };
      last = res || last;
    }
    return last;
  }

  global.DriveAdapter = {
    isConnected,
    ensureConnected,
    uploadJson,
    downloadJson,
    downloadJsonFirst,
    uploadVersions,
    downloadVersions,
    splitRemotePath
  };
})(typeof window !== 'undefined' ? window : globalThis);
