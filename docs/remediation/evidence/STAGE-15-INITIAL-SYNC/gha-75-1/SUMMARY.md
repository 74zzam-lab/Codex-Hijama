# Stage 15 — Initial Sync Direction + Post-Restore Sync Safety

- Focused test: PASS
- Stage 14 regression: PASS

- Explicit pull/push/reconcile contract per bootstrap scenario
- Empty-local push protection for existing/restore/replacement
- INITIAL_SYNC_RESOLVED uses durable completion marker
- PULL_ONLY cannot drain outbox or push
- Publication + read-back gates enforced before initial sync (NEW path)