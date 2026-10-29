funktion main(): int
  sei a: string = "hi"
  sei b: string = "hi"
  sei c: string = "bye"
  sei eqSame: bool = a == b
  sei eqDiff: bool = a == c
  sei result: int = 0
  wenn eqSame
    result = result + 1
  ende
  wenn eqDiff
    result = result + 10
  ende
  zurueckgeben result
ende
