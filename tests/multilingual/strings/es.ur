funcion main(): int
  sea a: string = "hi"
  sea b: string = "hi"
  sea c: string = "bye"
  sea eqSame: bool = a == b
  sea eqDiff: bool = a == c
  sea result: int = 0
  si eqSame
    result = result + 1
  fin
  si eqDiff
    result = result + 10
  fin
  retornar result
fin
