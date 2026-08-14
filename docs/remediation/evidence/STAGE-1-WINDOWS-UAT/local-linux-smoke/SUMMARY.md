# Stage 1 Windows UAT Summary

**Build ID:** local-linux-smoke
**Commit:** 47b301e2f53d004b701e2ee76a573f853518ae4b
**Started:** 2026-08-13T08:21:44.985Z
**Finished:** 2026-08-13T08:21:45.864Z
**Isolated userData:** /tmp/uat-stage1-local-linux-smoke

## Results

| Check | Result |
|-------|--------|
| Backup create (IPC) | PASS |
| Restore (IPC) | PASS |
| Progress (no 18% stall) | PASS |
| Data match BEFORE-BACKUP | PASS |
| Restart persistence | PASS |
| SQLite integrity | PASS |
| FK violations | 0 |
| Failure injection | PASS |
| Runtime operational errors | 0 |
| Real Google/Drive | UNVERIFIED |

## Verdict: **PASS**

Evidence: `docs/remediation/evidence/STAGE-1-WINDOWS-UAT/local-linux-smoke/`
