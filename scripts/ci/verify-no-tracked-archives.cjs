#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');

const patterns = [
  /^Tadawi-Stage-.*\.zip$/i,
  /^Hijama-Management-System-SOURCE-BUILD-.*\.zip$/i,
  /COMPLETE-ORIGINAL/i,
  /CURRENT-FINAL-.*\.zip$/i,
];

let tracked = [];
try {
  tracked = execSync('git ls-files', { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
} catch {
  console.error('git ls-files failed');
  process.exit(1);
}

const violations = tracked.filter((file) => patterns.some((re) => re.test(file.split('/').pop() || file)));
if (violations.length) {
  console.error('FAIL: tracked historical archives found in Git tree:');
  violations.forEach((v) => console.error(' -', v));
  process.exit(1);
}
console.log('PASS verify-no-tracked-archives (0 historical stage/build ZIPs tracked)');
