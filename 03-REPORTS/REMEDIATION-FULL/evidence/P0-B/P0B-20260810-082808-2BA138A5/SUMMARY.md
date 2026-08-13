# P0-B Evidence Summary

- Build ID: `P0B-20260810-082808-2BA138A5`
- Phase: P0-B — Single Source of Truth and Branch Isolation
- Source suite: **PASS — 109/109**
- P0-B automated gate: **PASS — 11/11**
- Installed-artifact runtime: **PASS — 7/7**
- Installed GUI boot: **PASS**
- Installed GUI restart/retest: **PASS**
- SQLite integrity: **PASS**
- Migration status: **complete**, quarantine `0`
- P0-B Critical FAIL: `0`
- P0-B Critical UNVERIFIED: `0`
- P0-B Gate: **PASS**

The installed `app.asar` SHA-256 exactly matches the built artifact. The runtime
database reports schema version 6, `sqlitePrimary=true`,
`localStorageRetained=false`, no operational KV shadow rows, no foreign-key
violations and no quarantined rows.

The observed `TDW-ACT-license_timeout-*` message is outside P0-B. Inspection
proved that `cloud/boot-flow-ui.js` maps every exception in that discovery block
to `license_timeout`; the underlying error therefore remains unverified. It is
carried forward to P0-C and was not hidden or used to fail this data-boundary gate.

Overall commercial release remains blocked because later P0 phases are still open.
