# Manual Retest Checklist (Post-Remediation)

Use new Setup EXE SHA after CI build (not Stage 20 baseline EXE).

- [ ] BUG-EXT-001: Bootstrap at 1366×768 / 1920×1080 / ~1024 width / DPI 100–150% — no clipping, scroll OK
- [ ] BUG-EXT-002: Google OAuth success → Google checklist row DONE (no red error on Google row)
- [ ] BUG-EXT-003: Disconnect/switch Google from bootstrap → re-OAuth with different account
- [ ] BUG-EXT-004: Existing path shows real discovered branch IDs in dropdown (not only BR-MAIN)
- [ ] BUG-EXT-005: Discovery + Restore rescan buttons show in-progress and refresh results
- [ ] BUG-EXT-006: Start New → owner **creation** (not owner auth) until owner created
- [ ] BUG-EXT-007: Back responds once per click; can review prior completed steps
- [ ] BUG-EXT-008: Cloud restore progresses past 21% to 100% on real backup size
- [ ] BUG-EXT-009: Google stays connected through discovery → branch → device → restore → back

Do not mark EXTERNAL UAT PASS until all above verified on Windows GUI.
