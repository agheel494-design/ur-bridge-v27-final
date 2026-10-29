関数 main(): int
  レット a: string = "hi"
  レット b: string = "hi"
  レット c: string = "bye"
  レット eqSame: bool = a == b
  レット eqDiff: bool = a == c
  レット result: int = 0
  もし eqSame
    result = result + 1
  終了
  もし eqDiff
    result = result + 10
  終了
  返す result
終了
