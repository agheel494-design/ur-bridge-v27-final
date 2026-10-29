دالة makeArray(): int[]
  دع numbers = [10, 20, 30, 40, 50]
  أرجع numbers
نهاية

دالة sumArray(arr: int[]): int
  دع total: int = 0
  دع i: int = 0
  بينما i < 5
    total = total + arr[i]
    i = i + 1
  نهاية
  أرجع total
نهاية

دالة main(): int
  دع numbers = makeArray()
  دع first: int = numbers[0]
  دع third: int = numbers[2]
  دع total: int = sumArray(numbers)
  numbers[0] = 99
  دع afterWrite: int = numbers[0]
  print(first)
  print(third)
  print(total)
  print(afterWrite)
  أرجع 0
نهاية
