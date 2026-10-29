function main(): int
  let arr = [0, 0, 0]
  let count = 0
  while count < 3
    arr[1] = 50
    count = count + 1
  end
  return arr[1]
end
