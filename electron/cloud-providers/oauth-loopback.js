/**
 * OAuth 2.0 loopback redirect server for desktop apps.
 */
'use strict';

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

function stateMatches(actual, expected) {
  if (!expected || !actual) return false;
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function attachOAuthHandler(server, getPort, callbackPath, expectedState, resolve, reject) {
  let settled = false;
  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try { server.close(); } catch { /* ignore */ }
    fn(value);
  };
  const timer = setTimeout(() => {
    finish(reject, new Error('oauth_timeout'));
  }, 5 * 60 * 1000);

  server.on('request', (req, res) => {
    if (settled) {
      res.writeHead(410, { 'Content-Type': 'text/plain' });
      res.end('OAuth request already consumed');
      return;
    }
    try {
      const port = getPort();
      const u = new URL(req.url, `http://127.0.0.1:${port}`);
      const pathname = u.pathname || '/';
      if (pathname !== callbackPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const code = u.searchParams.get('code');
      const error = u.searchParams.get('error');
      const state = u.searchParams.get('state');
      if (!stateMatches(state, expectedState)) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body><h2>OAuth request rejected</h2><p>Invalid or expired state.</p></body></html>');
        finish(reject, new Error('oauth_state_invalid'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (error) {
        res.end('<html dir="rtl"><body><h2>فشل الربط</h2><p>يمكنك إغلاق هذه النافذة.</p></body></html>');
        finish(reject, new Error(String(error).slice(0, 160)));
        return;
      }
      if (code) {
        res.end('<html dir="rtl"><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>✅ تم الربط بنجاح</h2><p>يمكنك إغلاق هذه النافذة والعودة للبرنامج.</p></body></html>');
        finish(resolve, { code, state });
        return;
      }
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing authorization code');
      finish(reject, new Error('oauth_code_missing'));
    } catch (e) {
      try {
        res.writeHead(500);
        res.end('Error');
      } catch { /* ignore */ }
      finish(reject, e);
    }
  });
}

function startLoopbackServer(port, callbackPath = '/oauth/callback', options = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    attachOAuthHandler(server, () => port, callbackPath, options.expectedState, resolve, reject);
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {});
  });
}

/**
 * Prefer preferredPort; on EADDRINUSE try nearby ports then ephemeral.
 * @returns {Promise<{ port: number, codePromise: Promise<string> }>}
 */
async function startLoopbackServerFlexible(preferredPort = 42813, callbackPath = '/oauth/callback', options = {}) {
  const base = Number(preferredPort) || 42813;
  const candidates = [base, base + 1, base + 2, base + 3];

  for (const port of candidates) {
    try {
      const codePromise = startLoopbackServer(port, callbackPath, options);
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve('listening'), 50);
        codePromise.then(
          () => { clearTimeout(t); resolve('code'); },
          (err) => { clearTimeout(t); reject(err); }
        );
      });
      return { port, codePromise };
    } catch (err) {
      if (!/EADDRINUSE/i.test(String(err && (err.code || err.message)))) {
        throw err;
      }
    }
  }

  return new Promise((resolveOuter, rejectOuter) => {
    const server = http.createServer();
    let settled = false;
    let codeResolve;
    let codeReject;
    const codePromise = new Promise((res, rej) => {
      codeResolve = res;
      codeReject = rej;
    });

    attachOAuthHandler(
      server,
      () => server.address().port,
      callbackPath,
      options.expectedState,
      (code) => codeResolve(code),
      (err) => {
        if (!settled) {
          settled = true;
          rejectOuter(err);
        }
        codeReject(err);
      }
    );

    server.on('error', (err) => {
      if (!settled) {
        settled = true;
        rejectOuter(err);
      }
      codeReject(err);
    });

    server.listen(0, '127.0.0.1', () => {
      settled = true;
      resolveOuter({ port: server.address().port, codePromise });
    });
  });
}

module.exports = { startLoopbackServer, startLoopbackServerFlexible };
