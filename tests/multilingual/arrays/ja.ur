関数 makeArray(): int[]
  レット numbers = [10, 20, 30, 40, 50]
  返す numbers
終了

関数 sumArray(arr: int[]): int
  レット total: int = 0
  レット i: int = 0
  ながら i < 5
    total = total + arr[i]
    i = i + 1
  終了
  返す total
終了

関数 main(): int
  レット numbers = makeArray()
  レット first: int = numbers[0]
  レット third: int = numbers[2]
  レット total: int = sumArray(numbers)
  numbers[0] = 99
  レット afterWrite: int = numbers[0]
  print(first)
  print(third)
  print(total)
  print(afterWrite)
  返す 0
終了
