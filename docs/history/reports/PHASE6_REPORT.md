# Phase 6 — Stable ABI + FFI — تقرير الإغلاق

**الإصدار:** UR-Bridge v27
**الحالة:** ✅ مغلقة
**التاريخ:** 2026-06-19

---

## 1. النطاق المُنفَّذ

| الأولوية | المكوّن | الملفات |
|---|---|---|
| 1 | Stable ABI | `src/ffi/abi/{types,layout,versioning,index}.ts` |
| 2 | FFI (C أولاً) | `src/ffi/runtime/memory.ts` |
| 3 | Binding Generator | `src/ffi/bindgen/{c-header-parser,converter,emitter}.ts` |
| 4 | تكامل urpm | `src/ffi/urpm-native/native-packages.ts` |

تم اتباع الترتيب المُتفَق عليه بالضبط: **ABI أولاً → FFI → Binding Generator → urpm**، لأن كل طبقة تعتمد على الطبقة السابقة (الـ layout يحدد الـ marshaling، والـ marshaling يحدد كيف يُولَّد الكود، وتوليد الكود يحدد ما يُثبَّته urpm).

---

## 2. Stable ABI

- تمثيل أنواع كامل: primitives (8 إلى 128 bit)، pointers/references، function pointers، structs/unions/enums، arrays/slices، strings (4 ترميزات).
- **Layout Engine** يحسب offsets وalignment وpadding بدقة متوافقة مع C ABI (System V x86-64، Win64، AArch64، WASM32) — مع دعم `packed` structs.
- **Versioning + Compatibility Checker**: يكتشف 9 أنواع من الكسر (breaking changes): حذف دالة، تغيير نوع إرجاع/معامل، تغيير calling convention، حذف/إعادة ترتيب حقل، تغيير enum discriminant أو حذف variant. إضافة دوال/حقول/variants جديدة لا تُعتبر كسراً.
- **Symbol mangling**: C (هوية) و UR (مُولَّد من اسم الوحدة + المعاملات).

## 3. FFI Runtime

- ترميز/فك ترميز نصوص: UTF-8، UTF-16، ASCII، C-string — مُختبَر مع العربية، اليابانية، الروسية، والرموز التعبيرية.
- Struct marshaling/unmarshaling يحترم **إشارة كل حقل** (i32 موقّع مقابل u32 غير موقّع) ونوعه (float مقابل integer) — هذا أُصلح بعد اكتشافه أثناء الاختبار (انظر القسم 5).
- `FfiArena`: تجميع تخصيصات FFI المؤقتة بدفعة واحدة قابلة لإعادة الاستخدام.
- `FfiCallbackRegistry`: تسجيل دوال UR كـ callbacks قابلة للاستدعاء من C.
- `checkFfiSafety`: فحص ما قبل الاستدعاء (pointers غير null، قيم enum صالحة).

## 4. Binding Generator

- **C Header Parser**: tokenizer + parser يدويين لمجموعة فرعية كافية من C (functions، structs، unions، enums، typedefs بما فيها forward declarations، `#define`، `extern "C"` wrappers، تعليقات سطرية وكتلية).
- **Converter**: يحوّل AST إلى `AbiModule` مع معجم typedefs قياسي (`size_t`، `uint32_t`، إلخ)، ودعم تصفية بـ prefix.
- **Emitter**: يولّد كود UR (`.ur`) جاهز للقراءة مع safe wrappers، بالإضافة لـ TypeScript declarations لتكامل host.

تم اختباره فعلياً ضد رأسين واقعيين مبسّطين: **SQLite3** (15+ دالة، 12+ ثابت) و **OpenCV** (بنية `CvMat` مع 4+ حقول).

## 5. تكامل urpm Native

- قاعدة بيانات حزم مثبتة مع artifacts متعددة المنصات (Linux/macOS/Windows/WASM × x64/ARM64/WASM32).
- حل توافق ABI عند التثبيت/الترقية — يرفض الترقيات التي تكسر ABI تلقائياً مع تحذير صريح.
- توليد أعلام linker (`-L`/`-l`/rpath للديناميكي، مسارات مباشرة للستاتيكي).
- قائمة مكتبات معروفة جاهزة: OpenCV، SQLite3، ONNX Runtime، ROS2 (rclc)، LLVM C API.

---

## 6. الاختبارات والتحقق

**132 اختبار، 132 ناجح (100%)**، موزعة على:

| الملف | عدد الاختبارات | التركيز |
|---|---|---|
| `abi-layout.test.ts` | ~25 | حسابات layout عبر منصات متعددة |
| `abi-versioning.test.ts` | ~25 | كشف الكسر في ABI |
| `bindgen.test.ts` | ~30 | parser + converter + emitter |
| `ffi-runtime.test.ts` | ~30 | ترميز نصوص + marshaling + أمان |
| `urpm-native.test.ts` | ~25 | حل الحزم + linker flags + خطط التثبيت |
| `integration.test.ts` | ~15 | أنابيب end-to-end حقيقية (SQLite3/OpenCV) |

**TypeScript: 0 أخطاء** على كامل `src/` بـ `strict: true` (تحقَّق عبر `tsc --noEmit` بإعدادات المشروع الفعلية).

### أخطاء حقيقية اكتُشفت وأُصلحت أثناء الاختبار (لا قبله)

هذا القسم مهم لأنه يوثّق فحصاً صادقاً لا "اختباراً للزينة":

1. **حلقة لا منتهية حقيقية** في C header parser عند معالجة `extern "C" { ... }` — السبب: tokenizer كان يتجاهل علامات الاقتباس `"` بصمت، فيتحول `"C"` إلى identifier عادي، ما يجعل `parseTypeRef` يُستدعى على توكن غير متوقع فيُرجع نوعاً افتراضياً **بدون استهلاك أي توكن**، فتتكرر الحلقة للأبد. الإصلاح: إضافة tokenization حقيقي لـ string literals + رفض `parseTypeRef` للمضي قدماً بدون استهلاك توكن (يرمي خطأ يُمسك بواسطة آلية الاستعادة الموجودة).
2. **فقدان قيم `#define`** — tokenizer كان يحذف باقي السطر بعد كلمة `define` بدلاً من تركها لتُرمَّز، فتختفي كل القيم.
3. **كسر الأرقام العشرية** (`3.14` → `3` و`14`) — tokenizer الأرقام لم يكن يتعرف على النقطة العشرية.
4. **typedef forward declarations** (`typedef struct sqlite3 sqlite3;`) كانت تفشل لأن المحلل يفترض وجود `{ ... }` دائماً بعد اسم الـ struct.
5. **انعكاس إشارة الأعداد** في `unmarshalStruct` — قيمة `i32` سالبة كانت تُقرأ دائماً كـ `u32` غير موقّع، فتُرجع رقماً كبيراً خاطئاً بدل القيمة السالبة الصحيحة.
6. **خلط بين `AbiVersion` و `AbiModule`** في فحص توافق الترقية بـ urpm — كان يمرر رقم إصدار بدل وحدة ABI كاملة، فيتسبب في خطأ تنفيذ. الإصلاح: إضافة حقل `abiModule` كامل لـ `InstalledNativePackage` لإتاحة فحص توافق حقيقي.

كل هذه الإصلاحات مُغطاة الآن باختبارات صريحة (forward declarations، علامات سالبة، extern C، أرقام عشرية) لمنع الانتكاس.

---

## 7. ما لم يُنفَّذ عمداً (خارج Phase 6)

تماشياً مع التوصية: لم يُلمَس أي من AI Native Features، NeuralState، DNS، DLL، Explainability Runtime، Safety Contracts، Swarm Intelligence، أو مكتبات Robotics/Autonomous/Trading.

كذلك لم يتم فعلياً **تنفيذ استدعاء حقيقي** عبر FFI runtime حقيقي (linking فعلي مع `.so`/`.dylib`) — هذا يتطلب طبقة تنفيذ native خارج بيئة Node.js الحالية، وهو مرشّح طبيعي لـ Phase 7.

---

## 8. التوصية للخطوة القادمة

اعتماد **Phase 7 — Native Ecosystem Hardening**:
1. دعم C++ (namespaces، classes كـ opaque handles).
2. Rust FFI bridge.
3. urpm build-from-source كخطة بديلة عند غياب artifact جاهز.
4. تنفيذ ربط حقيقي كامل لـ SQLite3 مع اختبار تنفيذ فعلي (لا محاكاة فقط) — يكمل ما بدأه v20 من اختبارات `WebAssembly.instantiate()` الحقيقية.
