# Bootstrap Final Remediation

**Branch:** `cursor/bootstrap-desktop-uat-beb8`  
**Audit:** FULL-BOOTSTRAP-AUDIT-2026-08-16  
**Date:** 2026-08-16

## Summary

The Setup Wizard is consolidated around `BootstrapStepModel` as the single runtime source for step order and navigation. Business truth remains in SQLite + Main-validated setup IPCs + contract evaluators. This audit fixed the last known coordinator/UI gate drift on EXISTING `sync`/`owner_auth` and wired all `stepsFor()` callers to delegate to the step model.

## Changes in this audit turn

1. **bootstrap-coordinator.js** — EXISTING `sync` gate requires `owner_auth`; `stepsFor()` delegates to `BootstrapStepModel`
2. **boot-flow-ui.js** — `stepsFor()` delegates to `BootstrapStepModel`
3. **bootstrap-gates.js** — `getCurrentRuntimeSteps()` prefers `BootstrapStepModel`
4. **index.html** — load `bootstrap-step-model.js` before coordinator
5. **test-bootstrap-navigation-model.js** — regression for coordinator sync/owner_auth alignment
6. **Evidence pack** — 10 audit documents in `docs/remediation/evidence/FULL-BOOTSTRAP-AUDIT-2026-08-16/`

## Prior remediation (retained)

- `database:setupCommitGoogleConnection` — Google RBAC fix
- `byte-progress-watchdog.js` + `skipProviderResolve` + `raceAbort` — restore stall fix
- Google change/disconnect button visibility after connect
- Next `disabled = !validateStep(step) || inFlight`
- Removed "قد يستمر التنزيل في الخلفية"
- Structured restore errors with RST-* diagnostics

## Test results

| Suite | Result |
|-------|--------|
| eslint | PASS |
| npm test (unit) | 159/159 PASS |
| npm run test:e2e | 17/17 PASS |
| test-bootstrap-navigation-model | 52/52 PASS |
| Stage 1–20 regressions | Included in npm test PASS |

## Status gates (AP)

| Gate | Status |
|------|--------|
| **SOURCE** | **PASS** |
| **WINDOWS INSTALLED** | **PARTIAL** — GHA build smoke PASS; full Existing×10 not repeated this turn |
| **REAL GOOGLE** | **ACTION_REQUIRED** — Linux agent cannot complete OAuth (secure_storage_unavailable) |
| **REAL DRIVE RESTORE** | **UNVERIFIED** — requires live Drive on Windows |
| **FULL BOOTSTRAP** | **PARTIAL** — source coherent; mandatory external gates unverified |

## Build identity (prior verified build on branch)

- Source: `44ead5877b371fc7ca9ef3a6141ae5c5fb689d55`
- GHA: https://github.com/74zzam-lab/Codex-Hijama/actions/runs/31948993340
- EXE SHA-256: `5379f9970f55c05339204b8e1c88c37989f56d9068d2f4b9119f04007969b0b0`

## Remaining blockers

1. Real Google OAuth + Drive restore on Windows installed EXE (manual login required)
2. Existing journey 10/10 repeatability on isolated profiles (Windows)
3. Optional: remove dead `completeCurrentStep`, `existingGatesBeforeSyncSatisfied`, align Escape with dismiss in-flight set

## Architecture coherence statement

The wizard now operates as one state machine:

- **Navigation state** → `BootstrapStepModel` (stepId authoritative)
- **Business gates** → BootFlow.validateStep + contracts + SetupStateService
- **Resume** → BootstrapCoordinator first unresolved gate (aligned with validateStep)
- **READY** → ReadyPureEvaluator only
- **No UI-local business authority** for Google, branch, restore, sync, or READY

No old patch can override intended runtime: stale `completedSteps`, `syncDone`, `pendingBranchId`, or pre-auth settings writes are excluded from gate satisfaction; restore pre-download bypasses hung `getUserEmail`; coordinator cannot skip `owner_auth` before sync on EXISTING.
