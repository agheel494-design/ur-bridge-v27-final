function main(): int
  let arr = [10, 20, 30]
  let i = 0
  let total = 0
  while i < 3
    total = total + arr[i]
    i = i + 1
  end
  return total
end
