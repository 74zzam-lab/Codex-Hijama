# مصدر البناء — Hijama Management System 2.0.1

هذا الفرع يحتوي **ملف ZIP واحد** للبناء والتشغيل المباشر.

## الملف

| البند | القيمة |
|-------|--------|
| الاسم | `Hijama-Management-System-SOURCE-BUILD-2.0.1.zip` |
| SHA-256 | `80a6aa78dd0e3cc1f211c95f0a686c1311a285f41ef168c420803502e56e51a4` |

## مضمّن افتراضياً (مثل النسخة الأصلية)

- **Google OAuth** — `electron/cloud-oauth.embedded.json` + `cloud-oauth.config.json`
- **Google Sheets License Vault** — `license/license-vault.defaults.json`
- **Legacy V5** — محفوظ

## الاستخدام

```bat
unzip Hijama-Management-System-SOURCE-BUILD-2.0.1.zip -d Hijama-Build
cd Hijama-Build
npm ci
npm start
```

```bat
npm run build
```

لا حاجة لتعيين OAuth يدوياً — جاهز للتشغيل مباشرة بعد `npm ci`.
