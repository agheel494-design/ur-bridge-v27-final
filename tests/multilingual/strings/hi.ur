कार्य main(): int
  मान a: string = "hi"
  मान b: string = "hi"
  मान c: string = "bye"
  मान eqSame: bool = a == b
  मान eqDiff: bool = a == c
  मान result: int = 0
  अगर eqSame
    result = result + 1
  समाप्त
  अगर eqDiff
    result = result + 10
  समाप्त
  वापस result
समाप्त
