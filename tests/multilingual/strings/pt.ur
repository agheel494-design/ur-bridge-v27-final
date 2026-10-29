funcao main(): int
  seja a: string = "hi"
  seja b: string = "hi"
  seja c: string = "bye"
  seja eqSame: bool = a == b
  seja eqDiff: bool = a == c
  seja result: int = 0
  se eqSame
    result = result + 1
  fim
  se eqDiff
    result = result + 10
  fim
  retornar result
fim
