function counter(): int
  print(7)
  return 7
end
function main(): int
  let v = counter()
  return v + v
end
