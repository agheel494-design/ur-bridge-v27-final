funcion makeArray(): int[]
  sea numbers = [10, 20, 30, 40, 50]
  retornar numbers
fin

funcion sumArray(arr: int[]): int
  sea total: int = 0
  sea i: int = 0
  mientras i < 5
    total = total + arr[i]
    i = i + 1
  fin
  retornar total
fin

funcion main(): int
  sea numbers = makeArray()
  sea first: int = numbers[0]
  sea third: int = numbers[2]
  sea total: int = sumArray(numbers)
  numbers[0] = 99
  sea afterWrite: int = numbers[0]
  print(first)
  print(third)
  print(total)
  print(afterWrite)
  retornar 0
fin
