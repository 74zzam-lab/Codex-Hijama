/** Developer-only commercial licence artifact persistence. */
'use strict';

const fs = require('fs');
const path = require('path');
const { safeId, resolveInside } = require('./security/path-guard');

const ROOT = path.join(__dirname, '..');
const BUNDLED_ROOT = path.join(ROOT, 'license');
let writableRoot = null;

function roots() {
  const base = writableRoot || BUNDLED_ROOT;
  return {
    base,
    registry: path.join(base, 'data', 'license-registry'),
    activations: path.join(base, 'data', 'activations'),
    customPackages: path.join(base, 'data', 'custom-packages'),
    packageRegistry: path.join(base, 'registries', 'package-registry.json'),
    backup: path.join(base, 'data', 'backup')
  };
}

function bundled() {
  return {
    registry: path.join(BUNDLED_ROOT, 'data', 'license-registry'),
    activations: path.join(BUNDLED_ROOT, 'data', 'activations'),
    customPackages: path.join(BUNDLED_ROOT, 'data', 'custom-packages'),
    packageRegistry: path.join(BUNDLED_ROOT, 'registries', 'package-registry.json')
  };
}

function configureWritableRoot(directory) {
  const resolved = path.resolve(String(directory || ''));
  if (!path.isAbsolute(resolved) || resolved === path.parse(resolved).root) throw new Error('license_writable_root_invalid');
  writableRoot = resolved;
  fs.mkdirSync(writableRoot, { recursive: true });
  return writableRoot;
}

function requireWritableRoot() {
  if (!writableRoot) {
    const error = new Error('license_mutation_requires_offline_admin_tool');
    error.code = 'license_mutation_requires_offline_admin_tool';
    throw error;
  }
  return writableRoot;
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, filePath);
  return filePath;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readWithFallback(primary, fallback) {
  return readJson(primary) ?? readJson(fallback);
}

function validatePackageInheritance(packages) {
  const byId = Object.fromEntries((packages || []).map((pkg) => [pkg.id, pkg]));
  for (const pkg of packages || []) {
    if (!pkg.inherits) continue;
    const visited = new Set();
    let current = pkg.inherits;
    while (current) {
      if (visited.has(current) || current === pkg.id) throw new Error(`circular_inheritance:${pkg.id}->${current}`);
      visited.add(current);
      current = byId[current]?.inherits || null;
    }
  }
}

function writeLicenseShard(licenseId, record) {
  requireWritableRoot();
  const id = safeId(licenseId, 'licenseId');
  return writeJson(resolveInside(roots().registry, `${id}.json`), record);
}

function readLicenseShard(licenseId) {
  const id = safeId(licenseId, 'licenseId');
  return readWithFallback(
    resolveInside(roots().registry, `${id}.json`),
    resolveInside(bundled().registry, `${id}.json`)
  );
}

function writeActivationBundle(licenseId, bundle) {
  requireWritableRoot();
  const id = safeId(licenseId, 'licenseId');
  return writeJson(resolveInside(roots().activations, `${id}.bundle.json`), bundle);
}

function readActivationBundle(licenseId) {
  const id = safeId(licenseId, 'licenseId');
  return readWithFallback(
    resolveInside(roots().activations, `${id}.bundle.json`),
    resolveInside(bundled().activations, `${id}.bundle.json`)
  );
}

function writeCustomPackage(customPackage) {
  requireWritableRoot();
  const id = safeId(customPackage?.customPackageId, 'customPackageId');
  return writeJson(resolveInside(roots().customPackages, `${id}.json`), customPackage);
}

function readCustomPackage(customPackageId) {
  const id = safeId(customPackageId, 'customPackageId');
  return readWithFallback(
    resolveInside(roots().customPackages, `${id}.json`),
    resolveInside(bundled().customPackages, `${id}.json`)
  );
}

function updateLicenseIndex(index) {
  requireWritableRoot();
  return writeJson(resolveInside(roots().registry, 'index.json'), index);
}

function appendPackageToRegistry(pkgDef) {
  requireWritableRoot();
  if (!pkgDef || typeof pkgDef !== 'object' || Array.isArray(pkgDef)) throw new Error('package_definition_invalid');
  const current = readWithFallback(roots().packageRegistry, bundled().packageRegistry) || { schemaVersion: 1, packages: [] };
  const packages = Array.isArray(current.packages) ? current.packages.slice() : [];
  const id = safeId(pkgDef.id, 'packageId');
  const index = packages.findIndex((pkg) => pkg?.id === id);
  if (index >= 0) packages[index] = { ...packages[index], ...pkgDef, id };
  else packages.push({ ...pkgDef, id });
  validatePackageInheritance(packages);
  return writeJson(roots().packageRegistry, { ...current, packages, updatedAt: new Date().toISOString() });
}

function syncLicenseArtifacts(record, bundle) {
  requireWritableRoot();
  writeLicenseShard(record?.licenseId, record);
  if (bundle) writeActivationBundle(record?.licenseId, bundle);
  return { ok: true, licenseId: record?.licenseId, root: roots().base };
}

function createFilesystemBackup(label) {
  requireWritableRoot();
  const source = roots();
  const safeLabel = String(label || new Date().toISOString().slice(0, 10)).replace(/[^A-Za-z0-9_.-]/g, '_');
  const destination = resolveInside(source.backup, safeLabel);
  fs.mkdirSync(destination, { recursive: true });
  for (const [folder, name] of [[source.registry, 'license-registry'], [source.activations, 'activations'], [source.customPackages, 'custom-packages']]) {
    if (fs.existsSync(folder)) fs.cpSync(folder, path.join(destination, name), { recursive: true });
  }
  if (fs.existsSync(source.packageRegistry)) {
    fs.mkdirSync(path.join(destination, 'registries'), { recursive: true });
    fs.copyFileSync(source.packageRegistry, path.join(destination, 'registries', 'package-registry.json'));
  }
  return destination;
}

module.exports = {
  ROOT,
  configureWritableRoot,
  getWritableRoot: () => writableRoot,
  writeLicenseShard,
  readLicenseShard,
  writeActivationBundle,
  readActivationBundle,
  writeCustomPackage,
  readCustomPackage,
  updateLicenseIndex,
  appendPackageToRegistry,
  syncLicenseArtifacts,
  createFilesystemBackup,
  validatePackageInheritance
};
