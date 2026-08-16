# Independent Review — Bootstrap / Setup Wizard (2026-08-16)

**Scope:** Current source only (`/workspace/cloud`, `/workspace/electron`, `/workspace/index.html`, `/workspace/cupping-*.js`), not the `stage-1-uat` … `stage-10-uat` archive directories at repo root. Those directories are confirmed **not imported by any live code path** (`electron/`, `cloud/`, `package.json`, `tests/` — no `require`/`import` references them); they are dead evidence snapshots and are excluded from every finding below unless explicitly noted.

**Method:** No prior "PASS"/"FIXED" claim in `BUG-REGISTER.md`, `WINDOWS-INSTALLED-EVIDENCE.md`, `docs/remediation/**`, or any test file was trusted at face value. Every finding below was verified by reading the actual current function bodies and tracing the real call chain from UI/IPC entry point to effect. One finding (the cloud-restore pre-first-byte hang, Issues 9/10/14) was additionally verified by a live, executable reproduction against the real `registry.js`/`byte-progress-watchdog.js` modules (script not committed). The full test suite was also run to completion after fixing a missing native dependency (`better-sqlite3`) in this sandbox: **157/157 tests pass**, confirming that "tests are green" is an accurate, and separately concerning, starting condition (see Issue 29).

No Windows-installed EXE was available in this environment (Linux sandbox, no Wine/Windows VM — consistent with `WINDOWS-INSTALLED-EVIDENCE.md`). Every item below is therefore a **source-verified** finding; installed-runtime confirmation remains a separate, explicit acceptance step per issue.

Six focused deep-dive investigations were run in parallel to cover the full 30-item list, in addition to direct verification of the highest-priority items. Their raw output is preserved in full in this repository's conversation history; this document is the synthesized, de-duplicated, cross-checked deliverable.

---

## 1. Executive summary

The Bootstrap wizard is now materially better than the pattern described in the request ("many staged patches, tests pass, EXE still breaks"), but the request's central thesis is confirmed: **the test suite is genuinely green, and there are still real, source-verified defects that no test in the suite can detect**, because a large fraction of "bootstrap" tests either (a) regex-match raw file text instead of executing it, (b) call an internal pure function with a hand-built state object that bypasses the real DOM/IPC/Main path, or (c) mock the network layer to resolve instantly, which structurally cannot reproduce a hang.

The single highest-confidence, highest-impact finding is the **cloud-restore pre-first-byte hang** (Issues 9/10/14): the watchdog/abort infrastructure that was built to bound every restore await is **not wired into `resolveActiveProviderKey()`**, one specific pre-download call that resolves which cloud account/token to use. This function calls `googleDrive.getStatus()` → `driveApi.getUserEmail()` → `getAuthedClient()`/`fetch()` with **zero timeout and zero `AbortSignal` wiring**, even though the sibling function that runs immediately afterward (`downloadBackup()`) correctly uses the exact same `raceAbort()` pattern. This was reproduced live: with a stalled `getStatus()`, the watchdog's abort signal fires on schedule but the outer restore call keeps hanging indefinitely — exactly matching the reported 63s/94s/124s zero-progress hangs. The test that claims to cover this (`test-final-runtime-rbac-restore-stall.js`, "BUG-2 downloadFileWithProgress and setupCloudRestore wire AbortSignal") only checks that certain strings appear in two files that do **not** include the vulnerable one (`registry.js`).

Several other systemic patterns recur across the 30 issues and are worth naming once, up front, rather than per-issue:

- **Duplicated source-of-truth arrays that are currently in sync only by discipline, not enforcement** — the step-order sequence is hand-duplicated in `bootstrap-step-model.js`, `bootstrap-coordinator.js`, `boot-flow-ui.js`, and `bootstrap-checklist-contract.js`. `bootstrap-step-model.js`'s own header comment says it was written specifically to end this pattern ("before this module the order lived in four places"), but the other three copies were never actually replaced with references to it.
- **A resolver split between the header and the body/checklist.** The header (`renderProgress`/`describeCurrentStep`) resolves the current step through `BootstrapStepModel.describeStep()`, which correctly re-maps a stored index that points at a no-longer-applicable step (e.g. a resolved fork). The body (`renderStepUI`) and the checklist (`getChecklistUiContext`) still index the raw array directly (`steps[w.currentStep]`) without that re-mapping — the exact mechanism that produces "header says step 4, body shows a different step."
- **A guard mechanism that exists, is unit-tested as an API, and is never actually called in production.** `renderGeneration`/`isRenderCurrent()` was built to stop a stale async result from overwriting the DOM after the user has navigated away, and it is exported and tested — but no production async callback (Google, Discovery, Restore progress) actually calls `isRenderCurrent()` before touching the DOM.
- **A policy layer that is correct, next to call sites that bypass it.** `setStatusFromErr()`/`bootstrap-failure-policy-contract.js` correctly encode "red only for RETRYABLE/FATAL, not for REQUIRED/USER_ACTION" — but roughly 35 call sites in `boot-flow-ui.js` call the raw `setStatus(msg, true)` directly for ordinary "please complete this field first" hints, painting them red anyway.
- **A fix applied on the primary path, with a fallback/secondary path that still bypasses it.** This shape repeats three times: the "start empty" policy gate is enforced on the main restore-UI button but not on the Discovery-module-unavailable fallback button (Issue 15); the branch-selection write accepts a slightly broader set of branches than the read validates (Issue 4, edge case only); `resolveInitialSyncPlan()`'s empty-choice branch is evaluated before its Existing-customer guard (Issue 27), so it is only safe today because Issue 15's primary-path gate usually prevents `restoreChoice` from ever becoming `'empty'` on an Existing device — except through the same fallback gap.

None of this suggests the wizard is in a bad state overall — most of the *specific* historical bugs the request lists (branch auto-resolution, fake restore percentages, RBAC-on-`persistData`, the classic single/duplicate branch count) are genuinely fixed and are backed by tests that exercise the real function, not just its text. The remaining gaps are narrower and more mechanical than "many rounds of fixes haven't worked" — they are consistently small, identifiable wiring omissions in otherwise well-designed policy/authority modules.

---

## 2. Full classification table

| # | Issue | Classification |
|---|-------|-----------------|
| 1 | Google → Discovery / RBAC race | LIKELY BUG (primary path fixed; residual `hasGoogle()` divergence + `ensureConnected` option mismatch) |
| 2 | Next button stuck disabled | LIKELY BUG |
| 3 | Branch selection authority/confirmation | FIXED IN CURRENT SOURCE |
| 4 | Branch confirm click doesn't resolve gate | FIXED IN CURRENT SOURCE (main path); LIKELY BUG (inactive-branch edge case); UNVERIFIED RUNTIME (exact reported string) |
| 5 | Header/Body/Checklist step mismatch | LIKELY BUG (NEW-path conditional steps) |
| 6 | Next/Back/Resume ordering | FIXED IN CURRENT SOURCE (order correctness); duplicated arrays are a legacy-hygiene risk |
| 7 | Google change/disconnect buttons missing | CONFIRMED CURRENT BUG |
| 8 | Google requested twice | LIKELY BUG |
| 9 | Cloud restore pre-first-byte hang | CONFIRMED CURRENT BUG (reproduced live) |
| 10 | Restore watchdog/abort ownership | LIKELY BUG (critical coverage gap, not absence) |
| 11 | Restore error cause lost | LIKELY BUG (partial fix; aggregation + one handler regressed) |
| 12 | Backup password modal hidden | CONFIRMED CURRENT BUG |
| 13 | Fake progress percentages | FIXED IN CURRENT SOURCE |
| 14 | "May continue in background" misleading text | CONFIRMED CURRENT BUG (live code path) |
| 15 | Empty-start → impossible Owner state | LIKELY BUG (primary path fixed; fallback path bypasses policy) |
| 16 | Owner Auth Existing flow (no create) | FIXED (wizard UI); LIKELY BUG (shared `createOwner()` API has no hard guard) |
| 17 | NEW vs EXISTING logic leakage | Mixed: UI/step-model correctly separated; underlying mutator functions lack function-level guards |
| 18 | Duplicated state authorities | MOSTLY FIXED for gating (Next/READY); residual cosmetic reads of `completedSteps`/`syncDone` |
| 19 | Old patches/workarounds conflicting | CONFIRMED CURRENT BUG (parallel legacy wizard) + LEGACY/NO LONGER REACHABLE (`stage-*-uat` dirs) |
| 20 | Async render races | LIKELY BUG (guard exists, unused in production) |
| 21 | Red error truthfulness | CONFIRMED CURRENT BUG |
| 22 | Error code quality / Arabic mapping | CONFIRMED CURRENT BUG (catalog gaps + duplicate keys) |
| 23 | Page errors on installed EXE | LIKELY BUG (bare `DB` references depend on script order) |
| 24 | Button matrix coverage | MOSTLY WIRED (21/22; Restore "Retry" is a stub refusal) |
| 25 | Close/reopen "repairs" state | CONFIRMED design gap (explains and is explained by Issues 1/7/8) |
| 26 | Restart/Resume determinism | FIXED IN CURRENT SOURCE (logic); UNVERIFIED RUNTIME (no test restarts the process) |
| 27 | Sync direction safety | FIXED (normal EXISTING+cloud path); LIKELY BUG (empty-choice branch evaluated before EXISTING guard) |
| 28 | READY false-pass / auto-reopen | FIXED IN CURRENT SOURCE |
| 29 | Tests green, runtime fails (meta) | CONFIRMED CURRENT BUG (of the test architecture) |
| 30 | (this document) | — |

---

## 3. P0 — fix before next release

### 3.1 Cloud restore pre-first-byte hang (Issues 9, 10, 14)

**Root cause.** `electron/cloud-providers/cloud-service.js:downloadCloudBackup()` calls `resolveActiveProviderKey(id)` (`electron/cloud-providers/registry.js:36-44`) *before* calling the provider's `downloadBackup()`. `resolveActiveProviderKey` awaits `googleDrive.getStatus()` (`electron/cloud-providers/google-drive.js:240-270`), which awaits `getAuthedClient()` → `oauth2.getAccessToken()` and `driveApi.getUserEmail(oauth2)` (`electron/cloud-providers/google-drive-api.js:239-255`) → `getAbout()`/`fetch()`. **None of these four calls accept or forward an `AbortSignal` or any timeout.** The `ByteProgressWatchdog` armed in `electron/backup-v2-ipc.js:889-896` is only threaded into `options.signal`, which is passed to `downloadBackup()` — never to `resolveActiveProviderKey()`. `downloadBackup()` itself (`google-drive.js:467-472`) *does* correctly wrap its own `getAuthedClient()` call in `raceAbort(..., signal)`, proving the team knows the correct pattern; it just wasn't applied to this one earlier call site.

**Call chain.**
```
backup:v2:setupCloudRestore [backup-v2-ipc.js:831]
 → watchdog.arm() [889-892]  (starts 45s stall timer)
 → backupMain.downloadCloudBackup(path,'google',{signal: watchdog.signal}) [899]
 → cloud.downloadCloudBackup() [backup.js:93]
 → cloud-service.js:downloadCloudBackup() [100-108]
 → resolveActiveProviderKey(id)   ← signal NOT forwarded here
   → googleDrive.getStatus()      ← no signal, no timeout
     → getAuthedClient() → oauth2.getAccessToken()   ← no signal, no timeout
     → driveApi.getUserEmail() → getAbout()/fetch()  ← no signal, no timeout
 → [only after the above settles] getProvider(key).downloadBackup(path, id, options)
   → raceAbort(getAuthedClient(), signal)  ← correctly bounded
   → driveApi.downloadFileWithProgress(..., {signal})  ← correctly bounded
```

**Live reproduction** (ad hoc script, not committed): stubbed `googleDrive.getStatus()` to never resolve, armed a watchdog with `stallMs: 300`, called `resolveActiveProviderKey('google')`. Result: watchdog fired at 300ms as configured; `resolveActiveProviderKey` was still pending at the 2500ms test ceiling. The watchdog's abort has literally no effect on this call.

**Why tests miss it.** `tests/baseline/test-final-runtime-rbac-restore-stall.js` ("BUG-2 downloadFileWithProgress and setupCloudRestore wire AbortSignal") only asserts that the strings `signal`, `abortError`, `raceAbort` appear in `google-drive-api.js` and that `backup-v2-ipc.js` contains `signal: watchdog.signal` — it never inspects `registry.js`, where the actual gap lives, and never executes a hung call. `backup-restore-v2.test.js` only exercises the local (non-cloud) restore path. `test-p0-c-restore-truth-and-boot-gate.js` mocks `v2SetupCloudRestore` with a 40ms `setTimeout`, which cannot exhibit a multi-minute hang.

**Minimal safe fix.**
1. Change `resolveActiveProviderKey(id, options = {})` to accept `options.signal` and pass it to `getStatus({ signal })`.
2. Give `googleDrive.getStatus`/`getAuthedClient`/`driveApi.getUserEmail` an optional `signal` parameter, wrapping their awaits in the existing `raceAbort()` helper (same helper already used two call frames later).
3. In `cloud-service.js:downloadCloudBackup`, pass `resolveActiveProviderKey(id, { signal: options.signal })`.
4. Independently: cache a short-lived "already connected" result so a restore doesn't re-run a full status/email round-trip on every call.

**Regression test.** Main-process test: stub `registry.resolveActiveProviderKey`'s internal `googleDrive.getStatus` to never resolve; arm a watchdog with `stallMs: 100`; call `downloadCloudBackup(path, 'google', { signal })`; assert the promise rejects with `cloud_download_stalled` within ~200ms (not still pending at 2s).

**Installed-runtime acceptance test.** On the packaged EXE, use a proxying tool to delay only `oauth2.googleapis.com/token` or `drive/v3/about` responses by 60s before starting a cloud restore. Expected: a stall/retryable failure appears within ~45–50s. Current likely behavior: hang well past 45s with no error and no way to cancel from the UI.

**Related, same-bucket issue: "may continue in the background" (Issue 14).** `cloud/cloud-data-discovery.js:793-802` emits the Arabic warning "تحذير: لا يوجد تحديث منذ أكثر من 30 ثانية — قد يستمر التنزيل في الخلفية" purely from a 30s no-progress heartbeat, with no check for whether the operation is actually a legitimate slow transfer versus the hang above. It is live code, not dead legacy text, and it is misleading precisely during the failure mode described here: it appears exactly when nothing is happening and nothing can be done about it. Minimal fix: remove the warning, or gate it on `headersReceived === true && downloadedBytes > 0` (i.e. an active transfer that has actually started).

### 3.2 Test architecture gives false confidence (Issue 29)

**Root cause.** A large share of the "bootstrap" test suite falls into three patterns that cannot detect the bugs in this report:
- **Source-text regex matching disguised as behavior tests** — e.g. `test-final-runtime-rbac-restore-stall.js` and `test-bootstrap-red-message-truthfulness.js` read a `.js` file with `fs.readFileSync` and `assert.match()`/`assert.doesNotMatch()` against the raw text, never executing it.
- **Direct calls to internal functions with hand-built state, bypassing the real DOM/IPC/Main chain** — e.g. `test-p0-c-restore-truth-and-boot-gate.js` and `test-stage-2-ready-pure.js` inject synthetic snapshots/mocked `global.DB`, and `test-stage-17-bootstrap-checklist-ui.js` stubs `validateStep` to a `Set.has()` check with `addEventListener: () => {}` (no click ever fires).
- **Network mocks that resolve instantly**, which structurally cannot reproduce any timing-dependent hang, no matter how the watchdog is wired.

**Why this matters here, concretely.** The clearest proof is that `test-final-runtime-rbac-restore-stall.js` reports **PASS** for "downloadFileWithProgress and setupCloudRestore wire AbortSignal" while the live reproduction in §3.1 shows the actual restore call hanging indefinitely past the watchdog's deadline. This is not a hypothetical concern raised by the request — it is directly, repeatably demonstrable in the current commit.

**Minimal safe fix.** Not a rewrite of the suite: add one Electron-level smoke test (even a manual/CI script) that boots the packaged app, opens the real BootFlow overlay, and clicks through at least Google→Discovery and one restore attempt against a deliberately slow/hanging mock endpoint. Mark the existing suite explicitly as "contract-level" in its own documentation so a green run is never read as "the EXE behaves correctly."

**Regression test.** CI check: fail the build if any `assert.match(fs.readFileSync(...))`-style test is the *only* test claiming to cover an abort/timeout/IPC-fidelity behavior — i.e. require at least one behavioral (executing) test per such claim.

**Installed-runtime acceptance test.** Run the existing `scripts/windows-uat/*.cjs` harnesses as a mandatory release gate on the actual packaged EXE, not as an optional/best-effort step, with recorded DevTools console + screenshots per step.

### 3.3 Red error truthfulness (Issue 21)

**Root cause.** `setStatusFromErr()`/`bootstrap-failure-policy-contract.js` implement the correct policy (red only for RETRYABLE/FATAL, not REQUIRED/USER_ACTION/CANCELLED/IN_PROGRESS/success), but roughly 35 call sites in `cloud/boot-flow-ui.js` call the lower-level `setStatus(msg, true)` directly for ordinary validation hints — e.g. line 2456 `⚠️ اربط Google أولاً`, line 2522 `⚠️ أكمل التفعيل أولاً قبل ربط Google`, and similar hints on branch/owner/device/path-decision steps — all painted with the same red used for real operational failures. Stale red is also not guaranteed to clear on success unless `clearTransientBootstrapState()` is separately invoked; a plain `setStatus('✅ …')` does not itself remove the `bf-status-error` class.

**Why tests miss it.** `test-bootstrap-red-message-truthfulness.js` tests the *policy contract* (`normalizeFailure`) and a handful of specific regex patterns against the raw source text — it does not grep or execute every `setStatus(..., true)` call site, so the ~35 bypasses are invisible to it.

**Minimal safe fix.** Replace the validation-hint call sites with `setStatus(msg, false)` (or a new `setRequiredHint()` helper that can never set the error class); in `setStatus()`, unconditionally `classList.remove('bf-status-error')` whenever `isError !== true`.

**Regression test.** DOM harness: invoke each validation path and assert `#bf-wizard-status` never carries `bf-status-error` for a REQUIRED/USER_ACTION message.

**Installed-runtime acceptance test.** On the Google step before connecting, confirm the "connect Google first" hint is not the same red as an actual failed OAuth attempt; after a successful connect, confirm no red status bar persists.

### 3.4 Empty-start / sync-direction data-safety gap (Issues 15, 27)

**Root cause.** The Existing-customer "start with no restore" dead-end (choosing empty start, then hitting "no owner has been recovered yet" at Owner Auth) is correctly blocked on the primary restore-UI button via `existingEmptyStartPolicy()` (`cloud/boot-flow-ui.js:885-898, 3939-3961`) — but a second, unguarded button exists in the fallback UI shown when the Discovery module fails to load (`cloud/boot-flow-ui.js:3691-3712`), which calls `markRestore('empty', ...)` directly with no policy check at all. Separately, `validateStep('restore')`/`hasRestoreDecision()` (`boot-flow-ui.js:1038-1046, 1602-1610`) accepts `restoreChoice === 'empty'` unconditionally — the gate itself has no defense-in-depth, so it depends entirely on both UI buttons being correctly guarded. This same `restoreChoice: 'empty'` value, if it reaches an Existing-customer device through that one gap, feeds `InitialSyncDirectionContract.resolveInitialSyncPlan()` (`cloud/initial-sync-direction-contract.js:303-318`), whose empty-choice branch returns `PUSH_ONLY` and is evaluated *before* the Existing/replacement `PULL_ONLY` guard at lines 321-339 — i.e. the one path that can reach an unsafe `restoreChoice='empty'` state on an Existing device is also the one path that can produce an unsafe `PUSH_ONLY` sync plan.

**Why tests miss it.** `test-external-existing-bootstrap-authority.js`'s owner-auth-dead-end test injects `wizard.restoreChoice = 'empty'` directly into a synthetic wizard object and asserts the policy function still refuses — it proves the policy function is correct but never clicks the actual fallback button, and never triggers the "Discovery module unavailable" branch. `test-stage-15-initial-sync-direction.js` covers `{path:'existing', restoreChoice:'cloud'}` and replacement-device cases but has no case for `{path:'existing', restoreChoice:'empty'}`.

**Minimal safe fix.** Centralize the guard: have `markRestore('empty', ...)` (or `validateStep('restore')` itself) call `existingEmptyStartPolicy()` and refuse when `!allowed`, rather than relying on each individual button to remember to check it first; apply the same guard to the fallback button at line 3710; reorder `resolveInitialSyncPlan()` so the Existing/replacement-device PULL_ONLY guard is evaluated before the empty-choice branch, or make the empty-choice branch itself check `path === 'existing'`.

**Regression test.** `resolveInitialSyncPlan({ path: 'existing', restoreChoice: 'empty', remoteHasBusinessData: true })` must yield `PULL_ONLY`, never `PUSH_ONLY`. Separate DOM test: EXISTING path, no owner, `Discovery.discoverAllSources` undefined → the fallback "start without previous data" button must be disabled/refused, and `validateStep('restore')` must be `false` if `restoreChoice` is forced to `'empty'` via KV.

**Installed-runtime acceptance test.** Existing customer, force the Discovery-unavailable fallback UI (e.g. by disabling the discovery script), attempt "start without previous data" — must be refused with the Arabic policy message, not silently accepted.

---

## 4. P1 — real bugs, narrower blast radius or edge-case triggered

| Issue | Root cause (one line) | File(s) / function(s) | Minimal fix |
|---|---|---|---|
| **1** — Google/Discovery RBAC race | `BootFlow.hasGoogle()` and `PostGoogleCloudDiscovery.hasGoogle()` use different predicates, and `bootstrap.js:discoverAndFetchLicenseFromDrive` calls `DriveAdapter.ensureConnected()` without `acceptLiveReconnect: true` (unlike `runDiscoveryGate`, which does) | `cloud/boot-flow-ui.js:573-579`, `cloud/post-google-cloud-discovery.js:37-41`, `cloud/bootstrap.js:319-327` | Export one `hasGoogle()`; always pass `acceptLiveReconnect: true` from bootstrap-context callers |
| **2** — Next stuck disabled | `next.disabled = !validateStep(step)` never considers `inFlight` (opposite-direction gap from what was assumed); `runLicenseOrgRecovery` has no dedicated in-flight flag; `BootstrapCoordinator.isStepResolved('sync')` for EXISTING doesn't require `owner_auth` the way `validateStep('sync')` does, causing stepper/checklist to visually diverge from Next | `cloud/boot-flow-ui.js:2199`, `cloud/bootstrap-coordinator.js:153-162` | `next.disabled = !validateStep(step) \|\| isStepOperationInFlight(step)`; add an in-flight flag to `runLicenseOrgRecovery`; align coordinator's `sync` resolution with `validateStep` |
| **5** — Header/Body/Checklist mismatch | `renderStepUI()` and `getChecklistUiContext()` index the raw step array (`steps[w.currentStep]`) directly; only the header (`describeCurrentStep()`) re-resolves through `BootstrapStepModel.describeStep()`, which handles a stored index pointing at a no-longer-applicable step (e.g. an already-resolved fork) | `cloud/boot-flow-ui.js:3119-3123` (body), checklist context builder | Use `describeCurrentStep(w).stepId` as the switch target in both `renderStepUI` and the checklist context |
| **7** — Google buttons missing | `runGoogleConnect`'s `finally` block calls `renderProgress`/`renderNavButtons` only, never `renderStepUI` — but the disconnect/switch buttons are only rendered inside `renderStepUI` when `hasGoogle()` is true | `cloud/boot-flow-ui.js:2553-2558` | Add `renderStepUI(loadWizard())` to the `finally` block |
| **8** — Google requested twice | `isGoogleOAuthConnected()` calls `syncCloudStatusFromElectron()` with no `acceptLiveReconnect` option, and can disagree with `hasGoogle()` when `settings.userDisconnected` is stale relative to a live Main token | `index.html:18266-18280` | Pass `{ acceptLiveReconnect: true }` from bootstrap-context callers; short-circuit `runGoogleConnect` when already connected |
| **11** — Restore error cause lost | `confirmedCloudRestore()` maps a structured failure's `code` field down to a generic `error: 'cloud_backup_restore_failed'`; `backup:v2:setupLocalRestore` and the legacy `backup:downloadCloudBackup` handler still `throw` unstructured errors that hit Electron's default IPC message collapsing | `cloud/cloud-data-discovery.js:817-819`, `electron/backup-v2-ipc.js:655-675`, `electron/main.js:602-606` | Propagate `code` (not just `error`) through the aggregation; wrap `setupLocalRestore` in the same try/catch → structured-return pattern as `setupCloudRestore` |
| **12** — Backup password modal hidden | `#backupPasswordModal` uses the generic `.modal-overlay` at `z-index: 10030`; the bootstrap overlay is `z-index: 100030`, and unlike `#cloudConnectModal` there is no `body.bf-active #backupPasswordModal` override | `index.html:857-860`, `cloud/boot-flow-ui.js:1738-1740` | Add `body.bf-active #backupPasswordModal.open { z-index: 100060 !important; }` |
| **16** — `createOwner()` API guard | `owner-management.js:createOwner()`/`createOwnerAccountUnlocked()` has no check for "is this an Existing-customer path" or "does an authoritative owner already exist" — the UI never calls it on the Existing path, but nothing stops a programmatic call (e.g. Owner Hub self-heal) from doing so | `cloud/owner-management.js:566-576` | Add `if (BootFlow.isExistingCustomerPath() \|\| countAuthoritativeOwners() > 0) return { ok:false, error:'owner_create_forbidden' }` |
| **17** — NEW/EXISTING mutator guards | `activateLicenseKey`, `commitSetupOrganizationDevice`, `createFirstBranchFromForm`, `commitPublicationFromWizard` are NEW-only by UI placement but have no function-level path assertion | `cloud/boot-flow-ui.js:2417, 2614, 2697, 2911` | Add a shared `assertNewCustomerPath()` guard to each |
| **19** — Parallel legacy wizard | `cupping-first-run.js:openSetupWizard()` opens its own `#setupWizardModal`, entirely separate from `BootFlow`/`#bootFlowOverlay`; `CODE_POLICY` in `bootstrap-failure-policy-contract.js` has at least two internally duplicate keys (`backup_download_stalled`, `backup_password_invalid`) where the later literal silently wins | `cupping-first-run.js:548-560`, `cloud/bootstrap-failure-policy-contract.js` (duplicate keys) | Route `openSetupWizard` to `BootFlow.forceOpen()`; deduplicate `CODE_POLICY` keys |
| **20** — Async render races | `renderGeneration`/`isRenderCurrent()` exists and is unit-tested as an API but is never called from the async callbacks it was built to guard (Discovery progress, Google refresh, Restore progress) | `cloud/boot-flow-ui.js:151, 2210-2227` (defined); Discovery/Google/Restore `.then()` callbacks (unused) | Capture `(gen, stepId)` at handler start; `if (!isRenderCurrent(gen, stepId)) return;` before any DOM write |
| **22** — Error code catalog | `CODE_POLICY` is the one real authoritative map but is missing several live Main-process codes (`legacy_setup_restore_unavailable`, `no_authorized_backup`, `quota_exceeded`, `setup_google_main_not_connected`, …) and has duplicate keys as noted above; a secondary, smaller `ERROR_MESSAGES` map in `bootstrap-checklist-contract.js` can diverge from it | `cloud/bootstrap-failure-policy-contract.js`, `cloud/bootstrap-checklist-contract.js:59-78` | Add the missing codes; delete the secondary map and delegate to `CODE_POLICY` |
| **23** — Bare `DB` references | `cupping-ext-modules.js:253` (`DB.get('logCounter', 0)`) and `cupping-leave-management.js:29` use bare `DB` instead of `global.DB`/`window.DB`, relying entirely on `index.html`'s current script order; `employeeLedger.isModuleEnabled()` can throw if `global.settings` is ever undefined when it runs | `cupping-ext-modules.js:253`, `cupping-leave-management.js:29`, `cupping-employee-ledger.js:392-395` | Use `global.DB`/optional chaining consistently; guard `isModuleEnabled()` against missing `global.settings` |
| **4 (edge case)** — Branch confirm | `selectExistingBranchOnly()` accepts a branch found in the raw `lic.branches` fallback even when `authoritativeBootstrapBranches()` would exclude it (e.g. `active:false`); `currentBranchSelection()`'s later validation then silently deletes that selection | `cloud/boot-flow-ui.js:2773-2774` (write) vs `:623-624` (read) | Remove the unfiltered `lic.branches` fallback in the write path, or filter it the same way the read path does |

---

## 5. P2 — confirmed-fixed, cosmetic, or hygiene-only

- **Issue 3 (branch authority)** — FIXED. `currentBranchSelection()`/`recordBranchSelection()` bind to `organizationId + googleAccountKey + branchId`, require `provenance ∈ {'user','created'}`, and explicitly reject `lockedBranchId`/`DeviceConfig`/`pendingBranchId`/`completedSteps`; `auto_single` has zero live references anywhere in the repo. 105/105 authority tests pass against the real module. Only cleanup needed: `bootstrap-gates.js` still documents a stale `sourceOfTruth: 'license.branches+wizard.pendingBranchId'` comment that no longer matches the implementation.
- **Issue 6 (step order)** — FIXED in behavior (navigation is step-id based via `BootstrapStepModel.getNextStep`/`getPreviousStep`, not raw index arithmetic, and is tested through five Next/Back cycles without drift). The four-file duplication of the actual array contents (see §1) remains a hygiene risk even though currently in sync.
- **Issue 13 (fake progress)** — FIXED. `buildProgressState()` in `cloud/cloud-data-discovery.js:422-438` returns `percent: null`/`indeterminate: true` before any byte arrives; the network-download line and the overall-restore line are rendered separately in `boot-flow-ui.js:3636-3648`. The remaining weighted `stageRatio` computation is intentional multi-stage progress (verify/decrypt/import), not a reintroduction of the historical fake-13% bug.
- **Issue 18 (duplicated authorities)** — MOSTLY FIXED for anything that gates a user-visible decision: Next and READY exclusively use `validateStep()`/`ReadyPureEvaluator`, not raw `completedSteps`/`syncDone`. Those two fields are still *written* on many commits and still influence cosmetic stepper-dot coloring and one sync-reconnect heuristic, which is a real (if low-severity) contradiction of the "NO_LONGER_AUTHORITATIVE" comment in `bootstrap-coordinator.js`.
- **Issue 24 (button matrix)** — 21 of ~22 controls are wired to real handlers with real IPC/async effects, verified by function name at each call site. The one gap: the checklist's "Retry" control on the Restore step explicitly returns `restore_retry_requires_ui` instead of re-offering the restore UI — a real but narrow gap, not a systemic stub problem.
- **Issue 25 (close/reopen "repairs" state)** — Confirmed as a design characteristic, not an independent bug: `BootFlow.open()` → `openOverlay()` is an in-page DOM overlay in the same `BrowserWindow`/JS process (`electron/main.js` creates one window; there is no separate Bootstrap window), so module-level state persists across close/reopen. The apparent "repair" comes entirely from `openOverlay()` → `prepareBootstrapResume()` re-deriving the step index from authoritative gates and re-running `runDiscoveryGate()` (which explicitly calls `refreshGoogleConnectionState({acceptLiveReconnect:true})` per a comment at `boot-flow-ui.js:2448-2451` documenting this exact history). This is fully explained by, and will be resolved by, fixing Issues 1/7/8 so first-pass entry does the same reconciliation reopen does — there is no separate "make reopen not repair" fix to apply.
- **Issue 26 (resume determinism)** — FIXED in logic (`sanitizeWizardForResume` → `BootstrapCoordinator.effectiveStepIndex` resumes from the first gate-unresolved step, not a raw counter) and well covered by `test-stage-19-bootstrap-dismiss-resume.js`. UNVERIFIED RUNTIME only because no test actually restarts the Electron process mid-flow at each of the 8 steps to check for duplicate entity creation in Main.
- **Issue 28 (READY false-pass)** — FIXED. `ReadyPureEvaluator` is genuinely authoritative and is tested against exactly the false-positive shapes the request worries about (`wizard.syncDone` alone, `completedSteps` alone, `meta.bootstrapCompletedAt` alone — all correctly evaluate to `ready: false` without full device state-of-truth). `shouldAutoOpenBoot()` correctly short-circuits to `false` when `isDeviceReadyAuthoritative()` is true.

---

## 6. Priority ranking

**P0 (fix before next release):**
1. §3.1 — Cloud restore pre-first-byte hang (Issues 9, 10, 14) — thread the abort signal through `resolveActiveProviderKey`
2. §3.2 — Test architecture false confidence (Issue 29) — add one real Electron/IPC-level smoke test
3. §3.3 — Red error truthfulness (Issue 21) — stop ~35 `setStatus(msg, true)` bypasses of the correct policy layer
4. §3.4 — Empty-start / sync-direction data-safety gap (Issues 15, 27) — centralize the restore-choice policy guard, reorder the sync-direction check

**P1 (fix soon, real but narrower):** Issues 1, 2, 4 (edge case), 5, 7, 8, 11, 12, 16, 17, 19, 20, 22, 23 — see §4 for the concrete fix per issue.

**P2 (confirmed-fixed or cosmetic-only):** Issues 3, 6, 13, 18, 24, 25, 26, 28 — see §5. No urgent action required; hygiene items (deduplicating step-order arrays, stale comments/metadata) are worth doing opportunistically since they are exactly the pattern that has caused repeat regressions in this codebase's history.

---

## 7. Note on scope not covered by direct reproduction

Every P0 item and most P1 items were verified against the actual current function bodies and, for the restore hang, a live executable reproduction. Items marked UNVERIFIED RUNTIME above (the exact Windows harness string for Issue 4, and the restart-duplication behavior for Issue 26) could not be checked further in this Linux sandbox, which has no Wine/Windows VM available (consistent with the environment's own `WINDOWS-INSTALLED-EVIDENCE.md`). The acceptance-test steps given per issue are written so they can be executed directly against the packaged EXE once one is available.
