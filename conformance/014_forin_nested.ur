function main(): int
  let outer = [1,2]
  let inner = [10,20]
  let total = 0
  for a in outer
    for b in inner
      total = total + a + b
    end
  end
  return total
end
