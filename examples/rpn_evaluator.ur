// مُقيِّم تعبيرات RPN (Reverse Polish Notation) — البرنامج الثالث.
// مُصمَّم بدقة ضمن الخريطة المؤكَّدة للأساسيات: Array تبقى محلية
// داخل main فقط (القيد المؤكَّد: لا يمكن تمريرها كمعامل دالة).
// يُقيِّم: 3 4 + 2 * = (3+4)*2 = 14

function power(base: int, exp: int): int
  if exp == 0
    return 1
  end
  return base * power(base, exp - 1)
end

function main(): int
  // المكدس: تمثيل يدوي بسيط بمصفوفة ثابتة الحجم (بلا Push/Pop كدوال منفصلة،
  // بما أن ذلك يتطلَّب تمرير Array كمعامل — غير مدعوم حالياً).
  let stack = [0, 0, 0, 0, 0]
  let top = 0

  // التعبير: 3 4 + 2 * (يعني (3+4)*2)
  // دفع 3
  stack[top] = 3
  top = top + 1
  // دفع 4
  stack[top] = 4
  top = top + 1
  // عملية +
  let b = stack[top - 1]
  top = top - 1
  let a = stack[top - 1]
  top = top - 1
  stack[top] = a + b
  top = top + 1
  // دفع 2
  stack[top] = 2
  top = top + 1
  // عملية *
  let b2 = stack[top - 1]
  top = top - 1
  let a2 = stack[top - 1]
  top = top - 1
  stack[top] = a2 * b2
  top = top + 1

  print(stack[top - 1])

  // اختبار إضافي حقيقي لـ Recursion ضمن نفس البرنامج: 2^10
  print(power(2, 10))

  return 0
end
