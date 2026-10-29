function main(): int
  let i = 0
  let total = 0
  while i < 5
    i = i + 1
    if i == 99
      continue
    end
    total = total + i
  end
  return total
end
