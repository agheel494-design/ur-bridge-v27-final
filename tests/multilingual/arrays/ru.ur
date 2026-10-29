функция makeArray(): int[]
  пусть numbers = [10, 20, 30, 40, 50]
  вернуть numbers
конец

функция sumArray(arr: int[]): int
  пусть total: int = 0
  пусть i: int = 0
  пока i < 5
    total = total + arr[i]
    i = i + 1
  конец
  вернуть total
конец

функция main(): int
  пусть numbers = makeArray()
  пусть first: int = numbers[0]
  пусть third: int = numbers[2]
  пусть total: int = sumArray(numbers)
  numbers[0] = 99
  пусть afterWrite: int = numbers[0]
  print(first)
  print(third)
  print(total)
  print(afterWrite)
  вернуть 0
конец
