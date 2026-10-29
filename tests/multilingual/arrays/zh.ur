函数 makeArray(): int[]
  设 numbers = [10, 20, 30, 40, 50]
  返回 numbers
结束

函数 sumArray(arr: int[]): int
  设 total: int = 0
  设 i: int = 0
  当 i < 5
    total = total + arr[i]
    i = i + 1
  结束
  返回 total
结束

函数 main(): int
  设 numbers = makeArray()
  设 first: int = numbers[0]
  设 third: int = numbers[2]
  设 total: int = sumArray(numbers)
  numbers[0] = 99
  设 afterWrite: int = numbers[0]
  print(first)
  print(third)
  print(total)
  print(afterWrite)
  返回 0
结束
