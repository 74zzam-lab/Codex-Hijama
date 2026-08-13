#!/usr/bin/env node
/** Production commercial-licensing validation (verification-only customer runtime). */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let passed = 0;
let failed = 0;
const failures = [];
function check(condition, message) {
  if (condition) passed += 1;
  else { failed += 1; failures.push(message); }
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}

function registryHash(body) {
  return crypto.createHash('sha256').update('BUNDLED-REGISTRY-V2|' + canonicalJson(body)).digest('hex');
}

const registryFiles = [
  'feature-registry.json', 'capability-registry.json', 'package-registry.json',
  'subscription-registry.json', 'action-registry.json', 'template-registry.json',
];
for (const name of registryFiles) {
  const file = path.join(ROOT, 'license', 'registries', name);
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { registrySig, ...body } = document;
  check(typeof registrySig === 'string' && registrySig === registryHash(body), `${name}: bundled registry integrity invalid`);
}

const featureRegistry = JSON.parse(fs.readFileSync(path.join(ROOT, 'license/registries/feature-registry.json'), 'utf8'));
check(featureRegistry.features.length === 74, 'feature registry count must remain 74');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const registryMatch = html.match(/const FEATURE_REGISTRY\s*=\s*\[([\s\S]*?)\n\];/);
check(!!registryMatch, 'renderer feature registry exists');
if (registryMatch) {
  const rendererFeatures = new Function(`return [${registryMatch[1]}];`)();
  check(rendererFeatures.length === featureRegistry.features.length, 'renderer and bundled feature registry counts match');
  const keys = new Set(rendererFeatures.map((feature) => feature.id));
  check(featureRegistry.features.every((feature) => keys.has(feature.key)), 'renderer and bundled feature keys match');
}

const verifier = require(path.join(ROOT, 'electron/license-verifier.js'));
const productionFixture = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'tools/license-admin/fixtures/TDW-PROD-TEST-000001.v6.json'), 'utf8',
));
check((await verifier.verifyLicenseDoc(productionFixture)).ok === true, 'production Ed25519 fixture accepted');
check(productionFixture.keyId === verifier.PRODUCTION_KEY_ID, 'production immutable key id matches');

const licenseData = require(path.join(ROOT, 'electron/license-data.js'));
for (const mutation of [
  () => licenseData.writeLicenseShard('X', {}),
  () => licenseData.writeActivationBundle('X', {}),
  () => licenseData.writeCustomPackage({ customPackageId: 'X' }),
  () => licenseData.updateLicenseIndex({}),
  () => licenseData.appendPackageToRegistry({ id: 'X' }),
]) {
  let denied = false;
  try { mutation(); } catch (error) { denied = error?.code === 'license_mutation_requires_offline_admin_tool'; }
  check(denied, 'customer runtime license mutation denied');
}

const packagedFiles = ['index.html', 'license', 'electron', 'cloud'].flatMap((entry) => {
  const out = [];
  const walk = (target) => {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) fs.readdirSync(target).forEach((name) => walk(path.join(target, name)));
    else if (/\.(?:js|html|json|mjs)$/i.test(target)) out.push(target);
  };
  walk(path.join(ROOT, entry));
  return out;
});
const { assertV5SigningPolicy } = require(path.join(ROOT, 'license/core/v5-signing-policy.js'));
try {
  assertV5SigningPolicy(ROOT, packagedFiles);
  check(true, 'intentional V5 signing material confined to allowlisted paths');
} catch (error) {
  check(false, error.message || String(error));
}
for (const file of packagedFiles) {
  const src = fs.readFileSync(file, 'utf8');
  if (/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(src)) {
    check(false, `customer package excludes private keys (${path.relative(ROOT, file)})`);
  }
}

const coverage = {
  generatedAt: new Date().toISOString(),
  mode: 'production-verification-only',
  assertions: { passed, failed, skipped: 0 },
  failures,
};
const reportPath = path.join(ROOT, 'pat-reports', 'license-test-coverage.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(coverage, null, 2) + '\n', 'utf8');

console.log(`Commercial Licensing Production Suite: ${passed} passed, ${failed} failed`);
if (failed) {
  failures.forEach((message) => console.error('FAIL:', message));
  process.exit(1);
}
console.log('All production commercial licensing tests passed.');
