# P0-A through P0-E source remediation evidence

- Build ID: `P0AE-SOURCE-20260810-122PASS`
- Source tests: `npm test` — 122/122 PASS.
- Static checks: `npm run lint` — PASS.
- Current-source Setup EXE: not built, per product-owner instruction.
- Installed clean/upgrade/failure-injection/restart evidence: UNVERIFIED.
- Source ZIP: generated separately and recorded after packaging.
- Production candidate: NO until the exact ZIP is built and installed and all
  mandatory installed scenarios pass.

The intentional developer password login and support entry flow remain. Direct
renderer forgery of the developer session remains denied.

No private signing key is included in the source tree. Licensing tests generate
ephemeral in-memory keys; issuer operations require an explicitly supplied
offline private-key path.

All signed-license mutations in customer runtime are denied. Google binding,
device status, activation consumption and Owner recovery metadata are stored as
operational SQLite state. Branch entitlements and lifecycle changes require a
new issuer-signed V6 license.
