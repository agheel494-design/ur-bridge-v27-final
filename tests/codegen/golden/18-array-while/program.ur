function main(): int
  let arr = [1, 2, 3, 4, 5]
  let i = 0
  let total = 0
  while i < 5
    total = total + arr[i]
    i = i + 1
  end
  return total
end
