function main(): int
  let i = 0
  let total = 0
  while i < 10
    i = i + 1
    if i == 5
      continue
    end
    total = total + i
  end
  return total
end
