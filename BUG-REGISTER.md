# سجل الأخطاء — مراجعة مستقلة Original vs Current

**تاريخ:** 2026-08-13  
**النسخة الحالية:** `CURRENT-FINAL-RESTORE-SOURCE.zip` (SHA-256: `9c0339cc…`)  
**النسخة الأصلية:** `ORIGINAL-V2-5-9-SOURCE.zip` (SHA-256: `01e89d6f…`)

---

## ملخص حسب الخطورة

| الخطورة | مؤكد في المصدر | مُصلَح في Current | UNVERIFIED (مثبت) | متعمد/قرار منتج |
|---------|----------------|-------------------|-------------------|-----------------|
| Critical | 1 | 0 | 5+ | 1 |
| High | 2 | 2 | 4 | 0 |
| Medium | 3 | 3 | 2 | 1 |
| Low | 4 | 2 | 1 | 2 |

---

## Critical

### BUG-CRIT-001 — سر توقيع Legacy V5 موزّع في Renderer (قرار منتج مفتوح)

| الحقل | التفاصيل |
|-------|----------|
| **الحالة** | **FAIL** (متعمد — لا يُعدّ regression) |
| **الأصل** | `license/core/license-crypto.js` — `LIC_SECRETS` + `TADAWI_OFFLINE_LIC_V4` |
| **الحالي** | نفس الملف + `electron/legacy-license-crypto.js` في Main |
| **الدليل** | `npm test` → `license:test` 4 فشل: `customer package excludes LIC_SECRETS`, `createHmac(`, `subtle.sign('HMAC'` |
| **التأثير** | أي عميل يمكنه توليد مفاتيح V5 صالحة وظيفياً؛ البوابة التجارية تفشل عمداً |
| **الاختبار** | `scripts/commercial-licensing-test.mjs`, `test-p0-e-licensing-production.js` |
| **الإصلاح المطلوب** | نقل التوقيع إلى Main/خادم — خارج نطاق هذه المراجعة (قيد #4: لا إزالة صامتة) |

### BUG-CRIT-002 — OAuth clientSecret مضمّن في الحزمة

| الحقل | التفاصيل |
|-------|----------|
| **الحالة** | **FAIL** |
| **الأصل** | `electron/cloud-oauth.embedded.json` |
| **الحالي** | نفس الملف موجود (`GOCSPX-…`) |
| **التأثير** | تسريب سر OAuth لأي من يفك الحزمة؛ يتطلب تدوير في Google Console |
| **الاختبار** | فحص يدوي للملف — لا اختبار CI يفشل |
| **UNVERIFIED** | سلوك OAuth على Windows مثبت |

### BUG-CRIT-003 — حوادث الاستعادة/التفعيل على Windows المثبت

| الحقل | التفاصيل |
|-------|----------|
| **الحالة** | **UNVERIFIED** |
| **الحوادث** | only Owner بعد restore؛ رفض كلمة مرور صحيحة؛ ترخيص غير نشط بعد restart؛ `configuration_pull_incomplete` |
| **المصدر** | إصلاحات موجودة في `boot-flow-ui.js`, `backup-v2-core.js`, `password-auth.js` |
| **الاختبار المصدر** | `test-current-restore-license-login.js` PASS؛ `test-p0-c-restore-truth-and-boot-gate.js` 11/11 PASS |
| **الدليل الناقص** | لا UAT مثبت على Windows في هذه البيئة |

### BUG-CRIT-004 (أصلي — مُصلَح في Current) — `consumed=true` قبل فشل رفع Drive

| الحقل | التفاصيل |
|-------|----------|
| **الحالة الأصلية** | **FAIL** (AUD-LIC-010) |
| **الحالة الحالية** | **PASS** (مصدر) |
| **الإصلاح** | `license-activation-gate.js`: فشل `ensurePushedToDrive` للتراخيص `cloudRequired` يُرجع `ok:false` قبل `DB.set('__tdw_license_activation_state__')` |
| **الدليل** | `test-p0-e-runtime-license-immutability.js` سطر 102: `failed required upload leaves activation unconsumed` |

### BUG-CRIT-005 (أصلي — مُصلَح في Current) — `An object could not be cloned` أثناء Backup V2 download

| الحقل | التفاصيل |
|-------|----------|
| **الحالة** | **PASS** (مصدر) |
| **السبب** | تمرير `Promise` من `getBackupV2Password()` عبر IPC |
| **الإصلاح** | `cloud/cloud-data-discovery.js:471-472` — `await` قبل IPC |
| **الاختبار** | `test-current-setup-restore-runtime.js`: `restore IPC result must be cloneable` |

---

## High

### BUG-HIGH-001 (أصلي — مُصلَح) — صفوف setup-only تمنع الاستعادة

| **الحالة** | **PASS** |
| **الإصلاح** | `classifySetupRestoreTarget()` في `electron/backup-v2-core.js:274+` |
| **الاختبار** | `test-p0-c-setup-restore-target.js` 7/7 |

### BUG-HIGH-002 (أصلي — مُصلَح) — Device B يرث UUID/فرع Device A

| **الحالة** | **PASS** (مصدر) |
| **الإصلاح** | `captureSetupRestoreState` + `applySetupRestoreState` في `electron/backup-v2-ipc.js:156+` |
| **الاختبار** | `test-current-legacy-cloud-restore-runtime.js` — device binding must survive |

### BUG-HIGH-003 (أصلي — مُصلَح) — `configuration_pull_incomplete` بعد restore كامل

| **الحالة** | **PASS** (مصدر) |
| **الإصلاح** | `boot-flow-ui.js:323-329` — تخطي `runNewDeviceBootstrap` عند `verifiedDatabaseRestore` |
| **الاختبار** | `test-p0-c-restore-truth-and-boot-gate.js` AUD-BOOT-008 |

### BUG-HIGH-004 (أصلي — مُصلَح) — أحدث نسخة sparse تخفي نقاط استعادة أقدم

| **الحالة** | **PASS** (مصدر) |
| **الإصلاح** | `boot-flow-ui.js:1600-1603` — `backupPoints.length > 1 ? null : newest` |
| **الاختبار** | `test-current-restore-license-login.js` |

### BUG-HIGH-005 (أصلي — مُصلَح) — Discovery يترك SyncEngine متوقفاً

| **الحالة** | **PASS** (مصدر) |
| **الإصلاح** | `cloud/cloud-data-discovery.js:209-230` + `resumeDiscoverySync` |
| **الاختبار** | `test-p0-c-discovery-integrity.js` 6/6 |

---

## Medium

### BUG-MED-001 — `baseline:license-read` يفشل لغياب fixtures

| **الحالة** | **FAIL** (artifact — ليس regression منتج) |
| **السبب** | إزالة `license/data/*` من الأرشيف النظيف عمداً |
| **التأثير** | اختبار تاريخي فقط؛ لا يؤثر على runtime |

### BUG-MED-002 — innerHTML في boot-flow-ui و index.html

| **الحالة** | **PASS** جزئي |
| **التخفيف** | `renderer/security/safe-render.js` + DOMPurify للبيانات المخزنة |
| **المتبقي** | قوالب boot-flow ثابتة تستخدم innerHTML مباشرة (مخاطر أقل) |

### BUG-MED-003 — 54 قناة IPC عامة (`public: true`)

| **الحالة** | **PASS** (مصمم) |
| **الدليل** | `rbac-session.js` — قنوات setup/pre-auth مقصودة؛ الباقي يتطلب `bindSession` + سياسة |
| **الاختبار** | `test-p0-a-security-boundary.js` 50 فحص |

### BUG-MED-004 — Original lint 118 خطأ

| **الحالة** | **FAIL** (أصلي فقط) |
| **الحالي** | lint **PASS** |

---

## Low

### BUG-LOW-001 — npm audit 28 ثغرة في تبعيات التطوير
### BUG-LOW-002 — اختبارات windows-uat mock-heavy بدون إثبات مثبت
### BUG-LOW-003 — `docs/` كبير (~7MB أدلة) — ليس في حزمة العميل
### BUG-LOW-004 — Original يحتوي `ed25519-private.pem` تطويري (مُزال من Current)

---

## حوادث مُبلَّغ عنها — مصفوفة الحالة

| الحادثة | مصدر | اختبار | مثبت Windows |
|---------|------|--------|--------------|
| clone error Backup V2 | PASS | PASS | UNVERIFIED |
| only Owner بعد restore | PASS | PASS | UNVERIFIED |
| رفض كلمة مرور بعد restore | PASS | PASS | UNVERIFIED |
| ترخيص غير نشط بعد restart | PASS | جزئي | UNVERIFIED |
| configuration_pull_incomplete | PASS | PASS | UNVERIFIED |
| setup-only rows blocking | PASS | PASS | UNVERIFIED |
| Device B identity | PASS | PASS | UNVERIFIED |
| sparse backup hiding | PASS | PASS | UNVERIFIED |
| discovery SyncEngine stopped | PASS | PASS | UNVERIFIED |
| activation success after commit fail | PASS (fixed) | PASS | UNVERIFIED |
