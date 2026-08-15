# Manual Windows Retest — Existing Customer Defect Sweep (BUG-EXT-011..015)

**Scope:** Close manual proof only. No further External UAT until this protocol completes.  
**Runtime source (required):** `013f37e58d4567ad07e1c00bc333094f7323f95b`  
**Branch:** `cursor/external-existing-bootstrap-defects-beb8`  
**Do not use:** older EXE builds (pre-013f37e) as evidence against these fixes.

---

## A — Build identity (Windows machine)

### 1. Checkout exact source

```powershell
git fetch origin cursor/external-existing-bootstrap-defects-beb8
git checkout cursor/external-existing-bootstrap-defects-beb8
git rev-parse HEAD
```

**Required output:** `013f37e58d4567ad07e1c00bc333094f7323f95b`  
If HEAD is newer, confirm commits after 013f37e are **evidence-only** (docs/scripts), not runtime.

### 2. Clean install + build

```powershell
npm ci
npm run lint
node tests/baseline/test-external-existing-runtime-defects.js
npm run build:win
```

### 3. Record installer artifact

Expected artifact pattern: `dist/HijamaManagement-Setup-<version>.exe`

```powershell
$exe = Get-ChildItem dist\HijamaManagement-Setup-*.exe | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$exe.FullName
$exe.Length
Get-FileHash $exe.FullName -Algorithm SHA256 | Select-Object Hash
```

Or run the helper script (records JSON evidence):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/windows-uat/record-manual-existing-retest.ps1 -Phase build
```

Fill `docs/remediation/evidence/EXTERNAL-RUNTIME-DEFECTS/MANUAL-RETEST-RESULT.json` → `build` section.

### 4. Install

- Install the Setup EXE built from step A.2 on a **clean or dedicated UAT machine** (same class as prior manual repro if possible).
- Launch installed app (not `electron .` from source).

---

## B — Journey (must match prior manual repro)

Path: **Existing Customer / Current Customer**

| # | Step | Action | Record |
|---|------|--------|--------|
| 1 | Language | Accept default if shown | — |
| 2 | Google | Connect once | email, time |
| 3 | Discovery | Wait for auto or press rescan | status summary |
| 4 | License/Org Recovery | Run recovery | success message |
| 5 | Branch | **Only if 2+ branches** — select explicitly | branch id |
| 6 | Device | Enter device name, register | name |
| 7 | Restore | Scan cloud, pick backup, restore | filename, size |

**Do not** continue full External UAT after step 7 until all five bugs are scored.

---

## C — BUG-EXT-011 (Modal RTL clipping)

**When:** First bootstrap screen visible (checklist + main panel).

Check visually on **your current screen first**, then normal vs maximized if possible:

- [ ] Entire modal visible (not cut off on the **left**)
- [ ] Checklist sidebar fully visible
- [ ] All buttons visible (no off-screen actions)
- [ ] No horizontal scrollbar / content clipped
- [ ] Long Arabic text wraps (no overflow)

**Pass:** All checks true on primary display.  
**Fail:** Any left clipping, hidden buttons, or horizontal loss.

Record: `modal.clipping`, `modal.leftSideVisible`, `modal.horizontalOverflow`, `modal.result`

---

## D — BUG-EXT-012 (False red after Google)

**When:** Immediately after Google connect through Discovery completion.

1. Do **not** click rapidly through steps.
2. Watch `#bf-wizard-status` and checklist for **red** text.
3. If red appears with `تعذّر إكمال العملية` or `(TDW-BOOT-ERR-...)`:
   - Copy full message + Diagnostic ID
   - Wait **15–30 s** without clicking — note if it clears alone
   - Note whether Discovery then shows success (`✅ اكتمل الاكتشاف`)

**Pass:** No red error if Google + Discovery ultimately succeed.  
**Fail:** Red `تعذّر إكمال العملية` / `TDW-BOOT-ERR-*` while operation succeeds, or red stays after success.

For each red message, append to `redMessageAudit[]` in result JSON.

---

## E — Discovery expected result

Record checklist / summary line:

- Status: `existing_business_found` (or actual)
- Organizations: count
- Licenses: count
- Branches: count
- Backups: count (may be 0 at discovery)

**Pass:** Counts match cloud reality; **no false red** after success message.

---

## F — BUG-EXT-013 (Branch false DONE)

**Precondition:** Discovery reports **2+ branches**.

Before you select a branch:

- [ ] Checklist branch step is **REQUIRED** (not ✓ DONE)
- [ ] Status does **not** say `✅ تم اختيار الفرع` / `✓ اختيار الفرع تم`
- [ ] Branch dropdown / selection UI is shown

Then:

1. Choose **BR-MAIN** (or correct branch) yourself.
2. Press **✅ تأكيد اختيار الفرع**.

**Pass:** DONE only **after** explicit confirm.  
**Fail:** DONE or success text before your selection.

---

## G — BUG-EXT-014 (Google requested twice)

After License/Org Recovery and through Device step:

- [ ] Google checklist row stays **DONE**
- [ ] App does **not** show Google connect as current required step again
- [ ] No second full OAuth unless you disconnected manually

Count successful Google connects in this journey: **Expected = 1**

**Fail:** Second `🔗 ربط Google` required while token still valid.

---

## H — Device step

After branch confirmed:

- Enter device name (unique if re-testing same center).
- **Pass:** Registration succeeds; branch matches your selection; no Google reconnect prompt.

---

## I — Restore discovery

On Restore step, run cloud scan. Wait until list appears.

Record:

- Latest backup filename
- Size (KB)
- Date/time shown

---

## J — BUG-EXT-015 (Restore download / progress)

1. Prefer same file as prior repro if listed:  
   `Tadawi-Backup-V2-scheduled-2026-08-11T18-37-34-372Z.tdw` (~48.4 KB)  
   Otherwise pick the **newest real Backup V2** and record exact name.
2. Press **استعادة هذه البيانات المحددة**.
3. Watch progress panel and status line.

### Progress rules (013f37e fix)

| Observation | Pass? |
|-------------|-------|
| Starts with indeterminate / low % / “جارٍ…” — **not** stuck fake **21%** with 0 elapsed | ✓ |
| Progress moves with bytes or heartbeat | ✓ |
| After download completes, advances to next stage (checksums/staging/etc.) | ✓ |
| No progress for **45 s** → **retryable error** (e.g. تعذر تنزيل النسخة…) + diagnostic | ✓ |
| Stuck at 21% with 0 activity for 60+ s, no error | **FAIL** |

### Progress log

Every **10–15 s** or on each visible % change, note:

```
time | percent or … | stage label | last activity text | diagnostic id
```

If stalled: wait up to **60 s** total before closing app (watchdog test).

---

## K — Red message audit (whole journey)

For **every** red message:

| Field | Value |
|-------|-------|
| step | google / discovery / branch / restore / … |
| text | full UI text |
| diagnosticId | TDW-BOOT-ERR-… or RST-… |
| realProblem | yes / no |
| operationSucceededAfter | yes / no |
| clearedAfterSuccess | yes / no / n/a |

**Target after 013f37e:**

- false red count = 0  
- stale red count = 0  
- wrong-step red count = 0  

Also note DevTools console: page errors, unhandled rejections (if you open F12).

---

## L — Final scoring

| Bug | Pass condition |
|-----|----------------|
| BUG-EXT-011 | No modal clipping on primary display |
| BUG-EXT-012 | No false red through Google → Discovery success |
| BUG-EXT-013 | 2+ branches → REQUIRED until explicit select |
| BUG-EXT-014 | Google connect count = 1 |
| BUG-EXT-015 | No fake 21% stall; completes or 45s retryable error |

**All five PASS** → `MANUAL EXISTING RETEST: PASS` → resume External UAT.  
**Any FAIL** → `MANUAL EXISTING RETEST: FAIL` → attach filled JSON + screenshots; **do not change code** until review.

---

## M — Submit results

1. Fill `MANUAL-RETEST-RESULT.json` (copy from `MANUAL-RETEST-RESULT-TEMPLATE.json`).
2. Optional: `record-manual-existing-retest.ps1 -Phase result -ResultJson path\to\MANUAL-RETEST-RESULT.json`
3. Paste completed **FINAL RESULT TEMPLATE** (section N in template JSON) into agent chat.

---

## N — Reference

- Error catalog: `BOOTSTRAP-ERROR-CATALOG.json`
- Source PR: https://github.com/74zzam-lab/Codex-Hijama/pull/23
- Focused tests: `tests/baseline/test-external-existing-runtime-defects.js`
