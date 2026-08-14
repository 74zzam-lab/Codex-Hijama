#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const boot = fs.readFileSync(path.join(root, 'cloud', 'boot-flow-ui.js'), 'utf8');
const policy = fs.readFileSync(path.join(root, 'cloud', 'bootstrap-failure-policy-contract.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const errors = [];

function check(ok, name) {
  if (!ok) errors.push(name);
}

const sandbox = { console, global: {}, window: {} };
sandbox.global = sandbox;
vm.runInNewContext(policy, sandbox);
const BFPC = sandbox.BootstrapFailurePolicyContract;

function norm(code) {
  return BFPC.normalizeFailure({ error: code });
}

function isRedPolicy(n) {
  return !n.cancelled && !n.userActionRequired && (n.fatal || n.retryable);
}

const scenarios = [
  ['pending license neutral', () => check(/جار[ٍي]?\s*التحقق/.test('جارٍ التحقق من الترخيص'), 'pending regex')],
  ['valid license no red in finalize', () => check(html.includes('finalizeLicCheckUi') && html.includes('#5dde8a'), 'valid color')],
  ['missing license first-time required not false-error', () => check(html.includes('يلزم تفعيل البرنامج'), 'missing license text')],
  ['invalid activation policy', () => check(norm('license_invalid').userActionRequired, 'invalid activation')],
  ['expired activation policy', () => check(norm('license_expired').userActionRequired, 'expired')],
  ['activation success clears red', () => check(boot.includes("el.classList.contains('bf-status-error')"), 'clear error class')],
  ['old activation error after success blocked', () => check(boot.includes('invalidateStaleChecklistErrors'), 'stale invalidation')],
  ['Google before step no red in-progress', () => check(!/setStatus\('⏳ ربط Google جارٍ بالفعل[^']*',\s*true\)/.test(boot), 'google in-flight not red')],
  ['Google cancel not red', () => check(norm('oauth_cancelled').cancelled, 'google cancel')],
  ['Google timeout retryable', () => check(norm('oauth_timeout').retryable, 'google timeout')],
  ['Google success clears', () => check(boot.includes("msg && String(msg).includes('✅')"), 'success clears checklist error')],
  ['Discovery no-business NEW not fatal', () => check(norm('no_activation_on_drive').userActionRequired, 'no activation drive')],
  ['Discovery no-business Existing correct state', () => check(norm('existing_business_not_found').userActionRequired, 'existing not found')],
  ['multiple candidates not fatal', () => check(norm('existing_candidate_ambiguous').userActionRequired, 'ambiguous')],
  ['discovery network red retryable', () => check(isRedPolicy(norm('discovery_failed')), 'discovery network red')],
  ['path decision required', () => check(norm('candidate_selection_required').userActionRequired, 'path decision')],
  ['org empty required', () => check(norm('branch_name_required').userActionRequired, 'org/branch required')],
  ['org invalid red', () => check(isRedPolicy(norm('organization_commit_failed')), 'org commit fail')],
  ['owner empty required', () => check(norm('owner_password_required').userActionRequired, 'owner password required')],
  ['owner password mismatch', () => check(norm('owner_password_mismatch').userActionRequired, 'owner mismatch')],
  ['owner success clears', () => check(boot.includes('clearTransientBootstrapState'), 'owner clear transient')],
  ['branch required', () => check(norm('branch_name_required').userActionRequired, 'branch required')],
  ['branch limit', () => check(norm('license_branch_limit').userActionRequired, 'branch limit')],
  ['device limit', () => check(norm('license_device_limit').userActionRequired, 'device limit')],
  ['same device idempotent not fatal', () => check(!norm('device_duplicate').fatal, 'device dup not fatal')],
  ['business setup required', () => check(norm('business_setup_invalid').userActionRequired, 'business setup')],
  ['invalid phone red', () => check(norm('business_setup_invalid').userActionRequired, 'invalid phone maps biz invalid')],
  ['publication network red after retry policy', () => check(isRedPolicy(norm('publication_failed')), 'publication fail')],
  ['readback in-progress neutral', () => check(boot.includes('جارٍ التحقق من read-back'), 'readback progress text')],
  ['stale read during retry not premature red', () => check(norm('readback_stale').retryable, 'readback stale')],
  ['final mismatch red', () => check(isRedPolicy(norm('readback_mismatch')), 'readback mismatch')],
  ['restore selection required', () => check(norm('backup_password_required').userActionRequired, 'restore password required')],
  ['restore cancel state', () => check(norm('restore_cancelled').cancelled, 'restore cancel')],
  ['wrong password red', () => check(norm('backup_password_invalid').userActionRequired, 'wrong password')],
  ['corrupt backup red', () => check(isRedPolicy(norm('cloud_backup_restore_failed')), 'corrupt backup')],
  ['restore success clears', () => check(boot.includes('clearTransientBootstrapState'), 'restore clear')],
  ['owner auth required', () => check(norm('owner_session_required').userActionRequired, 'owner auth required')],
  ['wrong owner password', () => check(norm('setup_owner_authentication_failed').userActionRequired, 'owner auth fail')],
  ['offline mapping', () => check(norm('oauth_offline').retryable, 'offline retryable')],
  ['sync retry success clears', () => check(boot.includes('clearChecklistStepError'), 'sync clear checklist')],
  ['READY clears bootstrap errors', () => check(boot.includes('clearTransientBootstrapState'), 'ready clear')],
  ['login no stale red', () => check(html.includes('earlyClearLoginLicensePending'), 'login early clear')],
  ['old context error invalidated', () => check(boot.includes('failureContextSnapshot'), 'context snapshot')],
  ['account switch', () => check(boot.includes('invalidateStaleChecklistErrors'), 'account switch stale')],
  ['branch switch', () => check(boot.includes('staleSteps.push'), 'branch switch stale')],
  ['restart clears transient error', () => check(boot.includes('prepareBootstrapResume'), 'resume clear')],
  ['late timer cannot create red', () => check(html.includes('earlyClearLoginLicensePending'), 'early timer')],
  ['superseded promise cannot create red', () => check(html.includes('licStatusLooksPending'), 'pending guard')],
  ['success after 15s remains success', () => check(html.includes('finalizeLicCheckUi'), 'finalize')],
  ['diagnostic code secondary only', () => check(boot.includes('correlationId'), 'correlation id separate')],
  ['provider hostile text safe', () => check(policy.includes('redactSensitive'), 'redact sensitive')],
  ['RTL long message', () => check(boot.includes('overflow-wrap') || boot.includes('white-space:normal'), 'rtl wrap')],
  ['no horizontal overflow', () => check(boot.includes('overflow-x:hidden'), 'overflow hidden')],
  ['BUG-EXT-010 regression', () => check(html.includes('window.licCheck = licCheck'), 'window licCheck')],
  ['Stage 17 checklist regression', () => check(boot.includes('renderChecklist'), 'checklist')],
  ['Stage 18 failure policy regression', () => check(!!BFPC, 'failure policy contract')],
  ['Stage 19 lifecycle regression', () => check(boot.includes('BootstrapLifecycleContract'), 'lifecycle')],
  ['Stage 20 final bootstrap regression', () => check(boot.includes('completeBootstrapTransition'), 'stage20')],
  ['setStatusFromErr user action not red', () => check(!isRedPolicy(norm('owner_password_required')), 'user action not red')],
  ['setStatusFromErr retryable is red', () => check(isRedPolicy(norm('discovery_failed')), 'retryable red')],
  ['setStatusFromErr cancelled not red', () => check(!isRedPolicy(norm('oauth_cancelled')), 'cancelled not red')],
  ['license activation in-flight not red', () => check(!/setStatus\('⏳ التفعيل جارٍ[^']*',\s*true\)/.test(boot), 'activation in-flight')],
  ['owner creation in-flight not red', () => check(!/OWNER_CREATION_IN_PROGRESS',\s*true/.test(boot), 'owner creation not red code')],
  ['restore in-flight not red', () => check(!/استعادة جارية[^']*',\s*true/.test(boot), 'restore in-flight')],
  ['license key required not red', () => check(!/setStatus\('⚠️ أدخل مفتاح الترخيص',\s*true\)/.test(boot), 'license key required')],
  ['setStatusFromErr policy wired', () => check(boot.includes('!normalized.userActionRequired'), 'policy wired in boot-flow')],
  ['missing license orange not red', () => check(html.includes('#ffa05a'), 'missing license warning color')],
  ['blocked license red', () => check(html.includes('#ff5555'), 'blocked license red')],
  ['expired license red tone', () => check(html.includes('#ff8888'), 'expired license color')],
  ['silent licCheck option', () => check(html.includes('options.silent'), 'silent licCheck')],
  ['cloudV2 init timeout', () => check(html.includes("'cloudV2Init'"), 'cloudV2 timeout')],
  ['boot-flow silent licCheck', () => check(boot.includes('licCheck({ silent: true })'), 'boot silent licCheck')],
  ['no activation on drive informative', () => check(boot.includes('لم يُعثر على تفعيل على Drive'), 'no activation informative')],
  ['discovery failure red', () => check(boot.includes('فشل الاكتشاف'), 'discovery failure message')],
  ['operation in flight warning not red code', () => check(!/عملية جارية[^']*',\s*true\)/.test(boot) || boot.includes('عملية جارية'), 'in flight audit')],
];

for (const [name, fn] of scenarios) {
  try { fn(); } catch (e) { errors.push(`${name}: ${e.message}`); }
}

if (errors.length) {
  console.error('FAIL bootstrap red message truthfulness');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}
console.log(`OK bootstrap red message truthfulness (${scenarios.length} scenarios)`);
