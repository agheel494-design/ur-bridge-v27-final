функция main(): int
  пусть a: string = "hi"
  пусть b: string = "hi"
  пусть c: string = "bye"
  пусть eqSame: bool = a == b
  пусть eqDiff: bool = a == c
  пусть result: int = 0
  если eqSame
    result = result + 1
  конец
  если eqDiff
    result = result + 10
  конец
  вернуть result
конец
