function main(): int
  let a: string = "hi"
  let b: string = "hi"
  let c: string = "bye"
  let eqSame: bool = a == b
  let eqDiff: bool = a == c
  let result: int = 0
  if eqSame
    result = result + 1
  end
  if eqDiff
    result = result + 10
  end
  return result
end
