# Legacy V5 Final Runtime Evidence

Build ID: `LEGACY-V5-FINAL-20260811-126OF128-7808AB2A`

- Requested legacy V5 generator, Google Sheets rows, licence validation,
  writable admin persistence, SQLite start/restart and relevant UI controls:
  **PASS** on the exact installed executable.
- Full suite: **126/128 groups PASS**. The two failures are the unchanged
  mandatory security gates that reject customer-packaged shared-secret V5
  signing/mutation.
- Setup SHA-256:
  `7808AB2AF59DF425B1AAA1C056F87EF53E8A8136908F0133541CA4EB51D9C7D3`.
- Live Google Sheets endpoint read-only reachability: **PASS**.
- Live final Drive OAuth/upload/download: **UNVERIFIED** because the current
  production profile has no refresh token and requires an explicit reconnect.
- Authenticode: **NOT SIGNED**.
- Source ZIP: `D:/Hijama-Clinic-LEGACY-V5-DRIVE-SHEETS-FINAL-20260811-SOURCE.zip`
  — SHA-256 `24824220DF039D52D7D6114716C3CBF82B1B392D949235A3276C5785CB46D7E1`.
- Windows ZIP: `D:/Hijama-Clinic-LEGACY-V5-DRIVE-SHEETS-FINAL-20260811-WINDOWS.zip`
  — SHA-256 `66D1E03A15981E5343E70C1BC3C52965D9A808DFC3489DCFB6CA7ADEF0F50DF7`.
- Both ZIP archives passed a complete 7-Zip integrity test.
- Mandatory commercial security gate: **NO-GO** while `AUD-LIC-002` and
  `AUD-LIC-004` remain open by product-owner choice.
