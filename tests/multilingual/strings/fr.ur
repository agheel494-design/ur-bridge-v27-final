fonction main(): int
  soit a: string = "hi"
  soit b: string = "hi"
  soit c: string = "bye"
  soit eqSame: bool = a == b
  soit eqDiff: bool = a == c
  soit result: int = 0
  si eqSame
    result = result + 1
  fin
  si eqDiff
    result = result + 10
  fin
  retourner result
fin
