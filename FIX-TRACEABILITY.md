# FIX-TRACEABILITY — إصلاحات النسخة الحالية (V5 محفوظ)

**التاريخ:** 2026-08-13  
**الأرشيف المُصلَح:** `02-CURRENT/CURRENT-FINAL-RESTORE-SOURCE-FIXED-20260813.zip`

---

## ملخص النتائج

| البند | قبل | بعد |
|-------|-----|-----|
| `npm test` | 129/132 (exit 1) | **133/133 (exit 0)** |
| `npm run test:e2e` | غير موجود | **17/17 PASS** |
| `npm run lint` | PASS | **PASS** |
| OAuth secret في المصدر | GOCSPX مكشوف | **placeholder فقط** |
| V5 Legacy generator | موجود | **محفوظ** (قرار مالك) |

---

## الإصلاحات

### FIX-001 — baseline:license-read

| الحقل | التفاصيل |
|-------|----------|
| **المشكلة** | يبحث عن `license/data/*` المحذوف من الأرشيف النظيف |
| **الملفات** | `tests/baseline/test-license-read.js` |
| **الإصلاح** | قراءة `license/registries/*.json` + التحقق من V5 codec |
| **الاختبار** | `baseline:license-read` PASS |

### FIX-002 — سياسة V5 المتعمدة

| الحقل | التفاصيل |
|-------|----------|
| **المشكلة** | `p0-e:licensing-production` و `license:test` يفشلان لوجود LIC_SECRETS |
| **الملفات** | `license/core/v5-signing-policy.js`, `test-p0-e-licensing-production.js`, `commercial-licensing-test.mjs` |
| **الإصلاح** | allowlist لمسارات V5 المتعمدة؛ رفض المفاتيح الخاصة فقط |
| **الاختبار** | `p0-e:licensing-production`, `license:test` PASS |
| **ملاحظة** | المخاطر التجارية لـ V5 **ما زالت موجودة** (متعمد) |

### FIX-003 — OAuth secret

| الحقل | التفاصيل |
|-------|----------|
| **المشكلة** | `GOCSPX-…` في `cloud-oauth.embedded.json` و `config.json` |
| **الملفات** | `electron/cloud-oauth.embedded.json`, `electron/cloud-oauth.config.json`, `verify-google-oauth-config.js`, `scan-source-secrets.cjs` |
| **الإصلاح** | placeholder `YOUR_GOOGLE_CLIENT_SECRET`؛ فحص يمنع GOCSPX في المصدر |
| **البناء** | `GOOGLE_OAUTH_CLIENT_SECRET` عبر env عند `npm run build` |
| **الاختبار** | `security:source-secret-scan`, `verify:cloud-oauth` PASS |

### FIX-004 — await مفقود في استعادة staging (bug حقيقي)

| الحقل | التفاصيل |
|-------|----------|
| **المشكلة** | `applyStagedMerge` يستدعي `applyMergeToRepository` بدون await — الاستعادة تُبلغ نجاحاً قبل commit |
| **الملفات** | `cloud/restore-staging.js`, `cloud/synced-write.js` |
| **الإصلاح** | `applyStagedMerge` async + await في `restoreFromBackup` |
| **الاختبار** | `e2e:production-readiness` synced_write_restore_path PASS |

### FIX-005 — E2E harness

| الحقل | التفاصيل |
|-------|----------|
| **المشكلة** | سيناريوهات async غير مُنتظرة؛ conflict resolve Promise |
| **الملفات** | `scripts/e2e-production-readiness.mjs`, `scripts/e2e-full-application.mjs` |
| **الإصلاح** | `runScenarios()` async؛ stub authoritative write في E2E |
| **الاختبار** | `npm run test:e2e` 17/17 PASS |

---

## ما لم يُتحقق منه (UNVERIFIED)

- Windows EXE مثبت + Playwright `p0-a-security-runtime.cjs`
- UAT سيناريوهات 18 على جهاز حقيقي

---

## أوامر التحقق

```bash
npm ci
npm run lint
npm test          # 133/133
npm run test:e2e  # 17/17
npm run scan:secrets
```
