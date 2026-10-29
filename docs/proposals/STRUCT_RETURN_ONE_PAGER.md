# STRUCT_RETURN_ONE_PAGER.md

## المشكلة
لا يمكن كتابة دالة تُعيد `struct` — أي برنامج يحتاج `Factory Function`
حقيقية (نمط شائع جداً) مستحيل اليوم.

## البرنامج الحقيقي الذي يفشل
```ur
struct Point
  x: int
  y: int
end

function makePoint(a: int, b: int): Point
  return Point(a, b)
end

function main(): int
  let p = makePoint(3, 4)
  return p.x + p.y
end
```
**النتيجة**: `CG1002 — call to unresolved function 'Point'` (مُؤكَّد
حياً، `gcc`/`tsx` فعلياً، لا افتراضاً).

## سبب الفشل — السطر بالضبط
`src/compiler/codegen/lower-to-ir-helpers.ts:29`:
```typescript
export function toIRType(t: URType): IRType {
  ...
  return "void"; // <-- هنا: أي نوع غير مُعالَج صراحة (بما فيه Struct) يسقط هنا
}
```
`function makePoint(...): Point` → `toIRType(Point)` → `"void"` بالخطأ
→ الدالة تُعامَل كأنها **لا تُعيد قيمة إطلاقاً**، فيفشل `return
Point(a, b)` لاحقاً.

## اكتشاف إضافي مهم — هذا لم يكن قصوراً في اليوم الأول

**تحقُّق حي مباشر (لا مجرد وصف وثيقة)**: فحصتُ `IRParam` الفعلية في
`src/shared/ir.ts:280-285` — تحتوي `structLayout?: StructLayoutResult`
**بالفعل**، بتعليق صريح: *"lets the Backend emit a real by-value
struct parameter"*. هذا **يُثبت أن الكود الفعلي يتبع تصميم `V2`
فعلياً لجزء `Parameters`** — لا مجرد وثيقة نظرية منفصلة عن الواقع.
**الفجوة الحقيقية محصورة تماماً في `returnType`** (لا توجد نظيرة
`structLayout` هناك إطلاقاً) — هذا يُقلِّل حجم المخاطرة فعلياً، بما
أن الآلية الأساسية مُختبَرة وتعمل، والمطلوب توسيعها لموضع واحد
محدَّد، لا بناء آلية جديدة.

**الوثيقة المرجعية الكاملة**: `docs/proposals/STRUCT_RETURN_DESIGN_PROPOSAL.md`
(مُستعادة، لا محذوفة — هذه الصفحة ملخص تنفيذي لها، لا بديل عنها).

## جدول تأثير (Impact Analysis) — كل خانة مُغلَقة بدليل حقيقي، لا استنتاجاً

| المكوِّن | يحتاج تعديل؟ | الدليل |
|---|---|---|
| `Lexer` | لا | لا صيغة نحوية جديدة — `function f(): Point` مقبولة نحوياً بالفعل |
| `Parser` | لا | نفس السبب — يُحلَّل بصحة اليوم |
| `Semantic` (`index.ts`) | ✅ **مُتحقَّق حياً — لا** | `grep` مباشر: **صفر** إشارة لـ`returnType`/`Struct` معاً في `semantic/index.ts` — لا منطق يفحص توافق نوع الإرجاع مع `struct` إطلاقاً اليوم |
| `Native Library Registry` (`FFI Externs`) | ✅ **مُتحقَّق حياً — لا** | فحصتُ كل الـ`~30` إدخال — صفر إدخال يستخدم `struct`، كلها أنواع بسيطة (`FFI` منفصل تماماً عن دوال `UR` العادية) |
| `IR` (`src/shared/ir.ts`) | **نعم** | `IRFunction.returnType: IRType` لا تحتوي خيار `struct` |
| `Lowering` (`lower-to-ir-helpers.ts`) | **نعم** | السطر `29` تحديداً |
| `Lowering` (`lower-to-ir.ts`/`ir-builder.ts`) | **نعم** | تفعيل `return <StructConstructorCall>` |
| `C Backend` | **نعم** | توليد إرجاع `struct` بالقيمة |
| `WASM Backend` | لا (هذه المرحلة) | خارج النطاق صراحة — يحتاج فحص `Regression` فقط |
| `LLVM Backend` | لا (هذه المرحلة) | نفس السبب |
| `Optimizer` (`src/optimizer/pass.ts`) | ✅ **مُتحقَّق حياً — لا** | فحصتُ الاستخدام الوحيد (`pass.ts:83`) — نسخ مباشر (`returnType: f.returnType`) بلا منطق يفحص نوعها، آمن تلقائياً عبر `TypeScript` |
| `Constant Folding` (`src/optimizer/constant-folding.ts`) | ✅ **مُتحقَّق حياً — لا** | لا يلمس `returnType` إطلاقاً (`grep` فارغة) |
| `Dead Code Elimination` (`src/optimizer/dead-code-elimination.ts`) | ✅ **مُتحقَّق حياً — لا** | نفس السبب |
| `Package System` (`src/urpm/`) | ✅ **مُتحقَّق حياً — لا** | صفر إشارة لـ`returnType` في أي من ملفاته السبعة |
| `REPL` | ✅ **مُتحقَّق — غير قابل للتطبيق** | **لا يوجد `REPL` في هذا المشروع إطلاقاً** (`find` فارغة تماماً) |
| `IDE/LSP` (`src/ide/`) | ✅ **مُتحقَّق حياً — لا** | صفر إشارة لـ`returnType`؛ المجلد يحتوي ملفاً واحداً فقط حالياً (`server.ts`) |
| `Tests` | **نعم** | اختبار جديد + إعادة تشغيل الاختبارات الحالية كاملة |

**كل خانة الآن إما `مُتحقَّقة حياً بدليل مباشر`، أو `نعم` بسبب مُحدَّد بدقة.** صفر خانة "متوقَّع" متبقية.

## خطة `Rollback`

```
Impact Review
─────────────
Lexer ............ No change
Parser ........... No change
Semantic ......... Verified (no struct/returnType logic exists today)
Optimizer ........ Verified (pass-through only, no logic depends on it)
IR ............... Change (IRFunction.returnType widened)
Lowering ......... Change (toIRType + return-expression handling)
C Backend ........ Change (real struct-by-value return codegen)
WASM Backend ..... No change (regression-checked only)
LLVM Backend ..... No change (regression-checked only)
Package/REPL/IDE.. No change (verified, no dependency)
Tests ............ +N (new struct-return test + full existing suite re-run)

Rollback:
Revert the implementation commit(s) restores previous behavior
completely — the IR type widening is additive (a union, not a
replacement of existing IRType values), so any code that never
constructs a struct-return function is byte-for-byte unaffected
even without reverting; a full revert is available regardless as
the standard safety net.
```

**لن نبدأ التنفيذ حتى نتأكد أن هذا الجدول صحيح.**

## الحل A — Aggregate Value (قيمة SSA واحدة تحمل الـstruct كاملة)
- **المزايا**: مفاهيمياً أنظف، يُطابِق كيف تعمل القيم البسيطة اليوم.
- **العيوب**: `IRValueRef` مبنية على افتراض "قيمة واحدة ثابتة الحجم" في كل مكان — كسر هذا الافتراض يعني تعديل كل تعليمة تلمس أي قيمة، لا فقط كود الـstruct.

## الحل B — Slot + Layout (نفس الآلية المُستخدَمة بالفعل للمعاملات الناجحة)
- **المزايا**: آلية **موجودة ومُختبَرة بالفعل** (`IRLocalSlot.structLayout`، نفس ما ينجح اليوم للمعاملات)؛ صفر تغيير في `IRValueRef`/SSA؛ `C Backend` تدعم `struct` بالقيمة بسهولة بالفعل (`typedef struct` حقيقية مُؤكَّدة).
- **العيوب**: قيمة `struct` وسيطة غير مربوطة بـ`let` (مثل `return Point(a,b)` مباشرة) تحتاج `Slot` مُصطنَعاً من المُصرِّف نفسه — تكلفة حقيقية صغيرة، لا مخفية.

## التوصية
**الحل B** — لأنه **ليس اختياراً جديداً**، بل **استكمال لقرار مُتَّخَذ ومُختبَر جزئياً بالفعل بنجاح** (نفس الآلية التي تُنجِح تمرير `struct` كمعامل اليوم). التغيير الفعلي المطلوب مُحدَّد ومُحاصَر: معالجة `t.kind === "Struct"` صراحة في `toIRType` (السطر 29) بدل السقوط الافتراضي لـ`"void"`، ثم تمكين `return <StructConstructorCall>` في `lower-to-ir.ts`، نطاق `C Backend` فقط أولاً.
