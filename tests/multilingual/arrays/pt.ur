funcao makeArray(): int[]
  seja numbers = [10, 20, 30, 40, 50]
  retornar numbers
fim

funcao sumArray(arr: int[]): int
  seja total: int = 0
  seja i: int = 0
  enquanto i < 5
    total = total + arr[i]
    i = i + 1
  fim
  retornar total
fim

funcao main(): int
  seja numbers = makeArray()
  seja first: int = numbers[0]
  seja third: int = numbers[2]
  seja total: int = sumArray(numbers)
  numbers[0] = 99
  seja afterWrite: int = numbers[0]
  print(first)
  print(third)
  print(total)
  print(afterWrite)
  retornar 0
fim
