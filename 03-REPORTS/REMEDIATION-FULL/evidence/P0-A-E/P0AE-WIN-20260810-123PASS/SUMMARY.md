# P0-A through P0-E Windows Build Evidence

Build ID: `P0AE-WIN-20260810-123PASS`

- Full source suite: `npm test` passed 123/123 in 373.8 seconds.
- NSIS build: passed in 215.2 seconds.
- Installer: `dist/HijamaManagement-Setup-2.0.1.exe`.
- SHA-256: `DB69A0C81D5A786A3C972DCC3AEBD7D271E16289624FD85B621623A48A1CEB92`.
- Silent isolated-path install: passed with exit code 0.
- Installed executable smoke startup: passed; no setup data was entered.
- ASAR check: no stub cloud provider and no private license-signing material.

## Remaining verification limits

- The installer is not Authenticode-signed because no signing certificate is
  configured.
- End-to-end OAuth, real cloud restore, multi-device concurrency and injected
  cloud failures remain UNVERIFIED for this installed build. The packaged app
  uses the production-stable user-data location; automated interaction was
  intentionally stopped before it could modify existing user data.
