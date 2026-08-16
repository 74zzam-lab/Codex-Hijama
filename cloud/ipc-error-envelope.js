/**
 * IPC error envelope — preserves Main-process failure codes across Electron IPC.
 *
 * Electron's `ipcRenderer.invoke` rejects with a NEW Error in the renderer whose
 * message is `Error invoking remote method '<channel>': <original.toString()>`.
 * Custom properties (`err.code`, `err.stage`, ...) are NOT transferred. Any code
 * that reads `error.code` in the renderer therefore silently loses the real cause
 * and falls back to the wrapper text, which then becomes a meaningless diagnostic.
 *
 * Main encodes the machine-readable cause into the Error MESSAGE (the only field
 * that survives). The renderer decodes it back before classification.
 */
(function (global) {
  'use strict';

  const ENVELOPE_RE = /\[TDWERR\s+([^\]]+)\]/;
  const IPC_WRAPPER_RE = /^Error invoking remote method\s+'([^']*)'\s*:\s*(?:Error:\s*)?([\s\S]*)$/;
  const CODE_SAFE_RE = /^[a-z0-9_.:-]+$/i;

  function sanitizeToken(value) {
    return String(value == null ? '' : value)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[[\]]/g, '')
      .trim();
  }

  /**
   * Build an Error message that carries the cause across IPC.
   * Only non-sensitive, machine-readable fields belong here.
   */
  function encodeIpcError(code, fields) {
    const parts = [`code=${sanitizeToken(code) || 'unknown_error'}`];
    for (const [key, raw] of Object.entries(fields || {})) {
      if (raw == null || raw === '') continue;
      const token = sanitizeToken(raw).replace(/\s+/g, '_');
      if (!token) continue;
      parts.push(`${sanitizeToken(key)}=${token}`);
    }
    return `[TDWERR ${parts.join(' ')}]`;
  }

  /** Strip Electron's `Error invoking remote method '<ch>': ...` wrapper. */
  function unwrapIpcMessage(message) {
    const text = String(message == null ? '' : message);
    const match = IPC_WRAPPER_RE.exec(text.trim());
    if (!match) return { channel: null, inner: text };
    return { channel: match[1] || null, inner: String(match[2] || '').trim() };
  }

  /**
   * Recover `{ code, fields, channel, wrapped }` from an Error, string, or
   * result object that crossed the IPC boundary.
   */
  function decodeIpcError(input) {
    const rawMessage = typeof input === 'string'
      ? input
      : String(input?.message || input?.error || input?.code || '');
    const { channel, inner } = unwrapIpcMessage(rawMessage);
    const envelope = ENVELOPE_RE.exec(inner) || ENVELOPE_RE.exec(rawMessage);
    const fields = {};
    let code = null;
    if (envelope) {
      for (const pair of String(envelope[1]).split(/\s+/)) {
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        const key = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        if (key === 'code') code = value;
        else fields[key] = value;
      }
    }
    if (!code) {
      // No envelope (older Main build, or a plain `throw new Error('some_code')`).
      // Accept the inner text only when it already looks like a code token.
      const candidate = inner.replace(/^Error:\s*/i, '').trim();
      if (candidate && candidate.length <= 64 && CODE_SAFE_RE.test(candidate)) code = candidate;
    }
    if (!code && typeof input === 'object' && input && CODE_SAFE_RE.test(String(input.code || ''))) {
      code = String(input.code);
    }
    return {
      code: code || null,
      fields,
      channel,
      wrapped: channel != null,
      inner,
    };
  }

  /** True when `value` is (or wraps) an Electron IPC invoke rejection. */
  function isIpcWrapperError(value) {
    const message = typeof value === 'string' ? value : String(value?.message || '');
    return IPC_WRAPPER_RE.test(message.trim());
  }

  const api = { encodeIpcError, decodeIpcError, unwrapIpcMessage, isIpcWrapperError };

  global.IpcErrorEnvelope = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
