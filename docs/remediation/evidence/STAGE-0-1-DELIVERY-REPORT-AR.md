# Stage 0 + Stage 1 — تقرير التسليم (قبل UAT)

**التاريخ:** 13 أغسطس 2026  
**الفرع:** `cursor/bootstrap-restore-fixes-beb8`  
**الالتزام:** `d636777` (+ evidence commit)

---

## القرارات المعتمدة (مجمّدة — لم تُنفَّذ بعد)

| القرار | الحالة |
|--------|--------|
| New: Activation قبل Google | معتمد — **لم يُنفَّذ** (بعد UAT) |
| Owner قبل First Branch | معتمد — **لم يُنفَّذ** |
| Existing: لا إعادة إنشاء Org/Owner من SoT | معتمد — **لم يُنفَّذ** |
| Device Approval = NO (تسجيل تلقائي ضمن الحدود) | معتمد — **لم يُنفَّذ** |
| Startup/Login/RBAC مجمّدة | **محترمة** — لا تغيير |
| Owner Seed: لا حذف قبل إثبات Journey | **محترمة** — لا تغيير |

---

## Stage 0 — Baseline (PASS)

**نطاق:** أدلة فقط — **صفر تعديل على المصدر.**

| الاختبار | النتيجة |
|----------|---------|
| `npm test` | **133/133 PASS** |
| `npm run test:e2e` | **17/17 PASS** |

**بصمة المصدر:** `review-work/current-extract` — 1359 ملفًا، tree SHA256:  
`090ec83bac968bd19fa92aca74e0e804d441cacb72e738d662ed54f11f9fc782`

**الأدلة:** `docs/remediation/evidence/STAGE-0-BASELINE/STAGE-0-BASELINE-EVIDENCE.json`

---

## Stage 1 — Restore Progress + Error Mapping (PASS في Node — UNVERIFIED مثبت)

**نطاق:** إصلاحات runtime blocker فقط — **بدون** boot ordering / owner-branch / existing path / startup.

### المشكلة
- توقف عند ~18% (مرحلة 3/9 تنزيل Backup V2)
- تحذير 30 ثانية بدون تحديث
- `TDW-ACT-unknown` عند فشل الاستعادة

### السبب الجذري
1. تنزيل Drive في Main بدون أحداث تقدم → Renderer صامت
2. Watchdog يعيد `stageRatio: 0.2` فيخفض النسبة من ~21% إلى ~18%
3. أخطاء الاستعادة غير مُعرَّفة في `ActivationErrors`

### الإصلاح (ملفات)
- `google-drive-api.js` — `downloadFileWithProgress`
- `google-drive.js` — streaming إلى `.partial`
- `backup-v2-ipc.js` — `backup:downloadProgress` أثناء `setupCloudRestore`
- `preload.js` — `onDownloadProgress`
- `cloud-data-discovery.js` — ربط التقدم + `lastStageRatio` + `maxPercent`
- `activation-errors.js` — `cloud_download_failed`, `cloud_backup_restore_failed`, …
- `boot-flow-ui.js` — `setStatusFromErr` عند فشل الاستعادة

### اختبارات Stage 1

| الاختبار | النتيجة |
|----------|---------|
| `test-v2-5-10-cloud-discovery-restore` | PASS |
| `test-p0-c-restore-truth-and-boot-gate` | **12/12** (يشمل AUD-RST-007) |
| `test-current-restore-license-login` | PASS |
| `test-v2-5-8-auth-activation-ui` | PASS |
| `test-current-setup-restore-runtime` | PASS |

**الأدلة:** `docs/remediation/evidence/STAGE-1-RESTORE-PROGRESS/STAGE-1-RESTORE-PROGRESS-EVIDENCE.json`

---

## حزمة UAT (Exact Build)

| الملف | SHA-256 |
|-------|---------|
| `Hijama-Management-System-SOURCE-BUILD-2.0.1.zip` | `57e1de5460921daf7d8f30902651d01c3276b4320aff80e4f5fc4e0545588645` |

**المصدر:** `review-work/current-extract` (بدون `node_modules`)

---

## UAT المطلوب قبل Stage 2 (إلزامي)

```
Backup V2 → Restore (سحابي أو محلي)
→ verify SQLite counts
→ restart
→ verify counts + PRAGMA integrity_check
→ zero operational console/page/Main errors
```

**حتى إكمال UAT:** الحكم النهائي على الإنتاج = **UNVERIFIED**.

---

## التوقف

✅ **Stage 0 PASS**  
✅ **Stage 1 PASS (Node/E2E)**  
⏸️ **متوقف هنا** — لا Stage 2 (READY/Startup) حتى نتيجة Windows UAT

**PR:** https://github.com/74zzam-lab/Codex-Hijama/pull/3
