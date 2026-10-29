function makeArray(): int[]
  let numbers = [10, 20, 30, 40, 50]
  return numbers
end

function sumArray(arr: int[]): int
  let total: int = 0
  let i: int = 0
  while i < 5
    total = total + arr[i]
    i = i + 1
  end
  return total
end

function main(): int
  let numbers = makeArray()
  let first: int = numbers[0]
  let third: int = numbers[2]
  let total: int = sumArray(numbers)
  numbers[0] = 99
  let afterWrite: int = numbers[0]
  print(first)
  print(third)
  print(total)
  print(afterWrite)
  return 0
end
