# التقرير الكامل: البرنامج الأصلي مقابل الحالة الحالية

**تاريخ التقرير:** 2026-08-13  
**النطاق:** من النسخة الأصلية V2-5.9 التي بدأ منها التدقيق والإصلاح حتى `FINAL-RESTORE-20260813`  
**الغرض:** تسليم هندسي قابل للمراجعة إلى Cursor يوضح كل ما تغيّر، وما ثبت إصلاحه، وما بقي مفتوحًا.

## 1. هوية النسختين وطريقة المقارنة

### النسخة الأصلية

- الملف: `D:\Cupping-System-Management-cursor-v2-5-9-final-activation-ownerhub-release-c2ea (2).zip`
- تاريخ الملف: 2026-08-01 14:37:01 +03:00
- الحجم: 13,475,780 bytes
- SHA-256: `01e89d6fc161530ae03690865062827bbdecbb7ca58b3e0fe331909a9536b0cc`
- اسم/إصدار الحزمة: `hijama-management-system@2.0.1`
- هذه هي نفس تسمية الفرع المذكورة في تقرير التدقيق المستقل الأصلي.

### النسخة الحالية

- Build ID: `FINAL-RESTORE-20260813`
- اسم/إصدار الحزمة: `hijama-management-system@2.0.1`
- حزمة التسليم النهائية النظيفة: `artifacts/Hijama-Clinic-FINAL-RESTORE-20260813-CURSOR-HANDOFF.zip`
- بصمة الحزمة الحالية موزعة في الملف المجاور `.zip.sha256` لأن تضمين بصمة ZIP داخله يغير البصمة نفسها.
- لا توجد بيانات Git داخل مساحة العمل الحالية؛ لذلك اعتمدت المقارنة على فك النسخة الأصلية المعينة أعلاه ثم مقارنة محتوى الملفات وبصماتها فعليًا بالمصدر الحالي.

### مصادر الإثبات

1. مقارنة فعلية لمحتوى النسخة الأصلية والحالية.
2. `docs/final-review/*` كتدقيق baseline مؤرخ 2026-08-01.
3. `docs/remediation/AUDIT-TRACEABILITY.md` كسجل المتطلبات والتاريخ الرسمي.
4. أدلة P0-A/P0-B/P0-C/P0-A-E وFinal Clean Runtime الموجودة تحت `docs/remediation/evidence`.
5. الاختبارات الحالية المركزة والكاملة.
6. تشخيص Drive الحقيقي read-only واستعادة حقيقية داخل profile مؤقت معزول؛ لم تُعدّل بيانات المستخدم الحية.

## 2. الخلاصة التنفيذية

البرنامج الحالي ليس مجرد تعديل صغير على النسخة الأصلية. طبقات الأمن، SQLite، عزل الفروع، المزامنة، إعداد البرنامج، الترخيص، Backup V2، الاستعادة، والاختبارات تغيرت بعمق، بينما جرى الحفاظ على الشكل العام للواجهة والوظائف اليومية الأساسية ومولد V5 المطلوب.

أكبر فرق معماري هو أن النسخة الأصلية كانت بنية انتقالية متعددة مصادر الحقيقة: SQLite مقصودة كمصدر رئيسي، لكن localStorage وKV وذاكرة Renderer وBackup V1 ومسارات Cloud متعددة ظلت قادرة على الكتابة أو عرض حالة مختلفة. النسخة الحالية تفرض في المسارات التشغيلية الأساسية:

`UI -> typed/authorized service -> SQLite transaction -> durable outbox -> SyncEngine`

أكبر فرق أمني هو الانتقال من ثقة جزئية في Renderer وقنوات IPC ذات استثناءات واسعة إلى جلسات وإثباتات Main، وسياسات deny-by-default، وحماية KV، ومسار rendering آمن، وطباعة sandboxed، وOAuth state/PKCE.

أكبر فرق في الاستعادة هو الانتقال من اختيار أحدث ملف تلقائيًا ومنع restore بسبب صفوف bootstrap إلى قائمة نقاط استعادة، وتصنيف دلالي للقاعدة، وفك/فحص/staging/atomic swap، ودمج متحكم لهوية الجهاز الجديد، مع الحفاظ على Owner والترخيص بعد restart.

رغم ذلك لا يمكن وصف النسخة الحالية بأنها Commercial Production PASS للأسباب التالية:

- مولد V5 وسر HMAC ما زالا داخل تطبيق العميل بقرار مالك المنتج؛ وهذا يبقي `AUD-LIC-002` Critical = `FAIL`.
- آخر إصلاحات الاستعادة الحالية لم تُبن وتُثبت في EXE مطابق لهذه البايتات؛ Installed EXE = `UNVERIFIED`.
- اختبارات Google/Drive/Sheets وDevice A/B الكاملة على جهازين حقيقيين وعلى البناء الحالي ليست مكتملة.
- Authenticode غير مهيأ.
- أحدث نسخة Drive الفعلية sparse وتحتوي Owner واحدًا فقط ولا تحتوي بيانات النشاط؛ استعادة البيانات القديمة تتطلب اختيار النسخة الأكبر وإدخال كلمة مرورها التاريخية.

## 3. الفرق الرقمي في المصدر

### مقارنة ملفات التشغيل والبناء

تم استبعاد `docs` و`tests` و`scripts` و`node_modules` و`dist` وملفات الأدلة من هذا العد حتى لا تختلط تغييرات الكود بتغييرات التوثيق.

| النوع | العدد |
|---|---:|
| ملفات مضافة | 50 |
| ملفات معدلة | 127 |
| ملفات محذوفة | 3 |
| إجمالي الملفات المختلفة | 180 |

تفصيل المجلدات الأساسية:

| المنطقة | مضاف | محذوف | معدل |
|---|---:|---:|---:|
| `build` | 4 | 0 | 1 |
| `cloud` | 12 | 0 | 47 |
| `database` | 5 | 0 | 6 |
| `electron` | 16 | 1 | 18 |
| `license` | 10 | 0 | 25 |
| `renderer` | 1 | 0 | 0 |
| `tools` | 1 | 2 | 4 |
| ملفات الجذر | 0 | 0 | 26 |
| `vendor` | 1 | 0 | 0 |

ملاحظة: عدّ `license` الخام يتضمن fixtures أنتجتها/استخدمتها الاختبارات. حزمة العميل وحزمة التسليم تستبعد `license/data` عمدًا؛ لذلك لا تعني هذه الملفات أن بيانات عملاء أو مفاتيح إصدار اختبارية ستُحزم مع العميل.

### تغير حجم الملفات المحورية

| الملف | أسطر الأصل | أسطر الحالي | معنى التغير |
|---|---:|---:|---|
| `index.html` | 26,840 | 28,147 | وظائف وحواجز أكثر، لكن monolith ما زال قائمًا وكبر بدل أن ينقسم |
| `electron/main.js` | 859 | 1,387 | سياسات IPC، إعداد، ترخيص، vault وعمليات Main إضافية |
| `electron/preload.js` | 274 | 359 | API مصرح ومحدد لقنوات جديدة |
| `electron/rbac-session.js` | 216 | 499 | إثباتات مصادقة وسياسة deny-by-default ومصفوفة صلاحيات أوسع |
| `electron/database/service.js` | 232 | 1,963 | أصبح مركز المعاملات والهجرات والتجهيز والاستعادة والـoutbox |
| `cloud/boot-flow-ui.js` | 1,332 | 2,121 | بوابات إعداد واستعادة/Google/Owner/Sync أكثر صرامة |
| `cloud/sync-engine.js` | 570 | 766 | عمليات سجلية، revisions، tombstones وretry |
| `cloud/cloud-data-discovery.js` | 0 | 774 | اكتشاف Drive/Backup/ترخيص جديد كامل |
| `electron/backup-v2-core.js` | 915 | 1,118 | تصنيف setup، staging ودمج الاستعادة |
| `electron/backup-v2-ipc.js` | 458 | 863 | حواجز Main، الهوية، safeStorage والاستبدال الذري |
| `cupping-sqlite-bridge.js` | 137 | 576 | جسر authoritative/typed بدل واجهة خفيفة هجينة |

### الهجرات والاختبارات

| المؤشر | الأصل | الحالي |
|---|---:|---:|
| ملفات migrations | 2 | 6 |
| ملفات tests | 78 | 114 |
| ملفات scripts | 104 | 123 |
| ملفات docs | 593 | 842 |

الهجرات المضافة:

- `003_p0b_authority.js`
- `004_sync_operations.js`
- `005_financial_integrity.js`
- `006_financial_reversals.js`

### التبعيات

أضيفت:

- `acorn` لتحليل/فرض مسارات JavaScript الآمنة.
- `dompurify` لمسارات HTML المحدود التي تحتاج sanitizer.
- `sanitize-html` للتنقية المنظمة في البيئات المناسبة.

تم تحديث SheetJS من `xlsx@0.18.5` إلى artifact محلي رسمي `xlsx-0.20.3.tgz` لإغلاق تحذيرات الأمان المعروفة في النسخة القديمة.

## 4. المقارنة المعمارية

| العنصر | البرنامج الأصلي | البرنامج الحالي | النتيجة |
|---|---|---|---|
| مصدر الحقيقة | SQLite مقصودة، لكن localStorage/KV/window arrays تظل مصادر فعلية متنافسة | SQLite authoritative للمعلومات التشغيلية؛ Renderer projection ومسارات KV التشغيلية مرفوضة | تحسن جذري؛ بعض compatibility/UI state القديم ما زال موجودًا |
| الكتابة | `DB.set` مختلط، بعض الاستدعاءات sync ظاهريًا أو fire-and-forget | أوامر typed/awaited بنتيجة موحدة ومعاملة وoutbox | أصلح false success وسباقات الحفظ |
| حدود الوحدات | mega Renderer مع خدمات متعددة ومتداخلة | خدمات Main/DB/Cloud أكثر تحديدًا، لكن `index.html` ازداد حجمًا | cohesion تحسن في الطبقات الحساسة، maintainability العامة ما زالت ضعيفة |
| Cloud | مسارات activation/Drive/backup متكررة | publication owners وحواجز أوضح، Backup V1 معطل، V2/operations هما المساران المقصودان | أقل تضاربًا، لكن UI والتاريخ ما زالا معقدين |
| التوافق القديم | مسارات قديمة حية وقد تكتب | migration/read compatibility مع منع writers القديمة في المسار الطبيعي | أكثر أمانًا، لكن يزيد حجم الكود المؤقت |

## 5. الأمن وIPC وXSS

### الأصل

- قيم مخزنة/مدخلة كانت تدخل في `innerHTML` وinline handlers في مواضع حساسة.
- CSP اعتمد على `unsafe-inline`.
- كان يمكن لمسار Renderer أن يطالب بهوية Developer/Owner دون إثبات Main قوي في بعض المسارات.
- IPC لم يكن deny-by-default بصورة شاملة.
- `database:persistKv` لم يطبق تصنيفًا صريحًا لكل domain/key.
- بعض cloud upload والقنوات الحساسة كانت أوسع من المطلوب.
- نوافذ الطباعة كانت أقل عزلاً.
- OAuth لم يكن يثبت state/replay بالعقد الحالي.
- كلمات المرور والجلسات والتخزين السري كانت أضعف أو موزعة.

### الحالي

- أضيف `renderer/security/safe-render.js` ومسار موحد للنصوص/DOM/sanitization.
- أزيل الاعتماد التشغيلي على `script-src 'unsafe-inline'` مع hashes محددة للثابت الضروري.
- Developer login الأصلي وكلمة مروره وواجهته بقوا كما هم وظيفيًا، لكن الربط بـ`__dev__` يحتاج proof قصير العمر، sender-bound، one-time صادر من Main.
- كل جلسة مستخدم حقيقية تحتاج إثبات مصادقة Main؛ claim مباشر للـOwner/Admin يُرفض.
- IPC unknown = DENY؛ القنوات الحساسة لها policy صريحة.
- KV مصنف، والمستخدم منخفض الصلاحية لا يستطيع كتابة users/settings/license.
- رفع activation إلى Drive محصور في path وبنية وترخيص متحقق منها.
- OAuth يستخدم state عشوائيًا one-time مع PKCE ومسار callback محدد.
- نوافذ preview/thermal/A4 تعمل sandboxed مع webSecurity وتنقية المستند.
- PBKDF2v2 بملح عشوائي وترقية lazy لكلمات المرور القديمة، مع throttling/lockout دائم عبر restart.
- tokens/provider credentials/communication queue تستخدم safeStorage/vault وتُحجب من النتائج العامة والنسخ.

### الدليل والحالة

- P0-A source/installed evidence السابق: XSS execution = 0، forged developer = denied، intentional developer login = pass، IPC coverage = 100% في ذلك البناء.
- `AUD-SEC-001..007`, `009..011`, `014..017`: مثبتة PASS في الأدلة التاريخية المحددة.
- `AUD-SEC-008`, `012`, `013`: منطقها واختباراتها موجودة، لكن بعض شروط Installed EXE البيئية المحددة ما زالت `UNVERIFIED`.

## 6. قاعدة البيانات والحفظ

### الأصل

- تشغيل مختلط بين SQLite وKV/localStorage.
- بعض الجداول/البيانات بلا `center_id/branch_id` إلزامي.
- replace-all قد يحذف سجلات فرع آخر عند حفظ subset.
- قيود uniqueness غير كافية للفواتير والمستخدمين والفترات.
- نجاح الواجهة لا يضمن أن commit/outbox نجحا.

### الحالي

- catalog واحد يصنف الكيانات ونطاقها.
- schema ownership وقيود center/branch وفهارس scoped.
- write context يصدر من Main وليس `options.source` القادم من Renderer.
- scoped replacement يحذف داخل النطاق فقط وينتج tombstone/outbox.
- rollback متكامل إذا قفل SQLite أو فشل جزء من الأمر.
- operational KV shadows لا تستخدم كمصدر تشغيل بعد hydrate/migration.
- إعداد Owner/device/branch أصبح typed SQLite + outbox بدل نجاح KV-only مضلل.
- آخر دليل installed clean-runtime سجل SQLite schema 9 و`integrity_check=ok`؛ ملفات migration المسجلة في المصدر ستة.

### ما لم يتغير بالكامل

- توجد localStorage/UI flags وحواجز توافق قديمة، لكنها ليست المصدر التشغيلي المقصود.
- حجم `electron/database/service.js` أصبح كبيرًا ويحتاج تقسيمًا لاحقًا بعد استقرار العقود، لا rewrite الآن.

## 7. الفروع وOwner Mode

### الأصل

- مفاهيم deviceBound/reporting/write موجودة جزئيًا، لكن فرضها كان يعتمد بدرجة أكبر على Renderer أو بيانات غير branch-owned.
- بعض payroll/invoice/attendance/commission/inventory/cash records كانت global أو KV.
- `database:syncOp` وtrusted source labels قد يفتحان bypass.
- Owner aggregate كان يمكن أن يتحول إلى write context غير واضح.

### الحالي

- كل كيان branch-owned يُختم ويُتحقق من center/branch في Main/DB.
- Owner aggregate read-only؛ الكتابة تحتاج فرعًا واحدًا صريحًا.
- إضافة أول فرع محصورة في wizard، وإضافة الفروع الأخرى في Owner Hub مع capacity/revision/pending/idempotency.
- cross-branch sync/write يرفض حتى إذا ادعى Renderer مصدرًا موثوقًا.
- replace في Branch A لا يمس Branch B.
- إعداد Device B يحتفظ بهوية الجهاز الجديد ولا يرث UUID/locked branch من جهاز النسخة.

### الحالة

- P0-B له بناء تاريخي مثبت: 109/109 واختبار installed 7/7 وGate PASS.
- اختبارات المصدر الحالية لعزل الفروع/outbox/conflict تمر.
- رحلة Device A/B حقيقية كاملة على جهازين وبناء الاستعادة الحالي ما زالت `UNVERIFIED`.

## 8. المزامنة

### الأصل

- full-table JSON/LWW ومسارات versions عامة.
- outbox يمكن أن يعيد قراءة الحالة الحالية بدل payload الحدث الأصلي.
- عدم وجود عقد مكتمل لـoperation ID/revisions/tombstones/CAS.
- legacy writer وCloud V2 كانا قابلين للتداخل.
- polling ثابت وعدواني نسبيًا.

### الحالي

- per-record operations بهوية immutable.
- operation ID وentity/center/branch/baseRevision/newRevision/device/time.
- outbox يحتفظ بالـpayload الحقيقي ويعيده idempotently.
- tombstones للحذف بدل الاستنتاج من غياب السجل.
- conditional revision/CAS-equivalent وتسجيل conflict بدل overwrite صامت.
- data/version publication قابلة للاستكمال بعد failure/restart.
- conflict policy حسب نوع الكيان، بما في ذلك credential fields.
- production writer الطبيعي واحد، وBackup/legacy paths ليست بديل sync.
- retry/backoff/jitter وتصنيف أخطاء الشبكة/429/5xx محسّن.

### الحالة

- P0-D focused source: 9/9 PASS، واختبارات outbox dual-device/conflict/large queue الحالية تمر.
- انقطاع حقيقي بين remote success وlocal acknowledgement، وجهازان حقيقيان متزامنان على البناء الحالي: `UNVERIFIED`.

## 9. النسخ الاحتياطي

### الأصل

- ثلاث قصص مربكة: Backup V1/LevelDB، Backup V2/SQLite، وCloud V2 daily JSON.
- Backup V1 ظل ظاهرًا وقابلًا للاستخدام رغم أن SQLite هي المصدر المقصود.
- كلمة مرور Backup V2 الافتراضية مشتقة بصورة متوقعة من center ID.
- UI والسcheduler والاحتفاظ cloud/local لم تكن قصة واحدة صادقة.

### الحالي

- Backup V1 معطل في Main ومخفي من مسار التشغيل العادي؛ يوجد `electron/backup-v1-gate.js`.
- Backup V2 هو مسار DR الكامل؛ Sync operation log ليس نسخة DR.
- سر Backup V2 عشوائي ومحمي بـOS safeStorage في Main، مع legacy-read path للنسخ القديمة.
- restore لا يستبدل القاعدة قبل decrypt/checksum/SQLite integrity/staging.
- خطأ Promise غير القابل للclone أُصلح في كل callers.
- قائمة الإعداد تعرض حتى عشر نقاط استعادة بدل ملف واحد.

### المتبقي

- retention/prune موحد للسحابة والمحلي: مفتوح `AUD-BKP-003`.
- resumable transfers للملفات الكبيرة والانقطاع: مفتوح `AUD-BKP-004`.
- توضيح organization-wide مقابل branch-scoped: مفتوح `AUD-BKP-005`.
- disclosure كامل للمحتوى المستبعد: مفتوح `AUD-BKP-006`.
- تنظيم صفحة Backup إلى أقسام مستقلة موحدة بالكامل: `AUD-UI-002` لم يُغلق نهائيًا، رغم تعطيل V1 وإضافة restore-point selection.

## 10. الاستعادة

### الأصل

- صفوف bootstrap البسيطة قد تجعل الهدف يبدو non-empty وتمنع restore.
- discovery قد يحتاج centerId قبل أن تستعيده أصلًا.
- scan قد يكون جزئيًا أو يتوقف مبكرًا.
- pause/resume للمزامنة يمكن أن يفشل بصمت.
- checkpoint قد يبدو في UI مثل full verified restore.
- BootFlow قد يتجاهل `{ok:false}` downstream.
- Renderer/lexical state يمكن ألا يستقبل بيانات SQLite المستعادة بصورة صحيحة.
- أحدث ملف كان يُختار تلقائيًا حتى إذا كان sparse.
- legacy restore كان يمكن أن يعمل in-place بصورة غير ذرية.

### الحالي

- discovery كامل مع pagination، bounded retry، partial/truncated truthfulness.
- لا يحتاج centerId محليًا لمجرد enumeration؛ الهوية تُتحقق قبل الاستعادة.
- sync stop/resume failures أصبحت observable ولا تعطي نجاحًا كاذبًا.
- checkpoint وBackup V2 لهما مراحل ومسميات مختلفة.
- setup-only classifier يفهم settings/device registry/bootstrap commands.
- Backup V2: download -> decrypt -> verify -> staged DB -> integrity -> controlled identity merge -> atomic swap.
- Legacy V3: decrypt -> staged migration -> verify -> atomic swap؛ wrong password لا يغير القاعدة.
- Device B يحتفظ بالترخيص الحالي وUUID والفرع والجهاز registry.
- إذا تعددت النسخ يجب على المستخدم اختيار النسخة؛ لا يختار أحدث sparse تلقائيًا.
- بعد full DB restore يتم operation pull فقط، ولا يعاد legacy full-config hydrate الذي سبب `configuration_pull_incomplete`.

### المشكلة الظاهرة `An object could not be cloned`

السبب كان `getBackupV2Password()` async بينما callers مرروا Promise عبر contextBridge. أضيف `await` في كل المسارات، وMain يستطيع استرجاع السر المحمي مباشرة أثناء setup. اختبارات V2 المحلية وDrive الحقيقي داخل profile معزول نجحت، لكن Exact rebuilt installed UI ما زال `UNVERIFIED`.

## 11. BootFlow والإعداد

### الأصل

- خطوات كثيرة ومسارات activation/recovery متكررة.
- readiness قد تعرض RUNNING أو success رغم failure لاحق.
- theme/startup كان يكتب settings قبل وجود session.
- Google state في Renderer قديم ويمكن أن يلغي token صالحًا أو يظهر `google_not_connected`.
- Owner credential existence كان يُخلط مع authorization session.
- completion marker يمكن أن يُكتب قبل اكتمال commit.

### الحالي

- startup theme read-only حتى يغيّره مستخدم مصادق.
- Google Main state هو المرجع في خطوة Google، وdisconnect يعيد wizard إلى الموضع الصحيح.
- كل نتيجة activation/restore/sync مطلوبة تُنتظر؛ الفشل يبقي `syncDone=false` ويمنع READY.
- Owner موجود مسبقًا يسجل الدخول بنفس كلمة المرور للحصول على Main proof/session؛ لا ينشأ Owner جديد ولا تعاد كلمة المرور الأولى.
- READY يكتب بعد durable completion فقط.
- Cloud V2 initialization awaits essential services ولا يعرض نجاحًا مع rejected Promise.
- activation publication لها owner واحد بدل ثلاثة uploads متعارضة.

### الشكل

لم يحدث redesign عام. بقيت اللغة البصرية، الأزرار الأساسية، وتسلسل wizard العام. التغييرات UI مرتبطة بالصدق، منع الحالات المستحيلة، تبديل Google account، اختيار restore point، ورسائل الخطأ.

## 12. الحسابات وكلمة مرور المالك وRBAC

### الأصل

- Owner password الأول يمكن أن يعود بعد restore/reinstall أو يفشل commit بصورة غير متزامنة.
- credentialRevision لم يكن دائمًا جزءًا ذريًا من publication/merge.
- Renderer كان يعيد فحص password hash رغم أن Main pre-auth يخفيه.
- sessions والroles تعتمد جزئيًا على claims في Renderer.

### الحالي

- users داخل SQLite/Main هي credential authority.
- تغيير كلمة مرور Owner ينتظر commit authoritative قبل النجاح أو revision/sync.
- credential hash/role/revision تُدمج بسياسة صريحة؛ seed قديم لا يغلب credential حقيقيًا.
- OwnerProfile compatibility مشتق ولا يملك كلمة مرور مستقلة.
- بعد restore تظهر كل الحسابات الموجودة فعلًا في النسخة، وتسجيل الدخول يتم في Main دون إرسال hashes للـRenderer.
- session لا تبقى بعد restart، لكنها تُعاد بمصادقة حقيقية؛ proofless bind مرفوض.
- Developer password flow محفوظ، لكن لا يمكن تزوير `__dev__`.

### حد البيانات

إذا كانت النسخة المختارة تحتوي Owner واحدًا فقط فلن يستطيع الكود إظهار موظفين غير موجودين داخلها. هذا ما ثبت في أحدث Backup V2 الحقيقي على Drive.

## 13. Google Drive وOAuth وSheets

### الأصل

- OAuth/token lifecycle ومسارات UI متعددة وغير متسقة.
- discovery يمكن أن يصف كل استثناء على أنه timeout أو unknown.
- state بين Main/Renderer يمكن أن يتباعد.
- license upload/download وactivation/local commit قد تحدث بترتيب ينتج half-success.
- generator كان يجهز Sheets rows؛ لم يكن auto-append مثبتًا.

### الحالي

- OAuth state + PKCE + callback binding + replay denial.
- refresh token في safeStorage دون deterministic fallback.
- reconnect/disconnect وتبديل الحساب في setup أصبحا مسارين مقصودين.
- Drive discovery paginated وبمهلات أطول ونتائج root-cause أفضل.
- license candidate يعاد تنزيله والتحقق منه قبل SQLite activation.
- cloud-required activation ينشر أولًا بصورة idempotent ثم يثبت local consumption؛ failure لا يترك consumed state كاذبًا.
- duplicate post-gate license uploads أزيلت.
- Sheets يستخدم Main proxy محدودًا بأربع actions وURL/payload/timeout bounds.
- السلوك الأصلي المقصود بقي: المولد يحضر 6 أعمدة activation وعمودين bundle للنسخ إلى Sheets. لم تتم إضافة auto-append جديدة غير مثبتة.

### الإثبات الحالي

- Drive read-only الحقيقي نجح في الاتصال والجرد والتنزيل والتحقق.
- أحدث inventory في تشخيص حادث الاستعادة وجد 51 عنصرًا و10 ملفات `.tdw` وملفي license ومحتوى config تاريخيًا محدودًا.
- real mutation على Sheets/Drive من البناء المصدر الحالي لم يُنفذ، لذلك end-to-end remote = `UNVERIFIED`.

## 14. الترخيص

### الأصل

- V5 PBKDF2/HMAC داخل Renderer/customer source.
- builder ومسارات registry mutation داخل التطبيق.
- تاريخ V5 المضغوط 13-bit قد يلف تواريخ lifetime/far-future.
- double-click يمكن أن يصدر ترخيصين.
- generator يستخدم APIs ذات side effects قد تستبدل ترخيص/center محطة المطور.
- registry bytes يمكن أن تفسد إذا كتب test/tool إلى bundled root.

### الإصلاحات الحالية مع الحفاظ على V5

- Developer proof/Main authorization مطلوبان لكل issuance write.
- التخزين في `%APPDATA%/.../LicenseAdmin` وليس source/app.asar.
- mutation تفشل إذا لم يضبط Main writable root.
- in-flight lock يمنع إصدار ترخيصين من نقرة مزدوجة.
- UI يسمي المفتاح V5 بصورة صحيحة.
- generation أصبح pure بالنسبة لترخيص/center الجهاز المُصدر؛ لا يفعّل ترخيص العميل على محطة المطور.
- تاريخ lifetime/far-future يعتمد bundle authority مع sentinel/compatibility مناسب.
- 7 packages × 7 lifecycle actions × 9 durations = 441 combinations PASS.
- production package يستبعد `license/data` fixtures.
- V6 Ed25519 verification compatibility path بقي موجودًا.

### الفرق الأمني غير المحلول

وظيفيًا المولد الحالي أكثر سلامة من الأصلي ويعمل كما طُلب. أمنيًا يبقى نفس العيب الأساسي: `LIC_SECRETS` وقدرة HMAC موجودان داخل تطبيق العميل ويمكن استخراجهما من ASAR. حماية واجهة Developer لا تمنع شخصًا يملك ملفات البرنامج من استخراج السر.

- `AUD-LIC-002` Critical: `FAIL`.
- `AUD-LIC-004` High: `FAIL`.
- الحل التجاري الحقيقي الوحيد: فصل issuer في أداة داخلية/خدمة لا تُوزع للعملاء، أو العودة إلى V6 private-key issuer خارجي. إخفاء الزر أو الاحتفاظ بكلمة مرور Developer وحدهما ليسا حلًا تشفيريًا.

## 15. النظام المالي والفواتير والرواتب

### الأصل

- حفظ case/invoice/payment/inventory/cash/audit/ledger كان سلسلة writes قابلة للتجزؤ.
- invoice number counter في الذاكرة وغير فريد DB-scoped.
- payment components/rounding ليست كلها تحت invariant واحد.
- حذف مالي/عميل يمكن أن يكون destructive.
- payroll وEmployeeLedger حقيقتان منفصلتان.

### الحالي

- migration مالية وcommands ذرية تربط المصدر بالحركات وoutbox.
- DB-backed invoice sequence مع uniqueness scoped.
- payment reconciliation وrounding rules.
- reversal/void append-only بدل تغيير/حذف التاريخ المالي المقفل.
- payroll finalization immutable وتصحيحه adjustment صريح.
- branch ownership للحركات والرواتب والدفتر.

### الحالة

- اختبارات P0-E المالية المركزة 7/7، payroll/report scope/runtime license immutability تمر في المصدر.
- Device A/B concurrent invoice على جهازين حقيقيين، وأجهزة دفع/إغلاق مالي فعلي على EXE الحالي: `UNVERIFIED`.

## 16. التقارير والطباعة وPDF

### الأصل

- بعض doctor/VAT/payroll reports تقرأ arrays عامة بدل BranchContext.
- preview وprint قد يستخدمان سنة أو deductions مختلفة.
- HTML print يمكن أن ينفذ payload مخزنًا.

### الحالي

- report query يحتاج branch context صريح؛ Owner aggregate مميز.
- preview/print/PDF تعتمد report document/calculation مشتركًا في المسارات المعالجة.
- sanitization قبل preview/thermal/A4 وsandbox/webSecurity.
- اختبارات hostile payload للطباعة = zero execution في أدلة P0-A السابقة.

### المتبقي

- hardware thermal/A4 الفعلي، تعريفات متعددة، scaling، وPDF Save-As matrix على EXE الحالي ليست كاملة.

## 17. Owner Hub

### الأصل

- Hub حقيقي وليس mock، لكنه kitchen sink: فروع، أجهزة، approvals، license، Google، migration، diagnostics، actions حساسة في مساحة واحدة.
- بعض الخلايا/actions كانت تعتمد rendering غير آمن، وروابط/تكرار مع CenterSetup موجودة.

### الحالي

- خلايا ديناميكية تمر بمسار safe rendering في المسارات المعالجة.
- dialogs المخصصة حلت محل `prompt()` المباشر.
- overview/branches/devices/advanced موجودة، وتمت إزالة بعض تكرارات CenterSetup وربط Branch Mode/Owner Mode.
- إضافة/حذف/إعادة تسمية/اعتماد جهاز مرتبطة بخدمات حقيقية وMain authorization.

### ما لم يكتمل

- الطلب النهائي بأن يكون **كل جدول domain مستقلًا وواضحًا بالكامل** لم يُغلق كـRequirement.
- `AUD-UI-001` ما زال `FAIL` في baseline الرسمي.
- لم يتم redesign كامل لأن P0 لم يحقق Gate التجاري، ولأن التعليمات منعت UX polish قبل Critical closure.

## 18. صفحة النسخ الاحتياطي

### الأصل

- V1 وV2 وأزرار/مفاهيم cloud متنافسة.
- history لا يجمع local/cloud بصورة كاملة.
- schedule/default copy يمكن أن تختلف عن scheduler.

### الحالي

- V1 disabled/hidden من المسار الطبيعي.
- V2 هو النسخ/الاستعادة الكاملة.
- restore points متعددة أصبحت واضحة أثناء الإعداد.
- sync/checkpoint/full backup لا تُعرض بنفس الادعاءات.

### ما لم يكتمل

- فصل Sync / Backup / Restore / Schedule / Security / Unified History بصورة نهائية مستقلة وسهلة التحكم لم يُعتمد بعد.
- `AUD-UI-002` و`AUD-BKP-002..006` لم تُغلق نهائيًا.

## 19. العملاء والموظفون والمرفقات

### ما بقي كما هو

- CRUD للعملاء والموظفين والحالات والحجوزات والحضور والرواتب والبحث بقي بنفس شكل UI ووظائفه الأساسية.
- لم تتم إضافة feature جديدة لدمج العملاء لأن التدقيق لم يثبت وجود implementation حقيقي سابق، والتعليمات منعت features الجديدة.

### ما تغير أسفل الواجهة

- writes تشغيلية تمر عبر SQLite/branch/outbox.
- كلمات مرور المستخدمين لا تُعرض للـRenderer.
- employee/payroll/attendance records أصبحت branch-aware في البنية الجديدة.
- `attachment-lifecycle.js` و`attachments-ipc.js` أضيفا، مع hash/metadata/authorization foundations.

### المتبقي

- attachment lifecycle كامل على Device A/B وDrive لم يثبت؛ `AUD-CUS-001` مفتوح.
- UI أو claim لدمج العملاء يحتاج إزالة صادقة أو feature منفصلة مرخصة؛ `AUD-CUS-002` مفتوح.

## 20. الإعدادات وميزات تبدو موجودة لكنها غير مكتملة

### ما أزيل/عُطل

- `electron/cloud-providers/stub-providers.js` حُذف.
- Backup V1 runtime عُطل.
- legacy CenterSetup auto-open أصبح no-op في المسار المقصود.
- test license data لا يدخل customer package.
- development private key الموجود تحت tools في الأصل غير موجود في الحالي.

### ما زال يحتاج تنظيفًا

- Provider panel لا يزال يذكر OneDrive/Dropbox/AWS/Azure/Nextcloud كـ«قريبًا»؛ ليست integrations عاملة.
- توجد UI options تاريخية لـCOM/USB drawer، بينما الكود نفسه يقرر أن direct COM/USB غير مطبق.
- Developer database-integrity tool يحتاج إثبات أنه يشغل SQLite checks فعلًا أو إعادة تسمية/إزالة.
- بعض visual-only/no-op surfaces وlegacy labels باقية.

لذلك `AUD-FAKE-001..004` ليست كلها مغلقة، رغم حذف stub provider الفعلي وتعطيل بعض المسارات.

## 21. Installer والبناء

### الأصل

- NSIS يحافظ على userData افتراضيًا ويتيح full wipe صريحًا؛ هذا كان من نقاط القوة.
- recovery archive في clean-start كان يمكن أن يحذف Local Storage/IndexedDB/Session Storage/CloudVault من الأرشيف.

### الحالي

- clean-start archive المستقبلي يحتفظ بالprofile byte-for-byte بدل stripping قد يخسر recovery data.
- branding assets للـinstaller أضيفت.
- customer package يستبعد test license data وdev/private artifacts المحددة.
- بنيت وثُبتت artifacts تاريخية متعددة، وآخر Final Clean EXE كان SHA `37F3FDE0...` واختباراته المحلية المثبتة نجحت.

### الحد الحالي

- ZIP الحالي أحدث من آخر EXE ويتضمن إصلاحات restore/login/license جديدة؛ لذلك لا يجوز استخدام EXE القديم كدليل لهذه البايتات.
- Authenticode = NotSigned/Not configured.
- actual destructive fresh-start archive recovery على profile مستخدم حقيقي لم يُنفذ حفاظًا على البيانات.

## 22. الأداء وقابلية الصيانة

### الأصل

- `index.html` ضخم، تحميل scripts كثير، full-array rendering، وثائق مراحل كثيرة.
- لم توجد budgets مثبتة لـstartup/memory/render/large dataset.

### الحالي

- مزامنة record-based تقلل full-table downloads/writes.
- SQLite indexes/ownership تحسن الاستعلام والعزل.
- bounded retry/pagination يقللان loops غير المنضبطة.
- توجد scale fixtures واختبارات queue/dataset أفضل.

### ما لم يتحسن بما يكفي

- `index.html` ازداد من 26,840 إلى 28,147 سطرًا.
- Main وdatabase service كبرا كثيرًا.
- لا يوجد قياس نهائي موثق للذاكرة/startup/render على بيانات عميل كبيرة.
- وثائق المشروع ازدادت من 593 إلى 842 ملفًا.
- `AUD-PERF-001`, `AUD-QLT-001`, `AUD-QLT-002` تظل أعمالًا مفتوحة/جزئية.

## 23. الاختبارات: الفرق بين النجاح الورقي والنجاح التشغيلي

### الأصل

- التقرير الأصلي سجل 97/97، لكن معظمها wiring/static/sandbox.
- 0/40 من متطلبات Windows runtime كانت PASS.
- Google OAuth الحقيقي، Device A/B، DR، responsive matrix وruntime errors كانت `UNVERIFIED`.

### مراحل الإصلاح

- P0-A: اختبارات security وinstalled evidence مفصلة.
- P0-B: 109/109، build/install و7/7 runtime.
- P0-A-E source checkpoint: 122/122.
- installed checkpoint: 124/124 مع security/branch runtime.
- Legacy V5 final: 126/128؛ الفشلان هما security gates الرافضة لسر V5.
- Final Clean Runtime: lifecycle 28/28، security 41/41، SQLite/branch 7/7، full 127/129؛ الفشلان نفسهما.

### الحالة المصدرية الحالية

- `npm run lint`: PASS.
- 13 مجموعة مركزة للحادث الحالي: PASS.
- `npm test`: 126/132.

الحالات الست الحالية:

1. `p0-e:licensing-production`: فشل صحيح بسبب V5 signing material.
2. `license:test`: فشل صحيح للأسباب الأمنية نفسها.
3. `v2-5.7:production-release`: gate تاريخي مرتبط lifecycle/artifact سابق.
4. `v2-5.7:scenarios`: سيناريو واحد من ثمانية يفشل تبعًا للبوابة السابقة.
5. `v2-5.7:windows-uat-runtime`: يشير إلى EXE قديم في `dist` وليس build حاليًا.
6. `v2-3.5:verify-uninstall-prep`: وجد profile المستخدم الحقيقي؛ لم يُحذف لأن الاختبار destructive خارج sandbox.

هذه النتيجة أفضل بكثير من 97 source-only، لكنها ليست 100% ولا تبرر إعلان Production.

## 24. المشاكل التي ظهرت أثناء الإصلاح وتم حلها

إضافة إلى findings الأصلية، كُشفت وأصلحت مشكلات لم تكن ظاهرة في أول audit:

- startup theme يكتب قبل session (`AUD-BOOT-006`).
- entitlement check للمطور يستخدم literal خاطئ (`AUD-SEC-017`).
- clean-start archive strips recovery stores (`AUD-DAT-005`، التنفيذ المستقبلي أصلح؛ الاستعادة التاريخية غير قابلة للإرجاع).
- Owner موجود لكن initial sync بلا Main session (`AUD-BOOT-007`).
- setup ينجح مع device/Owner في KV فقط (`AUD-DAT-006`).
- registry signature drift (`AUD-LIC-006`).
- failed activation يظهر success بسبب stale valid license (`AUD-LIC-007`).
- false timeout/swallowed async failures (`AUD-QLT-003`).
- double V5 issuance/mislabel (`AUD-LIC-008`).
- generator يغير ترخيص/center محطة المطور (`AUD-LIC-009`).
- unsafe monthly template delete expression (`AUD-UI-003`).
- tests corrupt bundled registries (`AUD-QLT-004`).
- activation consumed locally قبل required cloud upload (`AUD-LIC-010`).
- READY marker قبل durable completion (`AUD-BOOT-008`).
- Cloud V2 init success مع unhandled rejection (`AUD-QLT-005`).
- Drive license pull success رغم فشل SQLite commit (`AUD-LIC-011`).
- activation تنشر license ثلاث مرات (`AUD-LIC-012`).
- packaged test licenses readable pre-auth (`AUD-LIC-013`).
- V5 far-future date wrap (`AUD-LIC-005`).
- Backup V2 Promise clone failure (`AUD-RST-007`).
- newest sparse backup يخفي الأقدم (`AUD-RST-008`).
- legacy restore غير ذري ومتعارض مع gate (`AUD-RST-009`).
- setup rows/Device B identity تمنع أو تفسد restore (`AUD-RST-010`).
- Renderer يرفض كلمات مرور صحيحة بلا hash (`AUD-AUTH-006`).
- الترخيص في SQLite يُتجاهل بعد restart (`AUD-LIC-014`).
- full DB restore يتبعه legacy config pull غير لازم (`AUD-BOOT-009`).

## 25. حقيقة بيانات Drive الحالية

التشخيص الحقيقي read-only أثبت:

- Google متصل في جلسة التشخيص، وrefresh credential موجود.
- Drive inventory قابل للقراءة والتنزيل.
- أحدث Backup V2 حجمه نحو 44,998 bytes، SQLite سليمة، لكنه يحتوي مستخدمًا واحدًا Owner ولا يحتوي clients/employees/visits/business rows.
- النسخ الأقدم الأكبر نحو 1.72 MB هي legacy V3 JSON مشفرة.
- استعادة V3 مدعومة الآن، لكن تحتاج كلمة مرور النسخة التاريخية الصحيحة.

الفرق المهم:

- **مشكلة الكود الأصلية:** كان يختار أحدث sparse file ولا يعرض الأقدم؛ تم إصلاحها.
- **مشكلة البيانات الحالية:** الملف الأحدث نفسه لا يحتوي البيانات المطلوبة؛ لا يستطيع أي إصلاح خلق بيانات غير موجودة.
- الإجراء الصحيح: عدم حذف النسخ القديمة، اختيار نسخة 1.72 MB يدويًا، إدخال كلمة مرورها، ثم مقارنة counts/users/license بعد restore/restart.

## 26. ما تم الحفاظ عليه عمدًا من البرنامج الأصلي

- نفس الاسم والإصدار العام `2.0.1`.
- نفس شكل UI والهوية العربية العامة؛ لا redesign شامل.
- نفس Developer login المقصود وكلمة مروره وواجهة استخدامه.
- نفس قدرة إصدار V5 وأنواع packages/actions/durations المقصودة.
- نفس workflow تجهيز صفوف Sheets يدويًا، دون ادعاء auto-append غير موجود.
- نفس وظائف العيادة الأساسية: العملاء، الحالات، الحجوزات، الفواتير، المصروفات، الموظفون، الحضور، التقارير والطباعة.
- حفظ بيانات المستخدم افتراضيًا عند uninstall.
- V6 compatibility path لم يُحذف، لكنه ليس generator التفاعلي الافتراضي.

## 27. ما حُذف أو عُطل مقارنة بالأصل

- `electron/cloud-providers/stub-providers.js`.
- development Ed25519 private key داخل source tools.
- Backup V1 كمسار تشغيل/DR متاح للمستخدم.
- direct/proofless developer/session binding.
- unknown/default-allow IPC behavior.
- raw operational KV writes.
- normal full-table production sync writer.
- duplicate activation license publications.
- generator activation-side effects على محطة المطور.
- customer packaging لـ`license/data` fixtures.
- insecure deterministic OAuth token fallback.
- predictable default Backup V2 secret للنسخ الجديدة.

## 28. ما أضيف مقارنة بالأصل

- SafeRender/sanitization/security policy infrastructure.
- Main password auth, throttling, secure credential vault وprint sanitizer.
- entity catalog وP0-B/P0-D/P0-E migrations.
- cloud data discovery وrestore reconciliation وbranch contexts.
- Backup V1 gate وsetup activation transaction وlicense verifier/entitlements/vault proxy.
- per-record operation transport والتعارضات/tombstones/revisions.
- atomic financial commands/reversals.
- setup state service وtyped Owner/device projections.
- restore-point selection وlegacy staged migration وDevice B identity merge.
- اختبارات baseline/runtime/failure/restart كثيرة وأدلة SHA/build تاريخية.

## 29. مصفوفة الحالة الحالية حسب المرحلة

| المرحلة | ما تم | ما بقي | الحكم |
|---|---|---|---|
| P0-A Security | XSS/IPC/RBAC/dev proof/KV/print/OAuth/token/secret hardening | بعض Installed environment evidence لـOAuth/session/token unavailable | Functional strong؛ Gate الرسمي جزئيًا UNVERIFIED |
| P0-B SoT/Branches | SQLite authority، typed writes، schema scope، branch isolation، migration | current-build A/B cloud UAT | أقوى مرحلة؛ لها installed PASS تاريخي |
| P0-C Setup/Restore/Owner | discovery، restore gates، Owner credential، current incident fixes | exact current EXE + historical V3 password restore | Source/runtime isolated PASS؛ Installed current UNVERIFIED |
| P0-D Sync | op protocol، outbox payload، revisions، tombstones، conflict policy | real two-device/provider failure matrix | Source PASS؛ remote installed UNVERIFIED |
| P0-E Finance/License/Backup secret | atomic finance، reports، secure backup secret، V5 functional fixes | V5 embedded secret، real financial/device UAT | Commercial FAIL بسبب AUD-LIC-002 |
| P1/P2 | V1 disabled، Hub split جزئي، dialogs/modal/cleanup جزئي | UI-001/002، retention/resume، fake surfaces، perf، maintainability | غير مكتملة رسميًا |

## 30. المقارنة النهائية في نقاط مباشرة

| السؤال | الأصل | الحالي |
|---|---|---|
| هل البيانات التشغيلية لها مصدر واحد؟ | لا بصورة مضمونة | نعم في المسار المقصود: SQLite، مع بقايا توافق غير authoritative |
| هل الفرع مفروض في DB/Main؟ | جزئي | نعم للكيانات المصنفة، مع اختبارات عزل |
| هل restore ذري؟ | غير موثوق في كل المسارات | V2 وlegacy staging/verify/swap في الكود الحالي |
| هل أحدث backup دائمًا الصحيح؟ | كان يُفترض نعم | لا؛ المستخدم يختار من نقاط الاستعادة |
| هل كلمة مرور Owner تبقى؟ | معرضة للرفض/seed recurrence | Main authority وrevision/no-recreation |
| هل الترخيص يبقى بعد restart؟ | قد يظهر غير مفعل رغم وجوده | SQLite-first license load |
| هل sync full-table LWW؟ | نعم في baseline | per-record operations في المسار الجديد |
| هل forged Developer ممكن؟ | كان هناك مسار ثقة خطير | denied دون Main proof؛ login المقصود محفوظ |
| هل XSS/print payload ممكن؟ | مسارات مثبتة خطرة | SafeRender/CSP/sandbox، execution 0 في الأدلة السابقة |
| هل Backup V1 متاح؟ | نعم | disabled/hidden |
| هل مولد V5 يعمل؟ | نعم، مع عيوب تشغيلية وأمنية | نعم، أكثر سلامة تشغيليًا؛ نفس عيب السر الموزع أمنيًا |
| هل Google/Drive مضمون نهائيًا؟ | غير مثبت | read-only/download/isolated restore مثبتة؛ full current EXE remote journey غير مثبتة |
| هل UI تغير شكله؟ | baseline | الشكل العام محفوظ؛ تنظيمات/رسائل وحواجز جزئية فقط |
| هل Owner Hub منظم نهائيًا؟ | لا | تحسن جزئي، Requirement النهائي ما زال مفتوحًا |
| هل Backup page منظمة نهائيًا؟ | لا | V1/restore truth تحسنا؛ الفصل الكامل/history ما زال مفتوحًا |
| هل المنتج Production Ready؟ | NO | NO تحت الـBaseline الإلزامي |

## 31. الحكم الهندسي النهائي

مقارنة بالنسخة الأصلية، النسخة الحالية أقوى بوضوح في أمان Renderer/Main، سلامة SQLite، عزل الفروع، ذرية الحفظ، استعادة V2/legacy، حماية Owner credential، صدق BootFlow، وبروتوكول sync. كما أن الأعطال الفعلية التي أبلغ عنها المستخدم — clone error، رفض كلمة المرور، اختفاء الترخيص، configuration pull، sparse newest backup — أصبحت لها أسباب مثبتة وإصلاحات واختبارات مباشرة.

لكن هناك فرق بين **نسخة أصلح وظيفيًا بكثير** وبين **نسخة معتمدة تجاريًا**. الاعتماد التجاري ما زال ممنوعًا لأن:

1. سر توقيع V5 موزع مع العميل بقرار صريح.
2. آخر source ZIP لم يتحول إلى EXE مطابق ويُختبر end-to-end بعد آخر إصلاحات restore.
3. رحلات Google/Sheets/Drive/Device A-B الحقيقية غير مكتملة.
4. Authenticode غير موجود.
5. P1/P2، بما فيها التنظيم النهائي لـOwner Hub وBackup، لم تُغلق رسميًا.

التوصية إلى Cursor: اعتبر هذه النسخة قاعدة العمل الوحيدة، لا تعيد إدخال أي مسار localStorage/full-table/Backup V1 قديم، ولا تغيّر expected tests لتخفي V5 security failure. ابدأ بإنتاج EXE من هذه البايتات، ثم نفّذ UAT المذكور في تقرير التسليم، وبعدها افصل V5 issuer عن customer runtime إذا كان الهدف إصدارًا تجاريًا حقيقيًا.

## 32. الملفات الواجب إرسالها إلى Cursor

- `artifacts/Hijama-Clinic-FINAL-RESTORE-20260813-CURSOR-HANDOFF.zip`
- `artifacts/Hijama-Clinic-FINAL-RESTORE-20260813-CURSOR-HANDOFF.zip.sha256`
- `docs/remediation/ORIGINAL-TO-CURRENT-COMPLETE-COMPARISON-20260813.md`
- `docs/remediation/FINAL-RESTORE-HANDOFF-20260813.md`
- `docs/remediation/FINAL-RESTORE-HANDOFF-MANIFEST.json`
- `docs/remediation/AUDIT-TRACEABILITY.md`
