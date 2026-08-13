#!/usr/bin/env node
/**
 * Verify Google OAuth config structure (no live OAuth).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const example = path.join(root, 'electron', 'cloud-oauth.config.example.json');
const errors = [];

try {
  const ex = JSON.parse(fs.readFileSync(example, 'utf8'));
  const g = ex.google || {};
  if (!g.clientId || !g.clientId.includes('googleusercontent.com')) errors.push('missing clientId in example');
  if (!g.scopes?.includes('https://www.googleapis.com/auth/drive.file')) errors.push('drive.file scope missing');
  if (g.scopes?.includes('https://www.googleapis.com/auth/drive')) errors.push('full drive scope must not be used');
  if (String(g.clientSecret).includes('393099979986')) errors.push('clientSecret must not be committed');
} catch (e) {
  errors.push(e.message);
}

const drivePaths = require('../electron/cloud-drive-paths');
if (drivePaths.DRIVE_APP_FOLDER !== 'NajjarTech Hijama Management') errors.push('bad folder name');
if (drivePaths.MAIN_BACKUP_FILE !== 'Hijama-Clinic-Backup.tdw') errors.push('bad main file');

const defaultsPath = path.join(root, 'electron', 'cloud-oauth.defaults.json');
try {
  const def = JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));
  if (!def.google?.projectId) errors.push('defaults missing projectId');
} catch (e) { errors.push('defaults: ' + e.message); }

const embeddedPath = path.join(root, 'electron', 'cloud-oauth.embedded.json');
try {
  const emb = JSON.parse(fs.readFileSync(embeddedPath, 'utf8'));
  const g = emb.google || {};
  if (!g.clientId || !g.clientId.includes('googleusercontent.com')) errors.push('embedded missing clientId');
  const secret = String(g.clientSecret || '');
  if (!secret) errors.push('embedded missing clientSecret placeholder');
  if (secret.startsWith('GOCSPX-')) errors.push('embedded must not contain committed OAuth client secret');
  if (!secret.includes('YOUR_') && !secret.includes('PASTE_YOUR')) {
    errors.push('embedded clientSecret must remain a build-time placeholder in source');
  }
} catch (e) {
  errors.push('embedded oauth file required: ' + e.message);
}

const configPath = path.join(root, 'electron', 'cloud-oauth.config.json');
if (fs.existsSync(configPath)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const secret = String(cfg.google?.clientSecret || '');
    if (secret.startsWith('GOCSPX-')) errors.push('cloud-oauth.config.json must not ship a real client secret');
  } catch (e) {
    errors.push('cloud-oauth.config.json invalid: ' + e.message);
  }
}

for (const f of ['clinic-snapshot.js', 'backup-crypto.js']) {
  if (!fs.existsSync(path.join(root, 'electron', f))) errors.push('missing electron/' + f);
}

if (errors.length) {
  console.error('FAIL:', errors.join('; '));
  process.exit(1);
}
console.log('OK: Google OAuth config structure verified');
console.log('  clientId in example:', JSON.parse(fs.readFileSync(example, 'utf8')).google.clientId.slice(0, 20) + '...');
console.log('  drive folder:', drivePaths.DRIVE_APP_FOLDER);
