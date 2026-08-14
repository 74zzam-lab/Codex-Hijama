/**
 * V2-5.10 — Fast Cloud Data Discovery (Main process).
 * Metadata-only probes with hard timeouts. NEVER downloads DB/backups/attachments.
 */
'use strict';

const drivePaths = require('./cloud-drive-paths');

// Discovery is metadata-only, but a large Drive can legitimately require
// pagination and retry time beyond one minute.
const DISCOVERY_OVERALL_MS = 180000;
const DISCOVERY_MAX_MS = 180000;
const PER_REQUEST_MS = 15000;
const PRIORITY_PARALLEL = 4;
const DISCOVERY_MAX_PAGES = 100;
const DISCOVERY_MAX_ITEMS_PER_FOLDER = 5000;
const DISCOVERY_RETRY_ATTEMPTS = 4;

function clampTimeoutMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return DISCOVERY_OVERALL_MS;
  return Math.min(Math.max(Math.floor(n), 1000), DISCOVERY_MAX_MS);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`discovery_timeout:${label}`);
      err.code = 'DISCOVERY_TIMEOUT';
      err.label = label;
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isTransientDriveError(error) {
  const value = String(error?.code || error?.status || error?.message || error || '').toLowerCase();
  return /429|5\d\d|rate.?limit|quota.*user|econnreset|etimedout|timeout|network|fetch failed/.test(value);
}

async function withRetry(operation, options = {}) {
  const attempts = Math.max(1, Math.min(Number(options.attempts) || DISCOVERY_RETRY_ATTEMPTS, 5));
  const baseDelayMs = Math.max(0, Math.min(Number(options.baseDelayMs) || 150, 2000));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientDriveError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

function nowIso() {
  return new Date().toISOString();
}

function startTrace(op) {
  return {
    op,
    startedAt: nowIso(),
    startedMs: Date.now(),
    steps: [],
  };
}

function pushStep(trace, name, startMs, result) {
  const endedMs = Date.now();
  trace.steps.push({
    op: name,
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date(endedMs).toISOString(),
    durationMs: endedMs - startMs,
    requests: result?.requests || 1,
    bytes: result?.bytes || 0,
    ok: result?.ok !== false,
    result: result?.status || (result?.ok === false ? 'fail' : 'ok'),
    detail: result?.detail || result?.message || null,
  });
}

function isBackupArtifact(name) {
  const n = String(name || '');
  if (/\.tdw$/i.test(n)) return true;
  if (/^Tadawi-Backup-V2/i.test(n)) return true;
  if (drivePaths.isDbBackupName(n)) return true;
  if (/^Backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.zip$/i.test(n)) return true;
  return false;
}

/**
 * All known backup folder layouts (V1 legacy, V2 root, center name/id, branch Backup).
 * Backup V2 uploads to `Backups/V2/` at Drive root — probed first.
 */
function buildDiscoveryProbeFolders(options = {}) {
  const centerId = String(options.centerId || '').trim();
  const centerName = String(options.centerName || '').trim();
  const branchId = String(options.branchId || '').trim();
  const branchName = String(options.branchName || '').trim();
  const V2 = drivePaths.DRIVE_V2_ROOT;
  const san = (s) => {
    const v = String(s || '').trim();
    return v ? drivePaths.sanitizeCenter(v) : '';
  };
  const folders = [];
  const add = (p) => {
    const s = String(p || '').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
    if (s && !folders.includes(s)) folders.push(s);
  };

  add('Backups/V2');
  add('Backups');

  const centerKeys = [...new Set([centerName, centerId].map(san).filter(Boolean))];
  for (const key of centerKeys) {
    add(`${V2}/${key}/Backups/V2`);
    add(`${V2}/${key}/Backups/Auto`);
    add(`${V2}/${key}/Backups/Manual`);
    add(`${V2}/${key}/Backups`);
    for (const bn of [...new Set([branchName, branchId].map(san).filter(Boolean))]) {
      add(`${V2}/${key}/Branches/${bn}/Backup`);
    }
  }

  if (centerId) {
    const cid = san(centerId);
    add(`${V2}/centers/${cid}/Backups/V2`);
    add(`${V2}/centers/${cid}/Backups/Auto`);
    add(`${V2}/centers/${cid}/Backups/Manual`);
    add(`${V2}/centers/${cid}/Backups`);
    if (branchId) add(`${V2}/centers/${cid}/branches/${san(branchId)}/Backup`);
    add(drivePaths.buildV2Path(centerId, 'Backups', 'V2'));
    add(drivePaths.buildV2Path(centerId, 'Backups', 'Auto'));
    add(drivePaths.buildV2Path(centerId, 'Backups', 'Manual'));
    add(drivePaths.buildV2Path(centerId, 'Backups'));
  }

  if (centerName) {
    add(`${drivePaths.DRIVE_APP_FOLDER}/${san(centerName)}`);
  }

  return folders;
}

function buildVersionsProbePaths(options = {}) {
  const centerId = String(options.centerId || '').trim();
  const centerName = String(options.centerName || '').trim();
  const branchId = String(options.branchId || '').trim();
  const branchName = String(options.branchName || '').trim();
  const V2 = drivePaths.DRIVE_V2_ROOT;
  const san = (s) => {
    const v = String(s || '').trim();
    return v ? drivePaths.sanitizeCenter(v) : '';
  };
  const paths = new Set();
  if (centerId) paths.add(drivePaths.buildV2SyncVersionsPath(centerId));
  for (const key of [...new Set([centerName, centerId].map(san).filter(Boolean))]) {
    paths.add(`${V2}/${key}/Sync/versions.json`);
    for (const bn of [...new Set([branchName, branchId].map(san).filter(Boolean))]) {
      paths.add(`${V2}/${key}/Branches/${bn}/versions.json`);
    }
  }
  if (centerId && branchId) {
    paths.add(`${V2}/centers/${san(centerId)}/branches/${san(branchId)}/versions.json`);
  }
  return [...paths];
}

/**
 * Shallow list of files in ONE folder (no recursion).
 */
async function listFolderShallow(googleDrive, folderPath, options = {}) {
  const pageSize = Math.max(1, Math.min(Number(options.pageSize) || 100, 1000));
  const maxPages = Math.max(1, Math.min(Number(options.maxPages) || DISCOVERY_MAX_PAGES, DISCOVERY_MAX_PAGES));
  const maxItems = Math.max(pageSize, Math.min(Number(options.maxItems) || DISCOVERY_MAX_ITEMS_PER_FOLDER, DISCOVERY_MAX_ITEMS_PER_FOLDER));
  const { oauth2 } = await googleDrive.getAuthedClient();
  const parts = String(folderPath || '').split('/').filter(Boolean);
  const parentId = await googleDrive.resolveFolderPath(oauth2, parts, { create: false });
  if (parts.length && !parentId) {
    return { ok: true, items: [], folderMissing: true, requests: 1 };
  }
  const driveApi = require('./cloud-providers/google-drive-api');
  const items = [];
  let pageToken;
  let pages = 0;
  let requests = 1; // resolveFolderPath counted roughly
  do {
    pages += 1;
    const q = [
      parentId ? `'${parentId}' in parents` : "'root' in parents",
      'trashed=false',
    ].join(' and ');
    const res = await withRetry(() => driveApi.listFiles(oauth2, {
      q,
      fields: 'nextPageToken,files(id,name,size,modifiedTime,md5Checksum,mimeType)',
      orderBy: 'modifiedTime desc',
      pageSize,
      pageToken,
    }), { attempts: options.retryAttempts, baseDelayMs: options.retryDelayMs });
    requests += 1;
    for (const f of res.files || []) {
      if (f.mimeType === 'application/vnd.google-apps.folder') continue;
      items.push({
        id: f.id,
        name: f.name,
        path: `${folderPath}/${f.name}`,
        size: Number(f.size || 0),
        modifiedAt: f.modifiedTime || null,
        md5: f.md5Checksum || null,
        isMain: drivePaths.isMainBackupName(f.name),
        isBackupV2: isBackupArtifact(f.name),
      });
      if (items.length >= maxItems) break;
    }
    pageToken = res.nextPageToken;
  } while (pageToken && pages < maxPages && items.length < maxItems);
  return {
    ok: true,
    items,
    truncated: !!pageToken,
    truncationReason: pageToken ? (items.length >= maxItems ? 'max_items' : 'max_pages') : null,
    pages,
    requests,
  };
}

async function probeFileMeta(googleDrive, remotePath) {
  const { oauth2 } = await googleDrive.getAuthedClient();
  const file = await googleDrive.findFileByPath(oauth2, remotePath);
  if (!file) return { ok: true, found: false, requests: 1 };
  return {
    ok: true,
    found: true,
    requests: 1,
    bytes: Number(file.size || 0),
    item: {
      id: file.id,
      name: file.name,
      path: remotePath,
      size: Number(file.size || 0),
      modifiedAt: file.modifiedTime || null,
      md5: file.md5Checksum || null,
    },
  };
}

function finalizeRestorePoints(out) {
  out.restorePoints.sort((a, b) => String(b.modifiedAt || '').localeCompare(String(a.modifiedAt || '')));
  const newestBackup = out.restorePoints.find((p) => p.kind === 'backup_file') || null;
  const newestAny = out.restorePoints[0] || null;
  out.newest = newestBackup || newestAny;
  return out.newest;
}

function formatTimeoutSeconds(ms) {
  return Math.round(ms / 1000);
}

/**
 * Discover restore points for a center/branch without downloading payloads.
 */
async function discoverCloudRestorePoints(options = {}) {
  const googleDrive = require('./cloud-providers/google-drive');
  const trace = startTrace('cloud_fast_discovery');
  const centerId = String(options.centerId || '').trim();
  const branchId = String(options.branchId || '').trim();
  const centerName = String(options.centerName || '').trim();
  const branchName = String(options.branchName || '').trim();
  const overallMs = clampTimeoutMs(options.timeoutMs);
  const progressSender = options.progressSender || null;

  const out = {
    ok: true,
    mode: 'fast_discovery',
    centerId: centerId || null,
    branchId: branchId || null,
    branchName: branchName || null,
    centerName: centerName || null,
    googleConnected: false,
    restorePoints: [],
    newest: null,
    status: 'unknown',
    message: null,
    durationMs: 0,
    timedOut: false,
    partialScan: false,
    truncated: false,
    downloadedBytes: 0,
    downloadedFullBackup: false,
    syncEngineStarted: false,
    instrumentation: trace,
  };

  const overallDeadline = Date.now() + overallMs;
  let foldersProbed = 0;

  function emitProgress(extra = {}) {
    const elapsedMs = Date.now() - trace.startedMs;
    const payload = {
      phase: extra.phase || 'cloud',
      folder: extra.folder || null,
      foldersDone: extra.foldersDone != null ? extra.foldersDone : foldersProbed,
      foldersTotal: extra.foldersTotal || null,
      foundCount: out.restorePoints.length,
      elapsedMs,
      budgetMs: overallMs,
      percent: extra.percent != null
        ? extra.percent
        : Math.min(95, Math.round((elapsedMs / overallMs) * 90)),
      label: extra.label || 'فحص Google Drive (بيانات وصفية فقط)',
    };
    if (typeof options.onProgress === 'function') {
      try { options.onProgress(payload); } catch { /* observer only */ }
    }
    if (progressSender && typeof progressSender.send === 'function' && !progressSender.isDestroyed?.()) {
      try { progressSender.send('backup:discoveryProgress', payload); } catch { /* observer only */ }
    }
  }

  async function step(name, fn, budgetMs = PER_REQUEST_MS) {
    const remaining = overallDeadline - Date.now();
    if (remaining <= 0) {
      const err = new Error('discovery_timeout:overall');
      err.code = 'DISCOVERY_TIMEOUT';
      throw err;
    }
    const start = Date.now();
    try {
      const result = await withTimeout(fn(), Math.min(budgetMs, remaining), name);
      pushStep(trace, name, start, result && typeof result === 'object' ? result : { ok: true });
      return result;
    } catch (err) {
      pushStep(trace, name, start, {
        ok: false,
        status: err.code || 'error',
        detail: err.message || String(err),
      });
      throw err;
    }
  }

  const seen = new Set();

  function ingestListedItems(listed, folder) {
    let added = 0;
    for (const item of listed.items || []) {
      if (!isBackupArtifact(item.name)) continue;
      if (seen.has(item.id || item.path)) continue;
      seen.add(item.id || item.path);
      out.restorePoints.push({
        kind: 'backup_file',
        source: 'cloud_backup',
        id: item.id,
        name: item.name,
        path: item.path,
        sizeBytes: item.size || 0,
        modifiedAt: item.modifiedAt,
        md5: item.md5,
        centerId,
        branchId: branchId || null,
        schemaVersion: null,
        revision: null,
        attachmentCount: null,
        recordCount: null,
        validation: 'metadata_ok',
        probedFolder: folder,
      });
      added += 1;
    }
    return added;
  }

  async function probeBackupFolder(folder, foldersTotal) {
    if (Date.now() >= overallDeadline) return false;
    emitProgress({ phase: 'folders', folder, foldersTotal, label: `فحص مجلد: ${folder}` });
    try {
      const listed = await step(`list_shallow:${folder}`, () => listFolderShallow(googleDrive, folder, {
        pageSize: 100,
        maxPages: DISCOVERY_MAX_PAGES,
        maxItems: DISCOVERY_MAX_ITEMS_PER_FOLDER,
        retryAttempts: DISCOVERY_RETRY_ATTEMPTS,
      }), Math.min(30000, Math.max(PER_REQUEST_MS, overallDeadline - Date.now())));
      if (listed.truncated) {
        out.truncated = true;
        out.partialScan = true;
        out.truncationReason = listed.truncationReason || 'page_limit';
      }
      ingestListedItems(listed, folder);
    } catch (err) {
      if (err.code === 'DISCOVERY_TIMEOUT') throw err;
      // folder missing / access — continue other probes
    }
    foldersProbed += 1;
    emitProgress({ phase: 'folders', folder, foldersDone: foldersProbed, foldersTotal });
    return true;
  }

  try {
    emitProgress({ phase: 'oauth', label: 'التحقق من اتصال Google…', percent: 2 });

    // 1) Google connection / token
    const status = await step('oauth_status', async () => {
      const s = await googleDrive.getStatus();
      return {
        ok: !!s?.connected && !s?.needsReauth,
        status: s?.needsReauth ? 'needs_reauth' : (s?.connected ? 'connected' : 'disconnected'),
        detail: s?.email || null,
        requests: 1,
        raw: s,
      };
    });
    out.googleConnected = !!status?.ok;
    if (!out.googleConnected) {
      out.status = status?.status === 'needs_reauth' ? 'token_expired' : 'offline';
      out.message = status?.status === 'needs_reauth'
        ? 'انتهت صلاحية جلسة Google — أعد الربط ثم أعد المحاولة.'
        : 'حساب Google غير متصل.';
      out.ok = true;
      out.durationMs = Date.now() - trace.startedMs;
      trace.endedAt = nowIso();
      trace.durationMs = out.durationMs;
      return out;
    }

    // 2) Shallow backup folder probes — priority batch in parallel, then sequential
    const backupFolders = buildDiscoveryProbeFolders({
      centerId, centerName, branchId, branchName,
    });
    out.probedFolders = backupFolders.slice();
    const foldersTotal = backupFolders.length;
    const priorityBatch = backupFolders.slice(0, PRIORITY_PARALLEL);
    const remainingFolders = backupFolders.slice(PRIORITY_PARALLEL);

    emitProgress({
      phase: 'folders',
      foldersDone: 0,
      foldersTotal,
      label: `فحص ${foldersTotal} مساراً معروفاً على Drive…`,
      percent: 8,
    });

    await Promise.all(priorityBatch.map((folder) => probeBackupFolder(folder, foldersTotal)));

    for (const folder of remainingFolders) {
      if (Date.now() >= overallDeadline) {
        out.partialScan = foldersProbed < foldersTotal;
        break;
      }
      await probeBackupFolder(folder, foldersTotal);
    }

    // 3) Sync checkpoint / versions.json metadata only (file meta, not full table sync)
    emitProgress({ phase: 'versions', label: 'فحص نقاط المزامنة (versions.json)…', percent: 85 });
    const versionsPaths = buildVersionsProbePaths({
      centerId, centerName, branchId, branchName,
    });
    for (const versionsPath of versionsPaths) {
      if (Date.now() >= overallDeadline) {
        out.partialScan = true;
        break;
      }
      try {
        const meta = await step(`versions_meta:${versionsPath}`, () => probeFileMeta(googleDrive, versionsPath), PER_REQUEST_MS);
        if (meta.found) {
          out.restorePoints.push({
            kind: 'sync_checkpoint',
            source: 'cloud_sync',
            id: meta.item.id,
            name: meta.item.name,
            path: meta.item.path,
            sizeBytes: meta.item.size || 0,
            modifiedAt: meta.item.modifiedAt,
            md5: meta.item.md5,
            centerId,
            branchId: branchId || null,
            schemaVersion: null,
            revision: 'versions.json',
            attachmentCount: null,
            recordCount: null,
            validation: 'metadata_ok',
          });
          break;
        }
      } catch (err) {
        if (err.code === 'DISCOVERY_TIMEOUT') throw err;
      }
    }

    finalizeRestorePoints(out);
    emitProgress({ phase: 'done', percent: 100, label: 'اكتمل الفحص' });

    if (out.truncated) {
      out.ok = false;
      out.status = 'truncated';
      out.message = 'تعذر إكمال جرد Google Drive ضمن حدود الأمان. لم يتم اختيار نسخة تلقائياً؛ أعد المحاولة.';
    } else if (out.partialScan) {
      out.ok = false;
      out.timedOut = true;
      out.status = 'timeout';
      out.message = `انتهى وقت الفحص (${formatTimeoutSeconds(overallMs)} ث) قبل اكتمال جميع المسارات. لم يتم اختيار نسخة تلقائياً.`;
    } else if (!out.newest) {
      out.status = 'not_found';
      out.message = 'لم يتم العثور على نسخ سحابية على Drive. تأكد من نفس حساب Google قبل إعادة التثبيت، أو اختر «ملف Backup» إذا لديك نسخة محلية (.tdw).';
    } else {
      out.status = 'ready';
      out.message = 'وُجدت نقطة استعادة سحابية — أكّد قبل التنزيل.';
    }
  } catch (err) {
    finalizeRestorePoints(out);
    if (err.code === 'DISCOVERY_TIMEOUT') {
      out.timedOut = true;
      out.partialScan = true;
      const sec = formatTimeoutSeconds(overallMs);
      out.status = 'timeout';
      out.message = out.newest
        ? `وُجدت نتيجة جزئية، لكن فحص السحابة تجاوز المهلة (${sec} ث). لم يتم اختيار نسخة تلقائياً.`
        : `تجاوز فحص السحابة المهلة (${sec} ثانية). أعد المحاولة أو اختر مصدراً آخر.`;
      out.ok = false;
    } else {
      out.ok = false;
      out.status = 'error';
      out.message = err.message || String(err);
    }
  }

  out.durationMs = Date.now() - trace.startedMs;
  trace.endedAt = nowIso();
  trace.durationMs = out.durationMs;
  out.instrumentation = trace;
  return out;
}

module.exports = {
  DISCOVERY_OVERALL_MS,
  DISCOVERY_MAX_MS,
  PER_REQUEST_MS,
  DISCOVERY_MAX_PAGES,
  DISCOVERY_MAX_ITEMS_PER_FOLDER,
  DISCOVERY_RETRY_ATTEMPTS,
  clampTimeoutMs,
  withTimeout,
  withRetry,
  isTransientDriveError,
  listFolderShallow,
  probeFileMeta,
  isBackupArtifact,
  buildDiscoveryProbeFolders,
  buildVersionsProbePaths,
  discoverCloudRestorePoints,
};
