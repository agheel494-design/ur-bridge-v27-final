function get(): nativeptr
  return 0
end
function use(p: nativeptr): int
  return 1
end
function main(): int
  let q = get()
  return use(q) + use(q)
end
