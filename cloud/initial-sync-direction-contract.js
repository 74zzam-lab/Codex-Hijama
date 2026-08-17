/**
 * Stage 15 — Initial sync direction contract (read-only plan evaluation).
 * Authority: scenario-derived plan + durable meta.initialSyncCompletion — not wizard.syncDone.
 */
(function (global) {
  'use strict';

  const MODES = Object.freeze({
    PULL_ONLY: 'PULL_ONLY',
    PUSH_ONLY: 'PUSH_ONLY',
    RECONCILE: 'RECONCILE',
    NO_SYNC: 'NO_SYNC',
    RESUME_PENDING: 'RESUME_PENDING',
  });

  const SOURCE_AUTHORITY = Object.freeze({
    LOCAL: 'local',
    REMOTE: 'remote',
    RESTORED: 'restored',
    NONE: 'none',
  });

  const RESTORE_CHOICES = Object.freeze(['empty', 'cloud', 'skip_existing', 'local', 'file']);

  function readMeta(snapshot) {
    if (snapshot?.meta) return snapshot.meta;
    try { return global.DB?.get?.('__tdw_meta__', {}) || {}; } catch { return {}; }
  }

  function readWizard(snapshot) {
    if (snapshot?.wizard) return snapshot.wizard;
    try { return global.DB?.get?.('__tdw_boot_wizard__', {}) || {}; } catch { return {}; }
  }

  function readDeviceConfig(snapshot) {
    if (snapshot?.deviceConfig) return snapshot.deviceConfig;
    try { return global.DeviceConfig?.load?.() || global.DB?.get?.('__tdw_device_config__', {}) || {}; } catch { return {}; }
  }

  function discoveryStatus(wizard) {
    return String(wizard?.cloudDiscovery?.result?.status || wizard?.cloudDiscovery?.status || '').trim();
  }

  function isExistingBusinessOnCloud(wizard) {
    if (wizard?.forkDecision === 'use_existing') return true;
    if (wizard?.path === 'existing') return true;
    return discoveryStatus(wizard) === 'existing_business_found';
  }

  function isReplacementDevice(context) {
    const wizard = context.wizard || {};
    if (context.path === 'existing' || wizard.path === 'existing') return true;
    if (wizard.forkDecision === 'use_existing') return true;
    if (isExistingBusinessOnCloud(wizard)) return true;
    return context.restoreChoice === 'cloud';
  }

  /**
   * Bootstrap-only rows are not authoritative full business dataset.
   */
  function classifyBootstrapOnlyState(context) {
    const clients = Number(context.operationalCounts?.clients ?? context.clientsCount ?? 0);
    const cases = Number(context.operationalCounts?.cases ?? context.casesCount ?? 0);
    const bookings = Number(context.operationalCounts?.bookings ?? context.bookingsCount ?? 0);
    const operationalTotal = clients + cases + bookings;
    const hasBootstrapIdentity = !!(
      context.organizationId
      || context.branchId
      || context.deviceId
      || context.wizard?.restoreChoice
    );
    return {
      operationalTotal,
      isBootstrapOnly: operationalTotal === 0 && hasBootstrapIdentity,
      hasOperationalData: operationalTotal > 0,
      counts: { clients, cases, bookings },
    };
  }

  function remoteHasBusinessData(context) {
    if (context.remoteHasBusinessData === true) return true;
    const wizard = context.wizard || {};
    if (isExistingBusinessOnCloud(wizard)) return true;
    if (discoveryStatus(wizard) === 'existing_business_found') return true;
    if (context.restoreChoice === 'cloud') return true;
    return false;
  }

  function emptyLocalPushBlocked(context, classification) {
    if (!isReplacementDevice(context) && context.path !== 'existing') {
      if (context.restoreChoice !== 'cloud') return false;
    }
    if (!remoteHasBusinessData(context)) return false;
    if (classification?.hasOperationalData) return false;
    return classification?.isBootstrapOnly === true || context.localBusinessEmpty === true;
  }

  function publicationResolved(context) {
    if (context.meta?.bootstrapCompletedAt) return true;
    const PC = global.PublicationContract;
    if (PC?.isResolved) {
      return PC.isResolved({
        meta: context.meta,
        path: context.path,
        setupPublication: context.meta?.setupPublication,
      });
    }
    return !!context.meta?.setupPublication?.verifiedAt;
  }

  function readbackVerified(context) {
    if (context.meta?.bootstrapCompletedAt) return true;
    const RVC = global.ReadbackVerificationContract;
    if (RVC?.isVerified) {
      return RVC.isVerified({
        meta: context.meta,
        readbackVerification: context.meta?.readbackVerification,
        path: context.path,
      });
    }
    return context.meta?.readbackVerification?.state === 'VERIFIED';
  }

  function restoreGateState(context) {
    const wizard = context.wizard || {};
    const reconcile = context.restoreReconcile || null;
    const choice = context.restoreChoice || wizard.restoreChoice || null;
    const restoreFailed = context.restoreFailed === true || reconcile?.phase === 'failed';
    const restoreCancelled = context.restoreCancelled === true;
    const restoreInProgress = context.restoreInProgress === true
      || reconcile?.phase === 'reconciling'
      || global.CloudDataDiscovery?.isRestoreLocked?.();
    const restoreComplete = context.restoreComplete === true
      || wizard.restoreVerifiedDatabase === true
      || (choice && RESTORE_CHOICES.includes(choice) && !restoreFailed && !restoreCancelled && !restoreInProgress);
    return { choice, restoreFailed, restoreCancelled, restoreInProgress, restoreComplete };
  }

  function buildPlanBinding(context, mode) {
    return {
      organizationId: String(context.organizationId || context.meta?.centerId || '').trim(),
      branchId: String(context.branchId || context.deviceConfig?.lockedBranchId || '').trim(),
      deviceId: String(context.deviceId || context.deviceConfig?.deviceUuid || '').trim(),
      path: context.path || context.wizard?.path || null,
      restoreChoice: context.restoreChoice || context.wizard?.restoreChoice || null,
      restoreVerifiedDatabase: context.wizard?.restoreVerifiedDatabase === true,
      publicationBinding: context.meta?.readbackVerification?.binding || null,
      mode,
    };
  }

  function bindingFingerprint(binding) {
    const raw = JSON.stringify(binding);
    let h = 0;
    for (let i = 0; i < raw.length; i++) { h = ((h << 5) - h) + raw.charCodeAt(i); h |= 0; }
    return `isb${(h >>> 0).toString(16)}`;
  }

  function planResult(mode, reason, fields) {
    const base = {
      mode,
      reason,
      sourceAuthority: SOURCE_AUTHORITY.NONE,
      allowPush: false,
      allowPull: false,
      allowOutboxDrain: false,
      requiresHydration: false,
      requiresRestoreComplete: false,
      requiresPublicationVerified: false,
      requiresReadbackVerified: false,
      syncEngineDirection: null,
      operation: null,
      emptyLocalPushBlocked: false,
      binding: null,
      bindingFingerprint: null,
    };
    return Object.assign(base, fields || {});
  }

  /**
   * Read-only — no sync, writes, hydrate, upload, or SQLite mutation.
   */
  function resolveInitialSyncPlan(context) {
    context = context || {};
    const meta = readMeta(context);
    const wizard = readWizard(context);
    const deviceConfig = readDeviceConfig(context);
    const path = context.path || wizard.path || 'new';
    const restoreChoice = context.restoreChoice || wizard.restoreChoice || null;
    const restoreReconcile = context.restoreReconcile
      || (typeof global !== 'undefined' && global.RestoreReconciliation?.loadState?.())
      || null;
    const classification = classifyBootstrapOnlyState({
      ...context,
      wizard,
      organizationId: context.organizationId || meta.centerId,
      branchId: context.branchId || deviceConfig.lockedBranchId,
      deviceId: context.deviceId || deviceConfig.deviceUuid,
    });
    const emptyBlocked = emptyLocalPushBlocked({
      ...context,
      path,
      wizard,
      restoreChoice,
    }, classification);
    const restore = restoreGateState({
      ...context,
      wizard,
      restoreReconcile,
      restoreChoice,
      meta,
    });
    const bindingCtx = {
      meta,
      wizard,
      deviceConfig,
      path,
      restoreChoice,
      organizationId: context.organizationId || meta.centerId || deviceConfig.centerId,
      branchId: context.branchId || deviceConfig.lockedBranchId,
      deviceId: context.deviceId || deviceConfig.deviceUuid,
    };

    if (meta.bootstrapCompletedAt) {
      const mode = MODES.NO_SYNC;
      const binding = buildPlanBinding(bindingCtx, mode);
      return planResult(mode, 'bootstrap_already_complete', {
        sourceAuthority: SOURCE_AUTHORITY.LOCAL,
        binding,
        bindingFingerprint: bindingFingerprint(binding),
      });
    }

    const stored = meta.initialSyncCompletion;
    if (stored?.completedAt && stored?.bindingFingerprint) {
      const expected = bindingFingerprint(buildPlanBinding(bindingCtx, stored.mode || MODES.RESUME_PENDING));
      if (stored.bindingFingerprint === expected) {
        return planResult(MODES.NO_SYNC, 'initial_sync_already_resolved', {
          sourceAuthority: stored.sourceAuthority || SOURCE_AUTHORITY.LOCAL,
          binding: stored.binding || buildPlanBinding(bindingCtx, stored.mode),
          bindingFingerprint: stored.bindingFingerprint,
          durableMarker: stored,
        });
      }
    }

    if (restore.restoreFailed || restore.restoreCancelled) {
      return planResult(MODES.NO_SYNC, restore.restoreFailed ? 'restore_failed' : 'restore_cancelled', {
        requiresRestoreComplete: true,
        binding: buildPlanBinding(bindingCtx, MODES.NO_SYNC),
      });
    }

    if (restore.restoreInProgress) {
      return planResult(MODES.NO_SYNC, 'restore_in_progress', {
        requiresRestoreComplete: true,
        binding: buildPlanBinding(bindingCtx, MODES.NO_SYNC),
      });
    }

    const pending = meta.initialSyncPlan;
    if (pending?.mode && pending?.bindingFingerprint) {
      const currentFp = bindingFingerprint(buildPlanBinding(bindingCtx, pending.mode));
      if (pending.bindingFingerprint === currentFp) {
        return planResult(MODES.RESUME_PENDING, 'resume_pending_plan', {
          sourceAuthority: pending.sourceAuthority || SOURCE_AUTHORITY.REMOTE,
          allowPush: pending.allowPush === true,
          allowPull: pending.allowPull === true,
          allowOutboxDrain: pending.allowOutboxDrain === true,
          syncEngineDirection: pending.syncEngineDirection || 'pull',
          operation: pending.operation || mapPlanToLegacyOperation({ mode: pending.mode }),
          binding: pending.binding || buildPlanBinding(bindingCtx, pending.mode),
          bindingFingerprint: pending.bindingFingerprint,
          resumedMode: pending.mode,
        });
      }
    }

    const needsPublication = path === 'new' || !isExistingBusinessOnCloud(wizard);
    const pubOk = !needsPublication || publicationResolved({ meta, path, wizard });
    const readOk = !needsPublication || readbackVerified({ meta, path, wizard });

    if (needsPublication && !pubOk) {
      return planResult(MODES.NO_SYNC, 'sync_publication_required', {
        requiresPublicationVerified: true,
        binding: buildPlanBinding(bindingCtx, MODES.NO_SYNC),
      });
    }
    if (needsPublication && !readOk) {
      return planResult(MODES.NO_SYNC, 'sync_readback_required', {
        requiresReadbackVerified: true,
        binding: buildPlanBinding(bindingCtx, MODES.NO_SYNC),
      });
    }

    if (!restore.restoreComplete && !restoreChoice) {
      return planResult(MODES.NO_SYNC, 'restore_decision_required', {
        requiresRestoreComplete: true,
        binding: buildPlanBinding(bindingCtx, MODES.NO_SYNC),
      });
    }

    if (restoreChoice === 'empty') {
      // EXISTING / replacement devices must never PUSH an empty local DB over cloud.
      if (path === 'existing' || isReplacementDevice({ path, wizard, restoreChoice })) {
        const mode = MODES.NO_SYNC;
        const binding = buildPlanBinding(bindingCtx, mode);
        return planResult(mode, 'existing_empty_push_forbidden', {
          sourceAuthority: SOURCE_AUTHORITY.REMOTE,
          allowPush: false,
          allowPull: false,
          allowOutboxDrain: false,
          emptyLocalPushBlocked: true,
          requiresRestoreComplete: true,
          binding,
          bindingFingerprint: bindingFingerprint(binding),
        });
      }
      const mode = MODES.PUSH_ONLY;
      const binding = buildPlanBinding(bindingCtx, mode);
      return planResult(mode, 'new_start_new_local_authoritative', {
        sourceAuthority: SOURCE_AUTHORITY.LOCAL,
        allowPush: true,
        allowPull: false,
        allowOutboxDrain: true,
        requiresPublicationVerified: needsPublication,
        requiresReadbackVerified: needsPublication,
        syncEngineDirection: 'push',
        operation: 'push',
        emptyLocalPushBlocked: false,
        binding,
        bindingFingerprint: bindingFingerprint(binding),
      });
    }

    if (restoreChoice === 'cloud' || path === 'existing' || isReplacementDevice({ path, wizard, restoreChoice })) {
      if (emptyBlocked) {
        const mode = MODES.PULL_ONLY;
        const binding = buildPlanBinding(bindingCtx, mode);
        return planResult(mode, 'existing_or_restore_pull_first_empty_local_guard', {
          sourceAuthority: SOURCE_AUTHORITY.REMOTE,
          allowPush: false,
          allowPull: true,
          allowOutboxDrain: false,
          requiresHydration: true,
          requiresRestoreComplete: restoreChoice === 'cloud',
          requiresPublicationVerified: needsPublication,
          requiresReadbackVerified: needsPublication,
          syncEngineDirection: 'pull',
          operation: 'pull',
          emptyLocalPushBlocked: true,
          binding,
          bindingFingerprint: bindingFingerprint(binding),
        });
      }
      const mode = MODES.PULL_ONLY;
      const binding = buildPlanBinding(bindingCtx, mode);
      return planResult(mode, restoreChoice === 'cloud' ? 'cloud_restore_pull_authoritative' : 'existing_pull_authoritative', {
        sourceAuthority: wizard.restoreVerifiedDatabase ? SOURCE_AUTHORITY.RESTORED : SOURCE_AUTHORITY.REMOTE,
        allowPush: false,
        allowPull: true,
        allowOutboxDrain: false,
        requiresHydration: true,
        requiresRestoreComplete: restoreChoice === 'cloud',
        requiresPublicationVerified: needsPublication,
        requiresReadbackVerified: needsPublication,
        syncEngineDirection: 'pull',
        operation: 'pull',
        binding,
        bindingFingerprint: bindingFingerprint(binding),
      });
    }

    if (['local', 'file', 'skip_existing'].includes(restoreChoice)) {
      const mode = MODES.RECONCILE;
      const binding = buildPlanBinding(bindingCtx, mode);
      const reconcileReady = restoreReconcile?.pullDone === true && restoreReconcile?.pushAllowed === true;
      return planResult(mode, 'local_restore_reconcile_verified', {
        sourceAuthority: SOURCE_AUTHORITY.RESTORED,
        allowPush: reconcileReady,
        allowPull: !reconcileReady,
        allowOutboxDrain: reconcileReady,
        requiresHydration: true,
        requiresRestoreComplete: true,
        requiresPublicationVerified: needsPublication,
        requiresReadbackVerified: needsPublication,
        syncEngineDirection: reconcileReady ? 'push' : 'pull',
        operation: 'reconcile_verified_local',
        binding,
        bindingFingerprint: bindingFingerprint(binding),
      });
    }

    return planResult(MODES.NO_SYNC, 'sync_plan_invalid', {
      binding: buildPlanBinding(bindingCtx, MODES.NO_SYNC),
    });
  }

  function isInitialSyncResolved(snapshot) {
    const meta = readMeta(snapshot);
    if (meta.bootstrapCompletedAt) {
      return { ok: true, source: 'meta.bootstrapCompletedAt', marker: null };
    }
    const marker = meta.initialSyncCompletion;
    if (marker?.completedAt && marker?.mode && marker?.bindingFingerprint) {
      const plan = resolveInitialSyncPlan(snapshot);
      if (plan.mode === MODES.NO_SYNC && plan.reason === 'initial_sync_already_resolved') {
        return { ok: true, source: 'meta.initialSyncCompletion', marker };
      }
      const expected = bindingFingerprint(buildPlanBinding({
        meta,
        wizard: readWizard(snapshot),
        deviceConfig: readDeviceConfig(snapshot),
        path: snapshot.path || readWizard(snapshot).path,
        restoreChoice: snapshot.wizard?.restoreChoice,
        organizationId: snapshot.organizationId || meta.centerId,
        branchId: snapshot.branchId || readDeviceConfig(snapshot).lockedBranchId,
        deviceId: snapshot.deviceId || readDeviceConfig(snapshot).deviceUuid,
      }, marker.mode));
      if (marker.bindingFingerprint === expected) {
        return { ok: true, source: 'meta.initialSyncCompletion', marker };
      }
      return { ok: false, source: 'tampered_completion_marker', marker };
    }
    const reconcile = snapshot.restoreReconcile
      || (typeof global !== 'undefined' && global.RestoreReconciliation?.loadState?.())
      || null;
    if (reconcile?.pullDone === true && reconcile?.pushAllowed === true) {
      return { ok: true, source: 'restore_reconcile', marker: null };
    }
    return { ok: false, source: null };
  }

  function mapPlanToLegacyOperation(plan) {
    if (!plan) return 'invalid';
    if (plan.operation) return plan.operation;
    if (plan.mode === MODES.PUSH_ONLY) return 'push';
    if (plan.mode === MODES.PULL_ONLY) return 'pull';
    if (plan.mode === MODES.RECONCILE) return 'reconcile_verified_local';
    return 'invalid';
  }

  function buildContract() {
    return {
      modes: Object.values(MODES),
      sourceAuthority: Object.values(SOURCE_AUTHORITY),
      evaluator: 'resolveInitialSyncPlan',
      zeroWrite: true,
      completionAuthority: '__tdw_meta__.initialSyncCompletion',
      notBasedOn: ['wizard.syncDone alone', 'SyncEngine.getReadiness alone without plan execution'],
      pullOnlyProhibits: ['upload', 'outbox_drain', 'full_table_push'],
      emptyLocalGuard: 'existing/restore/replacement + remote data + bootstrap-only local',
    };
  }

  const InitialSyncDirectionContract = {
    MODES,
    SOURCE_AUTHORITY,
    RESTORE_CHOICES,
    resolveInitialSyncPlan,
    isInitialSyncResolved,
    classifyBootstrapOnlyState,
    emptyLocalPushBlocked,
    remoteHasBusinessData,
    isReplacementDevice,
    buildPlanBinding,
    bindingFingerprint,
    mapPlanToLegacyOperation,
    buildContract,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = InitialSyncDirectionContract;
  }
  global.InitialSyncDirectionContract = InitialSyncDirectionContract;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global);
