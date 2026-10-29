fonction makeArray(): int[]
  soit numbers = [10, 20, 30, 40, 50]
  retourner numbers
fin

fonction sumArray(arr: int[]): int
  soit total: int = 0
  soit i: int = 0
  tantque i < 5
    total = total + arr[i]
    i = i + 1
  fin
  retourner total
fin

fonction main(): int
  soit numbers = makeArray()
  soit first: int = numbers[0]
  soit third: int = numbers[2]
  soit total: int = sumArray(numbers)
  numbers[0] = 99
  soit afterWrite: int = numbers[0]
  print(first)
  print(third)
  print(total)
  print(afterWrite)
  retourner 0
fin
