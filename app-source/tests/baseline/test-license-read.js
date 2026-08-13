#!/usr/bin/env node
'use strict';

/**
 * Baseline: read shipped license registries and V5 codec (clean archive — no license/data fixtures).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const errors = [];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const packageRegistryPath = path.join(root, 'license', 'registries', 'package-registry.json');
const featureRegistryPath = path.join(root, 'license', 'registries', 'feature-registry.json');
const constantsPath = path.join(root, 'license', 'core', 'license-constants.js');
const codecPath = path.join(root, 'license', 'core', 'license-codec-v5.js');
const cryptoPath = path.join(root, 'license', 'core', 'license-crypto.js');
const generatorPath = path.join(root, 'license', 'engine', 'license-generator-v2.js');

for (const p of [packageRegistryPath, featureRegistryPath, constantsPath, codecPath, cryptoPath, generatorPath]) {
  if (!fs.existsSync(p)) errors.push('missing:' + path.relative(root, p));
}

if (!errors.length) {
  const packages = readJson(packageRegistryPath);
  if (!packages || typeof packages !== 'object') errors.push('package_registry_invalid');
  if (!Array.isArray(packages.packages) || !packages.packages.length) {
    errors.push('package_registry_empty');
  }

  const features = readJson(featureRegistryPath);
  if (!features || typeof features !== 'object') errors.push('feature_registry_invalid');
  if (!Array.isArray(features.features) || features.features.length < 10) {
    errors.push('feature_registry_too_small:' + (features.features?.length || 0));
  }

  const constantsSrc = fs.readFileSync(constantsPath, 'utf8');
  if (!constantsSrc.includes('V5_MAGIC') || !constantsSrc.includes('TDWI2')) {
    errors.push('constants_missing_v5_magic');
  }
  if (!constantsSrc.includes('commercial_license_data_v2')) {
    errors.push('constants_missing_storage_key');
  }

  const codecSrc = fs.readFileSync(codecPath, 'utf8');
  if (!codecSrc.includes('encodeV5Key') || !codecSrc.includes('decodeV5Key')) {
    errors.push('codec_missing_v5_api');
  }

  const cryptoSrc = fs.readFileSync(cryptoPath, 'utf8');
  if (!cryptoSrc.includes('LIC_SECRETS') || !cryptoSrc.includes('TADAWI_OFFLINE_LIC_V4')) {
    errors.push('v5_signing_material_missing_intentional');
  }

  const generatorSrc = fs.readFileSync(generatorPath, 'utf8');
  if (!generatorSrc.includes('encodeV5Key') || !generatorSrc.includes('persistCenterId')) {
    errors.push('v5_generator_api_missing');
  }
}

if (errors.length) {
  console.error('FAIL: baseline license read');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}

console.log('OK: baseline license registries + intentional V5 codec readable');
console.log('  packages:', path.relative(root, packageRegistryPath));
console.log('  features:', path.relative(root, featureRegistryPath));
