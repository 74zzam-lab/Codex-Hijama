'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');

const MAX_QUEUE_ITEMS = 5000;
const PENDING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

let queue = [];
let queuePath = null;
let processing = false;
let onStatusCallback = null;
let persistenceMode = 'uninitialized';

function redactResult(result) {
  if (!result || typeof result !== 'object') return result;
  const clone = { ...result };
  for (const key of Object.keys(clone)) {
    if (/token|secret|api[-_]?key|authorization/i.test(key)) clone[key] = '[redacted]';
  }
  return clone;
}

function applyRetention(now = Date.now()) {
  queue = queue.filter((item) => {
    const timestamp = Date.parse(item.processedAt || item.createdAt || 0);
    if (!Number.isFinite(timestamp)) return false;
    const age = now - timestamp;
    return item.status === 'sent' ? age <= SENT_RETENTION_MS : age <= PENDING_RETENTION_MS;
  }).slice(-MAX_QUEUE_ITEMS);
}

function encryptQueue(items, storage = safeStorage) {
  if (!storage?.isEncryptionAvailable?.()) {
    const error = new Error('secure_storage_unavailable');
    error.code = 'secure_storage_unavailable';
    throw error;
  }
  return {
    v: 2,
    alg: 'safeStorage',
    enc: storage.encryptString(JSON.stringify(items)).toString('base64'),
  };
}

function decryptQueue(wrapped, storage = safeStorage) {
  if (!wrapped || wrapped.v !== 2 || wrapped.alg !== 'safeStorage') {
    const error = new Error('plaintext_queue_format');
    error.code = 'plaintext_queue_format';
    throw error;
  }
  if (!storage?.isEncryptionAvailable?.()) return null;
  return JSON.parse(storage.decryptString(Buffer.from(wrapped.enc, 'base64')));
}

function persistQueue() {
  if (!queuePath) return { ok: false, error: 'queue_not_initialized' };
  applyRetention();
  if (!safeStorage.isEncryptionAvailable()) {
    persistenceMode = 'memory-only';
    try { if (fs.existsSync(queuePath)) fs.unlinkSync(queuePath); } catch { /* never write plaintext */ }
    return { ok: false, error: 'secure_storage_unavailable', memoryOnly: true };
  }
  const temp = `${queuePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(encryptQueue(queue)), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, queuePath);
  persistenceMode = 'encrypted';
  return { ok: true, encrypted: true };
}

function initQueue() {
  queuePath = path.join(app.getPath('userData'), 'communication-queue.json');
  queue = [];
  if (!fs.existsSync(queuePath)) {
    persistenceMode = safeStorage.isEncryptionAvailable() ? 'encrypted' : 'memory-only';
    return { ok: true, persistenceMode };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    if (Array.isArray(parsed)) {
      // One-time legacy migration. The plaintext file is immediately replaced or removed.
      queue = parsed;
      if (safeStorage.isEncryptionAvailable()) persistQueue();
      else {
        fs.unlinkSync(queuePath);
        persistenceMode = 'memory-only';
      }
    } else {
      queue = decryptQueue(parsed) || [];
      persistenceMode = 'encrypted';
    }
    applyRetention();
    return { ok: true, persistenceMode, count: queue.length };
  } catch {
    queue = [];
    try { fs.unlinkSync(queuePath); } catch { /* corrupted/sensitive file stays unread */ }
    persistenceMode = safeStorage.isEncryptionAvailable() ? 'encrypted' : 'memory-only';
    return { ok: false, error: 'queue_recovery_required', persistenceMode };
  }
}

function enqueue(item) {
  const entry = {
    id: crypto.randomUUID(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    attempts: 0,
    ...item,
  };
  queue.push(entry);
  persistQueue();
  return entry;
}

function getQueueStatus() {
  applyRetention();
  const pending = queue.filter((q) => q.status === 'pending').length;
  const failed = queue.filter((q) => q.status === 'failed').length;
  const sent = queue.filter((q) => q.status === 'sent').length;
  return { pending, failed, sent, total: queue.length, processing, persistenceMode };
}

function getQueueItems(limit = 50) {
  applyRetention();
  return queue.slice(-Math.min(200, Math.max(1, Number(limit) || 50))).reverse();
}

function setStatusCallback(fn) {
  onStatusCallback = fn;
}

async function processQueue(sendFn, opts = {}) {
  if (processing) return { processed: 0, reason: 'busy' };
  processing = true;
  const batch = parseInt(opts.batchSize, 10) || 5;
  const delayMs = parseInt(opts.delayMs, 10) || 400;
  let processed = 0;
  try {
    const pending = queue.filter((q) => q.status === 'pending' || (q.status === 'failed' && q.attempts < 3));
    for (const item of pending.slice(0, batch)) {
      item.attempts = (item.attempts || 0) + 1;
      item.status = 'processing';
      persistQueue();
      try {
        const result = await sendFn(item);
        item.status = result?.ok === false ? 'failed' : 'sent';
        item.result = redactResult(result);
        item.processedAt = new Date().toISOString();
        if (result?.ok !== false) processed += 1;
        if (onStatusCallback) onStatusCallback({ type: 'queue_item', item, result: item.result });
      } catch (error) {
        item.status = 'failed';
        item.error = String(error?.message || 'send_failed').slice(0, 500);
      }
      persistQueue();
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  } finally {
    processing = false;
    persistQueue();
  }
  return { processed };
}

function clearQueue(status) {
  if (status) queue = queue.filter((q) => q.status !== status);
  else queue = [];
  persistQueue();
  return { ok: true };
}

function resetForTests() {
  queue = [];
  queuePath = null;
  processing = false;
  onStatusCallback = null;
  persistenceMode = 'uninitialized';
}

module.exports = {
  MAX_QUEUE_ITEMS,
  PENDING_RETENTION_MS,
  SENT_RETENTION_MS,
  initQueue,
  enqueue,
  getQueueStatus,
  getQueueItems,
  processQueue,
  clearQueue,
  setStatusCallback,
  encryptQueue,
  decryptQueue,
  applyRetention,
  redactResult,
  resetForTests,
};
