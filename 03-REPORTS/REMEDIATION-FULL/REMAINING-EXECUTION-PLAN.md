# Remaining Remediation Execution Plan

Baseline: `docs/remediation/AUDIT-TRACEABILITY.md`

Current checkpoint: `P0AE-INSTALLED-20260811-124PASS-BD090551`

Verified at this checkpoint: source suite `124/124`, lint PASS, isolated
installed P0-A security runtime `41/41`, and isolated installed P0-B
branch/authoritative-storage runtime `7/7`. The Setup EXE SHA-256 is
`BD090551DE62EFCA1C2C49CBBBD18F69C7888796821F04EC4AF253424DCAFF18`.
The evidence set is
`docs/remediation/evidence/P0-A-E/P0AE-INSTALLED-20260811-124PASS-BD090551/`.

These results do not close criteria requiring a real controlled Google account,
two independently operating devices, financial recovery scenarios, or an
Authenticode-signed release artifact; those remain explicitly UNVERIFIED.

This plan adds no product feature and does not replace the fixed Requirement
IDs in the traceability baseline. A phase is not PASS from source tests alone.

## Gate 0 — Preserve the Google/Cloud V2 readiness fix

1. Preserve the exact source checkpoint ZIP with SHA-256.
2. Retain the 124/124 full-suite result and focused 3/3 runtime-model test.
3. Build a new Setup EXE only from this or a later passing source state.
4. Install with a genuinely isolated `--user-data-dir` and confirm that the
   artifact contains the new test/source manifest.

Exit: the post-restart initial-sync screen recovers the valid Main OAuth state,
enables Cloud V2, and never reports the contradictory pair caused by stale
Renderer state. Explicit Google disconnect must still remain disconnected and
must rewind the wizard to the Google step.

## Gate 1 — Close remaining P0-A installed evidence

1. `AUD-SEC-008`: installed Google OAuth success plus invalid, missing and
   replayed state rejection.
2. `AUD-SEC-012`: prove session epoch invalidation across every runtime context
   that the single-instance product actually permits; document impossible
   multi-window variants as environment-limited, not PASS.
3. `AUD-SEC-013`: prove Windows safeStorage/DPAPI success and fail-closed
   behavior in a controlled unavailable-vault environment.
4. Re-run stored-XSS, forged Developer bind, unknown IPC, protected KV and
   hostile print regressions on the exact final EXE.

Exit: P0-A Gate PASS, Critical FAIL 0, Critical UNVERIFIED 0, complete evidence.

## Gate 2 — Close P0-C setup, restore and Owner recovery

1. Clean isolated installation with no center identity.
2. Connect a controlled Google test account and enumerate the full Drive
   inventory, including pagination and bounded timeout behavior.
3. Restore a real Backup V2 containing an already configured Owner credential.
4. Verify SQLite integrity, record counts, branch ownership and UI hydration.
5. Restart immediately and log in with the restored Owner password.
6. Prove that first-password setup and seed password never recur across three
   install/restart cycles.
7. Inject network loss, cancelled discovery, truncated inventory, failed pull,
   failed hydrate and failed reconcile; READY must remain impossible.
8. Verify switching Google accounts during setup without deleting license,
   branch binding or business data.

Exit: every `AUD-RST-*`, `AUD-AUTH-*`, `AUD-BOOT-*` installed criterion PASS.

## Gate 3 — Close P0-D Device A/B synchronization

Use two isolated Windows user-data profiles bound to the same controlled test
organization and separate device IDs.

1. Concurrent edits to different records.
2. Concurrent edits to the same record and field from one base revision.
3. Update/delete and offline/delete conflicts.
4. Multiple offline edits followed by reconnect.
5. Stop after outbox commit and before upload.
6. Stop after data upload and before version/index publication.
7. Duplicate delivery, stale ETag/CAS, 429, 5xx and timeout.
8. Restart both devices and compare rows, revisions, tombstones, conflicts,
   outbox and audit trail.
9. Verify that the legacy full-table writer never becomes active.

Exit: all `AUD-SYN-001..011` rows updated with exact files and evidence; Gate PASS.

## Gate 4 — Close P0-E financial, reporting, licensing and backup safety

1. Inject failure after every financial transaction stage and prove full
   rollback after restart.
2. Allocate invoices concurrently on Device A/B and prove scoped uniqueness.
3. Reconcile payment, cash, card, bank, VAT, inventory and ledger totals.
4. Finalize payroll, reject mutation, post an explicit adjustment and restart.
5. Compare UI preview, thermal, A4, PDF and export from the same report document.
6. Activate, renew, expire, downgrade and run offline with production-signed
   licenses; reject development/forged material.
7. Create, reinstall and restore Backup V2 with the OS-protected random secret;
   retain the explicit legacy-backup recovery path.

Exit: all `AUD-FIN-*`, `AUD-RPT-*`, `AUD-LIC-*`, `AUD-BKP-001` rows and evidence PASS.

## Gate 5 — Repair traceability and evidence completeness

1. Update stale P0-C/P0-D/P0-E baseline rows; never delete their history.
2. Fill exact files changed, migration results and test IDs per Requirement.
3. Create all mandatory evidence files for the final build: source manifest,
   migrations, test results, EXE manifest, install environment, runtime cases,
   failure injection, restart retest and three regression reports.
4. Record clean install, supported upgrade install, SHA-256 and Windows build.

Exit: Critical FAIL 0, Critical UNVERIFIED 0, every P0 gate PASS in order.

## Gate 6 — P1 cleanup after P0

Order:

1. `AUD-BKP-002..006`: truthful schedule, cloud retention, resumable transfer,
   honest organization scope/content disclosure and unified history.
2. `AUD-UI-001..002`: finish Owner Hub and Backup separation using the existing
   visual system; remove hidden V1 hooks and duplicated controls.
3. `AUD-CUS-001`, `AUD-FAKE-001..004`: finish or remove misleading attachment,
   provider, COM, no-op and integrity-check surfaces.
4. `AUD-PERF-001`, `AUD-QLT-001`: measured startup/render/large-data budgets and
   structured operational error propagation.
5. Installed thermal/A4/PDF, Drive quota, large backup and upgrade/downgrade UAT.

## Gate 7 — P2 maintainability

1. Remove unsupported customer-merge claims (`AUD-CUS-002`).
2. Split monolithic responsibilities incrementally (`AUD-QLT-002`) only after
   the single production paths are stable; no big-bang rewrite.

## Final commercial release gate

1. Build the production Setup EXE.
2. Apply Authenticode signing with the approved Windows code-signing identity.
3. Verify signature, SHA-256, clean install, upgrade, failure injection and
   restart on the signed bytes.
4. Release only when the traceability document states Production Candidate YES
   with no Critical FAIL or UNVERIFIED finding.
