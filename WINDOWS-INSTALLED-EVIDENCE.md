# أدلة التشغيل المثبت على Windows

**الحالة: UNVERIFIED**

## سبب عدم التحقق

بيئة المراجعة الحالية:

| البند | القيمة |
|-------|--------|
| نظام التشغيل | Linux 6.12.94+ x86_64 |
| Node | v22.14.0 |
| npm | 10.9.7 |
| Wine / Windows VM | غير متوفر |
| أمر البناء | `npm run build` → `scripts/run-win-build.cjs` (يتطلب Windows + electron-builder NSIS) |

## الخطوات غير المنفذة

1. بناء EXE الإنتاجي — **UNVERIFIED**
2. تسجيل اسم/حجم/SHA-256 للمثبت — **UNVERIFIED**
3. التثبيت في مسار معزول — **UNVERIFIED**
4. مطابقة `app.asar` مع المصدر — **UNVERIFIED**
5. سيناريوهات الأمان/الاستعادة/الترخيص/إعادة التشغيل على البايتات المثبتة — **UNVERIFIED**
6. Authenticode — **UNVERIFIED**

## ما تم التحقق منه بدلاً من ذلك (مصدر + اختبارات Node)

- Lint النسخة الحالية: **PASS**
- مجموعة الاختبارات الكاملة: **129/132** (exit code 1)
- اختبارات الاستعادة/الأمان المركزة: **PASS** (انظر `TEST-RESULTS.json`)
- اختبارات `windows-uat/*.cjs`: موجودة في المصدر لكن **UNVERIFIED** على Windows مثبت

## مخاطر UNVERIFIED

أي عطل يظهر فقط على Windows المثبت (مسارات، safeStorage، NSIS keep-data، Authenticode، حوار كلمة مرور النسخة الاحتياطية) يبقى **UNVERIFIED** ويُعامل كمخاطر إصدار حتى يُنفَّذ UAT مثبت على Windows.

## التوصية

تنفيذ UAT Windows معزول قبل الإصدار التجاري باستخدام:

```bash
npm ci
npm run build
# تثبيت HijamaManagement-Setup-2.0.1.exe في مسار معزول
# تشغيل scripts/windows-uat/v2-5-9-ae-runtime.cjs و current-cloud-restore-isolated.cjs
```
