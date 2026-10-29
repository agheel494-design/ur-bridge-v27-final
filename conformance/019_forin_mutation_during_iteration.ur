function main(): int
  let arr = [1,2,3]
  for x in arr
    arr[0] = 100
  end
  return arr[0]
end
