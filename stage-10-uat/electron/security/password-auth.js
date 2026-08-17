'use strict';

const crypto = require('crypto');

const LEGACY_PREFIX = 'tdw_pw_v1_';
const LEGACY_ITERS = 100000;
const V2_ITERS = 210000;
const V2_KEY_BYTES = 32;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const BASE_LOCK_MS = 30 * 1000;
const MAX_LOCK_MS = 15 * 60 * 1000;

// Product-owner approved support credentials. Keep their user-visible behavior unchanged.
// Only hashes are present; plaintext is never stored or logged.
const DEVELOPER_CREDENTIALS = Object.freeze([
  Object.freeze({
    username: 'dev_najjar',
    hash: 'pbkdf2:dev_najjar:d2af0519d0446beac934918b55ca58c32e2de1c07e53942f812f20eb437301bc',
  }),
  Object.freeze({
    username: 'dev_tadawi',
    hash: 'pbkdf2:dev_tadawi:589ac1161239d5f5ef3f1f737ad9b87ec1eae91bc6400c03c994d8c9358e7144',
  }),
]);

const attempts = new Map();
let attemptPersistence = null;
let persistenceLoaded = false;

function toHex(buffer) {
  return Buffer.from(buffer).toString('hex');
}

function timingSafeStringEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) {
    // Keep a comparison on the failure path to reduce obvious timing differences.
    crypto.timingSafeEqual(crypto.createHash('sha256').update(left).digest(), crypto.createHash('sha256').update(right).digest());
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function derive(password, salt, iterations) {
  return crypto.pbkdf2Sync(String(password || ''), salt, iterations, V2_KEY_BYTES, 'sha256');
}

function hashPasswordV2(password, options = {}) {
  const iterations = Math.max(V2_ITERS, Number(options.iterations) || V2_ITERS);
  const salt = options.salt ? Buffer.from(options.salt) : crypto.randomBytes(16);
  const digest = derive(password, salt, iterations);
  return `pbkdf2v2:${iterations}:${salt.toString('base64url')}:${digest.toString('base64url')}`;
}

function verifyV2(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2v2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 2000000) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[2], 'base64url');
    expected = Buffer.from(parts[3], 'base64url');
  } catch {
    return false;
  }
  if (salt.length < 16 || expected.length !== V2_KEY_BYTES) return false;
  const actual = derive(password, salt, iterations);
  return crypto.timingSafeEqual(actual, expected);
}

function verifyV1(password, stored, username) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;
  const storedUsername = parts[1];
  if (username && storedUsername !== String(username)) return false;
  const actual = toHex(derive(password, Buffer.from(LEGACY_PREFIX + storedUsername, 'utf8'), LEGACY_ITERS));
  return timingSafeStringEqual(actual, parts[2]);
}

function verifyStoredPassword(password, stored, username) {
  const value = String(stored || '');
  if (!value || typeof password !== 'string') return false;
  if (value.startsWith('pbkdf2v2:')) return verifyV2(password, value);
  if (value.startsWith('pbkdf2:')) return verifyV1(password, value, username);
  // Read-only compatibility for historical Base64 credentials. Successful login upgrades immediately.
  try {
    return timingSafeStringEqual(Buffer.from(String(password), 'utf8').toString('base64'), value);
  } catch {
    return false;
  }
}

function needsUpgrade(stored) {
  return !String(stored || '').startsWith('pbkdf2v2:');
}

function attemptKey(senderId, identity) {
  void senderId;
  return crypto.createHash('sha256').update(String(identity || '').trim().toLowerCase()).digest('hex');
}

function loadPersistentAttempts() {
  if (persistenceLoaded) return;
  persistenceLoaded = true;
  if (!attemptPersistence?.load) return;
  try {
    for (const entry of attemptPersistence.load() || []) {
      if (!entry?.key || !entry?.state) continue;
      attempts.set(String(entry.key), entry.state);
    }
  } catch { /* fail open only for availability; failures are still recorded in memory */ }
}

function persistAttempts() {
  if (!attemptPersistence?.save) return;
  try {
    attemptPersistence.save([...attempts.entries()].map(([key, state]) => ({ key, state })));
  } catch { /* memory throttle remains active */ }
}

function configureAttemptPersistence(persistence) {
  attemptPersistence = persistence || null;
  persistenceLoaded = false;
  loadPersistentAttempts();
}

function getAttemptState(senderId, identity, now = Date.now()) {
  loadPersistentAttempts();
  const key = attemptKey(senderId, identity);
  let state = attempts.get(key);
  if (state && now - state.windowStartedAt > FAILURE_WINDOW_MS) {
    attempts.delete(key);
    persistAttempts();
    state = null;
  }
  return { key, state };
}

function checkThrottle(senderId, identity, now = Date.now()) {
  const { state } = getAttemptState(senderId, identity, now);
  if (!state || !state.lockedUntil || state.lockedUntil <= now) return { ok: true };
  return { ok: false, error: 'auth_rate_limited', retryAfterMs: state.lockedUntil - now };
}

function recordFailure(senderId, identity, now = Date.now()) {
  const { key, state } = getAttemptState(senderId, identity, now);
  const next = state || { failures: 0, windowStartedAt: now, lockedUntil: 0 };
  next.failures += 1;
  if (next.failures >= MAX_FAILURES) {
    const exponent = Math.min(5, next.failures - MAX_FAILURES);
    next.lockedUntil = now + Math.min(MAX_LOCK_MS, BASE_LOCK_MS * (2 ** exponent));
  }
  attempts.set(key, next);
  persistAttempts();
  return { failures: next.failures, lockedUntil: next.lockedUntil };
}

function recordSuccess(senderId, identity) {
  attempts.delete(attemptKey(senderId, identity));
  persistAttempts();
}

function isSeedOnlyOwnerUser(user) {
  if (!user) return false;
  const role = String(user.role || '').toLowerCase();
  if (role !== 'owner' && role !== 'hq_admin') return false;
  return user.seedDefaultPassword === true
    || user.ownerSeedRetired === true
    || user.mustChangePassword === true;
}

function hasAuthoritativeOwner(users) {
  const list = Array.isArray(users) ? users : [];
  return list.some((user) => {
    if (!user || user.active === false) return false;
    const role = String(user.role || '').toLowerCase();
    if (role !== 'owner' && role !== 'hq_admin') return false;
    if (user.seedDefaultPassword === true || user.ownerSeedRetired === true || user.mustChangePassword === true) {
      return false;
    }
    return /^(?:pbkdf2:|pbkdf2v2:|b64:)/.test(String(user.password || ''));
  });
}

function authenticateDeveloper(password, senderId, now = Date.now()) {
  const identity = '__dev__';
  const gate = checkThrottle(senderId, identity, now);
  if (!gate.ok) return gate;
  const ok = DEVELOPER_CREDENTIALS.some((entry) => verifyStoredPassword(password, entry.hash, entry.username));
  if (!ok) {
    recordFailure(senderId, identity, now);
    return { ok: false, error: 'invalid_credentials' };
  }
  recordSuccess(senderId, identity);
  return { ok: true, userId: '__dev__', role: 'admin', isDev: true };
}

function authenticateUser(users, input, senderId, now = Date.now()) {
  const userId = String(input?.userId || '').trim();
  const role = String(input?.role || '').trim().toLowerCase();
  const identity = userId || String(input?.username || '').trim().toLowerCase() || 'unknown';
  const gate = checkThrottle(senderId, identity, now);
  if (!gate.ok) return gate;

  const list = Array.isArray(users) ? users : [];
  const user = list.find((item) => item && String(item.id) === userId && item.active !== false);
  if (user && hasAuthoritativeOwner(list) && isSeedOnlyOwnerUser(user)) {
    recordFailure(senderId, identity, now);
    return { ok: false, error: 'invalid_credentials' };
  }
  const valid = !!user
    && String(user.role || '').toLowerCase() === role
    && verifyStoredPassword(String(input?.password || ''), user.password, user.username);
  if (!valid) {
    recordFailure(senderId, identity, now);
    return { ok: false, error: 'invalid_credentials' };
  }

  recordSuccess(senderId, identity);
  return {
    ok: true,
    user,
    needsUpgrade: needsUpgrade(user.password),
    upgradedHash: needsUpgrade(user.password) ? hashPasswordV2(String(input.password || '')) : null,
  };
}

function resetForTests() {
  attempts.clear();
  attemptPersistence = null;
  persistenceLoaded = false;
}

module.exports = {
  LEGACY_ITERS,
  V2_ITERS,
  MAX_FAILURES,
  DEVELOPER_CREDENTIALS,
  hashPasswordV2,
  verifyStoredPassword,
  needsUpgrade,
  checkThrottle,
  recordFailure,
  recordSuccess,
  authenticateDeveloper,
  authenticateUser,
  configureAttemptPersistence,
  resetForTests,
};
