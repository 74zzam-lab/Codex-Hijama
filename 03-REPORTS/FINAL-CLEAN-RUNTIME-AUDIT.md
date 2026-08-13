# Final Activation / Licensing / Google Cloud / Setup Clean-Runtime Audit

Audit started: 2026-08-11  
Authoritative baseline: current checkout at `D:\Hijama-Clinic-Production`  
Change rule: no production-code change until a defect is reproduced and recorded below.

## 1. Current lifecycle map

| Step | Renderer caller | Main IPC / trusted layer | Service / SQLite authority | Cloud artifact / dependency | Success, failure, retry and restart contract |
|---|---|---|---|---|---|
| Application start | startup IIFE in `index.html`; `SqliteBridge.initializeAtStartup` | `database:hydrate`; public pre-auth hydrate when no Main session | `electron/database/service.js:hydratePreauth`; `users`, activation/meta/device KV and selected setup state | No Drive mutation | Success requires SQLite hydrate before login/BootFlow. Main RBAC session is intentionally empty after every restart. |
| Google state | `BootFlow.refreshGoogleConnectionState`; `DriveAdapter.ensureConnected` | `backup:getGoogleStatus`, `backup:connectGoogle`, `backup:disconnectCloud` | Main Google provider and safeStorage token store | OAuth token in OS protected storage; Drive API | Renderer cache is not authority. Live Main token state must be reconciled only in the explicit Google setup step. OAuth uses state + PKCE. |
| License discovery/pull | `CloudBootstrap.discoverAndFetchLicenseFromDrive`; BootFlow auto discovery | constrained Drive list/download and `database:setupCommitActivation` | Main re-downloads and verifies remote license before SQLite transaction | `NajjarTech/**/License/license.json`; authenticated Google identity | Discovery is read-only until exact candidate verification. Duplicate/foreign/tampered candidates fail. Retry must preserve root cause. |
| V5 key activation | `CommercialLicense.router.applyActivation`; `LicenseActivationGate` | Sheets proxy `fetchBundle`/`activate`/`patchActivation`; constrained Drive activation upload; `database:setupCommitSignedActivation` | Activation state and license commit; V5 bundle is authoritative for extended expiry | Google Sheets `activations` and `bundles`; Drive `license.json` | Consumption must be once-only. Local, Sheets, Drive and SQLite must not report success after a partial operation. |
| V6 activation compatibility | `CommercialLicense.router.applyV6Activation` | `database:setupCommitSignedActivation` | Main signature/expiry validation then setup activation transaction | Optional Drive publication | V6 remains compatibility-only; no change to requested V5 issuance path. |
| Developer issuance | Developer login UI -> Main proof -> `__dev__` session -> `CommercialLicense.drawer` | Main-issued one-time auth proof; LicenseAdmin IPC writes | `LicenseAdmin/licenses`, `LicenseAdmin/activations`, `LicenseAdmin/index.json` | UI prepares 6-column `activations` and 2-column `bundles` rows for the existing manual Sheets workflow | One click must create one license. UI success must match re-read LicenseAdmin output. Original and current code do not auto-append Sheets rows. |
| Organization/branch/device setup | `BootFlow.createFirstBranchFromForm` or `bindExistingBranch` | `database:setupCommitOrganizationDevice` | SQLite activation, organization settings, device config, branch/license state | First-branch license publication when protocol requires | Command must be transactional/idempotent. A successful device bind requires one authoritative device-registry record, not only local device config. |
| Owner setup/recovery | `OwnerManagement` / `OwnerCreateForm` | `database:setupCommitOwner`, then `rbac:authenticateUser` and proof-bound `rbac:bindSession` | `users` is credential authority; owner profile/setup are organization-scoped typed entities | Owner credential revision flows through outbox/sync | Exactly one usable Owner. Existing credential is reused and never reset. Initial sync requires a real Main session after restart. |
| Restore/data source | BootFlow restore step; `CloudDataDiscovery`; Backup V2 setup restore | Backup V2 discovery/download/stage/verify/swap IPC | SQLite staged restore, integrity/FK/identity checks | Backup V2 manifest/data or explicitly labelled checkpoint | No checkpoint may claim full Backup V2 verification. Discovery must resume prior sync state on every exit. |
| Initial sync | `BootFlow.runInitialSyncPipeline` | protected `database:syncOp` through `SyncEngine` | durable per-record outbox, revisions, tombstones and conflicts | `sync-v3/operations/**` plus version publication | Requires live Google, license, Owner credential and authenticated Main session, branch and registered device. Any `{ok:false}` keeps `syncDone=false` and blocks READY. |
| READY and restart | `SetupStateService`, `BootFlow.markBootComplete` | durable commits only | SQLite/setup state plus UI-only wizard navigation flags | No new mutation solely for READY | READY is valid only when committed state is complete. Restart clears RBAC session but must preserve Owner/branch/device/license without duplication or reset. |

## 2. Original/current behavior established before remediation

- Original and current V5 generator both persist issuance to local `LicenseAdmin` and prepare copyable rows for the `activations` and `bundles` Sheets tabs. Neither implementation automatically appends those rows to Google Sheets. Automatic append would be a new feature and is outside this audit.
- Original summary labels the generated legacy key as V5. Current UI labels the same V5 key as V6; this is a misleading regression.
- Original and current activation paths can create the first branch from V5 license data. The current architecture must keep SQLite and typed/outbox authority; old direct local persistence is not to be restored.
- Developer password UI and intended support capability are unchanged. Main-issued proof remains mandatory before binding `__dev__`.

## 3. Pre-change reproduced defects

### AUD-BOOT-007 — existing Owner accepted without a Main session

- Requirement: an existing usable Owner credential may satisfy the credential invariant, but initial sync must not begin until that Owner has authenticated and Main has issued/bound a session.
- Reproduction: actual source Electron, isolated profile `prechange-owner-1786456797821`; real SQLite setup activation/organization/Owner commits; app closed/restarted; Main session explicitly checked; controlled connected Drive transport; actual `BootFlow.runInitialSyncPipeline` invoked.
- Observed: `hasOwnerPasswordAccount=true`, `validateStep('owner')=true`, Main returned `no_session`, and initial sync returned `{ok:false,error:'rbac_session_required'}`.
- Expected: Owner step asks the existing Owner to sign in; successful proof/session bind precedes protected settings/sync calls. A bad password stays on Owner step.
- Root cause: BootFlow equates credential existence with runtime authorization. `SetupStateService` has no Main-session prerequisite and the Owner screen contains no existing-owner login path.
- Original behavior: original setup was less strictly Main-authorized; copying that behavior would violate the current security boundary.
- Minimal fix: reuse the existing owner authentication/proof/bind path inside the current Owner step; gate sync on a live matching Main session. Do not create or reset an Owner.
- Regression risk: restored/offline owners must still see their account and use the same password; Developer support login must remain unchanged.
- Result before fix: **FAIL**.

---

# Final Execution Report — `FINALCLEAN-37F3FDE0`

Evidence root:
`docs/remediation/evidence/FINAL-CLEAN-RUNTIME/FINALCLEAN-37F3FDE0/`.

## 1. Exact current lifecycle map

The detailed caller/IPC/service/SQLite/cloud/retry/restart table at the start of
this document remains authoritative. The proven terminal path is:

`startup hydrate -> live Google state at its explicit step -> exact licence
discovery/verification or V5 activation gate -> transactional SQLite activation
-> typed organization/branch/device -> exactly one Owner credential -> real
Main proof/session -> Cloud V2 awaited initialization -> operation sync ->
durable READY -> restart with a new Main session`.

Developer issuance remains:

`Developer password -> Main one-time proof -> __dev__ -> V5 generator lock ->
per-user LicenseAdmin shard/bundle/index -> 6-column activation row + 2-column
bundle row for the existing manual Sheets workflow`.

The sole source of operational truth is SQLite schema 9 with typed commands and
outbox. Renderer state is a projection; Google Drive is a remote publication and
recovery transport, not a replacement for the local transaction boundary.

## 2. Original versus current differences discovered

| Area | Original/intended behavior | Current final behavior | Verdict |
|---|---|---|---|
| Legacy issuance | Generate V5 locally and prepare Sheets rows. | Preserved; double-submit locked and UI says V5. | Required behavior preserved. |
| Sheets | Manual copy/persistence of prepared rows. | Still manual; no automatic append was invented. | Not a regression; remote Journey-05 remains unverified. |
| Setup persistence | Several direct/local projections. | Transactional typed SQLite Owner/device/branch with outbox. | Architecture retained and split authority fixed. |
| Owner restart | Existing credential existed but no Main session was bound. | Existing Owner signs in using the same password; no password recreation. | Fixed. |
| Activation publication | Gate plus two duplicate legacy uploads. | Gate is the single publication owner. | Fixed. |
| Packaged licence fixtures | Test bundles/shards were included and pre-auth readable. | Licence code/registries are allowlisted; `license/data` is absent. | Fixed as AUD-LIC-013. |

## 3. Real defects reproduced

Reproduced findings in this clean-runtime pass were `AUD-BOOT-007`,
`AUD-DAT-006`, `AUD-LIC-006` through `AUD-LIC-013`, `AUD-QLT-003` through
`AUD-QLT-005`, `AUD-UI-003`, `AUD-BOOT-008`, and `AUD-RST-004`. Each pre-change
reproduction, observed/expected behavior and boundary is recorded earlier in
this file. AUD-LIC-013 was additionally reproduced on the exact installed
`51C8FC0E` build before its packaging correction.

## 4. Root cause of each

- Runtime authorization was confused with credential existence.
- Setup success mixed typed entities with KV-only shadows.
- Generated registry bytes could drift and test mutation lacked a writable-root guard.
- UI success consulted stale global licence state.
- Awaited operational boundaries were missing or failures were swallowed.
- V5 issuance lacked an in-flight lock and reused activation-side effects.
- Activation publication had three owners and local consumption preceded a required remote result.
- READY was marked before durable completion.
- Discovery did not make sync pause/resume failures observable.
- Customer packaging used a broad `license/**/*` glob and exposed repository fixtures.

## 5. Exact files changed

Production files changed for the clean-runtime corrections include:

- `index.html`, `cupping-monthly-archive.js`, `cupping-sqlite-bridge.js`
- `cloud/activation-sync-defaults.js`, `cloud/boot-flow-ui.js`,
  `cloud/bootstrap.js`, `cloud/branch-enrollment.js`,
  `cloud/cloud-data-discovery.js`, `cloud/cloud-v2-init.js`,
  `cloud/db-bridge.js`, `cloud/license-activation-gate.js`,
  `cloud/license-cloud.js`, `cloud/setup-state-service.js`
- `database/entity-catalog.js`, `electron/database/service.js`,
  `electron/license-data.js`, `electron/main.js`
- `license/core/license-codec-v5.js`,
  `license/engine/license-engine-v2.js`,
  `license/engine/license-generator-v2.js`,
  `license/engine/license-validator-v2.js`, `license/license-router.js`,
  `license/ui/license-key-preview.js`, `license/ui/license-v2-drawer.js`
- `package.json` and the directly related tests/runtime evidence scripts.

Twenty-three critical production files matched the exact installed `app.asar`.
Electron Builder normalized the packaged `package.json`; its name, version,
Main entry and eight production dependencies matched the source manifest.

## 6. Why each change was necessary

Every production edit corresponds to a runtime reproduction: block stale/false
success, bind real authorization, make setup idempotent and typed, keep cloud
failure before local consumption, await service initialization, ensure one
publication owner, restore sync after discovery, prevent duplicate issuance,
and exclude runtime-readable test licence data. No UI redesign, new provider,
automatic Sheets feature, V5 removal, Developer-password change or architecture
reset was performed.

## 7. Tests performed

| Test | Result |
|---|---|
| Exact installed lifecycle/failure/restart | 28/28 PASS |
| Exact installed P0-A security/XSS/IPC/print/restart | 41/41 PASS |
| Exact installed SQLite/branch/lock/restart | 7/7 PASS |
| AUD-LIC-013 fresh-profile pre-auth read | `null`, PASS |
| Packaged `license/data` inventory | 0 entries, PASS |
| Registry canonical integrity | 6/6 PASS |
| Source-to-installed critical files | 23/23 MATCH |
| `npm run lint` | PASS |
| Full `npm test` | 127/129 groups; overall FAIL |
| Windows NSIS build/install | PASS / exit 0 |

The full-suite failures are `p0-e:licensing-production` and `license:test`.
They reject embedded Legacy V5 HMAC/signing/mutation capability. Those failures
were not changed because retaining in-app V5 generation is an explicit product
owner requirement.

## 8. Journey result table

| Journey | Result | Actual boundary and missing proof |
|---|---|---|
| JOURNEY-01 new customer to READY/restart | PARTIAL / UNVERIFIED REMOTE | Exact installed local setup, Owner, branch, device, sync gates, failure and restart passed; no fresh real Google/Sheets/Drive mutation on final bytes. |
| JOURNEY-02 existing customer/new device | UNVERIFIED | No actual second clean machine performed full remote licence/data pull, branch selection and recovery. |
| JOURNEY-03 add branch/second machine | UNVERIFIED | Branch isolation/capacity logic passed locally; real Owner cloud publication and second-machine read-back were not run. |
| JOURNEY-04 reinstall/restore/existing Owner | PARTIAL / UNVERIFIED REMOTE | Credential reuse/no recreation/restart passed; real Backup V2 cloud restore and login after reinstall were not run. |
| JOURNEY-05 Developer/V5/Sheets/customer consumption | PARTIAL / UNVERIFIED REMOTE | Exact installed Developer proof, single V5 generation, LicenseAdmin persistence and restart passed; real Sheets row persistence and customer consumption did not run. |
| JOURNEY-06 network interruption matrix | PARTIAL / UNVERIFIED REMOTE | Controlled local upload/commit/init/pause/resume/DB-lock failures passed; real network loss at every remote checkpoint did not run. |
| JOURNEY-07 repeated callbacks/retries | PARTIAL / UNVERIFIED REMOTE | Exact installed repeated callbacks and V5 double-submit produced no local duplicates; remote duplicate-artifact behavior was not exercised by mutation/read-back. |

No complete Journey is labelled PASS without its real remote execution.

## 9. SQLite before/after evidence

Before correction, setup could return success with zero typed device records and
KV-only Owner projections. Final installed runtime reports schema version 9,
`sqlitePrimary=true`, `integrity_check=ok`, quarantine 0, one typed fixture
Owner/device/branch under repeated setup, atomic data+outbox, scoped replace
preserving the other branch, cross-branch/raw-KV bypass denied, locked-database
rollback and identical restart state. Real live-profile counts were read-only
diagnostics and were not modified by this audit.

## 10. Google, Drive and Sheets evidence

An isolated copy of the live protected token store reported Google connected,
`needsReauth=false`, refresh credential present, 45 Drive items, one licence
candidate, one valid signature and one valid setup-activation verification.
No token, email, file ID or cloud data was written to evidence. This is read-only
module evidence; final-byte Drive upload/download, Sheets activation
consumption, duplicate remote artifact checks and Backup V2 recovery remain
UNVERIFIED. The product continues to prepare manual Sheets rows; it does not
claim automatic Sheets append.

## 11. Restart evidence

The exact installed EXE was restarted after typed setup, Owner credential,
Developer generation, injected failures and XSS persistence. Owner/branch/device
authority and the per-user V5 licence persisted without duplication; Main
sessions did not persist; proofless Developer bind stayed denied; SQLite
integrity remained `ok`; page, console and security errors were 0.

## 12. Failure-injection evidence

PASS boundaries: cloud-required activation upload failure left no consumed
local activation; durable completion failure blocked READY; discovery stop and
resume failures were explicit; Backup/Cloud V2 start failure returned failure
without unhandled rejection; verified licence pull commit failure stayed
failure; DB lock left neither data nor outbox; restart did not resurrect data.
Real network interruption after remote success but before local acknowledgement
was not safely executed and remains UNVERIFIED.

## 13. Remaining UNVERIFIED items

- Fresh real Google OAuth on the exact final installed bytes.
- Exact final Drive licence upload, read-back and duplicate-artifact inventory.
- Real Sheets row creation/lookup/consume/retry with a disposable activation.
- Full second-device and additional-branch remote journeys.
- Real Backup V2 upload, reinstall, restore, Owner login and data comparison.
- Real network interruption at every cloud checkpoint and post-remote/pre-local acknowledgement.
- Code-signing certificate behavior because the artifact is unsigned.

## 14. Remaining FAIL items

- `p0-e:licensing-production` and `license:test`: embedded Legacy V5 signing and
  licence-mutation capability is present by explicit product-owner decision.
- Authenticode: `NotSigned`.
- Therefore the mandatory commercial security/release gate remains NO-GO even
  though all executed functional installed-runtime checks pass.

## 15. Final recommendation

Use `FINALCLEAN-37F3FDE0` only for controlled acceptance/UAT. Do not label it a
commercial production release under the approved baseline. Commercial release
requires: a product decision that resolves the embedded V5 issuer conflict
without silently removing the requested workflow, a signed Windows artifact,
and successful execution of all seven real remote journeys with disposable
Google/Drive/Sheets data and read-back evidence. Current verdict:
**Production Candidate: NO; Ready for commercial release: NO; NO-GO**.

### AUD-DAT-006 — setup commits report success with split Owner/device authority

- Requirement: setup organization/device/Owner commits must populate the same typed SQLite entities that hydrate and sync use; no operational KV shadow may be the only copy.
- Reproduction: actual `electron/database/service.js` against isolated SQLite profile `prechange-device-1786457047257`, followed by read-only SQL.
- Observed: organization/device commit returned `ok:true`, wrote one `__tdw_device_config__` KV row, but wrote zero `__tdw_device_registry__` typed rows. Owner commit returned `ok:true`, wrote `__tdw_owner_profile__` and `__tdw_owner_setup__` KV rows, but zero corresponding typed rows. The catalog classifies all three as organization-scoped operational entities.
- Expected: one device-registry entity and typed Owner compatibility/setup projections in the same setup transaction/outbox; hydrate and sync read exactly those rows.
- Root cause: setup-specific trusted transactions bypass the typed command path for these three cataloged operational keys.
- Original behavior: legacy KV was the old authority; restoring it would violate P0-B.
- Minimal fix: transactionally upsert typed singleton records using deterministic setup command IDs; retain only explicit bootstrap compatibility reads during migration and remove shadows after verified conversion.
- Regression risk: existing installations may contain KV-only or dual copies; migration must prefer the valid authoritative user credential and remain idempotent.
- Result before fix: **FAIL**.

### AUD-LIC-006 — current package registry fails its own integrity check

- Requirement: the bundled license registries must verify before Developer generator use.
- Reproduction: actual Electron startup emitted `registry_tampered:package`; independent canonical SHA-256 verification of every registry found only `package-registry.json` invalid.
- Observed: stored signature `11d046...3608`; expected signature for the current bytes `3c1f0a...8559`. Generator engine cannot become ready.
- Expected: all six registries verify and the Developer drawer loads package choices without a warning/error.
- Root cause: package registry content/metadata was changed without regenerating its integrity signature.
- Original behavior: original package registry verifies; package business content is otherwise unchanged.
- Minimal fix: regenerate the bundled registry artifacts with the existing canonical generator, then runtime re-read them.
- Regression risk: generator output must retain the four customer packages and all existing V5 package/subscription/action behavior.
- Result before fix: **FAIL**.

### AUD-LIC-007 — failed activation can be displayed as valid due to stale license state

- Requirement: the activation button must report the result of the submitted key, not a pre-existing license state.
- Reproduction: actual Electron BootFlow with an existing valid local license; injected activation result `{ok:false,error:'forced_activation_failure'}` through the real UI button.
- Observed: the submitted activation failed, but the status became `✅ الترخيص صالح` with no error class because `hasValidLicense()` inspected the old license after the failed result.
- Expected: the submitted key failure is shown and the step does not claim activation success; the old license remains untouched and may be described separately.
- Root cause: `activateLicenseKey` calls `licCheck` and accepts any resulting valid state without first requiring `res.ok===true`.
- Original behavior: the legacy handler was tied to a different input and is not a safe reference.
- Minimal fix: fail immediately on a non-success router result; run commit/hydrate/validation only on the new successful result.
- Regression risk: automatic Drive discovery remains separate and must still accept a genuinely verified existing license.
- Result before fix: **FAIL**.

### AUD-QLT-003 — false startup timeout and swallowed post-activation failures

- Requirement: successful startup/setup has zero false warnings and every operational initialization failure is returned to BootFlow.
- Reproduction A: actual Electron startup; `applyPendingLicenseWipe` completed but the uncancelled timeout callback later emitted `startup timeout: applyPendingLicenseWipe`.
- Reproduction B: authenticated Owner session in actual Electron; `BackupLayer.start` injected to throw; `ActivationSyncDefaults.applyDefaults({startBackup:true})` still returned `{ok:true}`.
- Expected: completed tasks cancel their timeout; backup/sync/meta/scheduler failures return structured `{ok:false}` and prevent READY.
- Root cause: `withTimeout` uses `Promise.race` without clearing its timer; `ActivationSyncDefaults` contains empty catches, ignores structured failure results, does not await `maybeAutoEnableCloudV2`, `BackupLayer.start`, or scheduler configuration consistently.
- Original behavior: swallowing errors existed historically; it is incompatible with the explicit clean-runtime acceptance rule.
- Minimal fix: clear timeout in `finally`; use one awaited initialization sequence and propagate the first real operational error with its code.
- Regression risk: optional audit logging may remain best-effort, but sync/backup enablement cannot be treated as optional when requested by setup.
- Result before fix: **FAIL**.

### AUD-LIC-008 — double-submit creates two V5 licenses and the summary says V6

- Requirement: one intentional Generate action creates exactly one V5 license and the UI identifies the actual format.
- Reproduction: actual Electron with a real Main-issued Developer proof/session and isolated `LicenseAdmin` profile `prechange-generator-1786457358542`; the final Generate handler was invoked twice before the first promise resolved.
- Observed: two independent license shards and two activation bundles were durably written (`L000001` and `L000002`), while the drawer displayed only `L000002`. The copied summary started with `Hijama Management System V6` although the generated key was Legacy V5.
- Expected: the second click is ignored/disabled until the first completes; LicenseAdmin contains one license and one bundle; the summary says V5.
- Root cause: the drawer has no generation in-flight state and does not disable the final action while awaiting `CL.generator.generate`; summary text is hard-coded to V6.
- Original behavior: the original drawer labels this issuance path V5.
- Minimal fix: one drawer-owned promise/lock with disabled pending UI and `finally` release; derive the summary format from the actual generated key/schema.
- Regression risk: batch generation, retry after a real failure, cancel/close, and all package/action/subscription inputs must remain functional.
- Result before fix: **FAIL**.

### AUD-LIC-009 — Developer issuance overwrites the workstation's active license

- Requirement: generating a customer V5 license may persist the issuance artifact and Sheets rows, but must never activate that customer license on the Developer workstation.
- Reproduction: actual source Electron, isolated real SQLite profile `current-source-20260811`; the profile was seeded with a verified `CTR-PROD-TEST` license, one branch/device and one Owner. A real Main-issued Developer proof opened the generator and issued `L000001`, then Electron was closed and restarted.
- Observed: `LicenseAdmin` correctly contained one issued V5 license. In the first proof, `__tdw_cloud_license__` was replaced by the new customer's `NJR-CLINIC-*` document. After removing that explicit save, a second actual Electron proof showed `LicenseCloud.buildFromRecord` still changed `__tdw_meta__.centerId` through `CenterId.ensureCenterId`. In both cases `meta.authorityCenterId` remained `CTR-PROD-TEST`, so authority resolution returned conflicting centers and pre-auth hydration exposed zero users/device registry after restart.
- Expected: the issued customer license exists only in Developer issuance storage/output until a customer activation flow consumes it; the workstation's active license, Owner, branch, device and center remain unchanged across restart.
- Root cause: the issuance-only path reuses activation-oriented APIs: `license/engine/license-generator-v2.js:138-149` explicitly saved the document, while `cloud/license-cloud.js:67-70` uses stateful `CenterId.ensureCenterId` even when only building an export document. The original implementation contains both unsafe side effects.
- Original behavior: same defect; it is rejected because this audit validates actual production safety, not historical parity of a damaging side effect.
- Minimal fix: keep a pure `buildFromRecord` output in the returned generator result for export/Sheets use, but add an explicit non-persisting center-ID mode for issuance and remove activation-store mutation. Activation calls keep the existing stateful default. Do not change V5 key format, Developer login, LicenseAdmin persistence or UI.
- Regression risk: activation flow must still save a customer license after successful validation; only issuance-only generation is separated.
- Result before fix: **FAIL**.

### AUD-UI-003 — monthly-template delete action is rejected by the safe action runtime

- Requirement: the existing delete-template control must work through the safe action path and clean startup must not emit a security warning.
- Reproduction: both actual Electron launches in `current-source-20260811-r3` emitted `Blocked unsafe UI action action_argument_denied`; a diagnostic launch captured the rejected code as `MonthlyArchive.deleteTemplate(document.getElementById('ma-template-sel').value)`.
- Observed: safe action conversion refuses the live DOM expression, so the custom-template delete button receives no registered action.
- Expected: an allowlisted no-argument wrapper reads the current select value inside trusted application code and calls the existing delete implementation; no warning is emitted.
- Root cause: the legacy inline handler uses a non-literal expression that is intentionally rejected by `tdwActionLiteral`.
- Original behavior: direct inline JavaScript ran before the safe compiler; restoring unrestricted evaluation is prohibited.
- Minimal fix: add/export one narrow `deleteSelectedTemplate()` wrapper, allowlist it, and keep the same button/UI.
- Regression risk: built-in templates must remain undeletable and the existing confirmation/save logic must remain unchanged.
- Result before fix: **FAIL**.

### AUD-QLT-004 — unconfigured license-data mutation corrupts bundled registries

- Requirement: runtime issuance writes only to Main-configured per-user `LicenseAdmin`; bundled registry files are read-only fallback assets.
- Reproduction: the full `npm test` run finished 125/129 and left `package-registry.json` changed with an invalid signature. The failing P0-E security gate calls `appendPackageToRegistry({id:'X'})` before asserting that customer-runtime mutation is denied.
- Observed: because no writable root was configured in that process, the license-data module wrote the test package into the bundled source registry. The following actual Electron generator proof failed `registry_tampered:package`.
- Expected: every mutation function fails closed unless Main/offline tooling explicitly configures a non-root writable directory; read fallback may still use bundled assets.
- Root cause: `roots()` uses `writableRoot || BUNDLED_ROOT` for both reads and writes, with no mutation guard.
- Original behavior: direct bundled writes existed historically; packaged ASAR made some of them fail incidentally, but source/dev operation remained destructive.
- Minimal fix: central `requireWritableRoot()` guard on every license-data write/backup entry point. Main already configures `%APPDATA%/.../LicenseAdmin` before registering IPC.
- Regression risk: standalone offline tools that intentionally edit a checkout must configure their target explicitly; the in-app Developer generator remains unchanged.
- Result before fix: **FAIL**.

### AUD-LIC-010 — cloud-required activation commits locally before Drive publication

- Requirement: a cloud-required activation that reports failure must leave no local consumed state, or must return a durable, explicitly recoverable committed result. Unknown half-success is forbidden.
- Reproduction: actual Electron isolated profile `prefix-activation-upload-20260811`; real Owner/Main session and verified license; the real `LicenseActivationGate.commitActivation` ran with only `ensurePushedToDrive` replaced by a deterministic upload failure.
- Observed: result was `{ok:false,error:'injected_activation_upload_failure'}`, but a read through the actual DB bridge immediately returned `__tdw_license_activation_state__.consumed=true` with device/center/license identity.
- Expected: for cloud-required V5 activation, verified idempotent Drive publication completes before local consumption is committed. A failed upload leaves local consumption absent; retry may overwrite/read the same deterministic remote path.
- Root cause: `cloud/license-activation-gate.js:187-228` persists activation/license/meta/device before `:230-260` checks Drive. `cloud/license-cloud.js:144-172` also saves the candidate locally before upload success.
- Original behavior: local-first activation tolerated offline use; it conflicts with the current explicit Google-required first-activation contract.
- Minimal fix: compute/verify the immutable document, publish it idempotently when cloud is required, then commit local activation state and active-license/meta/device. Save the uploaded license locally only after successful remote response. Preserve the existing optional-offline behavior only where cloud is genuinely not required.
- Regression risk: a lost response after successful overwrite must be retryable at the same path; Sheets activation recovery must continue to recognize previously consumed rows.
- Result before fix: **FAIL**.

### AUD-BOOT-008 — READY marker survives a failed completion commit

- Requirement: the terminal setup action may set the boot-complete marker and proceed to restart only after every requested durable completion write succeeds.
- Reproduction: actual source Electron with isolated real SQLite profile `prefix-boot-durability-20260811-r2`; all setup invariants were made valid, then the actual `BootFlow.markBootComplete` path ran while `DB.set` deterministically threw `injected_boot_completion_persistence_failure`.
- Observed: the call escaped with an unhandled error and `localStorage.__tdw_boot_complete__` remained `1`. The safe audit write exposed the exception only after the UI marker had already been committed.
- Expected: the persistence error is returned as a normal failed completion result, the boot marker remains absent, READY/restart is blocked, and retry is safe.
- Root cause: `cloud/boot-flow-ui.js:361-366` writes the success marker before invoking the durable helper and does not await it. `cloud/setup-state-service.js:212-219` swallows both local and DB failures and returns no result. The terminal handler also calls the helper twice and marks completion before the final settings flush.
- Original behavior: the same local-first/best-effort completion pattern exists historically; it violates the clean-runtime failure contract.
- Minimal fix: make the existing completion helper awaited and result-bearing; write the marker only after the wizard persistence succeeds; call it once; move final settings persistence before completion; keep the same terminal button and restart UI.
- Regression risk: synchronous callers must await the now-asynchronous result; restart recovery must continue to derive readiness from committed license/Owner/device/sync state and must not loop.
- Result before fix: **FAIL**.

### AUD-RST-004 — discovery reports success after failing to resume sync

- Requirement: if discovery pauses an already-running SyncEngine, every success, error, timeout and cancel path must restore that running state or explicitly fail at the resume boundary.
- Reproduction: actual source Electron isolated profile `prefix-discovery-resume-20260811`; the real `CloudDataDiscovery.discoverAllSources` path observed a running engine, stopped it, completed its real local/cloud probes, then the controlled `SyncEngine.start` threw `injected_discovery_sync_resume_failure`.
- Additional reproduction: actual source Electron isolated profile `prefix-discovery-stop-20260811`; controlled `SyncEngine.stop` threw `injected_discovery_sync_stop_failure` while the engine remained running. Discovery still ran all probes and returned `{ok:true}`.
- Observed: discovery returned `{ok:true}` while the engine remained stopped. No error or retry instruction reached the caller.
- Expected: discovery returns `{ok:false,error:'injected_discovery_sync_resume_failure',discovery:<completed result>}` and leaves its lock clear; a retry may resume safely.
- Root cause: `cloud/cloud-data-discovery.js:45-55` catches and converts resume failure to `false`; callers in `finally` and cancel ignore that value, and the successful result has already been returned. The pause boundary at `:182-188` also swallows `stop` failure and does not verify that the engine actually stopped.
- Original behavior: sync/discovery coupling was historically best-effort; that is incompatible with the current mandatory continuous sync state.
- Minimal fix: make resume result structured; complete discovery, await/inspect resume before returning success; cancellation returns the resume result; keep discovery itself read-only and preserve the existing UI/cards.
- Regression risk: success/error/cancel paths must resume exactly once and never start an engine that was previously stopped.
- Result before fix: **FAIL**.

### AUD-QLT-005 — Cloud V2 initialization returns success with an unhandled service failure

- Requirement: Cloud V2 initialization may claim sync/backup are active only after the requested runtime services return successful results; rejected promises must be awaited and surfaced.
- Reproduction: actual source Electron isolated profile `prefix-cloud-v2-init-20260811`; the real `CloudV2.maybeAutoEnableCloudV2` path ran with all actual prerequisites and a controlled asynchronous `BackupLayer.start` rejection.
- Observed: the function returned `{ok:true,autoEnabled:true}`, emitted the active success path, and the renderer received an unhandled rejection `injected_cloud_v2_backup_start_failure`.
- Expected: `{ok:false,error:'injected_cloud_v2_backup_start_failure'}`, no success notification, no unhandled rejection, and setup remains before initial sync/READY.
- Root cause: `cloud/cloud-v2-init.js:66-90` starts several asynchronous operational services without awaiting them; `:160-173` treats the synchronous init return as final success and also hides a duplicate license upload.
- Original behavior: fire-and-forget service startup existed historically; it is rejected by this audit's clean-runtime contract.
- Minimal fix: make the existing init path awaited/result-bearing, await essential analyzer/sync/backup/bootstrap operations, collect only explicitly non-authoritative cache/audit outcomes, and make every caller await/check the result. Do not add another initializer.
- Regression risk: startup runs before user authentication, so it must not create a duplicate device or require a privileged touch when setup already committed the device registry.
- Result before fix: **FAIL**.

### AUD-LIC-011 — verified Drive pull reports success when local commit fails

- Requirement: license pull success requires the verified document to be committed and re-readable from the authoritative local store before entitlements/setup advance.
- Reproduction: actual source Electron isolated profile `prefix-license-pull-commit-20260811`; the real `CloudBootstrap.fetchLicenseFromDrive(...,{persist:true})` used a verified V6 document and a controlled `DB.set('__tdw_cloud_license__')` result `{ok:false,error:'injected_license_pull_commit_failure'}`.
- Observed: the function returned `{ok:true,fromDrive:true}` despite the failed authoritative write.
- Expected: the exact commit error is returned, the existing local license remains authoritative, and retry stays on license pull.
- Root cause: `cloud/bootstrap.js:120-158` calls synchronous `LicenseCloud.saveLocal`; `cloud/license-cloud.js:112-119` ignores the Promise returned by the SQLite-backed `DB.set`, then reports the input document as success. The subsequent meta write is also not awaited.
- Original behavior: localStorage setters were synchronous in the legacy architecture; the current SQLite bridge uses an asynchronous result contract.
- Minimal fix: reuse the existing awaited `LicenseCloud.saveLocalCommitted`, propagate its result, and remove the duplicate unawaited meta save from the pull path.
- Regression risk: manual pull and setup discovery must retain `persist:false` verification-only behavior and never overwrite a foreign organization.
- Result before fix: **FAIL**.

### AUD-LIC-012 — one V5 activation publishes the license three times

- Requirement: after the activation gate has performed the required verified Drive publication and local commit, downstream code must consume that result rather than rebuild/re-save/re-upload the same license.
- Reproduction: actual source Electron isolated profile `prefix-activation-duplicate-publication-20260811`; the actual V5 router executed with a generated V5 key, controlled valid validator/gate results, then deterministic failures on the two post-gate publication calls.
- Observed: the authoritative gate returned success, then `CloudV2.afterLicenseActivation` was called once and `LicenseCloud.ensurePushedToDrive` was called again. The router still returned `{ok:true}` but displayed a warning that activation succeeded while Drive upload failed.
- Expected: exactly one publication owned by `LicenseActivationGate.commitActivation`; after a successful gate result there are zero additional license publication calls and no contradictory warning.
- Root cause: `license/license-router.js:234-259` correctly invokes the gate, but `:265-294` invokes two legacy publication flows and overwrites `_lastActivationGateResult.drivePush` with their later outcomes. `CloudV2.afterLicenseActivation` also re-saves/re-signs the license.
- Original behavior: the extra publication layers accumulated during Cloud V2 migration; they are no longer required after the gate became the atomic activation boundary.
- Minimal fix: remove the two post-gate publication blocks and use the gate's returned `drivePush` as the sole result. Keep legacy license UI/meta finalization after the committed gate.
- Regression risk: generic V5 activation outside BootFlow still needs Cloud V2 enablement; startup/ActivationSyncDefaults provides that separately and must be checked independently.
- Result before fix: **FAIL**.

## 4. Verified baseline facts

- Live user profile Google provider: connected, refresh credential present, `needsReauth=false`.
- Live Drive read-only diagnostic: 45 items under the populated root, one license candidate, signature valid, setup activation verifier valid; no live data was changed.
- Live SQLite: `integrity_check=ok`, foreign-key violations `0`, one Owner, one typed device-registry entity, 9 acknowledged and 4 pending outbox events, 6 open conflicts, quarantine `0`.
- Live profile contains operational Owner KV shadows (`__tdw_owner_profile__`, `__tdw_owner_setup__`); the test profiles prove the setup commits create this split directly.
- Real Google mutation journeys, real second-device recovery, real Sheets consumption, and real Backup V2 restore are not yet run on the final bytes and remain **UNVERIFIED**.

## 5. Change boundary

Only the reproduced defects above are authorized for minimal correction. No UI redesign, new cloud provider, new Sheets-write feature, V5 removal, Developer-password change, SQLite architecture replacement, or P0-A/P0-B rewrite is authorized.

### AUD-LIC-013 — packaged test licence artifacts are readable before authentication

- Requirement: customer builds must not contain developer/test licence shards,
  activation bundles, customer fields or mock entitlement data. Runtime licence
  data must come only from the configured per-user `LicenseAdmin` root or the
  authenticated activation flow.
- Reproduction: exact installed EXE SHA prefix `51C8FC0E`, fresh isolated
  profile `packaged-fixture-prechange-51C8FC0E`, no authentication. The public
  preload call `license.readActivationBundle('L000001')` returned a bundled
  package `04` document containing a customer object, a bundle signature and a
  `mock-sig` feature signature. Inspection of the exact installed `app.asar`
  confirmed `license/data/activations/L000001.bundle.json`, `L999999`, `X` and
  their registry/backup companions were packaged.
- Observed: the customer installer exposes repository validation fixtures to
  pre-auth runtime and ships misleading commercial licence data.
- Expected: the installed `app.asar` contains no `license/data/**` artifacts;
  missing per-user bundles return `null` and the optional legacy data index is
  initialized empty without failed resource requests. Static registries under
  `license/registries/**` remain packaged and integrity-checked.
- Root cause: `package.json` includes `license/**/*` without excluding mutable
  repository fixture data. `electron/license-data.js` deliberately supports a
  bundled read fallback, making the packaging leak runtime-reachable.
- Original/current behavior: the fixtures predate this audit and were retained
  by older validation tooling. They are not required by the customer runtime;
  data-index loading already treats their absence as an empty optional state.
- Minimal fix: package licence code and registries through an explicit allowlist,
  exclude all `license/data`, initialize the unused optional legacy data-index
  projections empty, and add a packaging regression assertion. Keep source
  fixtures for existing source tests and keep the per-user `LicenseAdmin`
  workflow unchanged.
- Regression risk: Developer generation must still persist and re-read from the
  configured per-user root; exact installed V5 generation and restart must be
  rerun after rebuilding.
- Result before fix: **FAIL**.
