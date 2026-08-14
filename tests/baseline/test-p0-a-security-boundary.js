#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const rbac = require(path.join(root, 'electron', 'rbac-session'));
const passwordAuth = require(path.join(root, 'electron', 'security', 'password-auth'));
const windowPolicy = require(path.join(root, 'electron', 'security', 'window-policy'));
const printDocument = require(path.join(root, 'electron', 'security', 'print-document'));
const oauthLoopback = require(path.join(root, 'electron', 'cloud-providers', 'oauth-loopback'));
const tokenStore = require(path.join(root, 'electron', 'cloud-providers', 'token-store'));
const queue = require(path.join(root, 'electron', 'communication', 'queue'));
const credentialVault = require(path.join(root, 'electron', 'security', 'secure-credential-vault'));
const licenseEntitlements = require(path.join(root, 'electron', 'license-entitlements'));

let checks = 0;
function check(condition, message) {
  checks += 1;
  assert.ok(condition, message);
}

function event(id) {
  return { sender: { id } };
}

function bindAuthenticatedUser(senderId, user, password) {
  const e = event(senderId);
  const auth = passwordAuth.authenticateUser([user], {
    userId: user.id, role: user.role, password,
  }, senderId);
  assert.equal(auth.ok, true);
  const proof = rbac.issueAuthenticationProof(e, {
    userId: user.id,
    role: user.role,
    sessionEpoch: Number(user.sessionEpoch) || 0,
  });
  assert.equal(proof.ok, true);
  const bound = rbac.bindSession(e, {
    userId: user.id,
    role: user.role,
    authProof: proof.proof,
    lookupUsers: () => [user],
  });
  assert.equal(bound.ok, true);
  return e;
}

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: urlPath }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
  });
}

async function testRbacAndPasswords() {
  rbac.resetForTests();
  passwordAuth.resetForTests();
  const devPassword = String(process.env.TDAWI_P0A_DEVELOPER_PASSWORD || '');
  const forged = rbac.bindSession(event(1), { userId: '__dev__', role: 'admin' });
  check(forged.ok === false && forged.error === 'authentication_proof_required', 'forged developer bind denied');

  if (devPassword) {
    const devAuth = passwordAuth.authenticateDeveloper(devPassword, 1);
    check(devAuth.ok === true, 'intentional developer password remains valid');
    const devProof = rbac.issueAuthenticationProof(event(1), devAuth);
    const bound = rbac.bindSession(event(1), { userId: '__dev__', role: 'admin', authProof: devProof.proof });
    check(bound.ok === true, 'developer binds only after main proof');
    const replay = rbac.bindSession(event(1), { userId: '__dev__', role: 'admin', authProof: devProof.proof });
    check(replay.ok === false, 'authentication proof is one-time');
    check(
      licenseEntitlements.check(null, { actorId: '__dev__' }).developerSupport === true,
      'authenticated developer support retains its intended pre-license entitlement'
    );
  } else {
    check(
      passwordAuth.DEVELOPER_CREDENTIALS.every((entry) => /^pbkdf2(?:v2)?[:$]/.test(String(entry?.hash || ''))),
      'developer credentials remain hash-only when the runtime secret is not injected'
    );
  }

  const ownerPassword = 'Owner-Strong-2026!';
  const owner = {
    id: 'owner-1', username: 'owner', role: 'owner', active: true,
    password: passwordAuth.hashPasswordV2(ownerPassword), sessionEpoch: 4,
  };
  const ownerForged = rbac.bindSession(event(2), {
    userId: owner.id, role: owner.role, lookupUsers: () => [owner],
  });
  check(ownerForged.ok === false, 'real owner identity also requires proof');
  const ownerEvent = bindAuthenticatedUser(2, owner, ownerPassword);
  check(rbac.getSession(ownerEvent)?.sessionEpoch === 4, 'session epoch is main-owned');

  const receptionPassword = 'Reception-Strong-2026!';
  const reception = {
    id: 'reception-1', username: 'reception', role: 'reception', active: true,
    password: passwordAuth.hashPasswordV2(receptionPassword), sessionEpoch: 1,
  };
  const receptionEvent = bindAuthenticatedUser(3, reception, receptionPassword);
  assert.throws(() => rbac.assertKvWriteAllowed(receptionEvent, 'users'), /rbac_kv_key_denied/);
  assert.throws(() => rbac.assertKvWriteAllowed(receptionEvent, 'settings'), /rbac_kv_key_denied/);
  check(rbac.assertKvWriteAllowed(receptionEvent, 'messageLog').ok === true, 'operational low-role KV remains allowed');
  check(rbac.sessionAllowsChannel(rbac.getSession(receptionEvent), 'cache:writeLicense').ok === false, 'low role cannot write cached license');
  check(rbac.sessionAllowsChannel(rbac.getSession(receptionEvent), 'cache:writeBranchConfig').ok === false, 'low role cannot write cached users/settings branch pack');
  check(rbac.sessionAllowsChannel(rbac.getSession(receptionEvent), 'made:up').error === 'rbac_channel_unregistered', 'unknown IPC denied');

  const updated = [{ ...owner, sessionEpoch: 5 }];
  check(rbac.invalidateStaleUserSessions(updated) >= 1, 'epoch change invalidates stale main sessions');

  let persisted = [];
  passwordAuth.resetForTests();
  passwordAuth.configureAttemptPersistence({
    load: () => persisted,
    save: (entries) => { persisted = JSON.parse(JSON.stringify(entries)); },
  });
  for (let i = 0; i < passwordAuth.MAX_FAILURES; i += 1) {
    passwordAuth.authenticateDeveloper('wrong-password', 99, 1_000 + i);
  }
  check(passwordAuth.checkThrottle(100, '__dev__', 2_000).ok === false, 'rate limit applies across senders');
  passwordAuth.resetForTests();
  passwordAuth.configureAttemptPersistence({ load: () => persisted, save: () => {} });
  check(passwordAuth.checkThrottle(101, '__dev__', 2_000).ok === false, 'rate limit survives restart reload');
}

function testIpcCoverage() {
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
  const block = preload.match(/const ALLOWED_INVOKE = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(block, 'preload invoke allowlist found');
  const channels = [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const handlerSource = [
    'electron/main.js', 'electron/backup-v2-ipc.js', 'electron/attachments-ipc.js',
  ].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  const handlers = new Set([...handlerSource.matchAll(/handle\(\s*['"]([^'"]+)/g)].map((match) => match[1]));
  const missingHandlers = channels.filter((channel) => !handlers.has(channel));
  const missingPolicies = channels.filter((channel) => !rbac.CHANNEL_POLICY[channel]);
  check(missingHandlers.length === 0, `all preload channels have handlers: ${missingHandlers.join(',')}`);
  check(missingPolicies.length === 0, `all preload channels have explicit policies: ${missingPolicies.join(',')}`);
  check(channels.length === Object.keys(rbac.CHANNEL_POLICY).length - 2, 'policy inventory exactly covers preload plus two sync dialogs');
  check(rbac.CHANNEL_POLICY['backup:uploadCloud'].public !== true, 'generic cloud upload is not public');
  check(rbac.CHANNEL_POLICY['backup:uploadActivationArtifact'].public === true, 'only constrained activation upload is public');
}

function testXssCspPrintAndPermissions() {
  const csp = windowPolicy.buildContentSecurityPolicy(root);
  check(!/script-src[^;]*'unsafe-inline'/.test(csp), 'script-src has no unsafe-inline');
  check(/script-src-attr 'unsafe-hashes'/.test(csp), 'legacy fixed handlers use exact hashes');
  check(windowPolicy.collectScriptHashes(root).elementHashes.length === 7, 'all seven inline application blocks are hashed');

  const payload = `<!DOCTYPE html><html><head><style>@import 'https://evil';body{background:url(file:///secret)}</style></head><body>
    <script>globalThis.PWNED=1</script><img src=x onerror="globalThis.PWNED=2">
    <iframe srcdoc="<script>globalThis.PWNED=3</script>"></iframe>
    <div style="width:expression(alert(1))">Patient</div></body></html>`;
  const clean = printDocument.sanitizePrintDocument(payload);
  check(!/<script|onerror|<iframe|srcdoc|@import|url\s*\(|expression\s*\(/i.test(clean), 'print payload is inert');
  check(/script-src 'none'/.test(clean), 'print document carries a no-script CSP');

  let requestHandler;
  let checkHandler;
  windowPolicy.applyPermissionPolicy({
    setPermissionRequestHandler: (handler) => { requestHandler = handler; },
    setPermissionCheckHandler: (handler) => { checkHandler = handler; },
  });
  for (const permission of ['camera', 'microphone', 'geolocation', 'future-unknown-permission']) {
    let allowed = true;
    requestHandler(null, permission, (value) => { allowed = value; });
    check(allowed === false && checkHandler(null, permission) === false, `${permission} denied by default`);
  }

  const renderer = fs.readFileSync(path.join(root, 'renderer', 'security', 'safe-render.js'), 'utf8');
  check(/DOMPurify\.sanitize/.test(renderer) && /Element\.prototype, 'innerHTML'/.test(renderer), 'central renderer sanitizer enforces dynamic HTML');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const inlineScripts = [...index.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  check(!/\son(?:click|change|input|keydown|contextmenu)\s*=/.test(inlineScripts), 'main renderer generates no inline event attributes');
  check(/id="reportPreviewFrame"[^>]*sandbox="allow-same-origin"/.test(index), 'report preview iframe denies scripts while allowing local report assets');
  check(/_reportPreviewHtml\s*=\s*\(typeof SafeRender/.test(index), 'report preview sanitizes legacy/stored data before srcdoc');
  check(
    /applyTheme\(getActiveThemeKey\(\),\s*\{\s*silent:\s*true,\s*persist:\s*false\s*\}\)/.test(index),
    'first-run theme render is read-only before RBAC session exists'
  );
  const platformServices = fs.readFileSync(path.join(root, 'cupping-platform-services.js'), 'utf8');
  check(
    /applyTheme\(theme,\s*\{\s*silent:\s*true,\s*persist:\s*false\s*\}\)/.test(platformServices),
    'platform startup theme render is also read-only before RBAC session exists'
  );
  const branchContexts = fs.readFileSync(path.join(root, 'cloud', 'branch-contexts.js'), 'utf8');
  check(
    /developerSupport[\s\S]*?currentUser\?\.isDev[\s\S]*?__dev__/.test(branchContexts),
    'authenticated developer support keeps an explicit operational branch outside Owner read-only mode'
  );
}

async function testOAuthState() {
  const base = 46000 + Math.floor(Math.random() * 1000);
  const state = 'state_' + Date.now();
  const wrong = await oauthLoopback.startLoopbackServerFlexible(base, '/oauth/callback', { expectedState: state });
  const wrongPromise = assert.rejects(wrong.codePromise, /oauth_state_invalid/);
  check(await request(wrong.port, '/oauth/callback?code=forged&state=wrong') === 400, 'wrong OAuth state gets HTTP 400');
  await wrongPromise;

  const missing = await oauthLoopback.startLoopbackServerFlexible(base + 10, '/oauth/callback', { expectedState: state });
  const missingPromise = assert.rejects(missing.codePromise, /oauth_state_invalid/);
  check(await request(missing.port, '/oauth/callback?code=forged') === 400, 'missing OAuth state denied');
  await missingPromise;

  const good = await oauthLoopback.startLoopbackServerFlexible(base + 20, '/oauth/callback', { expectedState: state });
  check(await request(good.port, `/oauth/callback?code=valid-code&state=${encodeURIComponent(state)}`) === 200, 'correct OAuth state accepted');
  const result = await good.codePromise;
  check(result.code === 'valid-code' && result.state === state, 'OAuth code remains bound to expected state');
  try {
    const replayStatus = await request(good.port, `/oauth/callback?code=replay&state=${encodeURIComponent(state)}`);
    check(replayStatus !== 200, 'replayed OAuth callback denied');
  } catch {
    checks += 1;
  }
}

function fakeStorage(available) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`secure:${value}`),
    decryptString: (buffer) => Buffer.from(buffer).toString().replace(/^secure:/, ''),
  };
}

function testSensitiveStorage() {
  assert.throws(() => tokenStore.encryptPayload({ refresh_token: 'secret' }, fakeStorage(false)), /secure_storage_unavailable/);
  checks += 1;
  const wrapped = tokenStore.encryptPayload({ refresh_token: 'secret' }, fakeStorage(true));
  check(wrapped.alg === 'safeStorage' && !JSON.stringify(wrapped).includes('secret'), 'OAuth token envelope contains no plaintext');
  check(tokenStore.decryptPayload(wrapped, fakeStorage(true)).refresh_token === 'secret', 'safeStorage token round-trip');
  assert.throws(() => tokenStore.decryptPayload({ alg: 'aes-256-gcm', enc: 'legacy' }, fakeStorage(true)), /insecure_token_format_rejected/);
  checks += 1;

  assert.throws(() => credentialVault.requireSecureStorage(fakeStorage(false)), /secure_storage_unavailable/);
  checks += 1;
  const queueWrapped = queue.encryptQueue([{ phone: '966500000000', message: 'medical appointment' }], fakeStorage(true));
  check(!JSON.stringify(queueWrapped).includes('966500000000') && !JSON.stringify(queueWrapped).includes('medical appointment'), 'communication queue envelope contains no plaintext');
  check(queue.decryptQueue(queueWrapped, fakeStorage(true))[0].phone === '966500000000', 'encrypted queue round-trip');
  const redacted = queue.redactResult({ ok: true, accessToken: 'x', api_key: 'y' });
  check(redacted.accessToken === '[redacted]' && redacted.api_key === '[redacted]', 'queue provider results redact credentials');

  const rendererCommunication = fs.readFileSync(path.join(root, 'cupping-communication-gateway.js'), 'utf8');
  check(/delete safe\.apiKey/.test(rendererCommunication) && /delete safe\.secret/.test(rendererCommunication), 'communication payload strips provider secrets from settings/backups');
}

function testConstrainedActivationUploadAndProductionDeps() {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  check(/backup:uploadActivationArtifact/.test(main), 'constrained activation upload handler exists');
  check(/activation_remote_path_invalid/.test(main) && /License\\\/license/.test(main), 'activation upload validates fixed License/license.json path');
  check(/activation_artifact_must_be_object/.test(main) && /activation_center_id_invalid/.test(main), 'activation payload is structurally validated');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  check(pkg.dependencies.xlsx === 'file:vendor/xlsx-0.20.3.tgz', 'patched SheetJS release is vendored');
}

(async () => {
  await testRbacAndPasswords();
  testIpcCoverage();
  testXssCspPrintAndPermissions();
  await testOAuthState();
  testSensitiveStorage();
  testConstrainedActivationUploadAndProductionDeps();
  console.log(`P0-A security boundary: ${checks} checks passed`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
