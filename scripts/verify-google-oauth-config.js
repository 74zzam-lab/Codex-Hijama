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
  if (!g.clientSecret || String(g.clientSecret).includes('YOUR_') || String(g.clientSecret).includes('PASTE_YOUR')) {
    errors.push('embedded missing real clientSecret');
  }
} catch (e) {
  errors.push('embedded oauth file required: ' + e.message);
}

const vaultDefaultsPath = path.join(root, 'license', 'license-vault.defaults.json');
try {
  const vault = JSON.parse(fs.readFileSync(vaultDefaultsPath, 'utf8'));
  if (!String(vault.webAppUrl || '').includes('script.google.com/macros/s/')) {
    errors.push('license vault sheets URL missing');
  }
} catch (e) {
  errors.push('license-vault.defaults.json: ' + e.message);
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
console.log('  sheets vault:', JSON.parse(fs.readFileSync(vaultDefaultsPath, 'utf8')).deploymentId.slice(0, 16) + '...');
