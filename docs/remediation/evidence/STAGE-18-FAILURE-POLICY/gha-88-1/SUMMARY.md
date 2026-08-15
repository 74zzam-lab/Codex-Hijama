# Stage 18 — Unified Bootstrap Failure Policy

- Focused test: PASS
- Stage 17 regression: PASS
- Stage 16 regression: PASS

- Unified outcomes: SUCCESS / RETRYABLE / USER_ACTION_REQUIRED / FATAL / CANCELLED
- Normalized failure contract via BootstrapFailurePolicyContract
- Checklist maps outcomes to ERROR / USER_ACTION / FATAL / CANCELLED
- Retry button for retryable failures on current gate only
- Context invalidation on account/branch/restore changes
- Truthy {ok:false} never treated as success