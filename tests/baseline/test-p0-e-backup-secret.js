#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tdw-p0e-backup-secret-'));
const original = Module._load;
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`protected:${value}`, 'utf8'),
  decryptString: (buffer) => buffer.toString('utf8').replace(/^protected:/, ''),
};
Module._load = function patched(request, parent, isMain) {
  if (request === 'electron') return { dialog: {}, safeStorage };
  return original.call(this, request, parent, isMain);
};
let ipc;
try { ipc = require('../../electron/backup-v2-ipc'); } finally { Module._load = original; }

const first = ipc.generateBackupMasterSecret();
const second = ipc.generateBackupMasterSecret();
assert.notEqual(first, second);
assert.ok(Buffer.from(first, 'base64url').length === 32);
assert.ok(Buffer.from(second, 'base64url').length === 32);

const vault = ipc.createFileCredentialVault(temp);
vault.set(ipc.MASTER_SECRET_CREDENTIAL, first);
assert.equal(vault.get(ipc.MASTER_SECRET_CREDENTIAL), first);
const vaultText = fs.readFileSync(path.join(temp, 'settings', 'backup-v2-credentials.json'), 'utf8');
assert.equal(vaultText.includes(first), false, 'secret must not be stored as plaintext');
assert.match(vaultText, /electron-safeStorage/);

const indexSource = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
assert.doesNotMatch(indexSource, /tdw-v2-.*center.*-auto/i);
assert.match(indexSource, /v2EnsureSecret/);
const preload = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'preload.js'), 'utf8');
const policy = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'rbac-session.js'), 'utf8');
assert.match(preload, /backup:v2:ensureSecret/);
assert.match(preload, /backup:v2:rotateSecret/);
assert.match(policy, /'backup:v2:ensureSecret': \{ minRank: 4 \}/);
assert.match(policy, /'backup:v2:rotateSecret': \{ minRank: 6, roles: \['owner'\] \}/);

// New Backup V2 material cannot be decrypted with the old predictable center-derived value.
const backupCrypto = require('../../electron/backup-crypto-v2');
const encrypted = backupCrypto.encryptBuffer(Buffer.from('financial-data'), first);
assert.equal(backupCrypto.decryptBuffer(encrypted, first).toString('utf8'), 'financial-data');
assert.throws(() => backupCrypto.decryptBuffer(encrypted, 'tdw-v2-CTR-FIN-auto'));

fs.rmSync(temp, { recursive: true, force: true });
console.log('P0-E secure backup secret PASS: entropy, protected storage, rotation policy, wrong-secret rejection');
