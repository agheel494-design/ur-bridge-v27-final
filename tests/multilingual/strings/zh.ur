函数 main(): int
  设 a: string = "hi"
  设 b: string = "hi"
  设 c: string = "bye"
  设 eqSame: bool = a == b
  设 eqDiff: bool = a == c
  设 result: int = 0
  如果 eqSame
    result = result + 1
  结束
  如果 eqDiff
    result = result + 10
  结束
  返回 result
结束
