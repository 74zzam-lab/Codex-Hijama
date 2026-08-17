# Bootstrap Current Call Graph

Traced from production code paths (not comments). Each step lists: stepId, display, body renderer, completion, authority, writes, IPC, async owner.

## NEW customer journey

### 1. language
- **Display:** الخطوة 1 من 13–14
- **Body:** `renderStepUI` → language buttons
- **Complete when:** `wizard.lang` set
- **Authority:** `__tdw_boot_wizard__.lang`
- **Writes:** wizard KV, `localStorage` LANG_KEY
- **IPC:** none
- **Next:** `advanceWizard` → BootstrapStepModel.getNextStep

### 2. license
- **Body:** activation key form + Drive pull
- **Complete when:** `hasValidLicense()` — LicenseCloud consumed
- **Authority:** `__tdw_cloud_license__` + activation markers
- **IPC:** `database:setupCommitActivation`, `backup:uploadActivationArtifact`, `license:vaultRequest`
- **Async owner:** `runLicenseGate` / activation handlers
- **Retry:** license recovery, vault timeout 120s

### 3. google
- **Body:** connect / change / disconnect buttons
- **Complete when:** `DriveAdapter.isConnected()` + setup commit
- **Authority:** Main token store → `database:setupCommitGoogleConnection` → settings projection
- **IPC:** `backup:startOAuth`, `backup:getCloudStatus`, `database:setupCommitGoogleConnection`
- **Async owner:** `runGoogleConnect` with `oauthInFlight` guard
- **Error owner:** `BootstrapFailurePolicyContract` (oauth_*, secure_storage)

### 4. discovery
- **Body:** discovery progress + rescan
- **Complete when:** `PostGoogleCloudDiscovery.hasDiscoveryResolved()`
- **Authority:** discovery cache keyed by Google account email
- **IPC:** `backup:discoverCloudRestorePoints`, `backup:listCloudBackups`
- **Timeout:** 180s overall (`DISCOVERY_TIMEOUT_MS`)
- **Pre-fix defect:** RBAC on settings write — now uses setup commit path

### 5. path_decision (conditional)
- **Complete when:** `forkDecision` ∈ {start_new, use_existing}
- **Authority:** wizard.forkDecision + discovery fingerprint
- **Writes:** path, fork fields, invalidates downstream on change

### 6–14. organization → ready
(See architecture doc for gate mapping.)

**Restore sub-chain (step 12):**
```
UI "استعادة" click
  → CloudDataDiscovery.confirmedCloudRestore(point, {password})
  → restoreCloudBackupFile
  → preload.v2SetupCloudRestore (IPC backup:v2:setupCloudRestore)
  → backup-v2-ipc.runSetupCloudRestore
    → resolveSetupRestorePassword
    → captureSetupRestoreState (SQLite readonly 5s)
    → createByteProgressWatchdog.arm()
    → cloudService.downloadCloudBackup({skipProviderResolve:true, signal})
    → googleDrive.downloadBackup → downloadByPath (streamed)
    → decrypt → sqlite swap → hydrate
  → RestoreReconciliation
  → wizard.restoreChoice = cloud
```

## EXISTING customer journey

### 5. branch_select
- **Complete when:** `wizard.branchSelection.provenance === 'user'|'created'`
- **NOT satisfied by:** `pendingBranchId`, `DeviceConfig.lockedBranchId` alone, `completedSteps`
- **IPC:** none at selection; prior discovery IPC
- **User action:** explicit confirm even for single branch

### 8. owner_auth
- **Complete when:** `ownerAuthStepResolved()` — credential + RBAC session
- **IPC:** `rbac:authenticateUser`, `rbac:bindSession`
- **Blocks sync** until resolved (validateStep + coordinator aligned)

### 9. sync
- **Direction:** PULL_ONLY (`InitialSyncDirectionContract`)
- **Complete when:** `meta.bootstrapCompletedAt` or initial sync completion record
- **NOT authoritative:** `wizard.syncDone`

## Resume behavior

```
openBootstrap()
  → normalizeWizardFlowState() [version migration]
  → BootstrapCoordinator.resolveResumeStepIndex(path)
  → isStepResolved() per step in sequenceFor(path)
  → first unresolved → currentStep index via BootstrapStepModel
```

## Dismiss / reopen

- `dismissBootstrap()` blocked when `isCriticalOpInFlight()`
- Reopen re-hydrates Google from Main via `refreshGoogleConnectionState({acceptLiveReconnect:true})`
- Close/reopen no longer required to repair Google→Discovery RBAC (fixed setup commit path)
