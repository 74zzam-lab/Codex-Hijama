/**
 * Authoritative bootstrap step model.
 *
 * One sequence per path, one applicability rule, one set of resolvers. The
 * header ("الخطوة X من Y"), the side checklist, the progress dots, Next, Back,
 * resume and validation all read from here.
 *
 * Before this module the order lived in four places (boot-flow-ui NEW_STEPS /
 * EXISTING_STEPS, bootstrap-coordinator's copies, the checklist contract's
 * copies, and bootstrap-gates' runtime lists) and only the checklist filtered
 * conditional steps. The header therefore counted a step the checklist hid,
 * which is how "الخطوة 4 من 10" could appear next to a different step body.
 */
(function (global) {
  'use strict';

  const PATH_NEW = 'new';
  const PATH_EXISTING = 'existing';

  const NEW_SEQUENCE = Object.freeze([
    'language', 'license', 'google', 'discovery', 'path_decision',
    'organization', 'owner', 'branch', 'device', 'business_setup',
    'publication', 'restore', 'sync', 'ready',
  ]);

  const EXISTING_SEQUENCE = Object.freeze([
    'language', 'google', 'discovery', 'license_org_recovery', 'branch_select',
    'device', 'restore', 'owner_auth', 'sync', 'ready',
  ]);

  /** Steps that may be absent from a journey depending on discovered state. */
  const CONDITIONAL_STEPS = Object.freeze(['path_decision']);

  function sequenceFor(path) {
    return path === PATH_EXISTING ? EXISTING_SEQUENCE.slice() : NEW_SEQUENCE.slice();
  }

  function isExistingPath(state) {
    const s = state || {};
    return s.path === PATH_EXISTING || s.forkDecision === 'use_existing';
  }

  /**
   * `path_decision` exists only on NEW, and only when discovery actually found
   * something to choose between (or a choice was already made).
   *
   * `owner_auth` is unconditional on EXISTING: it is a hard gate for `sync`, so
   * counting it only "once required" made the total step count change
   * mid-journey and drift away from the checklist.
   */
  function isStepApplicable(stepId, path, state) {
    const s = state || {};
    if (stepId === 'path_decision') {
      if (path === PATH_EXISTING || isExistingPath({ ...s, path })) return false;
      return s.needsPathFork === true
        || s.pathDecisionResolved === true
        || !!s.forkDecision
        || s.currentStepId === 'path_decision';
    }
    if (stepId === 'owner_auth') {
      return path === PATH_EXISTING || isExistingPath({ ...s, path });
    }
    return true;
  }

  function getApplicableSteps(path, state) {
    return sequenceFor(path).filter((id) => isStepApplicable(id, path, state));
  }

  function getTotalStepCount(path, state) {
    return getApplicableSteps(path, state).length;
  }

  /** 1-based position among applicable steps, or null when not applicable. */
  function getStepNumber(path, state, stepId) {
    const idx = getApplicableSteps(path, state).indexOf(stepId);
    return idx < 0 ? null : idx + 1;
  }

  function getNextStep(path, state, stepId) {
    const applicable = getApplicableSteps(path, state);
    const idx = applicable.indexOf(stepId);
    if (idx < 0 || idx >= applicable.length - 1) return null;
    return applicable[idx + 1];
  }

  function getPreviousStep(path, state, stepId) {
    const applicable = getApplicableSteps(path, state);
    const idx = applicable.indexOf(stepId);
    if (idx <= 0) return null;
    return applicable[idx - 1];
  }

  /** Index into the full persisted sequence (wizard.currentStep storage base). */
  function toSequenceIndex(path, stepId) {
    return sequenceFor(path).indexOf(stepId);
  }

  /**
   * Map a stored index onto a real, applicable step. Handles legacy indices that
   * point at a step which is no longer applicable (e.g. a resolved fork).
   */
  function resolveStepIdFromIndex(path, index, state) {
    const sequence = sequenceFor(path);
    const applicable = getApplicableSteps(path, state);
    if (!applicable.length) return null;
    const raw = Number(index);
    const safe = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), sequence.length - 1) : 0;
    const candidate = sequence[safe];
    if (applicable.includes(candidate)) return candidate;
    for (let i = safe + 1; i < sequence.length; i += 1) {
      if (applicable.includes(sequence[i])) return sequence[i];
    }
    for (let i = safe - 1; i >= 0; i -= 1) {
      if (applicable.includes(sequence[i])) return sequence[i];
    }
    return applicable[0];
  }

  /** Everything a renderer needs for one consistent frame. */
  function describeStep(path, state, stepId) {
    const applicable = getApplicableSteps(path, state);
    const resolved = applicable.includes(stepId) ? stepId : resolveStepIdFromIndex(path, toSequenceIndex(path, stepId), state);
    return {
      path,
      stepId: resolved,
      stepNumber: getStepNumber(path, state, resolved),
      totalSteps: applicable.length,
      applicableSteps: applicable,
      sequenceIndex: toSequenceIndex(path, resolved),
      nextStepId: getNextStep(path, state, resolved),
      previousStepId: getPreviousStep(path, state, resolved),
    };
  }

  const api = {
    PATH_NEW,
    PATH_EXISTING,
    NEW_SEQUENCE,
    EXISTING_SEQUENCE,
    CONDITIONAL_STEPS,
    sequenceFor,
    isStepApplicable,
    getApplicableSteps,
    getTotalStepCount,
    getStepNumber,
    getNextStep,
    getPreviousStep,
    toSequenceIndex,
    resolveStepIdFromIndex,
    describeStep,
  };

  global.BootstrapStepModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
