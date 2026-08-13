#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const errors = [];
const ignoreDirs = new Set(['node_modules', 'dist', '.git', 'docs', 'review-work', '01-ORIGINAL', '02-CURRENT', '03-REPORTS', 'pat-reports']);
const ignoreFiles = new Set([
  'cloud-oauth.config.example.json',
  'cloud-oauth.config.local.example.json',
  'cloud-oauth.embedded.json',
  'cloud-oauth.config.json',
]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (ignoreDirs.has(name)) continue;
      walk(full, out);
      continue;
    }
    if (!/\.(?:js|mjs|cjs|json|html|md)$/i.test(name)) continue;
    if (ignoreFiles.has(name)) continue;
    out.push(full);
  }
  return out;
}

for (const file of walk(root)) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const src = fs.readFileSync(file, 'utf8');
  if (/GOCSPX-[A-Za-z0-9_-]{10,}/.test(src)) {
    errors.push(`committed OAuth secret pattern in ${rel}`);
  }
  if (/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(src)) {
    errors.push(`private key material in ${rel}`);
  }
}

if (errors.length) {
  console.error('FAIL source secret scan:');
  for (const err of errors) console.error(' -', err);
  process.exit(1);
}

console.log('OK: source secret scan — no committed OAuth secrets or private keys');
