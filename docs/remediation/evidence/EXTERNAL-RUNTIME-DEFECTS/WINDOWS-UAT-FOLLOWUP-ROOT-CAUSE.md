# Windows UAT follow-up — root cause analysis

Status: **ROOT CAUSE FOUND / SOURCE FIXED — INSTALLED RETEST STILL REQUIRED**

This document records why previously reported "source fixed" statements did not
govern the installed runtime, and what actually caused each reported defect.

---

## 0. Package identity — CANNOT BE PROVEN FROM THIS REPOSITORY

| Item | Result |
|---|---|
| Expected EXE SHA-256 | `09705D189DC6899CB2260F40B825D8103EA3628722595FAAA5D49B38CC698B79` |
| Actual EXE SHA-256 | **UNVERIFIABLE** — no `.exe` and no `app.asar` exists anywhere in the repo or workspace |
| ASAR ↔ source match | **UNVERIFIABLE** — nothing to unpack |

`find` / glob for `**/*.exe` and `**/*.asar` returns zero files. This agent runs
on Linux and cannot produce a Windows NSIS artifact, so per-file
source↔asar SHA comparison is not possible here.

### What *can* be proven about the tested build

Two behavioural fingerprints observed by the reporter exist **only** in commit
`78749fe`:

1. `— مرجع: TDW-BOOT-ERR-…` — the ` — مرجع: ` support-reference suffix was
   introduced in `78749fe` (`formatFailureForStatus`).
2. `حدث خطأ غير متوقع. انسخ مرجع الدعم إن استمرت المشكلة.` — this exact
   `unknown` string was introduced in `78749fe` (`activation-errors.js`).

So the installed EXE was built from `78749fe` (or a descendant).

### Why earlier "fixes" did not govern the runtime

Files/mechanisms named in the earlier BUG-A/B/C report **do not exist in any
branch of this repository**:

| Claimed artifact | Exists? |
|---|---|
| `cloud/byte-progress-watchdog.js` | **No** — not in any branch |
| `ByteProgressWatchdog` | **No** |
| `database:setupCommitGoogleConnection` | **No** |
| Main-process `AbortController` in `electron/backup-v2-ipc.js` / `google-drive*.js` | **No** |
| sender+operation-scoped cancellation registry | **No** |

Verified with `git grep` across `origin/main`,
`cursor/bootstrap-restore-fixes-beb8`, `cursor/build-ready-source-zip-beb8`,
`cursor/production-fixes-v5-retained-beb8`, and the working branch.

**Conclusion:** the claimed 45-second Main-process abort never existed in the
built source. That is the primary reason BUG-C behaviour was unchanged: there
was nothing in the package to change it.

### Additional cause: the regression suite was red at build time

At `78749fe` (the source that produced the tested EXE), the baseline suite was
already failing:

| Suite | at `493fc97` | at `013f37e` | at `78749fe` |
|---|---|---|---|
| `test-p0-c-discovery-integrity` | PASS | **FAIL** | **FAIL** |
| `test-stage-7-explicit-discovery-gate` | PASS | **FAIL** | **FAIL** |
| `test-post-stage-20-external-defects` | PASS | **FAIL** | **FAIL** |

These were introduced by this agent in `013f37e` and shipped. One of them was a
real product bug (see BUG-GOOGLE-ROBUSTNESS below). All are fixed and green now.

---

## 1. BUG-A — Google / RBAC: PASS, preserved

Manual Windows status: **PASS** (Google connects once, no second request, no
false red error after Google).

Preserved and now regression-guarded in
`tests/baseline/test-external-existing-bootstrap-authority.js`
(`bugARegressionGuard`): Google session latch, `acceptLiveReconnect`, the
switch/disconnect action, and `google` + `discovery` checklist rows rendering
`DONE` (not red). No change was made to
`database:setupCommitGoogleConnection`-adjacent behaviour, Main OAuth
projection, or RBAC.

---

## 2. BUG-ORG/BRANCH — reproduced and root-caused

### Reproduced
Yes, executably. `defectReproduction()` in the new suite drives the **real**
`cloud/boot-flow-ui.js`. Against `78749fe` source it fails with:

```
FAIL  REPRO branch: checklist row is REQUIRED (got DONE)
FAIL  REPRO branch: recovered branch must NOT auto-complete branch_select
FAIL  REPRO branch: device step must NOT receive an unchosen BR-MAIN
FAIL  REPRO branch: local-echo-only branch is never selected
```

That is the reported installed behaviour, in a test.

### First function that returned branch DONE, and its caller

`branchStepResolved()` (`cloud/boot-flow-ui.js`), called from
`validateStep('branch_select')`, which is called from
`BootstrapChecklistContract.isStepDone` via `getChecklistUiContext` during
`renderChecklist`, and independently from
`BootstrapCoordinator.isStepResolved('branch_select')` →
`deriveCompletedSteps` → `getDisplayWizard`.

Pre-fix code:

```js
function branchStepResolved() {
  if (!hasBranch()) return false;
  const branches = authoritativeBootstrapBranches();
  if (branches.length > 1) return isBranchExplicitlySelected() && !!getSelectedBranchId();
  return !!getSelectedBranchId();          // <-- one branch: no proof required
}
function getSelectedBranchId() {
  ...
  if (branches.length === 1) return String(branches[0].id || '');   // <-- invents the choice
}
function isBranchExplicitlySelected() {
  ...
  if (count === 1) return true;            // <-- unconditional true
}
```

### Runtime state at that moment (from `branchGateDiagnostics()`)

```
organizationId      NJR-CLINIC-628E0049
licenseBranches     ["BR-MAIN"]
discoveryCandidates [{BR-MAIN, license_discovery, verified:true},
                     {BR-MAIN, data_discovery,    verified:false}]
localDeviceBranch   BR-MAIN            (stale, device not yet registered)
wizardBranchSelection null              (no operator click)
eligibleBranches    [{BR-MAIN, license}]
eligibleBranchCount 1
selectionProvenance null
branchStepResolved  true   <-- pre-fix
```

### Why the provenance guard was bypassed

There were **two different branch counts**:

* `authoritativeBranchCount()` = `max(dedupedList.length, rawCandidates.length)`
  → **2** (the `data_discovery` echo is a second *candidate* for the same branch,
  and `mapBranchCandidates` does not de-duplicate). This is why the UI printed
  `فروع: 2`.
* `authoritativeBootstrapBranches().length` = de-duplicated → **1**.

The guard in `advanceWizard` read the inflated count (2, so it asked for a
click), but `branchStepResolved()` read the de-duplicated count (1, so it took
the no-proof branch). The checklist derives from `validateStep`, so the row
rendered `DONE` regardless of the guard. Hypothesis (d) from the brief is the
correct one, combined with (c).

Two further contaminations:

* `dataDiscovery.cloud.branchId` is **not cloud authority**. `getIdentity()`
  (`cloud/cloud-data-discovery.js:142`) reads
  `DeviceConfig.load().lockedBranchId || BranchScope.getActiveBranchId() ||
  lic.branchId`, passes it into `discoverCloudRestorePoints`, and
  `electron/cloud-data-discovery.js` echoes it straight back on the `cloud`
  object. `mapBranchCandidates` then presents it as a discovered branch.
* Wizard migration forged provenance:
  `if (cfg.lockedBranchId && branchCount <= 1) { w.pendingBranchId = …;
  w.branchExplicitlySelected = true; }` — i.e. an existing customer on a new
  device could silently inherit an old device's branch.

`reconcileBranchSelectionAfterDiscovery()` could never repair this: its two
conditions were mutually blocking, so a state with **both**
`branchExplicitlySelected` and `completedSteps` containing `branch_select`
was a no-op.

### Old working behaviour (authority for the fix)

Every older snapshot (`stage-2-uat` … `stage-10-uat`) used:

```js
case 'branch_select': return hasBranch() && hasDeviceBranch();
```

i.e. the step completed **only** after the operator clicked
«🔗 ربط هذا الجهاز بالفرع» — **including when exactly one branch existed**. The
dropdown pre-selected a value but that never completed the step. Older builds
also never merged discovery candidates into the branch list
(`populateDriveBootstrapBranchFields` read `license.branches` only).

Product policy therefore: **explicit confirmation is always required, even for
one branch.** That is what is now implemented.

### Fix

* `currentBranchSelection()` — single source of truth; a selection is valid only
  with provenance `user` (operator click) or `created` (branch this journey
  created), and only while the organization, Google account, and eligible branch
  set still match. `completedSteps` is no longer accepted as proof.
* `deviceBoundBranchSelection()` — a device that already completed registration
  in *this* organization keeps the gate resolved across restart (this is the old
  build's `hasDeviceBranch()` rule); a device bound to another org does not.
* `eligibleBranchCount()` — the only count authority.
* `authoritativeBootstrapBranches()` — skips `source === 'data_discovery'`
  unless a cloud license document corroborates the id.
* `reconcileBranchSelection()` — runs synchronously at the top of
  `getChecklistUiContext()`, so an unprovable selection is dropped *before* the
  checklist is derived.
* Migration no longer forges `branchExplicitlySelected`; the flag is deleted.
* `branch_select` UI shows the recovered organization above the branch picker.
* `branchGateDiagnostics()` exports the evidence above (no secrets).

Files: `cloud/boot-flow-ui.js`.

---

## 3. BUG-BACKUP-RESTORE — root cause of the generic failure

### The observed code is reproducible arithmetic, not a mystery

`TDW-BOOT-Error-invoking-remote-me` is produced deterministically:

1. Main throws `err.code = 'setup_restore_requires_empty_database'`.
2. Electron `ipcRenderer.invoke` rejects in the renderer with a **new** Error:
   `Error invoking remote method 'backup:v2:setupCloudRestore': Error: <msg>`.
   **Custom properties, including `code`, are not transferred.**
3. `restoreErrorCode()` was `error?.code || error?.error || error?.message` →
   `code` and `error` are `undefined`, so it returned the wrapper **message**.
4. `lookupPolicy` matched nothing and built a code from that free text:
   `'TDW-BOOT-' + text.replace(/[^A-Z0-9_]/gi,'-').slice(0,24)`
   = `TDW-BOOT-Error-invoking-remote-me`.

The message became generic for a second, independent reason: **no entry in
`CODE_POLICY` carried a `message`**. Messages came only from
`ActivationErrors.MESSAGES`, so any code absent there fell through to
`unknown` → «حدث خطأ غير متوقع».

### Exact real call chain (now instrumented)

```
renderer  CloudDataDiscovery.confirmedCloudRestore
        → restoreCloudBackupFile → invokeNativeRestore
        → b.v2SetupCloudRestore                       (preload bridge)
IPC     → 'backup:v2:setupCloudRestore'
main    → handler: handler_entered → password_resolved → remote_path_validated
        → target_classified → provider_call_started
        → backupMain.downloadCloudBackup → Google provider → downloadByPath
        → downloadFileWithProgress
        → provider_call_returned → staged_file_ready
        → legacy_classification → format_classified
        → runRestore (decrypt → checksums → staging → integrity → atomic swap)
        → completed | failed
```

Every stage is now written to
`<userData>/Backups/V2/diagnostics/SRT-*.json` with `operationId`, stage
timings, `providerOk`, `progressEvents`, `observedBytes`, `stagedBytes`,
`classification`, `bootstrapRows`, `meaningfulRows`, `reasons`, `format`, and
the failing `code`. Passwords are recorded only as
`passwordProvided: true|false` plus `passwordSource`.

**Does production use `downloadFileWithProgress`?** Yes —
`electron/cloud-providers/google-drive.js:381` calls
`driveApi.downloadFileWithProgress`. The new `provider_call_started` /
`provider_call_returned` markers with `progressEvents` and `observedBytes` make
this observable at runtime rather than inferred.

### Actual Main exception

**NOT YET DETERMINED from the installed run** — the pre-fix build destroyed the
cause at the IPC boundary before anything recorded it, and no diagnostic file
existed. This is exactly the reporting defect that has been fixed. The most
likely candidate, given the failure occurs immediately after the password is
submitted and before any bytes move, is `setup_restore_requires_empty_database`
(the empty-database classification runs *before* the download), but this is a
hypothesis and is **not** claimed as fact. The next installed run will name it in
`SRT-*.json` and in the UI.

Reported values for the failing attempt (bytes / temp file / decrypt reached /
SQLite reached) are **UNVERIFIED** for the same reason — they were never
captured. They are now captured.

### The 13% figure

Weighted stage progress, not bytes. `BACKUP_V2_RESTORE_STAGES` total weight 85;
`download_db` is index 2 with `verify_point`(5) + `local_safety`(5) already
done, and a `stageRatio` floor of `0.05`:

```
(10 + 25 × 0.05) / 85 = 11.25 / 85 = 0.1323 → 13%
```

`buildProgressState` also treated **expected** size as progress
(`hasByteProgress = downloadedBytes > 0 || totalBytes > 0`), which disabled the
indeterminate heuristic whenever a file size was known — so zero bytes rendered
a confident percentage. Fixed: only received bytes count, the download stage is
indeterminate until the first byte, and the UI shows
«جارٍ بدء التنزيل…» with overall stage `3/9` and a separate
`x KB / 42.6 KB` byte counter.

### Fix

* New `cloud/ipc-error-envelope.js`: Main encodes `[TDWERR code=… op=… stage=…]`
  into the Error message (the only field that survives); the renderer decodes it
  and also strips the `Error invoking remote method '…'` wrapper.
* `electron/backup-v2-ipc.js`: `createSetupRestoreTrace()` +
  `trace.fail(code, {stage})` at every boundary of
  `backup:v2:setupCloudRestore`; `runRestore` failures are no longer allowed to
  escape unclassified; success returns `operationId`.
* `restoreErrorCode()` decodes the envelope first and never returns wrapper text
  as a code.
* `resolveRawCode()` decodes too; `lookupPolicy` refuses to build a code from
  free text (`TDW-BOOT-UNCLASSIFIED` instead).
* Real resource leak fixed: the restore operation-timeout `setTimeout` was never
  cleared, leaving a 10-minute timer able to reject a settled promise.

No timeout was increased, no progress was fabricated, no exception is swallowed.

---

## 4. BUG-NO-RESTORE/OWNER — state machine defect

### Root cause

On the EXISTING path the Owner is **recovered**, never created
(`EXISTING_STEPS` has `owner_auth`, not `owner`). `hasRestoreDecision()` accepts
`restoreChoice === 'empty'`, so choosing «بدء قاعدة جديدة» resolved the restore
gate, while `ownerAuthStepResolved()` requires `hasOwnerPasswordAccount()`,
which only a restore (or a cloud pull) can satisfy. The wizard therefore
advanced to «تحقق المالك» and rendered
«لا يوجد مالك مسترد بعد — أكمل الاستعادة أولاً» on a mandatory step: an
unreachable state.

### Intended policy (implemented)

`existingEmptyStartPolicy()`: on the EXISTING path, «بدء قاعدة جديدة» is
**refused** while no Owner is recoverable. The button is disabled, the card
explains why, and pressing it reports
`existing_empty_start_blocked_no_owner` instead of entering the dead end. The
operator is pointed at the paths that can actually produce an Owner (complete
the cloud restore, or «تأكيد البيانات الحالية»). Owner is never faked, never
marked DONE, and no duplicate Owner is created.

Files: `cloud/boot-flow-ui.js`, `cloud/bootstrap-failure-policy-contract.js`.

---

## 5. BUG-GOOGLE-ROBUSTNESS (found while fixing the red baseline)

`runGoogleConnect()` executed `w.completedSteps.includes('google')` on a wizard
record that can legitimately lack `completedSteps` (older persisted state). The
`TypeError` was caught by the surrounding `catch`, so a **successful** Google
connection reported failure. Introduced in `013f37e`. Fixed by normalizing
`completedSteps` to an array in `normalizeWizardFlowState()`.

---

## 6. Error audit

Generated artifact: `BOOTSTRAP-ERROR-AUDIT.json` (produced from the live policy
table, not hand-written).

| Metric | Value |
|---|---|
| Total reachable raw codes | 83 |
| Generic fallbacks remaining | **0** |
| Outcomes | RETRYABLE 34 · USER_ACTION_REQUIRED 39 · FATAL 7 · CANCELLED 3 |
| Rendered red (failing operation only) | 41 |
| USER_ACTION (not red) | 39 |
| CANCELLED (not red) | 3 |

Invariants now enforced by test:

* every known code owns a specific Arabic message (no «غير متوقع»);
* every known code maps to a stable `TDW-BOOT-*` code, never to free text;
* `step_required` is USER_ACTION and not retryable — a requirement never
  masquerades as an operational failure;
* cancellation is CANCELLED, not FATAL;
* success clears stale red state (`clearChecklistStepError`, and
  `getChecklistUiContext` auto-clears resolved steps);
* red is reserved for a currently failing operation.

---

## 7. Test matrix status

| Group | Covered |
|---|---|
| Branch: one genuine cloud branch | yes |
| Branch: two genuine cloud branches | yes |
| Branch: duplicate evidence, same branch | yes |
| Branch: data_discovery echo + real license branch | yes |
| Branch: stale local BR-MAIN | yes |
| Branch: stale lockedBranchId | yes |
| Branch: old wizard auto-selection (legacy flags) | yes |
| Branch: explicit selection then restart | yes (device-bound resume) |
| Branch: organization change invalidates selection | yes |
| Branch: Google account change invalidates selection | yes |
| Restore: cause survives IPC (7 Main codes) | yes |
| Restore: IPC drops `error.code` (boundary fidelity) | yes |
| Restore: zero bytes / some bytes | yes |
| Restore: unmapped Main failure | yes |
| No-restore: EXISTING → empty start | yes |
| Errors: no generic message, no false red, outcome hygiene | yes |

Not yet covered by executable tests (declared, not claimed):
Drive 401/403/404/429/5xx matrix, checksum/corrupt-archive/size-mismatch
fixtures, partial-file cleanup after a real interrupted download, restart after a
failed restore, and a genuine historical Backup V2 fixture from the reporter's
Drive. These need either a Drive fixture harness or the reporter's real `.tdw`
file.

---

## 8. Verification status

| Item | Result |
|---|---|
| `npm run lint` | PASS |
| Full `tests/baseline` (131 suites) | **131 passed, 0 failed** (was 129/2) |
| New authority suite | 103 checks pass |
| Failing-first proof | 9 checks fail on `78749fe` source, pass after fix |
| Windows build from this HEAD | **NOT DONE** — Linux agent; GitHub Actions billing previously blocked |
| Installed Windows journey to READY | **NOT DONE** |
| Restart after restore | **NOT DONE** |

**The gate remains FAIL until the installed Existing-customer journey reaches
READY with the real Google account and a real historical backup.**
