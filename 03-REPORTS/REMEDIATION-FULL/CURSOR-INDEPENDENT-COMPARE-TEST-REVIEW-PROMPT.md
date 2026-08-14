# Cursor Prompt — Independent Original-vs-Current Review, Test and Regression Audit

Copy everything below this line into Cursor after extracting the handoff bundle.

---

You are performing an independent pre-production engineering review of two complete source archives for the same Electron application.

## Inputs

- Original source archive: `01-ORIGINAL/ORIGINAL-V2-5-9-SOURCE.zip`
- Current source archive: `02-CURRENT/CURRENT-FINAL-RESTORE-SOURCE.zip`
- Original SHA-256: `01e89d6fc161530ae03690865062827bbdecbb7ca58b3e0fe331909a9536b0cc`
- Current SHA-256: `9c0339cc9cb6a039e859c61a32dd1b586517950103eceac70634a2c8a146ad9d`
- Reports and previous evidence: `03-REPORTS/`

The reports are context only. Do not trust their conclusions, PASS labels, line numbers, assumptions or claimed implementations. Verify everything from the two actual source trees and runtime behavior.

## Product-owner constraints

1. Preserve the current visual UI and Arabic-first design. Do not perform an unrelated redesign.
2. Preserve the intentional Developer-password login, its current password, its UI and intended support capabilities.
3. A Renderer must never bind `__dev__`, Owner or Admin without successful trusted Main authentication/proof.
4. Preserve the requested V5 licence-generation workflow and existing Sheets-row workflow for this review. Explicitly report its embedded-shared-secret commercial risk; do not silently remove it or weaken its tests.
5. Do not add new features.
6. Do not revive Backup V1, raw operational localStorage writes, full-table production sync or default-allow IPC.
7. Do not alter expected tests to match a bug, delete tests, disable guards, swallow errors or mark mock/static evidence as installed-runtime PASS.
8. Never mutate real user data, production Drive files, Sheets rows, OAuth credentials or Windows profiles. Use isolated/disposable profiles and test artifacts. Real-cloud operations are read-only unless the owner gives separate explicit mutation authorization.

## Required work order

### Stage 1 — Preserve and identify both inputs

1. Verify both SHA-256 values before extraction.
2. Extract the two archives into separate directories. Never copy one over the other.
3. Record package name/version, Node/Electron versions, dependency inventories, build configuration and top-level file trees.
4. Confirm the current archive contains no `.codex-*`, `node_modules`, `dist`, userData, tokens, `license/data`, private keys or local profiles.

### Stage 2 — Produce a real code comparison

Perform content-based and semantic comparison, not timestamp comparison.

Report:

- added, deleted, renamed and modified files;
- dependency and package-script changes;
- database schema/migration changes;
- preload/IPC/RBAC policy changes;
- all persistence and Source-of-Truth changes;
- all branch/context changes;
- sync protocol and outbox changes;
- backup/restore changes;
- BootFlow/setup/Owner credential changes;
- OAuth/Drive/Sheets/licensing changes;
- financial/reporting/printing changes;
- Owner Hub and Backup UI changes;
- installer/packaging changes;
- test and evidence changes;
- dead or duplicate paths retained from the original;
- regressions introduced by the current version.

For each material change state:

- original behavior and exact evidence;
- current behavior and exact evidence;
- intended or accidental;
- security/data/branch/runtime impact;
- compatibility and migration impact;
- test that proves it;
- status: `PASS`, `FAIL` or `UNVERIFIED`.

### Stage 3 — Independently trace every critical runtime journey

Trace caller -> preload -> IPC -> Main authorization -> service/repository -> SQLite transaction -> outbox/cloud -> UI result for:

1. Startup/pre-auth hydrate/login/logout/restart.
2. Intentional Developer authentication and forged `__dev__` rejection.
3. Owner creation, first-password change, existing Owner login and no seed recurrence.
4. Google connect, callback state/PKCE, refresh, disconnect and account switching.
5. Licence key validation, Sheets lookup/consume, Drive pull/upload, local commit and restart.
6. First organization/branch/device setup.
7. Additional branch enrollment and Device B binding.
8. Local Backup V2 create/verify/restore.
9. Cloud Backup V2 discovery/download/restore.
10. Legacy V3 encrypted restore with correct and incorrect password.
11. Initial sync after restore and after clean setup.
12. Device A/B concurrent writes, duplicate delivery, offline/reconnect, delete/update conflict and restart.
13. Client/visit/invoice/payment/inventory/cash/audit/ledger transaction.
14. Payroll finalization and adjustment.
15. Branch-scoped reports and Owner aggregate reports.
16. Preview/thermal/A4/PDF using hostile stored text.
17. Owner Hub destructive and branch/device actions.
18. Installer keep-data, fresh-start archive and uninstall modes.

Do not infer that a journey works because a button, function, handler or test exists. Follow the executed path and every awaited result.

### Stage 4 — Bug and security search

Search the current source for:

- missing `await`, ignored Promise results and fire-and-forget authoritative operations;
- structured-clone violations across contextBridge/IPC;
- stale Renderer state overriding SQLite/Main state;
- raw `innerHTML`, inline actions and unsafe print HTML;
- default-allow or missing IPC policies;
- Renderer-controlled role, source, center or branch claims;
- protected KV bypass;
- full-table replacement or last-write-wins paths;
- non-atomic data/outbox or data/version publication;
- missing transaction rollback;
- branchless financial/identity records;
- duplicate invoice/user/payroll uniqueness gaps;
- duplicate activation/publication calls;
- licence validation that ignores commit failure;
- restore paths that mutate before verification;
- setup-only classifier false positives/negatives;
- backup password Promise/non-cloneable objects;
- localStorage/SQLite/window/lexical split state;
- race conditions, stale cache, timer leaks and unhandled rejection;
- hardcoded/development keys, private keys, secrets and packaged fixtures;
- misleading UI success, fake providers, no-op controls and dead code;
- cross-platform/path/Windows installer faults;
- package content that leaks profiles, tokens or test customer data.

Pay special attention to these current incidents and prove they are fixed or reproduce them:

- `An object could not be cloned` during Backup V2 download.
- only Owner visible after restore.
- correct Owner/staff password rejected after restore.
- valid restored licence shown as inactive after restart.
- `configuration_pull_incomplete` after a verified full-database restore.
- setup-only SQLite rows blocking restore.
- Device B inheriting Device A UUID/branch identity.
- newest sparse backup hiding older recovery points.
- discovery leaving SyncEngine stopped.
- activation or licence pull reporting success after local/cloud commit failure.

### Stage 5 — Test the original and current versions separately

Never run mutable tools against the only extracted copy. Work from disposable copies.

For each version:

1. Record Node/npm versions.
2. Run a clean dependency install using the lockfile.
3. Run lint.
4. Run the complete test suite exactly as declared.
5. Run all focused security/database/restore/sync/licensing/financial tests.
6. Record every failed group, full assertion, exit code and whether failure is product, test, environment or historical-artifact related.
7. Confirm tests do not modify bundled licence registries or source fixtures.
8. Compare test coverage and identify source-regex/mock-only tests.

For the current version additionally run:

- stored-XSS corpus across clients, users, employees, doctors, reports, Owner Hub, printing and restored legacy payloads;
- IPC coverage: preload channel -> Main handler -> explicit policy -> unauthenticated/low-role/authorized result;
- SQLite integrity/FK/quarantine/schema checks;
- wrong-password restore no-mutation test;
- staged restore failure and rollback;
- process restart after every critical commit/failure boundary;
- large dataset/outbox and pagination tests;
- packaging inventory and secret/profile scan.

### Stage 6 — Windows build and installed runtime

If the Windows environment and required configuration are available:

1. Build the current source with the production build command.
2. Record EXE name, size and SHA-256.
3. Install to a clean isolated path/profile.
4. Confirm installed `app.asar` critical files match current source.
5. Execute security, setup, restore, login, licence, branch, sync, failure-injection and restart scenarios against the installed bytes.
6. Record page, console, Main, IPC and security errors.
7. Check Authenticode status.

If any step cannot be run, mark the corresponding result `UNVERIFIED`; do not replace it with source inspection or a mocked PASS.

### Stage 7 — Fix only proven regressions, then retest

After the independent report is captured, you may implement minimal fixes only for defects reproduced in the current version, subject to the product-owner constraints above.

For every fix:

`INSPECT -> REPRODUCE -> ROOT CAUSE -> IMPLEMENT -> MIGRATE -> FOCUSED TEST -> FULL TEST -> BUILD -> INSTALL -> FAILURE INJECTION -> RESTART -> RETEST -> EVIDENCE`

Do not perform architecture rewrites or broad cleanup while fixing a bounded defect. Reuse the single current production path.

### Stage 8 — Required final deliverables

Create:

1. `INDEPENDENT-ORIGINAL-VS-CURRENT-REVIEW.md`
2. `FILE-DIFF-MANIFEST.json`
3. `TEST-RESULTS.json`
4. `BUG-REGISTER.md`
5. `SECURITY-REVIEW.md`
6. `DATA-BRANCH-SYNC-RESTORE-REVIEW.md`
7. `WINDOWS-INSTALLED-EVIDENCE.md` or an explicit `UNVERIFIED` record.
8. If fixes were made, `FIX-TRACEABILITY.md` containing finding -> files -> tests -> runtime evidence.

The final report must include:

- executive verdict;
- confirmed improvements;
- confirmed regressions;
- bugs grouped Critical/High/Medium/Low;
- exact evidence and reproduction for every bug;
- original vs current behavior per subsystem;
- failed and unverified tests;
- data-loss/security/branch risk;
- dead/duplicate/fake paths;
- migration and backward-compatibility risk;
- remaining release blockers;
- ordered remediation plan;
- `Production Candidate: YES/NO`;
- `Ready for commercial release: YES/NO`.

## Known product decision that must remain visible

The current product intentionally retains the in-app Legacy V5 generator. Functional generation may pass while the commercial security gate fails because shared HMAC signing material is distributed in the customer Renderer. Report both truths. Do not call the product commercially secure merely because Developer UI authentication works.

## Completion standard

Be evidence-driven and brutally honest. A report, UI, button, test or service name is not proof. Unknown means `UNVERIFIED`. Any current-source Critical `FAIL` or Critical `UNVERIFIED` keeps the release at `NO-GO`.

---

