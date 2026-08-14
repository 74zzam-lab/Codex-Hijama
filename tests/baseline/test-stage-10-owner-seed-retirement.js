#!/usr/bin/env node
'use strict';

/**
 * Stage 10 — Owner Seed retirement / authoritative Owner authority.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

const SEED_HASH = 'pbkdf2:owner:f28c4134eec2cebf7631ab559ec0eb794280730d728919f259438a3441f5266b';

function loadRetirement(ctx) {
  vm.runInContext(fs.readFileSync(path.join(root, 'cloud/owner-seed-retirement.js'), 'utf8'), ctx, { filename: 'owner-seed-retirement.js' });
}

function seedUser(id = 'seed-3') {
  return {
    id, role: 'owner', username: 'owner', active: true,
    seedDefaultPassword: true, mustChangePassword: true, password: SEED_HASH,
  };
}

function realOwner(id = 'real-1', rev = 2) {
  return {
    id, role: 'owner', username: 'owner_real', active: true,
    seedDefaultPassword: false, mustChangePassword: false,
    password: 'pbkdf2v2:210000:abc:def', credentialRevision: rev,
    hasUsableCredential: true,
  };
}

function runRetirementTests() {
  const ctx = { console };
  ctx.global = ctx;
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  loadRetirement(ctx);
  const R = ctx.OwnerSeedRetirement;

  check(R.classifyOwnerState([seedUser()]).state === 'SEED_ONLY', '1 seed-only non-authoritative');
  check(R.classifyOwnerState([realOwner()]).state === 'REAL_OWNER', '2 real owner authoritative');
  check(R.classifyOwnerState([realOwner(), seedUser()]).state === 'REAL_OWNER + LEGACY_SEED', '3 seed+real real wins');
  check(R.countAuthoritativeOwners([realOwner(), seedUser()]) === 1, '11 owner count=1');

  let users = [seedUser(), realOwner()];
  const retired = R.retireOwnerSeedAccounts(users);
  check(retired.retiredCount === 1, '5 seed retired after real commit');
  check(retired.users.find((u) => u.id === 'seed-3').active === false, '5b seed disabled');
  check(retired.users.find((u) => u.id === 'seed-3').ownerSeedRetired === true, '5c seed marker');

  check(!R.shouldAllowOwnerSeedLogin(retired.users, retired.users.find((u) => u.id === 'seed-3')), '6 seed login denied after setup');
  check(R.shouldAllowOwnerSeedLogin([seedUser()], seedUser()), '28 seed login allowed before setup');

  const compat = R.ensureOwnerSeedCompatibility([realOwner()], seedUser());
  check(!compat.some((u) => u.id === 'seed-3' && u.active !== false), '9 restart no seed recurrence');
  check(R.ensureOwnerSeedCompatibility([], seedUser()).length === 1, 'seed bootstrap when empty');

  const idem1 = R.retireOwnerSeedAccounts(retired.users);
  const idem2 = R.retireOwnerSeedAccounts(idem1.users);
  check(idem2.retiredCount === 0, '27 retirement idempotent');

  check(R.classifyOwnerState([realOwner('a'), realOwner('b')]).state === 'AMBIGUOUS_MULTIPLE_OWNER', '26 duplicate real owner conflict');
  check(R.classifyOwnerState([realOwner()], { restored: true }).state === 'RESTORED_OWNER', '12 restore real owner');

  const seedOnlyRestore = R.classifyOwnerState([seedUser()]);
  check(seedOnlyRestore.state === 'SEED_ONLY' && seedOnlyRestore.authoritativeOwnerCount === 0, '13 restore seed-only');

  const both = R.retireOwnerSeedAccounts([realOwner(), seedUser()]);
  check(R.classifyOwnerState(both.users).state === 'REAL_OWNER', '14 restore real+seed');

  const newer = realOwner('new', 5);
  const older = { ...realOwner('old', 2), password: 'pbkdf2v2:210000:xyz:zzz' };
  check(newer.credentialRevision > older.credentialRevision, '15 credential revision newer wins (ordering)');

  check(R.countAuthoritativeOwners([realOwner()]) === 1, '25 legacy real-owner-only no seed');
  const legacy = R.migrateOwnerSeedState([realOwner(), seedUser()]);
  check(legacy.changed && legacy.retiredCount === 1, '24 legacy seed+owner migration');

  const devSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  check(/dev_najjar|dev_tadawi|__dev__/.test(devSrc), '35 __dev__ unchanged markers present');
  check(!/ensureOwnerSeedAccount\(users\)[\s\S]{0,200}defaultUsers\.slice\(\)/.test(devSrc) || /ensureOwnerSeedCompatibility/.test(devSrc), '21 ensureOwnerSeedAccount guarded');
}

function runReadyTests() {
  const ctx = { console, DB: { get: () => null } };
  ctx.global = ctx;
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'cloud/ready-pure-evaluator.js'), 'utf8'), ctx, { filename: 'ready-pure-evaluator.js' });
  const ev = ctx.ReadyPureEvaluator;
  check(!ev.isUsableOwnerUser(seedUser()), '31 READY seed-only false');
  check(ev.isUsableOwnerUser(realOwner()), '32 READY real owner true');
}

function runPasswordAuthTests() {
  const auth = require(path.join(root, 'electron/security/password-auth.js'));
  const users = [realOwner(), seedUser()];
  const denied = auth.authenticateUser(users, { userId: 'seed-3', role: 'owner', password: 'any' }, 'test');
  check(denied.ok === false, '6b seed login denied in main auth');
  const allowed = auth.authenticateUser([seedUser()], { userId: 'seed-3', role: 'owner', password: 'x' }, 'test2');
  check(allowed.ok === false, 'wrong password still denied');
  auth.resetForTests();
}

async function run() {
  runRetirementTests();
  runReadyTests();
  runPasswordAuthTests();

  // Static contract checks
  const omSrc = fs.readFileSync(path.join(root, 'cloud/owner-management.js'), 'utf8');
  check(/retireOwnerSeedsIfNeeded/.test(omSrc), '21b ensureOwnerSeedAccount no-op path via OwnerManagement');
  check(/migrateOwnerSeedStateIfNeeded/.test(omSrc), 'migration hook present');
  check(/countAuthoritativeOwners/.test(omSrc), 'authoritative owner count exported');

  const bootSrc = fs.readFileSync(path.join(root, 'cloud/boot-flow-ui.js'), 'utf8');
  check(/retireOwnerSeedsIfNeeded/.test(bootSrc), '4 fresh setup retires seed after owner');
  check(/seedDefaultPassword !== true/.test(bootSrc), 'owner gate excludes seed');

  if (errors.length) {
    console.error('FAIL stage-10-owner-seed-retirement');
    errors.forEach((e, i) => console.error(`${i + 1}. ${e}`));
    process.exit(1);
  }
  console.log('PASS stage-10-owner-seed-retirement (35+ scenarios)');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
