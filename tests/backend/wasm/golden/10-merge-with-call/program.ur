function f(): int
  return 42
end
function main(): int
  let x = 0
  if 1 == 1
    x = f()
  else
    x = 0
  end
  return x
end
