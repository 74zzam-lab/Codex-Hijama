'use strict';

/**
 * Window navigation, permissions, CSP, and child-window policy (Phase 2).
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { shell } = require('electron');

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:', 'sms:']);
const DENIED_PERMISSIONS = new Set([
  'media',
  'mediaKeySystem',
  'geolocation',
  'notifications',
  'midi',
  'midiSysex',
  'pointerLock',
  'openExternal',
  'clipboard-read',
  'display-capture',
  'serial',
  'usb',
  'hid',
  'idleDetection',
  'camera',
  'microphone',
]);
// No Chromium permission is currently required by the desktop product.
// New permissions must be explicitly reviewed and added here.
const ALLOWED_PERMISSIONS = new Set([]);

function sha256Csp(value) {
  return `'sha256-${crypto.createHash('sha256').update(String(value), 'utf8').digest('base64')}'`;
}

function decodeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&#(x[0-9a-f]+|\d+);?/gi, (_m, code) => {
      const n = String(code).toLowerCase().startsWith('x')
        ? parseInt(String(code).slice(1), 16)
        : parseInt(code, 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : '';
    })
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function collectScriptHashes(appRoot) {
  const elementHashes = new Set();
  const attributeHashes = new Set();
  const indexPath = path.join(appRoot, 'index.html');
  const indexSource = fs.readFileSync(indexPath, 'utf8');
  for (const match of indexSource.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    elementHashes.add(sha256Csp(match[1]));
  }

  const scan = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'docs', 'tests', '.git'].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { scan(file); continue; }
      if (!/\.(?:html?|js|mjs|cjs)$/i.test(entry.name)) continue;
      let source = '';
      try { source = fs.readFileSync(file, 'utf8'); } catch { continue; }
      for (const match of source.matchAll(/\son[a-z]+\s*=\s*(["'])([\s\S]*?)\1/gi)) {
        const handler = decodeHtmlAttribute(match[2]);
        if (!handler || handler.includes('${')) continue;
        attributeHashes.add(sha256Csp(handler));
      }
    }
  };
  scan(appRoot);
  return { elementHashes: [...elementHashes].sort(), attributeHashes: [...attributeHashes].sort() };
}

function buildContentSecurityPolicy(appRoot) {
  const hashes = appRoot && fs.existsSync(path.join(appRoot, 'index.html'))
    ? collectScriptHashes(appRoot)
    : { elementHashes: [], attributeHashes: [] };
  return [
  "default-src 'self'",
  `script-src 'self' ${hashes.elementHashes.join(' ')}`.trim(),
  `script-src-elem 'self' ${hashes.elementHashes.join(' ')}`.trim(),
  `script-src-attr 'unsafe-hashes' ${hashes.attributeHashes.join(' ')}`.trim(),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Google OAuth/Drive + Apps Script license vault + best-effort time checks
  "connect-src 'self' https://www.googleapis.com https://oauth2.googleapis.com https://accounts.google.com https://www.google.com https://googleapis.com https://script.google.com https://script.googleusercontent.com https://timeapi.io https://worldtimeapi.org",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "worker-src 'self' blob:",
  ].join('; ');
}

const CSP = buildContentSecurityPolicy(null);

function isAllowedExternalUrl(urlString) {
  try {
    const u = new URL(urlString);
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(u.protocol)) return false;
    // Block file / UNC disguised as weird protocols already handled
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      // no credentials in URL
      if (u.username || u.password) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function openExternalSafe(urlString) {
  if (!isAllowedExternalUrl(urlString)) {
    return { ok: false, error: 'external_url_denied' };
  }
  await shell.openExternal(urlString);
  return { ok: true };
}

function isAppLocalUrl(urlString, appRoot) {
  try {
    const u = new URL(urlString);
    if (u.protocol === 'file:') {
      const filePath = decodeURIComponent(u.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
      const resolved = path.resolve(filePath);
      const root = path.resolve(appRoot);
      const rel = path.relative(root, resolved);
      return !rel.startsWith('..') && !path.isAbsolute(rel);
    }
    // Electron may use custom app protocol in future — deny for now
    return false;
  } catch {
    return false;
  }
}

function isBlankUrl(urlString) {
  return !urlString || urlString === 'about:blank' || urlString.startsWith('about:blank#');
}

/**
 * Classify window.open / setWindowOpenHandler requests.
 * @returns {'external'|'print'|'app-local'|'deny'}
 */
function classifyWindowOpen(urlString, appRoot) {
  if (isBlankUrl(urlString)) return 'print';
  if (isAllowedExternalUrl(urlString)) return 'external';
  if (isAppLocalUrl(urlString, appRoot)) return 'app-local';
  return 'deny';
}

function applyPermissionPolicy(session) {
  session.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ALLOWED_PERMISSIONS.has(permission);
    callback(allowed);
  });
  session.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
}

function applyContentSecurityPolicy(session, options = {}) {
  const policy = buildContentSecurityPolicy(options.appRoot);
  session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...(details.responseHeaders || {}) };
    // Avoid duplicating if already present
    const key = Object.keys(headers).find((k) => k.toLowerCase() === 'content-security-policy');
    if (!key) {
      headers['Content-Security-Policy'] = [policy];
    }
    callback({ responseHeaders: headers });
  });
}

function attachNavigationGuards(webContents, { appRoot, isMain = false } = {}) {
  webContents.on('will-navigate', (event, url) => {
    if (isBlankUrl(url)) return;
    if (isAppLocalUrl(url, appRoot)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) {
      openExternalSafe(url).catch(() => {});
    }
  });

  webContents.on('will-redirect', (event, url) => {
    if (isAppLocalUrl(url, appRoot) || isBlankUrl(url)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) {
      openExternalSafe(url).catch(() => {});
    }
  });

  // Main window should not become an arbitrary remote page
  if (isMain) {
    webContents.on('will-frame-navigate', (event) => {
      const url = event.url;
      if (isAppLocalUrl(url, appRoot) || isBlankUrl(url)) return;
      event.preventDefault();
      if (isAllowedExternalUrl(url)) {
        openExternalSafe(url).catch(() => {});
      }
    });
  }
}

function secureWebPreferences({ preloadPath = null, isProd = false, sandbox = true } = {}) {
  const prefs = {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: sandbox !== false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    devTools: !isProd,
  };
  if (preloadPath) prefs.preload = preloadPath;
  return prefs;
}

module.exports = {
  CSP,
  buildContentSecurityPolicy,
  collectScriptHashes,
  ALLOWED_EXTERNAL_PROTOCOLS,
  DENIED_PERMISSIONS,
  ALLOWED_PERMISSIONS,
  isAllowedExternalUrl,
  openExternalSafe,
  isAppLocalUrl,
  isBlankUrl,
  classifyWindowOpen,
  applyPermissionPolicy,
  applyContentSecurityPolicy,
  attachNavigationGuards,
  secureWebPreferences,
};
