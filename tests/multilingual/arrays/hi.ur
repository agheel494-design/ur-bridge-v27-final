कार्य makeArray(): int[]
  मान numbers = [10, 20, 30, 40, 50]
  वापस numbers
समाप्त

कार्य sumArray(arr: int[]): int
  मान total: int = 0
  मान i: int = 0
  जबतक i < 5
    total = total + arr[i]
    i = i + 1
  समाप्त
  वापस total
समाप्त

कार्य main(): int
  मान numbers = makeArray()
  मान first: int = numbers[0]
  मान third: int = numbers[2]
  मान total: int = sumArray(numbers)
  numbers[0] = 99
  मान afterWrite: int = numbers[0]
  print(first)
  print(third)
  print(total)
  print(afterWrite)
  वापस 0
समाप्त
