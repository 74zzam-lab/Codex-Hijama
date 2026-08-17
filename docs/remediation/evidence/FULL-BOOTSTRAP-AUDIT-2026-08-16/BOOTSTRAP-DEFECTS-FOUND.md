# Bootstrap Defects Found

Audit date: 2026-08-16. Severity: CRITICAL / HIGH / MEDIUM / LOW.

| ID | Severity | Root cause | Runtime impact | Files | Fix | Tests |
|----|----------|------------|----------------|-------|-----|-------|
| DEF-001 | CRITICAL | Pre-auth `persistData('settings')` for Google hit RBAC | Discovery red `TDW-BOOT-RBAC_SESSION_REQUIRED` after successful OAuth; fixed by close/reopen | index.html, electron/database/service.js | `database:setupCommitGoogleConnection` Main-validated path | test-final-runtime-rbac-restore-stall.js, test-p0-c-google-state-recovery.js |
| DEF-002 | CRITICAL | Pre-download `getUserEmail` without AbortSignal; watchdog not on I/O path | Restore hangs 90–120s at 0 bytes; misleading background message | cloud-service.js, google-drive-api.js, backup-v2-ipc.js, byte-progress-watchdog.js | `skipProviderResolve`, `raceAbort`, Main watchdog | test-final-runtime-rbac-restore-stall.js, test-bootstrap-desktop-button-restore.js |
| DEF-003 | HIGH | Coordinator `sync` on EXISTING skipped `owner_auth` | Resume/checklist could show sync reachable while Next blocked | bootstrap-coordinator.js | Require owner_auth in isStepResolved sync case | test-bootstrap-navigation-model.js coordinatorSyncOwnerAuthTests |
| DEF-004 | HIGH | Six parallel step arrays | Header/checklist/body step number drift | bootstrap-step-model.js + consumers | Delegate stepsFor to step model; load order fix | test-bootstrap-navigation-model.js |
| DEF-005 | HIGH | Next button not re-rendered after Google OAuth | Next stuck disabled; change account hidden | boot-flow-ui.js | renderStepUI after OAuth; disabled=!validateStep\|\|inFlight | BOOTSTRAP-BUTTON-STATE-MATRIX, desktop UAT |
| DEF-006 | MEDIUM | Dual error display (specific + generic) | User sees RBAC + TDW-BOOT-ERR together | bootstrap-failure-policy-contract.js, boot-flow-ui.js | formatFailureForStatus single primary | test-bootstrap-red-message-truthfulness.js |
| DEF-007 | MEDIUM | IPC errors collapsed to "Error invoking remote method" | No stage/code/operationId in UI | backup-v2-ipc.js, ipc-error-envelope.js | Structured reject + diagnostic RST-* | restore regression tests |
| DEF-008 | MEDIUM | `completedSteps` still written while marked non-authoritative | Stale checklist DONE risk | boot-flow-ui.js | Display uses deriveCompletedSteps; gates don't trust completedSteps alone | stage-19 tests |
| DEF-009 | MEDIUM | Escape dismiss during discovery/device ops | Inconsistent with dismissBootstrap guards | boot-flow-ui.js onDialogKeydown | Documented; Escape omits some in-flight flags | manual |
| DEF-010 | LOW | bootstrap-gates getStepInventory stale positions | Docs/inventory only | bootstrap-gates.js | Not runtime-affecting | — |
| DEF-011 | LOW | oauthLockAt persisted but unused | Restart mid-OAuth loses KV lock semantics | boot-flow-ui.js | oauthInFlight module guard is actual authority | — |

## Historical defects (AC) — regression coverage

| # | Defect | Status |
|---|--------|--------|
| 1 | Wizard multiple clicks to open | FIXED — tryOpen backoff |
| 2 | Modal clipped | FIXED — modal width CSS |
| 3 | Google → RBAC red | FIXED — DEF-001 |
| 4 | Google twice | FIXED — oauthInFlight guard |
| 5 | Change-account missing | FIXED — render after connect |
| 6 | Next stuck disabled | FIXED — DEF-005 |
| 7 | Branch DONE without confirm | FIXED — branchSelection.provenance |
| 8 | Header/body/checklist mixed | FIXED — BootstrapStepModel |
| 9 | Restore fake 13/15/21% | FIXED — truthful stage labels |
| 10 | Password modal hidden | FIXED — z-index stacking |
| 11 | Restore hang >90s no byte | FIXED — DEF-002 |
| 12 | Error collapsed generic | FIXED — DEF-007 |
| 13 | Start empty impossible Owner | FIXED — existingEmptyStartPolicy |
| 14 | Close/reopen repairs state | FIXED — DEF-001 hydration path |
| 15 | Stale red after success | FIXED — clear on success + single primary error |

## Patch conflicts resolved

| Conflict | Resolution |
|----------|------------|
| Settings write vs setup commit for Google | Setup commit only |
| Renderer stall vs Main watchdog timing | Both active; renderer covers pre-download via lastByteProgressAt at IPC entry |
| Coordinator vs validateStep sync gates | Aligned owner_auth requirement |
| completedSteps vs deriveCompletedSteps | Display uses derived |
| Background download message vs terminal stall | Message removed; terminal abort at 45s |
