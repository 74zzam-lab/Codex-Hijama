# مراجعة هندسية مستقلة: Original vs Current
## نظام إدارة الحجامة (Hijama Management System) — Electron

**تاريخ المراجعة:** 13 أغسطس 2026  
**المراجع:** Cloud Agent — مراجعة مستقلة (لم تُعتمد تقارير `03-REPORTS/` كحقيقة دون تحقق)

---

## الحكم التنفيذي

| السؤال | الإجابة |
|--------|---------|
| **Production Candidate** | **NO** |
| **Ready for commercial release** | **NO** |

### الأسباب الرئيسية لـ NO-GO

1. **أمان تجاري Legacy V5:** سر HMAC موزّع في Renderer — اختبارات البوابة التجارية تفشل عمداً (4/22 فحص).
2. **OAuth clientSecret** مضمّن في `electron/cloud-oauth.embedded.json`.
3. **Windows مثبت UNVERIFIED:** لا بناء NSIS ولا UAT على بايتات مثبتة في بيئة Linux.
4. **مجموعة الاختبارات الكاملة:** 129/132 (exit code 1) — 3 فشل معروف/متعمد.

### ما تحسّن بشكل مؤكد (مصدر + اختبارات)

- حدود أمان P0-A: مصادقة Main، رفض `__dev__` المزوّر، KV محمية، rate limiting
- مزامنة per-record بدل full-table bump
- استعادة Backup V2 مع staging/rollback وهوية Device B
- إصلاح `configuration_pull_incomplete` بعد restore كامل
- إصلاح clone error لكلمة مرور النسخة الاحتياطية
- إصلاح activation consumed قبل فشل Drive
- migrations 003–006 (فرع، مزامنة، مالية)
- إزالة fixtures التطوير والمفتاح الخاص من الأرشيف النظيف

---

## المرحلة 1 — التحقق من المدخلات

### بصمات SHA-256 (مُتحقَّق)

| الأرشيف | SHA-256 المتوقع | SHA-256 الفعلي | الحالة |
|---------|-----------------|----------------|--------|
| Original | `01e89d6fc161530ae03690865062827bbdecbb7ca58b3e0fe331909a9536b0cc` | مطابق | **PASS** |
| Current | `9c0339cc9cb6a039e859c61a32dd1b586517950103eceac70634a2c8a146ad9d` | مطابق | **PASS** |

### معلومات الحزمة

| البند | Original | Current |
|-------|----------|---------|
| package name | hijama-management-system | hijama-management-system |
| version | 2.0.1 | 2.0.1 |
| buildId | v2.5.9 release | FINAL-RESTORE-20260813 |
| Electron | ^43.2.0 | ^43.2.0 |
| Node engines | >=22 <=24 | >=22 <=24 |
| عدد الملفات | 1,095 | 1,348 |
| node_modules في الأرشيف | لا | لا |
| dist/EXE | لا | لا |

### فحص المحتوى المحظور (Current)

| العنصر | الحالة |
|--------|--------|
| `.codex-*` | غير موجود ✓ |
| `node_modules` | غير موجود ✓ |
| `dist` | غير موجود ✓ |
| `userData`/profiles | غير موجود ✓ |
| `license/data` | غير موجود ✓ |
| مفتاح خاص Ed25519 | غير موجود ✓ |
| OAuth embedded secret | **موجود** ✗ |

---

## المرحلة 2 — مقارنة الكود

انظر `FILE-DIFF-MANIFEST.json` للتفاصيل الكاملة.

### إحصائيات

- **102** ملف فقط في Original
- **355** ملف فقط في Current
- **314** ملف مُعدَّل
- **679** ملف متطابق

### تغييرات جوهرية حسب النظام الفرعي

#### electron/ipc (18 ملف)
- `rbac-session.js` — CHANNEL_POLICY موسّع
- `main.js` — setup activation، password auth، license issuer
- `preload.js` — allowlist محدث
- `backup-v2-ipc.js` — setup restore + identity preservation

**الحالة:** **PASS** — تحسين أمني

#### database (12 ملف جديد/معدّل)
- migrations 003–006
- `sync-outbox.js`, `peer-sync-engine.js`

**الحالة:** **PASS**

#### sync/outbox (10+ ملف)
- إزالة TABLE_BUMP الافتراضي
- `restore-reconciliation.js` — لا push بعد restore

**الحالة:** **PASS**

#### backup/restore (15+ ملف)
- Backup V1 معطّل (`backup-v1-gate.js`)
- discovery سحابي metadata-only
- `classifySetupRestoreTarget`

**الحالة:** **PASS**

#### licensing (34 ملف)
- Main-process verification
- Legacy V5 generator **محفوظ** مع LIC_SECRETS
- إزالة `license/data` fixtures

**الحالة:** **FAIL** تجارياً / **PASS** وظيفياً

#### tests (+36 جديد)
- P0-A–E، current restore، v2.5.10 gates

**الحالة:** **PASS** (129/132)

#### تبعيات package.json

| التغيير | Original | Current |
|---------|----------|---------|
| +acorn, +dompurify, +sanitize-html | — | ✓ |
| xlsx | ^0.18.5 npm | vendor 0.20.3.tgz |
| overrides gaxios.uuid | — | ^11.1.1 |

---

## المرحلة 3 — تتبع الرحلات الحرجة

### 1. Startup / pre-auth / login / logout

**المسار:** `index.html` → `SetupStateService` → `boot-flow-ui.js` → IPC setup channels (public) → Main `database:setupCommit*` → SQLite.

**الحالة:** **PASS** (مصدر) | **UNVERIFIED** (مثبت)

### 2. Developer auth + رفض `__dev__` المزوّر

**المسار:** `authenticateDeveloper` → proof → `bindSession` → `rbac-session` يتحقق `isDev`.

**الاختبار:** P0-A 50 فحص.

**الحالة:** **PASS**

### 3. Owner creation / first-password / no seed recurrence

**المسار:** `owner-create-form.js` → `rbac:authenticateUser` → `database:setupCommitOwner`.

**الاختبار:** `p0-c:setup-owner-session` PASS.

**الحالة:** **PASS**

### 4. Google OAuth connect/callback/refresh/disconnect

**المسار:** `oauth-loopback.js` → PKCE/state → `token-store.js` → `secure-credential-vault.js`.

**الاختبار:** `p0-c:google-state-recovery` PASS.

**الحالة:** **PASS** (مصدر) | OAuth على مثبت **UNVERIFIED**

### 5. Licence validation / Sheets / Drive / commit / restart

**المسار:** `license-router.js` → Sheets vault → `commitActivation` → Drive → KV.

**إصلاح:** فشل Drive لا يكتب consumed للتراخيص cloudRequired.

**الحالة:** **PASS** (مصدر) | **FAIL** تجارياً (سر V5)

### 6–7. Setup org/branch/device + Device B

**المسار:** `center-setup` → `commitSetupOrganizationDevice` → restore مع `applySetupRestoreState`.

**الحالة:** **PASS** (اختبارات)

### 8–10. Backup V2 local/cloud + Legacy V3 encrypted

**الاختبارات:** hybrid-backup-v2, backup-restore-v2, setup-restore-runtime (wrong password no-swap).

**الحالة:** **PASS**

### 11. Initial sync after restore

**الإصلاح:** `boot-flow-ui.js:323-329` — verified backup يتخطى full-config hydrate.

**الاختبار:** AUD-BOOT-008 PASS.

**الحالة:** **PASS** (مصدر)

### 12. Device A/B concurrent / conflicts

**الاختبار:** v2-4:outbox-dual-device, p0-c:credential-publication.

**الحالة:** **PASS** (مصدر) | مثبت **UNVERIFIED**

### 13–16. Financial / payroll / reports / printing

**الاختبارات:** p0-e:financial-atomicity, payroll-finalization, report-scope, verify:tax-invoice.

**الحالة:** **PASS**

### 17. Owner Hub destructive actions

**الاختبار:** phase19:owner-hub, phase27:ownerhub-controls.

**الحالة:** **PASS** (مصدر)

### 18. Installer modes

**الاختبار:** ux:nsis-cupping-center-wipe, v2-3.5:uninstall-prep-preserve (مصدر فقط).

**الحالة:** **UNVERIFIED** (لا NSIS مبني)

---

## المرحلة 4 — بحث الأخطاء والأمان

انظر `SECURITY-REVIEW.md` و `BUG-REGISTER.md`.

### حوادث مُبلَّغ عنها

| الحادثة | الحالة |
|---------|--------|
| clone error Backup V2 download | **PASS** — await password |
| only Owner after restore | **PASS** مصدر — UNVERIFIED مثبت |
| password rejected after restore | **PASS** مصدر — UNVERIFIED مثبت |
| licence inactive after restart | **PASS** جزئي — UNVERIFIED مثبت |
| configuration_pull_incomplete | **PASS** — skip duplicate bootstrap |
| setup-only rows blocking | **PASS** — semantic classifier |
| Device B inherits A identity | **PASS** — identity merge |
| sparse backup hides older | **PASS** — explicit selection |
| discovery leaves SyncEngine stopped | **PASS** — resume logic |
| activation success after commit fail | **PASS** — fixed |

---

## المرحلة 5 — نتائج الاختبارات

انظر `TEST-RESULTS.json`.

### Original

| البند | النتيجة |
|-------|---------|
| Node/npm | v22.14.0 / 10.9.7 |
| lint | **FAIL** (118 خطأ) |
| full suite | **96/96 PASS** (exit 0) |

### Current

| البند | النتيجة |
|-------|---------|
| lint | **PASS** |
| full suite | **129/132** (exit 1) |
| فشل 1 | `p0-e:licensing-production` — LIC_SECRETS في الحزمة (متعمد) |
| فشل 2 | `baseline:license-read` — fixtures مُزالة (artifact) |
| فشل 3 | `license:test` — 4 فحوصات تجارية (متعمد) |

### اختبارات أمان/استعادة مركزة (Current)

كلها **PASS** — انظر TEST-RESULTS.json → `focusedSecurityRestoreTests`.

---

## المرحلة 6 — Windows Build

**الحالة الكاملة: UNVERIFIED**

انظر `WINDOWS-INSTALLED-EVIDENCE.md`.

---

## المرحلة 7 — الإصلاحات

**لم يُنفَّذ أي إصلاح في هذه المراجعة.**

الفشل الثلاثي في الاختبارات ليس regression قابلاً للإصلاح دون مخالفة قيد المالك #4 (إزالة سر V5 أو إضعاف اختبارات البوابة التجارية).

---

## التحسينات المؤكدة

1. أمان RBAC/IPC/P0-A
2. مزامنة per-record + منع full-table
3. استعادة مع reconciliation وهوية جهاز
4. migrations مالية وفرعية
5. إزالة أسرار التطوير من الأرشيف
6. DOMPurify للعرض الآمن
7. Backup V1 معطّل
8. اختبارات P0 شاملة (+36 مجموعة)

## الانحدارات المؤكدة

1. **لا انحدار وظيفي حرج** مُعاد إنتاجه في اختبارات المصدر
2. **baseline:license-read** يفشل بسبب تنظيف الأرشيف (متوقع)
3. **البوابة التجارية** تفشل بسبب قرار الإبقاء على V5 generator

## مسارات ميتة/مكررة

| المسار | الحالة |
|--------|--------|
| `stub-providers.js` (OneDrive/Dropbox) | محذوف من Current ✓ |
| Backup V1 | معطّل ببوابة ✓ |
| `license/data` fixtures | محذوف ✓ |
| PAT reports في Original docs | غير runtime |

## مخاطر الترحيل

| المخاطر | المستوى |
|---------|---------|
| schema 003–006 | متوسط — preflight backup |
| legacy branch quarantine | منخفض — UI migration |
| V5 keys موجودة | لا تأثير — نفس الخوارزمية |

## حظر الإصدار المتبقي

1. UAT Windows مثبت لمسارات restore/login/licence/restart
2. تدوير OAuth secret أو نقله لخادم
3. قرار تجاري: قبول مخاطر V5 أو نقل التوقيع لـ Main فقط
4. إصلاح/تعطيل `baseline:license-read` إن أُريد exit 0 نظيف

## خطة المعالجة المرتبة

1. **فوري:** UAT Windows معزول — restore كامل، login Owner/staff، licence restart
2. **فوري:** تدوير Google OAuth clientSecret
3. **قبل الإصدار التجاري:** قرار V5 — إبقاء مع إفصاح أو نقل signing لـ Main
4. **تحسين:** تحديث `baseline:license-read` ليعكس غياب fixtures
5. **تحسين:** corpus XSS Playwright على مثبت

---

## قرار المنتج الظاهر (يجب أن يبقى مرئياً)

> النسخة الحالية تحتفظ عمداً بمولّد Legacy V5 داخل التطبيق. التوليد الوظيفي قد ينجح بينما البوابة التجارية تفشل لأن مادة توقيع HMAC موزّعة في Renderer العميل. **لا يجوز** اعتبار المنتج آمناً تجارياً لمجرد أن مصادقة Developer تعمل.

---

## الملفات المُسلَّمة

| الملف | الوصف |
|-------|-------|
| `INDEPENDENT-ORIGINAL-VS-CURRENT-REVIEW.md` | هذا التقرير |
| `FILE-DIFF-MANIFEST.json` | فهرس الاختلافات |
| `TEST-RESULTS.json` | نتائج الاختبارات |
| `BUG-REGISTER.md` | سجل الأخطاء |
| `SECURITY-REVIEW.md` | مراجعة أمان |
| `DATA-BRANCH-SYNC-RESTORE-REVIEW.md` | بيانات/فروع/مزامنة |
| `WINDOWS-INSTALLED-EVIDENCE.md` | UNVERIFIED |

---

**التوقيع:** مراجعة مستقلة — أدلة من المصدر والاختبارات فقط؛ لم تُستبدل فحوصات Windows المثبت بـ PASS افتراضي.
