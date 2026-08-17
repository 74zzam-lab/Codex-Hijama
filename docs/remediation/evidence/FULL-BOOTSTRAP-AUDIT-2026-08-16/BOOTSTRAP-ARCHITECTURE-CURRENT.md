# Bootstrap Architecture — Current State

**Audit date:** 2026-08-16  
**Source commit:** `44ead5877b371fc7ca9ef3a6141ae5c5fb689d55` (+ audit remediation commits on branch)

## Layered model

```
Renderer UI (boot-flow-ui.js)
  → BootstrapStepModel (step order, X/Y, Next/Back)
  → BootstrapCoordinator (resume index, derived completedSteps — display only)
  → BootstrapGates (read-only gate predicates)
  → SetupStateService + contracts (business predicates)
  → IPC (preload allowlist → Main RBAC → handlers)
  → SQLite / cloud providers
  → structured result → authoritative state → re-render
```

## Authoritative modules

| Concern | Authority |
|---------|-----------|
| Step order & navigation | `cloud/bootstrap-step-model.js` |
| Step validation (Next) | `BootFlow.validateStep()` in `boot-flow-ui.js` |
| Resume index | `BootstrapCoordinator.resolveResumeStepIndex()` |
| Checklist display | `bootstrap-checklist-contract.js` → delegates to step model |
| Gate truth | BootFlow predicates + `SetupStateService` + contracts |
| READY | `ReadyPureEvaluator` via `SetupStateService.evaluateReady()` |
| Wizard KV | `__tdw_boot_wizard__` — UI progress only, not business SoT |

## NEW customer flow (14 steps max, 13 without fork)

| # | stepId | Title | Gate authority |
|---|--------|-------|----------------|
| 1 | language | اللغة | wizard.lang |
| 2 | license | التفعيل والترخيص | LicenseCloud + activation commit |
| 3 | google | ربط Google | Main OAuth + `database:setupCommitGoogleConnection` |
| 4 | discovery | اكتشاف السحابة | PostGoogleCloudDiscovery cache |
| 5 | path_decision | اختيار المسار | forkDecision (conditional) |
| 6 | organization | المؤسسة | center data + org commit |
| 7 | owner | حساب المالك | OwnerManagement credential |
| 8 | branch | إنشاء أول فرع | branch created + selection |
| 9 | device | تسجيل الجهاز | DeviceConfig |
| 10 | business_setup | إعداد بيانات المركز | BusinessSetupContract |
| 11 | publication | نشر الإعداد | PublicationGate + Readback |
| 12 | restore | مصدر البيانات | wizard.restoreChoice |
| 13 | sync | المزامنة الأولية | meta.initialSyncCompletion / PUSH |
| 14 | ready | الجاهزية | evaluateReady() |

## EXISTING customer flow (10 steps)

| # | stepId | Title | Gate authority |
|---|--------|-------|----------------|
| 1 | language | اللغة | wizard.lang |
| 2 | google | ربط Google | Main OAuth + setup commit |
| 3 | discovery | اكتشاف السحابة | PostGoogleCloudDiscovery |
| 4 | license_org_recovery | استرداد الترخيص والمؤسسة | license + org from cloud |
| 5 | branch_select | اختيار فرع موجود | wizard.branchSelection (provenance=user) |
| 6 | device | تسجيل الجهاز | DeviceConfig after branch |
| 7 | restore | مصدر البيانات | restoreChoice / reconciliation |
| 8 | owner_auth | تحقق المالك | Owner session + credential |
| 9 | sync | المزامنة الأولية | PULL_ONLY via InitialSyncDirectionContract |
| 10 | ready | الجاهزية | evaluateReady() |

**Hidden on EXISTING (auto-resolved):** business_setup, publication, readback — via `ExistingShortPathContract`.

## State machine invariants (post-audit)

1. `stepId` is authoritative; displayed X/Y derives from `BootstrapStepModel.getApplicableSteps`.
2. Next / Back / Resume / Checklist / Header / Body all use the same applicable-step sequence.
3. EXISTING branch requires explicit user confirmation — no `auto_single`, `pendingBranchId`, or `lockedBranchId` alone satisfies the gate.
4. EXISTING sync requires `owner_auth` before completion (coordinator aligned with `validateStep` in this audit).
5. READY is pure — no `wizard.completedSteps` or stale `syncDone` may create false READY.
6. Google connection commits via Main-validated `database:setupCommitGoogleConnection` — no pre-auth `persistData('settings')`.

## Patch consolidation (this audit)

| Change | Rationale |
|--------|-----------|
| `bootstrap-step-model.js` loads before coordinator in `index.html` | Runtime `stepsFor()` delegation needs model present |
| `stepsFor()` in coordinator, boot-flow-ui, gates delegates to step model | Single runtime sequence source |
| Coordinator `sync` on EXISTING requires `owner_auth` | Fixed resume/checklist drift vs Next button |
| Restore stall: Main `ByteProgressWatchdog` + `skipProviderResolve` + `raceAbort` | Pre-download hang before first byte |
| Removed misleading "قد يستمر التنزيل في الخلفية" | Terminal stall must abort, not imply background continuation |

## Remaining compatibility layers (intentional)

- `LEGACY_*_STEPS` arrays in `boot-flow-ui.js` for `wizardFlowVersion` migration only
- `completedSteps` in wizard KV — written for migration, derived for display
- `getStepCatalog().NEW_STEPS` export — mirrors step model for tests
