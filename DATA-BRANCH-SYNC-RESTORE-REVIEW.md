# مراجعة البيانات / الفروع / المزامنة / الاستعادة

**مقارنة:** Original v2.5.9 ↔ Current FINAL-RESTORE-20260813

---

## 1. مخطط قاعدة البيانات

| Migration | Original | Current | التأثير |
|-----------|----------|---------|---------|
| 001_initial | ✓ | ✓ | جداول أساسية |
| 002_sync_platform | ✓ | ✓ | outbox/inbox |
| 003_p0b_authority | ✗ | ✓ | quarantine + branch authority |
| 004_sync_operations | ✗ | ✓ | per-record sync + tombstones |
| 005_financial_integrity | ✗ | ✓ | invoice_sequences, financial_transactions |
| 006_financial_reversals | ✗ | ✓ | reversals + scoped invoice index |

**التوافق:** ترقية تلقائية عند أول فتح. لا downgrade مدعوم.

**الحالة:** **PASS** (اختبار `phase4:sqlite`, migrations في `connection.js`)

---

## 2. مصدر الحقيقة (Source of Truth)

| الجانب | Original | Current |
|--------|----------|---------|
| التخزين الأساسي | SQLite + KV هجين | SQLite authoritative + KV محدود |
| كتابة Renderer | أوسع (TABLE_BUMP) | `synced-write` → Main commit → outbox event |
| full-table push | مسموح من Renderer | **محظور** إلا `legacyMigration: true` |
| localStorage للبيانات التشغيلية | أوسع | مُقلَّص — SQLite أولاً |

**الحالة:** **PASS** — تحسين جوهري

---

## 3. Outbox والمزامنة

### Original
- `schedulePush` يمكنه إرسال TABLE_BUMP
- last-write-wins على جداول كاملة

### Current
- `database/sync-outbox.js` + `004_sync_operations`
- `sync-engine.js`: `pushTable` يرفض بدون `legacyMigration`
- debounce يستدعي drain في Main فقط
- poll backoff عند الفشل

**مسار الكتابة:** UI → `synced-write` → IPC `database:write` → SQLite transaction → outbox event → `syncPush`

**الاختبارات:** `p0-d:operation-sync` PASS, `v2-4:outbox-dual-device` PASS, `v2-4:large-queue` PASS

**الحالة:** **PASS**

---

## 4. الاستعادة

### Backup V2 المحلي
1. `backup:v2:create` → تشفير → ملف `.tdw`
2. `backup:v2:verify` → فحص سلامة
3. `backup:v2:restore` → staging → atomic swap → emergency backup

**الاختبار:** `hybrid:backup-v2` PASS, `backup-restore-v2.test.js` PASS

### Backup V2 السحابي
1. Discovery (metadata فقط، SyncEngine متوقف)
2. اختيار صريح عند تعدد النسخ
3. `await` password قبل IPC (إصلاح clone)
4. `captureSetupRestoreState` → restore → `applySetupRestoreState` (هوية Device B)

### Legacy V3/V5 encrypted
- كلمة مرور خاطئة → no-swap (`test-current-setup-restore-runtime.js`)

### Post-restore sync
- `verifiedDatabaseRestore` → operation pull فقط، **لا** `runNewDeviceBootstrap` كامل
- يمنع `configuration_pull_incomplete`

**الحالة:** **PASS** (مصدر + اختبارات) | **UNVERIFIED** (Windows مثبت)

---

## 5. الفروع والسياق

### `cloud/branch-contexts.js` (جديد)
- `deviceBound` — فرع الجهاز المقفل
- `reporting` — تقارير المالك
- `operationalWrite` — كتابة تشغيلية

### P0-B quarantine
- صفوف legacy غامضة → `p0b_quarantine` — لا BR-MAIN صامت

**الاختبارات:** `p0-b:authority-branch-isolation` PASS, `phase18:multibranch-cloud` PASS

**الحالة:** **PASS**

---

## 6. Device A / Device B

| سيناريو | Original | Current |
|---------|----------|---------|
| Device B enrollment | خطر وراثة UUID | `applySetupRestoreState` يحفظ registry الحالي |
| concurrent writes | outbox أساسي | per-record ops + credential publication atomic |
| delete/update conflict | conflict queue | `conflict-queue.js` + `record-merger.js` |
| offline/reconnect | poll | poll + backoff |

**الاختبار:** `v2-4:outbox-dual-device` PASS, `p0-c:credential-publication` PASS

**الحالة:** **PASS** (مصدر) | Device A/B concurrent على مثبت **UNVERIFIED**

---

## 7. الترخيص والتفعيل

### مسار V5
1. إدخال مفتاح → `license-router.js`
2. Sheets lookup/consume → `license-vault-proxy.js` (Main)
3. `LicenseActivationGate.commitActivation`
4. Drive push (مطلوب لـ multi-branch)
5. local commit → `__tdw_license_activation_state__`

**إصلاح AUD-LIC-010:** فشل Drive المطلوب → لا `consumed` في KV

**الاختبار:** `p0-e:runtime-license-immutability` PASS

### بعد restart
- الترخيص من SQLite/KV — `test-current-restore-license-login.js`

**الحالة:** **PASS** (مصدر) | restart على مثبت **UNVERIFIED**

---

## 8. المعاملات المالية

- `005_financial_integrity` — sequences + transactions
- `006_financial_reversals` — reversals
- payroll: `p0-e:payroll-finalization` PASS
- reports scope: `p0-e:report-scope` PASS

**الحالة:** **PASS**

---

## 9. مقارنة سريعة بالحوادث

| الحادث | الإصلاح | اختبار | مثبت |
|--------|---------|--------|------|
| setup-only blocking restore | `classifySetupRestoreTarget` | 7/7 | UNVERIFIED |
| Device B identity | `applySetupRestoreState` | legacy-cloud-restore | UNVERIFIED |
| config_pull_incomplete | skip full bootstrap | AUD-BOOT-008 | UNVERIFIED |
| sparse backup selection | explicit multi-choice | restore-license-login | UNVERIFIED |
| discovery stops sync | pause/resume | 6/6 | UNVERIFIED |
| activation after fail | gate before KV write | immutability | UNVERIFIED |

---

## مخاطر فقدان البيانات

| المخاطر | المستوى | الملاحظة |
|---------|---------|----------|
| استعادة خاطئة تستبدل بيانات | منخفض | staging + emergency backup + rollback |
| push بعد restore | منخفض | `restore-reconciliation.js` — لا push فوري |
| full-table overwrite | منخفض | محظور في Current |
| ترقية schema | متوسط | اختبار migrations PASS؛ backup قبل P0B preflight |

---

## Production Candidate: **NO** (UNVERIFIED مثبت + أمان تجاري V5)
