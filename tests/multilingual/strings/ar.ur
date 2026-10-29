دالة main(): int
  دع a: string = "hi"
  دع b: string = "hi"
  دع c: string = "bye"
  دع eqSame: bool = a == b
  دع eqDiff: bool = a == c
  دع result: int = 0
  إذا eqSame
    result = result + 1
  نهاية
  إذا eqDiff
    result = result + 10
  نهاية
  أرجع result
نهاية
