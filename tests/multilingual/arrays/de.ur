funktion makeArray(): int[]
  sei numbers = [10, 20, 30, 40, 50]
  zurueckgeben numbers
ende

funktion sumArray(arr: int[]): int
  sei total: int = 0
  sei i: int = 0
  waehrend i < 5
    total = total + arr[i]
    i = i + 1
  ende
  zurueckgeben total
ende

funktion main(): int
  sei numbers = makeArray()
  sei first: int = numbers[0]
  sei third: int = numbers[2]
  sei total: int = sumArray(numbers)
  numbers[0] = 99
  sei afterWrite: int = numbers[0]
  print(first)
  print(third)
  print(total)
  print(afterWrite)
  zurueckgeben 0
ende
