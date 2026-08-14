/**
 * Minimal Google Drive API v3 client (REST) — avoids bundling full googleapis (~200MB).
 */
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

async function getAccessToken(oauth2) {
  const res = await oauth2.getAccessToken();
  const token = res?.token || res;
  if (!token) throw new Error('google_no_access_token');
  return token;
}

async function driveFetch(oauth2, url, options = {}) {
  const token = await getAccessToken(oauth2);
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`drive_api_${res.status}:${text.slice(0, 200)}`);
  }
  if (options.raw) return res;
  if (options.method === 'DELETE' || res.status === 204) return { ok: true };
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

function buildMultipartBody(metadata, mimeType, data) {
  const boundary = `cupping_${Date.now().toString(36)}`;
  const metaPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    'utf8'
  );
  const fileHeader = Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, 'utf8');
  const fileData = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  const end = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    boundary,
    body: Buffer.concat([metaPart, fileHeader, fileData, end])
  };
}

async function listFiles(oauth2, { q, fields, pageSize = 100, pageToken, orderBy }) {
  const params = new URLSearchParams({
    q,
    fields: fields || 'files(id,name,size,modifiedTime,md5Checksum,mimeType),nextPageToken',
    spaces: 'drive',
    pageSize: String(pageSize)
  });
  if (pageToken) params.set('pageToken', pageToken);
  if (orderBy) params.set('orderBy', orderBy);
  return driveFetch(oauth2, `${DRIVE}/files?${params}`);
}

async function createFolder(oauth2, metadata) {
  const params = new URLSearchParams({ fields: 'id,name' });
  return driveFetch(oauth2, `${DRIVE}/files?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata)
  });
}

async function createFile(oauth2, metadata, mimeType, data) {
  const { boundary, body } = buildMultipartBody(metadata, mimeType, data);
  const params = new URLSearchParams({
    uploadType: 'multipart',
    fields: 'id,name,modifiedTime,size,md5Checksum'
  });
  return driveFetch(oauth2, `${UPLOAD}/files?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
}

async function updateFile(oauth2, fileId, metadata, mimeType, data) {
  const { boundary, body } = buildMultipartBody(metadata, mimeType, data);
  const params = new URLSearchParams({
    uploadType: 'multipart',
    fields: 'id,name,modifiedTime,size,md5Checksum'
  });
  return driveFetch(oauth2, `${UPLOAD}/files/${fileId}?${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
}

async function downloadFile(oauth2, fileId) {
  const res = await driveFetch(oauth2, `${DRIVE}/files/${fileId}?alt=media`, { raw: true });
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

/**
 * Stream a Drive file with optional progress + direct-to-disk write.
 * options.onProgress({ stage, downloadedBytes, totalBytes, percent })
 * options.destPath — when set, writes incrementally instead of buffering entirely in RAM.
 */
async function downloadFileWithProgress(oauth2, fileId, options = {}) {
  const fs = require('fs');
  const path = require('path');
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const destPath = options.destPath ? String(options.destPath) : null;
  const res = await driveFetch(oauth2, `${DRIVE}/files/${fileId}?alt=media`, { raw: true });
  const headerTotal = Number(res.headers.get('content-length'));
  const totalBytes = Number.isFinite(headerTotal) && headerTotal > 0
    ? headerTotal
    : (Number(options.totalBytes) > 0 ? Number(options.totalBytes) : null);
  const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;

  const emit = (downloadedBytes) => {
    if (!onProgress) return;
    try {
      onProgress({
        stage: 'downloading',
        downloadedBytes,
        totalBytes,
        percent: totalBytes ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null,
      });
    } catch { /* observer only */ }
  };

  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    emit(buf.length);
    if (destPath) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, buf, { mode: 0o600 });
      return { bytes: buf.length, path: destPath, buffer: null };
    }
    return { bytes: buf.length, path: null, buffer: buf };
  }

  let downloadedBytes = 0;
  const chunks = destPath ? null : [];
  let fd = null;
  if (destPath) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fd = fs.openSync(destPath, 'w');
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      if (fd != null) fs.writeSync(fd, chunk);
      else chunks.push(chunk);
      downloadedBytes += chunk.length;
      emit(downloadedBytes);
    }
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
  if (destPath) return { bytes: downloadedBytes, path: destPath, buffer: null };
  const buffer = Buffer.concat(chunks);
  return { bytes: downloadedBytes, path: null, buffer };
}

async function deleteFile(oauth2, fileId) {
  await driveFetch(oauth2, `${DRIVE}/files/${fileId}`, { method: 'DELETE' });
  return { ok: true };
}

async function getAbout(oauth2, fields = 'user(emailAddress,displayName)') {
  const params = new URLSearchParams({ fields });
  return driveFetch(oauth2, `${DRIVE}/about?${params}`);
}

async function getUserEmail(oauth2) {
  try {
    const about = await getAbout(oauth2, 'user(emailAddress,displayName)');
    if (about?.user?.emailAddress) return about.user.emailAddress;
  } catch { /* fallback below */ }
  try {
    const token = await getAccessToken(oauth2);
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      return data.email || '';
    }
  } catch { /* ignore */ }
  return '';
}

module.exports = {
  listFiles,
  createFolder,
  createFile,
  updateFile,
  downloadFile,
  downloadFileWithProgress,
  deleteFile,
  getAbout,
  getUserEmail
};
