function add(a: int, b: int): int
  return a + b
end

function main(): int
  return add(add(1, 2), add(3, 4))
end
