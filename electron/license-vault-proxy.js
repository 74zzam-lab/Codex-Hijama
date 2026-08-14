'use strict';

const ALLOWED_ACTIONS = new Set(['fetchBundle', 'activate', 'patchActivation', 'status']);

function validateUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch { throw new Error('license_vault_url_invalid'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'script.google.com'
      || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(parsed.pathname)) {
    throw new Error('license_vault_url_not_allowed');
  }
  return parsed.toString();
}

function validateBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('license_vault_body_invalid');
  if (!ALLOWED_ACTIONS.has(String(value.action || ''))) throw new Error('license_vault_action_not_allowed');
  const encoded = JSON.stringify(value);
  if (encoded.length > 64 * 1024) throw new Error('license_vault_request_too_large');
  return encoded;
}

async function request(url, body, options = {}) {
  const target = validateUrl(url);
  const encoded = validateBody(body);
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs) || 120000, 180000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(target, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: encoded,
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await response.text();
    if (text.length > 1024 * 1024) return { ok: false, error: 'vault_response_too_large' };
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!response.ok) return { ok: false, error: data.error || `vault_http_${response.status}` };
    return data;
  } catch (error) {
    return {
      ok: false,
      error: error?.name === 'AbortError' ? 'network_timeout' : 'vault_unreachable',
      message: error?.message || String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { ALLOWED_ACTIONS, validateUrl, validateBody, request };
