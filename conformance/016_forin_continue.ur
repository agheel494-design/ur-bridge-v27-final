function main(): int
  let arr = [1,2,3,4,5]
  let total = 0
  for x in arr
    if x == 3
      continue
    end
    total = total + x
  end
  return total
end
