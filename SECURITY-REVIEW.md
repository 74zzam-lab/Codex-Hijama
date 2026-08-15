# مراجعة الأمان — النسخة الحالية (مستقلة)

**الأرشيف:** `9c0339cc9cb6a039e859c61a32dd1b586517950103eceac70634a2c8a146ad9d`  
**التاريخ:** 2026-08-13

---

## الحكم التنفيذي

| البند | الحالة |
|-------|--------|
| حدود Renderer/Main (RBAC/IPC) | **PASS** (مصدر + 50 فحص P0-A) |
| رفض `__dev__` المزوّر | **PASS** |
| مصادقة Developer في Main | **PASS** |
| حماية KV المحمية | **PASS** |
| أمان الاستعادة (no-mutation قبل verify) | **PASS** (اختبارات) |
| أمان تجاري Legacy V5 | **FAIL** (متعمد) |
| سر OAuth مضمّن | **FAIL** |
| XSS للبيانات المخزنة | **PASS** جزئي (DOMPurify) |
| Windows مثبت | **UNVERIFIED** |

**الأمان التشغيلي للمطور:** مقبول بشروط  
**الأمان التجاري للترخيص V5:** **غير مقبول** — سر HMAC في Renderer

---

## 1. مصادقة Developer و`__dev__`

### السلوك المطلوب
Renderer لا يربط `__dev__`/Owner/Admin بدون إثبات Main موثوق.

### الدليل

```262:265:review-work/current-extract/electron/rbac-session.js
  const isDevAccount = userId === '__dev__' && role === 'admin' && authentication.proof.isDev === true;
  if (userId === '__dev__' && !isDevAccount) {
    return { ok: false, error: 'developer_authentication_required' };
```

**المسار:** `index.html` → `preload.rbac.authenticateDeveloper(password)` → `main: rbac:authenticateDeveloper` → `password-auth.js` (PBKDF2 v2, 210k iter) → `issueAuthenticationProof` → `bindSession({authProof})`.

**الاختبار:** `test-p0-a-security-boundary.js` — ربط مزوّر بدون proof → `developer_authentication_required`.

**الحالة:** **PASS**

---

## 2. سياسة IPC — ليست default-allow

- **127** قناة مسجّلة في `CHANNEL_POLICY`
- **54** قناة `public: true` — مقصودة لمرحلة setup/pre-auth (`database:setupCommit*`, `rbac:authenticate*`, `cloudOAuth:*`)
- كل `handle()` يمر عبر: `assertTrustedSender` → `assertChannelAllowed` → `V.guard`
- `preload.js` يسمح فقط بقنوات `ALLOWED_INVOKE` — لا `ipcRenderer.invoke` مفتوح

**الحالة:** **PASS**

---

## 3. KV محمية وRBAC

`PROTECTED_KV_KEYS` في `rbac-session.js` يشمل: `users`, `settings`, `__tdw_license_activation_state__`, `__tdw_device_registry__`, إلخ.

كتابة KV عبر IPC تتطلب جلسة مربوطة + صلاحية مناسبة.

**الحالة:** **PASS**

---

## 4. Legacy V5 — مخاطر تجارية (قرار منتج ظاهر)

### الحقيقة الوظيفية
المولّد يعمل: `license/engine/license-generator-v2.js` → `encodeV5Key` → `LIC_SECRETS` في `license/core/license-crypto.js`.

### الحقيقة الأمنية
```7:12:review-work/current-extract/license/core/license-crypto.js
  const LIC_SECRETS = ['TDW', '2026', 'Hj@', 'مة'];
  ...
    const material = new TextEncoder().encode(LIC_SECRETS.join('|') + '|TADAWI_OFFLINE_LIC_V4');
```

**اختبارات البوابة التجارية تفشل عمداً:**
- `customer package excludes LIC_SECRETS` — FAIL
- `customer package excludes createHmac(` — FAIL
- `customer package excludes subtle.sign('HMAC'` — FAIL

**لا يجوز** اعتبار المنتج آمناً تجارياً لأن مصادقة Developer تعمل.

**الحالة:** **FAIL** (متعمد — AUD-LIC-002)

---

## 5. OAuth وأسرار مضمّنة

| الملف | المحتوى | الحالة |
|-------|---------|--------|
| `electron/cloud-oauth.embedded.json` | `clientSecret: GOCSPX-…` | **FAIL** — يجب تدوير |
| `electron/cloud-oauth.config.json` | نفس السر | في `.gitignore` لكن موجود في الأرشيف |
| `tools/license-admin/keys/dev/ed25519-public.pem` | مفتاح عام فقط | PASS |
| `ed25519-private.pem` | غير موجود في Current | PASS (كان في Original) |

---

## 6. XSS وطباعة

| المنطقة | الآلية | الحالة |
|---------|--------|--------|
| بيانات عملاء/تقارير | `renderer/security/safe-render.js` + DOMPurify | PASS |
| boot-flow-ui | innerHTML لقوالب ثابتة | Medium risk |
| index.html | innerHTML واسع — يحتاج مراجعة حقل بحقل | UNVERIFIED corpus كامل |
| طباعة | `electron/security/print-document.js` | PASS (مصدر) |

**اختبار XSS corpus كامل:** **UNVERIFIED** (لم يُنفَّذ Playwright corpus في هذه البيئة)

---

## 7. structured-clone عبر IPC

**الإصلاح المؤكد:** `cloud-data-discovery.js:471-472` — await لكلمة المرور قبل `v2SetupCloudRestore`.

**الاختبار:** `test-current-setup-restore-runtime.js` — `structuredClone(result)` لا يرمي.

**الحالة:** **PASS**

---

## 8. مصادقة المستخدم/المالك في Main

- `rbac:authenticateUser` → `password-auth.authenticateUser(users, credentials, senderId)`
- Owner creation: `cloud/owner-create-form.js` يستدعي `rbac.authenticateUser` قبل `bindSession`
- بعد restore: `test-current-restore-license-login.js` PASS

**الحالة:** **PASS** (مصدر)

---

## 9. فحص الأنماط الخطرة

| النمط | النتيجة |
|-------|---------|
| `pushTable` بدون `legacyMigration` | **محظور** — `sync-engine.js:150` |
| Backup V1 | **معطّل** — `backup-v1-gate.js` |
| full-table sync من Renderer | **محظور** |
| Renderer يتحكم بالدور | **مرفوض** — يتطلب proof |
| restore قبل verify | **مرفوض** — staging + rollback |
| fire-and-forget authoritative | لم يُعثر على حالات حرجة في المسارات المراجَعة |
| missing await في restore password | **مُصلَح** |

---

## 10. محتوى الحزمة

| عنصر محظور | Current |
|------------|---------|
| `node_modules` | غير موجود ✓ |
| `dist` | غير موجود ✓ |
| `.codex-*` | غير موجود ✓ |
| `userData`/tokens | غير موجود ✓ |
| `license/data` fixtures | غير موجود ✓ |
| مفتاح خاص Ed25519 | غير موجود ✓ |

---

## مخاطر متبقية (Release Blockers)

1. **AUD-LIC-002** — سر V5 في Renderer — Critical FAIL
2. **OAuth secret** في الحزمة — Critical FAIL
3. **Windows UAT** — Critical UNVERIFIED لمسارات الاستعادة/التفعيل

---

## Production Candidate: **NO**  
## Ready for commercial release: **NO**

(أي Critical FAIL أو Critical UNVERIFIED = NO-GO)
