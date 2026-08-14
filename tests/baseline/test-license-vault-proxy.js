#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const proxy = require(path.join(root, 'electron', 'license-vault-proxy'));

async function run() {
  const validUrl = 'https://script.google.com/macros/s/AKfycbx_TEST-123/exec';
  assert.strictEqual(proxy.validateUrl(validUrl), validUrl);
  for (const bad of [
    'http://script.google.com/macros/s/X/exec',
    'https://evil.example/macros/s/X/exec',
    'https://script.google.com/other',
    'file:///etc/passwd'
  ]) assert.throws(() => proxy.validateUrl(bad), /license_vault_url/);
  assert.throws(() => proxy.validateBody({ action: 'deleteEverything' }), /action_not_allowed/);

  let seen;
  const response = await proxy.request(validUrl, { action: 'status', productKey: 'TDWI2-TEST' }, {
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, status: 'unused' }) };
    },
    timeoutMs: 1000,
  });
  assert.strictEqual(response.ok, true);
  assert.strictEqual(response.status, 'unused');
  assert.strictEqual(seen.options.headers['Content-Type'], 'text/plain;charset=UTF-8');
  assert.strictEqual(JSON.parse(seen.options.body).action, 'status');
  console.log('PASS: Sheets vault proxy allowlist, payload boundary and CORS-safe transport');
}

run().catch((error) => { console.error(error.stack || error); process.exit(1); });
