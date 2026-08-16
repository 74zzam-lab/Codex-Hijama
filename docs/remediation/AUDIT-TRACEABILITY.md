# Mandatory P0 Remediation Program and Audit Traceability

## Latest Proven Finding — Final Clean Runtime

| ID | Severity | Evidence source and line | Runtime impact | Root cause | Existing code paths | Files changed | Automated test | Installed EXE test | Migration impact | Result |
|---|---|---|---|---|---|---|---|---|---|---|
| AUD-LIC-013 | High | Exact installed EXE `51C8FC0E`, fresh unauthenticated profile `packaged-fixture-prechange-51C8FC0E`: `license.readActivationBundle('L000001')` returned package `04`, customer data, bundle signature and `mock-sig`; exact `app.asar` contained `license/data/**`. `package.json` build files include `license/**/*`; bundled fallback is in `electron/license-data.js:10-29,101-108`. | A customer build exposes repository test/customer licence artifacts before authentication and can present mock commercial data as a bundled activation candidate. | Mutable/test `license/data` was included by the broad licence packaging glob and is reachable through the bundled read fallback. | Preload public read -> Main `license:readActivationBundle` -> `license-data.readWithFallback` -> packaged `license/data/activations`. | NONE before remediation. | Packaging exclusion assertion required. | Exact installed fresh-profile absence/re-read required after rebuild. | None; per-user `LicenseAdmin` remains authoritative. | FAIL |

## Final Clean Runtime Result Supersession — `FINALCLEAN-37F3FDE0`

Historical FAIL rows below remain the pre-change baseline. The following table
is the current result and does not remove or reduce the original finding.

| ID | Current result | Exact runtime evidence | Files changed / migration |
|---|---|---|---|
| AUD-BOOT-007 | PASS | Installed lifecycle 28/28: Owner requires and obtains a real Main proof/session before sync; restart retest PASS. | `cloud/boot-flow-ui.js`, `index.html`; no credential rewrite. |
| AUD-DAT-006 | PASS | Installed repeated setup callbacks: exactly one Owner, branch and typed device; no operational setup KV shadows after restart. | `electron/database/service.js`, `database/entity-catalog.js`, setup callers; idempotent typed projection migration. |
| AUD-LIC-006 | PASS | Six generated registries validated and exact installed V5 generation succeeded. | Generated registry JSON; no data migration. |
| AUD-LIC-007 | PASS | Installed stale-valid-license failure injection remained failure. | `cloud/boot-flow-ui.js`; none. |
| AUD-QLT-003 | PASS | Installed Backup start failure propagated; zero page/console errors. | `index.html`, `cloud/activation-sync-defaults.js`; none. |
| AUD-LIC-008 | PASS | Installed double-submit generated/persisted one V5 licence and displayed V5. | `license/ui/license-v2-drawer.js`; none. |
| AUD-LIC-009 | PASS | Installed generator left workstation centre/Owner/device authority unchanged across restart. | `license/engine/license-generator-v2.js`, `cloud/license-cloud.js`; conflicted historical profiles still require verified recovery, not guessing. |
| AUD-UI-003 | PASS | Installed clean runtime emitted zero safe-action/security warnings. | `cupping-monthly-archive.js`; none. |
| AUD-QLT-004 | PASS | Writable root is mandatory; six registries stayed valid after the 129-group suite. | `electron/license-data.js`, test fixtures; none. |
| AUD-LIC-010 | PASS | Installed injected cloud-required upload failure left activation unconsumed. | `cloud/license-activation-gate.js`, `cloud/license-cloud.js`; half-committed historical records require reconciliation. |
| AUD-BOOT-008 | PASS | Installed durable completion failure blocked READY; restart stayed incomplete. | `cloud/setup-state-service.js`, `cloud/boot-flow-ui.js`; marker ordering only. |
| AUD-RST-004 | PASS | Installed discovery stop and resume failures were explicit. | `cloud/cloud-data-discovery.js`; none. |
| AUD-QLT-005 | PASS | Installed async Cloud V2 start failure returned failure with zero unhandled rejection. | `cloud/cloud-v2-init.js`, callers; none. |
| AUD-LIC-011 | PASS | Installed verified-pull local commit failure remained failure and preserved prior state. | `cloud/bootstrap.js`, `cloud/license-cloud.js`, `cloud/db-bridge.js`; none. |
| AUD-LIC-012 | PASS | Installed activation used one publication owner after the gate. | `license/license-router.js`; none. |
| AUD-LIC-013 | PASS | Exact installed `app.asar` has zero `license/data` entries; unauthenticated missing bundle returned `null`; installed V5 per-user persistence/restart PASS. | `package.json`, `license/engine/license-engine-v2.js`, `tests/baseline/test-phase12-build.js`; no user-data migration. |

Evidence root:
`docs/remediation/evidence/FINAL-CLEAN-RUNTIME/FINALCLEAN-37F3FDE0/`.

This supersession does **not** close the separate Legacy V5 embedded-signing
findings or the unexecuted real remote journeys. Overall commercial gate remains
**NO-GO**.

## Baseline Control

- Baseline: Final Independent Technical Review and Production Audit.
- Baseline date: 2026-08-05.
- Commercial release: **BLOCKED**.
- Production Candidate: **NO**.
- Ready for main: **NO**.
- Audit verdict: **NO-GO**.
- This document creates the remediation plan and traceability baseline only. No application code was changed while creating it.
- No feature work, UX polish, package redesign, Owner Hub redesign, or new reporting work is permitted while any Critical requirement is `FAIL` or `UNVERIFIED`.

## Developer Access Decision

The existing intentional developer-password login behavior must remain available with the same user-visible flow and password behavior requested by the product owner.

This exception does **not** authorize an unverified renderer to bind an Owner/Admin session by merely claiming `userId = "__dev__"`. Requirement `AUD-SEC-003` preserves the intended developer login while requiring the privileged session to be issued only after the existing developer-password flow has actually succeeded. The password, entry screen, and intended support capability are not to be removed or redesigned under this program.

## Status Rules

- `FAIL`: the defect is proven to exist or a mandatory acceptance criterion failed.
- `UNVERIFIED`: the behavior cannot yet be proven on an installed production-like EXE.
- `PASS`: allowed only after the automated test, Windows Setup EXE installation test, failure injection, restart, and retest all pass with retained evidence.
- Source inspection alone can never produce `PASS`.
- A finding row must never be deleted. Superseded findings remain in the table with a link to the replacement requirement.
- Severity must not be reduced without new evidence, reviewer identity, date, rationale, and approval recorded in the finding history.
- Every implementation commit or change set must list the Requirement IDs it addresses.
- `Files changed` starts as `NONE` and must be updated with exact paths after implementation.
- Test identifiers in this baseline are required test cases, not claims that the tests already exist.

## Required Execution Chain

Every phase follows this exact chain:

`INSPECT -> REPRODUCE -> ROOT CAUSE -> IMPLEMENT -> MIGRATE -> TEST -> BUILD WINDOWS SETUP EXE -> INSTALL -> RUN -> FAILURE INJECTION -> RESTART -> RETEST -> EVIDENCE`

No phase may begin implementation until the previous phase release gate is `PASS`. Inspection and test-design preparation for the next phase may occur, but no parallel architecture or parallel production data path may be introduced.

## Global Non-Negotiable Invariants

1. No new features.
2. No UI redesign unrelated to a verified blocker.
3. No second database, second repository architecture, or second sync protocol running as a production writer.
4. No guard may be disabled or weakened to make a test pass.
5. No test may be deleted or have its expected behavior changed to match a defect.
6. No mock-only test can satisfy an installed-runtime acceptance criterion.
7. No direct operational write from UI code to raw KV or localStorage.
8. The target write path is `UI -> typed service/repository -> SQLite transaction -> durable outbox`.
9. All migrations must be idempotent, restart-safe, backed up before mutation, and able to report every rejected or quarantined row.
10. Build evidence must identify the exact source revision, Setup EXE path, Setup EXE SHA-256, installation mode, Windows version, and test dataset.

---

# Phase P0-A — Security Boundary

## Phase Objective

Close code-execution, privilege-boundary, IPC authorization, OAuth callback, and print-window security defects without changing the visible product design or removing the intentional developer-password login.

## Traceability

| ID | Severity | Requirement / root cause | Evidence and existing code paths | Runtime impact | Files changed | Automated test | Installed EXE test | Migration impact | Baseline result |
|---|---|---|---|---|---|---|---|---|---|
| AUD-SEC-001 | Critical | Replace unsafe interpolation of stored/user-controlled values into HTML with one enforced escaping/safe-rendering path. Root cause: widespread raw template interpolation into `innerHTML` and inline handlers. | Original: `index.html:10137,10338,13261,14913,15068,22480,22517`. Remediation: `renderer/security/safe-render.js:15,34`; `index.html:8272,20311`. | Stored payload can execute when affected records are rendered. | `renderer/security/safe-render.js`; `index.html`; `cupping-action-menu.js`; `package.json`; `package-lock.json` | `tests/baseline/test-p0-a-security-boundary.js` (stored payload corpus and sanitizer enforcement). | `docs/remediation/evidence/P0-A/P0A-20260805-160250-97B2C694/RUNTIME-SCENARIOS.json`: installed first-run + persisted/restart corpus; execution count 0 across clients, users/employees, doctors, reports, Owner Hub. | No destructive data rewrite; existing strings render through the safe path. | PASS |
| AUD-SEC-002 | Critical | Remove the runtime dependency on `script-src 'unsafe-inline'`; hash only unavoidable fixed legacy bootstrap/handlers. | Original: `electron/security/window-policy.js:29-43`. Remediation: `electron/security/window-policy.js:81`; `renderer/security/safe-render.js:34`. | CSP no longer amplifies stored XSS into inline execution. | `electron/security/window-policy.js`; `renderer/security/safe-render.js`; `index.html` | `tests/baseline/test-p0-a-security-boundary.js` (CSP hash inventory and inline denial). | `docs/remediation/evidence/P0-A/P0A-20260805-160250-97B2C694/RUNTIME-SCENARIOS.json`: installed injected script and handler both blocked; legitimate developer login and page rendering passed. | None. | PASS |
| AUD-SEC-003 | Critical | Preserve intentional developer-password login while prohibiting a direct synthetic `__dev__` bind without trusted authentication proof. | Original bypass: former `electron/rbac-session.js:131-160`. Remediation: `electron/rbac-session.js:149,192,224`; `index.html:9990-9998,10169`; `electron/main.js:866-923`. | Renderer claims cannot mint developer privilege. | `electron/rbac-session.js`; `electron/security/password-auth.js`; `electron/security/auth-attempt-store.js`; `electron/main.js`; `electron/preload.js`; `index.html` | `tests/baseline/test-p0-a-security-boundary.js` (forged, one-time, sender-bound proof). | `docs/remediation/evidence/P0-A/P0A-20260805-160250-97B2C694/RUNTIME-SCENARIOS.json`: forged bind DENIED; existing developer password and UI flow PASS; restart retest PASS. | Ephemeral proof only; developer password/UX unchanged. | PASS |
| AUD-SEC-004 | Critical | IPC authorization is explicit deny-by-default for unknown channels. | Original fallback: former `electron/rbac-session.js:180-187`. Remediation: `electron/rbac-session.js:16,301-303`. | Forgotten/new IPC channels do not inherit access. | `electron/rbac-session.js`; `electron/preload.js` | `tests/baseline/test-p0-a-security-boundary.js` (preload/handler/policy inventory 100%; unknown denied). | `docs/remediation/evidence/P0-A/P0A-20260805-160250-97B2C694/RUNTIME-SCENARIOS.json`: no generic IPC surface in installed renderer; forged/unauthenticated paths denied. | None. | PASS |
| AUD-SEC-005 | Critical | `database:persistKv` applies an explicit key/domain authorization matrix. | Original: former `electron/main.js:874-876`. Remediation: `electron/rbac-session.js:151-169,343-367`; `electron/main.js:992-998`. | Low roles cannot overwrite users, settings, owner or license-sensitive KV. | `electron/rbac-session.js`; `electron/main.js` | `tests/baseline/test-p0-a-security-boundary.js` (role/key matrix). | `docs/remediation/evidence/P0-A/P0A-20260805-160250-97B2C694/RUNTIME-SCENARIOS.json`: installed reception writes to users/settings DENIED; data remained present after restart. | Key classification only; no row mutation. | PASS |
| AUD-SEC-006 | Critical | Assign explicit policy to every preload-exposed sensitive channel. | Original: `electron/preload.js:51-101`. Remediation inventory: `electron/rbac-session.js:16-139`. | Authenticated low roles cannot inherit forgotten backup/license/device/communication/cache/database operations. | `electron/rbac-session.js`; `electron/main.js`; `electron/preload.js` | `tests/baseline/test-p0-a-security-boundary.js` (100% preload -> handler -> explicit policy coverage). | `docs/remediation/evidence/P0-A/P0A-20260805-160250-97B2C694/RUNTIME-SCENARIOS.json`: installed EXE executed all 61 protected channels as unauthenticated, reception/no-permissions, and authenticated Owner; expected authorization result coverage 100%, unknown IPC DENIED. | None. | PASS |
| AUD-SEC-007 | Critical | Generic cloud upload requires authentication; the only public upload is a structurally validated activation artifact at a fixed remote path. | Original public upload: former `electron/rbac-session.js:79-82`. Remediation: `electron/rbac-session.js:43-45`; `electron/main.js:497-530`. | Pre-login code cannot select arbitrary Drive payload/path. | `electron/rbac-session.js`; `electron/main.js`; `electron/preload.js`; `cloud/drive-adapter.js`; `cloud/license-cloud.js`; `index.html` | `tests/baseline/test-p0-a-security-boundary.js` (policy and structural validation). | `docs/remediation/evidence/P0-A/P0A-20260805-160250-97B2C694/RUNTIME-SCENARIOS.json`: installed generic upload DENIED and invalid constrained path/payload DENIED before provider side effects. | Activation caller consolidated on constrained channel. | PASS |
| AUD-SEC-008 | High | OAuth uses random one-time state bound to PKCE and the exact callback path; missing/mismatched/replayed state is rejected. | Original: `electron/cloud-providers/oauth-loopback.js:15-40`. Remediation: `electron/cloud-providers/oauth-loopback.js:18,49,92`; `electron/cloud-providers/google-drive.js:162`. | Callback injection/session confusion is rejected. | `electron/cloud-providers/oauth-loopback.js`; `electron/cloud-providers/google-drive.js` | `tests/baseline/test-p0-a-security-boundary.js` (wrong, missing, correct, replay state against real loopback server). | Real installed Google consent success/tamper scenario was not completed; source/packaged logic is covered but cannot satisfy the installed acceptance criterion alone. | Ephemeral state only. | UNVERIFIED |
| AUD-SEC-009 | Critical | Print/preview surfaces sanitize hostile documents and run sandboxed with webSecurity and no unnecessary preload. | Original: `electron/devices.js:88-102,157-170,354`. Remediation: `electron/devices.js:87,96,157,166,352,360`; `index.html:8272,20311`; `electron/security/print-document.js`. | Stored print payloads cannot execute in child windows/preview. | `electron/security/print-document.js`; `electron/devices.js`; `index.html`; `electron/security/window-policy.js` | `tests/baseline/test-p0-a-security-boundary.js` (hostile print corpus/options/preview sandbox). | `docs/remediation/evidence/P0-A/P0A-20260805-160250-97B2C694/RUNTIME-SCENARIOS.json`: installed hostile preview, thermal and A4 child paths produced zero execution; native Windows Save-As generated a valid PDF from hostile input with zero payload execution. | Printer settings retained. | PASS |
| AUD-SEC-010 | High | Chromium permission requests/checks deny by default with an explicit empty allowlist. | Original: `electron/security/window-policy.js:10,101-105`. Remediation: `electron/security/window-policy.js:160-166`. | Future permissions do not become implicitly available. | `electron/security/window-policy.js` | `tests/baseline/test-p0-a-security-boundary.js` (known and unknown permission denial). | `docs/remediation/evidence/P0-A/P0A-20260805-160250-97B2C694/RUNTIME-SCENARIOS.json`: installed camera/microphone/geolocation/media acquisition denied. | None. | PASS |
| AUD-SEC-011 | High | Random per-user PBKDF2v2 salts, legacy upgrade-on-login and persistent throttling/lockout; governed developer support credential retained as hash only. | Original: `index.html:9485-9492,9658-9679`. Remediation: `electron/security/password-auth.js:50,167`; `index.html:9912,10019`. | Raises offline/brute-force cost without locking out restored legacy users. | `electron/security/password-auth.js`; `electron/security/auth-attempt-store.js`; `electron/main.js`; `index.html` | `tests/baseline/test-p0-a-security-boundary.js` (KDF/upgrade/lockout/restart). | `docs/remediation/evidence/P0-A/P0A-20260805-160250-97B2C694/RUNTIME-SCENARIOS.json`: installed legacy reception credential upgraded to random-salt v2; throttling survived restart; developer login still passed. | Lazy credential upgrade; plaintext never required for migration. | PASS |
| AUD-SEC-012 | High | Main owns session epoch invalidation; logout/termination awaits main session clear. | Original renderer-only epoch: `index.html:9806,27414`. Remediation: `electron/rbac-session.js:372-385`; `electron/main.js:924,997`; `index.html:9824,10237`. | Stale IPC sessions are cleared on changed authoritative users and are not restored from renderer storage after restart. | `electron/rbac-session.js`; `electron/main.js`; `index.html` | `tests/baseline/test-p0-a-security-boundary.js` (epoch mismatch, proof replay, clear). | `docs/remediation/evidence/P0-A/P0A-20260805-160250-97B2C694/RUNTIME-SCENARIOS.json`: logout/restart/no-session checks PASS; mandatory two-live-window reset scenario was not possible under the single-instance runtime. | Sessions are ephemeral. | UNVERIFIED |
| AUD-SEC-013 | Medium | OAuth token persistence fails closed without Electron safeStorage; deterministic path/platform key fallback removed. | Original: `electron/cloud-providers/token-store.js:19-45`. Remediation: `electron/cloud-providers/token-store.js:18-26`. | Stored refresh tokens are not recoverable from public path material. | `electron/cloud-providers/token-store.js`; `electron/cloud-providers/google-drive.js` | `tests/baseline/test-p0-a-security-boundary.js` (safeStorage available/unavailable and legacy fallback rejection). | Installed Windows safeStorage path passed; no Windows environment with unavailable DPAPI/safeStorage was available for installed proof. | Insecure legacy token envelopes are invalidated and require reconnect. | UNVERIFIED |
| AUD-SEC-014 | High | Communication queue and provider secrets use safeStorage envelopes, retention and result redaction; renderer settings/backups strip secrets. | Original: `electron/main.js:419-429,695`. Remediation: `electron/communication/queue.js:36,75`; `electron/security/secure-credential-vault.js:45`; `cupping-communication-gateway.js:66`. | Patient messages/phones and provider credentials are not plaintext at rest or in general settings. | `electron/communication/queue.js`; `electron/security/secure-credential-vault.js`; `electron/main.js`; `electron/preload.js`; `cupping-communication-gateway.js` | `tests/baseline/test-p0-a-security-boundary.js` (encryption/redaction/retention/exclusion). | `docs/remediation/evidence/P0-A/P0A-20260805-160250-97B2C694/RUNTIME-SCENARIOS.json`: installed send-fail-queue and vault files contained no plaintext secret, phone or message; restart passed. | Legacy plaintext queue migrates atomically when safeStorage exists, otherwise is removed and memory-only. | PASS |
| AUD-SEC-015 | Critical | **New proven finding during implementation:** every real Owner/Admin/user session bind, not only `__dev__`, previously trusted an existing renderer-claimed identity without proving its password. Require a sender-bound, one-time main authentication proof for all binds. | Reproduced against former `electron/rbac-session.js:bindSession`. Remediation: `electron/rbac-session.js:192-219,224-264`; `electron/main.js:874-923`. | A compromised renderer could otherwise claim a real privileged user ID/role. | `electron/rbac-session.js`; `electron/main.js`; `electron/preload.js`; `index.html` | `tests/baseline/test-p0-a-security-boundary.js` (forged real Owner, sender mismatch, one-time proof, epoch). | `docs/remediation/evidence/P0-A/P0A-20260805-160250-97B2C694/RUNTIME-SCENARIOS.json`: installed forged real Owner bind DENIED; authenticated user/developer paths PASS. | Ephemeral proof only. | PASS |
| AUD-SEC-016 | High | **New proven finding during implementation:** published `xlsx@0.18.5` has known prototype-pollution/ReDoS advisories; package the patched official SheetJS 0.20.3 artifact and eliminate production audit findings. | Original dependency: `package.json` / npm advisory result. Remediation: `package.json:251`; `package-lock.json:18,8371`; `vendor/xlsx-0.20.3.tgz` SHA-256 `8DC73FC3B00203E72D176E85B50938627C7B086E607C682E8D3C22C02BB99FE8`. | Malicious spreadsheet input could trigger dependency vulnerabilities. | `package.json`; `package-lock.json`; `vendor/xlsx-0.20.3.tgz` | `tests/baseline/test-p0-a-security-boundary.js`; `npm audit --omit=dev` = 0. | `SETUP-EXE.json` plus installed `app.asar` inventory confirms patched xlsx is packaged. | Dependency-only; no data migration. | PASS |

## P0-A Execution Result — P0A-20260805-160250-97B2C694

- Full suite: **108/108 PASS**.
- Installed Setup EXE: **PASS**, SHA-256 `97B2C694687B996A20772D24A3E5512A48696FBA7B7A0D31662D2A81873E16A5`.
- Installed runtime and restart: **39/39 PASS**.
- Protected IPC installed matrix: **61/61 channels, 3 authorization states PASS**.
- Native Windows Save-As PDF hostile-payload test: **PASS**.
- P0-A Critical FAIL: **0**.
- P0-A Critical UNVERIFIED: **0**.
- P0-A Gate: **UNVERIFIED**.
- P0-B started: **NO**.
- Evidence: `docs/remediation/evidence/P0-A/P0A-20260805-160250-97B2C694/`.

All Critical findings are PASS. The phase gate remains UNVERIFIED only because mandatory installed/environment evidence is still unavailable for `AUD-SEC-008`, `AUD-SEC-012`, and `AUD-SEC-013`. No severity was reduced and no open finding was deleted.

## P0-A Exit Gate

All `AUD-SEC-*` Critical requirements must be `PASS`; High findings may not be deferred if they enable the same exploit chain. Mandatory runtime assertions:

- Stored XSS payload cannot execute after restart.
- The existing developer-password login still works exactly as intended, but a forged `__dev__` bind fails.
- Every privileged preload channel has one explicit policy.
- Unknown channels are denied.
- Low-role users cannot write protected KV.
- OAuth state mismatch/replay is rejected.
- Print windows remain sandboxed and secure while thermal/A4/PDF flows work.

---

# Phase P0-B — Single Source of Truth and Branch Isolation

## Phase Objective

Establish the only operational write path as `UI -> typed service/repository -> SQLite transaction -> durable outbox`. Remove competing write authorities and make center/branch ownership enforceable in both schema and main-process services.

## Traceability

| ID | Severity | Requirement / root cause | Evidence and existing code paths | Runtime impact | Files changed | Automated test | Installed EXE test | Migration impact | Baseline result |
|---|---|---|---|---|---|---|---|---|---|
| AUD-DAT-001 | Critical | Eliminate divergence between lexical arrays, `window.*`, SQLite and localStorage. UI reads must come from one observable service state hydrated from SQLite. | Remediation: authoritative hydrate `electron/database/service.js:164`; observable publish/commit `cupping-sqlite-bridge.js:321-418`. | Restore/pull can update one copy while UI saves an older copy over it. | `electron/database/service.js`; `cupping-sqlite-bridge.js`; `cloud/repository.js`; `cloud/synced-write.js`; converted UI modules | `tests/baseline/test-p0-b-authority-branch-isolation.js`; full suite 109/109. | Installed GUI boot/restart plus installed service restart; `evidence/P0-B/P0B-20260810-082808-2BA138A5/`. | `MIG-P0B-001`; SQLite primary marker applied only after verified hydrate. | PASS |
| AUD-DAT-002 | Critical | Remove Repository's raw-localStorage unwrap/bypass for operational and security data. | `cloud/repository.js` adapter is bootstrap-only; runtime writes fail closed through `cloud/synced-write.js:50-86`. | Sync and restore bypass SQLite authority and transaction/outbox behavior. | `cloud/repository.js`; `cloud/synced-write.js`; `cloud/config-layer.js`; `cloud/operational-layer.js`; `cloud/record-merger.js` | P0-B static/runtime boundary and Cloud V2 integration tests. | Installed artifact rejected missing-authority and raw-operational paths; exact installed asar verified. | Included in `MIG-P0B-001`. | PASS |
| AUD-DAT-003 | Critical | Replace ambiguous synchronous `DB.set` contract with awaited typed commands returning a single result shape; no fire-and-forget persistence. | Typed command `electron/database/service.js:248`; awaited bridge `cupping-sqlite-bridge.js:321-418`; converted ledger/import/communication/reset/config callers. | False success/failure, race conditions and incomplete follow-up actions. | `electron/database/service.js`; `cupping-sqlite-bridge.js`; `cupping-system-enhancements.js`; `cupping-communication-gateway.js`; `cupping-drive-sync.js`; `cupping-import-wizard.js`; `cupping-employee-ledger.js`; `index.html` | P0-B gate plus full suite 109/109. | Installed locked-DB injection returned rollback and produced no row/outbox; restart retest PASS. | Call-site conversion; no destructive format rewrite. | PASS |
| AUD-DAT-004 | Critical | Remove direct operational UI writes to raw KV and restrict KV to explicitly non-operational preferences. | Main denial `electron/database/service.js:411`; catalog `database/entity-catalog.js`; static renderer scan in P0-B gate. | UI can bypass domain validation, branch scope, transactions and audit. | `database/entity-catalog.js`; `electron/database/service.js`; operational UI modules | P0-B gate scans production JS/HTML and tests all operational catalog keys. | Installed `persistKv('clientsRegistry')` DENIED; runtime KV contains no operational shadow keys. | Keys classified; legacy operational KV is migration input only. | PASS |
| AUD-DB-001 | Critical | Add non-null `center_id` and appropriate non-null `branch_id` ownership to every branch-owned operational/financial table; document organization-scoped exceptions. | Ownership migration and schema matrix `database/migrations/003_p0b_authority.js`; runtime status complete. | Cross-branch leakage cannot be prevented by database constraints. | `database/migrations/003_p0b_authority.js`; `database/repositories/index.js`; `database/entity-catalog.js` | All branch tables checked for non-null ownership; cross-scope triggers exercised. | Installed schema 6, FK check empty, quarantine 0. | `MIG-P0B-002` deterministic backfill/quarantine with pre-migration SQLite backup. | PASS |
| AUD-DB-002 | Critical | Add required uniqueness and integrity constraints, including scoped invoice numbers, usernames and payroll periods. | Scoped indexes/triggers `database/migrations/003_p0b_authority.js:233`; command transaction `electron/database/service.js:248-370`. | Duplicate invoices/users and cross-branch payroll collisions. | `database/migrations/003_p0b_authority.js`; `electron/database/service.js` | Duplicate invoice multi-record command proves full rollback and unchanged outbox. | Installed integrity/FK checks PASS; locked transaction rollback PASS. | Duplicate ambiguity is reported/quarantined; no silent deletion. | PASS |
| AUD-DB-003 | High | Consolidate runtime CRUD on the intended normalized tables or explicitly remove unused normalized tables after migration. Do not retain two authoritative representations. | Catalog maps every runtime entity to one normalized/schema/p0b repository; hydrate ignores operational KV shadows. | Parallel schema and JSON payload truths drift and mislead maintenance. | `database/entity-catalog.js`; `database/repositories/index.js`; `electron/database/service.js`; `cloud/repository.js` | Catalog/authority P0-B gate and full backup/restore suites PASS. | Installed runtime DB contained zero operational KV shadow rows. | Payload compatibility remains inside its single authoritative table row. | PASS |
| AUD-BR-001 | Critical | Stamp and validate center/branch ownership for doctors/employees, attendance, expenses, inventory, movements, cash drawer, payroll, commissions, invoices and attachments. | Entity catalog ownership plus service context stamping; strict branch table schema. | Records become organization-global and leak into reports or other branches. | `database/entity-catalog.js`; `database/repositories/index.js`; `electron/database/service.js`; `database/migrations/003_p0b_authority.js`; `database/scale-dataset.js` | Entity ownership/schema matrix and 100k/500k scale scenarios PASS. | Installed service wrote two isolated branches; cross-scope mutation DENIED. | `MIG-P0B-002`; ambiguous rows quarantine. | PASS |
| AUD-BR-002 | Critical | Replace scoped `replaceAll` writes with branch-safe record upsert/delete operations; never delete records merely because they are absent from a scoped payload. | Scoped replace transaction `electron/database/service.js:274-360`; renderer route `cupping-sqlite-bridge.js:321-418`. | Saving a branch subset can delete rows belonging to other branches. | `electron/database/service.js`; `cupping-sqlite-bridge.js`; `cupping-system-enhancements.js` | Branch A empty replacement preserves Branch B and publishes Branch A tombstone/outbox. | Installed Branch A replace preserved Branch B across service restart. | Branch-scoped delete events; no cross-branch deletion. | PASS |
| AUD-BR-003 | Critical | Enforce branch/center authorization inside `database:syncOp` and every main-process mutation, independent of renderer-provided source labels. | `electron/main.js:1098-1124`; `electron/database/service.js:518`; main-owned context checks. | Renderer can bypass branch checks through syncOp. | `electron/main.js`; `electron/database/service.js`; `electron/rbac-session.js` | P0-B gate and Phase 18 forged branch tests PASS. | Installed cross-branch sync enqueue DENIED. | None. | PASS |
| AUD-BR-004 | Critical | Trusted import/sync/migration source must be a main-owned capability, not caller-controlled `options.source`. | Main context overwrites record ownership; renderer source labels never set trusted context. | Renderer can label a write trusted and bypass guard logic. | `electron/main.js`; `electron/database/service.js`; `cloud/branch-scope.js`; `cloud/config-layer.js`; `cloud/operational-layer.js` | Forged `source='sync'/'import'` tests prove context remains authoritative. | Installed service stored forged-source record only in authenticated context branch; cross-branch attempt DENIED. | Migration runs in main-owned path. | PASS |
| AUD-BR-005 | High | Owner aggregate mode must be read-only at repository/IPC level, not only UI level; operational writes require one explicit write branch. | `electron/database/service.js:248-285` requires branch for branch-owned commands. | Aggregate view can accidentally write or replace multi-branch data. | `electron/database/service.js`; `electron/main.js`; `cloud/branch-contexts.js` | Aggregate write without explicit branch returns `write_branch_required`. | Installed branch command requires explicit branch; no aggregate mutation path. | None. | PASS |

## Required Migrations

### MIG-P0B-001 — Persistence Consolidation

- Create a pre-migration Backup V2 plus SQLite copy.
- Inventory every operational localStorage/KV/global table.
- Define deterministic precedence using revision/timestamp and flag ambiguous conflicts.
- Import once into SQLite in one restart-safe transaction series.
- Write a migration marker only after verification.
- Stop operational localStorage writes immediately after successful cutover.
- On failure, preserve the original database and localStorage untouched and emit a machine-readable report.

### MIG-P0B-002 — Center and Branch Ownership

- Add center/branch columns and indexes.
- Backfill only when identity is unambiguous from device lock, record provenance or single-branch license.
- Never silently assign ambiguous multi-branch records to `BR-MAIN`.
- Quarantine ambiguous rows and block release until the migration report is resolved.
- Add foreign keys/checks preventing cross-center and cross-branch references.

## P0-B Execution Result — P0B-20260810-082808-2BA138A5

- Full suite: **109/109 PASS**.
- P0-B automated authority gate: **11/11 PASS**.
- Windows Setup EXE: **PASS**, SHA-256 `2BA138A5E21E5246C6844F95D59614E419BDABD23B7353AF4533CB5709EA7926`.
- Installed `app.asar` exact build match: **PASS**.
- Installed-artifact runtime: **7/7 PASS**.
- Real installed GUI boot and restart: **PASS**.
- Locked SQLite failure injection: **PASS**; no partial data or outbox write.
- Runtime database: schema 6, SQLite primary, integrity `ok`, foreign-key violations 0, quarantine 0, operational KV shadows 0.
- P0-B Critical FAIL: **0**.
- P0-B Critical UNVERIFIED: **0**.
- P0-B Gate: **PASS**.
- Evidence: `docs/remediation/evidence/P0-B/P0B-20260810-082808-2BA138A5/`.

The installed BootFlow displayed diagnostic `TDW-ACT-license_timeout-MSMT2PLA`. Source tracing proves the discovery catch path currently labels every exception as `license_timeout`; the underlying cause is therefore **UNVERIFIED** and is carried into P0-C without changing the P0-B result.

## P0-B Exit Gate

- No operational localStorage writes.
- No renderer direct protected-KV writes.
- One awaited persistence contract.
- Every branch-owned record has enforced center/branch ownership.
- Scoped mutations cannot delete another branch's rows.
- `database:syncOp` and every mutation pass the same main-process authorization.
- Upgrade migration, forced interruption, restart and rerun are all idempotent and `PASS`.

---

# Phase P0-C — Setup Restore and Owner Credentials

## Phase Objective

Make clean-install and replacement-device recovery deterministic. A verified cloud backup must restore all intended data before local bootstrap data blocks it, and a previously changed Owner password must remain valid without being requested as a first-time password again.

## Traceability

| ID | Severity | Requirement / root cause | Evidence and existing code paths | Runtime impact | Files changed | Automated test | Installed EXE test | Migration impact | Baseline result |
|---|---|---|---|---|---|---|---|---|---|
| AUD-RST-001 | Critical | Setup restore emptiness gate must distinguish bootstrap/metadata rows from real user/business data and must support a safe replace transaction after explicit restore choice. | Original: `electron/backup-v2-ipc.js:353-363,504-514`. Remediation: semantic classifier in `electron/backup-v2-core.js`; both setup IPC routes use it. | Users/settings/device bootstrap rows block cloud restore. | `electron/backup-v2-core.js`; `electron/backup-v2-ipc.js` | `tests/baseline/test-p0-c-setup-restore-target.js` 6/6. | Not run; EXE build intentionally delegated to product owner. | Native Backup V2 retains verified staging, emergency backup and rollback; bootstrap-only target becomes replaceable. | UNVERIFIED |
| AUD-RST-002 | Critical | Discovery must not require a locally recovered `centerId` when the authorized Google account can enumerate candidate backup manifests; identity is validated before restore, not used to make discovery impossible. | Remediation: `electron/cloud-data-discovery.js` scans known global roots without center identity; restore still validates manifest identity. | A replacement device can enumerate candidates before recovering center identity. | `electron/cloud-data-discovery.js` | `tests/baseline/test-p0-c-discovery-integrity.js` 6/6. | Not run; real installed Drive restore remains required. | None; discovery only. | UNVERIFIED |
| AUD-RST-003 | Critical | Implement complete paginated discovery with deterministic newest selection, bounded retry/backoff and explicit `truncated` failure; never treat a partial scan as “not found”. | Remediation: bounded full pagination/retry and explicit partial/truncated states in `electron/cloud-data-discovery.js`; BootFlow refuses partial candidates. | Partial Drive inventory can no longer be presented as complete/ready. | `electron/cloud-data-discovery.js`; `cloud/boot-flow-ui.js` | `tests/baseline/test-p0-c-discovery-integrity.js`; `tests/baseline/test-p0-c-restore-truth-and-boot-gate.js`. | Not run; real inventory above page threshold remains required. | None. | UNVERIFIED |
| AUD-RST-004 | Critical | Discovery must pause/resume sync transactionally or avoid stopping it; every exit path restores prior running state. | Actual Electron controlled failures `.codex-validation/final-clean-runtime/prefix-discovery-resume-20260811/FINAL-CLEAN-RUNTIME.json` and `prefix-discovery-stop-20260811/FINAL-CLEAN-RUNTIME.json`: discovery returned `ok:true` after either `SyncEngine.start` or `SyncEngine.stop` threw. Existing pause/resume boundaries are at `cloud/cloud-data-discovery.js:45-55,182-188,304-310,684-690`. | A normal data-source scan can silently disable synchronization or scan concurrently with active sync. | `cloud/cloud-data-discovery.js` | Existing mock success/error/cancel suite passed but missed pause/resume failures; actual-runtime regression required. | UNVERIFIED. | None. | FAIL |
| AUD-RST-005 | Critical | Label sync checkpoints distinctly and never emit checksum/SQLite-integrity/atomic-swap progress unless those operations actually ran. Only Backup V2 may be presented as full verified disaster restore. | Remediation: distinct `BACKUP_V2_RESTORE_STAGES` and `CHECKPOINT_RESTORE_STAGES`; native stages require returned main-process proof. | Checkpoint UI no longer claims disaster-restore guarantees. | `cloud/cloud-data-discovery.js` | `tests/baseline/test-p0-c-restore-truth-and-boot-gate.js` 10/10. | Not run; installed interruption scenarios required. | No data migration. | UNVERIFIED |
| AUD-RST-006 | Critical | BootFlow must await and propagate every downstream bootstrap/sync result; READY is impossible after `{ok:false}`, partial pull or unresolved owner state. | Remediation: `runInitialSyncPipeline` and strict restore safety/hydrate/reconcile checks. | Every covered failure persists `syncDone=false`; Owner remains a hard prerequisite. | `cloud/boot-flow-ui.js`; `cloud/cloud-data-discovery.js` | `tests/baseline/test-p0-c-restore-truth-and-boot-gate.js`. | Not run; installed network-failure/restart matrix required. | Existing wizard state reused; failed states are corrected to false. | UNVERIFIED |
| AUD-AUTH-001 | Critical | Forced Owner password change must await the authoritative commit before success/failure and before credential revision, OwnerProfile compatibility and sync scheduling. | Remediation: immutable pending user, one awaited authoritative users/outbox transaction, renderer publish after success. | Failed commit leaves password/revision/renderer state unchanged. | `index.html`; `electron/database/service.js` | `tests/baseline/test-p0-c-setup-activation.js` 11/11. | Not run; installed immediate restart/login required. | Uses P0-B typed users transaction and durable outbox. | UNVERIFIED |
| AUD-AUTH-002 | Critical | Password and role must participate in conflict detection; higher `credentialRevision`/valid newer credential wins deterministically and protected fields cannot be overwritten by stale local data. | Remediation: dedicated credential decision in `cloud/table-merge-policy.js`; duplicate pre-merge logic removed from ConfigLayer. | Stale seed cannot overwrite a real credential; equal-revision/different-hash becomes explicit conflict. | `cloud/table-merge-policy.js`; `cloud/config-layer.js` | `tests/baseline/test-p0-c-owner-credential-merge.js` 6/6. | Not run; real Device A/B required. | Credential revision is normalized; ambiguity blocks instead of guessing. | UNVERIFIED |
| AUD-AUTH-003 | Critical | Credential revision publication and data publication must be atomic/idempotent; Device B must not observe users without the corresponding credential revision. | The users Drive object carries hash+credentialRevision together; failed version publication returns failure and leaves the durable outbox retryable. | A data upload followed by version failure cannot be acknowledged; duplicate retry is byte-equivalent for credential payload. | `cloud/sync-engine.js`; `index.html` | `tests/baseline/test-p0-c-credential-publication.js` 2/2; outbox tests pass. | Not run; Device A/B failure injection remains required. | Full per-record CAS remains P0-D; credential payload itself is indivisible. | UNVERIFIED |
| AUD-AUTH-004 | Critical | Once a non-seed Owner credential is restored, seed flags/default hashes must not recur and setup must never request first-time password change again. | Preauth hydrate exposes `hasUsableCredential`; setup Owner commit clears seed flags; merge policy preserves higher non-seed revision. | Restored usable Owner suppresses first-password setup and stale seed recurrence in automated cycles. | `electron/database/service.js`; `cloud/owner-management.js`; `cloud/boot-flow-ui.js`; `cloud/setup-state-service.js`; `cloud/table-merge-policy.js` | `tests/baseline/test-p0-c-setup-activation.js`; `tests/baseline/test-p0-c-owner-credential-merge.js`. | Not run; three installed reinstall/restart cycles required. | Seed markers clear only with a portable authoritative credential. | UNVERIFIED |
| AUD-AUTH-005 | High | Consolidate users and OwnerProfile credentials into one authoritative credential record; any compatibility projection must be derived, not separately writable. | Schema v2 OwnerProfile delegates auth to main users credential and stores `passwordHash:null`; ConfigLayer derives remote projection from authoritative Owner. | OwnerProfile cannot independently authenticate with a divergent password in v2. | `cloud/owner-profile.js`; `cloud/config-layer.js`; `electron/database/service.js` | `tests/baseline/test-p0-c-owner-credential-merge.js`; setup activation suite. | Not run; installed recovery/change/transfer required. | `MIG-P0C-001` projection migration is applied during setup/restore paths; legacy ambiguity requires recovery. | UNVERIFIED |
| AUD-BOOT-001 | High | Consolidate BootFlow and `cupping-first-run.js` into one setup state machine; only one component may seed/configure production data. | BootFlow/SetupStateService remains automatic; FirstRun is manual-only (`forceWizard`) and maps unified completion. | A completed BootFlow cannot trigger a second automatic setup wizard. | `cupping-first-run.js`; `cloud/boot-flow-ui.js` | `tests/baseline/test-p0-c-restore-truth-and-boot-gate.js`. | Not run; installed fresh/restored wizard count required. | Existing FirstRun flag is mapped in memory; no destructive migration. | UNVERIFIED |
| AUD-BOOT-002 | High | Define an explicit supported offline/local mode or an explicit cloud-required product rule; BootFlow must not silently mix the two. Current READY requires Google despite local facilities. | Explicit runtime policy: cloud required for initial setup; established verified installations may start offline. | Connectivity expectations are deterministic rather than inferred from conflicting UI. | `cloud/boot-flow-ui.js` | Policy assertions in `tests/baseline/test-p0-c-restore-truth-and-boot-gate.js`. | Not run; installed offline restart required. | None. | UNVERIFIED |
| AUD-BOOT-003 | High | Correct initial direction semantics: choosing local existing data must not trigger an unexplained pull that overwrites it; user choice must map to an explicit verified operation. | Choice mapping: empty=push, cloud=pull, local/file/existing=pre-verified reconciliation; local paths never call device bootstrap hydrate. | Local choice cannot silently enter cloud hydrate/overwrite path. | `cloud/boot-flow-ui.js` | Choice matrix and no-hydrate runtime test in `tests/baseline/test-p0-c-restore-truth-and-boot-gate.js`. | Not run; installed isolated datasets required. | None. | UNVERIFIED |
| AUD-BOOT-004 | Critical | **New proven finding during P0-C:** verified Drive license download was followed by protected generic pre-auth KV/settings writes, then downstream exceptions were mislabeled or hidden as `license_timeout`/`unknown`. Add narrow main-owned setup activation/Owner transactions and preserve the actual error. | Reproduced on the installed profile: `rbac:getSession` returned the truthy envelope `{ok:false,error:'no_session'}`; `license-legacy-bridge.js` treated it as an authenticated session and skipped `database:setupCommitActivation`. Google status, full listing, signature/identity/expiry verification and the activation SQLite transaction on a copied database all PASS. Remediation unwraps only a real session, invokes the narrow setup commit, and maps setup persistence failures without `unknown`. | A clean installation could find a valid license but fail to persist it, making cloud restore/setup impossible while blaming the network or returning an unhelpful error. | `electron/setup-activation.js`; `electron/main.js`; `electron/preload.js`; `electron/rbac-session.js`; `electron/database/service.js`; `cloud/license-legacy-bridge.js`; `cupping-sqlite-bridge.js`; `cloud/boot-flow-ui.js`; `cloud/activation-errors.js` | `tests/baseline/test-p0-c-setup-activation.js` 12/12; `test-v2-5-8-auth-activation-ui.js` PASS; real Drive exact-verifier and copied-database transaction diagnostics PASS. | New installed build not run; remains required. | One transaction commits only verified activation/bootstrap Owner records; generic protected writes remain denied. | UNVERIFIED |
| AUD-BOOT-005 | Critical | **New proven finding during final installed setup:** after the required setup restart, the Main process still owned a valid Google OAuth token but Renderer settings could retain `connected:false` or `userDisconnected:true` because the pre-auth generic settings write was not authoritative. Initial sync evaluated the stale Renderer cache first, returned `activation_incomplete`, and consequently reported both `google_not_connected` and `cloud_v2_disabled`. Reconcile trusted Main OAuth state before applying activation defaults; status refresh must never delete a newly connected token because of stale Renderer state. | Runtime reproduction screenshot diagnostic `TDW-ACT-activation_incomplete-*`; original paths `cloud/boot-flow-ui.js:221`, `cloud/activation-sync-defaults.js:52`, `cloud/drive-adapter.js:22`, `index.html:18830`. Remediation performs a BootFlow-gated live reconnect recovery only after the Google step was explicitly completed, persists it after Owner/session binding, then enables Cloud V2. Setup disconnect rewinds the wizard and clears downstream completion. | A correctly authenticated customer reaches initial sync but cannot finish setup; retrying cannot enable Cloud V2 and may discard the live token. | `cloud/boot-flow-ui.js`; `cloud/activation-sync-defaults.js`; `cloud/drive-adapter.js`; `index.html`; `tests/baseline/test-p0-c-google-state-recovery.js`; `tests/baseline/test-p0-c-restore-truth-and-boot-gate.js`; `tests/run-all.js` | `test-p0-c-google-state-recovery.js` 3/3 PASS; P0-C restore/Boot gate 10/10 PASS; full suite 124/124 PASS; lint PASS. | Exact post-fix EXE has not yet been built/installed; real Google restart/retry remains required. | Existing settings are normalized from the Main token only inside an explicitly completed BootFlow Google path; no token or business-data migration. | UNVERIFIED |

## P0-C Source Remediation Result — 2026-08-10

- P0-C focused automated suites: **PASS** — discovery 6/6, setup activation 11/11, setup restore target 6/6, restore/Boot gate 10/10, credential merge 6/6, credential publication 2/2.
- Cross-regression: P0-A 47 checks PASS; P0-B 11/11 PASS; durable outbox/dual-device, conflict resolution, setup state and Owner state PASS.
- Baseline source tests: **88/90 PASS**; the remaining two (`test-v2-5-10-setupstate-runtime-proof.js`, `test-v2-5-7-production-release.js`) exceeded the runtime timeout and are **UNVERIFIED**, not failed assertions.
- Real Drive diagnostic against the installed P0-B environment: Google connected, Drive inventory returned 29 items, the unique license downloaded and signature verified; this proved the displayed `license_timeout` diagnosis was false.
- Windows Setup EXE: **NOT BUILT by request of the product owner**; build and installed-runtime evidence are delegated.
- P0-C Critical source findings with an automated failing assertion: **0**.
- P0-C Critical installed-runtime status: **UNVERIFIED**.
- P0-C Gate: **UNVERIFIED**.
- P0-D started: **NO**.

The source is packaged as a P0-C ZIP for owner-side build. No P0-C row is marked PASS until the exact ZIP is built, installed, failure-injected, restarted and retested on Windows with retained evidence.

## Required Migration

### MIG-P0C-001 — Owner Credential Consolidation

- Preserve current successful Owner password hashes and revisions.
- Select the authoritative credential using verified revision rules.
- Reject ambiguous equal-revision/different-hash states for explicit recovery; never silently choose seed/local.
- Derive compatibility OwnerProfile data from the authoritative record.
- Clear seed flags only after successful credential validation.
- Invalidate old sessions after commit.

## P0-C Exit Gate

- Clean installed EXE can discover and restore a real cloud Backup V2 without local center identity.
- Metadata/bootstrap rows do not block recovery.
- Partial discovery is never represented as complete/not-found.
- Sync resumes after discovery on success, failure, cancellation and timeout.
- READY cannot be reached after any failed restore/bootstrap result.
- Restored Owner logs in with the previously configured password and is never asked to initialize it again.
- Device B receives credential revision under failure injection and restart.

---

# Phase P0-D — Synchronization Consistency

## Phase Objective

Stop full-table last-write-wins and implement a single production synchronization protocol using record operations, durable payloads, idempotency, revisions, deletion tombstones and conditional publication.

## Traceability

| ID | Severity | Requirement / root cause | Evidence and existing code paths | Runtime impact | Files changed | Automated test | Installed EXE test | Migration impact | Baseline result |
|---|---|---|---|---|---|---|---|---|---|
| AUD-SYN-001 | Critical | Replace full-table JSON overwrite with per-record mutation publication. | `cloud/sync-engine.js:183-260`. | Concurrent devices overwrite unrelated or newer records. | NONE | `AT-SYN-001` concurrent different-record and same-record writes. | `EXE-SYN-001` real Device A/B concurrent write matrix. | `MIG-P0D-001` protocol/version conversion. | FAIL |
| AUD-SYN-002 | Critical | Every record operation requires immutable operation ID, entity ID, center/branch, base revision, new revision, device ID and timestamp. | Current exported table snapshots and outbox. | Duplicate delivery and restart cannot be safely distinguished. | NONE | `AT-SYN-002` uniqueness/replay/restart property tests. | `EXE-SYN-002` duplicate operation delivery after forced process termination. | Outbox schema migration. | FAIL |
| AUD-SYN-003 | Critical | Durable outbox must publish its stored immutable payload, not read and upload current table state. | `cloud/sync-engine.js:507-524`. | The queued operation's original meaning is lost. | NONE | `AT-SYN-003` mutate table after enqueue; drain still publishes original event. | `EXE-SYN-003` offline edits, restart, reconnect in exact order. | Outbox rows need payload/version fields and compatibility reader. | FAIL |
| AUD-SYN-004 | Critical | Use CAS/ETag or an equivalent conditional revision rule for remote mutation/index writes; stale writers must receive conflict, never overwrite. | Drive uploads use `overwrite:true` at `cloud/sync-engine.js:220-255`. | Last writer silently destroys newer remote state. | NONE | `AT-SYN-004` stale ETag/base revision rejected. | `EXE-SYN-004` simultaneous A/B publication to real provider. | Remote protocol metadata. | FAIL |
| AUD-SYN-005 | Critical | Represent deletion with durable tombstones carrying revision and retention; never infer deletion from absence in a scoped/full list. | Current full-table snapshots and `replaceAll`. | Deleted records reappear or unrelated records are removed. | NONE | `AT-SYN-005` delete/update and delete/offline conflicts. | `EXE-SYN-005` A deletes while B edits offline; deterministic policy and audit. | Tombstone table/records and retention policy. | FAIL |
| AUD-SYN-006 | Critical | Publish data mutation and discoverable version/index state as one recoverable protocol step; failed index publication must retain/retry the exact operation. | Unchecked versions upload `cloud/sync-engine.js:270-274`. | Data exists remotely but peers never discover it. | NONE | `AT-SYN-006` failpoint between data and version publication. | `EXE-SYN-006` network cut after data upload; restart completes publication exactly once. | Protocol journal/commit marker. | FAIL |
| AUD-SYN-007 | High | Replace one branch-wide `databaseVersion` trigger with per-entity/per-record cursors or equivalent incremental discovery. | `cloud/sync-engine.js:357-415`. | One change causes all operational tables to download and merge. | NONE | `AT-SYN-007` one-record change downloads only required operations. | `EXE-SYN-007` large dataset bandwidth/runtime evidence. | Cursor/checkpoint format migration. | FAIL |
| AUD-SYN-008 | Critical | Define deterministic conflict policy per entity and field, including protected user credentials; conflicts must not pause unrelated entities/branches. | Conflict and table merge paths. | One conflict can block synchronization and produce unsafe generic merges. | NONE | `AT-SYN-008` matrix for users, invoices, visits, attendance, inventory and deletes. | `EXE-SYN-008` injected conflicts while unrelated operations continue. | Conflict record store. | FAIL |
| AUD-SYN-009 | Critical | Only the new protocol may be a production writer; disable/remove Legacy Drive sync writer after verified migration, without adding a parallel architecture. | `cupping-drive-sync.js` loaded at `index.html:27273`; Cloud V2 flags. | Old and new timers can race and overwrite each other. | NONE | `AT-SYN-009` exactly one writer/timer registered. | `EXE-SYN-009` upgrade from legacy flags; only one protocol writes after restart. | One-time legacy state import and disable marker. | FAIL |
| AUD-SYN-010 | High | Include disabled users and required identity references in configuration sync while preserving disabled status; do not silently drop them. | `cloud/settings-split.js:76-98`. | Audit/history references and credentials can disappear from restored configuration. | NONE | `AT-SYN-010` active/disabled/deleted user matrix. | `EXE-SYN-010` disable user on A, sync/restore B, historical references preserved and login denied. | Config pack version migration. | FAIL |
| AUD-SYN-011 | High | Replace fixed aggressive polling with bounded backoff/jitter and provider quota/error handling while maintaining acceptable recovery latency. | Poll default around `index.html:18199,18695`; SyncEngine polling. | Drive quota, battery/network load and synchronized retry storms. | NONE | `AT-SYN-011` backoff, jitter, quota and recovery tests. | `EXE-SYN-011` provider 429/5xx/network interruption. | Sync settings versioning. | FAIL |

## Required Migration

### MIG-P0D-001 — Sync Protocol Cutover

- Version every operation and remote protocol document.
- Snapshot/backup before cutover.
- Convert pending legacy outbox rows without dropping payload intent; rows without enough intent must trigger a safe full reconciliation before new writes.
- Use a bounded read-old/import-once window, then one write-new protocol only.
- Never run old and new writers simultaneously.
- Maintain a cutover marker and a recoverable journal so restart at any point resumes safely.

## Mandatory Device A/B Matrix

1. A and B update different records concurrently.
2. A and B update the same field from the same base revision.
3. A updates while B deletes.
4. B remains offline through multiple edits and reconnects.
5. Process stops after outbox commit but before upload.
6. Process stops after data upload but before version publication.
7. Same operation is delivered twice.
8. Remote returns stale ETag/conflict.
9. Provider returns 429, 5xx and timeout.
10. Restart both devices and compare SQLite rows, revisions, tombstones and audit events.

## P0-D Exit Gate

- No full-table production overwrite.
- No last-write-wins without an explicit documented conflict decision.
- Duplicate delivery is idempotent.
- Delete/update conflicts are deterministic.
- Outbox retains the real payload.
- Failed version publication recovers after restart.
- Legacy writer is not active.
- Real installed Device A/B evidence is retained and `PASS`.

---

# Phase P0-E — Financial Atomicity, Reporting Correctness, Backup Secret and Licensing

## Phase Objective

Make financial writes and identifiers atomic, make financial reports branch-correct and preview/print-consistent, replace non-production licensing material, and remove the predictable Backup V2 secret.

## Traceability

| ID | Severity | Requirement / root cause | Evidence and existing code paths | Runtime impact | Files changed | Automated test | Installed EXE test | Migration impact | Baseline result |
|---|---|---|---|---|---|---|---|---|---|
| AUD-FIN-001 | Critical | Save visit/case, invoice/payment, inventory movement, cash movement, audit and ledger effect in one SQLite transaction plus outbox. | Sequential flow `index.html:14529-14564`. | Partial failure leaves clinical, stock and financial data inconsistent. | NONE | `AT-FIN-001` failpoint after every transaction step asserts full rollback. | `EXE-FIN-001` disk/error/process failure injection and restart. | `MIG-P0E-001` map existing visit/invoice/payment effects and report inconsistencies. | FAIL |
| AUD-FIN-002 | Critical | Replace in-memory invoice counter with database-backed atomic scoped sequence and unique constraint. | `index.html:14278-14282`; no unique constraint `database/migrations/001_initial.js:78-88`. | Concurrent devices/processes can issue duplicate invoice numbers. | NONE | `AT-FIN-002` parallel allocation and rollback tests. | `EXE-FIN-002` Device A/B concurrent invoice creation. | Resolve/report existing duplicates; never renumber silently. | FAIL |
| AUD-FIN-003 | Critical | Enforce payment invariants: authorized payment components, currency conversion, change and totals must reconcile within a defined rounding tolerance. | Case/payment calculations in `index.html`; current defaults can infer cash. | Incorrect cash/card/bank/VAT totals and reports. | NONE | `AT-FIN-003` property-based amount/rounding/payment-method matrix. | `EXE-FIN-003` real forms, receipt, report and restart comparison. | Audit legacy inconsistencies; do not silently rewrite closed records. | FAIL |
| AUD-FIN-004 | High | Replace destructive financial/customer deletion with authorized void/reversal semantics and preserve audit/attachments/references. | Customer bulk deletion and related multi-`DB.set` paths. | Orphan data and financial history deletion. | NONE | `AT-FIN-004` reversal/reference-integrity tests. | `EXE-FIN-004` void/delete workflow and post-restore audit. | Existing deletion markers/history review. | FAIL |
| AUD-FIN-005 | Critical | Cash drawer, inventory, budgets, overtime, payroll and ledger records must be branch-owned and transactionally linked to source operations. | `cupping-ext-modules.js:178-182,523-585,1214-1227`; global KV records. | Cash/stock/payroll can mix branches and diverge from invoices. | NONE | `AT-FIN-005` branch ownership and source-reference matrix. | `EXE-FIN-005` two-branch close/reconcile/payroll test. | Included in P0-B/P0-E migrations. | FAIL |
| AUD-FIN-006 | Critical | Consolidate Payroll and EmployeeLedger into one authoritative posting/finalization model; finalized pay runs are immutable and corrections are explicit adjustments. | Live payroll calculations in `index.html`; separate `employee-ledger.js`. | Two financial truths produce different liabilities and payments. | NONE | `AT-FIN-006` payroll calculation/post/finalize/adjust tests. | `EXE-FIN-006` employee month across attendance, commissions, payments and restart. | `MIG-P0E-002` reconcile ledger/payroll with exception report. | FAIL |
| AUD-RPT-001 | Critical | Every financial/doctor/VAT/attendance/expense/payroll report must consume an explicit BranchContext query, never the global `cases`/arrays. | Monthly path is scoped, but doctor/VAT use global cases at `index.html:15814-15860`. | Cross-branch disclosure and incorrect financial totals. | NONE | `AT-RPT-001` report query scope matrix. | `EXE-RPT-001` Branch A user cannot see Branch B values; Owner aggregate is explicitly labeled. | None after ownership migration. | FAIL |
| AUD-RPT-002 | Critical | Preview, print, PDF and export must use the same immutable report document/calculation result. | Employee preview uses selected year and deductions `index.html:10068-10116`; print uses current year and fewer adjustments `index.html:10239-10267`. | Printed payroll/report differs from approved preview. | NONE | `AT-RPT-002` document snapshot/calculation equality. | `EXE-RPT-002` selected prior year thermal/A4/PDF values match UI exactly. | None. | FAIL |
| AUD-LIC-001 | Critical | Replace embedded V6 development/test public key with approved production public key and immutable production key ID; production build must reject dev key. | `license/core/license-pubkey-v6.js:5-22`. | Development-issued licenses can be accepted by commercial build. | NONE | `AT-LIC-001` prod accepts production fixtures and rejects dev/test fixtures. | `EXE-LIC-001` clean install activation/renewal/offline validation with production-signed license. | Controlled license/key compatibility and customer migration plan. | FAIL |
| AUD-LIC-002 | Critical | Remove Legacy HMAC signing capability/material from renderer/customer package; customer runtime verifies but never signs licenses. | `license/core/license-crypto.js:5-24`; renderer builder paths. | Anyone can derive signing key and forge Legacy licenses. | NONE | `AT-LIC-002` packaged-file scan contains no signing secret/function; forged legacy license rejected. | `EXE-LIC-002` legacy customer migration works only through authorized signed upgrade path. | Signed migration/renewal path for legitimate legacy customers. | FAIL |
| AUD-LIC-003 | High | Enforce feature/package/device/branch limits in main/domain services, not UI visibility only. | Renderer feature registry and generic database paths. | Hidden or disabled features can be invoked directly. | NONE | `AT-LIC-003` service-level gate matrix for every licensed capability. | `EXE-LIC-003` downgraded/offline/expired license cannot call gated operations. | License schema compatibility. | FAIL |
| AUD-LIC-004 | High | Remove license builder and package-registry mutation from normal customer runtime, or require a separately signed/admin-authorized process with explicit IPC policy. | `electron/main.js:935-955`; preload exposure `electron/preload.js:99-101`. | Customer renderer can reach commercial package mutation surfaces. | NONE | `AT-LIC-004` production package surface scan and authorization test. | `EXE-LIC-004` installed customer EXE has no unauthorized builder/mutation path. | Existing custom package compatibility plan. | FAIL |
| AUD-BKP-001 | Critical | Replace predictable default Backup V2 password derived from center ID with a cryptographically random recoverable secret protected by OS credentials or an explicit owner-managed recovery policy. | `index.html:16898-16904`; encryption core `electron/backup-crypto-v2.js:14-26`. | Stolen backup confidentiality depends on a guessable value. | NONE | `AT-BKP-001` entropy, storage, rotation and wrong-secret tests. | `EXE-BKP-001` create/restore/reinstall with secure recovery; old predictable secret cannot open new backups. | `MIG-P0E-003` backward-read/secure-reencrypt strategy with explicit owner confirmation and evidence. | FAIL |

## Required Migrations

### MIG-P0E-001 — Financial Integrity

- Backup first.
- Add scoped invoice uniqueness/sequence.
- Reconcile visits, invoices, payments, inventory movements, cash movements and ledger postings.
- Produce exceptions for duplicates, missing postings and imbalanced payments.
- Never silently invent or alter historical financial values.

### MIG-P0E-002 — Payroll and Ledger Consolidation

- Select one authoritative model.
- Map historical accruals/payments/finalized periods.
- Retain source IDs and an immutable migration audit.
- Require explicit resolution for mismatched totals.

### MIG-P0E-003 — Backup Secret Rotation

- Keep old backups readable only through a clearly identified legacy recovery path.
- Generate a new high-entropy secret for new backups.
- Store/recover it using an approved owner/OS-protected mechanism.
- Verify restore before retiring any legacy secret.

## P0-E Exit Gate

- Financial failpoints always roll back the whole operation.
- Invoice numbers remain unique under Device A/B concurrency.
- Payments reconcile and branch scope is correct.
- Preview, PDF and print values are identical.
- Production build accepts only production licensing material and contains no Legacy signing secret.
- New backups use a non-predictable secret and restore after reinstall.
- All Critical findings across P0-A through P0-E are `PASS`; Critical `FAIL` count = 0 and Critical `UNVERIFIED` count = 0.

---

# Deferred Program — Starts Only After the P0 Release Gate Passes

These findings remain mandatory, but implementation is blocked until all P0 Critical requirements are `PASS`.

| ID | Target | Severity | Requirement | Evidence | Files changed | Tests | Migration | Baseline result |
|---|---|---|---|---|---|---|---|---|
| AUD-BKP-002 | P1 | High | Make UI schedule, saved config and scheduler default report one truthful interval and cloud/local behavior. | `electron/backup-v2-scheduler.js:8`; `cloud/activation-sync-defaults.js:120`; `index.html:6480,6519`. | NONE | `AT-BKP-002`, `EXE-BKP-002` | Settings version normalization. | FAIL |
| AUD-BKP-003 | P1 | High | Add verified cloud retention/prune policy; history must include local and cloud inventory. | Backup V2 local retention and Drive paths. | NONE | `AT-BKP-003`, `EXE-BKP-003` | Remote inventory metadata. | FAIL |
| AUD-BKP-004 | P1 | High | Use resumable upload/download, retry/backoff and interrupted-transfer verification for large backups. | In-memory multipart `electron/cloud-providers/google-drive-api.js:45,73-91`. | NONE | `AT-BKP-004`, `EXE-BKP-004` | None. | FAIL |
| AUD-BKP-005 | P1 | High | Stop labeling an organization-wide SQLite backup as branch-scoped; either enforce organization scope or create a genuinely filtered, integrity-preserving branch export. | Backup roots/manifest in `electron/backup-v2-core.js:25,382`. | NONE | `AT-BKP-005`, `EXE-BKP-005` | Manifest format version. | FAIL |
| AUD-BKP-006 | P1 | Medium | Make backup-content UI accurately disclose excluded OAuth tokens, caches and any localStorage-only data. | `index.html:6555-6568`; backup roots. | NONE | `AT-BKP-006`, `EXE-BKP-006` | None. | FAIL |
| AUD-UI-001 | P1 | High | Keep OwnerHub's current visual system but make each domain table/action independent, fix broken settings link and sanitize all cells. | `cloud/owner-hub.js:617,803-827`. | NONE | `AT-UI-001`, `EXE-UI-001` | None. | FAIL |
| AUD-UI-002 | P1 | High | Keep Backup UI theme, remove hidden V1 hooks/duplicate controls and present Sync, Backup, Restore, Schedule, Security and unified History as distinct truthful sections. | `index.html:6332-6585`. | NONE | `AT-UI-002`, `EXE-UI-002` | Settings normalization only. | FAIL |
| AUD-CUS-001 | P1 | High | Either wire the existing attachment lifecycle end-to-end with authorization/integrity or remove misleading attachment affordances; do not add a second attachment architecture. | `cloud/attachment-lifecycle.js:70-144,253-258`; schema `database/migrations/001_initial.js:221`. | NONE | `AT-CUS-001`, `EXE-CUS-001` | Attachment metadata/path migration if activated. | FAIL |
| AUD-CUS-002 | P2 | Medium | Remove claims of client merge if no merge exists, or implement only after product authorization as separate post-P0 work. Current remediation must not add this feature. | Import/duplicate workflows; no proven existing merge execution path. | NONE | Disclosure/removal test only under this program. | None. | FAIL |
| AUD-FAKE-001 | P1 | High | Remove OneDrive/Dropbox/WebDAV/network-folder stubs and Firebase/local-server/USB settings from the production customer surface until real implementations are separately authorized. | `electron/cloud-providers/stub-providers.js`; `cupping-drive-sync.js:24-26,256-261`. | NONE | `AT-FAKE-001`, `EXE-FAKE-001` | Preserve ignored settings only if needed for rollback. | FAIL |
| AUD-FAKE-002 | P1 | Medium | Hide/remove COM drawer option until a real supported driver path exists. | `electron/devices.js:315`. | NONE | `AT-FAKE-002`, `EXE-FAKE-002` | Settings compatibility. | FAIL |
| AUD-FAKE-003 | P1 | Low | Remove visual-only/no-op context functions and dormant surfaces after proving no production caller depends on them. | `index.html:10841-10871`. | NONE | `AT-FAKE-003`, `EXE-FAKE-003` | None. | FAIL |
| AUD-FAKE-004 | P1 | High | Developer “database integrity” must run and report real SQLite integrity checks or be renamed/removed. | Developer panel verification paths. | NONE | `AT-FAKE-004`, `EXE-FAKE-004` | None. | FAIL |
| AUD-PERF-001 | P1 | High | Establish measured startup, memory, render and large-dataset budgets; reduce eager loading/full-array rendering without creating a second UI architecture. | `index.html` 27,465 lines; 170 external script tags; full-table sync/render paths. | NONE | Performance harness plus installed dataset benchmark. | None. | UNVERIFIED |
| AUD-QLT-001 | P1 | High | Replace swallowed operational errors with structured error propagation, audit correlation and truthful user state. | Hundreds of empty/silent catch paths. | NONE | Error/failure-injection coverage. | Log format/version if needed. | FAIL |
| AUD-QLT-002 | P2 | Medium | Split monolithic responsibilities into cohesive modules only after the single production paths are stable; no big-bang rewrite. | Large `index.html` and global dependency order. | NONE | Boundary/import tests and runtime regression. | None. | FAIL |
| AUD-TST-001 | P0/P1 gate | Critical | Add real installed-runtime security, branch, restore, sync and financial tests; source-regex/mock-only tests cannot satisfy release gates. | Existing test inventory is largely source/baseline oriented; no current installed evidence. | NONE | Phase test suites listed above. | All `EXE-*` scenarios. | Test data only. | UNVERIFIED |
| AUD-TST-002 | P0/P1 gate | Critical | Produce and install Windows Setup EXE for every phase, retain SHA-256 and exact test evidence. Current checkout has no `dist`/`release` artifact. | `package.json` build scripts; artifact absent in audit workspace. | NONE | Build validation plus artifact manifest. | Clean install and upgrade install. | Installer/userData migration validation. | UNVERIFIED |
| AUD-TST-003 | P1 | High | Validate actual thermal, A4, PDF, Google OAuth/Drive quota, large backup and clean-machine upgrade/downgrade behavior. | Hardware/provider runtime unavailable during baseline audit. | NONE | Supporting automation where possible. | Physical/provider test evidence required. | Environment-specific. | UNVERIFIED |

---

# Per-Phase Evidence Package

Each phase must create an immutable evidence folder under `docs/remediation/evidence/<phase>/<build-id>/` containing at minimum:

1. `SUMMARY.md` — findings addressed, findings open and release-gate result.
2. `SOURCE-MANIFEST.json` — source revision, dirty-state report and Requirement IDs.
3. `MIGRATION-REPORT.json` — rows read/written/quarantined, checksums, rerun result and rollback result.
4. `TEST-RESULTS.json` — exact commands, exit codes and test case IDs.
5. `SETUP-EXE.json` — absolute artifact name, size and SHA-256.
6. `INSTALL-ENVIRONMENT.json` — Windows build, installation path, userData path category and clean/upgrade mode without secrets/PHI.
7. `RUNTIME-SCENARIOS.json` — each `EXE-*` case with timestamp and PASS/FAIL.
8. `FAILURE-INJECTION.json` — injection point, expected rollback/recovery and actual result.
9. `RESTART-RETEST.json` — state before restart, after restart and database checksums/counts.
10. `SECURITY-REGRESSION.json`, `BRANCH-REGRESSION.json`, `DATA-LOSS-REGRESSION.json`.

Screenshots may support evidence but cannot replace machine-verifiable database, log, revision and checksum evidence.

# Required Phase Report Template

Every phase completion report must state:

- Phase and build ID.
- Findings addressed.
- Findings still open.
- Exact files changed per Requirement ID.
- Data migration required and migration result.
- Backward compatibility behavior.
- Tests added.
- Exact `npm test` command/result.
- Windows Setup EXE path/name.
- Setup EXE SHA-256.
- Clean-install result.
- Upgrade-install result.
- Runtime evidence paths.
- Failure-injection and restart result.
- Security regression result.
- Branch-isolation regression result.
- Data-loss regression result.
- Release gate: `PASS` or `FAIL`.

# Build and Installed-EXE Gate

For every phase:

1. Start from a clean dependency installation using the lockfile-approved command.
2. Run lint/static checks, then the complete existing test suite plus phase tests.
3. Build through the repository's production Windows build command; do not create an alternate build path.
4. Calculate SHA-256 using the final Setup EXE bytes.
5. Install once as a clean machine/userData scenario.
6. Install once as an upgrade over the supported prior production dataset.
7. Run the phase-specific installed scenarios.
8. Inject the required failures.
9. Restart Windows app/process as specified.
10. Retest and compare database integrity, record counts, revisions, outbox state and audit trail.

# Overall Release Gate

The release state remains:

- Production Candidate: **NO**
- Ready for commercial release: **NO**
- Ready for main: **NO**

until all of the following are true:

1. Critical `FAIL` count is zero.
2. Critical `UNVERIFIED` count is zero.
3. Every P0 phase gate is `PASS` in order.
4. A clean installed Setup EXE restores a real cloud Backup V2 and accepts the previously configured Owner password without a first-time password prompt.
5. Device A/B concurrency, offline/reconnect, duplicate delivery and failed-version-publication scenarios pass.
6. Security boundary tests, including stored XSS and forged synthetic developer-session binding, pass while the intended developer-password login remains operational.
7. Branch-isolation and financial rollback tests pass on the installed EXE.
8. Production licensing material and Backup V2 secret requirements pass.
9. Final Setup EXE SHA-256 and full evidence package are retained.

---

# Current Source Remediation Status — P0-A through P0-E

Build identifier: `P0AE-SOURCE-20260810-122PASS`

This section records the current checkout after source remediation. It does not
replace the baseline rows above and does not convert any installed-EXE
acceptance criterion to `PASS`.

## Implemented source paths

- P0-A: deny-by-default IPC/RBAC, authenticated developer proof, constrained
  setup/cloud channels, safe rendering/CSP, OAuth state, secure print windows,
  protected credentials and secret storage. The intended developer password
  and support entry flow remain present.
- P0-B: SQLite-scoped operational authority, typed transactional commands,
  center/branch ownership, scoped replacement, branch-safe sync operations and
  durable outbox publication.
- P0-C: full Drive discovery pagination/retry, pre-auth verified activation,
  setup-safe restore classification, truthful restore/BootFlow gates, atomic
  first-Owner creation, credential revision merge/publication and prevention of
  the seed-password recurrence.
- P0-D: immutable per-record operations, operation IDs, revisions,
  idempotency, tombstones, conflict retention, durable retry and removal of the
  normal full-table production writer.
- P0-E: atomic financial posting and invoice sequence, append-only reversal,
  finalized payroll/adjustments, explicit report branch scope, shared
  preview/print report document, secure Backup V2 secret, production Ed25519
  verification and removal of customer-runtime license signing/mutation.
- Runtime license hardening added during P0-E: Google binding, device registry,
  activation consumption and Owner bootstrap recovery metadata now live in
  SQLite-backed operational state. They no longer modify issuer-signed license
  bytes. Branch add/remove and license upgrade/downgrade/refresh require an
  externally re-issued signed V6 document.

## Verification result

- `npm test`: **122/122 PASS**, exit code `0`.
- `npm run lint`: **PASS**, exit code `0`.
- P0-A focused: **47 checks PASS**.
- P0-B focused: **11/11 PASS**.
- P0-C focused: discovery **6/6**, activation **15/15**, restore target **6/6**,
  restore/Boot gate **10/10**, credential merge **6/6**, publication **2/2**.
- P0-D focused: **9/9 PASS**.
- P0-E focused: financial **7/7**, licensing, runtime license immutability,
  backup secret, payroll and report scope all **PASS**.
- Real Google source diagnostic (read-only production profile plus sandbox DB
  commit) previously proved: Google connected, unique license found, signature
  valid, setup activation valid, activation commit valid and organization/device
  commit valid. This is retained as source/runtime diagnostic evidence, not as
  proof of the final unbuilt ZIP installation.

## Migration and compatibility

- SQLite migrations `004_sync_operations`, `005_financial_atomicity` and
  `006_financial_reversals` are registered and covered by restart/idempotency
  tests.
- The exact known legitimate legacy license is accepted only by its canonical
  SHA-256 allowlist and is marked for migration; arbitrary legacy signing is not
  available in the customer runtime.
- Production V6 public key ID: `prod-ed25519-2026-a7f929f51598`.
- The production private key is outside the workspace and is not included in
  source evidence or ZIP artifacts.

## Gate result

- Source Critical assertions failing: **0**.
- Current-source Windows Setup EXE built: **NO**, per product-owner instruction.
- Current-source clean install / upgrade install / failure-injected installed
  restart: **UNVERIFIED**.
- P0-A through P0-E installed gates: **UNVERIFIED**.
- Production Candidate: **NO**.
- Ready for commercial release: **NO**.
- Ready for main: **NO**.
- P1/UX backlog remains blocked by the installed P0 gate and has not been
  silently declared complete.

Evidence folder:
`docs/remediation/evidence/P0-A-E/P0AE-SOURCE-20260810-122PASS/`.

---

# Final Windows Build Verification â€” 2026-08-10

Build identifier: `P0AE-WIN-20260810-123PASS`

- `npm test`: **123/123 PASS**, exit code `0` (373.8 seconds).
- Windows NSIS setup build: **PASS**, exit code `0` (215.2 seconds).
- Setup file: `dist/HijamaManagement-Setup-2.0.1.exe`.
- SHA-256: `DB69A0C81D5A786A3C972DCC3AEBD7D271E16289624FD85B621623A48A1CEB92`.
- Silent clean-path installation into `.codex-p0a/final-installed-20260810`:
  **PASS**, installer exit code `0`.
- Installed executable startup smoke test: **PASS** (a real application window
  opened with the expected product title); no setup data was entered.
- ASAR manifest check: removed cloud stub provider **absent**; private signing
  material / license-admin key paths **absent**; compiled main process **present**.
- Authenticode signing: **UNVERIFIED / NOT CONFIGURED**. Electron Builder
  explicitly reported that no Windows signing identity was configured. This is
  a commercial-release risk and is not represented as a passing security gate.
- Full interactive Google OAuth, cloud restore, Device A/B conflict and
  failure-injection tests against the installed executable: **UNVERIFIED** in
  this run. Performing them would require an isolated Windows profile and
  controlled Google test tenant; the packaged executable deliberately uses the
  stable production user-data folder, so the test was stopped before any
  interactive setup action could affect existing data.

The baseline release conditions above remain authoritative. In particular,
this build result does not convert the remaining installed-EXE acceptance
criteria to `PASS`.

---

# Post-Baseline Findings and Installed Checkpoint — 2026-08-11

The following findings were proven while reproducing the setup and final
installed-runtime paths. They are additions to the baseline; no existing
finding was deleted or had its severity reduced.

| ID | Severity | Requirement / root cause | Evidence source and line | Runtime impact | Existing code paths / files changed | Automated test | Installed EXE test | Migration impact | Result |
|---|---|---|---|---|---|---|---|---|---|
| AUD-BOOT-006 | Critical | Startup theme application attempted an authoritative settings write before an RBAC session existed. Root cause: `applyTheme` always persisted and both startup callers passed only `silent:true`. Make startup rendering explicitly read-only; persist only a user-initiated change after authentication. | Reproduced in installed P0-A runtime: `index.html:19750` threw `rbac_session_required`. Fixed at `index.html:19748-19751`, `index.html:19879`, `cupping-platform-services.js:63-67`. | Fresh login/setup could show an internal security error and interrupt downstream setup work. | `index.html`; `cupping-platform-services.js`; `tests/baseline/test-p0-a-security-boundary.js`; `scripts/windows-uat/p0-a-security-runtime.cjs`. | P0-A security 53/53; full suite 124/124. | Exact EXE P0-A runtime 41/41: zero page errors first-run/restart. | None; read-only startup does not rewrite settings. | PASS |
| AUD-SEC-017 | High | The authenticated Developer identity is `__dev__`, but the entitlement bypass checked a different literal; Owner read-only branch logic could also treat authenticated Developer support as organization Owner and remove its explicit write context. Bind the intended support capability only to the main-issued `__dev__` session and preserve its explicit branch choice. | `electron/license-entitlements.js:43`; `cloud/branch-contexts.js:44-52`; previous P0-A installed regression showed developer support blocked/legacy branch migration. | Intended developer password login succeeded but support operations and developer UI could fail after login. | `electron/license-entitlements.js`; `cloud/branch-contexts.js`; `index.html`; P0-A tests/UAT. | P0-A security 53/53; P0-E licensing suite PASS; full 124/124. | Exact EXE: intentional Developer authentication, proof bind, explicit write branch, UI flow and restart all PASS. Forged bind remains denied. | None. | PASS |
| AUD-DAT-005 | Critical | The Clean Install backup path archived the profile then stripped `Local Storage`, `IndexedDB`, `Session Storage` and `CloudVault`. Those stores can contain legacy operational/recovery state, so the advertised recovery archive was not necessarily usable. Preserve the archive byte-for-byte. | `build/installer.nsh:245-258` formerly invoked `NT_StripLicenseFromArchive_Install`; recovery inspection found archived profiles and confirms SQLite validity but cannot prove every legacy store was retained historically. | A user choosing fresh start could later be unable to recover legacy data from the supposedly preserved archive. | `build/installer.nsh`; `tests/baseline/test-nsis-cupping-center-wipe.js`. | NSIS persistence test PASS; lifecycle matrix 13/13; full 124/124. | Final EXE includes the installer change, but a destructive fresh-start run against a real profile was not performed. | No data rewrite; future archives retain all existing stores. Existing stripped archives cannot be reconstructed by code. | UNVERIFIED |

## Latest Windows Build and Runtime Result

Build ID: `P0AE-INSTALLED-20260811-124PASS-BD090551`.

- Full suite: **124/124 PASS** (337.5 seconds); `npm run lint`: **PASS**.
- Setup EXE build and silent isolated install: **PASS**.
- Setup SHA-256: `BD090551DE62EFCA1C2C49CBBBD18F69C7888796821F04EC4AF253424DCAFF18`.
- Exact installed P0-A security/runtime/restart suite: **41/41 PASS**.
- Exact installed P0-B authority/branch/failure/restart suite: **7/7 PASS**.
- Evidence: `docs/remediation/evidence/P0-A-E/P0AE-INSTALLED-20260811-124PASS-BD090551/`.
- Authenticode: **UNVERIFIED / NOT CONFIGURED**.
- Real Google reconnect → setup restart → initial sync, real Drive restore, Device A/B conflict and actual fresh-start archive recovery remain **UNVERIFIED**. P0-C/P0-D/P0-E and commercial-release gates therefore remain **NO-GO**.

---

# P0-C Google/Cloud V2 Readiness Source Checkpoint — 2026-08-10

Build identifier: `P0C-GOOGLE-RECOVERY-SOURCE-20260810-124PASS`

- Finding: `AUD-BOOT-005`.
- Reproduction: installed BootFlow reached initial sync with
  `activation_incomplete`; readiness listed `cloud_v2_disabled` and
  `google_not_connected` after an earlier successful Google step.
- Root cause: Main OAuth token state and the post-restart Renderer settings
  cache were evaluated in the wrong order. A stale `userDisconnected` marker
  could also cause status reconciliation to discard a newly connected token.
- Source remediation: live Main state is reconciled before activation defaults;
  recovery is permitted only when the BootFlow Google step was explicitly
  completed; explicit setup disconnect rewinds downstream wizard state.
- Focused regression: **3/3 PASS**.
- P0-C restore/Boot regression: **10/10 PASS**.
- Setup activation: **15/15 PASS**.
- Full test suite: **124/124 PASS**, exit code `0` (357.6 seconds).
- `npm run lint`: **PASS**, exit code `0`.
- Exact post-fix Windows Setup EXE: **BUILT AND INSTALLED**; current SHA-256 is
  `BD090551DE62EFCA1C2C49CBBBD18F69C7888796821F04EC4AF253424DCAFF18`.
- Read-only live Drive diagnostic: **PARTIAL PASS**; a valid Google session,
  inventory listing, license signature and setup-activation verification passed.
- Installed real-Google BootFlow restart/retry and Backup V2 restore remain
  **UNVERIFIED** and are required for `AUD-BOOT-005` PASS.

## Post-fix Windows artifact

- Source ZIP:
  `D:/HijamaManagement-P0C-Google-CloudV2-Fix-124PASS-20260810.zip`.
- Source ZIP SHA-256:
  `98E852B74E78CF370B4993B3752AD75318070BD0EFB78541AF8E53C0C3CC7672`.
- Setup EXE rebuilt after the checkpoint: **PASS**.
- Setup EXE SHA-256:
  `734CD60B0F8C2DE865E21746F61CA854A4ECC70D26E936700147E3B299013710`.
- The four changed production files inside `app.asar` match their source
  SHA-256 values exactly.
- Silent isolated-path installation: **PASS**, exit code `0`.
- Real isolated userData launch with explicit `--user-data-dir`: **PASS**;
  process, renderer and database all used
  `.codex-p0a/userdata-googlefix-debug-20260810`.
- Installed login/BootFlow entry accessibility smoke: **PASS**; no runtime
  stderr error. One Node `punycode` deprecation warning was emitted.
- Current production-profile Google diagnostic: Main reports
  `connected=false`, `needsReauth=true`, `hasRefreshToken=false`. The old token
  was already absent and cannot be recovered by source logic; one explicit
  Google reconnect is required to execute the final installed regression.
- Authenticode: **NOT SIGNED**.
- `AUD-BOOT-005` remains **UNVERIFIED** until reconnect -> setup restart ->
  initial sync succeeds on these exact EXE bytes.

---

# Product-owner Legacy V5 Restoration Addendum — 2026-08-11

This history-preserving addendum records the explicit product-owner decision to
restore the original V5 licence-generation workflow in the Developer UI. It
does not delete, downgrade or supersede the P0-E security requirements above.
The Ed25519 V6 verifier/issuer compatibility path remains present, but the
interactive generator now produces V5 keys and the corresponding activation
and bundle rows used by the existing Google Sheets vault.

## Functional implementation and evidence

- V5 PBKDF2/HMAC generation and verification are active in
  `license/core/license-crypto.js:7-66`, `index.html:25130-25375` and
  `license/engine/license-generator-v2.js:107`.
- Developer-only licence artifact writes are main-process authorized and are
  persisted atomically below the writable Electron `userData/LicenseAdmin`
  directory. The exposed write IPC begins at `electron/main.js:1306`; a forged
  renderer Developer identity remains denied by the existing main-issued
  Developer session proof.
- Google Sheets requests use the narrow main-process vault proxy at
  `electron/main.js:1329-1330`. The proxy permits only the configured Apps
  Script URL shape and the four vault actions, uses the CORS-safe text request
  format and enforces request, response and 120-second timeout bounds.
- Drive activation artifact upload verifies the centre path and cryptographic
  licence document before publishing (`electron/main.js:516`).
- Legacy setup activation reaches the narrow atomic SQLite commit from
  `cloud/boot-flow-ui.js:909-928`; first-branch publication is implemented by
  `electron/setup-activation.js:207-290`.
- Branch creation accepts only Owner Hub or activation-wizard sources, enforces
  capacity, revision checks, pending recovery and idempotency. The setup wizard
  can create the first branch only (`cloud/branch-enrollment.js:73-172`).
- Synchronized device/licence activation state is classified as operational
  SQLite-backed data (`database/entity-catalog.js:26-47` and
  `cupping-sqlite-bridge.js:38-77`).

Focused runtime-source results:

- P0-A security boundary: **50/50 PASS**.
- P0-B authority/branch isolation: **11/11 PASS**.
- P0-C setup activation: **15/15 PASS**.
- P0-D operation synchronization: **9/9 PASS**.
- Legacy V5 encode/decode, tamper rejection and cross-process document
  verification: **PASS**.
- Writable packaged-admin persistence and path traversal rejection: **PASS**.
- Sheets vault URL/action/payload/CORS boundary: **PASS**.
- Cloud V2 verification: **PASS**.
- V2-5.8 activation scenarios: **10/10 PASS**; Windows UAT source harness:
  **PASS**.
- Full suite after restoration: **124/128 PASS** before the V2-5.8 textual
  scenario correction; the two V2-5.8 failures were subsequently reproduced
  and corrected without changing runtime behavior. The two remaining expected
  failing groups are the P0-E no-shared-secret gate and the commercial
  no-customer-mutation gate.

## Security requirement status after the requested restoration

| ID | Severity | Current evidence and impact | Result |
|---|---|---|---|
| AUD-LIC-001 | Critical | The V6 production public-key compatibility path remains, but it is not the default interactive issuance path. Installed production acceptance for V6 is not evidence that V5 cannot be forged. | UNVERIFIED |
| AUD-LIC-002 | Critical | `LIC_SECRETS` and browser HMAC signing are again present in customer-packaged source. Any party able to extract the ASAR can derive the signing key and forge a V5 licence. Functional tamper tests do not mitigate possession of the signing secret. | FAIL |
| AUD-LIC-003 | High | Main/domain enforcement and branch/device tests pass at source level; installed downgraded/offline/expired licence service-gate acceptance has not been rerun on the new bytes. | UNVERIFIED |
| AUD-LIC-004 | High | Builder artifact mutation is guarded by a real main-issued Developer session, but the V5 signing material still ships in the renderer. The normal customer package therefore still contains a licence-generation capability even if UI entry is protected. | FAIL |

## Gate result

- Requested original V5/Sheets workflow: **FUNCTIONAL SOURCE PASS**.
- Critical P0-E security findings open: **1 FAIL, 1 UNVERIFIED**.
- Current-source Windows Setup EXE and installed real Google/Drive journey:
  **UNVERIFIED** until the post-restoration build and run are completed.
- Production Candidate: **NO**.
- Ready for commercial release: **NO**.
- The only safe commercial closure is to move V5 signing to a separately
  controlled issuer/service or return to the private-key V6 issuance model;
  merely hiding the Developer UI or password cannot protect an embedded shared
  secret.

## 2026-08-11 operational evidence update (history-preserving)

- A later exact Setup EXE was built and installed with SHA-256
  `BD090551DE62EFCA1C2C49CBBBD18F69C7888796821F04EC4AF253424DCAFF18`.
- The current production profile then passed the redacted, read-only Drive
  diagnostic: Google connected, refresh credential available, two roots listed,
  18 total inventory entries in the populated root, one valid license, and the
  exact setup-activation verifier passed. Evidence:
  `docs/remediation/evidence/P0-A-E/P0AE-INSTALLED-20260811-124PASS-BD090551/P0-C-CLOUD-DIAGNOSTIC.json`.
- A copied non-empty SQLite target rejected the narrow setup activation commit
  with `setup_activation_target_not_empty` and reported rollback. This is the
  required non-destructive behavior, not proof of a fresh setup commit.
- The historical 2026-08-10 disconnected-token observation remains valid for
  that point in time. It is superseded operationally by the later connected
  diagnostic, while the full UI restart/initial-sync and real Backup V2 restore
  acceptance paths remain **UNVERIFIED**.

---

# Legacy V5 Final Build and New Finding — 2026-08-11

Build ID: `LEGACY-V5-FINAL-20260811-126OF128-7808AB2A`.

## New proven finding

| ID | Severity | Evidence source and line | Runtime impact | Root cause | Existing code paths / files changed | Automated test | Installed EXE test | Migration impact | Result |
|---|---|---|---|---|---|---|---|---|---|
| AUD-LIC-005 | High | Reproduction encoded V5 subscription `08` with `2099-12-31` and decoded it as `2032-09-17`. The compact date field is implemented at `license/core/license-codec-v5.js:7-8,141-142,177-185`; bundle-authoritative validation is at `license/engine/license-validator-v2.js:80`; preview authority is at `license/ui/license-key-preview.js:88`. | A lifetime or far-future custom licence could be shown or rejected as expired years before its signed entitlement actually expires. | V5 stored days since 2020 in 13 bits and silently masked overflow; validation preferred the compact hint over the authenticated activation bundle. | `license/core/license-codec-v5.js`; `license/engine/license-validator-v2.js`; `license/ui/license-key-preview.js`; `tests/baseline/test-legacy-v5-license-runtime.js`. | 441 package/action/subscription combinations PASS; lifetime sentinel, historical wrapped lifetime compatibility, far-future custom bundle authority, tamper and key/bundle mismatch tests PASS. | Exact installed EXE generated lifetime and custom-far-future V5 keys, decoded lifetime as `2099-12-31`, retained both across restart and produced zero page/console errors. | Historical subscription `08` keys now decode as lifetime regardless of their formerly wrapped date bits. Other historical extended dates are validated from their HMAC-authenticated bundle. No SQLite rewrite. | PASS |

## Final exact artifact verification

- Full suite: **126/128 groups PASS**. The only failing groups are
  `p0-e:licensing-production` and `license:test`, both of which intentionally
  reject customer-packaged V5 signing/mutation material required by the
  product-owner restoration decision.
- `npm run lint`: **PASS**.
- Focused P0-A/P0-B/P0-C/P0-D results: **50/50**, **11/11**, **15/15** and
  **9/9 PASS** respectively.
- Original V5 issuance coverage: **7 packages × 7 encodable lifecycle actions ×
  9 subscription durations = 441 combinations PASS**. The original builder UI
  exposes New/Renew/Repair/Developer; Upgrade and Downgrade remain in their
  dedicated workflows as in the audited original build.
- Google Sheets production Web App read-only status request: endpoint reached
  through the new main proxy in 3.854 seconds and returned the expected
  `not_found` for a deliberately nonexistent key. No row was created or
  changed.
- Current live Drive diagnostic: **UNVERIFIED** because the `Cupping Center`
  profile currently reports `connected=false`, `needsReauth=true` and no
  refresh token. This is external credential state; the run did not mutate or
  delete local or cloud data.
- Windows Setup build: **PASS**. Exact file:
  `dist/HijamaManagement-Setup-2.0.1.exe`.
- Setup SHA-256:
  `7808AB2AF59DF425B1AAA1C056F87EF53E8A8136908F0133541CA4EB51D9C7D3`.
- Silent isolated installation: **PASS**, exit code `0`.
- Exact installed Renderer/Main journey: intentional Developer password auth,
  short-lived proof and `__dev__` bind **PASS**; proofless forged bind **DENIED**;
  V5 generation/persistence, 6-column activation row, 2-column bundle row,
  4 original action cards, 9 duration choices, 6 branch-count choices and 11
  Developer licence-tool buttons **PASS**.
- Exact installed SQLite: `integrity_check=ok`, migrations **6**, tables **43**.
- Exact installed restart: both generated licences persisted; Developer session
  did not persist; proofless Developer bind remained denied; page and console
  errors remained **0**.
- `app.asar` source-match check for the restored crypto, generator, vault proxy,
  legacy verifier, licence persistence, Main, branch enrolment, activation gate,
  BootFlow and SQLite bridge: **PASS**.
- Authenticode: **NOT SIGNED**.
- Source ZIP SHA-256:
  `24824220DF039D52D7D6114716C3CBF82B1B392D949235A3276C5785CB46D7E1`.
- Windows ZIP SHA-256:
  `66D1E03A15981E5343E70C1BC3C52965D9A808DFC3489DCFB6CA7ADEF0F50DF7`.
- Both ZIP archives passed full 7-Zip integrity tests; the source archive
  excludes `node_modules`, `dist` and isolated test profiles.

## Release gate

- Functional legacy V5/Sheets/SQLite/branch workflow: **PASS** for source and
  exact installed EXE evidence described above.
- Real Drive OAuth/upload/download on the exact final bytes: **UNVERIFIED**
  pending one explicit Google reconnect.
- AUD-LIC-002: **FAIL**; AUD-LIC-004: **FAIL** because V5 shared signing
  material is packaged in the customer Renderer.
- Production Candidate: **NO** under the mandatory security baseline.
- Ready for commercial release: **NO** under the mandatory security baseline.

---

# Setup Restore / Restart Incident — 2026-08-11

This section records newly proven findings from the real Drive/setup incident.
It does not delete or lower any earlier finding. Current-source tests and the
real Drive run passed, but exact post-change installed-EXE acceptance remains
required before any row below can be declared final `PASS` under the baseline
status rules.

| ID | Severity | Evidence source and line | Runtime impact | Root cause | Existing code paths | Files changed | Automated / runtime test | Installed EXE test | Migration impact | Result |
|---|---|---|---|---|---|---|---|---|---|---|
| AUD-RST-007 | Critical | Installed UI diagnostic `RST-msoxkiso-2hrh2` failed at Backup V2 download with `An object could not be cloned`; source cause was the async password value crossing contextBridge. Remediation: `cloud/cloud-data-discovery.js:472`, `cloud/boot-flow-ui.js:1231`, `cloud/backup-layer.js:111`, `cloud/restore-reconciliation.js:64`, `electron/backup-v2-ipc.js:205-225`. | Confirmed cloud/local restore stopped before Main received the request. | `getBackupV2Password()` returns a Promise and four callers forwarded it without `await`; setup also unnecessarily depended on Renderer-owned secret transfer. | BootFlow / restore reconciliation / automatic backup -> contextBridge -> Backup V2 IPC. | `cloud/cloud-data-discovery.js`; `cloud/boot-flow-ui.js`; `cloud/backup-layer.js`; `cloud/restore-reconciliation.js`; `electron/backup-v2-ipc.js`. | `test-current-restore-license-login.js`; `test-current-setup-restore-runtime.js`; real Drive disposable-profile restore in `.codex-validation/current-cloud-restore-isolated.json`: cloneable, SQLite `quick_check=ok`. | Exact rebuilt/installed UI restore is pending. | None; Main reads the existing safeStorage secret. | UNVERIFIED |
| AUD-RST-008 | Critical | Read-only Drive inventory `.codex-validation/current-cloud-restore-diagnostic.json`: newest valid V2 snapshot contained users=1 and zero clients/employees/visits, while older encrypted legacy files were about 1.72 MB. Former BootFlow exposed only `cloud.newest`. Remediation: `cloud/boot-flow-ui.js:1596-1705`. | A technically valid but nearly-empty newer setup snapshot hid earlier recovery points and reproduced “Owner only / no business data.” | Restore selection equated newest metadata with the correct recovery point and offered no explicit choice. | Discovery `restorePoints` -> `cloud.newest` -> one restore CTA. | `cloud/boot-flow-ui.js`. | `test-current-restore-license-login.js`; read-only real Drive classification. Multiple backups now require explicit selection and selected metadata renders through `SafeRender`. | Exact rebuilt/installed multi-copy selection is pending. | None. | UNVERIFIED |
| AUD-RST-009 | Critical | `backup-v2-core.classifySetupRestoreTarget` accepted schema/bootstrap-only SQLite, but former `electron/database/service.js:1476-1484` rejected any `sqlitePrimary` target and then used a non-atomic in-place legacy migration. Remediation: `electron/database/service.js:1481-1600`. | Older encrypted backups could decrypt successfully and still fail during setup migration; a failed in-place migration could leave partial state. | Two contradictory empty-target gates and no staging/swap boundary for legacy JSON restore. | Setup cloud/local restore -> legacy decrypt -> `bootstrapFromLocalSnapshot` -> SQLite migration. | `electron/database/service.js`; `tests/baseline/test-current-legacy-cloud-restore-runtime.js`. | Real SQLite test: encrypted V3 legacy envelope -> bootstrap-only gate -> staging -> atomic swap -> clients/employees/two users/password verification/current licence preservation; wrong password rejected before mutation. | Exact rebuilt/installed legacy restore with the operator's historical backup password is pending. | Idempotent legacy snapshot migration into a staged SQLite DB; original DB retained as a safety copy until verified swap. | UNVERIFIED |
| AUD-RST-010 | Critical | The real setup order commits one normalized `settings` row and `__tdw_device_registry__` before restore, but the former semantic classifier counted both as operational. A full V2 swap also replaced the current device/branch binding with the source device. Remediation: `electron/backup-v2-core.js:239,337,378,961-962`; `electron/backup-v2-ipc.js:147-268,366-367,548-570,700-751`. | A correctly activated and branch-bound fresh setup could be denied before download; if allowed, a Device B restore could inherit Device A identity. | The restore gate did not model the actual setup sequence and the V2 staging pipeline had no controlled identity merge. | Setup activation/organization/device -> restore classifier -> V2 staged DB -> atomic root swap. | `electron/backup-v2-core.js`; `electron/backup-v2-ipc.js`; `electron/database/service.js`; `tests/baseline/test-p0-c-setup-restore-target.js`; `tests/baseline/test-current-setup-restore-runtime.js`. | 7/7 semantic target tests pass. Real SQLite V2 test preserves current licence, runtime licence, device UUID, locked branch and device registry while restoring business rows. Real Drive disposable run begins from an activation+device populated `bootstrap_only` target and completes restore/restart. | Exact rebuilt/installed Device B setup restore is pending. | Staged merge only; populated business DB and usable real users still close the setup-only replace gate. | UNVERIFIED |
| AUD-AUTH-006 | Critical | Main pre-auth hydration intentionally omits password hashes, but former Renderer login required `verifyPW` before calling Main. Remediation: `index.html:10043-10065`; current live and isolated restored profiles report usable Main-owned credentials. | Correct restored Owner/staff passwords were rejected, and only accounts present in the selected sparse snapshot appeared. | Renderer revalidated a credential it was deliberately not allowed to receive. | SQLite preauth users -> login selector -> Renderer password check -> Main authentication. | `index.html`; `tests/baseline/test-current-restore-license-login.js`; `tests/baseline/test-current-legacy-cloud-restore-runtime.js`. | Main-auth behavioral test passes with no Renderer hash; restored Owner and staff hashes both verify and preauth exposes both users. | Exact rebuilt/installed Owner/staff login and restart are pending. | No password rewrite; existing PBKDF2/PBKDF2v2 hashes remain authoritative in Main. | UNVERIFIED |
| AUD-LIC-014 | Critical | Current SQLite contains valid `commercial_license_data_v2` and `__tdw_cloud_license__`, but former `licLoad()` read only Local/Session Storage. Remediation: `index.html:25744-25754`. Real disposable Drive restore retained both licence keys after restart. | Restart falsely displayed “program not activated / employee read-only” despite a valid restored licence. | The licence status check ignored the authoritative SQLite value after pre-auth hydration. | Startup SQLite hydrate -> DB mirror -> `licLoad` / `licCheck`. | `index.html`; `tests/baseline/test-current-restore-license-login.js`; `scripts/windows-uat/current-cloud-restore-isolated.cjs`. | SQLite-authoritative licence behavioral test and real Drive disposable restart both pass; licence present with expiry after reopen. | Exact rebuilt/installed activation banner and restart are pending. | None. | UNVERIFIED |
| AUD-BOOT-009 | High | The installed incident ended initial sync with `configuration_pull_incomplete`. Drive inventory contains only historical `settings.json` and `prices.json`, not the complete legacy config set. Remediation: `cloud/boot-flow-ui.js:257,323-342`. | A fully verified SQLite restore was followed by a redundant legacy full-config hydrate which failed on optional/missing old files and blocked setup completion. | BootFlow treated full Backup V2 restore as if it were a checkpoint/config-only pull. | Verified DB restore -> operation pull -> legacy `runNewDeviceBootstrap` -> incomplete config error. | `cloud/boot-flow-ui.js`; `tests/baseline/test-p0-c-restore-truth-and-boot-gate.js`. | `AUD-BOOT-008` regression passes: operation-log pull runs, full-config hydrate does not, bootstrap completion is marked only after the pull succeeds. | Exact rebuilt/installed initial-sync/restart is pending. | No data rewrite. | UNVERIFIED |

Current incident evidence:

- `.codex-validation/current-cloud-restore-diagnostic.json`: read-only production-profile Drive inventory and encrypted backup classification; no tokens, file IDs, user names or licence keys recorded.
- `.codex-validation/current-cloud-restore-isolated.json`: real Google download and real Backup V2 restore against a disposable profile; the live profile was not mutated.
- Focused source/runtime suite: 13 relevant groups passed, including wrong-password no-swap, bootstrap-only classification, Owner session, setup activation, discovery pagination/resume, initial-sync truthfulness and backup-secret tests.
- Current-source installed Setup EXE: **UNVERIFIED** until rebuilt and installed from these exact bytes.

---

# Final Clean-Runtime Audit — New Proven Findings (2026-08-11)

Detailed reproduction records and the exact current lifecycle map are in
`docs/remediation/FINAL-CLEAN-RUNTIME-AUDIT.md`.

| ID | Severity | Evidence source and line | Runtime impact | Root cause | Existing code paths | Files changed | Automated test | Installed EXE test | Migration impact | Result |
|---|---|---|---|---|---|---|---|---|---|---|
| AUD-BOOT-007 | Critical | Actual source Electron isolated restart: Owner credential was accepted by `cloud/boot-flow-ui.js:177-192,388-399`, Main session was `no_session`, and `runInitialSyncPipeline` returned `rbac_session_required`. | A restored/restarted customer cannot complete initial sync despite a valid Owner password. | Credential existence is treated as runtime authorization; the existing-Owner setup screen has no proof/session bind. | BootFlow → existing Owner → Activation defaults → protected database/sync IPC. | NONE before remediation. | Required after fix. | UNVERIFIED. | No credential rewrite; session remains ephemeral. | FAIL |
| AUD-DAT-006 | Critical | Isolated real SQLite setup commits: `electron/database/service.js:1112-1303` returned success while device registry typed count was 0 and Owner profile/setup were KV-only; catalog classifies them operational at `database/entity-catalog.js:26-47`. | Hydrate/sync can omit setup device and Owner projections; restart can diverge from the commit result. | Narrow setup transactions bypass typed organization commands for operational singleton entities. | Main setup IPC → database service → KV versus typed entity/outbox. | NONE before remediation. | Required after fix. | UNVERIFIED. | Idempotent KV-shadow to typed-singleton migration required. | FAIL |
| AUD-LIC-006 | Critical | Actual Electron emitted `registry_tampered:package`; canonical verification found `license/registries/package-registry.json` signature did not match its current bytes. | Developer generator cannot load package registries. | Registry changed without canonical regeneration. | License engine → registry integrity → generator drawer. | NONE before remediation. | Required after fix. | UNVERIFIED. | None. | FAIL |
| AUD-LIC-007 | High | Actual BootFlow UI submitted an injected failed activation while an old valid license existed; `cloud/boot-flow-ui.js:884-951` displayed a valid/success state. | A failed new key can appear accepted and diagnostics refer to stale state. | Success is inferred from global `hasValidLicense` instead of requiring the submitted result to succeed. | BootFlow activation → V5/V6 router → licCheck → UI status. | NONE before remediation. | Required after fix. | UNVERIFIED. | None. | FAIL |
| AUD-QLT-003 | High | Actual Electron emitted a completed task's false timeout from `index.html:27894-27901`; authenticated failure injection made `cloud/activation-sync-defaults.js:52-148` swallow Backup start failure and return `ok:true`. | Successful journeys show warnings; failed operational initialization can advance setup. | Uncancelled timeout plus non-awaited/ignored operations and empty catches. | Startup and post-activation defaults/sync/backup initialization. | NONE before remediation. | Required after fix. | UNVERIFIED. | Settings normalization only. | FAIL |
| AUD-LIC-008 | High | Actual Electron with a valid Main-issued Developer session invoked Generate twice before completion; isolated LicenseAdmin persisted `L000001` and `L000002`, while the UI showed only the second and labelled its V5 key as V6. | Accidental double click issues duplicate commercial licenses and the customer summary is misleading. | No in-flight lock/disabled pending action; hard-coded V6 summary. | Developer proof → V5 drawer → generator → LicenseAdmin shard/bundle/index. | NONE before remediation. | Required after fix. | UNVERIFIED. | None; pre-fix isolated test artifacts only. | FAIL |
| AUD-LIC-009 | Critical | Actual Electron clean-runtime proofs `current-source-20260811` and `current-source-20260811-r2`: generating `L000001` first replaced the active license through `LicenseCloud.saveLocal`; after that write was removed, `LicenseCloud.buildFromRecord` still called stateful `CenterId.ensureCenterId` and replaced `__tdw_meta__.centerId` with the customer's `NJR-CLINIC-*` center. Both restarts reported conflicting center candidates and exposed zero Owner users/device registry. | Using the Developer generator can make the licensing workstation lose its own Owner/setup authority on restart and can direct subsequent setup/sync at the customer's center. | The issuance-only generator reuses activation-oriented document building with two runtime mutations: local license save and stateful center-ID ensure. The original implementation contains both unsafe side effects. | Developer proof → V5 generator → LicenseAdmin persistence → `LicenseCloud.buildFromRecord` / `CenterId.ensureCenterId` → active license/meta mutation → SQLite authority conflict. | Partial fix removed `saveLocal`; stateful build remains at this evidence point. | Required after complete fix. | UNVERIFIED. | Existing conflicted profiles require restoring the workstation's verified license/meta; no automatic center guess is safe. | FAIL |
| AUD-UI-003 | Medium | Both actual Electron launches in clean-runtime proof emitted `Blocked unsafe UI action action_argument_denied`; diagnostic reproduction identified `MonthlyArchive.deleteTemplate(document.getElementById('ma-template-sel').value)` from `cupping-monthly-archive.js:664`. | Custom monthly-archive templates display a delete control whose action is rejected by the safe action compiler; clean startup also carries a security warning. | Legacy inline action passes a live DOM expression, while the secure action registry permits only allowlisted calls with literal arguments. | Monthly archive DOM creation → safe inline-action conversion → rejected delete handler. | NONE before remediation. | Required after fix. | UNVERIFIED. | None. | FAIL |
| AUD-QLT-004 | High | Full `npm test` left `license/registries/package-registry.json` modified with an invalid integrity signature; the failing production-security test called `electron/license-data.appendPackageToRegistry({id:'X'})` before its assertion. With no configured writable root, `electron/license-data.js:12-20,115-124` defaults mutation targets to the bundled source tree. | Tests or direct module consumers can corrupt production registry bytes; the next real generator startup fails `registry_tampered:package`. | Read fallback and mutation destination share the same `BUNDLED_ROOT` default; mutation functions do not require Main to configure the per-user `LicenseAdmin` root. | Direct license-data import/test/tool → append/write mutation → bundled registry → runtime integrity failure. | NONE before remediation; registry regenerated after reproduction. | Required after fix. | UNVERIFIED. | None; corrupted generated artifacts must be regenerated. | FAIL |
| AUD-LIC-010 | Critical | Actual Electron controlled failure proof `prefix-activation-upload-20260811`: `LicenseActivationGate.commitActivation` received a verified license, then Drive publication returned `{ok:false,error:'injected_activation_upload_failure'}`. The operation returned failure but `__tdw_license_activation_state__.consumed` was already `true`. | UI correctly stops on upload failure, but restart/local state says the activation was consumed; retry and Sheets/Drive/local state can diverge. | Local activation state, active license/meta and device setup are committed before the cloud-required Drive result is known. `LicenseCloud.pushToDrive` also saves locally before its upload response. | V5 validation/Sheets gate → activation commit → local DB/license/meta → Drive upload → failure. | NONE before remediation. | Required after fix. | UNVERIFIED. | Existing half-committed activations require reconciliation using their immutable license identity and remote artifact. | FAIL |
| AUD-BOOT-008 | High | Actual Electron controlled failure proof `.codex-validation/final-clean-runtime/prefix-boot-durability-20260811-r2/FINAL-CLEAN-RUNTIME.json`; `cloud/boot-flow-ui.js:361-366,1746-1765`; `cloud/setup-state-service.js:212-219`. | A failed final setup write throws after the UI boot-complete flag is already `1`; restart may hide the setup wizard despite an incomplete terminal commit. | Completion is local-first, the durable helper is not awaited, failures are swallowed, and the terminal handler invokes it twice before flushing settings. | READY button → SQLite finalization → BootFlow marker → best-effort setup helper/audit → settings flush → relaunch. | NONE before remediation. | Runtime failure-injection required after fix. | UNVERIFIED. | No schema change; completion marker ordering only. | FAIL |
| AUD-QLT-005 | High | Actual Electron controlled failure `.codex-validation/final-clean-runtime/prefix-cloud-v2-init-20260811/FINAL-CLEAN-RUNTIME.json`; `cloud/cloud-v2-init.js:66-90,160-173`. | Cloud V2 returns success and can display sync/backup active while an operational start Promise is rejected and unhandled. | Runtime services are launched fire-and-forget and the synchronous init summary is treated as completion. | Cloud V2 auto-enable → init → analyzer/sync/backup/bootstrap → success notification. | NONE before remediation. | Actual renderer failure-injection required. | UNVERIFIED. | None. | FAIL |
| AUD-LIC-011 | Critical | Actual Electron controlled failure `.codex-validation/final-clean-runtime/prefix-license-pull-commit-20260811/FINAL-CLEAN-RUNTIME.json`; `cloud/bootstrap.js:120-158`; `cloud/license-cloud.js:112-140`. | A downloaded verified license is reported active although SQLite rejected its local commit. | Legacy synchronous save facade ignores the asynchronous authoritative DB result and duplicates an unawaited meta write. | Drive download/verify → LicenseCloud local/meta persistence → hydrate/entitlements. | NONE before remediation. | Actual renderer commit-failure/restart regression required. | UNVERIFIED. | None; failed pull preserves prior local license. | FAIL |
| AUD-LIC-012 | Critical | Actual Electron controlled proof `.codex-validation/final-clean-runtime/prefix-activation-duplicate-publication-20260811/FINAL-CLEAN-RUNTIME.json`; `license/license-router.js:234-294`; `cloud/cloud-v2-init.js:176-224`. | One committed activation triggers two extra license uploads; a later duplicate failure produces a contradictory warning after successful activation and can overwrite the authoritative gate result. | Legacy Cloud V2 and final-guarantee publication blocks remain after `LicenseActivationGate` became the sole activation boundary. | V5 validator → activation gate/publish → CloudV2 re-save/re-publish → final re-publish → UI warning. | NONE before remediation. | Actual renderer single-publication regression required. | UNVERIFIED. | None. | FAIL |
