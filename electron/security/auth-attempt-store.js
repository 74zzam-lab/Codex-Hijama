'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function filePath() {
  const dir = path.join(app.getPath('userData'), 'SecurityVault');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'authentication-throttle.json');
}

function load() {
  const file = filePath();
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data?.attempts) ? data.attempts : [];
  } catch { return []; }
}

function save(entries) {
  const file = filePath();
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ v: 1, attempts: entries }), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
}

module.exports = { filePath, load, save };
