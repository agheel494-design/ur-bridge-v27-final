function main(): int
  let arr = [0, 0, 0]
  let i = 0
  while i < 3
    arr[i] = i + 10
    i = i + 1
  end
  return arr[0] + arr[1] + arr[2]
end
